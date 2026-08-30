'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Logo from '../../components/Logo'
import { loadState, saveState } from '../../lib/app-state'
import { useTorStatus } from '../../hooks/useTorStatus'

type Step = 'welcome' | 'wallet' | 'handle' | 'fund'

const STEPS: Step[] = ['welcome', 'wallet', 'handle', 'fund']

function OnboardingInner() {
  const params = useSearchParams()
  const torStatus = useTorStatus()
  const [step, setStep] = useState<Step>((params.get('step') as Step) ?? 'welcome')

  // If returning mid-onboarding, jump to right step
  useEffect(() => {
    const s = loadState()
    if (s.onboardingDone) { window.location.replace('/home'); return }
    if (s.registered && step === 'welcome') setStep('fund')
    else if (s.walletConnected && step === 'welcome') setStep('handle')
  }, [])

  function go(s: Step) {
    window.history.pushState({}, '', `/onboarding?step=${s}`)
    setStep(s)
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <main className="page" style={{ gap: 0, justifyContent: 'flex-start', paddingTop: 60 }}>
      {/* Step indicators */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 48 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{
            width: step === s ? 20 : 6,
            height: 6, borderRadius: 3,
            background: i <= stepIndex
              ? 'var(--system-blue)'
              : 'var(--system-gray-3)',
            transition: 'width 300ms var(--spring), background 300ms',
          }} />
        ))}
      </div>

      {step === 'welcome' && <WelcomeStep onNext={() => go('wallet')} />}
      {step === 'wallet' && <WalletStep onNext={() => go('handle')} />}
      {step === 'handle' && <HandleStep onNext={() => go('fund')} torStatus={torStatus} />}
      {step === 'fund' && <FundStep />}
    </main>
  )
}

// ── Welcome ────────────────────────────────────────────────────────────────
function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40, width: '100%', maxWidth: 360 }}>
      <div style={{ position: 'relative' }}>
        <div style={{
          position: 'absolute', inset: -30,
          background: 'radial-gradient(ellipse at 50% 50%, rgba(48,209,88,0.12) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
        <Logo size={80} glowColor="rgba(48,209,88,0.9)" />
      </div>

      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.05, marginBottom: 12 }}>
          GhostCall
        </h1>
        <p style={{ fontSize: 15, color: 'var(--label-secondary)', lineHeight: 1.5, maxWidth: 280, margin: '0 auto' }}>
          Private audio calls. No IP exposure. No trusted relay. No trace.
        </p>
      </div>

      {/* Feature pills */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        {[
          { icon: '🧅', label: 'Tor onion routing', sub: 'Your IP is never revealed' },
          { icon: '🔐', label: 'Noise_XX encryption', sub: 'End-to-end, no server in path' },
          { icon: '👻', label: 'Stealth addresses', sub: 'Identity on Starknet, not your wallet' },
          { icon: '🪙', label: 'Shielded payments', sub: 'STRK20 privacy pool post-call' },
        ].map(f => (
          <div key={f.label} className="glass-card-sm" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{f.icon}</span>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-primary)', marginBottom: 2 }}>{f.label}</p>
              <p style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>{f.sub}</p>
            </div>
          </div>
        ))}
      </div>

      <button className="btn-primary" onClick={onNext} style={{ marginTop: 8 }}>
        Get started
      </button>
    </div>
  )
}

