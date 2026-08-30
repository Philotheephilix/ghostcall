/**
 * @jest-environment node
 */
/**
 * Unit tests for strk20-payment.ts
 *
 * Three scenarios:
 *  1. SDK available  → calls createPrivateTransfers (mocked) and returns tx hash
 *  2. SDK not available → falls back to standard ERC-20 transfer (mocked account)
 *  3. Both paths return a tx hash string
 *
 * Strategy:
 * - The module exposes `_sdkAvailable` as a settable export so tests can flip the
 *   detection flag without needing the real SDK on disk.
 * - The SDK itself is mocked at the top level as a virtual module (jest.mock with
 *   virtual:true) so require('@starkware-libs/starknet-privacy-sdk') inside the
 *   production code resolves to our mock factory.
 * - Between SDK / no-SDK describe blocks we reset modules and re-import to clear
 *   the cached _sdkAvailable value.
 */

// ---- STRK20 SDK virtual mock (used by the SDK-available path) ----
const mockExecuteRegister = jest.fn()
const mockExecuteTransfer = jest.fn()
const mockCreatePrivateTransfers = jest.fn()

jest.mock(
  '@starkware-libs/starknet-privacy-sdk',
  () => ({
    createPrivateTransfers: mockCreatePrivateTransfers,
  }),
  { virtual: true }
)

// ---- shared mock account factory ----
function makeMockAccount(txHashSequence: string[]) {
  let call = 0
  return {
    execute: jest.fn(async () => ({ transaction_hash: txHashSequence[call++] ?? txHashSequence[txHashSequence.length - 1] })),
    waitForTransaction: jest.fn(async () => ({})),
    getBlock: jest.fn(async () => ({ block_hash: '0xBLOCK' })),
  }
}

// ---- helpers ----
const REGISTER_TX = '0xSDK_REGISTER_TX'
const SDK_TX = '0xSDK_TRANSFER_TX'
const FALLBACK_TX = '0xFALLBACK_TRANSFER_TX'
const STEALTH_ADDR = '0xSTEALTH_ADDR'

function setupSDKMock() {
  mockExecuteRegister.mockResolvedValue({
    callAndProof: { call: { contractAddress: '0xPOOL', entrypoint: 'register', calldata: [] } },
  })
  mockExecuteTransfer.mockResolvedValue({
    callAndProof: { call: { contractAddress: '0xPOOL', entrypoint: 'privateTransfer', calldata: [] } },
  })
  mockCreatePrivateTransfers.mockReturnValue({
    build: () => ({
      register: () => ({ execute: mockExecuteRegister }),
      privateTransfer: (_opts: unknown) => ({ execute: mockExecuteTransfer }),
    }),
  })
}

// Import the module under test (the virtual mock above is already in place)
import { sendShieldedPayment, _setSdkAvailable } from '../strk20-payment'

// Alias to match usage in tests
const PaymentMod = { sendShieldedPayment, _setSdkAvailable }

describe('sendShieldedPayment — SDK available path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setupSDKMock()
    // Force the module to believe the SDK is available
    PaymentMod._setSdkAvailable(true)
  })

  afterEach(() => {
    PaymentMod._setSdkAvailable(null)
  })

  test('calls createPrivateTransfers and returns tx hash from account.execute', async () => {
    const account = makeMockAccount([REGISTER_TX, SDK_TX])

    const result = await PaymentMod.sendShieldedPayment(
      STEALTH_ADDR,
      BigInt(1e18),
      account as unknown as import('starknet').Account,
      0xdeadbeefn,
    )

    expect(result).toBe(SDK_TX)
    expect(mockCreatePrivateTransfers).toHaveBeenCalledTimes(1)
    expect(account.execute).toHaveBeenCalledTimes(2) // register + transfer
  })

  test('returns a non-empty hex string starting with 0x', async () => {
    const account = makeMockAccount([REGISTER_TX, SDK_TX])

    const txHash = await PaymentMod.sendShieldedPayment(
      STEALTH_ADDR,
      1000n,
      account as unknown as import('starknet').Account,
      12345n,
    )

    expect(typeof txHash).toBe('string')
    expect(txHash.length).toBeGreaterThan(0)
    expect(txHash).toMatch(/^0x/)
  })
})

describe('sendShieldedPayment — SDK not available (fallback path)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Force the module to believe the SDK is unavailable
    PaymentMod._setSdkAvailable(false)
  })

  afterEach(() => {
    PaymentMod._setSdkAvailable(null)
  })

  test('falls back to standard ERC-20 transfer when SDK unavailable', async () => {
    const account = makeMockAccount([FALLBACK_TX])
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await PaymentMod.sendShieldedPayment(
      STEALTH_ADDR,
      BigInt(5e17),
      account as unknown as import('starknet').Account,
      0n,
    )

    expect(result).toBe(FALLBACK_TX)
    // Must have called execute once (no register in fallback path)
    expect(account.execute).toHaveBeenCalledTimes(1)
    const allCalls = account.execute.mock.calls as unknown[][]
    const firstCallArgs = allCalls[0] as unknown[]
    const multicall = firstCallArgs[0] as Array<{ contractAddress: string; entrypoint: string }>
    expect(multicall[0].entrypoint).toBe('transfer')
    expect(multicall[0].contractAddress).toBe(
      '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
    )

    warnSpy.mockRestore()
  })

  test('emits console.warn when falling back', async () => {
    const account = makeMockAccount([FALLBACK_TX])
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await PaymentMod.sendShieldedPayment(
      STEALTH_ADDR,
      1n,
      account as unknown as import('starknet').Account,
      0n,
    )

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('starknet-privacy-sdk not installed')
    )
    warnSpy.mockRestore()
  })

  test('returns tx hash string in fallback path', async () => {
    const account = makeMockAccount([FALLBACK_TX])
    jest.spyOn(console, 'warn').mockImplementation(() => {})

    const txHash = await PaymentMod.sendShieldedPayment(
      STEALTH_ADDR,
      BigInt(1e17),
      account as unknown as import('starknet').Account,
      0n,
    )

    expect(typeof txHash).toBe('string')
    expect(txHash).toBe(FALLBACK_TX)
  })
})
