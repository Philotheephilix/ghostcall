/**
 * @jest-environment node
 */
/**
 * Unit tests for starknet-client.ts
 * Mocks starknet.js at module level to verify calldata construction.
 */

// ---- captured args store ----
let lastRegisterArgs: unknown[] = []
let lastGetStealthMetaArgs: unknown[] = []
let lastCommitCallArgs: unknown[] = []
let lastWaitForTxHash = ''

// ---- @scure/starknet mock (used by stealth-keys.ts directly) ----
const STARK_ORDER = 2n ** 251n + 17n * 2n ** 192n + 976n + 1n

jest.mock('@scure/starknet', () => {
  const STARK_ORDER_INNER = 2n ** 251n + 17n * 2n ** 192n + 976n + 1n
  return {
    CURVE: { n: STARK_ORDER_INNER },
    ProjectivePoint: {
      BASE: {
        multiply: (scalar: bigint) => ({
          x: scalar % STARK_ORDER_INNER,
          y: (scalar + 1n) % STARK_ORDER_INNER,
        }),
      },
      fromAffine: ({ x, y }: { x: bigint; y: bigint }) => ({
        x, y,
        multiply: (scalar: bigint) => ({
          x: scalar * x % STARK_ORDER_INNER,
          y: scalar * y % STARK_ORDER_INNER,
        }),
      }),
    },
    utils: {},
  }
})

// ---- starknet module mock ----
jest.mock('starknet', () => {
  const mockWaitForTransaction = jest.fn(async (hash: string) => {
    lastWaitForTxHash = hash
    return {}
  })

  const mockRpcProvider = jest.fn().mockImplementation(() => ({
    waitForTransaction: mockWaitForTransaction,
  }))

  const mockAccount = jest.fn().mockImplementation(() => ({
    waitForTransaction: mockWaitForTransaction,
    execute: jest.fn(async (call: { contractAddress: string; entrypoint: string; calldata: unknown[] }) => {
      // Route tx hash back by entrypoint so tests can distinguish register vs commit
      if (call.entrypoint === 'register') return { transaction_hash: '0xREGISTER_TX' }
      if (call.entrypoint === 'commit_call') return { transaction_hash: '0xCOMMIT_TX' }
      return { transaction_hash: '0xTX' }
    }),
    getNonce: jest.fn(async () => '0x0'),
  }))

  const mockContractInstance = {
    populate: jest.fn((method: string, args: unknown[]) => {
      if (method === 'register') lastRegisterArgs = args
      if (method === 'commit_call') lastCommitCallArgs = args
      return { contractAddress: '0xADDR', entrypoint: method, calldata: args }
    }),
    get_stealth_meta: jest.fn(async (...args: unknown[]) => {
      lastGetStealthMetaArgs = args
      return { 0: BigInt('0x1111'), 1: BigInt('0x2222'), 2: BigInt('0x3333'), 3: BigInt('0x4444'), 4: BigInt('0x' + 'aa'.repeat(31)), 5: BigInt('0xbb') }
    }),
    is_committed: jest.fn(async () => BigInt(1)),
    is_registered: jest.fn(async () => false),
    call: jest.fn(async (method: string, args: unknown[]) => {
      if (method === 'get_stealth_meta') {
        lastGetStealthMetaArgs = args
        return { 0: BigInt('0x1111'), 1: BigInt('0x2222'), 2: BigInt('0x3333'), 3: BigInt('0x4444'), 4: BigInt('0x' + 'aa'.repeat(31)), 5: BigInt('0xbb') }
      }
      if (method === 'is_registered') return false
      if (method === 'is_committed') return BigInt(1)
      return null
    }),
  }

  const mockContract = jest.fn().mockImplementation(() => mockContractInstance)

  const num = {
    toHex: (n: bigint) => '0x' + n.toString(16),
  }

  return {
    RpcProvider: mockRpcProvider,
    Account: mockAccount,
    Contract: mockContract,
    num,
  }
})

// ---- mock JSON imports (require'd by starknet-client) ----
jest.mock(
  '../../../contracts/target/dev/ghostcall_contracts_StealthRegistry.contract_class.json',
  () => ({ abi: [{ type: 'function', name: 'register' }] }),
  { virtual: true }
)
jest.mock(
  '../../../contracts/target/dev/ghostcall_contracts_CallLog.contract_class.json',
  () => ({ abi: [{ type: 'function', name: 'commit_call' }] }),
  { virtual: true }
)
jest.mock(
  '../../../contracts/deployments.json',
  () => ({
    StealthRegistry: { address: '0xSTEALTH_REG_ADDR' },
    CallLog: { address: '0xCALL_LOG_ADDR' },
  }),
  { virtual: true }
)

