import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ProjectivePoint, CURVE } from '@scure/starknet'

// Stark curve order
const STARK_ORDER = CURVE.n

export interface StealthKeypair {
  skV: bigint
  skS: bigint
  pkV: { x: bigint; y: bigint }
  pkS: { x: bigint; y: bigint }
}

export interface StealthMeta {
  pkVx: bigint
  pkVy: bigint
  pkSx: bigint
  pkSy: bigint
}

/**
 * Derives deterministic stealth keypair from a wallet signature.
 * Uses HKDF-SHA256 to derive two Stark curve private keys.
 * Stark curve pubkeys have coordinates within felt252 range.
 */
export function deriveStealthKeypair(sig: { r: bigint; s: bigint }): StealthKeypair {
  const sigBytes = new Uint8Array(64)
  sigBytes.set(bigintToBytes32(sig.r), 0)
  sigBytes.set(bigintToBytes32(sig.s), 32)

  const enc = new TextEncoder()
  const skVBytes = hkdf(sha256, sigBytes, undefined, enc.encode('ghostcall-viewing-key-v1'), 32)
  const skSBytes = hkdf(sha256, sigBytes, undefined, enc.encode('ghostcall-spending-key-v1'), 32)

  const skV = normPrivKeyToStarkScalar(skVBytes)
  const skS = normPrivKeyToStarkScalar(skSBytes)

  const pkVPoint = ProjectivePoint.BASE.multiply(skV)
  const pkSPoint = ProjectivePoint.BASE.multiply(skS)

  return {
    skV,
    skS,
    pkV: { x: pkVPoint.x, y: pkVPoint.y },
    pkS: { x: pkSPoint.x, y: pkSPoint.y },
  }
}

/**
 * Derives a session key via ECDH on the Stark curve, then HKDF.
 * ECDH commutativity: deriveSessionKey(skA, pkB) === deriveSessionKey(skB, pkA)
 */
export function deriveSessionKey(
  localSk: bigint,
  remotePk: { x: bigint; y: bigint }
): Uint8Array {
  const remotePoint = ProjectivePoint.fromAffine({ x: remotePk.x, y: remotePk.y })
  const shared = remotePoint.multiply(localSk)
  const sharedBytes = bigintToBytes32(shared.x)
  return hkdf(sha256, sharedBytes, undefined, new TextEncoder().encode('ghostcall-session-v1'), 32)
}

/**
 * Derives a handle hash for on-chain storage.
 * sha256(utf8(handle.toLowerCase().trim())) truncated to felt252 range.
 */
export function deriveHandleHash(handle: string): bigint {
  const bytes = new TextEncoder().encode(handle.toLowerCase().trim())
  const hash = sha256(bytes)
  const full = bytesToBigint(hash)
  // Truncate to felt252 (< 2^251) by masking top bits
  return full & ((1n << 251n) - 1n)
}

// --- helpers ---

function normPrivKeyToStarkScalar(bytes: Uint8Array): bigint {
  const n = bytesToBigint(bytes)
  const normalized = n % STARK_ORDER
  return normalized === 0n ? 1n : normalized
}

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0').slice(-64)
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

function bytesToBigint(bytes: Uint8Array): bigint {
  return BigInt('0x' + Buffer.from(bytes).toString('hex'))
}
