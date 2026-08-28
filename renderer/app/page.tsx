'use client'

import { useState, useEffect } from 'react'
import Logo from '../components/Logo'
import DialPad from '../components/DialPad'

export default function Home() {
  const [torStatus, setTorStatus] = useState<{ running: boolean; error?: string } | null>(null)
  const [isOnline, setIsOnline] = useState(false)
  const [onionAddr, setOnionAddr] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  type GhostCall = {
    getTorStatus?: () => Promise<{ running: boolean; error?: string }>
    onTorStatus?: (cb: (s: { running: boolean; error?: string }) => void) => void
    onCallConnected?: (cb: (info: { direction: string; onionAddr?: string }) => void) => void
    onCallError?: (cb: (err: { message: string }) => void) => void
    goOnline?: () => Promise<string | { onionAddr?: string }>
  }

  useEffect(() => {
    const gc = (window as Window & { ghostcall?: GhostCall }).ghostcall
    if (!gc) return

    gc.getTorStatus?.().then((s) => setTorStatus(s))
    gc.onTorStatus?.((s) => setTorStatus(s))

    gc.onCallConnected?.((_info) => {
      // Navigate to call screen when incoming call connects
      window.location.href = '/call'
    })

    gc.onCallError?.((err) => {
      setStatusMsg(`Call failed: ${err.message}`)
    })
  }, [])

  async function goOnline() {
    const gc = (window as Window & { ghostcall?: GhostCall }).ghostcall
    if (!gc?.goOnline) return
    try {
      const result = await gc.goOnline()
      const addr = typeof result === 'string' ? result : result?.onionAddr ?? ''
      setOnionAddr(addr)
      setIsOnline(true)
      setStatusMsg('')
    } catch (e) {
      setStatusMsg(`Error: ${(e as Error).message}`)
    }
  }

  const torConnected = torStatus?.running === true
  const torDotClass = torConnected ? 'status-dot status-dot--connected' : 'status-dot status-dot--error'

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
      {/* Tor unavailable banner */}
      {torStatus && !torConnected && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          background: 'var(--status-error)',
          color: '#fff',
          fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-sans)',
          letterSpacing: 'var(--tracking-wide)',
          padding: 'var(--space-3) var(--space-6)',
          textAlign: 'center',
          zIndex: 100,
        }}>
          Tor unavailable — calls require Tor.{' '}
          <a
            href="https://www.torproject.org/download/"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#fff', textDecoration: 'underline' }}
          >
            Install Tor
          </a>
        </div>
      )}

      {/* Logo */}
      <Logo size={56} variant="dark" />

      {/* Tor status + online state */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className={torDotClass} title={torStatus?.error ?? (torConnected ? 'Tor connected' : 'Tor not running')} />
          <span style={{ fontSize: 'var(--text-xs)', color: torConnected ? 'var(--accent)' : 'var(--status-error)' }}>
            {torConnected ? 'private' : 'tor unavailable'}
          </span>
        </div>

        {isOnline && onionAddr && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--ink-muted)',
          }}>
            {onionAddr.slice(0, 16)}…{onionAddr.slice(-6)}
          </span>
        )}
      </div>

      {/* Dial area — two-tab DialPad (BY HANDLE + DIRECT demo mode) */}
      <DialPad
        onionAddr={onionAddr}
        isOnline={isOnline}
        onGoOnline={goOnline}
      />

      {/* Status */}
      {statusMsg && (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
          {statusMsg}
        </span>
      )}
    </main>
  )
}
