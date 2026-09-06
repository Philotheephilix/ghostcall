'use client'

import { useState, useEffect, useRef } from 'react'
import { startCapture, stopCapture, setMuted, playInboundFrame } from '../lib/audio-engine'

export default function CallScreen() {
  const [elapsed, setElapsed] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [showSettle, setShowSettle] = useState(false)
  const [strkAmount, setStrkAmount] = useState('')
  const [settling, setSettling] = useState(false)
  const [settleMsg, setSettleMsg] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    const gc = (window as any).ghostcall
    if (!gc) return
    if (!startedRef.current) {
      startedRef.current = true
      startCapture().catch(console.error)
    }
    let unsubFrame: (() => void) | undefined
    if (typeof gc.onInboundFrame === 'function') {
      unsubFrame = gc.onInboundFrame((frame: unknown) => playInboundFrame(frame as ArrayBuffer))
    }
    timerRef.current = setInterval(() => setElapsed(t => t + 1), 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      stopCapture()
      unsubFrame?.()
    }
  }, [])

  function toggleMute() {
    const next = !isMuted
    setIsMuted(next)
    setMuted(next)
  }

  async function endCall() {
    if (timerRef.current) clearInterval(timerRef.current)
    stopCapture()
    try { await (window as any).ghostcall?.hangUp?.() } catch { /* ignore */ }
    setShowSettle(true)
  }

  async function settlePayment() {
    if (!strkAmount.trim()) return
    setSettling(true)
    setSettleMsg('')
    try {
      const result = await (window as any).ghostcall?.settlePayment?.(strkAmount.trim())
      setSettleMsg(String(result).slice(0, 22) + '…')
    } catch (e) {
      setSettleMsg((e as Error).message)
    } finally { setSettling(false) }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const suggested = elapsed > 0
    ? (BigInt(Math.ceil(elapsed / 60)) * BigInt(1e17)).toString()
    : ''

  // ── Post-call settle screen ─────────────────────────────────────────────
  if (showSettle) {
    return (
      <main style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-rose)', padding: '0 24px', gap: 32,
        fontFamily: 'var(--font-family)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <span className="label-tag" style={{ display: 'block', marginBottom: 10 }}>Call Ended</span>
          <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--label-primary)', lineHeight: 1 }}>
            {mm}:{ss}
          </div>
        </div>

        <div className="card-white" style={{ width: '100%', maxWidth: 340, padding: 24, borderRadius: 'var(--radius-card)' }}>
          <span className="label-tag" style={{ display: 'block', marginBottom: 14 }}>Settle Payment</span>
          <input
            className="sketch-input"
            type="text"
            placeholder={suggested || 'STRK amount (base units)'}
            value={strkAmount}
            onChange={e => setStrkAmount(e.target.value)}
            disabled={settling}
            onKeyDown={e => e.key === 'Enter' && settlePayment()}
            style={{ width: '100%', marginBottom: 10, boxSizing: 'border-box' }}
          />
          {suggested && !strkAmount && (
            <button
              className="btn btn-pill-outline"
              style={{ width: '100%', marginBottom: 10, fontSize: 13 }}
              onClick={() => setStrkAmount(suggested)}
            >
              Suggested · {(Number(suggested) / 1e18).toFixed(1)} STRK
            </button>
          )}
          <button
            className="btn btn-pill-full"
            onClick={settlePayment}
            disabled={!strkAmount.trim() || settling}
          >
            {settling ? 'Paying…' : 'Pay with STRK20 →'}
          </button>
          {settleMsg && (
            <p style={{ fontSize: 12, color: 'var(--system-green)', marginTop: 10, textAlign: 'center', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              ✓ {settleMsg}
            </p>
          )}
        </div>

        <button
          onClick={() => { window.location.href = '/home' }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--label-tertiary)', fontWeight: 500 }}
        >
          Skip →
        </button>
      </main>
    )
  }

  // ── Active call screen ───────────────────────────────────────────────────
  return (
    <main style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-rose)', padding: '0 24px', gap: 0,
      fontFamily: 'var(--font-family)',
    }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--label-primary)', lineHeight: 1.1, margin: 0 }}>
          Encrypted Call
        </h1>
        <span className="label-tag" style={{ display: 'block', marginTop: 8 }}>Tor · Noise_XX · end-to-end</span>
      </div>

      {/* Timer */}
      <div style={{
        fontSize: 80, fontWeight: 800, letterSpacing: '-0.04em',
        color: 'var(--label-primary)', lineHeight: 1, marginBottom: 48,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {mm}:{ss}
      </div>

      {/* Pulse rings */}
      <div style={{ position: 'relative', width: 180, height: 180, marginBottom: 56, flexShrink: 0 }}>
        {[0, 24, 48, 72].map((inset, i) => (
          <div key={inset} style={{
            position: 'absolute', inset, borderRadius: '50%',
            border: i === 3 ? 'none' : `${i === 2 ? 2.5 : 2}px solid rgba(17,17,17,${0.12 + i * 0.06})`,
            background: i === 3 ? 'var(--label-primary)' : i === 2 ? 'rgba(17,17,17,0.05)' : 'transparent',
            ...(i === 0 ? { animation: 'ring-pulse 2s ease-in-out infinite' } : {}),
          }} />
        ))}
        <style>{`@keyframes ring-pulse{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(1.08);opacity:1}}`}</style>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32 }}>
        {/* Mute */}
        <CtrlButton onClick={toggleMute} label={isMuted ? 'Unmute' : 'Mute'} size={56} active={isMuted}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {isMuted ? (
              <>
                <line x1="1" y1="1" x2="23" y2="23"/>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
              </>
            ) : (
              <>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
              </>
            )}
          </svg>
        </CtrlButton>

        {/* End call */}
        <CtrlButton onClick={endCall} label="End" size={72} danger>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="white" stroke="none">
            <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" transform="rotate(135 12 12)"/>
          </svg>
        </CtrlButton>

        {/* Speaker */}
        <CtrlButton onClick={() => {}} label="Speaker" size={56}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
        </CtrlButton>
      </div>
    </main>
  )
}

function CtrlButton({ onClick, label, size, active, danger, children }: {
  onClick: () => void
  label: string
  size: number
  active?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <button
        onClick={onClick}
        style={{
          width: size, height: size, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 0, border: danger ? 'none' : '2px solid #111',
          background: danger ? 'var(--system-red)' : active ? '#111' : 'transparent',
          color: (danger || active) ? '#fff' : '#111',
          transition: 'transform 0.12s',
        }}
        onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.94)')}
        onMouseUp={e => (e.currentTarget.style.transform = '')}
        onMouseLeave={e => (e.currentTarget.style.transform = '')}
      >
        {children}
      </button>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--label-tertiary)', textTransform: 'uppercase', fontFamily: 'var(--font-family)' }}>
        {label}
      </span>
    </div>
  )
}
