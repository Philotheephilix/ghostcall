import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { torManager } from './tor-manager'
import { onionServer } from './onion-server'
import { NoiseSession } from './noise-session'
import { connectToOnion, ONION_ADDR_RE } from './onion-client'
import { setActiveTransport, clearTransport, isTransportActive, registerAudioIpcHandlers } from './audio-bridge'
import { noiseKeygen } from './noise-session'

const ONION_PORT = 7331

let currentOnionAddr: string | null = null
let isOnline = false

/**
 * Start listening for incoming calls.
 * Creates an onion service and waits for the first inbound TCP connection,
 * then performs the Noise_XX handshake as responder.
 * Returns the full onion address "abc...onion:7331".
 */
export async function goOnline(): Promise<string> {
  if (isOnline) {
    return currentOnionAddr!
  }

  // Create ephemeral onion service. The inbound TCP listener is started
  // separately by the call:go-online IPC handler via waitForInboundCall().
  const onionAddr = await torManager.addOnion(ONION_PORT)
  currentOnionAddr = onionAddr
  isOnline = true

  return onionAddr
}

/**
 * Accept a single inbound connection, complete Noise handshake as responder,
 * and wire up the audio bridge.
 */
export async function waitForInboundCall(
  noiseStaticPriv: Uint8Array,
  win: BrowserWindow,
): Promise<void> {
  // Skip if already listening (e.g. goOnline called twice without hangUp between)
  if (onionServer.isListening()) return

  return new Promise((resolve, reject) => {
    onionServer.listen(ONION_PORT, async (socket) => {
      // Reject second inbound connection if already in a call
      if (isTransportActive()) {
        socket.destroy()
        return
      }
      try {
        const transport = await NoiseSession.handshakeResponder(socket, noiseStaticPriv)
        setActiveTransport(transport, win.webContents)
        win.webContents.send('call:connected', { direction: 'inbound' })
        resolve()
      } catch (err) {
        socket.destroy()
        reject(err)
      }
    }).catch(reject)
  })
}

/**
 * Initiate an outbound call to the given onion address.
 * Connects via SOCKS5, performs Noise_XX handshake as initiator,
 * and wires up the audio bridge.
 */
export async function initiateCall(
  onionAddr: string,
  noiseStaticPriv: Uint8Array,
  win: BrowserWindow,
): Promise<void> {
  const socks = torManager.getSocksProxy()
  const socket = await connectToOnion(onionAddr, socks)

  try {
    const transport = await NoiseSession.handshakeInitiator(socket, noiseStaticPriv)
    setActiveTransport(transport, win.webContents)
    win.webContents.send('call:connected', { direction: 'outbound', onionAddr })
  } catch (err) {
    socket.destroy()
    throw err
  }
}

/**
 * Tear down active call and onion service.
 */
export async function hangUp(): Promise<void> {
  clearTransport()

  if (currentOnionAddr) {
    const serviceId = currentOnionAddr.replace(/\.onion:\d+$/, '')
    currentOnionAddr = null
    isOnline = false
    try {
      await onionServer.close()
    } catch { /* ignore */ }
    try {
      await torManager.removeOnion(serviceId)
    } catch { /* ignore */ }
  }
}

export interface CallIpcHooks {
  /** Called at the start of call:initiate — use to clear stale session state */
  onInitiate?: () => void
  /** Called at the start of call:hang-up — use to clear stale session state */
  onHangUp?: () => void
}

/**
 * Register all call-related IPC handlers.
 * Call once from main process after window is created.
 */
export function registerCallIpcHandlers(win: BrowserWindow, hooks: CallIpcHooks = {}): void {
  registerAudioIpcHandlers()

  ipcMain.handle('call:go-online', async () => {
    try {
      const addr = await goOnline()
      // Start waiting for inbound in background
      // Generate fresh noise key for this session
      const noiseKeys = noiseKeygen()
      waitForInboundCall(noiseKeys.secretKey, win).catch((err) => {
        win.webContents.send('call:error', { message: String(err) })
      })
      return { onionAddr: addr }
    } catch (err) {
      throw new Error(`goOnline failed: ${err}`)
    }
  })

  ipcMain.handle('call:initiate', async (_e, { onionAddr }: { onionAddr: string }) => {
    // Clear stale callee address so direct-dial pay uses fresh lookup
    hooks.onInitiate?.()
    // Validate format before passing to SOCKS5 — prevents injection via renderer input
    if (typeof onionAddr !== 'string' || !ONION_ADDR_RE.test(onionAddr)) {
      throw new Error(`Invalid onion address format: ${onionAddr}`)
    }
    const noiseKeys = noiseKeygen()
    await initiateCall(onionAddr, noiseKeys.secretKey, win)
    return { ok: true }
  })

  ipcMain.handle('call:hang-up', async () => {
    // Clear callee address on hang-up to prevent stale data on next call
    hooks.onHangUp?.()
    await hangUp()
    return { ok: true }
  })
}
