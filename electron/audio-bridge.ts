import type { WebContents } from 'electron'
import type { NoiseTransport } from './noise-session'
import { ipcMain } from 'electron'

// Opus codec in main process (Node) — avoids Chromium WASM sync-fetch restriction.
// Uses the asm.js (nasm) build — pure JavaScript, no .wasm file needed.
// The nasm/wasm JS files are copied to dist/electron/ alongside main.js by bundle:electron,
// so they're available both in dev (node_modules) and in the packaged asar.
import path from 'path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nasmPath = path.join(__dirname, 'opusscript_native_nasm.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wasmPath = path.join(__dirname, 'opusscript_native_wasm.js')
// Pre-load nasm; redirect the wasm module key to use the nasm build instead
// eslint-disable-next-line @typescript-eslint/no-require-imports
require(nasmPath)
// Make the wasm require path return the nasm module
require.cache[wasmPath] = require.cache[nasmPath]
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpusScript = require('opusscript') as {
  new(sr: number, ch: number, app?: number): { encode(pcm: Buffer, frameSize: number): Buffer; decode(data: Buffer): Buffer }
  Application: { VOIP: number }
}

// 16kHz, 320-sample Opus frames (20ms) — lowest-latency valid Opus frame size.
// ScriptProcessor sends 256-sample buffers; we accumulate and encode when we have ≥320.
const SAMPLE_RATE = 16000
const OPUS_FRAME = 320   // valid Opus frame at 16kHz (20ms) — min latency
const CHANNELS = 1

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

// Accumulation buffer: renderer sends 256-sample chunks, we encode 320 at a time
let pcmAccum = Buffer.alloc(0)

export function setActiveTransport(transport: NoiseTransport, wc: WebContents): void {
  clearTransport()
  activeTransport = transport
  activeWebContents = wc
  pcmAccum = Buffer.alloc(0)
  void pumpInbound(transport, wc)
}

export function isTransportActive(): boolean { return activeTransport !== null }

export function clearTransport(): void {
  activeTransport = null
  activeWebContents = null
  pcmAccum = Buffer.alloc(0)
}

async function pumpInbound(transport: NoiseTransport, wc: WebContents): Promise<void> {
  for await (const frame of transport.recv) {
    if (activeTransport !== transport) break
    if (wc.isDestroyed()) break
    try {
      const pcm16 = getDecoder().decode(frame)
      wc.send('audio:inbound-frame', pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength))
    } catch (e) { console.error('[Audio] decode error:', (e as Error).message) }
  }
}

let ipcHandlerRegistered = false

export function registerAudioIpcHandlers(): void {
  if (ipcHandlerRegistered) return
  ipcHandlerRegistered = true

  ipcMain.on('audio:outbound-frame', (_event, data: ArrayBuffer) => {
    if (!activeTransport) return
    // Accumulate PCM Int16 until we have a full Opus frame worth
    pcmAccum = Buffer.concat([pcmAccum, Buffer.from(data)])
    const frameSizeBytes = OPUS_FRAME * 2  // Int16 = 2 bytes per sample
    while (pcmAccum.byteLength >= frameSizeBytes) {
      const chunk = pcmAccum.slice(0, frameSizeBytes)
      pcmAccum = pcmAccum.slice(frameSizeBytes)
      try {
        const opus = getEncoder().encode(chunk, OPUS_FRAME)
        activeTransport.send(opus)
      } catch (e) { console.error('[Audio] encode error:', (e as Error).message) }
    }
  })
}
