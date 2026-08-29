/**
 * Noise_XX (25519, ChaChaPoly, SHA256) — pure-JS, works in Electron 32 (Node v20).
 *
 * Electron 32 ships Node v20.18.1 with an OpenSSL build that does NOT expose
 * chacha20-poly1305 via crypto.createCipheriv. We use @noble/ciphers instead.
 *
 * Crypto primitives:
 *  - DH/X25519: tweetnacl (nacl.scalarMult / nacl.box.keyPair)
 *  - ChaCha20-Poly1305: @noble/ciphers/chacha.js (pure JS, no native)
 *  - SHA-256 / HMAC-SHA-256: Node.js built-in crypto (available in all versions)
 *
 * Frame format: uint16-BE(len) || encrypted_payload
 * MAC appended by ChaCha20-Poly1305 (16 bytes, Poly1305 tag)
 */

import * as net from 'net'
import * as nodeCrypto from 'crypto'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chacha20poly1305 } = require('@noble/ciphers/chacha.js') as {
  chacha20poly1305: (key: Uint8Array, nonce: Uint8Array, aad?: Uint8Array) => {
    encrypt(plaintext: Uint8Array): Uint8Array
    decrypt(ciphertext: Uint8Array): Uint8Array
  }
}
interface NaclScalarMult {
  (n: Uint8Array, p: Uint8Array): Uint8Array
  base(n: Uint8Array): Uint8Array
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nacl = require('tweetnacl') as {
  scalarMult: NaclScalarMult
  box: { keyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } }
  randomBytes(n: number): Uint8Array
}

// ── constants ──────────────────────────────────────────────────────────────

const PROTOCOL_NAME = 'Noise_XX_25519_ChaChaPoly_SHA256'
const DHLEN = 32
const MACLEN = 16

// ── primitives ─────────────────────────────────────────────────────────────

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(nodeCrypto.createHash('sha256').update(data).digest())
}

function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return new Uint8Array(nodeCrypto.createHmac('sha256', Buffer.from(key)).update(Buffer.from(data)).digest())
}

function concat(...bufs: Uint8Array[]): Uint8Array {
  const total = bufs.reduce((n, b) => n + b.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const b of bufs) { out.set(b, off); off += b.length }
  return out
}

function chachaPoly1305Encrypt(key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  // @noble/ciphers: encrypt returns ciphertext + 16-byte Poly1305 tag appended
  return chacha20poly1305(key, nonce, ad.length > 0 ? ad : undefined).encrypt(plaintext)
}

function chachaPoly1305Decrypt(key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonce, ad.length > 0 ? ad : undefined).decrypt(ciphertext)
}

// ── HKDF (Noise variant) ───────────────────────────────────────────────────

function hkdf2(ck: Uint8Array, input: Uint8Array): [Uint8Array, Uint8Array] {
  const tempK = hmacSha256(ck, input)
  const out1 = hmacSha256(tempK, new Uint8Array([0x01]))
  const out2 = hmacSha256(tempK, concat(out1, new Uint8Array([0x02])))
  return [out1, out2]
}

function nonceToBytes(n: bigint): Uint8Array {
  const b = new Uint8Array(12) // 4 zero bytes + 8 LE counter
  let v = n
  for (let i = 4; i < 12; i++) { b[i] = Number(v & 0xffn); v >>= 8n }
  return b
}

// ── CipherState ────────────────────────────────────────────────────────────

class CipherState {
  private k: Uint8Array | null = null
  private n: bigint = 0n

  initKey(k: Uint8Array) { this.k = new Uint8Array(k); this.n = 0n }

  encrypt(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (!this.k) return plaintext
    return chachaPoly1305Encrypt(this.k, nonceToBytes(this.n++), ad, plaintext)
  }

  decrypt(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (!this.k) return ciphertext
    return chachaPoly1305Decrypt(this.k, nonceToBytes(this.n++), ad, ciphertext)
  }
}

// ── SymmetricState ─────────────────────────────────────────────────────────

class SymmetricState {
  private cs = new CipherState()
  private ck: Uint8Array
  public h: Uint8Array

  constructor() {
    const name = new TextEncoder().encode(PROTOCOL_NAME)
    this.h = name.length <= DHLEN
      ? (() => { const h = new Uint8Array(DHLEN); h.set(name); return h })()
      : sha256(name)
    this.ck = new Uint8Array(this.h)
  }

  mixKey(input: Uint8Array) {
    const [ck, k] = hkdf2(this.ck, input)
    this.ck = ck
    this.cs.initKey(k.slice(0, 32))
  }

  mixHash(data: Uint8Array) {
    this.h = sha256(concat(this.h, data))
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ct = this.cs.encrypt(this.h, plaintext)
    this.mixHash(ct)
    return ct
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const pt = this.cs.decrypt(this.h, ciphertext)
    this.mixHash(ciphertext)
    return pt
  }

  split(): [CipherState, CipherState] {
    const [k1, k2] = hkdf2(this.ck, new Uint8Array(0))
    const c1 = new CipherState(); c1.initKey(k1.slice(0, 32))
    const c2 = new CipherState(); c2.initKey(k2.slice(0, 32))
    return [c1, c2]
  }
}

// ── SocketReader ───────────────────────────────────────────────────────────

