import * as net from 'net'

// noise-protocol is a CJS package
// eslint-disable-next-line @typescript-eslint/no-var-requires
const noise = require('noise-protocol') as {
  keygen: () => { publicKey: Buffer; secretKey: Buffer }
  initialize: (
    pattern: string,
    initiator: boolean,
    prologue: Buffer,
    s?: { publicKey: Buffer; secretKey: Buffer } | null,
    e?: { publicKey: Buffer; secretKey: Buffer } | null,
    rs?: Buffer | null,
    re?: Buffer | null,
  ) => unknown
  writeMessage: ((state: unknown, payload: Buffer, buf: Buffer) => { tx: Buffer; rx: Buffer } | undefined) & { bytes: number }
  readMessage: ((state: unknown, message: Buffer, payload: Buffer) => { tx: Buffer; rx: Buffer } | undefined) & { bytes: number }
  destroy: (state: unknown) => void
  PKLEN: number
  SKLEN: number
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cipherStateModule = require('noise-protocol/cipher-state') as (
  opts: { cipher: unknown },
) => {
  MACLEN: number
  STATELEN: number
  encryptWithAd: ((state: Buffer, out: Buffer, ad: Buffer, plain: Buffer) => void) & { bytesWritten: number }
  decryptWithAd: ((state: Buffer, out: Buffer, ad: Buffer, cipher: Buffer) => void) & { bytesWritten: number }
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cipherImpl = require('noise-protocol/cipher')() as { MACLEN: number }

const cs = cipherStateModule({ cipher: cipherImpl })
const MACLEN = cs.MACLEN

export interface NoiseTransport {
  send(frame: Buffer): void
  recv: AsyncIterable<Buffer>
}

/**
 * SocketReader: buffers incoming data and provides sequential async reads.
 * Avoids the unshift() timing issues with re-attaching event listeners.
 */
class SocketReader {
  private buf: Buffer = Buffer.alloc(0)
  private waiters: Array<{ n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void }> = []
  private closed = false
  private closeError: Error | null = null

  constructor(private socket: net.Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk])
      this.drain()
    })
    socket.on('error', (err) => {
      this.closed = true
      this.closeError = err
      this.rejectAll(err)
    })
    socket.on('close', () => {
      this.closed = true
      if (!this.closeError) {
        this.closeError = new Error('Socket closed')
      }
      this.rejectAll(this.closeError)
    })
  }

  private drain() {
    while (this.waiters.length > 0) {
      const w = this.waiters[0]
      if (this.buf.length < w.n) break
      this.waiters.shift()
      const out = this.buf.subarray(0, w.n)
      this.buf = this.buf.subarray(w.n)
      w.resolve(Buffer.from(out)) // copy so buf can be GC'd
    }
  }

  private rejectAll(err: Error) {
    for (const w of this.waiters) w.reject(err)
    this.waiters = []
  }

  readExact(n: number): Promise<Buffer> {
    if (this.closed && this.buf.length < n) {
      return Promise.reject(this.closeError ?? new Error('Socket closed'))
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ n, resolve, reject })
      this.drain()
    })
  }

  async readFrame(): Promise<Buffer> {
    const lenBuf = await this.readExact(2)
    const len = lenBuf.readUInt16BE(0)
    return this.readExact(len)
  }
}

/** Write a length-prefixed frame (uint16 BE + payload) */
function writeFrame(socket: net.Socket, data: Buffer): void {
  const frame = Buffer.allocUnsafe(2 + data.length)
  frame.writeUInt16BE(data.length, 0)
  data.copy(frame, 2)
  socket.write(frame)
}

/**
 * Build a NoiseTransport from established cipher states.
 * sendKey = key to encrypt outgoing frames
 * recvKey = key to decrypt incoming frames
 */
function makeTransport(
  socket: net.Socket,
  sendKey: Buffer,
  recvKey: Buffer,
): NoiseTransport {
  return makeTransportWithReader(socket, new SocketReader(socket), sendKey, recvKey)
}