import {
  initStarknetClient,
  registerHandle,
  lookupHandle,
  commitCall,
} from '../starknet-client'
import { deriveStealthKeypair } from '../stealth-keys'

// Init client before tests
beforeAll(() => {
  initStarknetClient(
    'https://rpc.example.com',
    '0xACCOUNT',
    '0xPRIVKEY'
  )
})

describe('registerHandle', () => {
  const sig = { r: 0xdeadbeefn, s: 0xcafebaben }

  test('constructs calldata with exactly 7 felt252 args (handle_hash, pkVx, pkVy, pkSx, pkSy, pk_nostr, pk_nostr_hi)', async () => {
    const kp = deriveStealthKeypair(sig)
    const txHash = await registerHandle('alice', kp)

    expect(txHash).toBe('0xREGISTER_TX')
    // register(handleHash, pkVx, pkVy, pkSx, pkSy, pk_nostr, pk_nostr_hi) = 7 args
    expect(lastRegisterArgs).toHaveLength(7)
    // Each arg must be a hex felt252 string
    for (const arg of lastRegisterArgs) {
      expect(typeof arg).toBe('string')
      expect(arg as string).toMatch(/^0x[0-9a-f]+$/i)
    }
  })

  test('handle hash is first arg (deterministic)', async () => {
    const kp = deriveStealthKeypair(sig)
    await registerHandle('alice', kp)
    const firstCall = [...lastRegisterArgs]
    await registerHandle('alice', kp)
    expect(lastRegisterArgs[0]).toBe(firstCall[0])
  })

  test('different handles produce different first arg', async () => {
    const kp = deriveStealthKeypair(sig)
    await registerHandle('alice', kp)
    const aliceHash = lastRegisterArgs[0]
    await registerHandle('bob', kp)
    const bobHash = lastRegisterArgs[0]
    expect(aliceHash).not.toBe(bobHash)
  })
})

describe('lookupHandle', () => {
  test('passes single felt252 arg to get_stealth_meta', async () => {
    await lookupHandle('alice')
    expect(lastGetStealthMetaArgs).toHaveLength(1)
    expect(typeof lastGetStealthMetaArgs[0]).toBe('string')
    expect(lastGetStealthMetaArgs[0] as string).toMatch(/^0x[0-9a-f]+$/i)
  })

  test('correctly parses (felt252 x6) return tuple including full nostrPubkey', async () => {
    const meta = await lookupHandle('alice')
    expect(meta.pkVx).toBe(BigInt('0x1111'))
    expect(meta.pkVy).toBe(BigInt('0x2222'))
    expect(meta.pkSx).toBe(BigInt('0x3333'))
    expect(meta.pkSy).toBe(BigInt('0x4444'))
    expect(typeof meta.nostrPubkey).toBe('string')
    // Full 32-byte pubkey (64 hex chars): pk_nostr_hi (0xbb) + pk_nostr (0xaa*31)
    expect(meta.nostrPubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(meta.nostrPubkey).toBe('bb' + 'aa'.repeat(31))
  })
})

describe('commitCall', () => {
  test('accepts bigint and passes single felt252 calldata arg', async () => {
    const commitment = 0x1234567890abcdefn
    const txHash = await commitCall(commitment)

    expect(txHash).toBe('0xCOMMIT_TX')
    expect(lastCommitCallArgs).toHaveLength(1)
    expect(typeof lastCommitCallArgs[0]).toBe('string')
    expect(lastCommitCallArgs[0] as string).toMatch(/^0x[0-9a-f]+$/i)
  })

  test('accepts hex string and converts to felt252 calldata', async () => {
    const txHash = await commitCall('0x1234567890abcdef')

    expect(txHash).toBe('0xCOMMIT_TX')
    expect(lastCommitCallArgs).toHaveLength(1)
    expect(typeof lastCommitCallArgs[0]).toBe('string')
    // The string 0x1234567890abcdef converts to bigint then back to hex
    expect(lastCommitCallArgs[0] as string).toBe('0x1234567890abcdef')
  })
})
