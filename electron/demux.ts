import type { NoiseTransport } from './noise-session'

// Message type bytes — prepended to every frame on the wire
export const MSG_AUDIO = 0x01
export const MSG_FILE_META = 0x02
export const MSG_FILE_CHUNK = 0x03
export const MSG_FILE_ACK = 0x04

export interface DemuxedTransport {
  send(type: number, payload: Buffer): void
  subscribe(type: number, cb: (payload: Buffer) => void): () => void
  close(): void
}

/**
 * Wraps a NoiseTransport and dispatches incoming frames by the first byte.
 * Callers subscribe to a type byte; the callback fires for each matching frame
 * with the type byte stripped. Unsubscribed frame types are silently dropped.
 */
export function demux(transport: NoiseTransport): DemuxedTransport {
  const subscribers = new Map<number, (payload: Buffer) => void>()
  let closed = false

  // Pump recv in background — stops when transport closes or demux is closed
  ;(async () => {
    for await (const frame of transport.recv) {
      if (closed) break
      if (frame.length === 0) continue
      const type = frame[0]
      const payload = frame.slice(1)
      subscribers.get(type)?.(payload)
    }
  })()

  return {
    send(type: number, payload: Buffer) {
      const frame = Buffer.allocUnsafe(1 + payload.length)
      frame[0] = type
      payload.copy(frame, 1)
      transport.send(frame)
    },

    subscribe(type: number, cb: (payload: Buffer) => void) {
      subscribers.set(type, cb)
      return () => { subscribers.delete(type) }
    },

    close() {
      closed = true
      subscribers.clear()
    },
  }
}
