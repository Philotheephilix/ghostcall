/**
 * @jest-environment node
 */
import { EventEmitter } from 'events'
import { demux, MSG_AUDIO, MSG_FILE_META, MSG_FILE_CHUNK, MSG_FILE_ACK } from '../demux'
import type { NoiseTransport } from '../noise-session'

/** In-memory mock NoiseTransport backed by an async generator */
function mockTransport(frames: Buffer[]): NoiseTransport {
  let emitter = new EventEmitter()
  let queue: Buffer[] = [...frames]
  let waiting: ((v: IteratorResult<Buffer>) => void) | null = null

  function push(frame: Buffer) {
    if (waiting) {
      const resolve = waiting
      waiting = null
      resolve({ value: frame, done: false })
    } else {
      queue.push(frame)
    }
  }

  async function* recv(): AsyncIterable<Buffer> {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!
      } else {
        const next = await new Promise<IteratorResult<Buffer>>((resolve) => {
          waiting = resolve
        })
        if (next.done) return
        yield next.value
      }
    }
  }

  return {
    send: jest.fn(),
    recv: recv(),
    _push: push,
  } as any
}

function makeFrame(type: number, payload: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(1 + payload.length)
  frame[0] = type
  payload.copy(frame, 1)
  return frame
}

describe('demux', () => {
  test('dispatches frames to correct subscriber by type', async () => {
    const audioPayload = Buffer.from('audio-data')
    const metaPayload = Buffer.from('{"name":"test.txt"}')

    const transport = mockTransport([
      makeFrame(MSG_AUDIO, audioPayload),
      makeFrame(MSG_FILE_META, metaPayload),
    ])

    const dmx = demux(transport)
    const audioReceived: Buffer[] = []
    const metaReceived: Buffer[] = []

    dmx.subscribe(MSG_AUDIO, (p) => audioReceived.push(p))
    dmx.subscribe(MSG_FILE_META, (p) => metaReceived.push(p))

    await new Promise(r => setTimeout(r, 20))

    expect(audioReceived).toHaveLength(1)
    expect(audioReceived[0]).toEqual(audioPayload)
    expect(metaReceived).toHaveLength(1)
    expect(metaReceived[0]).toEqual(metaPayload)
  })

  test('send prepends type byte', () => {
    const transport = mockTransport([])
    const dmx = demux(transport)
    const payload = Buffer.from('hello')
    dmx.send(MSG_FILE_CHUNK, payload)
    const sentFrame = (transport.send as jest.Mock).mock.calls[0][0] as Buffer
    expect(sentFrame[0]).toBe(MSG_FILE_CHUNK)
    expect(sentFrame.slice(1)).toEqual(payload)
  })

  test('drops frames with no subscriber', async () => {
    const transport = mockTransport([
      makeFrame(MSG_FILE_ACK, Buffer.from([0x00])),
    ])
    const dmx = demux(transport)
    // No subscriber registered — should not throw
    await new Promise(r => setTimeout(r, 20))
  })

  test('unsubscribe stops delivery', async () => {
    const transport = mockTransport([]) as any
    const dmx = demux(transport)
    const received: Buffer[] = []
    const unsub = dmx.subscribe(MSG_AUDIO, (p) => received.push(p))

    transport._push(makeFrame(MSG_AUDIO, Buffer.from('a')))
    await new Promise(r => setTimeout(r, 10))
    expect(received).toHaveLength(1)

    unsub()
    transport._push(makeFrame(MSG_AUDIO, Buffer.from('b')))
    await new Promise(r => setTimeout(r, 10))
    expect(received).toHaveLength(1)
  })

  test('close stops dispatch', async () => {
    const transport = mockTransport([]) as any
    const dmx = demux(transport)
    const received: Buffer[] = []
    dmx.subscribe(MSG_AUDIO, (p) => received.push(p))
    dmx.close()
    transport._push(makeFrame(MSG_AUDIO, Buffer.from('x')))
    await new Promise(r => setTimeout(r, 10))
    expect(received).toHaveLength(0)
  })

  test('MSG constants have correct values', () => {
    expect(MSG_AUDIO).toBe(0x01)
    expect(MSG_FILE_META).toBe(0x02)
    expect(MSG_FILE_CHUNK).toBe(0x03)
    expect(MSG_FILE_ACK).toBe(0x04)
  })
})
