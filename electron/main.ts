import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { torManager } from './tor-manager'
import { registerCallIpcHandlers } from './call-orchestrator'
import { initStarknetClient } from '../renderer/lib/starknet-client'
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

app.whenReady().then(async () => {
  // Initialise Starknet client from env (no-op if env vars missing — dev mode)
  if (
    process.env.STARKNET_ACCOUNT_ADDRESS &&
    process.env.STARKNET_PRIVATE_KEY &&
    process.env.STARKNET_RPC_URL
  ) {
    initStarknetClient(
      process.env.STARKNET_RPC_URL,
      process.env.STARKNET_ACCOUNT_ADDRESS,
      process.env.STARKNET_PRIVATE_KEY,
    )
    // Cache the Account instance for payment use
    const { getAccount } = await import('../renderer/lib/starknet-client')
    sessionState.account = getAccount()
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
    : `file://${path.join(__dirname, '../renderer/out/index.html')}`
  win.loadURL(url)

  // Register call IPC handlers
  registerCallIpcHandlers(win)

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
  const { getAccount, registerHandle } = await import('../renderer/lib/starknet-client')
  const { deriveStealthKeypairFromPrivKey } = await import('../renderer/lib/stealth-keys')
  const account = getAccount()
  const kp = deriveStealthKeypairFromPrivKey(BigInt(process.env.STARKNET_PRIVATE_KEY ?? '0x1'))
  sessionState.viewingKey = kp.skV
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
let nostrUnsubscribe: (() => void) | null = null

ipcMain.handle('nostr:publish', async (_e, { payload }: { payload: string }) => {
  const { publishToRelay } = await import('../renderer/lib/nostr-signal')
  const relay = process.env.NOSTR_RELAY_URL ?? 'wss://relay.primal.net'
  await publishToRelay(relay, payload)
})

ipcMain.handle('nostr:subscribe', async (_e, { myPubHex }: { myPubHex: string }) => {
  const { subscribeIncoming } = await import('../renderer/lib/nostr-signal')
  const relay = process.env.NOSTR_RELAY_URL ?? 'wss://relay.primal.net'
  if (nostrUnsubscribe) { nostrUnsubscribe(); nostrUnsubscribe = null }
  nostrUnsubscribe = subscribeIncoming(relay, myPubHex, (raw: string) => {
    win?.webContents.send('nostr:incoming', raw)
  })
  return { subscribed: true }
})

ipcMain.handle('nostr:unsubscribe', async () => {
  if (nostrUnsubscribe) { nostrUnsubscribe(); nostrUnsubscribe = null }
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
