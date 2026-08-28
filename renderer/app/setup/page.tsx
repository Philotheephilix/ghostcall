'use client'

import { useState } from 'react'
import Logo from '../../components/Logo'
import { useTorStatus } from '../../hooks/useTorStatus'

export default function SetupPage() {
  const torStatus = useTorStatus()
  const [handle, setHandle] = useState('')
  const [txHash, setTxHash] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [walletConnected, setWalletConnected] = useState(false)

  async function connectWallet() {
    setIsConnecting(true)
    setStatusMsg('')
    try {
      const starknet = (window as any).starknet
      if (starknet?.enable) {
        await starknet.enable()
      }
      setWalletConnected(true)
    } catch (e) {
      setStatusMsg((e as Error).message)
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
      const hash = typeof result === 'string' ? result : result?.transaction_hash ?? JSON.stringify(result)
      setTxHash(hash)
    } catch (e) {
      setStatusMsg((e as Error).message)
    } finally {
      setIsRegistering(false)
    }
  }

  const torOk = torStatus?.running === true

  return (
    <main className="page" style={{ gap: 'var(--space-8)' }}>
      {/* Identity */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-4)' }}>
        <Logo size={64} variant="dark" />
        <span className="wordmark">ghostcall</span>
      </div>

      {/* Setup card */}
      <div className="card" style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {/* Step 1 */}
        <div className="form-stack">
          <span className="label">Connect wallet</span>
          <button
            className="btn-primary"
            onClick={connectWallet}
            disabled={isConnecting || walletConnected}
          >
            {walletConnected ? 'Connected' : isConnecting ? 'Connecting…' : 'Connect'}
          </button>
        </div>

        <div className="divider" />

        {/* Step 2 */}
        <div className="form-stack">
          <span className="label">Choose a handle</span>
          <input
            className="input"
            type="text"
            placeholder="alice"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            disabled={!walletConnected || isRegistering}
            onKeyDown={e => { if (e.key === 'Enter') register() }}
          />
          <button
            className="btn-primary"
            onClick={register}
            disabled={!walletConnected || !handle.trim() || isRegistering}
          >
            {isRegistering ? 'Registering…' : 'Register on-chain'}
          </button>
        </div>

        {/* Feedback */}
        {(statusMsg || txHash) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
            {statusMsg && <span className="mono-xs" style={{ color: 'var(--status-error)' }}>{statusMsg}</span>}
            {txHash && <span className="mono-xs">tx {txHash.slice(0, 10)}…{txHash.slice(-6)}</span>}
          </div>
        )}
      </div>

      {/* Tor pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span className={`status-dot ${torOk ? 'status-dot--connected' : 'status-dot--error'}`} />
        <span className="mono-xs" style={{ color: torOk ? 'var(--accent)' : 'var(--status-error)' }}>
          {torOk ? 'Tor connected' : 'Tor unavailable'}
        </span>
      </div>
    </main>
  )
}
