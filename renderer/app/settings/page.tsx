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
  return (Number(low + (high << 128n)) / 1e18).toFixed(4)
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="list-row" style={{ padding: '13px 16px', alignItems: 'center', justifyContent: 'space-between' }}>
      <span className="label-tag">{label}</span>
      {children}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <span className="label-tag" style={{ display: 'block', marginBottom: 8 }}>{label}</span>
      <div className="card-white" style={{ padding: 0, overflow: 'hidden' }}>
        {children}
      </div>
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
      if (data.source) { setState(saveState({ onboardingDone: true })) }
      else { window.location.replace('/onboarding') }
    })
    return cleanup
  }, [])

  const accountAddr = (state?.walletAddress && state?.walletAddress !== 'dev-mode')
    ? state?.walletAddress
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
    <main className="theme-apricot page-enter" style={{
      minHeight: '100vh',
      padding: '0 20px 64px',
      maxWidth: 420,
      margin: '0 auto',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        paddingTop: 48,
        paddingBottom: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <button
          onClick={() => window.location.href = '/home'}
          className="btn-pill-outline"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          Back
        </button>
        <h1 className="hero-title" style={{ fontSize: 28 }}>Settings</h1>
      </div>

      {/* Identity section */}
      <Section label="Identity">
        <Row label="Handle">
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>
            {state?.handle ? `@${state.handle}` : '—'}
          </span>
        </Row>
        <Row label="Source">
          <span style={{ fontSize: 12, color: '#5a5a5a', fontWeight: 600 }}>
            {state?.identitySource === 'seed' ? 'Seed Phrase'
             : state?.identitySource === 'zkey' ? 'ZKey (ZK Login)'
             : '—'}
          </span>
        </Row>
        <Row label="Starknet">
          <span style={{
            fontSize: 12,
            color: state?.registered ? '#16a34a' : '#5a5a5a',
            fontWeight: 600,
          }}>
            {state?.registered ? 'Registered' : 'Not Registered'}
          </span>
        </Row>
        {state?.registrationTx && (
          <Row label="Reg TX">
            <span style={{ fontSize: 11, color: '#5a5a5a', fontFamily: 'monospace' }}>
              {state.registrationTx.slice(0, 10)}…{state.registrationTx.slice(-6)}
            </span>
          </Row>
        )}
        <div style={{ padding: '12px 16px' }}>
          <span className="label-tag" style={{ display: 'block', marginBottom: 6 }}>Address (Sepolia)</span>
          <span style={{ fontSize: 11, color: '#2d2d2d', wordBreak: 'break-all', lineHeight: 1.5, fontFamily: 'monospace' }}>
            {accountAddr}
          </span>
        </div>
      </Section>

      {/* Account section */}
      <Section label="Account">
        <Row label="STRK Balance">
          <button
            onClick={checkBalance}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
              color: balance !== null ? '#111' : '#5a5a5a',
            }}
          >
            {balance !== null ? `${balance} STRK` : 'Check →'}
          </button>
        </Row>
      </Section>

      {/* Network section */}
      <Section label="Network">
        <Row label="Tor">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: torOk ? 'rgba(34,197,94,0.12)' : 'rgba(230,57,70,0.1)',
            borderRadius: 999,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 700,
            color: torOk ? '#16a34a' : '#e63946',
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: torOk ? '#22c55e' : '#e63946',
            }} />
            {torOk ? 'Connected' : 'Unavailable'}
          </div>
        </Row>
        <Row label="Starknet">
          <span style={{ fontSize: 12, color: '#5a5a5a', fontWeight: 500 }}>Sepolia</span>
        </Row>
        <Row label="RPC">
          <span style={{
            fontSize: 11,
            color: '#5a5a5a',
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'monospace',
          }}>
            {RPC_URL ? RPC_URL.replace('https://', '').slice(0, 32) + '…' : '—'}
          </span>
        </Row>
      </Section>

      {/* About section */}
      <Section label="About">
        <Row label="Version">
          <span style={{ fontSize: 12, color: '#5a5a5a' }}>1.0.0-sepolia</span>
        </Row>
        <Row label="License">
          <span style={{ fontSize: 12, color: '#5a5a5a' }}>Apache-2.0</span>
        </Row>
        <Row label="Source">
          <a
            href="https://github.com/Philotheephilix/ghostcall"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              color: '#111',
              textDecoration: 'none',
              fontWeight: 700,
            }}
          >
            GitHub ↗
          </a>
        </Row>
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
        <p style={{
          fontSize: 11,
          color: '#5a5a5a',
          marginTop: 8,
        }}>
          Deletes saved keys. Re-registration required.
        </p>
      </div>

      {showResetConfirm && (
        <div
          className="in-page-modal-overlay"
          onClick={() => setShowResetConfirm(false)}
        >
          <div className="card-white in-page-modal" onClick={e => e.stopPropagation()} style={{ padding: 24 }}>
            <span className="label-tag" style={{ color: '#e63946', display: 'block', marginBottom: 10 }}>Reset Identity</span>
            <p style={{ fontSize: 14, color: '#2d2d2d', lineHeight: 1.6, marginBottom: 20 }}>
              This will permanently delete your saved identity keys. You will need to re-register on Starknet. Make sure you have your seed phrase backed up.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn-pill-danger"
                style={{ width: '100%' }}
                onClick={async () => {
                  setShowResetConfirm(false)
                  await resetOnboarding()
                }}
              >
                Delete Identity
              </button>
              <button
                className="btn-pill-outline"
                style={{ width: '100%' }}
                onClick={() => setShowResetConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
