/**
 * register-strk20-pool.ts
 *
 * Registers the caller's Starknet account with the STRK20 privacy pool
 * and optionally performs a test private transfer to a stealth address.
 * Captures and prints the transaction hashes needed for strk20.json.
 *
 * IMPORTANT: The STRK20 pool is on Starknet MAINNET only.
 * This script targets mainnet. You need a funded mainnet account.
 *
 * Usage:
 *   STARKNET_RPC_URL=https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY \
 *   STARKNET_ACCOUNT_ADDRESS=0x... \
 *   STARKNET_PRIVATE_KEY=0x... \
 *   STRK20_PROVER_URL=https://prover.strk20.starknet.io \
 *   STRK20_DISCOVERY_URL=https://discovery.strk20.starknet.io \
 *   npx ts-node scripts/register-strk20-pool.ts
 *
 * Prerequisites:
 *   npm config set @starkware-libs:registry https://npm.pkg.github.com
 *   npm config set //npm.pkg.github.com/:_authToken YOUR_GITHUB_PAT
 *   npm install @starkware-libs/starknet-privacy-sdk
 */

import * as dotenv from 'dotenv'
dotenv.config()

const POOL_ADDRESS = process.env.STRK20_POOL_ADDRESS
  ?? '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const PROVER_URL = process.env.STRK20_PROVER_URL ?? 'https://prover.strk20.starknet.io'
const DISCOVERY_URL = process.env.STRK20_DISCOVERY_URL ?? 'https://discovery.strk20.starknet.io'

async function main() {
  const rpcUrl = process.env.STARKNET_RPC_URL
  const accountAddress = process.env.STARKNET_ACCOUNT_ADDRESS
  const privateKey = process.env.STARKNET_PRIVATE_KEY

  if (!rpcUrl || !accountAddress || !privateKey) {
    console.error('Missing env vars: STARKNET_RPC_URL, STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY')
    process.exit(1)
  }

  let createPrivateTransfers: (opts: Record<string, unknown>) => unknown
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ;({ createPrivateTransfers } = require('@starkware-libs/starknet-privacy-sdk'))
  } catch {
    console.error(
      'ERROR: @starkware-libs/starknet-privacy-sdk is not installed.\n' +
      'Install it with GitHub Packages auth:\n' +
      '  npm config set @starkware-libs:registry https://npm.pkg.github.com\n' +
      '  npm config set //npm.pkg.github.com/:_authToken YOUR_GITHUB_PAT\n' +
      '  npm install @starkware-libs/starknet-privacy-sdk'
    )
    process.exit(1)
  }

  const { RpcProvider, Account } = await import('starknet')

  const provider = new RpcProvider({ nodeUrl: rpcUrl })
  const account = new Account({ provider, address: accountAddress, signer: privateKey })

  console.log('[register-strk20-pool] Account:', accountAddress)
  console.log('[register-strk20-pool] Pool:', POOL_ADDRESS)
  console.log('[register-strk20-pool] Network: MAINNET (ensure your account is funded)')

  const viewingKey = BigInt(privateKey) // production: derive from wallet signature
  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: { url: PROVER_URL, chainId: 'SN_MAIN' },
    discoveryProvider: { url: DISCOVERY_URL },
    poolContractAddress: POOL_ADDRESS,
  }) as { build: () => { register: () => { execute: (opts: { provingBlockId: string }) => Promise<{ callAndProof: { call: unknown } }> } } }

  console.log('[register-strk20-pool] Step 1: Registering with pool…')
  const latestBlock = await provider.getBlock('latest')
  const { callAndProof: regProof } = await transfers
    .build()
    .register()
    .execute({ provingBlockId: latestBlock.block_hash })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const regRes = await account.execute(regProof.call as any)
  await provider.waitForTransaction(regRes.transaction_hash)
  console.log('[register-strk20-pool] Registration TX:', regRes.transaction_hash)
  console.log('  → Add this as TX_REGISTER in gen-strk20-json.ts')

  console.log('\n[register-strk20-pool] Done.')
  console.log('Add these to strk20.json "transactions" array:')
  console.log('  TX_REGISTER =', regRes.transaction_hash)
  console.log('\nTo run a private transfer (TX_PAYMENT), call sendShieldedPayment() from the app.')
}

main().catch((err) => {
  console.error('[register-strk20-pool] Fatal:', err)
  process.exit(1)
})
