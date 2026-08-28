'use client'

import { useState, useEffect, useRef } from 'react'
import { startCapture, stopCapture, setMuted, playInboundFrame } from '../../lib/audio-engine'

export default function CallPage() {
  const [torStatus, setTorStatus] = useState<{ running: boolean } | null>(null)
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

    gc.getTorStatus?.().then((s: { running: boolean }) => setTorStatus(s))
    gc.onTorStatus?.((s: { running: boolean }) => setTorStatus(s))

    // Start audio capture
    if (!startedRef.current) {
      startedRef.current = true
      startCapture().catch(console.error)
    }

    // Wire inbound audio
    gc.onInboundFrame?.((frame: ArrayBuffer) => {
      playInboundFrame(frame)
    })

    // Start timer
    timerRef.current = setInterval(() => setElapsed(t => t + 1), 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  function toggleMute() {
    const next = !isMuted
    setIsMuted(next)
    setMuted(next)
  }

  async function endCall() {
    stopCapture()
    const gc = (window as any).ghostcall
    try {
      await gc?.hangUp?.()
    } catch { /* ignore */ }
    if (timerRef.current) clearInterval(timerRef.current)
    setShowSettle(true)
  }

  async function settlePayment() {
    if (!strkAmount.trim()) return
    setSettling(true)
    setSettleMsg('')
    const gc = (window as any).ghostcall
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
  const torConnected = torStatus?.running === true

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
          <input
            className="input"
            type="text"
            placeholder="STRK amount"
            value={strkAmount}
            onChange={e => setStrkAmount(e.target.value)}
            disabled={settling}
            onKeyDown={e => { if (e.key === 'Enter') settlePayment() }}
          />
          <button
            className="btn-primary"
            onClick={settlePayment}
            disabled={!strkAmount.trim() || settling}
            style={{ width: '100%' }}
          >
            {settling ? 'Settling…' : 'Settle'}
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
      {/* Call timer */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-2xl)',
        fontWeight: 300,
        letterSpacing: 'var(--tracking-tight)',
        color: 'var(--ink-primary)',
      }}>
        {mm}:{ss}
      </div>

      {/* Encryption + Tor status */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            className={torConnected ? 'status-dot status-dot--connected' : 'status-dot status-dot--error'}
          />
          <span style={{
            fontSize: 'var(--text-xs)',
            color: torConnected ? 'var(--accent)' : 'var(--status-error)',
            letterSpacing: 'var(--tracking-wide)',
            fontFamily: 'var(--font-mono)',
          }}>
            {torConnected ? 'Tor · Noise_XX' : 'Tor unavailable'}
          </span>
        </div>
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
