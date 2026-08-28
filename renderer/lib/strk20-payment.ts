/**
 * STRK20 shielded payment wrapper.
 *
 * When @starkware-libs/starknet-privacy-sdk is installed (requires GitHub Packages
 * auth), uses the full SDK path: createPrivateTransfers → privateTransfer → execute.
 *
 * When the SDK is NOT installed (e.g. Sepolia testnet dev environment), falls back
 * to a standard STRK ERC-20 transfer so the app remains functional. A clear
 * console.warn is emitted so the fallback is never silent.
 *
 * The STRK20 pool is on Starknet mainnet; the SDK path targets mainnet.
 * The fallback targets whatever network the account is connected to.
 */

import type { Account } from 'starknet'

// STRK ERC-20 token address (same on Sepolia + mainnet for STRK native token)
export const STRK_TOKEN = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

const POOL_ADDRESS = process.env.STRK20_POOL_ADDRESS ?? '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const PROVER_URL = process.env.STRK20_PROVER_URL ?? 'https://prover.strk20.starknet.io'
const DISCOVERY_URL = process.env.STRK20_DISCOVERY_URL ?? 'https://discovery.strk20.starknet.io'

// Detect SDK availability at module load time (avoids repeated require() calls).
// The state variable is module-private; use _setSdkAvailable() in tests only.
let _sdkAvailable: boolean | null = null

/** @internal — for unit tests only. Do NOT call in production code. */
export function _setSdkAvailable(value: boolean | null): void {
  _sdkAvailable = value
}

function isSdkAvailable(): boolean {
  if (_sdkAvailable !== null) return _sdkAvailable
  try {
    // Try an actual require to test if the package loads (catches both
    // "module not found" and "module throws on load" situations).
    require('@starkware-libs/starknet-privacy-sdk')
    _sdkAvailable = true
  } catch {
    _sdkAvailable = false
  }
  return _sdkAvailable
}

/**
 * Send a shielded STRK payment to a stealth address.
 *
 * @param toStealthAddr  Recipient stealth address (hex felt252 string)
 * @param amountStrk     Amount in STRK base units (1 STRK = 10^18)
 * @param account        Starknet.js Account (initiator, must be funded)
 * @param viewingKey     Caller's viewing key scalar (bigint)
 * @returns              Transaction hash (hex string)
 */
export async function sendShieldedPayment(
  toStealthAddr: string,
  amountStrk: bigint,
  account: Account,
  viewingKey: bigint,
): Promise<string> {
  if (isSdkAvailable()) {
    return _sendViaSDK(toStealthAddr, amountStrk, account, viewingKey)
  }
  console.warn(
    '[GhostCall] @starkware-libs/starknet-privacy-sdk not installed. ' +
    'Falling back to standard (non-shielded) STRK transfer. ' +
    'To enable shielded payments: npm config set @starkware-libs:registry ' +
    'https://npm.pkg.github.com && npm install @starkware-libs/starknet-privacy-sdk'
  )
  return _sendFallback(toStealthAddr, amountStrk, account)
}

// ---------- SDK path ----------

async function _sendViaSDK(
  toStealthAddr: string,
  amountStrk: bigint,
  account: Account,
  viewingKey: bigint,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createPrivateTransfers } = require('@starkware-libs/starknet-privacy-sdk')

  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: { url: PROVER_URL, chainId: 'SN_MAIN' },
    discoveryProvider: { url: DISCOVERY_URL },
    poolContractAddress: POOL_ADDRESS,
  })

  // Ensure pool registration (idempotent — re-registration is a no-op on-chain)
  await _ensurePoolRegistered(transfers, account)

  const latestBlock = await account.getBlock('latest')
  const { callAndProof } = await transfers
    .build()
    .privateTransfer({ to: toStealthAddr, amount: amountStrk })
    .execute({ provingBlockId: latestBlock.block_hash })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await account.execute(callAndProof.call as any)
  await account.waitForTransaction(res.transaction_hash)
  return res.transaction_hash as string
}

async function _ensurePoolRegistered(transfers: { build: () => { register: () => { execute: (opts: { provingBlockId: string }) => Promise<{ callAndProof: { call: unknown } }> } } }, account: Account): Promise<void> {
  try {
    const latestBlock = await account.getBlock('latest')
    const { callAndProof } = await transfers
      .build()
      .register()
      .execute({ provingBlockId: latestBlock.block_hash })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await account.execute(callAndProof.call as any)
    await account.waitForTransaction(res.transaction_hash)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    // 'already registered' or equivalent from prover — safe to ignore
    if (!msg.includes('already registered') && !msg.includes('AlreadyRegistered')) {
      throw e
    }
  }
}

// ---------- Fallback path (standard ERC-20 transfer) ----------

async function _sendFallback(
  toStealthAddr: string,
  amountStrk: bigint,
  account: Account,
): Promise<string> {
  // ERC-20 transfer calldata: [to, amount_low, amount_high]
  // amount is u256 (low128, high128)
  const amountLow = (amountStrk & ((1n << 128n) - 1n)).toString()
  const amountHigh = (amountStrk >> 128n).toString()

  const res = await account.execute([
    {
      contractAddress: STRK_TOKEN,
      entrypoint: 'transfer',
      calldata: [toStealthAddr, amountLow, amountHigh],
    },
  ])
  await account.waitForTransaction(res.transaction_hash)
  return res.transaction_hash as string
}
