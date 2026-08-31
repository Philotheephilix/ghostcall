/**
 * STRK20 shielded payment — full SDK path with proper stealth address derivation.
 *
 * Flow:
 *   1. Derive recipient's one-time stealth address from their StealthMeta
 *      (ERC-5564-style ECDH on Stark curve: R=r·G, S=r·pkV, P=pkS+H(S.x)·G)
 *   2. Approve pool to pull STRK (separate tx — pool is reentrancy-guarded)
 *   3. Deposit + private transfer atomically via createPrivateTransfers
 *
 * The recipient's real wallet is never visible on-chain.
 */

import type { Account, RpcProvider as RpcProviderType } from 'starknet'
import type { StealthMeta } from './stealth-keys'

// STRK ERC-20 (same on Sepolia + Mainnet)
export const STRK_TOKEN = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

// Sepolia v2.0 pool address
const POOL_ADDRESS = process.env.STRK20_POOL_ADDRESS
  ?? '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91'
const PROVER_URL = process.env.STRK20_PROVER_URL ?? 'https://prover.strk20.starknet.io'
const DISCOVERY_URL = process.env.STRK20_DISCOVERY_URL ?? 'https://discovery.strk20.starknet.io'

// ── Stealth address derivation (ERC-5564 on Stark curve) ───────────────────

/**
 * Derive a one-time stealth address from the recipient's registered StealthMeta.
 *
 * Algorithm (Stark-curve ERC-5564):
 *   r  ← random scalar in [1, STARK_ORDER)
 *   R  = r·G                           (ephemeral pubkey — published with the note)
 *   S  = r·pkV                         (shared secret via ECDH with recipient viewing key)
 *   h  = HKDF-SHA256(S.x)
 *   P  = pkS + h·G                     (stealth spending pubkey)
 *   stealthAddr = OZ_counterfactual(P.x)
 *
 * Recipient can detect this note: they compute k·R = r·K_V = S, derive h, check P-h·G == pkS.
 */
export function deriveStealthAddress(meta: StealthMeta): {
  stealthAddr: string
  ephemeralPubX: bigint
  ephemeralPubY: bigint
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ProjectivePoint, CURVE } = require('@scure/starknet') as typeof import('@scure/starknet')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { hkdf } = require('@noble/hashes/hkdf.js') as { hkdf: (hash: unknown, ikm: Uint8Array, salt: undefined, info: Uint8Array, length: number) => Uint8Array }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sha256 } = require('@noble/hashes/sha2.js') as { sha256: unknown }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as typeof import('crypto')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { hash: starkHash, CallData } = require('starknet') as typeof import('starknet')

  const STARK_ORDER = CURVE.n

  // Random ephemeral scalar
  const rBytes = nodeCrypto.randomBytes(32)
  const r = (BigInt('0x' + rBytes.toString('hex')) % STARK_ORDER) || 1n

  // R = r·G (ephemeral pubkey)
  const R = ProjectivePoint.BASE.multiply(r)

  // S = r·pkV (shared secret)
  const pkV = ProjectivePoint.fromAffine({ x: meta.pkVx, y: meta.pkVy })
  const S = pkV.multiply(r)

  // h = HKDF(S.x)
  const sxBytes = (() => {
    const hex = S.x.toString(16).padStart(64, '0').slice(-64)
    return Uint8Array.from(Buffer.from(hex, 'hex'))
  })()
  const hBytes = hkdf(sha256, sxBytes, undefined, new TextEncoder().encode('ghostcall-stealth-v1'), 32)
  const h = (BigInt('0x' + Buffer.from(hBytes).toString('hex')) % STARK_ORDER) || 1n

  // P = pkS + h·G
  const pkS = ProjectivePoint.fromAffine({ x: meta.pkSx, y: meta.pkSy })
  const hG = ProjectivePoint.BASE.multiply(h)
  const P = pkS.add(hG)

  // Stealth address = OZ counterfactual address with P.x as the account pubkey
  const OZ_CLASS_HASH = '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f'
  const stealthPubKey = '0x' + P.x.toString(16).padStart(64, '0')
  const calldata = CallData.compile({ publicKey: stealthPubKey })
  const stealthAddr = starkHash.calculateContractAddressFromHash(stealthPubKey, OZ_CLASS_HASH, calldata, 0)

  return { stealthAddr, ephemeralPubX: R.x, ephemeralPubY: R.y }
}

// ── Pool registration ──────────────────────────────────────────────────────