// ── Wallet ─────────────────────────────────────────────────────────────────
// In Electron, browser wallet extensions (Argent X, Braavos) are not available.
// Identity keys are derived from STARKNET_PRIVATE_KEY in .env — no external wallet needed.
function WalletStep({ onNext }: { onNext: () => void }) {
  function confirm() {
    // Account address from .env is used by the main process; store a sentinel
    // so later steps can distinguish "env-configured" from "dev-mode no keys"
    const envAddr = process.env.NEXT_PUBLIC_STARKNET_ACCOUNT_ADDRESS ?? ''
    saveState({ walletConnected: true, walletAddress: envAddr || 'dev-mode' })
    onNext()
  }

  const hasEnv = !!(process.env.NEXT_PUBLIC_STARKNET_ACCOUNT_ADDRESS)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>Identity keys</h2>
        <p style={{ fontSize: 15, color: 'var(--label-secondary)' }}>
          Your Starknet private key (from <code style={{ fontSize: 13 }}>.env</code>) derives your identity keypair locally. Nothing is sent on-chain yet.
        </p>
      </div>

      <div className="glass-card" style={{ width: '100%', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22 }}>{hasEnv ? '🔑' : '⚠️'}</span>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-primary)', marginBottom: 2 }}>
              {hasEnv ? 'Account configured' : 'No account configured'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>
              {hasEnv
                ? 'Keys loaded from .env — ready to derive identity'
                : 'Set STARKNET_PRIVATE_KEY in .env to enable on-chain features'}
            </p>
          </div>
        </div>
      </div>

      <button className="btn-primary" onClick={confirm} style={{ width: '100%' }}>
        Continue
      </button>

      <p style={{ fontSize: 12, color: 'var(--label-quaternary)', textAlign: 'center', maxWidth: 260 }}>
        Your private key never leaves your device. Keys are derived locally.
      </p>
    </div>
  )
}

