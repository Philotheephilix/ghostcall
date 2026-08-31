'use client'

import { useState, useEffect } from 'react'
import Logo from '../../components/Logo'
import DialPad from '../../components/DialPad'
import CallHistory from '../../components/CallHistory'
import PaymentModal from '../../components/PaymentModal'
import Dock from '../../components/Dock'
import { useTorStatus } from '../../hooks/useTorStatus'
import { loadState, appendCallLog, markCallPaid } from '../../lib/app-state'
import { onIdentityReady } from '../../lib/identity-client'

export default function Home() {
  const torStatus = useTorStatus()
  const [ready, setReady] = useState(false)
  const [isOnline, setIsOnline] = useState(false)
  const [onionAddr, setOnionAddr] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [handle, setHandle] = useState('')
  const [pendingPayment, setPendingPayment] = useState<{ callId: string; peer: string } | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [activeTab, setActiveTab] = useState<'dial' | 'history'>('dial')

  useEffect(() => {
    let innerCleanup: (() => void) | null = null

    function wireCallListeners() {
      const gc = (window as any).ghostcall
      if (!gc) return
      const c1 = gc.onCallConnected?.(() => { window.location.href = '/call' })
      const c2 = gc.onCallError?.((err: { message: string }) => setStatusMsg(err.message))
      const c3 = gc.onCallEnded?.((info: { callId: string; peer: string; duration: number }) => {
        appendCallLog({ id: info.callId, peer: info.peer, duration: info.duration, ts: Date.now(), committed: false })
        setHistoryKey(k => k + 1)
        // Show payment modal only for handle-based calls (non-onion peers)
        if (info.peer && !info.peer.includes('.onion')) {
          setPendingPayment({ callId: info.callId, peer: info.peer })
        }
      })
      innerCleanup = () => { c1?.(); c2?.(); c3?.() }
    }

    // If onboarding is already done, render immediately from localStorage.
    // identity:ready will arrive shortly and wire call listeners — no need to block rendering.
    const state = loadState()
    if (state.onboardingDone && state.registered) {
      setHandle(state.handle)
      setReady(true)
    }

    // Timeout fallback: redirect to onboarding only if we never got identity:ready
    // AND onboarding was not already done in localStorage.
    const timeout = setTimeout(() => {
      const s = loadState()
      if (!s.onboardingDone || !s.registered) {
        window.location.replace('/onboarding')
      }
    }, 15000)

    const cleanup = onIdentityReady(({ source, error }) => {
      clearTimeout(timeout)
      cleanup() // one-shot

      if (error === 'decryption-failed') {
        window.location.replace('/onboarding')
        return
      }

      if (source === '') {
        const s = loadState()
        if (!s.onboardingDone || !s.registered) {
          window.location.replace('/onboarding')
          return
        }
      }

      // Identity loaded — wire call listeners now
      setHandle(loadState().handle)
      setReady(true)
      wireCallListeners()
    })

    return () => { clearTimeout(timeout); cleanup(); innerCleanup?.() }
  }, [])

  async function goOnline() {
    const gc = (window as any).ghostcall
    try {
      const result = await gc?.goOnline?.()
      const addr = typeof result === 'string' ? result : result?.onionAddr ?? ''
      setOnionAddr(addr)
      setIsOnline(true)
      setStatusMsg('')
    } catch (e) {
      setStatusMsg((e as Error).message)
    }
  }

  const torOk = torStatus?.running === true

  if (!ready) return null

  return (
    <main className="page" style={{ gap: 0, paddingBottom: 88 }}>
      {/* Green glow when connected */}
      {torOk && (
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 320, height: 220,
          background: 'radial-gradient(ellipse at 50% 0%, rgba(48,209,88,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginBottom: 44 }}>
        <Logo size={56} glowColor={torOk ? 'rgba(48,209,88,0.85)' : 'rgba(255,255,255,0.15)'} />
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.1 }}>
            GhostCall
          </h1>
          {handle && (
            <p style={{ fontSize: 13, color: 'var(--label-tertiary)', marginTop: 3 }}>
              @{handle}
            </p>
          )}
        </div>

        {/* Tor status pill */}
        <div className={`status-pill ${torOk ? 'status-pill--connected' : torStatus === null ? 'status-pill--offline' : 'status-pill--error'}`}>
          <span className="dot" />
          <span>
            {torOk
              ? isOnline ? onionAddr.slice(0, 14) + '…' : 'Private'
              : torStatus === null ? 'Connecting…' : 'Tor unavailable'}
          </span>
        </div>
      </div>

      {/* Dial card — hidden when history tab active */}
      {activeTab === 'dial' && (
        <div className="glass-card" style={{ width: '100%', maxWidth: 360, padding: 0, overflow: 'hidden' }}>
          <DialPad
            onionAddr={onionAddr}
            isOnline={isOnline}
            torReady={torOk}
            onGoOnline={goOnline}
          />
        </div>
      )}

      {statusMsg && (
        <p style={{
          marginTop: 14, fontSize: 12, color: 'var(--system-red)',
          fontFamily: 'var(--font-mono)', textAlign: 'center', maxWidth: 320,
        }}>
          {statusMsg}
        </p>
      )}

      {/* Content area — dial pad or call history */}
      {activeTab === 'history'
        ? <CallHistory key={historyKey} />
        : null
      }

      {/* Post-call payment modal */}
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

      {/* Dock navigation */}
      <Dock
        items={[
          {
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6.53 6.53l.97-.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            ),
            label: 'Dial',
            active: activeTab === 'dial',
            onClick: () => setActiveTab('dial'),
          },
          {
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10,9 9,9 8,9"/>
              </svg>
            ),
            label: 'History',
            active: activeTab === 'history',
            onClick: () => setActiveTab('history'),
          },
          {
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
