import type { WebContents } from 'electron'
import type { NoiseTransport } from './noise-session'
import { ipcMain } from 'electron'

// Opus codec runs in Node (main process) — avoids WASM sync-fetch issue in Chromium renderer
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpusScript = require('opusscript') as {
  new(sr: number, ch: number, app?: number): { encode(pcm: Buffer, frameSize: number): Buffer; decode(data: Buffer): Buffer }
  Application: { VOIP: number }
}

const SAMPLE_RATE = 16000
const FRAME_SIZE = 320
const CHANNELS = 1

// Lazy-init codecs on first use
let encoder: InstanceType<typeof OpusScript> | null = null
let decoder: InstanceType<typeof OpusScript> | null = null

function getEncoder() {
  if (!encoder) encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP)
  return encoder
}
function getDecoder() {
  if (!decoder) decoder = new OpusScript(SAMPLE_RATE, CHANNELS)
  return decoder
}

let activeTransport: NoiseTransport | null = null
let activeWebContents: WebContents | null = null

/**
 * Set the active Noise transport and start piping audio.
 *
 * Outbound path: renderer → PCM Int16 IPC → main Opus encode → Noise encrypt → Tor
 * Inbound path:  Tor → Noise decrypt → main Opus decode → PCM Int16 IPC → renderer
 */
export function setActiveTransport(transport: NoiseTransport, wc: WebContents): void {
  clearTransport()
  activeTransport = transport
  activeWebContents = wc
  void pumpInbound(transport, wc)
}

export function isTransportActive(): boolean { return activeTransport !== null }

export function clearTransport(): void {
  activeTransport = null
  activeWebContents = null
}

async function pumpInbound(transport: NoiseTransport, wc: WebContents): Promise<void> {
  for await (const frame of transport.recv) {
    if (activeTransport !== transport) break
    if (wc.isDestroyed()) break
    try {
      // Decode Opus frame → PCM Int16, send to renderer for playback
      const pcm16: Buffer = getDecoder().decode(frame)
      wc.send('audio:inbound-frame', pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength))
    } catch { /* skip malformed frame */ }
  }
}

let ipcHandlerRegistered = false

export function registerAudioIpcHandlers(): void {
  if (ipcHandlerRegistered) return
  ipcHandlerRegistered = true

  // Renderer sends raw PCM Int16 frames; we Opus-encode then push to Noise transport
  ipcMain.on('audio:outbound-frame', (_event, data: ArrayBuffer) => {
    if (!activeTransport) return
    try {
      const pcm16 = Buffer.from(data)
      const opus = getEncoder().encode(pcm16, FRAME_SIZE)
      activeTransport.send(opus)
    } catch { /* transport error — caller handles via hangup */ }
  })
}
