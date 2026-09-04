import { RpcProvider, Account, Contract, num, hash, CallData, type ResourceBoundsBN } from 'starknet'

// OZ Cairo 1 (Sierra) account class hash — used for counterfactual address derivation
// and deployAccount. Must match the hash used in identity-manager.ts.
const OZ_ACCOUNT_CLASS_HASH = '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f'
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

// Conservative explicit fee details for Sepolia V3 transactions.
// Bypasses fee estimation (which requires ≥10 recent V3 txs in mempool —
// unreliable on sparse testnets). Values tuned for typical contract calls.
// Observed on live Sepolia V3 txs: execution uses l2_gas, DA uses l1_data_gas,
// l1_gas is 0. Tip 1 Gwei. Values set 10× above observed block prices.
const SEPOLIA_RESOURCE_BOUNDS: ResourceBoundsBN = {
  l1_gas: { max_amount: 0n, max_price_per_unit: 0x10000000000000n },
  l2_gas: { max_amount: 0x800000n, max_price_per_unit: 0x1000000000n }, // 8M — actual ~4.5M for register
  l1_data_gas: { max_amount: 0x1000n, max_price_per_unit: 0x10000000000n },
}
const SEPOLIA_TIP = 100_000_000_000n // 100 Gwei tip — needed to survive Sepolia mempool TTL

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
  // starknet.js v10: Account takes a single options object; `signer` accepts a
  // raw private-key string. (v7 took positional (provider, address, privKey).)
  _account = new Account({ provider: _provider, address: accountAddress, signer: privateKey })
}

export function getAccount(): Account {
  return requireAccount()
}

// starknet.js v10 Contract takes a single options object. All call-sites build
// one from a Sierra ABI, a deployed address, and either the account (writes) or
// the provider (view calls) — so centralise the construction here.
function makeContract(
  abi: unknown,
  address: string,
  providerOrAccount: Account | RpcProvider,
): Contract {
  return new Contract({ abi: abi as any, address, providerOrAccount })
}

/**
 * Deploys the OZ account if it is not yet deployed on-chain.
 * Safe to call when already deployed — skips the deploy in that case.
 * Throws if the account has insufficient funds for deployment gas.
 */
export async function deployAccountIfNeeded(): Promise<void> {
  const account = requireAccount()
  // Check if account already deployed by trying to fetch its class hash
  try {
    await requireProvider().getClassHashAt(account.address)
    return // already deployed
  } catch {
    // Contract not found — proceed with deploy
  }
  // The account's Stark public key. signer.getPubKey() already returns the
  // public key — do NOT pass it through ec.starkCurve.getStarkKey(), which
  // treats its argument as a PRIVATE key and re-derives, yielding a bogus value.
  // The address (identity-manager.deriveAddress) is computed from this exact
  // pubkey; salt + constructor calldata must use the same value or the deployed
  // account stores the wrong pubkey and every later tx fails __validate__ with
  // "Account: invalid signature".
  const pubKey = await account.signer.getPubKey()
  const constructorCalldata = CallData.compile({ publicKey: pubKey })
  const receipt = await account.deployAccount({
    classHash: OZ_ACCOUNT_CLASS_HASH,
    constructorCalldata,
    addressSalt: pubKey,
  })
  await requireProvider().waitForTransaction(receipt.transaction_hash)
  const deployReceipt = await requireProvider().getTransactionReceipt(receipt.transaction_hash)
  if ('execution_status' in deployReceipt && (deployReceipt as any).execution_status === 'REVERTED') {
    throw new Error(`Account deployment reverted: ${(deployReceipt as any).revert_reason ?? 'unknown'}`)
  }
}

/**
 * Registers stealth meta-address on-chain.
 * Sends a transaction to StealthRegistry.register().
 * Stores the full 32-byte Nostr pubkey across two felts: pk_nostr (low 31 bytes)
 * and pk_nostr_hi (high byte). Returns the transaction hash.
 */
