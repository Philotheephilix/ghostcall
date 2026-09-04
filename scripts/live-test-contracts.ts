/**
 * Live integration test against deployed Sepolia contracts.
 * Run: npx tsx scripts/live-test-contracts.ts
 *
 * Requires .env with:
 *   STARKNET_RPC_URL, STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.join(__dirname, '..', '.env') })

import {
  initStarknetClient,
  registerHandle,
  lookupHandle,
  commitCall,
  isCommitted,
  isRegistered,
} from '../renderer/lib/starknet-client'
import { deriveStealthKeypair } from '../renderer/lib/stealth-keys'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}

async function main(): Promise<void> {
  // Step 1: Init client from .env
  const rpcUrl = process.env.STARKNET_RPC_URL
  const accountAddress = process.env.STARKNET_ACCOUNT_ADDRESS
  const privateKey = process.env.STARKNET_PRIVATE_KEY

  if (!rpcUrl || !accountAddress || !privateKey) {
    throw new Error('Missing env vars: STARKNET_RPC_URL, STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY')
  }

  console.log('[1] Initializing Starknet client...')
  initStarknetClient(rpcUrl, accountAddress, privateKey)
  console.log('    RPC URL:', rpcUrl)
  console.log('    Account:', accountAddress)

  // Step 2: Derive keypair from deterministic test sig
  console.log('\n[2] Deriving stealth keypair from test sig { r: 0xdeadbeef, s: 0xcafebabe }...')
  const testSig = { r: 0xdeadbeefn, s: 0xcafebaben }
  const kp = deriveStealthKeypair(testSig)
  console.log('    skV:', kp.skV.toString(16))
  console.log('    pkV.x:', kp.pkV.x.toString(16))
  console.log('    pkV.y:', kp.pkV.y.toString(16))
  console.log('    pkS.x:', kp.pkS.x.toString(16))
  console.log('    pkS.y:', kp.pkS.y.toString(16))

  // Step 3: Register handle (idempotent — skip if already registered)
  const testHandle = 'ghostcall-live-test-001'
  let registerTxHash = '(already-registered-from-prior-run)'

  console.log(`\n[3] Checking registration status for "${testHandle}"...`)
  const alreadyRegistered = await isRegistered(testHandle)
  if (alreadyRegistered) {
    console.log('    Handle already registered — skipping re-registration.')
  } else {
    console.log(`    Registering handle "${testHandle}"...`)
    registerTxHash = await registerHandle(testHandle, kp)
    console.log('    TX hash:', registerTxHash)
  }

  // Step 4: Wait 3s then lookup — assert pubkeys match
  console.log('\n[4] Waiting 3s then looking up handle...')
  await sleep(3000)
  const meta = await lookupHandle(testHandle)
  console.log('    Looked up pkVx:', meta.pkVx.toString(16))
  console.log('    Looked up pkVy:', meta.pkVy.toString(16))
  console.log('    Looked up pkSx:', meta.pkSx.toString(16))
  console.log('    Looked up pkSy:', meta.pkSy.toString(16))
  console.log('    Looked up nostrPubkey:', meta.nostrPubkey)

  assert(meta.pkVx === kp.pkV.x, `pkVx mismatch: got ${meta.pkVx.toString(16)}, expected ${kp.pkV.x.toString(16)}`)
  assert(meta.pkVy === kp.pkV.y, `pkVy mismatch: got ${meta.pkVy.toString(16)}, expected ${kp.pkV.y.toString(16)}`)
  assert(meta.pkSx === kp.pkS.x, `pkSx mismatch: got ${meta.pkSx.toString(16)}, expected ${kp.pkS.x.toString(16)}`)
  assert(meta.pkSy === kp.pkS.y, `pkSy mismatch: got ${meta.pkSy.toString(16)}, expected ${kp.pkS.y.toString(16)}`)
  // nostrPubkey is full 64 hex chars (32-byte secp256k1 pubkey: 1-byte hi + 31-byte low stored as pk_nostr_hi + routingPk)
  assert(meta.nostrPubkey.length === 64, `nostrPubkey should be 64 hex chars, got ${meta.nostrPubkey.length}`)
  console.log('    All pubkey components match (including nostrPubkey).')

  // Step 5: Commit a test call (idempotent — skip if already committed)
  const commitment = 0x1234567890abcdef1234567890abcdef12345678n
  let commitTxHash = '(already-committed-from-prior-run)'

  console.log(`\n[5] Checking if commitment 0x${commitment.toString(16)} is already on-chain...`)
  const alreadyCommitted = await isCommitted(commitment)
  if (alreadyCommitted) {
    console.log('    Already committed — skipping.')
  } else {
    console.log(`    Committing...`)
    commitTxHash = await commitCall(commitment)
    console.log('    TX hash:', commitTxHash)
  }

  // Step 6: Wait 3s then check is_committed — assert true
  console.log('\n[6] Waiting 3s then checking is_committed...')
  await sleep(3000)
  const committed = await isCommitted(commitment)
  console.log('    is_committed:', committed)
  assert(committed === true, `is_committed returned false, expected true`)

  console.log('\nALL LIVE TESTS PASSED')
  console.log(`  Register TX: ${registerTxHash}`)
  console.log(`  Commit TX:   ${commitTxHash}`)
}

main().catch((err) => {
  console.error('\n✗ LIVE TEST FAILED:', err.message ?? err)
  process.exit(1)
})
