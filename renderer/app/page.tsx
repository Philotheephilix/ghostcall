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

  return (
    <main className="page" style={{ gap: 'var(--space-10)' }}>
      {/* Tor error banner */}
      {torStatus && !torOk && (
        <div className="error-banner">
          Tor unavailable.{' '}
          <a href="https://www.torproject.org/download/" target="_blank" rel="noreferrer">
            Install Tor
          </a>
          {' '}to make calls.
        </div>
      )}

      {/* Logo + status */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Logo size={52} variant="dark" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className={`status-dot ${torOk ? 'status-dot--connected' : 'status-dot--error'}`} />
          <span className="mono-xs" style={{ color: torOk ? 'var(--accent)' : 'var(--status-error)' }}>
            {isOnline ? onionAddr.slice(0, 16) + '…' : torOk ? 'private' : 'offline'}
          </span>
        </div>
      </div>

      {/* Dial */}
      <DialPad
        onionAddr={onionAddr}
        isOnline={isOnline}
        torReady={torOk}
        onGoOnline={goOnline}
      />

      {statusMsg && (
        <span className="mono-xs" style={{ color: 'var(--status-error)' }}>{statusMsg}</span>
      )}
    </main>
  )
}
