'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import PaymentModal from '../../components/PaymentModal'
import PaymentsPage from '../../components/PaymentsPage'
import FileTransferPage from '../../components/FileTransferPage'
import FileTransferModal, { type IncomingFile } from '../../components/FileTransferModal'
import Dock from '../../components/Dock'
import { useTorStatus } from '../../hooks/useTorStatus'
import { appendCallLog, markCallPaid, loadState } from '../../lib/app-state'

type InputMode = 'HANDLE' | 'ONION'

export default function Home() {
  const torStatus = useTorStatus()
  const [isOnline, setIsOnline] = useState(false)
  const [onionAddr, setOnionAddr] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [pendingPayment, setPendingPayment] = useState<{ callId: string; peer: string } | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [activeTab, setActiveTab] = useState<'dial' | 'payments' | 'files'>('dial')
  const [incomingFile, setIncomingFile] = useState<IncomingFile | null>(null)
  const [inputMode, setInputMode] = useState<InputMode>('HANDLE')
  const [callTarget, setCallTarget] = useState('')
  const seenOffers = useRef<Set<string>>(new Set())
  const state = useMemo(() => loadState(), [])

  useEffect(() => {
    const gc = (window as any).ghostcall
    if (!gc) return
    gc.getCallState?.().then((s: { direction: string } | null) => {
      if (s) window.location.href = '/call'
    }).catch(() => {})
    const c1 = gc.onCallConnected?.(() => { window.location.href = '/call' })
    const c2 = gc.onCallError?.((err: { message: string }) => setStatusMsg(err.message))
    const c3 = gc.onCallEnded?.((info: { callId: string; peer: string; duration: number }) => {
      appendCallLog({ id: info.callId, peer: info.peer, duration: info.duration, ts: Date.now(), committed: false })
      setHistoryKey(k => k + 1)
      if (info.peer && !info.peer.includes('.onion')) {
        setPendingPayment({ callId: info.callId, peer: info.peer })
      }
    })
    const c4 = gc.onIncomingFile?.((data: IncomingFile) => {
      setIncomingFile(data)
    })
    const c5 = gc.onIncomingSignal?.(async (raw: string) => {
      let payload: { onionAddr: string; callId: string; type?: string; fileName?: string; fileSize?: number } | null = null
      try { payload = await gc.parseCallOffer?.(raw) } catch { return }
      if (!payload?.onionAddr || !payload.callId) return
      if (seenOffers.current.has(payload.callId)) return
      seenOffers.current.add(payload.callId)
      if (seenOffers.current.size > 500) {
        seenOffers.current.delete(seenOffers.current.values().next().value!)
      }

      if (payload.type === 'file') {
        setIncomingFile({
          transferId: payload.callId,
          onionAddr: payload.onionAddr,
          handle: '',
          name: payload.fileName ?? 'unknown',
          size: payload.fileSize ?? 0,
        })
        return
      }

      const active = await gc.getCallState?.().catch(() => null)
      if (active) return
      try {
        await gc.initiateCall(payload.onionAddr)
        window.location.href = '/call'
      } catch (e) {
        seenOffers.current.delete(payload.callId)
        setStatusMsg(`Incoming call failed: ${(e as Error).message}`)
      }
    })
    return () => { c1?.(); c2?.(); c3?.(); c4?.(); c5?.() }
  }, [])

  async function goOnline() {
    const gc = (window as any).ghostcall
    try {
      const result = await gc?.goOnline?.()
      const addr = typeof result === 'string' ? result : result?.onionAddr ?? ''
      setOnionAddr(addr)
      setIsOnline(true)
      setStatusMsg('')
      const myPub = await gc?.getMyNostrPubkey?.().catch(() => '')
      if (myPub) {
        await gc?.subscribeSignals?.(myPub).catch(() => {})
      } else {
        setStatusMsg('Online — not yet reachable by handle. Try again in a moment.')
      }
    } catch (e) {
      setStatusMsg((e as Error).message)
    }
  }

  async function initiateCall() {
    if (!callTarget.trim()) return
    const gc = (window as any).ghostcall
    try {
      await gc?.initiateCall?.(callTarget.trim())
      window.location.href = '/call'
    } catch (e) {
      setStatusMsg((e as Error).message)
    }
  }

  const torOk = torStatus?.running === true
  const handle = state.handle || null

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fedfcb', paddingBottom: 96 }}>

      {/* Top bar */}
      <div style={{ padding: '52px 28px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: '#111', color: '#fff', borderRadius: 999, padding: '5px 14px', fontSize: 13, fontWeight: 800, letterSpacing: '-0.01em' }}>GC</div>
          {handle
            ? <span style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>@{handle}</span>
            : <span style={{ fontSize: 13, color: '#5a5a5a' }}>ghostcall</span>
          }
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(17,17,17,0.08)', borderRadius: 999, padding: '5px 14px', fontSize: 11, fontWeight: 700, color: isOnline ? '#16a34a' : '#5a5a5a', letterSpacing: '0.03em' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isOnline ? '#22c55e' : '#9ca3af', flexShrink: 0 }} />
          {isOnline ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* Hero title + illustration */}
      <div style={{ padding: '28px 28px 0', display: 'flex', flexDirection: 'column' }}>
        <h1 style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 52, fontWeight: 800, lineHeight: 1.0, letterSpacing: '-0.035em', color: '#111', margin: 0 }}>
          {isOnline ? 'You\'re\nLive.' : 'Make a\nCall.'}
        </h1>
      </div>

      {/* Illustration */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0 8px' }}>
        <svg width="200" height="140" viewBox="0 0 200 140" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Handset */}
          <rect x="72" y="20" width="56" height="96" rx="16" fill="#fff" stroke="#111" strokeWidth="5"/>
          <rect x="80" y="32" width="40" height="56" rx="6" fill="#fedfcb" stroke="#111" strokeWidth="3"/>
          <circle cx="100" cy="104" r="6" stroke="#111" strokeWidth="3.5" fill="none"/>
          {/* Signal arcs left */}
          <path d="M56 58 Q48 70 56 82" stroke="#111" strokeWidth="4" fill="none" strokeLinecap="round"/>
          <path d="M44 50 Q32 70 44 90" stroke="#111" strokeWidth="4" fill="none" strokeLinecap="round"/>
          {/* Signal arcs right */}
          <path d="M144 58 Q152 70 144 82" stroke="#111" strokeWidth="4" fill="none" strokeLinecap="round"/>
          <path d="M156 50 Q168 70 156 90" stroke="#111" strokeWidth="4" fill="none" strokeLinecap="round"/>
          {/* Lock icon on screen */}
          <rect x="90" y="46" width="20" height="16" rx="4" fill="#111"/>
          <path d="M94 46 L94 42 Q94 36 100 36 Q106 36 106 42 L106 46" fill="none" stroke="#111" strokeWidth="3.5" strokeLinecap="round"/>
          {/* Action lines */}
          <line x1="72" y1="18" x2="66" y2="10" stroke="#111" strokeWidth="3.5" strokeLinecap="round"/>
          <line x1="100" y1="14" x2="100" y2="6" stroke="#111" strokeWidth="3.5" strokeLinecap="round"/>
          <line x1="128" y1="18" x2="134" y2="10" stroke="#111" strokeWidth="3.5" strokeLinecap="round"/>
        </svg>
      </div>

      {/* Segmented tabs */}
      <div style={{ padding: '0 28px 12px' }}>
        <div className="seg-control">
          {(['dial', 'payments', 'files'] as const).map(tab => (
            <button key={tab} className={`seg-btn${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>
              {tab.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '0 28px', maxWidth: 480, width: '100%', alignSelf: 'center', boxSizing: 'border-box' }}>

        {activeTab === 'dial' && (
          <>
            <div className="card-white" style={{ padding: 20, marginBottom: 14 }}>
              <div className="seg-control" style={{ marginBottom: 14 }}>
                {(['HANDLE', 'ONION'] as InputMode[]).map(m => (
                  <button key={m} className={`seg-btn${inputMode === m ? ' active' : ''}`} onClick={() => setInputMode(m)}>{m}</button>
                ))}
              </div>
              <input
                className="sketch-input"
                type="text"
                placeholder={inputMode === 'HANDLE' ? '@ handle' : '.onion address'}
                value={callTarget}
                onChange={e => setCallTarget(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (isOnline ? initiateCall() : goOnline())}
                style={{ width: '100%', marginBottom: 14, boxSizing: 'border-box' }}
              />
              {isOnline
                ? <button className="btn btn-pill-full" onClick={initiateCall} disabled={!callTarget.trim()}>Call</button>
                : <button className="btn btn-pill-full" onClick={goOnline}>Go Online →</button>
              }
            </div>

            {isOnline && onionAddr && (
              <div className="card-white" style={{ padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#5a5a5a', flex: 1, wordBreak: 'break-all', fontFamily: 'monospace' }}>{onionAddr.slice(0, 28)}…</span>
                <button onClick={() => { const gc = (window as any).ghostcall; if (gc?.copyToClipboard) gc.copyToClipboard(onionAddr); else navigator.clipboard?.writeText(onionAddr).catch(() => {}) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#5a5a5a', fontWeight: 600 }}>COPY</button>
              </div>
            )}

            {statusMsg && <p style={{ fontSize: 12, color: '#e63946', textAlign: 'center', marginBottom: 12, wordBreak: 'break-all' }}>{statusMsg}</p>}

            <span className="label-tag" style={{ display: 'block', marginBottom: 10 }}>Recent Calls</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <CallHistorySection historyKey={historyKey} />
            </div>
          </>
        )}

        {activeTab === 'payments' && <PaymentsPage />}
        {activeTab === 'files' && <FileTransferPage />}
      </div>

      {incomingFile && (
        <FileTransferModal
          file={incomingFile}
          onAccept={async () => {
            await (window as any).ghostcall?.acceptFileTransfer?.(incomingFile.transferId)
            if (incomingFile.onionAddr) {
              await (window as any).ghostcall?.fileConnect?.(incomingFile.onionAddr)
            }
            setIncomingFile(null)
            setActiveTab('files')
          }}
          onReject={async () => {
            await (window as any).ghostcall?.rejectFileTransfer?.(incomingFile.transferId)
            setIncomingFile(null)
          }}
        />
      )}

      {pendingPayment && (
        <PaymentModal
          peer={pendingPayment.peer}
          onDismiss={() => setPendingPayment(null)}
          onPaid={(txHash) => {
            markCallPaid(pendingPayment.callId, txHash)
            setHistoryKey(k => k + 1)
            setPendingPayment(null)
          }}
        />
      )}

      <Dock
        items={[
          {
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6.53 6.53l.97-.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            ),
            label: 'Dial',
            active: activeTab === 'dial',
            onClick: () => setActiveTab('dial'),
          },
          {
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <path d="M2 10h20"/>
                <path d="M7 15h.01M11 15h2"/>
              </svg>
            ),
            label: 'Payments',
            active: activeTab === 'payments',
            onClick: () => setActiveTab('payments'),
          },
          {
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
            ),
            label: 'Files',
            active: activeTab === 'files',
            onClick: () => setActiveTab('files'),
          },
          {
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ),
            label: 'Settings',
            onClick: () => { window.location.href = '/settings' },
          },
        ]}
      />
    </main>
  )
}

// Inline call history section using existing component
function CallHistorySection({ historyKey }: { historyKey: number }) {
  const [logs, setLogs] = useState<Array<{ id: string; peer: string; duration: number; ts: number; committed: boolean }>>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ghostcall:call-log')
      if (raw) setLogs(JSON.parse(raw))
    } catch {}
  }, [historyKey])

  if (logs.length === 0) {
    return (
      <div className="card-white" style={{ padding: '16px 20px' }}>
        <p style={{ fontSize: 13, color: '#5a5a5a', textAlign: 'center' }}>No recent calls</p>
      </div>
    )
  }

  return (
    <>
      {logs.slice().reverse().slice(0, 8).map(log => (
        <div key={log.id} className="card-white list-row" style={{ padding: '12px 16px' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>
              {log.peer || 'Unknown'}
            </div>
            <div style={{ fontSize: 11, color: '#5a5a5a', marginTop: 2 }}>
              {new Date(log.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <span style={{ fontSize: 12, color: '#5a5a5a' }}>
            {Math.floor(log.duration / 60)}:{String(log.duration % 60).padStart(2, '0')}
          </span>
        </div>
      ))}
    </>
  )
}
