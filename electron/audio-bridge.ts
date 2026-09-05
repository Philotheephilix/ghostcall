import type { WebContents } from 'electron'
import type { NoiseTransport } from './noise-session'
import { ipcMain } from 'electron'

// Raw PCM Int16 passthrough — renderer sends 256-sample chunks, forwarded directly.
// Noise_XX encrypts every frame in transit; no codec layer needed.

let activeTransport: NoiseTransport | null = null
let activeWebContents: WebContents | null = null

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
    wc.send('audio:inbound-frame', frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength))
  }
}

let ipcHandlerRegistered = false

export function registerAudioIpcHandlers(): void {
  if (ipcHandlerRegistered) return
  ipcHandlerRegistered = true

  ipcMain.on('audio:outbound-frame', (_event, data: ArrayBuffer) => {
    if (!activeTransport) return
    activeTransport.send(Buffer.from(data))
  })
}
