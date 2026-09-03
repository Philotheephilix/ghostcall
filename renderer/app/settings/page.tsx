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
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '13px 16px',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 11,
        color: 'var(--label-quaternary)', letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      {children}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--label-quaternary)', letterSpacing: '0.14em',
          textTransform: 'uppercase', fontWeight: 600,
        }}>
          {label}
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
      </div>
      <div style={{
        background: 'var(--card)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  )
}

export default function Settings() {
  const torStatus = useTorStatus()
  const [state, setState] = useState<ReturnType<typeof loadState> | null>(null)
  const [balance, setBalance] = useState<string | null>(null)

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
    if (!confirm('This will delete your saved identity. You will need to re-register on Starknet.')) return
    try { await identityDelete() } catch {}
    clearState()
    window.location.replace('/onboarding')
  }

  const torOk = torStatus?.running === true

  return (
    <main style={{
      minHeight: '100vh', background: 'var(--bg)',
      padding: '0 20px 48px',
      maxWidth: 420, margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{
        paddingTop: 48, paddingBottom: 24,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          onClick={() => window.location.href = '/home'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--label-secondary)', fontSize: 18,
            padding: '4px 8px 4px 0', lineHeight: 1,
          }}
        >
          ‹
        </button>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--label-quaternary)', letterSpacing: '0.14em',
          textTransform: 'uppercase', fontWeight: 600,
        }}>
          Settings
        </span>
      </div>

      {/* Identity section */}
      <Section label="Identity">
        <Row label="Handle">
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600,
            color: 'var(--accent)',
          }}>
            {state?.handle ? `@${state.handle}` : '—'}
          </span>
        </Row>
        <Row label="Starknet">
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: state?.registered ? 'var(--system-green)' : 'var(--label-quaternary)',
            letterSpacing: '0.04em',
          }}>
            {state?.registered ? 'REGISTERED' : 'NOT REGISTERED'}
          </span>
        </Row>
        {state?.registrationTx && (
          <Row label="Reg TX">
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--label-tertiary)', letterSpacing: '0.02em',
            }}>
              {state.registrationTx.slice(0, 10)}…{state.registrationTx.slice(-6)}
            </span>
          </Row>
        )}
        <div style={{ padding: '12px 16px', borderBottom: 'none' }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 9,
            color: 'var(--label-quaternary)', letterSpacing: '0.06em',
            textTransform: 'uppercase', display: 'block', marginBottom: 6,
          }}>
            Address (Sepolia)
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--label-tertiary)', wordBreak: 'break-all', lineHeight: 1.5,
          }}>
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
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 12,
              color: balance !== null ? 'var(--accent)' : 'var(--label-secondary)',
              letterSpacing: '0.04em',
            }}
          >
            {balance !== null ? `${balance} STRK` : 'Check →'}
          </button>
        </Row>
      </Section>

      {/* Network section */}
      <Section label="Network">
        <Row label="Tor">
          <div className={`status-pill ${torOk ? 'status-pill--connected' : 'status-pill--error'}`}>
            <span className="dot" />
            <span>{torOk ? 'Connected' : 'Unavailable'}</span>
          </div>
        </Row>
        <Row label="Starknet">
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--label-quaternary)', letterSpacing: '0.04em',
          }}>
            Sepolia
          </span>
        </Row>
      </Section>

      {/* Danger */}
      <div style={{ marginTop: 8 }}>
        <button
          onClick={resetOnboarding}
          style={{
            width: '100%', padding: '12px 16px',
            background: 'rgba(255,59,48,0.06)',
            border: '1px solid rgba(255,59,48,0.18)',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-mono)', fontSize: 11,
            fontWeight: 600, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--system-red)',
            cursor: 'pointer',
            transition: 'background 120ms',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,59,48,0.10)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,59,48,0.06)')}
        >
          Reset identity
        </button>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          color: 'var(--label-quaternary)', textAlign: 'center',
          marginTop: 8, letterSpacing: '0.04em',
        }}>
          Deletes saved keys. Re-registration required.
        </p>
      </div>
    </main>
  )
}
