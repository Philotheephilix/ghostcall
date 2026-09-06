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
    const c4 = gc.onIncomingFile?.((data: IncomingFile) => setIncomingFile(data))
    const c5 = gc.onIncomingSignal?.(async (raw: string) => {
      let payload: { onionAddr: string; callId: string; type?: string; fileName?: string; fileSize?: number } | null = null
      try { payload = await gc.parseCallOffer?.(raw) } catch { return }
      if (!payload?.onionAddr || !payload.callId) return
      if (seenOffers.current.has(payload.callId)) return
      seenOffers.current.add(payload.callId)
      if (seenOffers.current.size > 500) {
        const oldest = seenOffers.current.values().next().value
        if (oldest !== undefined) seenOffers.current.delete(oldest)
      }
      if (payload.type === 'file') {
        setIncomingFile({ transferId: payload.callId, onionAddr: payload.onionAddr, handle: '', name: payload.fileName ?? 'unknown', size: payload.fileSize ?? 0 })
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
      if (myPub) await gc?.subscribeSignals?.(myPub).catch(() => {})
      else setStatusMsg('Online — not yet reachable by handle.')
    } catch (e) {
      setStatusMsg((e as Error).message)
    }
  }

  async function initiateCall() {
    if (!callTarget.trim()) return
    const gc = (window as any).ghostcall
    try {
      if (inputMode === 'ONION') {
        await gc?.initiateCall?.(callTarget.trim())
        window.location.href = '/call'
      } else {
        // Handle mode: look up the callee on-chain, send a Nostr signal so they
        // dial back to our onion. onCallConnected fires when they connect.
        setStatusMsg('Looking up handle…')
        const meta = await gc?.lookupStealth?.(callTarget.trim())
        if (!meta?.nostrPubkey) throw new Error('Handle not found on-chain')
        const myOnion = onionAddr
        if (!myOnion) throw new Error('Go online first — no onion address')
        const callId = Math.random().toString(16).slice(2)
        const offer = await gc?.buildCallOffer?.(
          { onionAddr: myOnion, callId, callerNoisePubkey: '' },
          { nostrPubkey: meta.nostrPubkey, pkVx: meta.pkVx, pkVy: meta.pkVy },
        )
        if (!offer) throw new Error('Failed to build call offer')
        await gc?.publishSignal?.(offer)
        setStatusMsg('Signal sent — waiting for dial-back…')
        // onCallConnected (wired above) will redirect to /call when they connect
      }
    } catch (e) {
      setStatusMsg((e as Error).message)
    }
  }

  const torOk = torStatus?.running === true
  const handle = state.handle || null

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-apricot)',
      paddingBottom: 96,
      fontFamily: 'var(--font-family)',
    }}>

      {/* ── Top bar ── */}
      <div style={{ padding: '52px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            background: 'var(--color-black)', color: '#fff',
            borderRadius: 'var(--radius-pill)', padding: '5px 13px',
            fontSize: 12, fontWeight: 800, letterSpacing: '0.02em',
          }}>GC</div>
          {handle
            ? <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-primary)' }}>@{handle}</span>
            : <span style={{ fontSize: 13, color: 'var(--label-tertiary)' }}>ghostcall</span>
          }
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Tor pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: torOk ? 'rgba(34,197,94,0.12)' : 'rgba(17,17,17,0.07)',
            borderRadius: 'var(--radius-pill)', padding: '5px 11px',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
            color: torOk ? '#16a34a' : 'var(--label-quaternary)',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: torOk ? '#22c55e' : '#9ca3af' }} />
            TOR
          </div>
          {/* Online status */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(17,17,17,0.07)', borderRadius: 'var(--radius-pill)', padding: '5px 11px',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
            color: isOnline ? 'var(--label-primary)' : 'var(--label-quaternary)',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: isOnline ? '#22c55e' : '#9ca3af' }} />
            {isOnline ? 'LIVE' : 'OFF'}
          </div>
        </div>
      </div>

      {/* ── Hero ── */}
      <div style={{ padding: '24px 24px 0' }}>
        <h1 className="hero-title-lg" style={{ whiteSpace: 'pre' }}>
          {isOnline ? 'You\'re\nLive.' : 'Make a\nCall.'}
        </h1>
        <p className="lead-text" style={{ marginTop: 8, maxWidth: 260 }}>
          {isOnline
            ? 'Listening for calls. Share your address to connect.'
            : 'End-to-end encrypted · over Tor · STRK payments'}
        </p>
      </div>

      {/* ── SVG illustration ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 28px', marginTop: -8 }}>
        <svg width="140" height="112" viewBox="0 0 140 112" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="42" y="8" width="56" height="96" rx="14" fill="#fff" stroke="#111" strokeWidth="4"/>
          <rect x="50" y="20" width="40" height="52" rx="5" fill="var(--bg-apricot)" stroke="#111" strokeWidth="2.5"/>
          <circle cx="70" cy="87" r="5" stroke="#111" strokeWidth="3" fill="none"/>
          <rect x="60" y="36" width="20" height="14" rx="3.5" fill="#111"/>
          <path d="M63 36L63 32Q63 27 70 27Q77 27 77 32L77 36" stroke="#111" strokeWidth="3" fill="none" strokeLinecap="round"/>
          <path d="M30 46 Q23 56 30 66" stroke="#111" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
          <path d="M20 39 Q10 56 20 73" stroke="#111" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
          <path d="M110 46 Q117 56 110 66" stroke="#111" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
          <path d="M120 39 Q130 56 120 73" stroke="#111" strokeWidth="3.5" fill="none" strokeLinecap="round"/>
        </svg>
      </div>

      {/* ── Tabs ── */}
      <div style={{ padding: '0 24px 14px' }}>
        <div className="seg-control">
          {(['dial', 'payments', 'files'] as const).map(tab => (
            <button key={tab} className={`seg-btn${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>
              {tab === 'dial' ? 'DIAL' : tab === 'payments' ? 'PAY' : 'FILES'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, padding: '0 24px', maxWidth: 480, width: '100%', alignSelf: 'center', boxSizing: 'border-box' }}>

        {activeTab === 'dial' && (
          <>
            {/* Input mode + call target */}
            <div className="card-white" style={{ padding: 20, marginBottom: 12, borderRadius: 'var(--radius-card)' }}>
              <div className="seg-control" style={{ marginBottom: 14 }}>
                {(['HANDLE', 'ONION'] as InputMode[]).map(m => (
                  <button key={m} className={`seg-btn${inputMode === m ? ' active' : ''}`} onClick={() => setInputMode(m)}>{m}</button>
                ))}
              </div>
              <div style={{ position: 'relative', marginBottom: 14 }}>
                {inputMode === 'HANDLE' && (
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--label-quaternary)', fontFamily: 'var(--font-mono)', fontSize: 14, pointerEvents: 'none' }}>@</span>
                )}
                <input
                  className="sketch-input"
                  type="text"
                  placeholder={inputMode === 'HANDLE' ? 'recipient handle' : 'abc…xyz.onion:7331'}
                  value={callTarget}
                  onChange={e => setCallTarget(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (isOnline ? initiateCall() : goOnline())}
                  style={{ width: '100%', boxSizing: 'border-box', paddingLeft: inputMode === 'HANDLE' ? 30 : 16, fontFamily: inputMode === 'ONION' ? 'var(--font-mono)' : undefined, fontSize: inputMode === 'ONION' ? 12 : undefined }}
                />
              </div>
              {isOnline
                ? <button className="btn btn-pill-full" onClick={initiateCall} disabled={!callTarget.trim()}>Call →</button>
                : <button className="btn btn-pill-full" onClick={goOnline}>Go Online →</button>
              }
            </div>

            {/* Onion address */}
            {isOnline && onionAddr && (
              <div className="card-white" style={{ padding: '11px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, borderRadius: 'var(--radius-md)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--label-tertiary)', flex: 1, wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
                  {onionAddr.slice(0, 30)}…
                </span>
                <button
                  onClick={() => { const gc = (window as any).ghostcall; gc?.copyToClipboard ? gc.copyToClipboard(onionAddr) : navigator.clipboard?.writeText(onionAddr).catch(() => {}) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, color: 'var(--label-quaternary)', letterSpacing: '0.06em' }}
                >COPY</button>
              </div>
            )}

            {statusMsg && (
              <p style={{ fontSize: 12, color: 'var(--system-red)', textAlign: 'center', marginBottom: 12, wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
                {statusMsg}
              </p>
            )}

            {/* Recent calls */}
            <span className="label-tag" style={{ display: 'block', marginBottom: 8 }}>Recent</span>
            <CallHistorySection historyKey={historyKey} />
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
            if (incomingFile.onionAddr) await (window as any).ghostcall?.fileConnect?.(incomingFile.onionAddr)
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
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6.53 6.53l.97-.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
            label: 'Dial', active: activeTab === 'dial', onClick: () => setActiveTab('dial'),
          },
          {
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M7 15h.01M11 15h2"/></svg>,
            label: 'Pay', active: activeTab === 'payments', onClick: () => setActiveTab('payments'),
          },
          {
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>,
            label: 'Files', active: activeTab === 'files', onClick: () => setActiveTab('files'),
          },
          {
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
            label: 'Settings', onClick: () => { window.location.href = '/settings' },
          },
        ]}
      />
    </main>
  )
}

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
      <div className="card-white" style={{ padding: '16px 20px', textAlign: 'center', borderRadius: 'var(--radius-md)' }}>
        <p style={{ fontSize: 12, color: 'var(--label-quaternary)', fontFamily: 'var(--font-mono)' }}>no recent calls</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {logs.slice().reverse().slice(0, 6).map(log => (
        <div key={log.id} className="card-white" style={{ padding: '12px 16px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-primary)' }}>{log.peer || 'Unknown'}</div>
            <div style={{ fontSize: 10, color: 'var(--label-quaternary)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {new Date(log.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--label-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {Math.floor(log.duration / 60)}:{String(log.duration % 60).padStart(2, '0')}
          </span>
        </div>
      ))}
    </div>
  )
}
