'use client'

import { useState, useEffect } from 'react'
import Logo from '../../components/Logo'

export default function SetupPage() {
  const [torStatus, setTorStatus] = useState<{ running: boolean; error?: string } | null>(null)
  const [handle, setHandle] = useState('')
  const [txHash, setTxHash] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [walletConnected, setWalletConnected] = useState(false)

  useEffect(() => {
    // Poll initial Tor status
    const gc = (window as any).ghostcall
    if (gc?.getTorStatus) {
      gc.getTorStatus().then((s: { running: boolean; error?: string }) => setTorStatus(s))
    }
    // Subscribe to live Tor status updates
    if (gc?.onTorStatus) {
      gc.onTorStatus((s: { running: boolean; error?: string }) => setTorStatus(s))
    }
  }, [])

  async function connectWallet() {
    setIsConnecting(true)
    setStatusMsg('')
    try {
      // Use get-starknet if available, otherwise stub
      const getStarknet = (window as any).starknet
      if (getStarknet?.enable) {
        await getStarknet.enable()
        setWalletConnected(true)
        setStatusMsg('Wallet connected')
      } else {
        // Fallback: mark connected (dev mode without wallet extension)
        setWalletConnected(true)
        setStatusMsg('Wallet connected (dev mode)')
      }
    } catch (e) {
      setStatusMsg(`Error: ${(e as Error).message}`)
    } finally {
      setIsConnecting(false)
    }
  }

  async function register() {
    if (!handle.trim()) return
    setIsRegistering(true)
    setStatusMsg('')
    setTxHash('')
    try {
      const gc = (window as any).ghostcall
      const result = await gc.registerStealth(handle.trim())
      const hash = typeof result === 'string' ? result : result?.txHash ?? result?.transaction_hash ?? JSON.stringify(result)
      setTxHash(hash)
      setStatusMsg('Registered on-chain')
    } catch (e) {
      setStatusMsg(`Error: ${(e as Error).message}`)
    } finally {
      setIsRegistering(false)
    }
  }

  const torDotClass = torStatus?.running ? 'status-dot status-dot--connected' : 'status-dot status-dot--error'
  const torLabel = torStatus?.running ? 'Tor running' : 'Tor unavailable'

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
      {/* Logo + wordmark */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)' }}>
        <Logo size={72} variant="dark" />
        <h1 style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-xl)',
          fontWeight: 300,
          letterSpacing: 'var(--tracking-widest)',
          color: 'var(--ink-primary)',
          margin: 0,
        }}>
          ghostcall
        </h1>
      </div>

      {/* Setup card */}
      <div className="card" style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {/* Step 1 — connect wallet */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <span className="label">Step 1</span>
          <button
            className="btn-primary"
            onClick={connectWallet}
            disabled={isConnecting || walletConnected}
            style={{ width: '100%' }}
          >
            {walletConnected ? 'Wallet connected' : isConnecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        </div>

        {/* Step 2 — register handle */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <span className="label">Step 2</span>
          <input
            className="input"
            type="text"
            placeholder="your handle"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            disabled={!walletConnected || isRegistering}
            onKeyDown={e => { if (e.key === 'Enter') register() }}
          />
          <button
            className="btn-primary"
            onClick={register}
            disabled={!walletConnected || !handle.trim() || isRegistering}
            style={{ width: '100%' }}
          >
            {isRegistering ? 'Registering…' : 'Register'}
          </button>
        </div>

        {/* Status */}
        {(statusMsg || txHash) && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            fontSize: 'var(--text-xs)',
            color: 'var(--ink-secondary)',
          }}>
            {statusMsg && <span>{statusMsg}</span>}
            {txHash && (
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
                tx {txHash.slice(0, 10)}…{txHash.slice(-6)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tor status indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span
          className={torDotClass}
          title={torStatus?.error ?? torLabel}
        />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-muted)' }}>
          {torLabel}
        </span>
      </div>
    </main>
  )
}
