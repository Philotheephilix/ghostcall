import { RpcProvider, Account, Contract, num } from 'starknet'
import type { StealthKeypair, StealthMeta } from './stealth-keys'
import { deriveHandleHash } from './stealth-keys'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stealthRegistrySierra = require('../../contracts/target/dev/ghostcall_contracts_StealthRegistry.contract_class.json')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const callLogSierra = require('../../contracts/target/dev/ghostcall_contracts_CallLog.contract_class.json')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deployments = require('../../contracts/deployments.json')

// Initialized once with wallet credentials (from IPC bridge in production,
// directly from env in scripts/live tests)
let _provider: RpcProvider
let _account: Account

export function initStarknetClient(
  rpcUrl: string,
  accountAddress: string,
  privateKey: string
): void {
  _provider = new RpcProvider({ nodeUrl: rpcUrl })
  _account = new Account(_provider, accountAddress, privateKey)
}

export function getProvider(): RpcProvider {
  return _provider
}

export function getAccount(): Account {
  return _account
}

/**
 * Registers stealth meta-address on-chain.
 * Sends a transaction to StealthRegistry.register().
 * Returns the transaction hash.
 */
export async function registerHandle(
  handle: string,
  kp: StealthKeypair
): Promise<string> {
  const handleHash = deriveHandleHash(handle)
  const contract = new Contract(
    stealthRegistrySierra.abi,
    deployments.StealthRegistry.address,
    _account
  )
  const res = await contract.register(
    num.toHex(handleHash),
    num.toHex(kp.pkV.x),
    num.toHex(kp.pkV.y),
    num.toHex(kp.pkS.x),
    num.toHex(kp.pkS.y)
  )
  await _provider.waitForTransaction(res.transaction_hash)
  return res.transaction_hash as string
}

/**
 * Looks up stealth meta-address for a handle.
 * Calls StealthRegistry.get_stealth_meta() (view).
 */
export async function lookupHandle(handle: string): Promise<StealthMeta> {
  const handleHash = deriveHandleHash(handle)
  const contract = new Contract(
    stealthRegistrySierra.abi,
    deployments.StealthRegistry.address,
    _provider
  )
  const result = await contract.get_stealth_meta(num.toHex(handleHash))
  // starknet.js v7 returns a Result object with numeric string keys '0','1','2','3'
  // (not a true array), so index explicitly rather than destructuring
  const r = result as Record<string | number, bigint>
  return {
    pkVx: BigInt(r[0]),
    pkVy: BigInt(r[1]),
    pkSx: BigInt(r[2]),
    pkSy: BigInt(r[3]),
  }
}

/**
 * Commits a call receipt hash on-chain.
 * Sends a transaction to CallLog.commit_call().
 * Returns the transaction hash.
 */
export async function commitCall(commitment: bigint): Promise<string> {
  const contract = new Contract(
    callLogSierra.abi,
    deployments.CallLog.address,
    _account
  )
  const res = await contract.commit_call(num.toHex(commitment))
  await _provider.waitForTransaction(res.transaction_hash)
  return res.transaction_hash as string
}

/**
 * Checks if a handle is already registered on-chain.
 * Calls StealthRegistry.is_registered() (view).
 */
export async function isRegistered(handle: string): Promise<boolean> {
  const handleHash = deriveHandleHash(handle)
  const contract = new Contract(
    stealthRegistrySierra.abi,
    deployments.StealthRegistry.address,
    _provider
  )
  const result = await contract.is_registered(num.toHex(handleHash))
  return Boolean(result)
}

/**
 * Checks if a commitment has been recorded on-chain.
 * Calls CallLog.is_committed() (view).
 */
export async function isCommitted(commitment: bigint): Promise<boolean> {
  const contract = new Contract(
    callLogSierra.abi,
    deployments.CallLog.address,
    _provider
  )
  const result = await contract.is_committed(num.toHex(commitment))
  return Boolean(result)
}
