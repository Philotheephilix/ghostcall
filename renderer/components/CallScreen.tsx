'use client'

import { useState, useEffect, useRef } from 'react'
import { startCapture, stopCapture, setMuted, playInboundFrame } from '../lib/audio-engine'

/**
 * CallScreen — rendered during an active call.
 * Starts audio capture, shows a live timer, mute/end controls,
 * and a post-call payment settlement panel.
 */
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
    const gc = (window as unknown as { ghostcall: Record<string, (...args: unknown[]) => unknown> }).ghostcall
    if (!gc) return

    // Start audio capture once
    if (!startedRef.current) {
      startedRef.current = true
      startCapture().catch(console.error)
    }

    // Wire inbound audio
    if (typeof gc.onInboundFrame === 'function') {
      gc.onInboundFrame((frame: unknown) => {
        playInboundFrame(frame as ArrayBuffer)
      })
    }

    // Start timer
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
    const gc = (window as unknown as { ghostcall: Record<string, (...args: unknown[]) => Promise<unknown>> }).ghostcall
    try { await gc?.hangUp?.() } catch { /* ignore */ }
    setShowSettle(true)
  }

  async function settlePayment() {
    if (!strkAmount.trim()) return
    setSettling(true)
    setSettleMsg('')
    const gc = (window as unknown as { ghostcall: Record<string, (...args: unknown[]) => Promise<unknown>> }).ghostcall
    try {
      const result = await gc?.settlePayment?.(strkAmount.trim())
      setSettleMsg(`Settled: tx ${String(result).slice(0, 10)}…`)
    } catch (e) {
      setSettleMsg(`Error: ${(e as Error).message}`)
    } finally {
      setSettling(false)
    }
  }

  function dismiss() {
    window.location.href = '/'
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  // Suggested amount: 0.1 STRK per minute (in base units 10^17 per minute)
  const suggestedAmount = elapsed > 0
    ? (BigInt(Math.ceil(elapsed / 60)) * BigInt(1e17)).toString()
    : ''

  if (showSettle) {
    return (
      <main style={{
        minHeight: '100vh',
        background: 'var(--surface-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8)',
        gap: 'var(--space-6)',
      }}>
        <div className="card" style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <span className="label">Settle payment</span>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', margin: 0, fontFamily: 'var(--font-mono)' }}>
            Call duration: {mm}:{ss}
          </p>
          <input
            className="input"
            type="text"
            placeholder={suggestedAmount || 'STRK amount in base units'}
            value={strkAmount}
            onChange={e => setStrkAmount(e.target.value)}
            disabled={settling}
            onKeyDown={e => { if (e.key === 'Enter') settlePayment() }}
          />
          {suggestedAmount && !strkAmount && (
            <button
              className="btn-ghost"
              style={{ width: '100%', fontSize: 'var(--text-xs)' }}
              onClick={() => setStrkAmount(suggestedAmount)}
            >
              Use suggested ({(Number(suggestedAmount) / 1e18).toFixed(1)} STRK)
            </button>
          )}
          <button
            className="btn-primary"
            onClick={settlePayment}
            disabled={!strkAmount.trim() || settling}
            style={{ width: '100%' }}
          >
            {settling ? 'Settling…' : 'Settle (STRK20)'}
          </button>
          {settleMsg && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)', fontFamily: 'var(--font-mono)' }}>
              {settleMsg}
            </span>
          )}
          <button className="btn-ghost" onClick={dismiss} style={{ width: '100%' }}>
            Skip
          </button>
        </div>
      </main>
    )
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--surface-bg)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-8)',
      gap: 'var(--space-8)',
    }}>
      {/* Timer */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-2xl)',
        fontWeight: 300,
        letterSpacing: 'var(--tracking-tight)',
        color: 'var(--ink-primary)',
      }}>
        {mm}:{ss}
      </div>

      {/* Status line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span className="status-dot status-dot--connected" />
        <span style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--accent)',
          letterSpacing: 'var(--tracking-wide)',
          fontFamily: 'var(--font-mono)',
        }}>
          Tor · Noise_XX · SRTP off
        </span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
        <button
          className={isMuted ? 'btn-primary' : 'btn-ghost'}
          onClick={toggleMute}
          style={{ minWidth: 120 }}
        >
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
        <button
          onClick={endCall}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 120,
            padding: 'var(--space-3) var(--space-6)',
            background: 'var(--status-error)',
            color: '#fff',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            letterSpacing: 'var(--tracking-wide)',
            textTransform: 'uppercase',
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          End call
        </button>
      </div>
    </main>
  )
}
