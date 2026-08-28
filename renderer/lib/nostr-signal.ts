import { getPublicKey, generateSecretKey } from 'nostr-tools/pure'
import * as nip59 from 'nostr-tools/nip59'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bigintToBytes32 } from './stealth-keys'
import WebSocket from 'ws'
// secp256k1 curve order — used to normalize private key scalars into valid range
const SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n

export interface CallSignalPayload {
  onionAddr: string
  callId: string
  callerNoisePubkey: string
}

/**
 * Derives a deterministic Nostr keypair from a stealth private viewing key scalar.
 * Uses HKDF-SHA256 to produce a 32-byte Nostr private key from any bigint scalar.
 *
 * Privacy: the input MUST be a private scalar (skV), never a public coordinate.
 * The output pubkey is stored on-chain via StealthRegistry.pk_nostr so callers
 * can address gift-wrap events without deriving it from public on-chain data.
 */
export function stealthToNostrKeypair(skV: bigint): { sk: Uint8Array; pk: string; routingPk: string } {
  const skBytes = bigintToBytes32(skV)
  const enc = new TextEncoder()
  const derived = hkdf(sha256, skBytes, undefined, enc.encode('ghostcall-nostr-key-v1'), 32)
  // Normalize to valid secp256k1 scalar range (must be in [1, order-1])
  const scalar = (BigInt('0x' + Buffer.from(derived).toString('hex')) % SECP256K1_ORDER) || 1n
  const sk = bigintToBytes32(scalar)
  // Full secp256k1 pubkey x-coord — used for NIP-44 ECDH encryption (full 256-bit)
  const pk = getPublicKey(sk)
  // Routing pubkey for on-chain storage and Nostr p-tag filter:
  // truncate to 31 bytes (248-bit), guaranteed to fit felt252 (< 2^251).
  // Both caller and callee apply the same truncation, so they always agree.
  const routingPk = BigInt('0x' + pk).toString(16).slice(-62).padStart(62, '0')
  return { sk, pk, routingPk }
}

/**
 * Build a NIP-59 gift-wrap call offer from caller → callee.
 *
 * The callee's Nostr pubkey MUST come from the StealthRegistry (stored as pk_nostr).
 * It is derived from their private skV via stealthToNostrKeypair(skV) — only they
 * can compute the matching SK for decryption.
 *
 * @param callerEphSkV  Caller's ephemeral viewing key scalar (private)
 * @param calleePkV     Callee's stealth viewing pubkey (used only for type compat, not for routing)
 * @param payload       Call signal payload to encrypt
 * @param calleeNostrPk Callee's Nostr pubkey (hex) from StealthRegistry.pk_nostr
 */
export async function buildCallOffer(
  callerEphSkV: bigint,
  calleePkV: { x: bigint; y: bigint },
  payload: CallSignalPayload,
  calleeNostrPk: string,
): Promise<string> {
  // Caller's ephemeral nostr keypair (derived from private scalar)
  const { sk: callerSk } = stealthToNostrKeypair(callerEphSkV)

  if (!calleeNostrPk) {
    throw new Error('buildCallOffer: calleeNostrPk is required — fetch from StealthRegistry')
  }
  const calleePk = calleeNostrPk

  const plaintext = JSON.stringify(payload)

  // Gift-wrap via nip59: wrapEvent handles createRumor + createSeal + createWrap
  const giftWrap = nip59.wrapEvent(
    {
      kind: 14,
      content: plaintext,
      tags: [['p', calleePk]],
    },
    callerSk,
    calleePk,
  )

  return JSON.stringify(giftWrap)
}

/**
 * Parse an incoming gift-wrapped call offer using the recipient's private viewing key scalar.
 *
 * The callee's Nostr SK is derived via stealthToNostrKeypair(mySkV) — purely private,
 * never derivable by an on-chain observer since mySkV is never revealed publicly.
 *
 * Returns null on any error (wrong key, malformed event, etc.).
 */
export async function parseCallOffer(
  eventJson: string,
  mySkV: bigint,
): Promise<CallSignalPayload | null> {
  try {
    const giftWrap = JSON.parse(eventJson)
    // Derive own nostr SK directly from private skV — private and secure
    const { sk: myNsk } = stealthToNostrKeypair(mySkV)

    // Unwrap NIP-59 — returns the rumor (unsigned inner event)
    const rumor = nip59.unwrapEvent(giftWrap, myNsk)

    return JSON.parse(rumor.content) as CallSignalPayload
  } catch {
    return null
  }
}

/**
 * Publish a serialized Nostr event to a relay via WebSocket.
 * Resolves when the relay ACKs with OK, rejects on error or 8s timeout.
 * Uses a settled flag to prevent double-reject on concurrent error + timeout.
 */
export function publishToRelay(relayUrl: string, eventJson: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        fn()
      }
    }

    const ws = new WebSocket(relayUrl)
    const timer = setTimeout(() => {
      ws.close()
      settle(() => reject(new Error('relay publish timeout')))
    }, 8000)

    ws.on('open', () => {
      ws.send(JSON.stringify(['EVENT', JSON.parse(eventJson)]))
    })

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())
        if (Array.isArray(msg) && msg[0] === 'OK') {
          ws.close()
          settle(() => resolve())
        }
      } catch {
        // ignore parse errors
      }
    })

    ws.on('error', (err: Error) => {
      settle(() => reject(err))
    })
  })
}

/**
 * Subscribe to incoming NIP-59 gift-wrapped events tagged with myPubHex.
 * Returns a close/unsubscribe function.
 */
export function subscribeIncoming(
  relayUrl: string,
  myPubHex: string,
  onMessage: (raw: string) => void,
): () => void {
  const ws = new WebSocket(relayUrl)
  const subId = Math.random().toString(36).slice(2, 10)

  ws.on('open', () => {
    ws.send(JSON.stringify(['REQ', subId, { kinds: [1059], '#p': [myPubHex] }]))
  })

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString())
      if (Array.isArray(msg) && msg[0] === 'EVENT' && msg[1] === subId) {
        onMessage(JSON.stringify(msg[2]))
      }
    } catch {
      // ignore parse errors
    }
  })

  ws.on('error', (err: Error) => {
    console.error('[GhostCall] subscribeIncoming relay error:', err.message)
  })

  return () => {
    ws.close()
  }
}