export async function registerHandle(
  handle: string,
  kp: StealthKeypair
): Promise<string> {
  const handleHash = deriveHandleHash(handle)
  const account = requireAccount()
  const contract = makeContract(stealthRegistrySierra.abi, deployments.StealthRegistry.address, account)
  // Derive the full Nostr pubkey from the viewing key scalar. A felt252 holds
  // only ~251 bits, so the full 256-bit pk is split: routingPk = low 31 bytes
  // (fits felt252), and the high byte is stored separately in pk_nostr_hi so the
  // full 64-hex key can be reconstructed on lookup (needed for NIP-44 ECDH and
  // the relay #p filter). Both halves derive deterministically; callee agrees.
  const { pk, routingPk } = stealthToNostrKeypair(kp.skV)
  const nostrPkFelt = BigInt('0x' + routingPk)
  const nostrHiFelt = BigInt('0x' + pk.slice(0, pk.length - 62))
  const call = contract.populate('register', [
    num.toHex(handleHash),
    num.toHex(kp.pkV.x),
    num.toHex(kp.pkV.y),
    num.toHex(kp.pkS.x),
    num.toHex(kp.pkS.y),
    num.toHex(nostrPkFelt),
    num.toHex(nostrHiFelt),
  ])
  const res = await account.execute(call, { resourceBounds: SEPOLIA_RESOURCE_BOUNDS, tip: SEPOLIA_TIP })
  const receipt = await requireProvider().waitForTransaction(res.transaction_hash)
  if ('execution_status' in receipt && (receipt as any).execution_status === 'REVERTED') {
    throw new Error(`Transaction reverted: ${(receipt as any).revert_reason ?? 'unknown reason'}`)
  }
  return res.transaction_hash as string
}

/**
 * Looks up stealth meta-address for a handle.
 * Calls StealthRegistry.get_stealth_meta() (view).
 * Returns pkVx, pkVy, pkSx, pkSy, and nostrPubkey (full 64-hex string).
 */
export async function lookupHandle(handle: string): Promise<StealthMeta> {
  const handleHash = deriveHandleHash(handle)
  const contract = makeContract(stealthRegistrySierra.abi, deployments.StealthRegistry.address, requireProvider())
  const result = await contract.call('get_stealth_meta', [num.toHex(handleHash)], { blockIdentifier: 'latest' })
  // starknet.js v7 returns a Result object with numeric string keys '0'..'5'
  const r = result as Record<string | number, bigint>
  // Reconstruct the full 32-byte Nostr pubkey (64 hex) from its two felts:
  // pk_nostr = low 31 bytes (62 hex), pk_nostr_hi = high byte (2 hex).
  const lowHex = BigInt(r[4]).toString(16).padStart(62, '0')
  const hiHex = BigInt(r[5]).toString(16).padStart(2, '0')
  const nostrPubkey = hiHex + lowHex
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
  const account = requireAccount()
  const contract = makeContract(callLogSierra.abi, deployments.CallLog.address, account)
  const call = contract.populate('commit_call', [num.toHex(commitment)])
  const res = await account.execute(call, { resourceBounds: SEPOLIA_RESOURCE_BOUNDS, tip: SEPOLIA_TIP })
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
  const contract = makeContract(stealthRegistrySierra.abi, deployments.StealthRegistry.address, requireProvider())
  const result = await contract.call('is_registered', [num.toHex(handleHash)], { blockIdentifier: 'latest' })
  return Boolean(result)
}

/**
 * Checks if a commitment has been recorded on-chain.
 * Calls CallLog.is_committed() (view).
 */
export async function isCommitted(commitment: bigint): Promise<boolean> {
  const contract = makeContract(callLogSierra.abi, deployments.CallLog.address, requireProvider())
  const result = await contract.call('is_committed', [num.toHex(commitment)], { blockIdentifier: 'latest' })
  return Boolean(result)
}