class SocketReader {
  private buf = Buffer.alloc(0)
  private waiters: Array<{ len: number; resolve: (b: Buffer) => void }> = []

  constructor(socket: net.Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk])
      this._drain()
    })
  }

  private _drain() {
    while (this.waiters.length > 0 && this.buf.length >= this.waiters[0].len) {
      const { len, resolve } = this.waiters.shift()!
      resolve(this.buf.slice(0, len))
      this.buf = this.buf.slice(len)
    }
  }

  readExact(len: number): Promise<Buffer> {
    return new Promise(resolve => {
      this.waiters.push({ len, resolve })
      this._drain()
    })
  }

  async readFrame(): Promise<Buffer> {
    const header = await this.readExact(2)
    const frameLen = header.readUInt16BE(0)
    return this.readExact(frameLen)
  }
}

// ── frame I/O ──────────────────────────────────────────────────────────────

function writeFrame(socket: net.Socket, data: Uint8Array) {
  const frame = Buffer.allocUnsafe(2 + data.length)
  frame.writeUInt16BE(data.length, 0)
  Buffer.from(data).copy(frame, 2)
  socket.write(frame)
}

// ── Transport ──────────────────────────────────────────────────────────────

export interface NoiseTransport {
  send(frame: Buffer): void
  recv: AsyncIterable<Buffer>
}

function makeTransportWithReader(
  socket: net.Socket,
  reader: SocketReader,
  sendCs: CipherState,
  recvCs: CipherState,
): NoiseTransport {
  async function* recvFrames(): AsyncIterable<Buffer> {
    while (true) {
      let frame: Buffer
      try { frame = await reader.readFrame() } catch { break }
      try {
        const pt = recvCs.decrypt(new Uint8Array(0), new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength))
        yield Buffer.from(pt)
      } catch { break }
    }
  }
  return {
    send(frame: Buffer) {
      const ct = sendCs.encrypt(new Uint8Array(0), new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength))
      writeFrame(socket, ct)
    },
    recv: recvFrames(),
  }
}

// ── Noise_XX handshake ─────────────────────────────────────────────────────

async function performHandshake(
  socket: net.Socket,
  localStaticPriv: Uint8Array,
  isInitiator: boolean,
): Promise<NoiseTransport> {
  const ss = new SymmetricState()
  const reader = new SocketReader(socket)

  const staticPriv = localStaticPriv.slice(0, 32)
  const staticPub = nacl.scalarMult.base(staticPriv)

  const ephKP = nacl.box.keyPair()
  const ephPriv = ephKP.secretKey
  const ephPub = ephKP.publicKey

  ss.mixHash(new Uint8Array(0)) // empty prologue

  if (isInitiator) {
    // -> e
    ss.mixHash(ephPub)
    writeFrame(socket, ephPub)

    // <- e, ee, s, es
    const msg1 = await reader.readFrame()
    const remoteEph = new Uint8Array(msg1.buffer, msg1.byteOffset, DHLEN)
    ss.mixHash(remoteEph)
    ss.mixKey(nacl.scalarMult(ephPriv, remoteEph))
    const remoteStaticEnc = new Uint8Array(msg1.buffer, msg1.byteOffset + DHLEN, DHLEN + MACLEN)
    const remoteStatic = ss.decryptAndHash(remoteStaticEnc)
    ss.mixKey(nacl.scalarMult(ephPriv, remoteStatic))

    // -> s, se
    const myStaticEnc = ss.encryptAndHash(staticPub)
    ss.mixKey(nacl.scalarMult(staticPriv, remoteEph))
    writeFrame(socket, myStaticEnc)

    const [send, recv] = ss.split()
    return makeTransportWithReader(socket, reader, send, recv)
  } else {
    // <- e
    const msg0 = await reader.readFrame()
    const remoteEph = new Uint8Array(msg0.buffer, msg0.byteOffset, DHLEN)
    ss.mixHash(remoteEph)

    // -> e, ee, s, es
    ss.mixHash(ephPub)
    ss.mixKey(nacl.scalarMult(ephPriv, remoteEph))
    const myStaticEnc = ss.encryptAndHash(staticPub)
    ss.mixKey(nacl.scalarMult(staticPriv, remoteEph))
    writeFrame(socket, concat(ephPub, myStaticEnc))

    // <- s, se
    const msg2 = await reader.readFrame()
    const remoteStaticEnc = new Uint8Array(msg2.buffer, msg2.byteOffset, DHLEN + MACLEN)
    const remoteStatic = ss.decryptAndHash(remoteStaticEnc)
    ss.mixKey(nacl.scalarMult(ephPriv, remoteStatic))

    const [recv, send] = ss.split()
    return makeTransportWithReader(socket, reader, send, recv)
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export class NoiseSession {
  static handshakeInitiator(socket: net.Socket, localStaticPriv: Uint8Array): Promise<NoiseTransport> {
    return performHandshake(socket, localStaticPriv, true)
  }

  static handshakeResponder(socket: net.Socket, localStaticPriv: Uint8Array): Promise<NoiseTransport> {
    return performHandshake(socket, localStaticPriv, false)
  }
}

export function noiseKeygen(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const kp = nacl.box.keyPair()
  return { secretKey: kp.secretKey, publicKey: kp.publicKey }
}
