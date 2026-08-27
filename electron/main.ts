import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'

let win: BrowserWindow | null = null

app.whenReady().then(() => {
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
})

app.on('window-all-closed', () => app.quit())

// IPC stubs — filled in by later tasks
ipcMain.handle('tor:status', async () => ({ running: false }))
