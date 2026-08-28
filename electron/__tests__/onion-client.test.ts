import * as net from 'net'
import { connectToOnion } from '../onion-client'

/** Create a mock SOCKS5 server that accepts one connection and runs handler */
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
          // Step 1: client greeting [0x05, 0x01, 0x00]
          expect(chunk[0]).toBe(0x05) // SOCKS5
          expect(chunk[1]).toBe(0x01) // 1 method
          expect(chunk[2]).toBe(0x00) // no auth
          // Reply: method selected [0x05, 0x00]
          socket.write(Buffer.from([0x05, 0x00]))
        } else if (received.length === 2) {
          // Step 2: CONNECT request
          expect(chunk[0]).toBe(0x05) // SOCKS5
          expect(chunk[1]).toBe(0x01) // CONNECT
          expect(chunk[2]).toBe(0x00) // reserved
          expect(chunk[3]).toBe(0x03) // DOMAINNAME address type

          const domainLen = chunk[4]
          const domain = chunk.subarray(5, 5 + domainLen).toString('ascii')
          const port16 = chunk.readUInt16BE(5 + domainLen)

          expect(domain).toBe('abc123.onion')
          expect(port16).toBe(7331)

          // Simulate success response
          // [VER=5, REP=0, RSV=0, ATYP=1, BIND.ADDR=0.0.0.0, BIND.PORT=0]
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
          resolveConnection(socket)
        }
      })
    })

    const proxySocket = { host: '127.0.0.1', port }
    const resultSocket = await connectToOnion('abc123.onion:7331', proxySocket)

    expect(resultSocket).toBeTruthy()
    expect(resultSocket.destroyed).toBe(false)

    // Await the server-side socket to verify it was reached
    const serverSocket = await connectionPromise
    expect(serverSocket).toBeTruthy()

    resultSocket.destroy()
    server.close()
  }, 10_000)

  test('2. domain-type address (0x03) used for .onion hostnames', async () => {
    let addrTypeSeen = 0

    const { server, port } = await createMockSocks5Server((socket) => {
      let step = 0
      socket.on('data', (chunk: Buffer) => {
        if (step === 0) {
          step = 1
          socket.write(Buffer.from([0x05, 0x00]))
        } else if (step === 1) {
          addrTypeSeen = chunk[3]
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
        }
      })
    })

    const proxySocket = { host: '127.0.0.1', port }
    const resultSocket = await connectToOnion('xyz789.onion:4242', proxySocket)
    resultSocket.destroy()
    server.close()

    expect(addrTypeSeen).toBe(0x03) // DOMAINNAME
  }, 10_000)

  test('3. rejects when SOCKS5 server returns error code', async () => {
    const { server, port } = await createMockSocks5Server((socket) => {
      let step = 0
      socket.on('data', () => {
        if (step === 0) {
          step = 1
          socket.write(Buffer.from([0x05, 0x00]))
        } else if (step === 1) {
          // Reply with connection refused (0x05)
          socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
        }
      })
    })

    const proxySocket = { host: '127.0.0.1', port }
    await expect(connectToOnion('fail.onion:1234', proxySocket)).rejects.toThrow(
      /SOCKS5 CONNECT failed/,
    )
    server.close()
  }, 10_000)
})
