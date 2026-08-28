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
    const target = handle.trim()
    if (!target) return
    setIsCalling(true)
    setStatusMsg('')
    try {
      const meta = await gc().lookupStealth(target)
      const onion = (meta as any)?.onionAddr ?? (meta as any)?.onion_addr ?? target
      await gc().initiateCall(onion)
      window.location.href = '/call'
    } catch (e) {
      setIsCalling(false)
      setStatusMsg((e as Error).message)
    }
  }

  async function callDirect() {
    const target = directAddr.trim()
    if (!target) return
    setIsCalling(true)
    setStatusMsg('')
    try {
      await gc().initiateCall(target)
      window.location.href = '/call'
    } catch (e) {
      setIsCalling(false)
      setStatusMsg((e as Error).message)
    }
  }

  async function handleGoOnline() {
    setIsGoingOnline(true)
    try {
      if (onGoOnline) {
        await onGoOnline()
      } else {
        const result = await gc().goOnline()
        const addr = typeof result === 'string' ? result : (result as any)?.onionAddr ?? ''
        setStatusMsg(addr ? `${addr.slice(0, 18)}…` : 'Online')
      }
    } catch (e) {
      setStatusMsg((e as Error).message)
    } finally {
      setIsGoingOnline(false)
    }
  }

  return (
    <div style={{ width: '100%', maxWidth: 320 }}>
      {/* Tab bar */}
      <div className="tabs">
        <button className={`tab${tab === 'handle' ? ' active' : ''}`} onClick={() => setTab('handle')}>
          By handle
        </button>
        <button className={`tab${tab === 'direct' ? ' active' : ''}`} onClick={() => setTab('direct')}>
          Direct
        </button>
      </div>

      {/* Tab content */}
      {tab === 'handle' ? (
        <div className="form-stack">
          <input
            className="input"
            type="text"
            placeholder="handle"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            disabled={isCalling || !torReady}
            onKeyDown={e => { if (e.key === 'Enter') callByHandle() }}
            autoFocus
          />
          <button
            className="btn-primary"
            onClick={callByHandle}
            disabled={!handle.trim() || isCalling || !torReady}
          >
            {isCalling ? 'Calling…' : 'Call'}
          </button>
        </div>
      ) : (
        <div className="form-stack">
          <input
            className="input"
            type="text"
            placeholder="abc…onion:7331"
            value={directAddr}
            onChange={e => setDirectAddr(e.target.value)}
            disabled={isCalling || !torReady}
            onKeyDown={e => { if (e.key === 'Enter') callDirect() }}
            autoFocus
          />
          <button
            className="btn-primary"
            onClick={callDirect}
            disabled={!directAddr.trim() || isCalling || !torReady}
          >
            {isCalling ? 'Calling…' : 'Call'}
          </button>
          {onionAddr && (
            <button
              className="btn-ghost"
              style={{ fontSize: 'var(--text-xs)' }}
              onClick={() => navigator.clipboard?.writeText(onionAddr).catch(() => {})}
            >
              Copy my address
            </button>
          )}
        </div>
      )}

      {/* Go online */}
      <div style={{ marginTop: 'var(--space-5)' }}>
        <button
          className="btn-ghost"
          onClick={handleGoOnline}
          disabled={isOnline || isGoingOnline || !torReady}
        >
          {isOnline ? 'Online' : isGoingOnline ? 'Starting…' : 'Go online'}
        </button>
      </div>

      {statusMsg && (
        <p className="mono-xs" style={{ marginTop: 'var(--space-3)', color: 'var(--ink-secondary)' }}>
          {statusMsg}
        </p>
      )}
    </div>
  )
}
