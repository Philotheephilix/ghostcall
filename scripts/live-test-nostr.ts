/**
 * Live test: NIP-44/NIP-59 gift-wrap roundtrip via wss://relay.damus.io
 *
 * 1. Generate random Alice and Bob ephemeral Stark scalars
 * 2. Derive Bob's nostr pubkey (via stealthToNostrKeypair(pkV.x))
 * 3. Subscribe Bob to relay
 * 4. Alice builds a call offer for Bob and publishes to relay
 * 5. Wait up to 15s for Bob's subscription to receive the event
 * 6. Parse with Bob's skV and assert payload matches
 */

import {
  buildCallOffer,
  parseCallOffer,
  publishToRelay,
  subscribeIncoming,
  stealthToNostrKeypair,
  CallSignalPayload,
} from '../renderer/lib/nostr-signal'
import { ProjectivePoint as StarkPoint, CURVE } from '@scure/starknet'

const RELAY = 'wss://relay.damus.io'
const TIMEOUT_MS = 15_000

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

  // Step 1: Generate ephemeral keys
  const aliceSkV = randomStarkSkV()
  const bobSkV = randomStarkSkV()

  // Step 2: Derive Bob's nostr pubkey
  const bobPkV = StarkPoint.BASE.multiply(bobSkV)
  const { pk: bobPubHex } = stealthToNostrKeypair(bobPkV.x)
  console.log(`Bob nostr pubkey: ${bobPubHex.slice(0, 16)}...`)

  // Step 3: Subscribe Bob
  const received = await new Promise<string>((resolveMsg, rejectMsg) => {
    const timer = setTimeout(() => {
      close()
      rejectMsg(new Error(`Timeout: no event received within ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    const close = subscribeIncoming(RELAY, bobPubHex, (raw) => {
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
        const calleePkV = { x: bobPkV.x, y: bobPkV.y }
        console.log('Building call offer...')
        const eventJson = await buildCallOffer(aliceSkV, calleePkV, payload)
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
