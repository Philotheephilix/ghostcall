/**
 * gen-strk20-json.ts
 *
 * Auto-generates strk20.json from environment variables + contracts/deployments.json.
 * Run:
 *   DEMO_VIDEO_URL="https://youtu.be/..." \
 *   TX_REGISTER="0x..." \
 *   TX_PAYMENT="0x..." \
 *   TX_COMMITCALL="0x..." \
 *   GITHUB_REPO="https://github.com/Philotheephilix/ghostcall" \
 *   npx ts-node scripts/gen-strk20-json.ts
 *
 * NOTE on STRK20 pool (TX_PAYMENT):
 *   The STRK20 privacy pool is on Starknet mainnet at
 *   0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a.
 *   The pool does not exist on Sepolia testnet. The TX_PAYMENT hash must come
 *   from a mainnet account interaction with the pool. See scripts/register-strk20-pool.ts
 *   for the registration + transfer script. Until TX_PAYMENT is set, the placeholder
 *   is left in the output file as a reminder.
 */

import { writeFileSync } from 'fs'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const deployments = require('../contracts/deployments.json')

const POOL_ADDRESS = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'

const transactions: string[] = []
if (process.env.TX_REGISTER) transactions.push(process.env.TX_REGISTER)
if (process.env.TX_PAYMENT) transactions.push(process.env.TX_PAYMENT)
if (process.env.TX_COMMITCALL) transactions.push(process.env.TX_COMMITCALL)

const submission = {
  name: 'GhostCall',
  description:
    'Trustless 1:1 audio calls on Starknet. Tor onion transport (no TURN server), ' +
    'stealth addresses (ERC-5564), Noise_XX encryption, STRK20 shielded payments. ' +
    'First Web3 calling app with genuine IP privacy.',
  demo_video: process.env.DEMO_VIDEO_URL ?? '',
  demo_url: process.env.GITHUB_REPO ?? 'https://github.com/Philotheephilix/ghostcall',
  transactions: transactions.length > 0
    ? transactions
    : [
        '0x_register_tx_hash_TODO',
        '0x_strk20_pool_payment_tx_hash_TODO',
        '0x_commit_call_tx_hash_TODO',
      ],
  contracts: [
    deployments.StealthRegistry.address as string,
    deployments.CallLog.address as string,
  ],
  pool_address: POOL_ADDRESS,
  stack: [
    'Cairo 2.x',
    'Starknet',
    'STRK20 SDK (@starkware-libs/starknet-privacy-sdk)',
    'Tor v3 onion services',
    'Noise_XX (X25519 + ChaCha20-Poly1305)',
    'Nostr NIP-44/NIP-59',
    'Opus (opusscript)',
    'Electron 32',
    'Next.js 14',
  ],
  repo: process.env.GITHUB_REPO ?? 'https://github.com/Philotheephilix/ghostcall',
  license: 'Apache-2.0',
  network: deployments.network as string,
  timestamp: new Date().toISOString(),
}

const outPath = 'strk20.json'
writeFileSync(outPath, JSON.stringify(submission, null, 2) + '\n')
console.log(`[gen-strk20-json] Written to ${outPath}`)
console.log(`  contracts: ${submission.contracts.join(', ')}`)
console.log(`  transactions (${submission.transactions.length}): ${submission.transactions.join(', ')}`)
if (submission.transactions.some(t => t.includes('TODO'))) {
  console.warn(
    '[gen-strk20-json] WARNING: One or more transaction hashes are placeholders.\n' +
    '  TX_PAYMENT requires a mainnet interaction with the STRK20 pool.\n' +
    '  Run scripts/register-strk20-pool.ts on mainnet to obtain TX_PAYMENT.'
  )
}
