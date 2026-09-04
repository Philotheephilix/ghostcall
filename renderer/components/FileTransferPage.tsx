'use client'

import { useState, useEffect } from 'react'
import { formatSize } from '../lib/format-utils'

type TransferStatus = 'idle' | 'waiting' | 'transferring' | 'done' | 'error'

interface TransferState {
  transferId: string
  name: string
  size: number
  bytesDone: number
  savedPath?: string
  error?: string
  status: TransferStatus
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div style={{
      height: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 1, overflow: 'hidden',
    }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: 'var(--accent)', transition: 'width 200ms ease',
      }} />
    </div>
  )
}

export default function FileTransferPage() {
  const [handle, setHandle] = useState('')
  const [transfer, setTransfer] = useState<TransferState | null>(null)
  const [err, setErr] = useState('')
  const gc = (window as any).ghostcall

  useEffect(() => {
    const cleanups: Array<() => void> = []
    const c1 = gc.onFileProgress?.((data: { transferId: string; bytesSent?: number; bytesReceived?: number; total: number }) => {
      setTransfer(prev => prev ? {
        ...prev,
        bytesDone: data.bytesSent ?? data.bytesReceived ?? prev.bytesDone,
        status: 'transferring',
      } : prev)
    })
    const c2 = gc.onFileDone?.((data: { transferId: string; savedPath: string }) => {
      setTransfer(prev => prev ? { ...prev, status: 'done', savedPath: data.savedPath } : prev)
    })
    const c3 = gc.onFileError?.((data: { transferId: string; message: string }) => {
      setTransfer(prev => prev ? { ...prev, status: 'error', error: data.message } : null)
      setErr(data.message)
    })
    if (c1) cleanups.push(c1)
    if (c2) cleanups.push(c2)
    if (c3) cleanups.push(c3)
    return () => { cleanups.forEach(fn => fn()) }
  }, [])

  async function pickAndSend() {
    setErr('')
    try {
      // Pick file via native dialog (main process)
      const filePath: string | null = await gc.pickFile()
      if (!filePath) return

      const info: { filePath: string; transferId: string; name: string; size: number } = await gc.sendFile(filePath)
      setTransfer({ transferId: info.transferId, name: info.name, size: info.size, bytesDone: 0, status: 'waiting' })

      // Go online (open onion, bind listener) — pass filePath+transferId directly, no global state
      const { onionAddr } = await gc.fileGoOnline(info.filePath, info.transferId)

      // Build and publish Nostr offer with type=file
      if (handle.trim()) {
        const meta = await gc.lookupStealth(handle.trim())
        const callId = info.transferId
        const offerJson = await gc.buildCallOffer(
          { onionAddr, callId, callerNoisePubkey: '', type: 'file', fileName: info.name, fileSize: info.size },
          { nostrPubkey: meta.nostrPubkey, pkVx: meta.pkVx, pkVy: meta.pkVy },
        )
        await gc.publishSignal(offerJson)
      }
    } catch (e) {
      setErr((e as Error).message)
      setTransfer(null)
    }
  }

  async function cancel() {
    await gc.cancelFileTransfer?.()
    await gc.fileHangUp?.()
    setTransfer(null)
    setErr('')
  }

  const pct = transfer && transfer.size > 0
    ? Math.round((transfer.bytesDone / transfer.size) * 100)
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Send section */}
      {!transfer && (
        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--label-quaternary)',
          }}>
            SEND FILE
          </p>

          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--label-quaternary)',
              pointerEvents: 'none',
            }}>@</span>
            <input
              className="input-glass"
              type="text"
              placeholder="recipient handle"
              value={handle}
              onChange={e => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
              style={{ paddingLeft: 28, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>

          <button className="btn-primary" onClick={pickAndSend} style={{ fontSize: 12 }}>
            PICK FILE & SEND
          </button>
        </div>
      )}

      {/* Transfer in progress */}
      {transfer && (
        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--label-quaternary)',
            }}>
              {transfer.status === 'waiting' ? 'WAITING FOR RECEIVER' :
               transfer.status === 'transferring' ? 'TRANSFERRING' :
               transfer.status === 'done' ? 'COMPLETE' : 'ERROR'}
            </p>
            {transfer.status !== 'done' && (
              <button
                onClick={cancel}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--label-quaternary)',
                  letterSpacing: '0.1em', textTransform: 'uppercase' }}
              >
                CANCEL
              </button>
            )}
          </div>

          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--label-primary)', wordBreak: 'break-all' }}>
            {transfer.name}
          </p>

          {transfer.status === 'transferring' && (
            <>
              <ProgressBar pct={pct} />
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--label-tertiary)' }}>
                {formatSize(transfer.bytesDone)} / {formatSize(transfer.size)} — {pct}%
              </p>
            </>
          )}

          {transfer.status === 'waiting' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 5, height: 5, borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'pulse-dot 2s ease-in-out infinite',
              }} />
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--label-tertiary)' }}>
                Waiting for receiver to accept…
              </p>
            </div>
          )}

          {transfer.status === 'done' && (
            <>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)' }}>
                ✓ {formatSize(transfer.size)} sent
              </p>
              <button className="btn-secondary" onClick={() => setTransfer(null)} style={{ fontSize: 11 }}>
                SEND ANOTHER
              </button>
            </>
          )}

          {transfer.status === 'error' && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--system-red)' }}>
              ERR: {transfer.error}
            </p>
          )}
        </div>
      )}

      {err && !transfer && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--system-red)', textAlign: 'center' }}>
          ERR: {err}
        </p>
      )}

      {/* Receive hint */}
      {!transfer && (
        <div style={{ padding: '10px 0' }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'var(--label-quaternary)', textAlign: 'center',
          }}>
            Incoming files appear as a notification
          </p>
        </div>
      )}
    </div>
  )
}
