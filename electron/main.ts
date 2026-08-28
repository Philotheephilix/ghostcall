import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { torManager } from './tor-manager'
import { registerCallIpcHandlers } from './call-orchestrator'

let win: BrowserWindow | null = null

app.whenReady().then(async () => {
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
