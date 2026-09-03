'use client'

import { useState, useEffect, useRef } from 'react'
import Logo from '../../components/Logo'
import DialPad from '../../components/DialPad'
import CallHistory from '../../components/CallHistory'
import PaymentModal from '../../components/PaymentModal'
import PaymentsPage from '../../components/PaymentsPage'
import Dock from '../../components/Dock'
import { useTorStatus } from '../../hooks/useTorStatus'
import { appendCallLog, markCallPaid, loadState } from '../../lib/app-state'

export default function Home() {
  const torStatus = useTorStatus()
  const [isOnline, setIsOnline] = useState(false)
  const [onionAddr, setOnionAddr] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [pendingPayment, setPendingPayment] = useState<{ callId: string; peer: string } | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [activeTab, setActiveTab] = useState<'dial' | 'payments'>('dial')
  const seenOffers = useRef<Set<string>>(new Set())
  const state = loadState()

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
    const c4 = gc.onIncomingSignal?.(async (raw: string) => {
      let payload: { onionAddr: string; callId: string } | null = null
      try { payload = await gc.parseCallOffer?.(raw) } catch { return }
      if (!payload?.onionAddr || !payload.callId) return
      if (seenOffers.current.has(payload.callId)) return
      seenOffers.current.add(payload.callId)
      if (seenOffers.current.size > 500) {
        seenOffers.current.delete(seenOffers.current.values().next().value!)
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
    return () => { c1?.(); c2?.(); c3?.(); c4?.() }
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

  const torOk = torStatus?.running === true
  const handle = state.handle || null

  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingBottom: 96,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Ambient glow — only when Tor connected */}
      {torOk && (
        <div style={{
          position: 'absolute',
          top: -60, left: '50%', transform: 'translateX(-50%)',
          width: 360, height: 240,
          background: 'radial-gradient(ellipse at 50% 0%, rgba(198,241,53,0.06) 0%, transparent 72%)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Header strip */}
      <div style={{
        width: '100%',
        maxWidth: 420,
        padding: '20px 20px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {/* Identity badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={32} glowColor={torOk ? 'rgba(198,241,53,0.9)' : 'rgba(255,255,255,0.15)'} />
          <div>
            {handle ? (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--accent)',
                letterSpacing: '0.02em',
              }}>
                @{handle}
              </span>
            ) : (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--label-quaternary)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>
                no handle
              </span>
            )}
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--label-quaternary)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginTop: 1,
            }}>
              GHOSTCALL
            </div>
          </div>
        </div>

        {/* Network status */}
        <div className={`status-pill ${torOk ? 'status-pill--connected' : torStatus === null ? 'status-pill--offline' : 'status-pill--error'}`}>
          <span className="dot" />
          <span>
            {torOk
              ? isOnline ? 'ONLINE' : 'TOR OK'
              : torStatus === null ? 'INIT...' : 'TOR ERR'}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div style={{ width: '100%', maxWidth: 420, padding: '28px 20px 0', flex: 1 }}>

        {activeTab === 'dial' && (
          <>
            {/* Onion address display when online */}
            {isOnline && onionAddr && (
              <div style={{
                marginBottom: 16,
                padding: '10px 14px',
                background: 'rgba(198,241,53,0.05)',
                border: '1px solid rgba(198,241,53,0.15)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <div style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: 'var(--accent)',
                  boxShadow: '0 0 8px rgba(198,241,53,0.7)',
                  flexShrink: 0,
                  animation: 'pulse-dot 2s ease-in-out infinite',
                }} />
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--accent)',
                  letterSpacing: '0.04em',
                  wordBreak: 'break-all',
                  lineHeight: 1.4,
                }}>
                  {onionAddr.slice(0, 28)}…
                </span>
              </div>
            )}

            <div className="glass-card" style={{ width: '100%', padding: 0, overflow: 'hidden' }}>
              <DialPad
                onionAddr={onionAddr}
                isOnline={isOnline}
                torReady={torOk}
                onGoOnline={goOnline}
              />
            </div>

            {statusMsg && (
              <p style={{
                marginTop: 12, fontSize: 11, color: 'var(--system-red)',
                fontFamily: 'var(--font-mono)', textAlign: 'center',
                letterSpacing: '0.02em', wordBreak: 'break-all',
              }}>
                ERR: {statusMsg}
              </p>
            )}

            {/* Call history */}
            <div style={{ marginTop: 24 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  fontWeight: 600,
                  color: 'var(--label-quaternary)',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                }}>
                  CALL LOG
                </span>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
              </div>
              <CallHistory key={historyKey} />
            </div>
          </>
        )}

        {activeTab === 'payments' && <PaymentsPage />}
      </div>

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
