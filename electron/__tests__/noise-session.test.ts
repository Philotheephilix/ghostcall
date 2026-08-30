/**
 * @jest-environment node
 */
import * as net from 'net'
import { NoiseSession } from '../noise-session'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const noise = require('noise-protocol') as {
  keygen: () => { publicKey: Buffer; secretKey: Buffer }
}

/** Create a loopback pair of connected sockets */
function createSocketPair(): Promise<[net.Socket, net.Socket]> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo

      const clientSock = net.connect(port, '127.0.0.1')
      clientSock.on('error', reject)

      server.once('connection', (serverSock) => {
        server.close()
        resolve([clientSock, serverSock])
      })
    })
  })
}

describe('NoiseSession', () => {
  test('1. loopback: initiator and responder exchange frames over real sockets', async () => {
    const [clientSock, serverSock] = await createSocketPair()

    const initKey = noise.keygen()
    const respKey = noise.keygen()

    const [initiatorTransport, responderTransport] = await Promise.all([
      NoiseSession.handshakeInitiator(clientSock, initKey.secretKey),
      NoiseSession.handshakeResponder(serverSock, respKey.secretKey),
    ])

    // Initiator sends, responder receives
    const testPayload = Buffer.from('hello noise world')
    initiatorTransport.send(testPayload)

    const respRecv = responderTransport.recv[Symbol.asyncIterator]()
    const received = await respRecv.next()
    expect(received.done).toBe(false)
    expect(Buffer.from(received.value as Buffer).toString()).toBe('hello noise world')

    clientSock.destroy()
    serverSock.destroy()
  }, 15_000)

  test('2. frames arrive in order', async () => {
    const [clientSock, serverSock] = await createSocketPair()

    const initKey = noise.keygen()
    const respKey = noise.keygen()

    const [initiatorTransport, responderTransport] = await Promise.all([
      NoiseSession.handshakeInitiator(clientSock, initKey.secretKey),
      NoiseSession.handshakeResponder(serverSock, respKey.secretKey),
    ])

    const messages = ['frame-0', 'frame-1', 'frame-2', 'frame-3', 'frame-4']
    for (const msg of messages) {
      initiatorTransport.send(Buffer.from(msg))
    }

    const received: string[] = []
    const iter = responderTransport.recv[Symbol.asyncIterator]()
    for (let i = 0; i < messages.length; i++) {
      const result = await iter.next()
      expect(result.done).toBe(false)
      received.push(Buffer.from(result.value as Buffer).toString())
    }

    expect(received).toEqual(messages)

    clientSock.destroy()
    serverSock.destroy()
  }, 15_000)

  test('3. mismatched static keys — Noise_XX completes handshake (DH-based, not pre-shared)', async () => {
    // Noise_XX does NOT require pre-shared static keys — identity is exchanged in-band via DH.
    // Two parties with completely different key material can still complete XX and establish
    // a shared secret. This test verifies that even with "wrong" (unrecognized) remote keys,
    // the handshake succeeds and data flows.
    const [clientSock, serverSock] = await createSocketPair()

    const initKey = noise.keygen()
    const respKey = noise.keygen() // completely independent keypair

    const [initiatorTransport, responderTransport] = await Promise.all([
      NoiseSession.handshakeInitiator(clientSock, initKey.secretKey),
      NoiseSession.handshakeResponder(serverSock, respKey.secretKey),
    ])

    initiatorTransport.send(Buffer.from('secret'))

    const iter = responderTransport.recv[Symbol.asyncIterator]()
    const result = await iter.next()
    expect(result.done).toBe(false)
    expect(Buffer.from(result.value as Buffer).toString()).toBe('secret')

    clientSock.destroy()
    serverSock.destroy()
  }, 15_000)
})
