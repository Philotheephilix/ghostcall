/**
 * Live file transfer test over real Tor onion transport.
 *
 * Runs both sender and receiver in-process using real Tor/Noise/demux.
 * Does NOT import electron — uses the demux + file-bridge protocol directly.
 *
 * Requires Tor running with SOCKS5 on 9050 and control port on 9051.
 * Usage: npx tsx scripts/live-test-file-transfer.ts
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { TorManager } from '../electron/tor-manager'
import { OnionServer } from '../electron/onion-server'
import { NoiseSession, noiseKeygen } from '../electron/noise-session'
import { connectToOnion } from '../electron/onion-client'
import { demux, MSG_FILE_META, MSG_FILE_CHUNK, MSG_FILE_ACK } from '../electron/demux'
import type { NoiseTransport } from '../electron/noise-session'

const ONION_PORT = 7332 // Use 7332 to avoid conflict with other tests
const CHUNK_SIZE = 60 * 1024
const ACK_OK = 0x00
const ACK_REJECTED = 0x01
const ACK_DONE = 0x02

function makeAck(transferIdBuf: Buffer, status: number): Buffer {
  const ack = Buffer.allocUnsafe(17)
  transferIdBuf.copy(ack, 0)
  ack[16] = status
  return ack
}

async function sender(transport: NoiseTransport, filePath: string, log: (s: string) => void): Promise<void> {
  const dmx = demux(transport)
  const transferId = randomBytes(16).toString('hex')
  const transferIdBuf = Buffer.from(transferId, 'hex')
  const stat = fs.statSync(filePath)
  const name = path.basename(filePath)

  const meta = Buffer.from(JSON.stringify({ name, size: stat.size, mime: 'application/octet-stream', transferId }))
  dmx.send(MSG_FILE_META, meta)
  log(`META sent: ${name} (${stat.size} bytes)`)

  const accepted = await new Promise<boolean>((resolve) => {
    const unsub = dmx.subscribe(MSG_FILE_ACK, (payload) => {
      if (payload.length < 17) return
      const byte = payload[16]
      if (byte === ACK_OK) { clearTimeout(t); unsub(); resolve(true) }
      else if (byte === ACK_REJECTED) { clearTimeout(t); unsub(); resolve(false) }
    })
    const t = setTimeout(() => { unsub(); resolve(false) }, 30_000)
  })

  if (!accepted) { dmx.close(); throw new Error('Receiver rejected') }
  log('ACK_OK received — streaming chunks...')

  const fd = fs.openSync(filePath, 'r')
  const buf = Buffer.allocUnsafe(CHUNK_SIZE)
  let chunkIndex = 0
  let bytesSent = 0
  try {
    while (bytesSent < stat.size) {
      const bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, bytesSent)
      if (bytesRead === 0) break
      const frame = Buffer.allocUnsafe(20 + bytesRead)
      transferIdBuf.copy(frame, 0)
      frame.writeUInt32BE(chunkIndex, 16)
      buf.copy(frame, 20, 0, bytesRead)
      dmx.send(MSG_FILE_CHUNK, frame)
      bytesSent += bytesRead
      chunkIndex++
    }
  } finally {
    fs.closeSync(fd)
  }

  log(`Sent ${chunkIndex} chunks (${bytesSent} bytes) — sending DONE`)
  dmx.send(MSG_FILE_ACK, makeAck(transferIdBuf, ACK_DONE))
  dmx.close()
}

async function receiver(transport: NoiseTransport, savePath: string, log: (s: string) => void): Promise<void> {
  const dmx = demux(transport)

  const meta = await new Promise<{ name: string; size: number; transferId: string } | null>((resolve) => {
    const unsub = dmx.subscribe(MSG_FILE_META, (payload) => {
      unsub()
      try { resolve(JSON.parse(payload.toString('utf8'))) } catch { resolve(null) }
    })
    setTimeout(() => { unsub(); resolve(null) }, 30_000)
  })

  if (!meta) { dmx.close(); throw new Error('No META received') }
  log(`META received: ${meta.name} (${meta.size} bytes)`)

  const transferIdBuf = Buffer.from(meta.transferId, 'hex')
  const { size } = meta
  const chunks = new Map<number, Buffer>()
  let bytesReceived = 0

  await new Promise<void>((resolve) => {
    const unsub = dmx.subscribe(MSG_FILE_CHUNK, (payload) => {
      if (payload.length < 20) return
      const chunkIndex = payload.readUInt32BE(16)
      const data = payload.slice(20)
      if (!chunks.has(chunkIndex)) {
        chunks.set(chunkIndex, data)
        bytesReceived += data.length
        if (bytesReceived % (CHUNK_SIZE * 4) === 0 || bytesReceived >= size) {
          process.stdout.write(`\r  [receiver] ${bytesReceived}/${size} bytes`)
        }
      }
    })
    const unsubAck = dmx.subscribe(MSG_FILE_ACK, (payload) => {
      if (payload.length >= 17 && payload[16] === ACK_DONE) {
        unsub(); unsubAck(); resolve()
      }
    })
    // Send ACK_OK now that subscribers are registered
    dmx.send(MSG_FILE_ACK, makeAck(transferIdBuf, ACK_OK))
    log('ACK_OK sent — waiting for chunks...')
  })

  log(`\nAll chunks received (${bytesReceived} bytes) — reassembling...`)

  const assembled = Buffer.alloc(bytesReceived)
  let offset = 0
  for (let i = 0; i < chunks.size; i++) {
    const chunk = chunks.get(i)
    if (!chunk) break
    chunk.copy(assembled, offset)
    offset += chunk.length
  }
  fs.writeFileSync(savePath, assembled.slice(0, offset))
  log(`Written to ${savePath}`)
  dmx.close()
}

async function main() {
  console.log('=== GhostCall File Transfer Live Test ===')

  // [1] Start Tor
  console.log('\n[1] Attaching to Tor...')
  const torManager = new TorManager()
  await torManager.start()
  console.log('    Tor ready')

  // [2] Write test file
  const FILE_SIZE = 200 * 1024
  console.log(`\n[2] Creating ${FILE_SIZE / 1024}KB test file...`)
  const content = Buffer.from(Array.from({ length: FILE_SIZE }, (_, i) => i % 251))
  const filePath = path.join(os.tmpdir(), `ghostcall-live-send-${Date.now()}.bin`)
  const savePath = path.join(os.tmpdir(), `ghostcall-live-recv-${Date.now()}.bin`)
  fs.writeFileSync(filePath, content)
  console.log(`    Send: ${filePath}`)
  console.log(`    Recv: ${savePath}`)

  // [3] Sender goes online
  console.log('\n[3] Creating onion service...')
  const onionAddr = await torManager.addOnion(ONION_PORT)
  console.log(`    Onion: ${onionAddr}`)

  const senderKeys = noiseKeygen()
  const onionServer = new OnionServer()
  let senderTransportResolve: (t: NoiseTransport) => void
  const senderTransportPromise = new Promise<NoiseTransport>((r) => { senderTransportResolve = r })

  await onionServer.listen(ONION_PORT, async (socket) => {
    console.log('\n  [sender] Inbound connection — handshaking...')
    const transport = await NoiseSession.handshakeResponder(socket, senderKeys.secretKey)
    console.log('  [sender] Handshake complete')
    senderTransportResolve(transport)
  })
  console.log(`    Listening on port ${ONION_PORT}`)

  // [4] Wait for onion to register
  console.log('\n[4] Waiting 45s for onion service to propagate...')
  await new Promise<void>(r => setTimeout(r, 45_000))

  // [5] Receiver dials in
  console.log('\n[5] Receiver dialing onion...')
  const socks = torManager.getSocksProxy()
  const receiverSocket = await connectToOnion(onionAddr, socks)
  console.log('    TCP connected')

  const receiverKeys = noiseKeygen()
  const receiverTransport = await NoiseSession.handshakeInitiator(receiverSocket, receiverKeys.secretKey)
  console.log('    Noise handshake complete')

  const senderTransport = await senderTransportPromise

  // [6] Transfer
  console.log('\n[6] Running transfer...')
  const slog = (s: string) => console.log(`  [sender] ${s}`)
  const rlog = (s: string) => console.log(`  [receiver] ${s}`)

  const receiverDone = receiver(receiverTransport, savePath, rlog)
  await new Promise<void>(r => setImmediate(r))
  const senderDone = sender(senderTransport, filePath, slog)

  await Promise.all([senderDone, receiverDone])
  console.log('')

  // [7] Verify
  console.log('\n[7] Verifying...')
  if (!fs.existsSync(savePath)) throw new Error(`Save file not found: ${savePath}`)
  const received = fs.readFileSync(savePath)
  if (received.length !== content.length) throw new Error(`Size mismatch: sent ${content.length}, got ${received.length}`)
  if (!received.equals(content)) throw new Error('Content mismatch — data corrupted in transit')
  console.log(`    ${received.length} bytes received — content matches ✓`)

  // Cleanup
  fs.unlinkSync(filePath)
  fs.unlinkSync(savePath)
  await onionServer.close()
  const serviceId = onionAddr.replace(/\.onion:\d+$/, '')
  try { await torManager.removeOnion(serviceId) } catch { /* ok */ }

  console.log('\n✓ FILE TRANSFER LIVE TEST PASSED')
  process.exit(0)
}

main().catch((err) => {
  console.error('\nFILE TRANSFER LIVE TEST FAILED:', err)
  process.exit(1)
})