async function ensurePoolRegistered(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transfers: any,
  provider: RpcProviderType,
  account: Account,
): Promise<void> {
  try {
    const blockNumber = await provider.getBlockNumber()
    const provingBlockId = blockNumber - 10

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { callAndProof } = await (transfers as any).build().register().execute({ provingBlockId })
    const proofDetails = callAndProof.proof.proofFacts?.length
      ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
      : {}
    const tx = await account.execute(callAndProof.call, { tip: 0n, ...proofDetails })
    await provider.waitForTransaction(tx.transaction_hash)
    console.log('[STRK20] Registered in pool:', tx.transaction_hash)
  } catch (e: unknown) {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
    if (msg.includes('already') || msg.includes('viewing key') || msg.includes('registered')) return
    throw e
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

/**
 * Send a shielded STRK payment to a recipient's stealth address via the STRK20 pool.
 *
 * @param recipientMeta  Recipient's StealthMeta (from starknet:lookup). Falls back to
 *                       plain transfer if a legacy string address is passed.
 * @param amountStrk     Amount in STRK base units (1 STRK = 10^18)
 * @param account        Sender's starknet.js Account
 * @param viewingKey     Sender's private viewing key scalar (bigint)
 */
export async function sendShieldedPayment(
  recipientMeta: StealthMeta | string,
  amountStrk: bigint,
  account: Account,
  viewingKey: bigint,
): Promise<string> {
  if (typeof recipientMeta === 'string') {
    console.warn('[STRK20] Plain address passed — using direct transfer.')
    return _sendFallback(recipientMeta, amountStrk, account)
  }

  // Derive one-time stealth address locally (no external service needed).
  const { stealthAddr } = deriveStealthAddress(recipientMeta)
  console.log('[STRK20] Recipient stealth address:', stealthAddr)

  // Attempt full pool-based shielded transfer via the privacy SDK.
  // Falls back to a direct stealth-address transfer when the prover/discovery
  // service is unreachable (fetch failed, CORS, or service not deployed yet).
  try {
    const { createPrivateTransfers } = await import('@starkware-libs/starknet-privacy-sdk')
    const { RpcProvider, constants } = await import('starknet')

    const rpcUrl = process.env.STARKNET_RPC_URL ?? 'https://starknet-sepolia-rpc.publicnode.com'
    const provider = new RpcProvider({ nodeUrl: rpcUrl, blockIdentifier: 'latest' })

    const chainId = await provider.getChainId()
    const sdkChainId = chainId === constants.StarknetChainId.SN_MAIN
      ? constants.StarknetChainId.SN_MAIN
      : constants.StarknetChainId.SN_SEPOLIA

    const transfers = createPrivateTransfers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      account: account as any,
      viewingKeyProvider: { getViewingKey: async () => viewingKey },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provingProvider: { url: PROVER_URL, chainId: sdkChainId as any },
      discoveryProvider: { url: DISCOVERY_URL },
      poolContractAddress: POOL_ADDRESS,
    })

    await ensurePoolRegistered(transfers as any, provider, account)

    const approveTx = await account.execute(
      { contractAddress: STRK_TOKEN, entrypoint: 'approve', calldata: [POOL_ADDRESS, amountStrk.toString(), '0'] },
      { tip: 0n },
    )
    await provider.waitForTransaction(approveTx.transaction_hash)
    console.log('[STRK20] Approved:', approveTx.transaction_hash)

    const approvalReceipt = await provider.getTransactionReceipt(approveTx.transaction_hash) as any
    const approvalBlock: number = approvalReceipt.block_number ?? 0
    let latestBlock = await provider.getBlockNumber()
    while (latestBlock - 10 <= approvalBlock) {
      await new Promise(r => setTimeout(r, 5000))
      latestBlock = await provider.getBlockNumber()
    }
    const provingBlockId = latestBlock - 10

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { callAndProof } = await (transfers as any)
      .build({ autoSetup: true, autoRegister: true })
      .surplusTo(account.address)
      .with(STRK_TOKEN, (t: any) =>
        t.deposit({ amount: amountStrk })
         .transfer({ recipient: stealthAddr, amount: amountStrk })
      )
      .execute({ provingBlockId })

    const proofDetails = callAndProof.proof.proofFacts?.length
      ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
      : {}

    const tx = await account.execute(callAndProof.call, { tip: 0n, ...proofDetails })
    await provider.waitForTransaction(tx.transaction_hash)
    console.log('[STRK20] Shielded payment:', tx.transaction_hash, '→ stealth:', stealthAddr)
    return tx.transaction_hash as string

  } catch (e: unknown) {
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase()
    // Rethrow non-network errors (reverted tx, bad calldata, etc.)
    if (!msg.includes('fetch') && !msg.includes('network') && !msg.includes('econnrefused')
        && !msg.includes('failed to fetch') && !msg.includes('enotfound')) {
      throw e
    }
    // Pool/prover unreachable — fall back to direct transfer to the derived stealth address.
    // The recipient's real wallet is still hidden (only the ephemeral stealth address appears
    // on-chain), but the mixer/unlinkability guarantee of the pool is absent.
    console.warn('[STRK20] Prover/pool unreachable, falling back to direct stealth transfer:', msg)
    return _sendFallback(stealthAddr, amountStrk, account)
  }
}

// Fallback: plain STRK ERC-20 transfer (not shielded)
async function _sendFallback(toAddr: string, amountStrk: bigint, account: Account): Promise<string> {
  const amountLow = (amountStrk & ((1n << 128n) - 1n)).toString()
  const amountHigh = (amountStrk >> 128n).toString()
  const res = await account.execute([
    { contractAddress: STRK_TOKEN, entrypoint: 'transfer', calldata: [toAddr, amountLow, amountHigh] },
  ])
  // v10: waitForTransaction lives on the provider, not Account
  await account.provider.waitForTransaction(res.transaction_hash)
  return res.transaction_hash as string
}
