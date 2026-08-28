import type { WebContents } from 'electron'
import type { NoiseTransport } from './noise-session'
import { ipcMain } from 'electron'

let activeTransport: NoiseTransport | null = null
let activeWebContents: WebContents | null = null

/**
 * Set the active Noise transport and start piping audio.
 *
 * - Outbound: renderer sends 'audio:outbound-frame' (ArrayBuffer) → main encrypts → Noise/Tor
 * - Inbound:  Noise/Tor recv loop → main decrypts → pushes 'audio:inbound-frame' to renderer
 */
export function setActiveTransport(transport: NoiseTransport, wc: WebContents): void {
  clearTransport()
  activeTransport = transport
  activeWebContents = wc

  // Start inbound pump
  void pumpInbound(transport, wc)
}

export function clearTransport(): void {
  activeTransport = null
  activeWebContents = null
}

async function pumpInbound(transport: NoiseTransport, wc: WebContents): Promise<void> {
  for await (const frame of transport.recv) {
    if (activeTransport !== transport) break // transport was replaced
    if (wc.isDestroyed()) break
    wc.send('audio:inbound-frame', frame.buffer.slice(
      frame.byteOffset,
      frame.byteOffset + frame.byteLength,
    ))
  }
}

// IPC handler: renderer → main → Noise → Tor
// Registered once at app startup
let ipcHandlerRegistered = false

export function registerAudioIpcHandlers(): void {
  if (ipcHandlerRegistered) return
  ipcHandlerRegistered = true

  ipcMain.on('audio:outbound-frame', (_event, data: ArrayBuffer) => {
    if (!activeTransport) return
    const buf = Buffer.from(data)
    try {
      activeTransport.send(buf)
    } catch {
      // transport error — caller should handle via hangup
    }
  })
}
