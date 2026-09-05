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
      <main className="theme-rose page-enter" style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 20px',
        gap: 28,
      }}>
        <div style={{ textAlign: 'center' }}>
          <span className="label-tag" style={{ display: 'block', marginBottom: 12 }}>Call Ended</span>
          <div style={{
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: '-0.04em',
            color: '#111',
            lineHeight: 1,
          }}>
            {mm}:{ss}
          </div>
        </div>

        <div className="card-white" style={{ width: '100%', maxWidth: 340, padding: 24 }}>
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
              className="btn-pill-outline"
              style={{ width: '100%', marginBottom: 10 }}
              onClick={() => setStrkAmount(suggested)}
            >
              Use suggested · {(Number(suggested) / 1e18).toFixed(1)} STRK
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
            <p style={{ fontSize: 12, color: '#16a34a', marginTop: 10, textAlign: 'center' }}>
              ✓ {settleMsg}
            </p>
          )}
        </div>

        <button
          onClick={() => { window.location.href = '/home' }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            color: '#5a5a5a',
            fontWeight: 500,
          }}
        >
          Skip payment →
        </button>
      </main>
    )
  }

  return (
    <main className="theme-rose page-enter" style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 20px',
      gap: 0,
    }}>
      {/* Caller info */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          fontSize: 32,
          fontWeight: 800,
          letterSpacing: '-0.035em',
          color: '#111',
          lineHeight: 1.1,
          marginBottom: 8,
        }}>
          Encrypted Call
        </div>
        <span className="label-tag">Calling via Tor · Noise_XX</span>
      </div>

      {/* Timer */}
      <div style={{
        fontSize: 64,
        fontWeight: 800,
        letterSpacing: '-0.04em',
        color: '#111',
        lineHeight: 1,
        marginBottom: 48,
      }}>
        {mm}:{ss}
      </div>

      {/* Concentric rings illustration */}
      <div style={{ position: 'relative', width: 180, height: 180, marginBottom: 56, flexShrink: 0 }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: '2px solid rgba(17,17,17,0.12)',
          animation: 'ring-pulse 2s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute',
          inset: 24,
          borderRadius: '50%',
          border: '2px solid rgba(17,17,17,0.2)',
        }} />
        <div style={{
          position: 'absolute',
          inset: 48,
          borderRadius: '50%',
          border: '2.5px solid #111',
          background: 'rgba(17,17,17,0.06)',
        }} />
        <div style={{
          position: 'absolute',
          inset: 72,
          borderRadius: '50%',
          background: '#111',
        }} />
        <style>{`
          @keyframes ring-pulse {
            0%, 100% { transform: scale(1); opacity: 0.5; }
            50% { transform: scale(1.08); opacity: 1; }
          }
        `}</style>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32 }}>
        {/* Mute */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <button
            onClick={toggleMute}
            className="btn-pill-outline"
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              background: isMuted ? '#111' : 'transparent',
              color: isMuted ? '#fff' : '#111',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
          <span style={{ fontSize: 11, color: '#5a5a5a', fontWeight: 600 }}>
            {isMuted ? 'Unmute' : 'Mute'}
          </span>
        </div>

        {/* End call */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <button
            onClick={endCall}
            className="btn-pill-danger"
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="white" stroke="none">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" transform="rotate(135 12 12)" />
            </svg>
          </button>
          <span style={{ fontSize: 11, color: '#5a5a5a', fontWeight: 600 }}>End</span>
        </div>

        {/* Speaker */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <button
            className="btn-pill-outline"
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
            onClick={() => {/* no-op for now */}}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          </button>
          <span style={{ fontSize: 11, color: '#5a5a5a', fontWeight: 600 }}>Speaker</span>
        </div>
      </div>
    </main>
  )
}
