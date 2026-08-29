'use client'

import { useState, useEffect } from 'react'
import { loadState, clearState } from '../../lib/app-state'
import { useTorStatus } from '../../hooks/useTorStatus'

export default function Settings() {
  const torStatus = useTorStatus()
  const [state, setState] = useState(loadState())
  const [balance, setBalance] = useState<string | null>(null)
  const accountAddr = '0x52b6665bf24e43e5a612417f43ceaf120186d091f5d2fcb3782bf2d672ad13f'

  useEffect(() => { setState(loadState()) }, [])

  async function checkBalance() {
    try {
      const res = await fetch('https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/oJTjnNCsJEOqYv3MMtrtT6LUFhwcW9pR', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'starknet_call',
          params: [{
            contract_address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
            entry_point_selector: '0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e',
            calldata: [accountAddr],
          }, 'latest'],
        }),
      })
      const data = await res.json()
      if (data.result) {
        const total = BigInt(data.result[0])
        setBalance((Number(total) / 1e18).toFixed(4))
      }
    } catch { setBalance('—') }
  }

  function resetOnboarding() {
    if (confirm('This will delete your saved identity. You will need to re-register on Starknet.')) {
      clearState()
      window.location.replace('/onboarding')
    }
  }

  const torOk = torStatus?.running === true

  return (
    <main style={{
      minHeight: '100vh', background: 'var(--bg-primary)',
      paddingTop: 60, padding: '60px 20px 40px', maxWidth: 420, margin: '0 auto',
    }}>
      {/* Back */}
      <button
        onClick={() => window.location.href = '/home'}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--system-blue)', fontSize: 15, marginBottom: 24,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: 0,
        }}
      >
        ‹ Back
      </button>

      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 32 }}>Settings</h1>

      {/* Identity */}
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-tertiary)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
        Identity
      </p>
      <div className="glass-card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
        <div className="list-row" style={{ padding: '14px 20px' }}>
          <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>Handle</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--system-green)' }}>@{state.handle || '—'}</span>
        </div>
        <div className="list-row" style={{ padding: '14px 20px' }}>
          <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>Registered</span>
          <span style={{ fontSize: 14, color: state.registered ? 'var(--system-green)' : 'var(--label-tertiary)' }}>
            {state.registered ? '✓ On Starknet Sepolia' : 'Not yet'}
          </span>
        </div>
        {state.registrationTx && (
          <div className="list-row" style={{ padding: '14px 20px' }}>
            <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>Reg. TX</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--label-tertiary)' }}>
              {state.registrationTx.slice(0, 10)}…{state.registrationTx.slice(-6)}
            </span>
          </div>
        )}
      </div>

      {/* Account */}
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-tertiary)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
        Account
      </p>
      <div className="glass-card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
        <div className="list-row" style={{ padding: '14px 20px', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <span style={{ fontSize: 13, color: 'var(--label-tertiary)' }}>Address (Sepolia)</span>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--label-secondary)', wordBreak: 'break-all' }}>
            {accountAddr}
          </span>
        </div>
        <div className="list-row" style={{ padding: '14px 20px' }}>
          <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>STRK balance</span>
          <button
            onClick={checkBalance}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--system-blue)', fontSize: 15 }}
          >
            {balance !== null ? `${balance} STRK` : 'Check'}
          </button>
        </div>
      </div>

      {/* Network */}
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-tertiary)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
        Network
      </p>
      <div className="glass-card" style={{ marginBottom: 32, padding: 0, overflow: 'hidden' }}>
        <div className="list-row" style={{ padding: '14px 20px' }}>
          <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>Tor</span>
          <div className={`status-pill ${torOk ? 'status-pill--connected' : 'status-pill--error'}`} style={{ padding: '2px 8px' }}>
            <span className="dot" />
            <span style={{ fontSize: 11 }}>{torOk ? 'Connected' : 'Unavailable'}</span>
          </div>
        </div>
        <div className="list-row" style={{ padding: '14px 20px' }}>
          <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>Starknet</span>
          <span style={{ fontSize: 13, color: 'var(--label-tertiary)' }}>Sepolia testnet</span>
        </div>
      </div>

      {/* Danger zone */}
      <button
        onClick={resetOnboarding}
        className="btn-secondary"
        style={{ color: 'var(--system-red)', borderColor: 'rgba(255,69,58,0.2)' }}
      >
        Reset identity
      </button>
      <p style={{ fontSize: 12, color: 'var(--label-quaternary)', textAlign: 'center', marginTop: 10 }}>
        Deletes saved keys. You'll need to re-register on-chain.
      </p>
    </main>
  )
}
