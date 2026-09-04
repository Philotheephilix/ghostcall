/**
 * @jest-environment node
 *
 * Tests for file-bridge sender/receiver state machines.
 * Uses in-memory duplex transport pairs — no Tor, no sockets.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { NoiseTransport } from '../noise-session'

// Mock electron — not available in node test env
jest.mock('electron', () => ({
  dialog: {
    showSaveDialog: jest.fn(),
    showOpenDialog: jest.fn().mockResolvedValue({ filePaths: [], canceled: true }),
  },
  ipcMain: {
    handle: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
    emit: jest.fn(),
  },
}))

// Mock call-orchestrator to avoid Tor deps
jest.mock('../call-orchestrator', () => ({
  fileSessionState: { filePath: null, transferId: null },
}))

// Import after mocks
const { runSender, runReceiver } = require('../file-bridge') as typeof import('../file-bridge')

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTransportPair(): [NoiseTransport, NoiseTransport] {
  type Frame = Buffer
  const aToB: Frame[] = []
  const bToA: Frame[] = []
  const aWaiters: Array<(f: Frame) => void> = []
  const bWaiters: Array<(f: Frame) => void> = []

  function push(queue: Frame[], waiters: Array<(f: Frame) => void>, frame: Frame) {
    if (waiters.length > 0) {
      waiters.shift()!(frame)
    } else {
      queue.push(frame)
    }
  }

  async function* makeRecv(queue: Frame[], waiters: Array<(f: Frame) => void>): AsyncIterable<Frame> {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!
      } else {
        yield await new Promise<Frame>((resolve) => waiters.push(resolve))
      }
    }
  }

  const a: NoiseTransport = {
    send: (frame: Buffer) => push(aToB, bWaiters, frame),
    recv: makeRecv(bToA, aWaiters),
  }
  const b: NoiseTransport = {
    send: (frame: Buffer) => push(bToA, aWaiters, frame),
    recv: makeRecv(aToB, bWaiters),
  }
  return [a, b]
}

function writeTempFile(content: Buffer): string {
  const p = path.join(os.tmpdir(), `ghostcall-test-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`)
  fs.writeFileSync(p, content)
  return p
}

/** Write a sparse file of given size (fast — no data allocation) */
function writeSparseFile(size: number): string {
  const p = path.join(os.tmpdir(), `ghostcall-test-${Date.now()}-sparse.bin`)
  const fd = fs.openSync(p, 'w')
  fs.ftruncateSync(fd, size)
  fs.closeSync(fd)
  return p
}

function makeWin() {
  const events: Record<string, unknown[][]> = {}
  return {
    events,
    webContents: {
      isDestroyed: () => false,
      send: jest.fn((channel: string, ...args: unknown[]) => {
        if (!events[channel]) events[channel] = []
        events[channel].push(args)
      }),
    },
  }
}

/** Yield to the event loop so async pumps can start */
const tick = () => new Promise<void>(r => setImmediate(r))

// ── Tests ────────────────────────────────────────────────────────────────────

describe('file-bridge: sender → receiver', () => {
  let savedPath: string

  beforeEach(() => {
    savedPath = path.join(os.tmpdir(), `recv-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`)
    const { dialog, ipcMain } = require('electron')
    dialog.showSaveDialog.mockResolvedValue({ filePath: savedPath, canceled: false })
    ipcMain.once.mockReset()
  })

  test('transfers a small file end-to-end', async () => {
    const content = Buffer.from('Hello GhostCall file transfer!')
    const filePath = writeTempFile(content)
    const [senderTransport, receiverTransport] = makeTransportPair()
    const senderWin = makeWin()
    const receiverWin = makeWin()

    const { ipcMain } = require('electron')
    ipcMain.once.mockImplementation((channel: string, cb: () => void) => {
      if (channel.startsWith('file:accept:')) setTimeout(cb, 10)
    })

    // Start receiver first — let it register META subscriber before sender sends
    const receiverDone = runReceiver(receiverTransport, receiverWin)
    await tick()
    const senderDone = runSender(senderTransport, filePath, senderWin)

    await Promise.all([senderDone, receiverDone])

    expect(senderWin.events['file:done']).toBeDefined()
    const received = fs.readFileSync(savedPath)
    expect(received).toEqual(content)

    fs.unlinkSync(filePath)
  }, 15_000)

  test('enforces 50 MB size limit', async () => {
    const bigPath = writeSparseFile(51 * 1024 * 1024)
    const [senderT] = makeTransportPair()
    const win = makeWin()
    await expect(runSender(senderT, bigPath, win)).rejects.toThrow('50 MB')
    fs.unlinkSync(bigPath)
  })

  test('receiver rejects transfer when user rejects', async () => {
    const content = Buffer.from('secret data')
    const filePath = writeTempFile(content)
    const [senderTransport, receiverTransport] = makeTransportPair()
    const senderWin = makeWin()
    const receiverWin = makeWin()

    const { ipcMain } = require('electron')
    // accept never fires; reject fires on second ipcMain.once call
    let callCount = 0
    ipcMain.once.mockImplementation((channel: string, cb: () => void) => {
      callCount++
      if (callCount === 2 && channel.startsWith('file:reject:')) setTimeout(cb, 10)
    })

    const receiverDone = runReceiver(receiverTransport, receiverWin)
    await tick()
    const senderDone = runSender(senderTransport, filePath, senderWin)

    await Promise.all([senderDone, receiverDone])

    expect(senderWin.events['file:error']).toBeDefined()
    expect((senderWin.events['file:error'][0][0] as any).message).toMatch(/[Rr]ej/)

    fs.unlinkSync(filePath)
  }, 15_000)

  test('multi-chunk file reassembles in order', async () => {
    const content = Buffer.alloc(200 * 1024)
    for (let i = 0; i < content.length; i++) content[i] = i % 251
    const filePath = writeTempFile(content)

    const [senderTransport, receiverTransport] = makeTransportPair()
    const senderWin = makeWin()
    const receiverWin = makeWin()

    const { ipcMain } = require('electron')
    ipcMain.once.mockImplementation((channel: string, cb: () => void) => {
      if (channel.startsWith('file:accept:')) setTimeout(cb, 10)
    })

    const receiverDone = runReceiver(receiverTransport, receiverWin)
    await tick()
    const senderDone = runSender(senderTransport, filePath, senderWin)

    await Promise.all([senderDone, receiverDone])

    expect(receiverWin.events['file:done']).toBeDefined()
    const received = fs.readFileSync(savedPath)
    expect(received.length).toBe(content.length)
    expect(received.equals(content)).toBe(true)

    fs.unlinkSync(filePath)
  }, 15_000)
})
