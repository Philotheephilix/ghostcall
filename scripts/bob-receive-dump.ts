/**
 * Bob — echo server + WAV dump
 *
 * Receives audio from Alice, echoes every decoded PCM frame back,
 * and also writes to /tmp/ghostcall-dump.wav.
 *
 * Usage:
 *   npx tsx scripts/bob-receive-dump.ts
 * Then have Alice call the printed .onion address.
 */
import * as fs from 'fs'
import { TorManager } from '../electron/tor-manager'
import { OnionServer } from '../electron/onion-server'
import { NoiseSession, noiseKeygen } from '../electron/noise-session'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpusScript = require('opusscript')

const SAMPLE_RATE = 16000
const FRAME_SIZE = 320
const CHANNELS = 1
const OUTPUT_WAV = '/Users/I740422/projects/stark/screenshots/ghostcall-dump.wav'
const ONION_PORT = 7331

// ── WAV writer ─────────────────────────────────────────────────────────────

class WavWriter {
  private fd: number
  private dataLen = 0

  constructor(filepath: string) {
    this.fd = fs.openSync(filepath, 'w')
    fs.writeSync(this.fd, Buffer.alloc(44)) // placeholder header
  }

  writeInt16(pcm16: Int16Array) {
    const buf = Buffer.alloc(pcm16.length * 2)
    for (let i = 0; i < pcm16.length; i++) buf.writeInt16LE(pcm16[i], i * 2)
    fs.writeSync(this.fd, buf)
    this.dataLen += buf.length
  }

  close() {
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + this.dataLen, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)      // PCM
    header.writeUInt16LE(CHANNELS, 22)
    header.writeUInt32LE(SAMPLE_RATE, 24)
    header.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28)
    header.writeUInt16LE(CHANNELS * 2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(this.dataLen, 40)
    fs.writeSync(this.fd, header, 0, 44, 0)
    fs.closeSync(this.fd)
    console.log(`\nWAV saved: ${OUTPUT_WAV} (${(this.dataLen / (SAMPLE_RATE * 2)).toFixed(1)}s)`)
  }
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== GhostCall Bob — Echo + Dump ===')

  const torManager = new TorManager()
  const onionServer = new OnionServer()
  const decoder = new OpusScript(SAMPLE_RATE, CHANNELS)
  const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP)
  const wav = new WavWriter(OUTPUT_WAV)
  let framesRx = 0

  process.on('SIGINT', () => {
    console.log('\nStopping — saving WAV...')
    wav.close()
    torManager.stop()
    process.exit(0)
  })

  console.log('[1] Starting Tor...')
  await torManager.start()
  console.log('    Tor ready')

  console.log('[2] Creating onion service...')
  const onionAddr = await torManager.addOnion(ONION_PORT)

  console.log(`
    ┌─────────────────────────────────────────────────────────┐
    │ ONION ADDRESS: ${onionAddr.padEnd(43)} │
    │ Paste into the app DIRECT tab and click CALL.           │
    └─────────────────────────────────────────────────────────┘
`)
  console.log('[3] Waiting for call... (Ctrl+C to stop)')

  await new Promise<void>((resolve, reject) => {
    onionServer.listen(ONION_PORT, async (socket) => {
      console.log('[4] Alice connected — Noise_XX handshake...')
      const keys = noiseKeygen()
      try {
        const transport = await NoiseSession.handshakeResponder(socket, keys.secretKey)
        console.log('[5] Connected! Echoing audio back...\n    (dots = frames received)\n')

        for await (const opusFrame of transport.recv) {
          // Decode
          const pcm16buf: Buffer = decoder.decode(opusFrame)
          const pcm16 = new Int16Array(
            pcm16buf.buffer.slice(pcm16buf.byteOffset, pcm16buf.byteOffset + pcm16buf.byteLength)
          )

          // Write to WAV
          wav.writeInt16(pcm16)
          framesRx++
          if (framesRx % 25 === 0) process.stdout.write('.')

          // Re-encode and echo back to Alice
          try {
            const echoed = encoder.encode(pcm16buf, FRAME_SIZE)
            transport.send(echoed)
          } catch { /* ignore echo errors */ }
        }

        console.log(`\n[6] Call ended. ${framesRx} frames received and echoed.`)
        wav.close()
        await onionServer.close()
        await torManager.removeOnion(onionAddr.replace('.onion:' + ONION_PORT, ''))
        torManager.stop()
        resolve()
      } catch (err) {
        socket.destroy()
        reject(err)
      }
    }).catch(reject)
  })
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
