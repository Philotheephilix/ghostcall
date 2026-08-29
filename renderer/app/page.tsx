'use client'

import { useState, useEffect } from 'react'
import Logo from '../components/Logo'
import DialPad from '../components/DialPad'
import { useTorStatus } from '../hooks/useTorStatus'

export default function Home() {
  const torStatus = useTorStatus()
  const [isOnline, setIsOnline] = useState(false)
  const [onionAddr, setOnionAddr] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    const gc = (window as any).ghostcall
    if (!gc) return
    gc.onCallConnected?.(() => { window.location.href = '/call' })
    gc.onCallError?.((err: { message: string }) => setStatusMsg(err.message))
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

  const pillClass = torOk
    ? 'status-pill status-pill--connected'
    : torStatus === null
    ? 'status-pill status-pill--offline'
    : 'status-pill status-pill--error'

  const pillLabel = torOk
    ? isOnline ? onionAddr.slice(0, 14) + '…' : 'Private'
    : torStatus === null ? 'Connecting…' : 'Tor unavailable'

  return (
    <main className="page" style={{ gap: 0 }}>
      {/* Ambient top glow when connected */}
      {torOk && (
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 300, height: 200,
          background: 'radial-gradient(ellipse at 50% 0%, rgba(48,209,88,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Top section */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, marginBottom: 48 }}>
        <Logo size={60} glowColor={torOk ? 'rgba(48,209,88,0.8)' : 'rgba(255,255,255,0.2)'} />

        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            fontSize: 28, fontWeight: 700, letterSpacing: -0.6,
            color: 'var(--label-primary)', lineHeight: 1.1, marginBottom: 4,
          }}>
            GhostCall
          </h1>
          <p style={{ fontSize: 13, color: 'var(--label-tertiary)', letterSpacing: 0 }}>
            Private · Untraceable · Trustless
          </p>
        </div>

        {/* Tor status pill */}
        <div className={pillClass}>
          <span className="dot" />
          <span>{pillLabel}</span>
        </div>
      </div>

      {/* Glass dial card */}
      <div className="glass-card" style={{ width: '100%', maxWidth: 360, padding: 0, overflow: 'hidden' }}>
        <DialPad
          onionAddr={onionAddr}
          isOnline={isOnline}
          torReady={torOk}
          onGoOnline={goOnline}
        />
      </div>

      {statusMsg && (
        <p style={{
          marginTop: 16, fontSize: 12, color: 'var(--system-red)',
          fontFamily: 'var(--font-mono)', textAlign: 'center', maxWidth: 320,
        }}>
          {statusMsg}
        </p>
      )}
    </main>
  )
}
