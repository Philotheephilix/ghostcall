import { getPublicKey } from 'nostr-tools/pure'
import * as nip59 from 'nostr-tools/nip59'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ProjectivePoint as StarkPoint } from '@scure/starknet'
import WebSocket from 'ws'

export interface CallSignalPayload {
  onionAddr: string
  callId: string
  callerNoisePubkey: string
}

/**
 * Derives a deterministic Nostr keypair from a stealth key scalar (bigint).
 * Uses HKDF-SHA256 so the nostr key is always 32 valid bytes.
 */
export function stealthToNostrKeypair(skV: bigint): { sk: Uint8Array; pk: string } {
  const skBytes = bigintToBytes32(skV)
  const enc = new TextEncoder()
  const derived = hkdf(sha256, skBytes, undefined, enc.encode('ghostcall-nostr-key-v1'), 32)
  const pk = getPublicKey(derived)
  return { sk: derived, pk }
}

/**
 * Build a NIP-59 gift-wrap call offer from caller → callee.
 *
 * The callee's Nostr pubkey is derived from calleePkV.x treated as a scalar
 * (proxy: consistent pubkey only the callee can compute since they know their
 * skV → same pkV.x via EC multiply).
 */
export async function buildCallOffer(
  callerEphSkV: bigint,
  calleePkV: { x: bigint; y: bigint },
  payload: CallSignalPayload,
): Promise<string> {
  // Caller's ephemeral nostr keypair
  const { sk: callerSk } = stealthToNostrKeypair(callerEphSkV)
  // Derive callee's nostr pubkey from pkV.x as scalar proxy
  const { pk: calleePk } = stealthToNostrKeypair(calleePkV.x)

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
 * Parse an incoming gift-wrapped call offer using the recipient's stealth key scalar.
 *
 * The callee derives their nostr keypair the same way the caller addressed them:
 * both use stealthToNostrKeypair(pkV.x) where pkV = mySkV * G (Stark curve).
 * Returns null on any error (wrong key, malformed event, etc.).
 */
export async function parseCallOffer(
  eventJson: string,
  mySkV: bigint,
): Promise<CallSignalPayload | null> {
  try {
    const giftWrap = JSON.parse(eventJson)
    // Compute pkV from skV on the Stark curve to get pkV.x
    const pkVPoint = StarkPoint.BASE.multiply(mySkV)
    // Derive our nostr keypair the same way the caller derived our pubkey
    const { sk: myNsk } = stealthToNostrKeypair(pkVPoint.x)

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
 */
export function publishToRelay(relayUrl: string, eventJson: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('relay publish timeout'))
    }, 8000)

    ws.on('open', () => {
      ws.send(JSON.stringify(['EVENT', JSON.parse(eventJson)]))
    })

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())
        if (Array.isArray(msg) && msg[0] === 'OK') {
          clearTimeout(timer)
          ws.close()
          resolve()
        }
      } catch {
        // ignore parse errors
      }
    })

    ws.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(err)
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

  return () => {
    ws.close()
  }
}

// --- internal helpers ---

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0').slice(-64)
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}
