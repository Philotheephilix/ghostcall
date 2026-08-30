'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Logo from '../../components/Logo'
import { loadState, saveState, clearState } from '../../lib/app-state'
import { useTorStatus } from '../../hooks/useTorStatus'
import SeedGrid from '../../components/SeedGrid'
import SeedVerify from '../../components/SeedVerify'
import SeedImport from '../../components/SeedImport'
import {
  identityCreate, identitySave, identityImport, identityExists, identityLoad,
  identityZkeyBegin, identityZkeyCancel, onZkeyResult,
} from '../../lib/identity-client'

type Step = 'welcome' | 'identity' | 'handle' | 'fund'

const STEPS: Step[] = ['welcome', 'identity', 'handle', 'fund']

function OnboardingInner() {
  const params = useSearchParams()
  const torStatus = useTorStatus()
  const [step, setStep] = useState<Step>((params.get('step') as Step) ?? 'welcome')

  // If returning mid-onboarding, jump to right step
  useEffect(() => {
    const s = loadState()
    if (s.onboardingDone) { window.location.replace('/home'); return }
    if (s.registered && step === 'welcome') setStep('fund')
    else if (s.identitySource !== '' && step === 'welcome') setStep('handle')
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

      {step === 'welcome' && <WelcomeStep onNext={() => go('identity')} />}
      {step === 'identity' && <IdentityStep onNext={() => go('handle')} />}
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

// ── Identity ───────────────────────────────────────────────────────────────

type IdentitySubFlow =
  | 'entry'
  | 'seed-generate' | 'seed-verify' | 'seed-done'
  | 'seed-import' | 'seed-import-done'
  | 'zkey-waiting' | 'zkey-done' | 'zkey-error'
  | 'decrypt-error'

// Sub-component: seed generate (extracts useEffect out of conditional)
function SeedGenerateSubFlow({
  words,
  onWordsReady,
  onVerify,
}: {
  words: string[]
  onWordsReady: (w: string[]) => void
  onVerify: () => void
}) {
  useEffect(() => {
    if (words.length === 0) {
      identityCreate().then(({ words: w }) => onWordsReady(w))
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>Your seed phrase</h2>
        <p style={{ fontSize: 14, color: 'var(--label-secondary)' }}>
          Write these 12 words down in order. This is the only way to recover your wallet.
        </p>
      </div>
      {words.length === 12 && <SeedGrid words={words} />}
      <button className="btn-primary" disabled={words.length < 12} onClick={onVerify}>
        I&apos;ve written these down →
      </button>
    </div>
  )
}

// Sub-component: zKey waiting (extracts useEffect out of conditional)
function ZkeyWaitingSubFlow({
  provider,
  onCancel,
}: {
  provider: 'google' | 'apple'
  onCancel: () => void
}) {
  useEffect(() => {
    identityZkeyBegin(provider)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>
          Sign in with {provider === 'google' ? 'Google' : 'Apple'}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--label-secondary)' }}>
          Complete the login in your browser, then return here.
        </p>
      </div>
      <div style={{ width: 48, height: 48, border: '3px solid var(--system-blue)',
        borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <div className="glass-card-sm" style={{ width: '100%', padding: '12px 16px' }}>
        <p style={{ fontSize: 12, color: 'var(--label-secondary)', lineHeight: 1.6 }}>
          Your {provider === 'google' ? 'Google' : 'Apple'} account is your only recovery method.
          You will need to re-login on each fresh install.
        </p>
      </div>
      <button type="button" className="btn-text" style={{ color: 'var(--label-tertiary)', fontSize: 14 }}
        onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

function IdentityStep({ onNext }: { onNext: () => void }) {
  const [sub, setSub] = useState<IdentitySubFlow>('entry')
  const [words, setWords] = useState<string[]>([])
  const [address, setAddress] = useState('')
  const [zkeyProvider, setZkeyProvider] = useState<'google' | 'apple'>('google')
  const [zkeyError, setZkeyError] = useState('')
  const [err, setErr] = useState('')

  // On mount: check if identity.enc already exists → skip to done or show decrypt-error
  useEffect(() => {
    identityExists().then(({ exists }) => {
      if (exists) {
        identityLoad().then(({ address: addr }) => {
          setAddress(addr)
          setSub('seed-done')
        }).catch(() => setSub('decrypt-error'))
      }
    })
  }, [])

  // Listen for zKey result push event — only active when waiting
  useEffect(() => {
    if (sub !== 'zkey-waiting') return
    const cleanup = onZkeyResult(({ ok, address: addr, error }) => {
      if (ok && addr) {
        setAddress(addr)
        saveState({ identitySource: 'zkey', walletAddress: addr })
        setSub('zkey-done')
      } else {
        setZkeyError(error ?? 'Unknown error')
        setSub('zkey-error')
      }
    })
    return cleanup
  }, [sub])

  // ── Entry screen ─────────────────────────────────────────────────────────
  if (sub === 'entry') {
    const options = [
      { label: 'New wallet', sub: 'Generate a 12-word seed phrase', action: () => setSub('seed-generate') },
      { label: 'Import wallet', sub: 'Restore from an existing seed phrase', action: () => setSub('seed-import') },
      {
        label: 'Sign in with Google', sub: 'Zero-knowledge login — Google is never shared with GhostCall · via zKey',
        action: () => { setZkeyProvider('google'); setSub('zkey-waiting') },
      },
      {
        label: 'Sign in with Apple', sub: 'Zero-knowledge login — Apple is never shared with GhostCall · via zKey',
        action: () => { setZkeyProvider('apple'); setSub('zkey-waiting') },
      },
    ]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>Create identity</h2>
          <p style={{ fontSize: 15, color: 'var(--label-secondary)' }}>
            Your identity keys are generated locally and never leave your device.
          </p>
        </div>
        <div className="glass-card" style={{ width: '100%', padding: 0, overflow: 'hidden' }}>
          {options.map((o, i) => (
            <div key={o.label}>
              {i > 0 && <div className="divider" />}
              <button
                onClick={o.action}
                style={{
                  width: '100%', padding: '14px 20px', background: 'transparent',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'background 120ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--glass-thin)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--label-primary)', marginBottom: 2 }}>{o.label}</p>
                  <p style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>{o.sub}</p>
                </div>
                <span style={{ fontSize: 18, color: 'var(--label-quaternary)' }}>›</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Seed: Generate ────────────────────────────────────────────────────────
  if (sub === 'seed-generate') {
    return (
      <SeedGenerateSubFlow
        words={words}
        onWordsReady={setWords}
        onVerify={() => setSub('seed-verify')}
      />
    )
  }

  // ── Seed: Verify ──────────────────────────────────────────────────────────
  if (sub === 'seed-verify') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>Verify your phrase</h2>
          <p style={{ fontSize: 14, color: 'var(--label-secondary)' }}>
            Confirm you saved your seed phrase correctly.
          </p>
        </div>
        <SeedVerify
          words={words}
          onBack={() => setSub('seed-generate')}
          onVerified={async () => {
            setErr('')
            try {
              const { address: addr } = await identitySave(words)
              setAddress(addr)
              saveState({ identitySource: 'seed', walletAddress: addr })
              setSub('seed-done')
            } catch (e) { setErr((e as Error).message) }
          }}
        />
        {err && <p style={{ fontSize: 12, color: 'var(--system-red)', fontFamily: 'var(--font-mono)' }}>{err}</p>}
      </div>
    )
  }

  // ── Seed: Import ──────────────────────────────────────────────────────────
  if (sub === 'seed-import') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>Import wallet</h2>
          <p style={{ fontSize: 14, color: 'var(--label-secondary)' }}>
            Enter your 12-word seed phrase. You can paste all 12 words at once.
          </p>
        </div>
        <SeedImport
          onImport={async (w) => {
            const { address: addr } = await identityImport(w)
            setAddress(addr)
            saveState({ identitySource: 'seed', walletAddress: addr })
            setSub('seed-import-done')
          }}
        />
        <button type="button" className="btn-text" style={{ fontSize: 13, color: 'var(--label-tertiary)' }}
          onClick={() => setSub('entry')}>← Back</button>
      </div>
    )
  }

  // ── zKey: Waiting ─────────────────────────────────────────────────────────
  if (sub === 'zkey-waiting') {
    return (
      <ZkeyWaitingSubFlow
        provider={zkeyProvider}
        onCancel={async () => { await identityZkeyCancel(); setSub('entry') }}
      />
    )
  }

  // ── zKey: Error ───────────────────────────────────────────────────────────
  if (sub === 'zkey-error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%', maxWidth: 360 }}>
        <p style={{ fontSize: 14, color: 'var(--system-red)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
          {zkeyError}
        </p>
        <button className="btn-primary" onClick={() => setSub('entry')}>Try again</button>
      </div>
    )
  }

  // ── Decrypt error ─────────────────────────────────────────────────────────
  if (sub === 'decrypt-error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Could not unlock your identity</h2>
          <p style={{ fontSize: 14, color: 'var(--label-secondary)', lineHeight: 1.6 }}>
            Your identity file could not be decrypted. This can happen if you migrated to a new machine or the file was corrupted.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setSub('seed-import')}>Import existing seed phrase</button>
        <button className="btn-secondary" onClick={() => {
          if (confirm('This will permanently delete your saved identity. Make sure you have your seed phrase backed up.')) {
            clearState()
            window.location.replace('/onboarding')
          }
        }}>
          Start over
        </button>
      </div>
    )
  }

  // ── Done (seed or zKey) ───────────────────────────────────────────────────
  const truncated = address ? address.slice(0, 8) + '…' + address.slice(-6) : ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>Wallet created</h2>
        {truncated && (
          <p style={{ fontSize: 13, color: 'var(--label-tertiary)', fontFamily: 'var(--font-mono)' }}>{truncated}</p>
        )}
      </div>
      <button className="btn-primary" onClick={onNext}>Continue →</button>
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
          Your handle is how others call you. It&apos;s registered on Starknet — one transaction.
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
