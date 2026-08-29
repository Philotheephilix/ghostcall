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
      if (starknet?.enable) await starknet.enable()
      setWalletConnected(true)
    } catch (e) {
      setStatusMsg((e as Error).message)
    } finally { setIsConnecting(false) }
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
    } finally { setIsRegistering(false) }
  }

  const torOk = torStatus?.running === true

  return (
    <main className="page" style={{ gap: 40 }}>
      {/* Identity */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <Logo size={72} glowColor={torOk ? 'rgba(48,209,88,0.8)' : 'rgba(255,255,255,0.15)'} />
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.05 }}>
            GhostCall
          </h1>
          <p style={{ fontSize: 15, color: 'var(--label-tertiary)', marginTop: 6 }}>
            Set up your private identity
          </p>
        </div>
      </div>

      {/* Setup card */}
      <div className="glass-card" style={{ width: '100%', maxWidth: 360, padding: 0, overflow: 'hidden' }}>
        {/* Step 1 */}
        <div style={{ padding: '20px 20px 16px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-tertiary)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
            Step 1
          </p>
          <button
            className={walletConnected ? 'btn-secondary' : 'btn-primary'}
            onClick={connectWallet}
            disabled={isConnecting || walletConnected}
          >
            {walletConnected ? '✓  Wallet connected' : isConnecting ? 'Connecting…' : 'Connect Wallet'}
          </button>
        </div>

        <div className="divider" />

        {/* Step 2 */}
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-tertiary)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Step 2
          </p>
          <input
            className="input-glass"
            type="text"
            placeholder="Choose a handle"
            value={handle}
            onChange={e => setHandle(e.target.value)}
            disabled={!walletConnected || isRegistering}
            onKeyDown={e => e.key === 'Enter' && register()}
          />
          <button
            className="btn-primary"
            onClick={register}
            disabled={!walletConnected || !handle.trim() || isRegistering}
          >
            {isRegistering ? 'Registering…' : 'Register on Starknet'}
          </button>
        </div>

        {/* Feedback */}
        {(statusMsg || txHash) && (
          <>
            <div className="divider" />
            <div style={{ padding: '10px 20px 14px' }}>
              {statusMsg && (
                <p style={{ fontSize: 12, color: 'var(--system-red)', fontFamily: 'var(--font-mono)' }}>
                  {statusMsg}
                </p>
              )}
              {txHash && (
                <p style={{ fontSize: 12, color: 'var(--system-green)', fontFamily: 'var(--font-mono)' }}>
                  ✓ tx {txHash.slice(0, 10)}…{txHash.slice(-8)}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Tor status */}
      <div className={`status-pill ${torOk ? 'status-pill--connected' : 'status-pill--offline'}`}>
        <span className="dot" />
        <span>{torOk ? 'Tor connected' : 'Tor unavailable'}</span>
      </div>
    </main>
  )
}
