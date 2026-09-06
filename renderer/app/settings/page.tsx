'use client'

import { useState, useEffect } from 'react'
import { loadState, saveState, clearState } from '../../lib/app-state'
import { identityDelete, onIdentityReady } from '../../lib/identity-client'
import { useTorStatus } from '../../hooks/useTorStatus'

const RPC_URL = process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? ''
const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

async function fetchBalance(addr: string): Promise<string> {
  const res = await fetch(RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'starknet_call',
      params: [{ contract_address: STRK, entry_point_selector: '0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e', calldata: [addr] }, 'latest'],
    }),
  })
  const data = await res.json()
  if (!data.result) throw new Error('No result')
  const low = BigInt(data.result[0])
  const high = BigInt(data.result[1] ?? '0x0')
  const raw = low + (high << 128n)
  const whole = raw / BigInt(1e18)
  const frac = Number(raw % BigInt(1e18)) / 1e18
  return (Number(whole) + frac).toFixed(4)
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: '1px solid rgba(17,17,17,0.07)' }}>
      <span className="label-tag" style={{ color: 'var(--label-tertiary)' }}>{label}</span>
      {children}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <span className="label-tag" style={{ display: 'block', marginBottom: 8, color: 'var(--label-tertiary)' }}>{label}</span>
      <div style={{ background: '#fff', borderRadius: 'var(--radius-card)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
        {children}
      </div>
    </div>
  )
}

function RowLast({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px' }}>
      <span className="label-tag" style={{ color: 'var(--label-tertiary)' }}>{label}</span>
      {children}
    </div>
  )
}

export default function Settings() {
  const torStatus = useTorStatus()
  const [state, setState] = useState<ReturnType<typeof loadState> | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => {
    const s = loadState()
    if (s.onboardingDone) { setState(s); return }
    const cleanup = onIdentityReady((data) => {
      if (data.source) setState(saveState({ onboardingDone: true }))
      else window.location.replace('/onboarding')
    })
    return cleanup
  }, [])

  const accountAddr = (state?.walletAddress && state?.walletAddress !== 'dev-mode')
    ? state.walletAddress
    : '0x52b6665bf24e43e5a612417f43ceaf120186d091f5d2fcb3782bf2d672ad13f'

  async function checkBalance() {
    try { setBalance(await fetchBalance(accountAddr)) }
    catch { setBalance('—') }
  }

  async function resetOnboarding() {
    try { await identityDelete() } catch {}
    clearState()
    window.location.replace('/onboarding')
  }

  const torOk = torStatus?.running === true

  return (
    <main style={{
      minHeight: '100vh', background: 'var(--bg-apricot)',
      padding: '0 20px 80px', maxWidth: 420, margin: '0 auto',
      boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-family)',
    }}>

      {/* Header */}
      <div style={{ paddingTop: 52, paddingBottom: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => window.location.href = '/home'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: '2px solid #111', borderRadius: 'var(--radius-pill)',
            padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#111',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          Back
        </button>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--label-primary)', margin: 0 }}>Settings</h1>
      </div>

      {/* Identity */}
      <Section label="Identity">
        <Row label="Handle">
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-primary)' }}>
            {state?.handle ? `@${state.handle}` : '—'}
          </span>
        </Row>
        <Row label="Source">
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-secondary)' }}>
            {state?.identitySource === 'seed' ? 'Seed Phrase' : state?.identitySource === 'zkey' ? 'ZK Login' : '—'}
          </span>
        </Row>
        <Row label="Starknet">
          <span style={{ fontSize: 12, fontWeight: 600, color: state?.registered ? '#16a34a' : 'var(--label-tertiary)' }}>
            {state?.registered ? 'Registered ✓' : 'Not Registered'}
          </span>
        </Row>
        {state?.registrationTx && (
          <Row label="Reg TX">
            <span style={{ fontSize: 11, color: 'var(--label-tertiary)', fontFamily: 'var(--font-mono)' }}>
              {state.registrationTx.slice(0, 10)}…{state.registrationTx.slice(-6)}
            </span>
          </Row>
        )}
        <div style={{ padding: '12px 16px' }}>
          <span className="label-tag" style={{ display: 'block', marginBottom: 5, color: 'var(--label-quaternary)' }}>Address</span>
          <span style={{ fontSize: 10, color: 'var(--label-secondary)', wordBreak: 'break-all', lineHeight: 1.6, fontFamily: 'var(--font-mono)' }}>
            {accountAddr}
          </span>
        </div>
      </Section>

      {/* Account */}
      <Section label="Account">
        <RowLast label="STRK Balance">
          <button
            onClick={checkBalance}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 700,
              color: balance !== null ? 'var(--label-primary)' : 'var(--label-tertiary)',
            }}
          >
            {balance !== null ? `${balance} STRK` : 'Check →'}
          </button>
        </RowLast>
      </Section>

      {/* Network */}
      <Section label="Network">
        <Row label="Tor">
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: torOk ? 'rgba(34,197,94,0.12)' : 'rgba(230,57,70,0.10)',
            borderRadius: 'var(--radius-pill)', padding: '4px 10px',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
            color: torOk ? '#16a34a' : 'var(--system-red)',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: torOk ? '#22c55e' : 'var(--system-red)' }} />
            {torOk ? 'Connected' : 'Unavailable'}
          </div>
        </Row>
        <Row label="Network">
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-tertiary)' }}>Sepolia</span>
        </Row>
        <RowLast label="RPC">
          <span style={{ fontSize: 10, color: 'var(--label-quaternary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
            {RPC_URL ? RPC_URL.replace('https://', '').slice(0, 30) + '…' : '—'}
          </span>
        </RowLast>
      </Section>

      {/* About */}
      <Section label="About">
        <Row label="Version">
          <span style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>1.0.0-sepolia</span>
        </Row>
        <RowLast label="Source">
          <a href="https://github.com/Philotheephilix/ghostcall" target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: 'var(--label-primary)', textDecoration: 'none', fontWeight: 700 }}>
            GitHub ↗
          </a>
        </RowLast>
      </Section>

      {/* Danger zone */}
      <div style={{ marginTop: 'auto', paddingTop: 12, textAlign: 'center' }}>
        <button
          className="btn-pill-danger"
          onClick={() => setShowResetConfirm(true)}
          style={{ width: '100%', maxWidth: 280 }}
        >
          Reset Identity
        </button>
        <p style={{ fontSize: 11, color: 'var(--label-quaternary)', marginTop: 8 }}>
          Deletes saved keys. Re-registration required.
        </p>
      </div>

      {/* Reset confirm modal */}
      {showResetConfirm && (
        <div className="in-page-modal-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="in-page-modal" onClick={e => e.stopPropagation()}>
            <span className="label-tag" style={{ color: 'var(--system-red)' }}>Reset Identity</span>
            <p style={{ fontSize: 14, color: 'var(--label-secondary)', lineHeight: 1.6 }}>
              This will permanently delete your saved keys. You'll need to re-register on Starknet. Back up your seed phrase first.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn-pill-danger" style={{ width: '100%' }}
                onClick={async () => { setShowResetConfirm(false); await resetOnboarding() }}>
                Delete Identity
              </button>
              <button className="btn btn-pill-outline" style={{ width: '100%' }} onClick={() => setShowResetConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
