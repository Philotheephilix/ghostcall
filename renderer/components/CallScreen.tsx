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
    if (typeof gc.onInboundFrame === 'function') {
      gc.onInboundFrame((frame: unknown) => playInboundFrame(frame as ArrayBuffer))
    }
    timerRef.current = setInterval(() => setElapsed(t => t + 1), 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      stopCapture()
    }
  }, [])

  function toggleMute() {
    const next = !isMuted
    setIsMuted(next)
    setMuted(next)
  }

  async function endCall() {
    stopCapture()
    if (timerRef.current) clearInterval(timerRef.current)
    try { await (window as any).ghostcall?.hangUp?.() } catch { /* ignore */ }
    setShowSettle(true)
  }

  async function settlePayment() {
    if (!strkAmount.trim()) return
    setSettling(true)
    setSettleMsg('')
    try {
      const result = await (window as any).ghostcall?.settlePayment?.(strkAmount.trim())
      setSettleMsg(String(result).slice(0, 20) + '…')
    } catch (e) {
      setSettleMsg((e as Error).message)
    } finally { setSettling(false) }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const suggested = elapsed > 0
    ? (BigInt(Math.ceil(elapsed / 60)) * BigInt(1e17)).toString()
    : ''

  if (showSettle) {
    return (
      <main className="page" style={{ gap: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--label-tertiary)', marginBottom: 4 }}>Call ended</p>
          <p style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.4 }}>{mm}:{ss}</p>
        </div>

        <div className="glass-card" style={{ width: '100%', maxWidth: 340, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 20px 0' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-tertiary)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 12 }}>
              Settle Payment
            </p>
            <input
              className="input-glass"
              type="text"
              placeholder={suggested || 'STRK amount (base units)'}
              value={strkAmount}
              onChange={e => setStrkAmount(e.target.value)}
              disabled={settling}
              onKeyDown={e => e.key === 'Enter' && settlePayment()}
            />
          </div>
          {suggested && !strkAmount && (
            <button
              className="btn-text"
              style={{ padding: '8px 20px', fontSize: 13 }}
              onClick={() => setStrkAmount(suggested)}
            >
              Use suggested · {(Number(suggested) / 1e18).toFixed(1)} STRK
            </button>
          )}
          <div style={{ padding: '10px 20px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              className="btn-primary"
              onClick={settlePayment}
              disabled={!strkAmount.trim() || settling}
            >
              {settling ? 'Paying…' : 'Pay with STRK20'}
            </button>
            {settleMsg && (
              <p style={{ fontSize: 12, color: 'var(--system-green)', fontFamily: 'var(--font-mono)' }}>
                ✓ {settleMsg}
              </p>
            )}
          </div>
          <div className="divider" />
          <button
            className="btn-text"
            style={{ width: '100%', padding: '14px', color: 'var(--label-secondary)' }}
            onClick={() => { window.location.href = '/' }}
          >
            Skip
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="page" style={{ gap: 0 }}>
      {/* Green ambient glow */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 80% 50% at 50% 30%, rgba(48,209,88,0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Timer — dominant */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 64 }}>
        <span className="call-timer">{mm}:{ss}</span>
        <div className="status-pill status-pill--connected">
          <span className="dot" />
          <span>Tor · Noise_XX</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
        {/* Mute — glass circle */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <button
            onClick={toggleMute}
            style={{
              width: 64, height: 64, borderRadius: '50%',
              background: isMuted ? 'var(--system-gray-3)' : 'var(--glass-regular)',
              border: `0.5px solid ${isMuted ? 'var(--glass-border)' : 'var(--glass-border-mid)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'background 150ms',
              backdropFilter: 'blur(20px)',
            }}
          >
            {/* Mic icon */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={isMuted ? 'var(--label-tertiary)' : 'var(--label-primary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {isMuted ? (
                <>
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </>
              ) : (
                <>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </>
              )}
            </svg>
          </button>
          <span style={{ fontSize: 11, color: 'var(--label-tertiary)' }}>
            {isMuted ? 'Unmute' : 'Mute'}
          </span>
        </div>

        {/* End call — red circle */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <button
            onClick={endCall}
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'var(--system-red)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 24px rgba(255,69,58,0.4)',
              transition: 'transform 80ms, opacity 80ms',
            }}
            onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.93)')}
            onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
          >
            {/* Phone down icon */}
            <svg width="26" height="26" viewBox="0 0 24 24" fill="white" stroke="none">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" transform="rotate(135 12 12)" />
            </svg>
          </button>
          <span style={{ fontSize: 11, color: 'var(--label-tertiary)' }}>End</span>
        </div>
      </div>
    </main>
  )
}
