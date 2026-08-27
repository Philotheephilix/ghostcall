/**
 * Unit tests for starknet-client.ts
 * Mocks starknet.js at module level to verify calldata construction.
 */

// ---- captured args store ----
let lastRegisterArgs: unknown[] = []
let lastGetStealthMetaArgs: unknown[] = []
let lastCommitCallArgs: unknown[] = []
let lastWaitForTxHash = ''

// ---- starknet module mock ----
jest.mock('starknet', () => {
  const mockWaitForTransaction = jest.fn(async (hash: string) => {
    lastWaitForTxHash = hash
    return {}
  })

  const mockRpcProvider = jest.fn().mockImplementation(() => ({
    waitForTransaction: mockWaitForTransaction,
  }))

  const mockAccount = jest.fn().mockImplementation((_provider: unknown, _addr: string, _key: string) => ({
    waitForTransaction: mockWaitForTransaction,
  }))

  const mockContractInstance = {
    register: jest.fn(async (...args: unknown[]) => {
      lastRegisterArgs = args
      return { transaction_hash: '0xREGISTER_TX' }
    }),
    get_stealth_meta: jest.fn(async (...args: unknown[]) => {
      lastGetStealthMetaArgs = args
      // Return a tuple of 4 felt252 values
      return [
        BigInt('0x1111'), BigInt('0x2222'),
        BigInt('0x3333'), BigInt('0x4444'),
      ]
    }),
    commit_call: jest.fn(async (...args: unknown[]) => {
      lastCommitCallArgs = args
      return { transaction_hash: '0xCOMMIT_TX' }
    }),
    is_committed: jest.fn(async () => BigInt(1)),
  }

  const mockContract = jest.fn().mockImplementation(() => mockContractInstance)

  const num = {
    toHex: (n: bigint) => '0x' + n.toString(16),
  }

  // Minimal Stark curve mock for stealth-keys.ts which imports ec.starkCurve
  // Using a tiny weierstrass-like structure with known test values
  const STARK_ORDER = 2n ** 251n + 17n * 2n ** 192n + 976n + 1n
  const mockPoint = {
    x: 1n,
    y: 2n,
    multiply: (scalar: bigint) => ({ x: scalar % STARK_ORDER, y: (scalar + 1n) % STARK_ORDER }),
    fromAffine: ({ x, y }: { x: bigint; y: bigint }) => ({
      x, y,
      multiply: (scalar: bigint) => ({ x: scalar * x % STARK_ORDER, y: scalar * y % STARK_ORDER }),
    }),
  }
  const starkCurve = {
    CURVE: { n: STARK_ORDER },
    ProjectivePoint: {
      BASE: {
        multiply: (scalar: bigint) => ({ x: scalar % STARK_ORDER, y: (scalar + 1n) % STARK_ORDER }),
      },
      fromAffine: ({ x, y }: { x: bigint; y: bigint }) => ({
        x, y,
        multiply: (scalar: bigint) => ({ x: scalar * x % STARK_ORDER, y: scalar * y % STARK_ORDER }),
      }),
    },
    utils: {},
  }
  const ec = { starkCurve }

  return {
    RpcProvider: mockRpcProvider,
    Account: mockAccount,
    Contract: mockContract,
    num,
    ec,
  }
})

// suppress unused var
void 0

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

  test('constructs calldata with exactly 5 felt252 args', async () => {
    const kp = deriveStealthKeypair(sig)
    const txHash = await registerHandle('alice', kp)

    expect(txHash).toBe('0xREGISTER_TX')
    // register(handleHash, pkVx, pkVy, pkSx, pkSy) = 5 args
    expect(lastRegisterArgs).toHaveLength(5)
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

  test('correctly parses (felt252, felt252, felt252, felt252) return tuple', async () => {
    const meta = await lookupHandle('alice')
    expect(meta.pkVx).toBe(BigInt('0x1111'))
    expect(meta.pkVy).toBe(BigInt('0x2222'))
    expect(meta.pkSx).toBe(BigInt('0x3333'))
    expect(meta.pkSy).toBe(BigInt('0x4444'))
  })
})

describe('commitCall', () => {
  test('passes a single felt252 calldata arg', async () => {
    const commitment = 0x1234567890abcdefn
    const txHash = await commitCall(commitment)

    expect(txHash).toBe('0xCOMMIT_TX')
    expect(lastCommitCallArgs).toHaveLength(1)
    expect(typeof lastCommitCallArgs[0]).toBe('string')
    expect(lastCommitCallArgs[0] as string).toMatch(/^0x[0-9a-f]+$/i)
  })
})
