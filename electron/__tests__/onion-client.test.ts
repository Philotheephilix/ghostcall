/**
 * @jest-environment node
 */
import * as net from 'net'
import { connectToOnion } from '../onion-client'

// Valid v3 onion addresses (56 base32 chars + .onion)
const VALID_ONION_1 = 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion'
const VALID_ONION_2 = 'aaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkkkllllmmmm2222.onion'

function createMockSocks5Server(
  handler: (socket: net.Socket) => void,
): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      resolve({ server, port })
    })
    server.on('error', reject)
  })
}

describe('connectToOnion (SOCKS5)', () => {
  test('1. correct SOCKS5 handshake — greeting and CONNECT request', async () => {
    const received: Buffer[] = []
    let resolveConnection: (s: net.Socket) => void
    const connectionPromise = new Promise<net.Socket>((r) => { resolveConnection = r })

    const { server, port } = await createMockSocks5Server((socket) => {
      socket.on('data', (chunk: Buffer) => {
        received.push(chunk)
        if (received.length === 1) {
          expect(chunk[0]).toBe(0x05)
          expect(chunk[1]).toBe(0x01)
          expect(chunk[2]).toBe(0x00)
          socket.write(Buffer.from([0x05, 0x00]))
        } else if (received.length === 2) {
          expect(chunk[0]).toBe(0x05)
          expect(chunk[1]).toBe(0x01)
          expect(chunk[2]).toBe(0x00)
          expect(chunk[3]).toBe(0x03) // DOMAINNAME
          const domainLen = chunk[4]
          const domain = chunk.subarray(5, 5 + domainLen).toString('ascii')
          const port16 = chunk.readUInt16BE(5 + domainLen)
          expect(domain).toBe(VALID_ONION_1)
          expect(port16).toBe(7331)
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
          resolveConnection(socket)
        }
      })
    })

    const result = await connectToOnion(`${VALID_ONION_1}:7331`, { host: '127.0.0.1', port })
    expect(result).toBeTruthy()
    expect(result.destroyed).toBe(false)
    await connectionPromise
    result.destroy()
    server.close()
  }, 10_000)

  test('2. domain-type address (0x03) used for .onion hostnames', async () => {
    let addrTypeSeen = 0
    const { server, port } = await createMockSocks5Server((socket) => {
      let step = 0
      socket.on('data', (chunk: Buffer) => {
        if (step === 0) { step = 1; socket.write(Buffer.from([0x05, 0x00])) }
        else if (step === 1) {
          addrTypeSeen = chunk[3]
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
        }
      })
    })
    const result = await connectToOnion(`${VALID_ONION_2}:4242`, { host: '127.0.0.1', port })
    result.destroy()
    server.close()
    expect(addrTypeSeen).toBe(0x03)
  }, 10_000)

  test('3. rejects when SOCKS5 server returns error code', async () => {
    const { server, port } = await createMockSocks5Server((socket) => {
      let step = 0
      socket.on('data', () => {
        if (step === 0) { step = 1; socket.write(Buffer.from([0x05, 0x00])) }
        else if (step === 1) {
          socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
        }
      })
    })
    await expect(
      connectToOnion(`${VALID_ONION_1}:1234`, { host: '127.0.0.1', port })
    ).rejects.toThrow(/SOCKS5 CONNECT failed/)
    server.close()
  }, 10_000)

  test('4. rejects invalid onion address format (short / not v3)', async () => {
    const proxy = { host: '127.0.0.1', port: 9050 }
    await expect(connectToOnion('short.onion:7331', proxy)).rejects.toThrow(/Invalid .onion/)
    await expect(connectToOnion('abc123.onion:7331', proxy)).rejects.toThrow(/Invalid .onion/)
    await expect(connectToOnion('notanonion.com:7331', proxy)).rejects.toThrow(/Invalid .onion/)
  })

  test('5. rejects invalid port', async () => {
    const proxy = { host: '127.0.0.1', port: 9050 }
    await expect(connectToOnion(`${VALID_ONION_1}:99999`, proxy)).rejects.toThrow(/Invalid port/)
    await expect(connectToOnion(`${VALID_ONION_1}:abc`, proxy)).rejects.toThrow(/Invalid port/)
  })
})
