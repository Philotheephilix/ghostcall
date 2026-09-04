import * as fs from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { ipcMain, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import type { NoiseTransport } from './noise-session'
import { demux, MSG_FILE_META, MSG_FILE_CHUNK, MSG_FILE_ACK } from './demux'

// Noise frames carry a uint16 length field (max 65535). With Poly1305 tag (16 bytes)
// and demux type prefix (1 byte) and chunk header (20 bytes), max data = 65535-37 = 65498.
// Use 60KB to stay well under and leave room for any future framing additions.
const CHUNK_SIZE = 60 * 1024
const MAX_FILE_SIZE = 50 * 1024 * 1024
const MAX_CHUNKS = Math.ceil(MAX_FILE_SIZE / CHUNK_SIZE) + 1
const PROGRESS_THROTTLE_MS = 100

const ACK_OK = 0x00
const ACK_REJECTED = 0x01
const ACK_DONE = 0x02
const ACK_CANCEL = 0x03

interface ActiveTransfer {
  transferId: string
  dmx: ReturnType<typeof demux>
  cancel: () => void
}

let active: ActiveTransfer | null = null

function makeTransferId(): string {
  return randomBytes(16).toString('hex')
}

function makeAck(transferIdBuf: Buffer, status: number): Buffer {
  const ack = Buffer.allocUnsafe(17)
  transferIdBuf.copy(ack, 0)
  ack[16] = status
  return ack
}

function clearActive(transferId?: string) {
  if (!active) return
  if (transferId && active.transferId !== transferId) return
  active = null
}

// ── Sender ─────────────────────────────────────────────────────────────────

async function runSender(
  transport: NoiseTransport,
  filePath: string,
  win: BrowserWindow,
  transferId = makeTransferId(),
): Promise<void> {
  const dmx = demux(transport)
  const transferIdBuf = Buffer.from(transferId, 'hex')

  const stat = fs.statSync(filePath)
  if (stat.size > MAX_FILE_SIZE) throw new Error(`File exceeds 50 MB limit`)

  const name = path.basename(filePath)
  let cancelled = false

  active = {
    transferId,
    dmx,
    cancel() {
      cancelled = true
      dmx.send(MSG_FILE_ACK, makeAck(transferIdBuf, ACK_CANCEL))
      dmx.close()
      clearActive(transferId)
    },
  }

  const meta = Buffer.from(JSON.stringify({ name, size: stat.size, mime: 'application/octet-stream', transferId }))
  dmx.send(MSG_FILE_META, meta)

  const accepted = await new Promise<boolean>((resolve) => {
    const unsub = dmx.subscribe(MSG_FILE_ACK, (payload) => {
      if (payload.length < 17) return
      const byte = payload[16]
      if (byte === ACK_OK) {
        clearTimeout(ackTimer)
        unsub()
        resolve(true)
      } else if (byte === ACK_REJECTED || byte === ACK_CANCEL) {
        clearTimeout(ackTimer)
        cancelled = byte === ACK_CANCEL
        unsub()
        resolve(false)
      }
    })
    const ackTimer = setTimeout(() => { unsub(); resolve(false) }, 30_000)
  })

  if (!accepted || cancelled) {
    win.webContents.send('file:error', { transferId, message: cancelled ? 'Cancelled' : 'Rejected by receiver' })
    clearActive(transferId)
    dmx.close()
    return
  }

  // Keep ACK subscriber active during streaming to detect receiver cancel
  dmx.subscribe(MSG_FILE_ACK, (payload) => {
    if (payload.length >= 17 && payload[16] === ACK_CANCEL) cancelled = true
  })

  const fd = fs.openSync(filePath, 'r')
  const buf = Buffer.allocUnsafe(CHUNK_SIZE)
  let chunkIndex = 0
  let bytesSent = 0
  let lastProgress = 0

  try {
    while (bytesSent < stat.size && !cancelled) {
      const bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, bytesSent)
      if (bytesRead === 0) break

      const frame = Buffer.allocUnsafe(20 + bytesRead)
      transferIdBuf.copy(frame, 0)
      frame.writeUInt32BE(chunkIndex, 16)
      buf.copy(frame, 20, 0, bytesRead)
      dmx.send(MSG_FILE_CHUNK, frame)

      bytesSent += bytesRead
      chunkIndex++
      const now = Date.now()
      if (now - lastProgress >= PROGRESS_THROTTLE_MS || bytesSent >= stat.size) {
        win.webContents.send('file:progress', { transferId, bytesSent, total: stat.size })
        lastProgress = now
      }
    }
  } finally {
    fs.closeSync(fd)
  }

  if (cancelled) {
    clearActive(transferId)
    dmx.close()
    return
  }

  dmx.send(MSG_FILE_ACK, makeAck(transferIdBuf, ACK_DONE))

  win.webContents.send('file:done', { transferId, savedPath: filePath })
  clearActive(transferId)
  dmx.close()
}

// ── Receiver ───────────────────────────────────────────────────────────────

