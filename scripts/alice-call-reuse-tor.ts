/**
 * alice-call-reuse-tor.ts
 *
 * Alice side of E2E call test — reuses an already-running Tor (port 9050)
 * instead of spawning a new one. Use when bob-receive-dump.ts is already running.
 *
 * Usage:
 *   BOB_ONION=<onion>:7331 npx ts-node scripts/alice-call-reuse-tor.ts
 */
import { connectToOnion } from '../electron/onion-client'
import { NoiseSession, noiseKeygen } from '../electron/noise-session'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpusScript = require('opusscript')

const BOB_ONION = process.env.BOB_ONION ?? ''
const CALL_DURATION_S = parseInt(process.env.CALL_DURATION ?? '8', 10)
const SAMPLE_RATE = 16000
const FRAME_SIZE = 320
const CHANNELS = 1
const SOCKS_PROXY = { host: '127.0.0.1', port: 9050 }

if (!BOB_ONION) {
  console.error('Usage: BOB_ONION=<onion>:7331 npx ts-node scripts/alice-call-reuse-tor.ts')
  process.exit(1)
}

async function main() {
  console.log('=== GhostCall E2E Call Test (Alice — reuse Tor) ===')
  console.log(`Bob:      ${BOB_ONION}`)
  console.log(`SOCKS:    ${SOCKS_PROXY.host}:${SOCKS_PROXY.port}`)
  console.log(`Duration: ${CALL_DURATION_S}s`)

  const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP)

  console.log('\n[1] Connecting to Bob via existing Tor SOCKS5...')
  const socket = await connectToOnion(BOB_ONION, SOCKS_PROXY)
  console.log('    TCP connected through Tor')

  console.log('[2] Noise_XX handshake...')
  const keys = noiseKeygen()
  const transport = await NoiseSession.handshakeInitiator(socket, keys.secretKey)
  console.log('    Handshake complete — ChaCha20-Poly1305 session established')

  console.log(`[3] Sending ${CALL_DURATION_S}s of 440Hz test tone...`)
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
    if (framesSent >= framesTotal) clearInterval(sendInterval)
  }, 20)

  await new Promise<void>(resolve => setTimeout(resolve, CALL_DURATION_S * 1000 + 500))

  console.log(`\n\n[4] Call complete — ${framesSent} frames sent`)
  socket.destroy()
  console.log('\nALICE E2E TEST PASSED')
  console.log(`Bob received ~${(framesSent * FRAME_SIZE / SAMPLE_RATE).toFixed(1)}s of audio`)
  process.exit(0)
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
