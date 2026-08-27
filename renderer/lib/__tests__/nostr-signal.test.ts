import {
  buildCallOffer,
  parseCallOffer,
  publishToRelay,
  subscribeIncoming,
  stealthToNostrKeypair,
  CallSignalPayload,
} from '../nostr-signal'
import { ProjectivePoint as StarkPoint, CURVE } from '@scure/starknet'
import WebSocket from 'ws'

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Generate a random Stark-curve scalar in [1, CURVE.n).
 * These are the same kind of scalars used in stealth-keys.ts.
 */
function randomSkVBig(): bigint {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  const raw = BigInt('0x' + Buffer.from(arr).toString('hex'))
  const n = raw % CURVE.n
  return n === 0n ? 1n : n
}

/** Compute Stark pubkey point from scalar (same logic as parseCallOffer uses internally). */
function starkPkV(skVBig: bigint): { x: bigint; y: bigint } {
  const pt = StarkPoint.BASE.multiply(skVBig)
  return { x: pt.x, y: pt.y }
}

// ─── Test 1: roundtrip ─────────────────────────────────────────────────────

test('roundtrip: buildCallOffer → parseCallOffer recovers payload exactly', async () => {
  const calleeSkVBig = randomSkVBig()
  const calleePkV = starkPkV(calleeSkVBig)
  const callerSkVBig = randomSkVBig()

  const payload: CallSignalPayload = {
    onionAddr: 'aaaabbbbccccdddd.onion:7331',
    callId: '0xdeadbeef1234',
    callerNoisePubkey: '0xcafecafe',
  }

  const eventJson = await buildCallOffer(callerSkVBig, calleePkV, payload)
  const parsed = await parseCallOffer(eventJson, calleeSkVBig)

  expect(parsed).not.toBeNull()
  expect(parsed!.onionAddr).toBe(payload.onionAddr)
  expect(parsed!.callId).toBe(payload.callId)
  expect(parsed!.callerNoisePubkey).toBe(payload.callerNoisePubkey)
}, 15000)

// ─── Test 2: wrong key → null (not throw) ─────────────────────────────────

test('wrong key: parseCallOffer with wrong key returns null', async () => {
  const calleeSkVBig = randomSkVBig()
  const calleePkV = starkPkV(calleeSkVBig)
  const callerSkVBig = randomSkVBig()
  const wrongSkVBig = randomSkVBig() // different from callee

  const payload: CallSignalPayload = {
    onionAddr: 'test.onion:1234',
    callId: '0x1111',
    callerNoisePubkey: '0x2222',
  }

  const eventJson = await buildCallOffer(callerSkVBig, calleePkV, payload)
  const result = await parseCallOffer(eventJson, wrongSkVBig)

  expect(result).toBeNull()
}, 15000)

// ─── Test 3: stealthToNostrKeypair determinism ────────────────────────────

test('stealthToNostrKeypair determinism: same skV → same pk', () => {
  const skV = randomSkVBig()
  const { pk: pk1 } = stealthToNostrKeypair(skV)
  const { pk: pk2 } = stealthToNostrKeypair(skV)
  expect(pk1).toBe(pk2)
})

// ─── Test 4: stealthToNostrKeypair uniqueness ─────────────────────────────

test('stealthToNostrKeypair uniqueness: different skV → different pk', () => {
  const skV1 = randomSkVBig()
  const skV2 = randomSkVBig()
  const { pk: pk1 } = stealthToNostrKeypair(skV1)
  const { pk: pk2 } = stealthToNostrKeypair(skV2)
  expect(pk1).not.toBe(pk2)
})

// ─── Test 5: publishToRelay — mock WebSocket ──────────────────────────────

jest.mock('ws')

test('publishToRelay: sends ["EVENT", ...] and resolves on OK', async () => {
  const MockWS = WebSocket as jest.MockedClass<typeof WebSocket>
  MockWS.mockClear()

  const fakeEvent = { id: 'abc123', kind: 1059 }
  const eventJson = JSON.stringify(fakeEvent)

  // Capture handlers registered on the mock instance
  let openHandler: (() => void) | undefined
  let messageHandler: ((data: Buffer) => void) | undefined

  const fakeInstance = {
    on: jest.fn((event: string, handler: unknown) => {
      if (event === 'open') openHandler = handler as () => void
      if (event === 'message') messageHandler = handler as (data: Buffer) => void
    }),
    send: jest.fn(),
    close: jest.fn(),
  }
  MockWS.mockImplementation(() => fakeInstance as unknown as WebSocket)

  const promise = publishToRelay('wss://example.com', eventJson)

  // Trigger open → should send EVENT
  openHandler!()
  const sentRaw = (fakeInstance.send as jest.Mock).mock.calls[0][0] as string
  const sent = JSON.parse(sentRaw)
  expect(sent[0]).toBe('EVENT')
  expect(sent[1]).toEqual(fakeEvent)

  // Simulate relay OK response
  const okMsg = Buffer.from(JSON.stringify(['OK', fakeEvent.id, true, '']))
  messageHandler!(okMsg)

  await expect(promise).resolves.toBeUndefined()
})

// ─── Test 6: subscribeIncoming — mock WebSocket, REQ with #p filter ───────

test('subscribeIncoming: sends ["REQ", subId, {kinds:[1059], "#p":[pubHex]}]', async () => {
  const MockWS = WebSocket as jest.MockedClass<typeof WebSocket>
  MockWS.mockClear()

  let openHandler: (() => void) | undefined
  let messageHandler: ((data: Buffer) => void) | undefined
  const received: string[] = []

  const fakeInstance = {
    on: jest.fn((event: string, handler: unknown) => {
      if (event === 'open') openHandler = handler as () => void
      if (event === 'message') messageHandler = handler as (data: Buffer) => void
    }),
    send: jest.fn(),
    close: jest.fn(),
  }
  MockWS.mockImplementation(() => fakeInstance as unknown as WebSocket)

  const myPubHex = 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
  const close = subscribeIncoming('wss://example.com', myPubHex, (raw) => received.push(raw))

  // Trigger open → should send REQ
  openHandler!()
  const sentRaw = (fakeInstance.send as jest.Mock).mock.calls[0][0] as string
  const sent = JSON.parse(sentRaw)

  expect(sent[0]).toBe('REQ')
  const subId = sent[1]
  expect(typeof subId).toBe('string')
  expect(sent[2]).toMatchObject({ kinds: [1059], '#p': [myPubHex] })

  // Simulate incoming EVENT for our subscription
  const fakeEvent = { id: 'ev1', kind: 1059, content: 'encrypted' }
  const eventMsg = Buffer.from(JSON.stringify(['EVENT', subId, fakeEvent]))
  messageHandler!(eventMsg)

  expect(received).toHaveLength(1)
  expect(JSON.parse(received[0])).toEqual(fakeEvent)

  // EVENT from a different subId should be ignored
  const otherMsg = Buffer.from(JSON.stringify(['EVENT', 'other-sub', fakeEvent]))
  messageHandler!(otherMsg)
  expect(received).toHaveLength(1)

  close()
  expect(fakeInstance.close).toHaveBeenCalled()
})
