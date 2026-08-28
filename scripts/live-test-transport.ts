/**
 * Live transport test — requires Tor already running:
 *   brew services start tor   (macOS)
 *   or: sudo systemctl start tor
 *   or: tor &
 *
 * Checks if Tor is available on 127.0.0.1:9050 first.
 * If not, falls back to Noise_XX loopback-only test.
 */
import * as net from 'net'
import { torManager } from '../electron/tor-manager'
import { onionServer } from '../electron/onion-server'
import { NoiseSession } from '../electron/noise-session'
import { connectToOnion } from '../electron/onion-client'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const noise = require('noise-protocol') as {
  keygen: () => { publicKey: Buffer; secretKey: Buffer }
}

const ONION_PORT = 7331

function checkTorRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(9050, '127.0.0.1', () => {
      s.destroy()
      resolve(true)
    })
    s.on('error', () => resolve(false))
    setTimeout(() => { s.destroy(); resolve(false) }, 2000)
  })
}

async function noiseLoopbackTest(): Promise<void> {
  console.log('\n[Noise_XX loopback test]')

  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  const { port } = server.address() as net.AddressInfo

  const [clientSock, serverSock] = await new Promise<[net.Socket, net.Socket]>((resolve, reject) => {
    server.once('connection', (s) => {
      server.close()
      resolve([clientSock, s])
    })
    const clientSock = net.connect(port, '127.0.0.1')
    clientSock.on('error', reject)
  })

  const initKey = noise.keygen()
  const respKey = noise.keygen()

  const [initiatorTransport, responderTransport] = await Promise.all([
    NoiseSession.handshakeInitiator(clientSock, initKey.secretKey),
    NoiseSession.handshakeResponder(serverSock, respKey.secretKey),
  ])

  // Send 5 frames initiator -> responder
  const frames = ['frame-0', 'frame-1', 'frame-2', 'frame-3', 'frame-4']
  for (const f of frames) {
    initiatorTransport.send(Buffer.from(f))
  }

  const received: string[] = []
  const iter = responderTransport.recv[Symbol.asyncIterator]()
  for (let i = 0; i < frames.length; i++) {
    const result = await iter.next()
    if (result.done) throw new Error(`Iterator ended early at frame ${i}`)
    received.push(Buffer.from(result.value as Buffer).toString())
  }

  if (JSON.stringify(received) !== JSON.stringify(frames)) {
    throw new Error(`Frame mismatch: expected ${JSON.stringify(frames)}, got ${JSON.stringify(received)}`)
  }

  console.log('  All 5 frames received correctly:', received)
  clientSock.destroy()
  serverSock.destroy()
  console.log('  Noise_XX loopback: PASSED')
}

async function fullOnionTest(): Promise<void> {
  console.log('\n[Full Tor + Onion + Noise_XX test]')

  // Use already-running Tor — just control-port to add onion
  console.log('  Connecting to Tor control port...')
  const onionAddr = await torManager.addOnion(ONION_PORT)
  console.log(`  Onion address: ${onionAddr}`)

  // Start local TCP server on port 7331
  const serverSockets: net.Socket[] = []
  let resolveServerSocket: (s: net.Socket) => void
  const serverSocketPromise = new Promise<net.Socket>((r) => { resolveServerSocket = r })

  await onionServer.listen(ONION_PORT, (socket) => {
    serverSockets.push(socket)
    resolveServerSocket(socket)
  })
  console.log(`  OnionServer listening on 127.0.0.1:${ONION_PORT}`)

  // Connect from client through SOCKS5
  console.log('  Connecting via SOCKS5 to onion...')
  const socks = { host: '127.0.0.1', port: 9050 }
  const clientSock = await connectToOnion(onionAddr, socks)
  console.log('  SOCKS5 connected')

  // Wait for server-side socket
  const serverSock = await serverSocketPromise
  console.log('  Inbound connection accepted')

  // Noise_XX handshake
  const initKey = noise.keygen()
  const respKey = noise.keygen()
  console.log('  Starting Noise_XX handshake...')

  const [initiatorTransport, responderTransport] = await Promise.all([
    NoiseSession.handshakeInitiator(clientSock, initKey.secretKey),
    NoiseSession.handshakeResponder(serverSock, respKey.secretKey),
  ])
  console.log('  Handshake complete')

  // Send 5 frames
  const frames = ['tor-frame-0', 'tor-frame-1', 'tor-frame-2', 'tor-frame-3', 'tor-frame-4']
  for (const f of frames) {
    initiatorTransport.send(Buffer.from(f))
  }

  const received: string[] = []
  const iter = responderTransport.recv[Symbol.asyncIterator]()
  for (let i = 0; i < frames.length; i++) {
    const result = await iter.next()
    if (result.done) throw new Error(`Iterator ended early at frame ${i}`)
    received.push(Buffer.from(result.value as Buffer).toString())
  }

  if (JSON.stringify(received) !== JSON.stringify(frames)) {
    throw new Error(`Frame mismatch: expected ${JSON.stringify(frames)}, got ${JSON.stringify(received)}`)
  }

  console.log('  All 5 frames received correctly:', received)

  // Cleanup
  clientSock.destroy()
  for (const s of serverSockets) s.destroy()
  await onionServer.close()
  const serviceId = onionAddr.replace(/\.onion:\d+$/, '')
  try { await torManager.removeOnion(serviceId) } catch { /* ok */ }

  console.log('  Full onion test: PASSED')
}

async function main(): Promise<void> {
  console.log('=== GhostCall Transport Live Test ===')

  // Always run Noise_XX loopback
  await noiseLoopbackTest()

  // Check if Tor is already running
  const torAvailable = await checkTorRunning()

  if (!torAvailable) {
    console.log('\nTOR NOT RUNNING — skipping onion test, Noise_XX loopback passed')
    console.log('\nTo run the full test: brew services start tor (or: tor &)')
    process.exit(0)
  }

  console.log('\nTor SOCKS5 port detected — running full onion test...')

  try {
    // torManager.start() would spawn a second Tor; instead connect directly to control port
    // Mark as running to skip spawn
    ;(torManager as unknown as { _running: boolean })._running = true
    await fullOnionTest()
  } catch (err) {
    console.error('  Full onion test FAILED:', err)
    process.exit(1)
  }

  console.log('\n✓ TRANSPORT LIVE TEST PASSED')
  process.exit(0)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
