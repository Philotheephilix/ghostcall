import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'

// Load .env — try the project root (dev) first, then userData (packaged installs).
// Users can place a .env file in ~/Library/Application Support/GhostCall/ to
// configure their own RPC URL, Nostr relay, etc. without rebuilding.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.join(__dirname, '../../.env') })
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.join(app.getPath('userData'), '.env'), override: false })

// Fallback RPC URL — public Starknet Sepolia node (no key required).
// Override with STARKNET_RPC_URL in .env (or userData/.env) for mainnet or
// a private Alchemy/Infura endpoint.
if (!process.env.STARKNET_RPC_URL) {
  process.env.STARKNET_RPC_URL = 'https://starknet-sepolia-rpc.publicnode.com'
}
import { torManager } from './tor-manager'
import { registerCallIpcHandlers } from './call-orchestrator'
import { runIdentityStartupSequence, registerIdentityIpcHandlers, onAccountReady, handleZkeyCallback } from './identity-manager'
import type { Account } from 'starknet'

// Session state — populated during the call flow
interface SessionState {
  account: Account | null
  // Full StealthMeta from starknet:lookup — used to derive one-time stealth address at payment time
  calleeMeta: import('../renderer/lib/stealth-keys').StealthMeta | null
  viewingKey: bigint
}

const sessionState: SessionState = {
  account: null,
  calleeMeta: null,
  viewingKey: 0n,
}

let win: BrowserWindow | null = null

// Populate sessionState.account whenever identity-manager initialises the client
onAccountReady(async (account: Account) => {
  sessionState.account = account
  // Derive viewing key from session private key so strk20:pay has a valid scalar
  const { getSessionPrivKey } = await import('./identity-manager')
  const { deriveStealthKeypairFromPrivKey } = await import('../renderer/lib/stealth-keys')
  try {
    const privKey = getSessionPrivKey()
    const kp = deriveStealthKeypairFromPrivKey(privKey)
    sessionState.viewingKey = kp.skV
  } catch {
    // identity not loaded yet — viewingKey stays 0n, will be set by starknet:register
  }
})

// Single instance lock — required for Windows OAuth callback via second-instance event
// Must be called before app.whenReady()
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', (_e, argv) => {
  // Windows: OAuth redirect URL arrives in argv
  const url = argv.find((a: string) => a.startsWith('ghostcall://'))
  if (url) {
    if (win) {
      handleZkeyCallback(url)
    } else {
      // win not yet created — defer until after whenReady creates the window
      app.once('browser-window-created', () => handleZkeyCallback(url))
    }
  }
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

  // Map file:// navigation to the correct static files inside the asar.
  // Next.js static export produces flat files (onboarding.html, home.html …)
  // and asset chunks (renderer/out/_next/static/…). Renderer code navigates
  // with absolute paths (/onboarding, /home) which Electron resolves as
  // file:///onboarding — a non-existent filesystem path.
  //
  // Strategy: path has a file extension → asset, resolve under outDir.
  //           path has no extension     → SPA route, map to <route>.html.
  // asar files are virtual so fs.existsSync is not used for routing logic.
  if (process.env.NODE_ENV !== 'development') {
    const outDir = path.join(__dirname, '../../renderer/out')
    session.defaultSession.protocol.interceptFileProtocol('file', (request, callback) => {
      // Extract pathname (drop scheme, query, hash)
      let reqPath = request.url
        .replace(/^file:\/\//, '')
        .split('?')[0]
        .split('#')[0]
      try { reqPath = decodeURIComponent(reqPath) } catch { /* leave as-is */ }

      // If the path already sits under outDir (asset already rooted correctly), serve as-is
      if (reqPath.startsWith(outDir)) {
        callback({ path: reqPath })
        return
      }

      const hasExtension = /\.[a-zA-Z0-9]+$/.test(reqPath)

      if (hasExtension) {
        // Asset request (JS chunk, CSS, wasm, image …).
        // reqPath is something like /_next/static/chunks/foo.js — prepend outDir.
        callback({ path: path.join(outDir, reqPath) })
      } else {
        // SPA route (/onboarding, /home, /call …) → flat HTML file.
        const segment = reqPath.replace(/\/$/, '').split('/').pop() || 'index'
        const htmlFile = path.join(outDir, segment === 'index' ? 'index.html' : `${segment}.html`)
        callback({ path: htmlFile })
      }
    })
  }

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

  // Register call IPC handlers — pass hooks to clear stale session state on each call
  registerCallIpcHandlers(win, {
    onInitiate: () => {
      sessionState.calleeMeta = null  // clear stale callee; populated by starknet:lookup for handle calls
      sessionState.viewingKey = 0n
    },
    onHangUp: () => {
      sessionState.calleeMeta = null
    },
  })

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
  const { getAccount, registerHandle, isRegistered, deployAccountIfNeeded } = await import('../renderer/lib/starknet-client')
  const { deriveStealthKeypairFromPrivKey } = await import('../renderer/lib/stealth-keys')
  const { getSessionPrivKey } = await import('./identity-manager')
  getAccount() // ensure client initialised
  const kp = deriveStealthKeypairFromPrivKey(getSessionPrivKey())
  sessionState.viewingKey = kp.skV
  // If the handle is already registered, skip the tx (idempotent onboarding)
  if (await isRegistered(handle)) {
    return 'already-registered'
  }
  // Deploy the account if it doesn't exist on-chain yet (counterfactual → deployed)
  await deployAccountIfNeeded()
  return registerHandle(handle, kp)
})

ipcMain.handle('starknet:lookup', async (_e, { handle }: { handle: string }) => {
  const { lookupHandle } = await import('../renderer/lib/starknet-client')
  const meta = await lookupHandle(handle)
  // Store full StealthMeta — stealth address is derived at payment time using
  // the ERC-5564 protocol: r·G + pkV gives the one-time recipient address
  sessionState.calleeMeta = meta
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
  const { sendShieldedPayment } = await import('../renderer/lib/strk20-payment')
  if (!sessionState.account) {
    throw new Error('Starknet account not initialised — complete onboarding first')
  }
  if (!sessionState.calleeMeta) {
    throw new Error('No callee identity in session — starknet:lookup must be called before payment')
  }
  const txHash = await sendShieldedPayment(
    sessionState.calleeMeta,
    BigInt(amount),
    sessionState.account,
    sessionState.viewingKey,
  )
  return txHash
})
