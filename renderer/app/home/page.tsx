'use client'

import { useState, useEffect } from 'react'
import Logo from '../../components/Logo'
import DialPad from '../../components/DialPad'
import { useTorStatus } from '../../hooks/useTorStatus'
import { loadState } from '../../lib/app-state'
import { onIdentityReady } from '../../lib/identity-client'

export default function Home() {
  const torStatus = useTorStatus()
  const [ready, setReady] = useState(false)
  const [isOnline, setIsOnline] = useState(false)
  const [onionAddr, setOnionAddr] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [handle, setHandle] = useState('')

  useEffect(() => {
    let innerCleanup: (() => void) | null = null
    const cleanup = onIdentityReady(({ source, error }) => {
      cleanup() // one-shot

      if (error === 'decryption-failed') {
        window.location.replace('/onboarding')
        return
      }

      const state = loadState()
      if (source === '' || !state.onboardingDone || !state.registered) {
        window.location.replace('/onboarding')
        return
      }

      setHandle(state.handle)
      setReady(true)

      const gc = (window as any).ghostcall
      if (!gc) return
      const cleanup1 = gc.onCallConnected?.(() => { window.location.href = '/call' })
      const cleanup2 = gc.onCallError?.((err: { message: string }) => setStatusMsg(err.message))
      innerCleanup = () => { cleanup1?.(); cleanup2?.() }
    })

    return () => { cleanup(); innerCleanup?.() }
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

  if (!ready) return null

  return (
    <main className="page" style={{ gap: 0 }}>
      {/* Green glow when connected */}
      {torOk && (
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 320, height: 220,
          background: 'radial-gradient(ellipse at 50% 0%, rgba(48,209,88,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginBottom: 44 }}>
        <Logo size={56} glowColor={torOk ? 'rgba(48,209,88,0.85)' : 'rgba(255,255,255,0.15)'} />
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.1 }}>
            GhostCall
          </h1>
          {handle && (
            <p style={{ fontSize: 13, color: 'var(--label-tertiary)', marginTop: 3 }}>
              @{handle}
            </p>
          )}
        </div>

        {/* Tor status pill */}
        <div className={`status-pill ${torOk ? 'status-pill--connected' : torStatus === null ? 'status-pill--offline' : 'status-pill--error'}`}>
          <span className="dot" />
          <span>
            {torOk
              ? isOnline ? onionAddr.slice(0, 14) + '…' : 'Private'
              : torStatus === null ? 'Connecting…' : 'Tor unavailable'}
          </span>
        </div>
      </div>

      {/* Dial card */}
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
          marginTop: 14, fontSize: 12, color: 'var(--system-red)',
          fontFamily: 'var(--font-mono)', textAlign: 'center', maxWidth: 320,
        }}>
          {statusMsg}
        </p>
      )}

      {/* Settings link */}
      <button
        onClick={() => { window.location.href = '/settings' }}
        style={{
          position: 'absolute', top: 20, right: 20,
          background: 'var(--glass-thin)', border: '0.5px solid var(--glass-border-sub)',
          borderRadius: '50%', width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'var(--label-tertiary)', fontSize: 16,
        }}
      >
        ⚙︎
      </button>
    </main>
  )
}
