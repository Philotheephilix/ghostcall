/**
 * Live test: NIP-44/NIP-59 gift-wrap roundtrip via wss://relay.damus.io
 *
 * Validates the PRIVATE key derivation path:
 * - Bob's Nostr pubkey = stealthToNostrKeypair(bobSkV).pk  (private, mirrors pk_nostr in registry)
 * - Alice addresses gift-wrap to this pubkey (as retrieved from StealthRegistry in production)
 * - Bob decrypts using stealthToNostrKeypair(bobSkV).sk    (private, mirrors parseCallOffer)
 */

import {
  buildCallOffer,
  parseCallOffer,
  publishToRelay,
  subscribeIncoming,
  stealthToNostrKeypair,
  CallSignalPayload,
} from '../renderer/lib/nostr-signal'
import { CURVE } from '@scure/starknet'

const RELAY = process.env.NOSTR_RELAY_URL || 'wss://relay.primal.net'
const TIMEOUT_MS = 20_000

// ─── helpers ───────────────────────────────────────────────────────────────

function randomStarkSkV(): bigint {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  const raw = BigInt('0x' + Buffer.from(arr).toString('hex'))
  const n = raw % CURVE.n
  return n === 0n ? 1n : n
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GhostCall Nostr Live Test ===')
  console.log(`Relay: ${RELAY}`)

  // Step 1: Generate ephemeral Stark scalars (private viewing keys)
  const aliceSkV = randomStarkSkV()
  const bobSkV = randomStarkSkV()

  // Step 2: Derive Bob's Nostr pubkey from his PRIVATE skV
  // In production, this is retrieved from StealthRegistry.pk_nostr
  // Never derived from the public pkV.x (which would be a privacy leak)
  const { pk: bobNostrPk } = stealthToNostrKeypair(bobSkV)
  console.log(`Bob nostr pubkey: ${bobNostrPk.slice(0, 16)}...`)

  // Dummy calleePkV (not used for routing since we pass calleeNostrPk explicitly)
  const calleePkV = { x: 1n, y: 1n }

  // Step 3: Subscribe Bob using his Nostr pubkey
  const received = await new Promise<string>((resolveMsg, rejectMsg) => {
    const timer = setTimeout(() => {
      close()
      rejectMsg(new Error(`Timeout: no event received within ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    const close = subscribeIncoming(RELAY, bobNostrPk, (raw) => {
      clearTimeout(timer)
      close()
      resolveMsg(raw)
    })

    // Step 4 & 5: Build and publish — run async after subscription is open
    setTimeout(async () => {
      try {
        const payload: CallSignalPayload = {
          onionAddr: 'test123abc.onion:7331',
          callId: '0xdeadbeef',
          callerNoisePubkey: '0xcafebabe',
        }
        console.log('Building call offer (private Nostr routing)...')
        // Pass bobNostrPk explicitly — the production path (from StealthRegistry.pk_nostr)
        const eventJson = await buildCallOffer(aliceSkV, calleePkV, payload, bobNostrPk)
        console.log('Publishing to relay...')
        await publishToRelay(RELAY, eventJson)
        console.log('Published. Waiting for Bob to receive...')
      } catch (err) {
        clearTimeout(timer)
        rejectMsg(err)
      }
    }, 500)
  })

  // Step 6: Parse
  console.log('Event received. Parsing...')
  const parsed = await parseCallOffer(received, bobSkV)

  if (!parsed) {
    throw new Error('parseCallOffer returned null — decryption failed')
  }

  // Step 7: Assert
  const expected: CallSignalPayload = {
    onionAddr: 'test123abc.onion:7331',
    callId: '0xdeadbeef',
    callerNoisePubkey: '0xcafebabe',
  }

  if (parsed.onionAddr !== expected.onionAddr) {
    throw new Error(`onionAddr mismatch: got "${parsed.onionAddr}", want "${expected.onionAddr}"`)
  }
  if (parsed.callId !== expected.callId) {
    throw new Error(`callId mismatch: got "${parsed.callId}", want "${expected.callId}"`)
  }
  if (parsed.callerNoisePubkey !== expected.callerNoisePubkey) {
    throw new Error(
      `callerNoisePubkey mismatch: got "${parsed.callerNoisePubkey}", want "${expected.callerNoisePubkey}"`,
    )
  }

  console.log('NOSTR LIVE TEST PASSED')
}

main().catch((err) => {
  console.error('LIVE TEST FAILED:', err)
  process.exit(1)
})
