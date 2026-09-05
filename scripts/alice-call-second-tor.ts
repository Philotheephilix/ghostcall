/**
 * alice-call-second-tor.ts
 *
 * Alice side — runs her own Tor on port 9060/9061 (separate from Bob's 9050/9051)
 * so Alice can reach Bob's onion service.
 *
 * Usage:
 *   BOB_ONION=<onion>:7331 npx ts-node scripts/alice-call-second-tor.ts
 */
import { spawn } from 'child_process'
import * as net from 'net'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { connectToOnion } from '../electron/onion-client'
import { NoiseSession, noiseKeygen } from '../electron/noise-session'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpusScript = require('opusscript')

const BOB_ONION = process.env.BOB_ONION ?? ''
const CALL_DURATION_S = parseInt(process.env.CALL_DURATION ?? '8', 10)
const SAMPLE_RATE = 16000
const FRAME_SIZE = 320
const CHANNELS = 1

// Use different ports from Bob's Tor
const ALICE_SOCKS_PORT = 9060
const ALICE_DATA_DIR = path.join(os.homedir(), '.ghostcall-tor-alice')

if (!BOB_ONION) {
  console.error('Usage: BOB_ONION=<onion>:7331 npx ts-node scripts/alice-call-second-tor.ts')
  process.exit(1)
}

function findTorBin(): string {
  for (const p of [
    '/usr/local/bin/tor', '/opt/homebrew/bin/tor', '/usr/bin/tor',
    path.join(os.homedir(), 'projects/stark/node_modules/.bin/tor'),
  ]) {
    if (fs.existsSync(p)) return p
  }
  return 'tor'
}

async function startAliceTor(): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const bin = findTorBin()
    fs.mkdirSync(ALICE_DATA_DIR, { recursive: true })
    const proc = spawn(bin, [
      '--SocksPort', String(ALICE_SOCKS_PORT),
      '--ControlPort', '9061',
      '--CookieAuthentication', '1',
      '--DataDirectory', ALICE_DATA_DIR,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    const timer = setTimeout(() => reject(new Error('Alice Tor timeout')), 90_000)
    let resolved = false

    const onData = (d: Buffer) => {
      const line = d.toString()
      if (!resolved && (line.includes('Bootstrapped 100%') || line.includes('Bootstrapped 100 percent'))) {
        clearTimeout(timer)
        resolved = true
        resolve(() => proc.kill())
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('exit', code => { if (!resolved) reject(new Error(`Alice Tor exited: ${code}`)) })
  })
}

async function main() {
  console.log('=== GhostCall E2E Call Test (Alice — independent Tor) ===')
  console.log(`Bob:      ${BOB_ONION}`)
  console.log(`Duration: ${CALL_DURATION_S}s`)

  console.log('\n[1] Starting Alice\'s Tor (port 9060)...')
  const stopTor = await startAliceTor()
  console.log('    Alice Tor ready')

  const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP)

  console.log('[2] Connecting to Bob via Alice\'s Tor SOCKS5...')
  const socket = await connectToOnion(BOB_ONION, { host: '127.0.0.1', port: ALICE_SOCKS_PORT })
  console.log('    TCP connected through Tor')

  console.log('[3] Noise_XX handshake...')
  const keys = noiseKeygen()
  const transport = await NoiseSession.handshakeInitiator(socket, keys.secretKey)
  console.log('    Handshake complete — ChaCha20-Poly1305 (Noise_XX) established')

  console.log(`[4] Sending ${CALL_DURATION_S}s of 440Hz test tone (Opus encoded)...`)
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

  console.log(`\n\n[5] Call complete — ${framesSent} frames sent`)
  console.log(`    Sent ${(framesSent * FRAME_SIZE / SAMPLE_RATE).toFixed(1)}s of audio`)
  socket.destroy()
  stopTor()
  console.log('\n✓ ALICE E2E TEST PASSED')
  process.exit(0)
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
