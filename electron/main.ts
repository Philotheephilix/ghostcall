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

  // Start Tor (non-blocking)
  torManager.start().then(() => {
    console.log('Tor started, SOCKS5 on :9050')
  }).catch((e: unknown) => {
    console.error('Tor failed to start:', e)
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
