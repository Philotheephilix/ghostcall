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
      setSettleMsg(`tx ${String(result).slice(0, 10)}…`)
    } catch (e) {
      setSettleMsg((e as Error).message)
    } finally {
      setSettling(false)
    }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const suggested = elapsed > 0
    ? (BigInt(Math.ceil(elapsed / 60)) * BigInt(1e17)).toString()
    : ''

  if (showSettle) {
    return (
      <main className="page" style={{ gap: 'var(--space-6)' }}>
        <div className="card" style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span className="label">Settle</span>
            <span className="mono-xs">{mm}:{ss}</span>
          </div>
          <div className="form-stack">
            <input
              className="input"
              type="text"
              placeholder={suggested || 'Amount in STRK base units'}
              value={strkAmount}
              onChange={e => setStrkAmount(e.target.value)}
              disabled={settling}
              onKeyDown={e => { if (e.key === 'Enter') settlePayment() }}
            />
            {suggested && !strkAmount && (
              <button
                className="btn-ghost"
                style={{ fontSize: 'var(--text-xs)' }}
                onClick={() => setStrkAmount(suggested)}
              >
                {(Number(suggested) / 1e18).toFixed(1)} STRK suggested
              </button>
            )}
            <button
              className="btn-primary"
              onClick={settlePayment}
              disabled={!strkAmount.trim() || settling}
            >
              {settling ? 'Settling…' : 'Pay'}
            </button>
            {settleMsg && <span className="mono-xs">{settleMsg}</span>}
          </div>
          <button className="btn-ghost" onClick={() => { window.location.href = '/' }}>
            Skip
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="page" style={{ gap: 'var(--space-10)' }}>
      {/* Timer — the signature element: oversized mono, breathing room */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)' }}>
        <span className="call-timer">{mm}:{ss}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="status-dot status-dot--connected" />
          <span className="mono-xs" style={{ color: 'var(--accent)' }}>Tor · Noise_XX</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        <button
          className="btn-ghost"
          onClick={toggleMute}
          style={{ width: 120 }}
        >
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
        <button className="btn-danger" onClick={endCall} style={{ width: 120 }}>
          End call
        </button>
      </div>
    </main>
  )
}
