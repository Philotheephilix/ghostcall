import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { torManager } from './tor-manager'
import { onionServer } from './onion-server'
import { noiseKeygen, NoiseSession } from './noise-session'
import { connectToOnion, ONION_ADDR_RE } from './onion-client'
import { setActiveTransport, clearTransport, isTransportActive, registerAudioIpcHandlers } from './audio-bridge'
import { runSender, runReceiver, clearFileTransfer } from './file-bridge'

const ONION_PORT = 7331

let currentOnionAddr: string | null = null
let isOnline = false

// Active-call snapshot mirroring the last 'call:connected' event. The renderer
// pulls this on mount (call:current-state) so a fire-and-forget 'call:connected'
// push that lands while no page is listening (startup / navigation teardown) is
// still recoverable — otherwise the callee's audio connects but the UI never
// switches to /call. Cleared on hangUp.
let activeCall: { direction: string; onionAddr?: string } | null = null

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
  // separately by the call:go-online IPC handler via startInboundListener().
  const onionAddr = await torManager.addOnion(ONION_PORT)
  currentOnionAddr = onionAddr
  isOnline = true

  return onionAddr
}

/**
 * Bind the inbound TCP listener on ONION_PORT, then accept the first connection
 * and complete the Noise_XX handshake as responder.
 *
 * Returns a Promise that resolves once the TCP socket is *bound* (i.e. the port
 * is ready to accept connections). The actual handshake and audio wiring happen
 * asynchronously after bind — the caller must NOT await those; it only needs to
 * know the port is open before publishing the Nostr offer so the callee's
 * dial-back doesn't race an unbound socket.
 *
 * @returns Promise that resolves when listen() has bound the port.
 */
export function startInboundListener(
  noiseStaticPriv: Uint8Array,
  win: BrowserWindow,
): Promise<void> {
  // Already listening — port is bound, nothing to do. The noiseStaticPriv for
  // the active listener is intentionally kept; re-keying mid-session would race
  // an in-progress handshake. A fresh key is always generated when the server is
  // closed and re-opened (hangUp → goOnline).
  if (onionServer.isListening()) return Promise.resolve()

  // connectionPending guards the window between connection arrival and transport
  // activation. isTransportActive() alone is insufficient — it only becomes true
  // after the async handshake resolves, leaving a race where a second connection
  // arrives mid-handshake and also passes the guard, corrupting the audio bridge.
  let connectionPending = false

  const listenReady = onionServer.listen(ONION_PORT, async (socket) => {
    if (isTransportActive() || connectionPending) {
      socket.destroy()
      return
    }
    connectionPending = true
    try {
      const transport = await NoiseSession.handshakeResponder(socket, noiseStaticPriv)
      setActiveTransport(transport, win.webContents)
      activeCall = { direction: 'inbound' }
      win.webContents.send('call:connected', { direction: 'inbound' })
    } catch (err) {
      connectionPending = false
      socket.destroy()
      win.webContents.send('call:error', { message: String(err) })
    }
  })

  return listenReady
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
    activeCall = { direction: 'outbound', onionAddr }
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
  activeCall = null

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

  // Renderer pulls the active-call snapshot on mount to recover a missed
  // 'call:connected' push (see the activeCall declaration above).
  ipcMain.handle('call:current-state', async () => activeCall)

  ipcMain.handle('call:go-online', async () => {
    try {
      const addr = await goOnline()
      const noiseKeys = noiseKeygen()
      // Await the TCP bind so the port is ready BEFORE the renderer publishes
      // a Nostr offer. If the offer is delivered quickly (fast relay + fast Tor
      // circuit), the callee could dial back before listen() has bound — causing
      // ECONNREFUSED through Tor and no audio. The handshake and audio wiring
      // still happen asynchronously inside the connection callback.
      await startInboundListener(noiseKeys.secretKey, win)
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

  // ── File transfer session handlers ────────────────────────────────────────
  // Reuse same onion/Noise_XX machinery; route transport to file bridge instead
  // of audio bridge. Sender goes online, publishes Nostr offer with type=file;
  // receiver dials back via file:connect.

  ipcMain.handle('file:go-online', async (_e, { filePath, transferId }: { filePath: string; transferId: string }) => {
    // Reject if an audio call is active — audio and file share the same onion server
    if (isTransportActive()) throw new Error('Cannot start file transfer while a call is active')

    try {
      const addr = await goOnline()
      const noiseKeys = noiseKeygen()

      // Bind the inbound listener for the file sender, replacing any prior listener.
      // Always re-close and re-listen so a new file pick gets a fresh callback with
      // the correct filePath/transferId and pending resets to false.
      if (onionServer.isListening()) await onionServer.close()
      let pending = false
      await onionServer.listen(ONION_PORT, async (socket) => {
        if (isTransportActive() || pending) { socket.destroy(); return }
        pending = true
        try {
          const transport = await NoiseSession.handshakeResponder(socket, noiseKeys.secretKey)
          pending = false  // reset so a retry after failure can connect
          runSender(transport, filePath, win, transferId).catch((e: Error) => {
            win.webContents.send('file:error', { transferId, message: e.message })
          })
        } catch (err) {
          pending = false
          socket.destroy()
        }
      })
      return { onionAddr: addr }
    } catch (err) {
      throw new Error(`file:go-online failed: ${err}`)
    }
  })

  ipcMain.handle('file:connect', async (_e, { onionAddr }: { onionAddr: string }) => {
    if (typeof onionAddr !== 'string' || !ONION_ADDR_RE.test(onionAddr)) {
      throw new Error(`Invalid onion address: ${onionAddr}`)
    }
    const noiseKeys = noiseKeygen()
    const socks = torManager.getSocksProxy()
    const socket = await connectToOnion(onionAddr, socks)
    const transport = await NoiseSession.handshakeInitiator(socket, noiseKeys.secretKey)
    // Receiver role: dial in, receive file. Pass preAccepted=true — user accepted
    // the FileTransferModal before fileConnect was called, so skip re-showing the modal.
    runReceiver(transport, win, true).catch((e: Error) => {
      win.webContents.send('file:error', { transferId: '', message: e.message })
    })
    return { ok: true }
  })

  ipcMain.handle('file:hang-up', async () => {
    clearFileTransfer()
    // Only tear down the onion service if there's no active audio call sharing it
    if (!isTransportActive()) await hangUp()
    return { ok: true }
  })
}