async function runReceiver(
  transport: NoiseTransport,
  win: BrowserWindow,
  preAccepted = false,
): Promise<void> {
  const dmx = demux(transport)
  let cancelled = false

  const meta = await new Promise<{ name: string; size: number; mime: string; transferId: string } | null>((resolve) => {
    const unsub = dmx.subscribe(MSG_FILE_META, (payload) => {
      unsub()
      try { resolve(JSON.parse(payload.toString('utf8'))) } catch { resolve(null) }
    })
    setTimeout(() => { unsub(); resolve(null) }, 30_000)
  })

  if (!meta) {
    dmx.close()
    win.webContents.send('file:error', { transferId: '', message: 'No file metadata received' })
    return
  }

  const { transferId, name, size } = meta
  const transferIdBuf = Buffer.from(transferId, 'hex')

  active = {
    transferId,
    dmx,
    cancel() {
      cancelled = true
      dmx.send(MSG_FILE_ACK, makeAck(transferIdBuf, ACK_CANCEL))
      dmx.close()
      clearActive(transferId)
    },
  }

  // preAccepted=true: user accepted via modal before fileConnect was called (direct IPC path)
  // preAccepted=false: show modal and wait for file:accept/reject IPC
  const accepted = preAccepted || await new Promise<boolean>((resolve) => {
    win.webContents.send('file:incoming', { handle: '', name, size, transferId, onionAddr: '' })
    const onAccept = () => { removeListeners(); resolve(true) }
    const onReject = () => { removeListeners(); resolve(false) }
    ipcMain.once(`file:accept:${transferId}`, onAccept)
    ipcMain.once(`file:reject:${transferId}`, onReject)
    function removeListeners() {
      ipcMain.removeListener(`file:accept:${transferId}`, onAccept)
      ipcMain.removeListener(`file:reject:${transferId}`, onReject)
    }
    setTimeout(() => { removeListeners(); resolve(false) }, 60_000)
  })

  if (!accepted || cancelled) {
    dmx.send(MSG_FILE_ACK, makeAck(transferIdBuf, ACK_REJECTED))
    clearActive(transferId)
    dmx.close()
    return
  }

  const chunks = new Map<number, Buffer>()
  let bytesReceived = 0
  let senderCancelled = false
  let lastProgress = 0

  await new Promise<void>((resolve) => {
    const unsub = dmx.subscribe(MSG_FILE_CHUNK, (payload) => {
      if (cancelled) return
      if (payload.length < 20) return
      const chunkIndex = payload.readUInt32BE(16)
      if (chunkIndex >= MAX_CHUNKS) return  // reject out-of-range indexes
      const data = payload.slice(20)
      if (!chunks.has(chunkIndex)) {
        chunks.set(chunkIndex, data)
        bytesReceived += data.length
        const now = Date.now()
        if (now - lastProgress >= PROGRESS_THROTTLE_MS || bytesReceived >= size) {
          win.webContents.send('file:progress', { transferId, bytesReceived, total: size })
          lastProgress = now
        }
      }
    })

    const unsubAck = dmx.subscribe(MSG_FILE_ACK, (payload) => {
      if (payload.length >= 17 && payload[16] === ACK_DONE) {
        unsub(); unsubAck(); resolve()
      } else if (payload.length >= 17 && payload[16] === ACK_CANCEL) {
        senderCancelled = true
        unsub(); unsubAck(); resolve()
      }
    })

    dmx.send(MSG_FILE_ACK, makeAck(transferIdBuf, ACK_OK))
  })

  if (cancelled || senderCancelled) {
    clearActive(transferId)
    dmx.close()
    return
  }

  // Reassemble in order; error loudly on gaps rather than silently truncating
  const assembled = Buffer.alloc(bytesReceived)
  let offset = 0
  for (let i = 0; i < chunks.size; i++) {
    const chunk = chunks.get(i)
    if (!chunk) {
      win.webContents.send('file:error', { transferId, message: `Missing chunk ${i} of ${chunks.size}` })
      clearActive(transferId)
      dmx.close()
      return
    }
    chunk.copy(assembled, offset)
    offset += chunk.length
  }

  const { filePath: savePath, canceled } = await dialog.showSaveDialog(win, {
    defaultPath: name,
    title: 'Save received file',
  })

  if (canceled || !savePath) {
    clearActive(transferId)
    dmx.close()
    return
  }

  fs.writeFileSync(savePath, assembled)
  win.webContents.send('file:done', { transferId, savedPath: savePath })
  clearActive(transferId)
  dmx.close()
}

// ── IPC handlers ───────────────────────────────────────────────────────────

let handlersRegistered = false

export function registerFileIpcHandlers(win: BrowserWindow): void {
  if (handlersRegistered) return
  handlersRegistered = true

  ipcMain.handle('file:accept', (_e, { transferId }: { transferId: string }) => {
    ipcMain.emit(`file:accept:${transferId}`)
    return { ok: true }
  })

  ipcMain.handle('file:reject', (_e, { transferId }: { transferId: string }) => {
    ipcMain.emit(`file:reject:${transferId}`)
    return { ok: true }
  })

  ipcMain.handle('file:cancel', () => {
    active?.cancel()
    return { ok: true }
  })

  ipcMain.handle('file:pick', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: 'Select file to send',
    })
    return canceled ? null : filePaths[0] ?? null
  })

  ipcMain.handle('file:send', async (_e, { filePath }: { filePath: string }) => {
    if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found')
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_FILE_SIZE) throw new Error('File exceeds 50 MB limit')
    const transferId = makeTransferId()
    // Return filePath so renderer can pass it directly to file:go-online — no global state needed
    return {
      filePath,
      transferId,
      name: path.basename(filePath),
      size: stat.size,
    }
  })
}

export { runSender, runReceiver, clearActive as clearFileTransfer }
