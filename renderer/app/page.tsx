'use client'

import { useState, useEffect } from 'react'
import Logo from '../components/Logo'

export default function Home() {
  const [torStatus, setTorStatus] = useState<{ running: boolean; error?: string } | null>(null)
  const [handle, setHandle] = useState('')
  const [isOnline, setIsOnline] = useState(false)
  const [onionAddr, setOnionAddr] = useState('')
  const [isCalling, setIsCalling] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    const gc = (window as any).ghostcall
    if (!gc) return

    gc.getTorStatus?.().then((s: { running: boolean; error?: string }) => setTorStatus(s))
    gc.onTorStatus?.((s: { running: boolean; error?: string }) => setTorStatus(s))

    gc.onCallConnected?.((info: { direction: string; onionAddr?: string }) => {
      setIsCalling(false)
      // Navigate to call screen
      window.location.href = '/call'
    })

    gc.onCallError?.((err: { message: string }) => {
      setIsCalling(false)
      setStatusMsg(`Call failed: ${err.message}`)
    })
  }, [])

  async function goOnline() {
    const gc = (window as any).ghostcall
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

  async function call() {
    if (!handle.trim() || !torStatus?.running) return
    setIsCalling(true)
    setStatusMsg('')
    const gc = (window as any).ghostcall
    try {
      // Lookup the handle to get onion address
      const meta = await gc.lookupStealth(handle.trim())
      const targetOnion = meta?.onionAddr ?? meta?.onion_addr ?? handle.trim()
      await gc.initiateCall(targetOnion)
    } catch (e) {
      setIsCalling(false)
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

      {/* Dial area */}
      <div style={{
        width: '100%',
        maxWidth: 320,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
      }}>
        <input
          className="input"
          type="text"
          placeholder="handle or onion address"
          value={handle}
          onChange={e => setHandle(e.target.value)}
          disabled={isCalling}
          onKeyDown={e => { if (e.key === 'Enter') call() }}
        />
        <button
          className="btn-primary"
          onClick={call}
          disabled={!handle.trim() || isCalling || !torConnected}
          style={{ width: '100%' }}
        >
          {isCalling ? 'Calling…' : 'call'}
        </button>
      </div>

      {/* Go online button */}
      <button
        className="btn-ghost"
        onClick={goOnline}
        disabled={isOnline}
      >
        {isOnline ? 'online' : 'go online'}
      </button>

      {/* Status */}
      {statusMsg && (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
          {statusMsg}
        </span>
      )}
    </main>
  )
}
