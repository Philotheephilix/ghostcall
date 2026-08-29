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

  async function callByHandle() {
    if (!handle.trim() || isCalling) return
    setIsCalling(true)
    setStatusMsg('')
    try {
      const meta = await gc().lookupStealth(handle.trim())
      const onion = (meta as any)?.onionAddr ?? (meta as any)?.onion_addr ?? handle.trim()
      await gc().initiateCall(onion)
      window.location.href = '/call'
    } catch (e) {
      setIsCalling(false)
      setStatusMsg((e as Error).message)
    }
  }

  async function callDirect() {
    if (!directAddr.trim() || isCalling) return
    setIsCalling(true)
    setStatusMsg('')
    try {
      await gc().initiateCall(directAddr.trim())
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
            By Handle
          </button>
          <button className={`seg-btn${tab === 'direct' ? ' active' : ''}`} onClick={() => setTab('direct')}>
            Direct
          </button>
        </div>
      </div>

      {/* Input + action */}
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tab === 'handle' ? (
          <>
            <input
              className="input-glass"
              type="text"
              placeholder="Handle"
              value={handle}
              onChange={e => setHandle(e.target.value)}
              disabled={isCalling || !torReady}
              onKeyDown={e => e.key === 'Enter' && callByHandle()}
              autoFocus
              style={{ fontSize: 17 }}
            />
            <button
              className="btn-primary"
              onClick={callByHandle}
              disabled={!handle.trim() || isCalling || !torReady}
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
              style={{ fontSize: 15, fontFamily: 'var(--font-mono)' }}
            />
            <button
              className="btn-primary"
              onClick={callDirect}
              disabled={!directAddr.trim() || isCalling || !torReady}
            >
              {isCalling ? 'Connecting…' : 'Call'}
            </button>
            {onionAddr && (
              <button
                className="btn-text"
                style={{ fontSize: 13, justifyContent: 'flex-start', paddingLeft: 0, color: 'var(--label-secondary)' }}
                onClick={() => navigator.clipboard?.writeText(onionAddr).catch(() => {})}
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
          color: isOnline ? 'var(--system-green)' : 'var(--label-secondary)',
          fontSize: 15, fontFamily: 'var(--font-system)',
          transition: 'background 120ms',
        }}
        onMouseEnter={e => { if (!isOnline) (e.currentTarget as HTMLElement).style.background = 'var(--glass-thin)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        <span>{isOnline ? 'Online' : isGoingOnline ? 'Starting…' : 'Go online'}</span>
        {isOnline
          ? <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--system-green)', opacity: 0.7 }}>
              {onionAddr.slice(0, 12)}…
            </span>
          : <span style={{ fontSize: 19, color: 'var(--label-quaternary)' }}>›</span>
        }
      </button>

      {statusMsg && (
        <p style={{
          margin: '0 16px 12px', fontSize: 12, color: 'var(--system-red)',
          fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
        }}>
          {statusMsg}
        </p>
      )}
    </div>
  )
}
