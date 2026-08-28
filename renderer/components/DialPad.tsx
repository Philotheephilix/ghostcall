'use client'

import { useState } from 'react'

type Tab = 'handle' | 'direct'

interface DialPadProps {
  onionAddr?: string       // caller's own onion address (shown after goOnline)
  isOnline?: boolean
  onGoOnline?: () => Promise<void>
}

/**
 * Two-tab dial pad:
 *  • BY HANDLE — full Nostr + Starknet lookup flow (requires Tor + Starknet)
 *  • DIRECT    — paste an onion address and call directly (demo mode, requires Tor)
 *
 * Both tabs navigate to /call on success.
 */
export default function DialPad({ onionAddr, isOnline, onGoOnline }: DialPadProps) {
  const [activeTab, setActiveTab] = useState<Tab>('handle')
  const [handle, setHandle] = useState('')
  const [directAddr, setDirectAddr] = useState('')
  const [isCalling, setIsCalling] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [isGoingOnline, setIsGoingOnline] = useState(false)

  const gc = () => (window as unknown as { ghostcall: Record<string, (...args: unknown[]) => Promise<unknown>> }).ghostcall

  async function callByHandle() {
    const target = handle.trim()
    if (!target) return
    setIsCalling(true)
    setStatusMsg('Looking up handle on Starknet…')
    try {
      const meta = await gc().lookupStealth(target)
      setStatusMsg('Initiating call through Tor…')
      // The handle lookup returns stealth meta. For the call we pass the onion address
      // stored in the meta (if any) or fall through to Nostr signaling.
      // For MVP/demo, fall back to directAddr if meta has no onion.
      const targetOnion = (meta as { onionAddr?: string; onion_addr?: string })?.onionAddr
        ?? (meta as { onionAddr?: string; onion_addr?: string })?.onion_addr
        ?? target
      await gc().initiateCall(targetOnion)
      window.location.href = '/call'
    } catch (e) {
      setIsCalling(false)
      setStatusMsg(`Error: ${(e as Error).message}`)
    }
  }

  async function callDirect() {
    const target = directAddr.trim()
    if (!target) return
    setIsCalling(true)
    setStatusMsg('Connecting through Tor…')
    try {
      await gc().initiateCall(target)
      window.location.href = '/call'
    } catch (e) {
      setIsCalling(false)
      setStatusMsg(`Error: ${(e as Error).message}`)
    }
  }

  async function handleGoOnline() {
    if (onGoOnline) {
      setIsGoingOnline(true)
      try {
        await onGoOnline()
      } finally {
        setIsGoingOnline(false)
      }
      return
    }
    setIsGoingOnline(true)
    try {
      const result = await gc().goOnline()
      const addr = typeof result === 'string' ? result : (result as { onionAddr?: string })?.onionAddr ?? ''
      setStatusMsg(`Online: ${String(addr).slice(0, 20)}…`)
    } catch (e) {
      setStatusMsg(`Error: ${(e as Error).message}`)
    } finally {
      setIsGoingOnline(false)
    }
  }

  const tabStyle = (t: Tab): React.CSSProperties => ({
    flex: 1,
    padding: 'var(--space-2) var(--space-4)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    letterSpacing: 'var(--tracking-wide)',
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    background: activeTab === t ? 'var(--ink-primary)' : 'transparent',
    color: activeTab === t ? 'var(--surface-bg)' : 'var(--ink-muted)',
    border: '1px solid var(--border)',
    borderBottom: activeTab === t ? '1px solid var(--ink-primary)' : '1px solid var(--border)',
    transition: 'all 0.1s',
  })

  return (
    <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Tab headers */}
      <div style={{ display: 'flex', gap: 0 }}>
        <button style={tabStyle('handle')} onClick={() => setActiveTab('handle')}>
          By Handle
        </button>
        <button style={tabStyle('direct')} onClick={() => setActiveTab('direct')}>
          Direct
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'handle' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', margin: 0, fontFamily: 'var(--font-mono)' }}>
            Looks up the callee on Starknet, signals via Nostr.
          </p>
          <input
            className="input"
            type="text"
            placeholder="handle (e.g. alice)"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            disabled={isCalling}
            onKeyDown={e => { if (e.key === 'Enter') callByHandle() }}
          />
          <button
            className="btn-primary"
            onClick={callByHandle}
            disabled={!handle.trim() || isCalling}
            style={{ width: '100%' }}
          >
            {isCalling ? 'Calling…' : 'Call'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', margin: 0, fontFamily: 'var(--font-mono)' }}>
            Paste the callee&apos;s .onion address directly. Demo mode — no Starknet lookup needed.
          </p>
          <input
            className="input"
            type="text"
            placeholder="abc123...onion:7331"
            value={directAddr}
            onChange={e => setDirectAddr(e.target.value)}
            disabled={isCalling}
            onKeyDown={e => { if (e.key === 'Enter') callDirect() }}
          />
          <button
            className="btn-primary"
            onClick={callDirect}
            disabled={!directAddr.trim() || isCalling}
            style={{ width: '100%' }}
          >
            {isCalling ? 'Calling…' : 'Call (direct)'}
          </button>
          {/* Show callee's onion address to share */}
          {onionAddr && (
            <button
              className="btn-ghost"
              style={{ width: '100%', fontSize: 'var(--text-xs)' }}
              onClick={() => { navigator.clipboard?.writeText(onionAddr).catch(() => {}) }}
            >
              Copy my address ({onionAddr.slice(0, 14)}…)
            </button>
          )}
        </div>
      )}

      {/* Go online button */}
      <button
        className="btn-ghost"
        onClick={handleGoOnline}
        disabled={isOnline || isGoingOnline}
        style={{ width: '100%' }}
      >
        {isOnline ? 'Online ✓' : isGoingOnline ? 'Going online…' : 'Go online (receive calls)'}
      </button>

      {/* Status message */}
      {statusMsg && (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)', fontFamily: 'var(--font-mono)' }}>
          {statusMsg}
        </span>
      )}
    </div>
  )
}
