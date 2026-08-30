import { RpcProvider, Account, Contract, num } from 'starknet'
import type { StealthKeypair, StealthMeta } from './stealth-keys'
import { deriveHandleHash } from './stealth-keys'
import { stealthToNostrKeypair } from './nostr-signal'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stealthRegistrySierra = require('../../contracts/target/dev/ghostcall_contracts_StealthRegistry.contract_class.json')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const callLogSierra = require('../../contracts/target/dev/ghostcall_contracts_CallLog.contract_class.json')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const deployments = require('../../contracts/deployments.json')

// Initialized once with wallet credentials (from IPC bridge in production,
// directly from env in scripts/live tests)
let _provider: RpcProvider | undefined
let _account: Account | undefined

function requireProvider(): RpcProvider {
  if (!_provider) throw new Error('Starknet client not initialized — call initStarknetClient first')
  return _provider
}

function requireAccount(): Account {
  if (!_account) throw new Error('Starknet client not initialized — call initStarknetClient first')
  return _account
}

export function initStarknetClient(
  rpcUrl: string,
  accountAddress: string,
  privateKey: string
): void {
  // blockIdentifier: 'latest' — many public nodes don't support 'pending'
  _provider = new RpcProvider({ nodeUrl: rpcUrl, blockIdentifier: 'latest' })
  _account = new Account(_provider, accountAddress, privateKey)
}

export function getAccount(): Account {
  return requireAccount()
}

/**
 * Registers stealth meta-address on-chain.
 * Sends a transaction to StealthRegistry.register().
 * Includes pk_nostr = stealthToNostrKeypair(skV).pk as a felt252.
 * Returns the transaction hash.
 */
export async function registerHandle(
  handle: string,
  kp: StealthKeypair
): Promise<string> {
  const handleHash = deriveHandleHash(handle)
  const account = requireAccount()
  const contract = new Contract(
    stealthRegistrySierra.abi,
    deployments.StealthRegistry.address,
    account
  )
  // Derive the Nostr routing pubkey from the viewing key scalar.
  // routingPk is 31-byte (248-bit) truncated pubkey, guaranteed to fit felt252.
  const { routingPk } = stealthToNostrKeypair(kp.skV)
  const nostrPkFelt = BigInt('0x' + routingPk)
  const res = await contract.register(
    num.toHex(handleHash),
    num.toHex(kp.pkV.x),
    num.toHex(kp.pkV.y),
    num.toHex(kp.pkS.x),
    num.toHex(kp.pkS.y),
    num.toHex(nostrPkFelt)
  )
  const receipt = await requireProvider().waitForTransaction(res.transaction_hash)
  if ('execution_status' in receipt && (receipt as any).execution_status === 'REVERTED') {
    throw new Error(`Transaction reverted: ${(receipt as any).revert_reason ?? 'unknown reason'}`)
  }
  return res.transaction_hash as string
}

/**
 * Looks up stealth meta-address for a handle.
 * Calls StealthRegistry.get_stealth_meta() (view).
 * Returns pkVx, pkVy, pkSx, pkSy, and nostrPubkey (hex string).
 */
export async function lookupHandle(handle: string): Promise<StealthMeta> {
  const handleHash = deriveHandleHash(handle)
  const contract = new Contract(
    stealthRegistrySierra.abi,
    deployments.StealthRegistry.address,
    requireProvider()
  )
  const result = await contract.call('get_stealth_meta', [num.toHex(handleHash)], { blockIdentifier: 'latest' })
  // starknet.js v7 returns a Result object with numeric string keys '0'..'4'
  const r = result as Record<string | number, bigint>
  // pk_nostr is stored as felt252; convert back to 32-byte hex pubkey string
  const nostrFelt = BigInt(r[4])
  // routingPk is stored as 31-byte (62 hex char) felt252 — match stealthToNostrKeypair().routingPk
  const nostrPubkey = nostrFelt.toString(16).padStart(62, '0')
  return {
    pkVx: BigInt(r[0]),
    pkVy: BigInt(r[1]),
    pkSx: BigInt(r[2]),
    pkSy: BigInt(r[3]),
    nostrPubkey,
  }
}

/**
 * Commits a call receipt hash on-chain.
 * Sends a transaction to CallLog.commit_call().
 * Returns the transaction hash.
 */
export async function commitCall(callId: string | bigint): Promise<string> {
  const commitment = typeof callId === 'string' ? BigInt(callId) : callId
  const contract = new Contract(
    callLogSierra.abi,
    deployments.CallLog.address,
    requireAccount()
  )
  const res = await contract.commit_call(num.toHex(commitment))
  const receipt = await requireProvider().waitForTransaction(res.transaction_hash)
  if ('execution_status' in receipt && (receipt as any).execution_status === 'REVERTED') {
    throw new Error(`Transaction reverted: ${(receipt as any).revert_reason ?? 'unknown reason'}`)
  }
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
    requireProvider()
  )
  const result = await contract.call('is_registered', [num.toHex(handleHash)], { blockIdentifier: 'latest' })
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
    requireProvider()
  )
  const result = await contract.call('is_committed', [num.toHex(commitment)], { blockIdentifier: 'latest' })
  return Boolean(result)
}
