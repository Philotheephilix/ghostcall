/**
 * End-to-end call test — Alice calls Bob directly over Tor.
 * No UI needed — drives the call stack directly.
 *
 * Alice side: this script
 * Bob side:   scripts/bob-receive-dump.ts (must be running first)
 *
 * Usage:
 *   # Terminal 1: start Bob
 *   npx tsx scripts/bob-receive-dump.ts
 *
 *   # Terminal 2: run this (copy Bob's onion from terminal 1)
 *   BOB_ONION=abc...onion:7331 npx tsx scripts/live-test-e2e-call.ts
 */
import { TorManager } from '../electron/tor-manager'
import { connectToOnion } from '../electron/onion-client'
import { NoiseSession, noiseKeygen } from '../electron/noise-session'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpusScript = require('opusscript')

const BOB_ONION = process.env.BOB_ONION ?? ''
const CALL_DURATION_S = parseInt(process.env.CALL_DURATION ?? '8', 10)
const SAMPLE_RATE = 16000
const FRAME_SIZE = 320
const CHANNELS = 1

if (!BOB_ONION) {
  console.error('Usage: BOB_ONION=abc...onion:7331 npx tsx scripts/live-test-e2e-call.ts')
  process.exit(1)
}

async function main() {
  console.log('=== GhostCall E2E Call Test (Alice) ===')
  console.log(`Bob:      ${BOB_ONION}`)
  console.log(`Duration: ${CALL_DURATION_S}s`)

  const torManager = new TorManager()
  const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP)

  console.log('\n[1] Starting Tor...')
  await torManager.start()
  console.log('    Tor ready')

  console.log('[2] Connecting to Bob via SOCKS5...')
  const socks = torManager.getSocksProxy()
  const socket = await connectToOnion(BOB_ONION, socks)
  console.log('    TCP connected through Tor')

  console.log('[3] Noise_XX handshake...')
  const keys = noiseKeygen()
  const transport = await NoiseSession.handshakeInitiator(socket, keys.secretKey)
  console.log('    Handshake complete — ChaCha20-Poly1305 session established')

  // Generate synthetic 440Hz tone (simulates microphone input)
  console.log(`[4] Sending ${CALL_DURATION_S}s of 440Hz test tone...`)
  const framesTotal = Math.floor(CALL_DURATION_S * SAMPLE_RATE / FRAME_SIZE)
  let framesSent = 0

  const sendInterval = setInterval(() => {
    const pcm = new Int16Array(FRAME_SIZE)
    const t = framesSent * FRAME_SIZE
    for (let i = 0; i < FRAME_SIZE; i++) {
      pcm[i] = Math.round(Math.sin(2 * Math.PI * 440 * (t + i) / SAMPLE_RATE) * 16000)
    }
    const opus = encoder.encode(pcm, FRAME_SIZE)
    transport.send(Buffer.from(opus))
    framesSent++
    if (framesSent % 50 === 0) {
      process.stdout.write(`\r    Frame ${framesSent}/${framesTotal} sent`)
    }
    if (framesSent >= framesTotal) {
      clearInterval(sendInterval)
    }
  }, 20) // 20ms per frame = real-time

  // Wait for all frames to send
  await new Promise<void>(resolve => setTimeout(resolve, CALL_DURATION_S * 1000 + 500))

  console.log(`\n\n[5] Call complete — ${framesSent} frames sent`)
  socket.destroy()
  torManager.stop()
  console.log('\nALICE E2E TEST PASSED')
  console.log(`Bob should have saved ${(framesSent * FRAME_SIZE / SAMPLE_RATE).toFixed(1)}s of audio to /tmp/ghostcall-dump.wav`)
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