export class NoiseSession {
  /**
   * Perform Noise_XX handshake as initiator.
   * XX pattern: -> e, <- e ee es se, -> s se
   */
  static async handshakeInitiator(
    socket: net.Socket,
    localStaticPriv: Uint8Array,
  ): Promise<NoiseTransport> {
    void localStaticPriv // XX static keys exchanged in-band; fresh keys per session
    const staticKeys = noise.keygen()
    const state = noise.initialize('XX', true, Buffer.alloc(0), staticKeys)
    const reader = new SocketReader(socket)

    // Msg 1: -> e
    const msg1 = Buffer.alloc(512)
    noise.writeMessage(state as never, Buffer.alloc(0), msg1)
    writeFrame(socket, msg1.subarray(0, noise.writeMessage.bytes))

    // Msg 2: <- e ee es se
    const msg2 = await reader.readFrame()
    noise.readMessage(state as never, msg2, Buffer.alloc(0))

    // Msg 3: -> s se (split occurs)
    const msg3 = Buffer.alloc(512)
    const split = noise.writeMessage(state as never, Buffer.alloc(0), msg3)
    writeFrame(socket, msg3.subarray(0, noise.writeMessage.bytes))

    noise.destroy(state)

    if (!split || !('tx' in split)) {
      throw new Error('Noise_XX initiator: handshake did not produce split')
    }

    // Initiator: tx = encrypt outbound, rx = decrypt inbound
    return makeTransportWithReader(socket, reader, split.tx as Buffer, split.rx as Buffer)
  }

  /**
   * Perform Noise_XX handshake as responder.
   * XX pattern: -> e, <- e ee es se, -> s se
   */
  static async handshakeResponder(
    socket: net.Socket,
    localStaticPriv: Uint8Array,
  ): Promise<NoiseTransport> {
    void localStaticPriv
    const staticKeys = noise.keygen()
    const state = noise.initialize('XX', false, Buffer.alloc(0), staticKeys)
    const reader = new SocketReader(socket)

    // Msg 1: <- e
    const msg1 = await reader.readFrame()
    noise.readMessage(state as never, msg1, Buffer.alloc(0))

    // Msg 2: -> e ee es se
    const msg2 = Buffer.alloc(512)
    noise.writeMessage(state as never, Buffer.alloc(0), msg2)
    writeFrame(socket, msg2.subarray(0, noise.writeMessage.bytes))

    // Msg 3: <- s se (split occurs)
    const msg3 = await reader.readFrame()
    const split = noise.readMessage(state as never, msg3, Buffer.alloc(0))

    noise.destroy(state)

    if (!split || !('tx' in split)) {
      throw new Error('Noise_XX responder: handshake did not produce split')
    }

    // Responder: tx = encrypt outbound (to initiator), rx = decrypt inbound (from initiator)
    return makeTransportWithReader(socket, reader, split.tx as Buffer, split.rx as Buffer)
  }
}

/** Same as makeTransport but reuses an existing SocketReader (avoids double-listener) */
function makeTransportWithReader(
  socket: net.Socket,
  reader: SocketReader,
  sendKey: Buffer,
  recvKey: Buffer,
): NoiseTransport {
  async function* recvFrames(): AsyncIterable<Buffer> {
    while (true) {
      let frame: Buffer
      try {
        frame = await reader.readFrame()
      } catch {
        break
      }
      const plainLen = frame.length - MACLEN
      if (plainLen < 0) break
      const plain = Buffer.allocUnsafe(plainLen)
      try {
        cs.decryptWithAd(recvKey, plain, Buffer.alloc(0), frame)
      } catch {
        break
      }
      yield plain.subarray(0, cs.decryptWithAd.bytesWritten)
    }
  }

  return {
    send(frame: Buffer): void {
      const encrypted = Buffer.allocUnsafe(frame.length + MACLEN)
      cs.encryptWithAd(sendKey, encrypted, Buffer.alloc(0), frame)
      writeFrame(socket, encrypted.subarray(0, cs.encryptWithAd.bytesWritten))
    },
    recv: recvFrames(),
  }
}
