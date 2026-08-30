import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
// Load .env before anything else — must be first
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.join(__dirname, '../../.env') })
import { torManager } from './tor-manager'
import { registerCallIpcHandlers } from './call-orchestrator'
import { runIdentityStartupSequence, registerIdentityIpcHandlers, onAccountReady, handleZkeyCallback } from './identity-manager'
import { sendShieldedPayment } from '../renderer/lib/strk20-payment'
import type { Account } from 'starknet'

// Session state — populated during the call flow:
//   • starknet:register / starknet:lookup set up the account
//   • call:initiate stores the callee's stealth address
interface SessionState {
  account: Account | null
  calleeStealthAddr: string
  viewingKey: bigint
}

const sessionState: SessionState = {
  account: null,
  calleeStealthAddr: '',
  viewingKey: 0n,
}

let win: BrowserWindow | null = null

// Populate sessionState.account whenever identity-manager initialises the client
onAccountReady((account: Account) => {
  sessionState.account = account
})

// Single instance lock — required for Windows OAuth callback via second-instance event
// Must be called before app.whenReady()
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', (_e, argv) => {
  // Windows: OAuth redirect URL arrives in argv
  const url = argv.find((a: string) => a.startsWith('ghostcall://'))
  if (url) handleZkeyCallback(url)
  if (win) win.focus() // focus the existing window on any second-instance launch (including non-OAuth)
})

app.setAsDefaultProtocolClient('ghostcall')

app.on('open-url', (_e, url) => {
  // macOS: OAuth redirect URL arrives here
  handleZkeyCallback(url)
})

app.whenReady().then(async () => {
  // Starknet client init is handled by runIdentityStartupSequence below.

  // Request macOS system-level microphone access
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron') as typeof import('electron')
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus !== 'granted') {
      await systemPreferences.askForMediaAccess('microphone')
    }
  }

  // Grant microphone permission for getUserMedia inside the renderer
  const { session } = require('electron') as typeof import('electron')
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'camera', 'audioCapture', 'videoCapture']
    callback(allowed.includes(permission))
  })
  // Also required for macOS Sonoma+: set media access permission at system level
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const allowed = ['media', 'microphone', 'camera', 'audioCapture', 'videoCapture']
    return allowed.includes(permission)
  })

  win = new BrowserWindow({
    width: 420,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const url = process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../../renderer/out/index.html')}`
  win.loadURL(url)

  // Register call IPC handlers
  registerCallIpcHandlers(win)

  // Register identity IPC handlers and run startup sequence on load
  registerIdentityIpcHandlers(win)
  win.webContents.once('did-finish-load', () => {
    runIdentityStartupSequence(win!)
  })

  // Start Tor (non-blocking — app works without Tor, calls require it)
  torManager.start().then(() => {
    console.log('[GhostCall] Tor bootstrapped, SOCKS5 on :9050')
    win?.webContents.send('tor:status-update', { running: true })
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[GhostCall] Tor unavailable:', msg)
    win?.webContents.send('tor:status-update', {
      running: false,
      error: 'Tor is not available. Install Tor (brew install tor) and restart GhostCall.',
    })
  })
})

app.on('window-all-closed', () => app.quit())

app.on('before-quit', () => torManager.stop())

// IPC stubs for Tor management
ipcMain.handle('tor:status', async () => ({
  running: torManager.isRunning(),
  socksProxy: torManager.getSocksProxy(),
}))

ipcMain.handle('tor:add-onion', async (_e, { port }: { port?: number } = {}) => {
  return torManager.addOnion(port)
})

ipcMain.handle('tor:remove-onion', async (_e, { serviceId }: { serviceId: string }) => {
  return torManager.removeOnion(serviceId)
})

// Starknet identity IPC handlers
ipcMain.handle('starknet:register', async (_e, { handle }: { handle: string }) => {
  const { getAccount, registerHandle, isRegistered } = await import('../renderer/lib/starknet-client')
  const { deriveStealthKeypairFromPrivKey } = await import('../renderer/lib/stealth-keys')
  const { getSessionPrivKey } = await import('./identity-manager')
  getAccount() // ensure client initialised
  const kp = deriveStealthKeypairFromPrivKey(getSessionPrivKey())
  sessionState.viewingKey = kp.skV
  // If the handle is already registered, skip the tx (idempotent onboarding)
  if (await isRegistered(handle)) {
    return 'already-registered'
  }
  return registerHandle(handle, kp)
})

ipcMain.handle('starknet:lookup', async (_e, { handle }: { handle: string }) => {
  const { lookupHandle } = await import('../renderer/lib/starknet-client')
  const meta = await lookupHandle(handle)
  // Store the nostr pubkey as a proxy for stealth addr (real stealth addr derived on payment)
  sessionState.calleeStealthAddr = '0x' + meta.nostrPubkey
  return meta
})

ipcMain.handle('starknet:commitCall', async (_e, { callId }: { callId: string }) => {
  const { commitCall } = await import('../renderer/lib/starknet-client')
  return commitCall(callId)
})

// Nostr signaling IPC handlers
const NOSTR_RELAY = process.env.NOSTR_RELAY_URL ?? 'wss://relay.primal.net'
let nostrUnsubscribe: (() => void) | null = null

function clearNostrSubscription() {
  nostrUnsubscribe?.()
  nostrUnsubscribe = null
}

ipcMain.handle('nostr:publish', async (_e, { payload }: { payload: string }) => {
  const { publishToRelay } = await import('../renderer/lib/nostr-signal')
  await publishToRelay(NOSTR_RELAY, payload)
})

ipcMain.handle('nostr:subscribe', async (_e, { myPubHex }: { myPubHex: string }) => {
  const { subscribeIncoming } = await import('../renderer/lib/nostr-signal')
  clearNostrSubscription()
  nostrUnsubscribe = subscribeIncoming(NOSTR_RELAY, myPubHex, (raw: string) => {
    win?.webContents.send('nostr:incoming', raw)
  })
  return { subscribed: true }
})

ipcMain.handle('nostr:unsubscribe', async () => {
  clearNostrSubscription()
})

// STRK20 payment IPC handler
ipcMain.handle('strk20:pay', async (_e, { amount }: { amount: string }) => {
  if (!sessionState.account) {
    throw new Error('Starknet account not initialised — set STARKNET_ACCOUNT_ADDRESS, STARKNET_PRIVATE_KEY, STARKNET_RPC_URL in .env')
  }
  if (!sessionState.calleeStealthAddr) {
    throw new Error('No callee stealth address in session — lookup must be called before payment')
  }
  const txHash = await sendShieldedPayment(
    sessionState.calleeStealthAddr,
    BigInt(amount),
    sessionState.account,
    sessionState.viewingKey,
  )
  return txHash
})
