'use client'

import { useState } from 'react'

type Tab = 'handle' | 'direct'

interface DialPadProps {
  onionAddr?: string
  isOnline?: boolean
  torReady?: boolean
  onGoOnline?: () => Promise<void>
}

export default function DialPad({ onionAddr, isOnline, torReady = true, onGoOnline }: DialPadProps) {
  const [tab, setTab] = useState<Tab>('handle')
  const [handle, setHandle] = useState('')
  const [directAddr, setDirectAddr] = useState('')
  const [isCalling, setIsCalling] = useState(false)
  const [isGoingOnline, setIsGoingOnline] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  const gc = () => (window as any).ghostcall

  function copyAddr(text?: string) {
    const value = text ?? ''
    if (!value) return
    const bridge = gc()
    if (bridge?.copyToClipboard) {
      bridge.copyToClipboard(value)
    } else {
      navigator.clipboard?.writeText(value).catch(() => {})
    }
  }

  async function callByHandle() {
    const trimmedHandle = handle.trim()
    if (!trimmedHandle || isCalling) return
    setIsCalling(true)
    setStatusMsg('')
    try {
      const meta = await gc().lookupStealth(trimmedHandle)
      if (!meta?.nostrPubkey) {
        throw new Error(`Handle "${trimmedHandle}" is not registered`)
      }
      let myOnion = onionAddr
      if (!myOnion) {
        const result = await gc().goOnline()
        myOnion = typeof result === 'string' ? result : (result as any)?.onionAddr ?? ''
      }
      if (!myOnion) throw new Error('Could not open an onion service — is Tor running?')

      const callId = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2))
      const offer = await gc().buildCallOffer(
        { onionAddr: myOnion, callId, callerNoisePubkey: '' },
        {
          nostrPubkey: String(meta.nostrPubkey),
          pkVx: String(meta.pkVx),
          pkVy: String(meta.pkVy),
        },
      )
      await gc().publishSignal(offer)
      window.location.href = '/call'
    } catch (e) {
      setIsCalling(false)
      setStatusMsg((e as Error).message)
    }
  }

  async function callDirect() {
    const trimmedAddr = directAddr.trim()
    if (!trimmedAddr || isCalling) return
    setIsCalling(true)
    setStatusMsg('')
    try {
      await gc().initiateCall(trimmedAddr)
      window.location.href = '/call'
    } catch (e) {
      setIsCalling(false)
      setStatusMsg((e as Error).message)
    }
  }

  async function handleGoOnline() {
    setIsGoingOnline(true)
    try {
      if (onGoOnline) { await onGoOnline() }
      else {
        const result = await gc().goOnline()
        const addr = typeof result === 'string' ? result : (result as any)?.onionAddr ?? ''
        if (addr) setStatusMsg(addr.slice(0, 20) + '…')
      }
    } catch (e) { setStatusMsg((e as Error).message) }
    finally { setIsGoingOnline(false) }
  }

  return (
    <div>
      {/* Segmented control */}
      <div style={{ padding: '16px 16px 0' }}>
        <div className="seg-control">
          <button className={`seg-btn${tab === 'handle' ? ' active' : ''}`} onClick={() => setTab('handle')}>
            Handle
          </button>
          <button className={`seg-btn${tab === 'direct' ? ' active' : ''}`} onClick={() => setTab('direct')}>
            Onion
          </button>
        </div>
      </div>

      {/* Input + action */}
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tab === 'handle' ? (
          <>
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                fontFamily: 'var(--font-mono)', fontSize: 16,
                color: handle ? 'var(--turmeric)' : 'var(--label-tertiary)',
                pointerEvents: 'none', lineHeight: 1,
                transition: 'color 150ms',
              }}>@</span>
              <input
                className="input-glass"
                type="text"
                placeholder="handle"
                value={handle}
                onChange={e => setHandle(e.target.value)}
                disabled={isCalling || !torReady}
                onKeyDown={e => e.key === 'Enter' && callByHandle()}
                autoFocus
                style={{ fontSize: 16, paddingLeft: 26 }}
              />
            </div>
            <button
              className="btn-primary"
              onClick={callByHandle}
              disabled={!handle || isCalling || !torReady}
              style={{ letterSpacing: '0.06em', transition: 'letter-spacing 200ms, box-shadow 150ms, opacity 100ms, transform 80ms var(--spring)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.letterSpacing = '0.12em' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.letterSpacing = '0.06em' }}
            >
              {isCalling ? 'Connecting…' : 'Call'}
            </button>
          </>
        ) : (
          <>
            <input
              className="input-glass"
              type="text"
              placeholder="abc…onion:7331"
              value={directAddr}
              onChange={e => setDirectAddr(e.target.value)}
              disabled={isCalling || !torReady}
              onKeyDown={e => e.key === 'Enter' && callDirect()}
              autoFocus
              style={{ fontSize: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' }}
            />
            <button
              className="btn-primary"
              onClick={callDirect}
              disabled={!directAddr || isCalling || !torReady}
              style={{ letterSpacing: '0.06em', transition: 'letter-spacing 200ms, box-shadow 150ms, opacity 100ms, transform 80ms var(--spring)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.letterSpacing = '0.12em' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.letterSpacing = '0.06em' }}
            >
              {isCalling ? 'Connecting…' : 'Call'}
            </button>
            {onionAddr && (
              <button
                className="btn-text"
                style={{
                  fontSize: 10, justifyContent: 'flex-start', paddingLeft: 0,
                  color: 'var(--label-quaternary)', letterSpacing: '0.06em',
                  textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
                }}
                onClick={() => copyAddr(onionAddr)}
              >
                Copy my address
              </button>
            )}
          </>
        )}
      </div>

      {/* Divider */}
      <div className="divider" />

      {/* Go online row */}
      <button
        onClick={handleGoOnline}
        disabled={isOnline || isGoingOnline || !torReady}
        style={{
          width: '100%', padding: '14px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'transparent', border: 'none', cursor: isOnline ? 'default' : 'pointer',
          transition: 'background 120ms, opacity 400ms',
          opacity: !torReady ? 0.4 : 1,
        }}
        className={!isOnline ? 'hover:bg-glass-thin' : ''}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isOnline && (
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--turmeric)',
              boxShadow: '0 0 8px rgba(253,205,42,0.6)',
              animation: 'pulse-dot 2.5s ease-in-out infinite',
            }} />
          )}
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: isOnline ? 'var(--turmeric)' : 'var(--label-secondary)',
          }}>
            {isOnline ? 'Online' : isGoingOnline ? 'Starting…' : 'Go online'}
          </span>
        </div>
        {isOnline
          ? <span
              onClick={e => { e.stopPropagation(); copyAddr(onionAddr) }}
              title="Click to copy"
              style={{
                fontSize: 9, fontFamily: 'var(--font-mono)',
                color: 'var(--turmeric)', opacity: 0.5,
                cursor: 'copy', letterSpacing: '0.04em',
              }}
            >
              {onionAddr?.slice(0, 14)}…
            </span>
          : <span style={{ fontSize: 14, color: 'var(--label-quaternary)', fontFamily: 'var(--font-mono)' }}>›</span>
        }
      </button>

      {statusMsg && (
        <p style={{
          margin: '0 16px 12px', fontSize: 10, color: 'var(--system-red)',
          fontFamily: 'var(--font-mono)', wordBreak: 'break-all', letterSpacing: '0.02em',
        }}>
          ERR: {statusMsg}
        </p>
      )}
    </div>
  )
}