// ── Handle ─────────────────────────────────────────────────────────────────
function HandleStep({ onNext, torStatus }: { onNext: () => void; torStatus: ReturnType<typeof useTorStatus> }) {
  const [handle, setHandle] = useState('')
  const [registering, setRegistering] = useState(false)
  const [err, setErr] = useState('')
  const torOk = torStatus?.running === true

  async function register() {
    if (!handle.trim()) return
    setRegistering(true)
    setErr('')
    try {
      const gc = (window as any).ghostcall
      const txHash = await gc.registerStealth(handle.trim())
      const hash = typeof txHash === 'string' ? txHash : txHash?.transaction_hash ?? ''
      saveState({ handle: handle.trim(), registered: true, registrationTx: hash })
      onNext()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setRegistering(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>Choose a handle</h2>
        <p style={{ fontSize: 15, color: 'var(--label-secondary)' }}>
          Your handle is how others call you. It's registered on Starknet — one transaction.
        </p>
      </div>

      <div className="glass-card" style={{ width: '100%', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          className="input-glass"
          type="text"
          placeholder="yourhandle"
          value={handle}
          onChange={e => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
          disabled={registering}
          onKeyDown={e => e.key === 'Enter' && register()}
          autoFocus
          style={{ fontSize: 20, letterSpacing: -0.2 }}
        />
        <p style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>
          Only lowercase letters, numbers, hyphens. Cannot be changed.
        </p>
        <button
          className="btn-primary"
          onClick={register}
          disabled={!handle.trim() || registering || !torOk}
        >
          {registering ? 'Registering on Starknet…' : 'Register handle'}
        </button>
      </div>

      {!torOk && (
        <div className="status-pill status-pill--error">
          <span className="dot" />
          <span>Tor required to register — install Tor and restart</span>
        </div>
      )}

      {err && <p style={{ fontSize: 12, color: 'var(--system-red)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{err}</p>}

      <div className="glass-card-sm" style={{ width: '100%', padding: '14px 16px' }}>
        <p style={{ fontSize: 12, color: 'var(--label-secondary)', lineHeight: 1.6 }}>
          This registers a stealth meta-address (your public keys) on the StealthRegistry contract.
          The transaction costs ~0.001 STRK in gas. Your real wallet address is never linked to your calls.
        </p>
      </div>
    </div>
  )
}

// ── Fund ───────────────────────────────────────────────────────────────────
const RPC_URL = process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? ''
const STRK_SEPOLIA = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

async function fetchStrkBalance(addr: string): Promise<string> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'starknet_call',
      params: [{
        contract_address: STRK_SEPOLIA,
        entry_point_selector: '0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e',
        calldata: [addr],
      }, 'latest'],
    }),
  })
  const data = await res.json()
  if (!data.result) throw new Error('No result')
  // Uint256 = [low_felt, high_felt]
  const low = BigInt(data.result[0])
  const high = BigInt(data.result[1] ?? '0x0')
  const total = low + (high << 128n)
  return (Number(total) / 1e18).toFixed(4)
}

function FundStep() {
  const state = loadState()
  const [balance, setBalance] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // Use the wallet address captured during onboarding; fall back to test account
  const accountAddr = (state.walletAddress && state.walletAddress !== 'dev-mode')
    ? state.walletAddress
    : '0x52b6665bf24e43e5a612417f43ceaf120186d091f5d2fcb3782bf2d672ad13f'

  async function checkBalance() {
    setChecking(true)
    try {
      setBalance(await fetchStrkBalance(accountAddr))
    } catch { setBalance('—') }
    finally { setChecking(false) }
  }

  function finish() {
    if (!loadState().registered) {
      window.location.replace('/onboarding?step=handle')
      return
    }
    saveState({ onboardingDone: true })
    window.location.replace('/home')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>
          Handle registered
        </h2>
        <p style={{ fontSize: 15, color: 'var(--label-secondary)' }}>
          <strong style={{ color: 'var(--system-green)' }}>@{state.handle}</strong> is now on Starknet.
          Add some STRK to pay for calls.
        </p>
      </div>

      {/* Account info card */}
      <div className="glass-card" style={{ width: '100%', padding: 0, overflow: 'hidden' }}>
        <div className="list-row" style={{ padding: '14px 20px' }}>
          <span style={{ fontSize: 14, color: 'var(--label-secondary)' }}>Handle</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--system-green)' }}>@{state.handle}</span>
        </div>
        <div className="list-row" style={{ padding: '14px 20px' }}>
          <span style={{ fontSize: 14, color: 'var(--label-secondary)' }}>Account</span>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--label-tertiary)' }}>
            {accountAddr.slice(0, 8)}…{accountAddr.slice(-6)}
          </span>
        </div>
        <div className="list-row" style={{ padding: '14px 20px' }}>
          <span style={{ fontSize: 14, color: 'var(--label-secondary)' }}>STRK balance</span>
          <button
            onClick={checkBalance}
            disabled={checking}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--system-blue)', fontSize: 14 }}
          >
            {checking ? 'Checking…' : balance !== null ? `${balance} STRK` : 'Check'}
          </button>
        </div>
        {state.registrationTx && (
          <div className="list-row" style={{ padding: '14px 20px' }}>
            <span style={{ fontSize: 14, color: 'var(--label-secondary)' }}>Registration TX</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--label-tertiary)' }}>
              {state.registrationTx.slice(0, 8)}…
            </span>
          </div>
        )}
      </div>

      {/* Fund instructions */}
      <div className="glass-card-sm" style={{ width: '100%', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-primary)' }}>Add STRK for call payments</p>
        <p style={{ fontSize: 12, color: 'var(--label-secondary)', lineHeight: 1.6 }}>
          Post-call payments use STRK20 shielded pool. ~0.1 STRK/minute.
          On Sepolia testnet: use the{' '}
          <a
            href="https://starknet-faucet.vercel.app"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--system-blue)' }}
          >
            Starknet faucet
          </a>.
        </p>
        <div style={{
          background: 'var(--system-gray-5)',
          borderRadius: 8, padding: '8px 12px',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--label-secondary)', wordBreak: 'break-all',
        }}>
          {accountAddr}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <button className="btn-primary" onClick={finish}>
          Start calling
        </button>
        <button className="btn-text" onClick={finish} style={{ color: 'var(--label-tertiary)', fontSize: 14 }}>
          Skip for now
        </button>
      </div>
    </div>
  )
}

export default function Onboarding() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  )
}
