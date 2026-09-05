'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { loadState, saveState, clearState } from '../../lib/app-state'
import { useTorStatus } from '../../hooks/useTorStatus'
import SeedGrid from '../../components/SeedGrid'
import SeedVerify from '../../components/SeedVerify'
import SeedImport from '../../components/SeedImport'
import {
  identityCreate, identitySave, identityImport, identityExists, identityLoad,
  identityZkeyBegin, identityZkeyCancel, onZkeyResult, identityDelete,
} from '../../lib/identity-client'

type Step = 'welcome' | 'identity' | 'handle' | 'fund'

const STEPS: Step[] = ['welcome', 'identity', 'handle', 'fund']

// Copy via Electron's native clipboard — navigator.clipboard is unavailable in
// the packaged file:// (non-secure) context. Fall back to the web API only when
// the bridge is absent (tests / browser dev). Mirrors DialPad.copyAddr.
function copyText(value?: string) {
  if (!value) return
  const bridge = (window as any).ghostcall
  if (bridge?.copyToClipboard) {
    bridge.copyToClipboard(value)
  } else {
    navigator.clipboard?.writeText(value).catch(() => { /* ignore */ })
  }
}

// Full address with a tap-to-copy control.
function CopyableAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  if (!address) return null
  return (
    <div className="card-white" style={{ width: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 12, color: '#666' }}>Your account address</span>
      <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#111', wordBreak: 'break-all', lineHeight: 1.5 }}>
        {address}
      </span>
      <button
        className="btn btn-pill-primary"
        onClick={() => { copyText(address); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
        style={{ alignSelf: 'flex-start', fontSize: 13, height: 36, padding: '0 16px' }}
      >
        {copied ? 'Copied!' : 'Copy address'}
      </button>
    </div>
  )
}

// ── SVG Illustrations ────────────────────────────────────────────────────────

function PhoneGhostSVG() {
  return (
    <svg width="220" height="180" viewBox="0 0 220 180" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Phone body */}
      <rect x="75" y="30" width="70" height="120" rx="14" fill="#fff" stroke="#111" strokeWidth="5"/>
      {/* Screen */}
      <rect x="83" y="45" width="54" height="72" rx="6" fill="#f7d5d2" stroke="#111" strokeWidth="3"/>
      {/* Home button */}
      <circle cx="110" cy="135" r="6" stroke="#111" strokeWidth="3.5" fill="none"/>
      {/* Ghost on screen */}
      <path d="M100 72 Q100 58 110 58 Q120 58 120 72 L120 85 Q116 82 113 85 Q110 88 107 85 Q104 82 100 85 Z" fill="#111"/>
      <circle cx="106" cy="70" r="3" fill="#fff"/>
      <circle cx="114" cy="70" r="3" fill="#fff"/>
      {/* Waves left */}
      <path d="M62 80 Q55 90 62 100" stroke="#111" strokeWidth="4" fill="none" strokeLinecap="round"/>
      <path d="M52 74 Q41 90 52 106" stroke="#111" strokeWidth="4" fill="none" strokeLinecap="round"/>
      {/* Waves right */}
      <path d="M158 80 Q165 90 158 100" stroke="#111" strokeWidth="4" fill="none" strokeLinecap="round"/>
      <path d="M168 74 Q179 90 168 106" stroke="#111" strokeWidth="4" fill="none" strokeLinecap="round"/>
      {/* Action lines */}
      <line x1="75" y1="28" x2="70" y2="20" stroke="#111" strokeWidth="3.5" strokeLinecap="round"/>
      <line x1="110" y1="22" x2="110" y2="14" stroke="#111" strokeWidth="3.5" strokeLinecap="round"/>
      <line x1="145" y1="28" x2="150" y2="20" stroke="#111" strokeWidth="3.5" strokeLinecap="round"/>
    </svg>
  )
}

function VaultSVG() {
  return (
    <svg width="200" height="180" viewBox="0 0 200 180" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Shine lines above vault */}
      <line x1="95" y1="28" x2="95" y2="18" stroke="#111" strokeWidth="4" strokeLinecap="round"/>
      <line x1="82" y1="32" x2="76" y2="24" stroke="#111" strokeWidth="4" strokeLinecap="round"/>
      <line x1="108" y1="32" x2="115" y2="24" stroke="#111" strokeWidth="4" strokeLinecap="round"/>
      {/* Vault body */}
      <rect x="55" y="42" width="90" height="95" rx="14" fill="#fff" stroke="#111" strokeWidth="5.5"/>
      {/* Side panel */}
      <path d="M55 42 L38 54 L38 130 L55 137" fill="#fff" stroke="#111" strokeWidth="5" strokeLinejoin="round"/>
      {/* Legs */}
      <rect x="62" y="135" width="8" height="12" rx="2" fill="#111"/>
      <rect x="130" y="135" width="8" height="12" rx="2" fill="#111"/>
      {/* Lock wheel */}
      <circle cx="105" cy="88" r="28" fill="#111"/>
      <circle cx="105" cy="88" r="11" fill="#fff" stroke="#111" strokeWidth="4"/>
      <circle cx="105" cy="58" r="5" fill="#fff" stroke="#111" strokeWidth="3"/>
      <circle cx="105" cy="118" r="5" fill="#fff" stroke="#111" strokeWidth="3"/>
      <circle cx="75" cy="88" r="5" fill="#fff" stroke="#111" strokeWidth="3"/>
      <circle cx="135" cy="88" r="5" fill="#fff" stroke="#111" strokeWidth="3"/>
      {/* Handle */}
      <path d="M155 72 C163 82 155 110 160 120" stroke="#111" strokeWidth="4.5" strokeLinecap="round"/>
      {/* Dots decoration */}
      <circle cx="72" cy="52" r="2" fill="#111"/>
      <circle cx="79" cy="54" r="2" fill="#111"/>
    </svg>
  )
}

function KeyLockSVG() {
  return (
    <svg width="200" height="180" viewBox="0 0 200 180" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Action lines */}
      <line x1="72" y1="44" x2="65" y2="35" stroke="#111" strokeWidth="4" strokeLinecap="round"/>
      <line x1="88" y1="38" x2="88" y2="26" stroke="#111" strokeWidth="4" strokeLinecap="round"/>
      <line x1="104" y1="42" x2="110" y2="33" stroke="#111" strokeWidth="4" strokeLinecap="round"/>
      {/* Key body */}
      <circle cx="90" cy="85" r="30" fill="#fff" stroke="#111" strokeWidth="5"/>
      <circle cx="90" cy="85" r="16" fill="#111"/>
      <circle cx="90" cy="85" r="7" fill="#fff"/>
      {/* Key shaft */}
      <rect x="112" y="82" width="58" height="10" rx="5" fill="#fff" stroke="#111" strokeWidth="4.5"/>
      <rect x="152" y="92" width="10" height="14" rx="3" fill="#fff" stroke="#111" strokeWidth="4"/>
      <rect x="138" y="92" width="8" height="10" rx="2" fill="#fff" stroke="#111" strokeWidth="3.5"/>
      {/* Lock on right */}
      <rect x="148" y="118" width="42" height="38" rx="10" fill="#111"/>
      <path d="M158 118 L158 108 Q158 96 169 96 Q180 96 180 108 L180 118" fill="none" stroke="#111" strokeWidth="5" strokeLinecap="round"/>
      <circle cx="169" cy="134" r="6" fill="#fff"/>
      <rect x="166" y="134" width="6" height="10" rx="3" fill="#fff"/>
      {/* Curl decoration */}
      <path d="M178 162 C182 168 184 175 176 176 C170 177 175 168 170 166" stroke="#111" strokeWidth="4.5" strokeLinecap="round"/>
    </svg>
  )
}

// ── Welcome slides data ──────────────────────────────────────────────────────

const SLIDES = [
  {
    theme: 'theme-rose',
    title: 'Ghost Signal',
    illustration: <PhoneGhostSVG />,
    body: (
      <>Route every call through <strong>Tor onion routing</strong>. Your IP address is never exposed.</>
    ),
    cta: 'Continue →',
  },
  {
    theme: 'theme-lime',
    title: 'Zero Trace',
    illustration: <VaultSVG />,
    body: (
      <><strong>Noise_XX encryption</strong> end-to-end. No server in the call path, no key escrow.</>
    ),
    cta: 'Continue →',
  },
  {
    theme: 'theme-apricot',
    title: 'Stay Hidden',
    illustration: <KeyLockSVG />,
    body: (
      <><strong>ERC-5564 stealth addresses.</strong> Pay for calls without linking your real wallet.</>
    ),
    cta: 'INITIALIZE →',
  },
]

// ── Welcome ─────────────────────────────────────────────────────────────────
function WelcomeStep({ onNext }: { onNext: () => void }) {
  const [slide, setSlide] = useState<0 | 1 | 2>(0)

  function advance() {
    if (slide < 2) {
      setSlide((slide + 1) as 0 | 1 | 2)
    } else {
      onNext()
    }
  }

  const s = SLIDES[slide]

  return (
    <div
      className={`mobile-screen ${s.theme}`}
      style={{ minHeight: '100vh', overflow: 'hidden', position: 'relative' }}
    >
      {/* Slide transition wrapper */}
      <div
        key={slide}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: '100vh',
          animation: 'slideIn 300ms ease',
        }}
      >
        {/* Header: step bars + title */}
        <div className="screen-header" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {/* Step bars */}
          <div className="step-bars">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`step-bar${i === slide ? ' active' : ''}`}
              />
            ))}
          </div>
          <h1 className="hero-title">{s.title}</h1>
        </div>

        {/* Illustration */}
        <div
          className="screen-illustration"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {s.illustration}
        </div>

        {/* Footer: body text + actions */}
        <div className="screen-footer" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <p className="lead-text">{s.body}</p>

          <div
            className="footer-actions"
            style={{ display: 'flex', alignItems: 'center', gap: 16, flexDirection: 'column' }}
          >
            <button
              className="btn btn-pill-primary btn-pill-full"
              onClick={advance}
            >
              {s.cta}
            </button>

            {slide === 2 && (
              <button
                className="action-link-block"
                onClick={onNext}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: '#111',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                Already have keys? <strong>Import now</strong>
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}

// ── Identity ─────────────────────────────────────────────────────────────────

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
  onError,
}: {
  words: string[]
  onWordsReady: (w: string[]) => void
  onVerify: () => void
  onError: (msg: string) => void
}) {
  useEffect(() => {
    if (words.length === 0) {
      identityCreate()
        .then(({ words: w }) => onWordsReady(w))
        .catch((e: Error) => onError(e.message))
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <h2 className="hero-title" style={{ fontSize: 28 }}>Your seed phrase</h2>
        <p style={{ fontSize: 14, color: '#555', marginTop: 8 }}>
          Write these 12 words down in order. This is the only way to recover your wallet.
        </p>
      </div>
      {words.length === 12 && <SeedGrid words={words} />}
      <button className="btn btn-pill-primary btn-pill-full" disabled={words.length < 12} onClick={onVerify}>
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
    return () => { identityZkeyCancel() }
  }, [provider])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <h2 className="hero-title" style={{ fontSize: 22 }}>
          Sign in with {provider === 'google' ? 'Google' : 'Apple'}
        </h2>
        <p style={{ fontSize: 14, color: '#555', marginTop: 8 }}>
          Complete the login in your browser, then return here.
        </p>
      </div>
      <div style={{ width: 48, height: 48, border: '3px solid #111',
        borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <div className="card-white" style={{ width: '100%', padding: '12px 16px' }}>
        <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6 }}>
          Your {provider === 'google' ? 'Google' : 'Apple'} account is your only recovery method.
          You will need to re-login on each fresh install.
        </p>
      </div>
      <button type="button" style={{ background: 'none', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer' }}
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
    identityExists()
      .then(({ exists }) => {
        if (exists) {
          return identityLoad()
            .then(({ address: addr }) => { setAddress(addr); setSub('seed-done') })
            .catch(() => setSub('decrypt-error'))
        }
      })
      .catch(() => {
        setErr('Could not check identity — restart the app')
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

  // ── Entry screen ───────────────────────────────────────────────────────────
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
          <h2 className="hero-title" style={{ fontSize: 28 }}>Create identity</h2>
          <p style={{ fontSize: 15, color: '#555', marginTop: 8 }}>
            Your identity keys are generated locally and never leave your device.
          </p>
        </div>
        <div className="card-white" style={{ width: '100%', padding: 0, overflow: 'hidden' }}>
          {options.map((o, i) => (
            <button
              key={o.label}
              onClick={o.action}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 20px', background: 'none', border: 'none',
                borderBottom: i < options.length - 1 ? '1px solid #eee' : 'none',
                cursor: 'pointer', textAlign: 'left', gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#bbb', minWidth: 20, paddingTop: 2 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: '#111', margin: 0 }}>{o.label}</p>
                  <p style={{ fontSize: 12, color: '#888', margin: '3px 0 0', lineHeight: 1.4 }}>{o.sub}</p>
                </div>
              </div>
              <span style={{ fontSize: 20, color: '#bbb', flexShrink: 0 }}>›</span>
            </button>
          ))}
        </div>
        {err && <p style={{ fontSize: 12, color: '#e63946', fontFamily: 'monospace' }}>{err}</p>}
      </div>
    )
  }

  // ── Seed: Generate ─────────────────────────────────────────────────────────
  if (sub === 'seed-generate') {
    return (
      <SeedGenerateSubFlow
        words={words}
        onWordsReady={setWords}
        onVerify={() => setSub('seed-verify')}
        onError={(msg) => { setErr(msg); setSub('entry') }}
      />
    )
  }

  // ── Seed: Verify ───────────────────────────────────────────────────────────
  if (sub === 'seed-verify') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <h2 className="hero-title" style={{ fontSize: 22 }}>Verify your phrase</h2>
          <p style={{ fontSize: 14, color: '#555', marginTop: 8 }}>
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
        {err && <p style={{ fontSize: 12, color: '#e63946', fontFamily: 'monospace' }}>{err}</p>}
      </div>
    )
  }

  // ── Seed: Import ───────────────────────────────────────────────────────────
  if (sub === 'seed-import') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <h2 className="hero-title" style={{ fontSize: 22 }}>Import wallet</h2>
          <p style={{ fontSize: 14, color: '#555', marginTop: 8 }}>
            Enter your 12-word seed phrase. You can paste all 12 words at once.
          </p>
        </div>
        <SeedImport
          onImport={async (w) => {
            try {
              const { address: addr } = await identityImport(w)
              setAddress(addr)
              saveState({ identitySource: 'seed', walletAddress: addr })
              setSub('seed-import-done')
            } catch (e) {
              setErr((e as Error).message)
            }
          }}
        />
        {err && <p style={{ fontSize: 12, color: '#e63946', fontFamily: 'monospace' }}>{err}</p>}
        <button
          type="button"
          style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer' }}
          onClick={() => setSub('entry')}
        >
          ← Back
        </button>
      </div>
    )
  }

  // ── zKey: Waiting ──────────────────────────────────────────────────────────
  if (sub === 'zkey-waiting') {
    return (
      <ZkeyWaitingSubFlow
        provider={zkeyProvider}
        onCancel={async () => { await identityZkeyCancel(); setSub('entry') }}
      />
    )
  }

  // ── zKey: Error ────────────────────────────────────────────────────────────
  if (sub === 'zkey-error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%', maxWidth: 360 }}>
        <p style={{ fontSize: 14, color: '#e63946', textAlign: 'center', fontFamily: 'monospace' }}>
          {zkeyError}
        </p>
        <button className="btn btn-pill-primary" onClick={() => setSub('entry')}>Try again</button>
      </div>
    )
  }

  // ── Decrypt error ──────────────────────────────────────────────────────────
  if (sub === 'decrypt-error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#e63946" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <h2 className="hero-title" style={{ fontSize: 22 }}>Could not unlock your identity</h2>
          <p style={{ fontSize: 14, color: '#555', lineHeight: 1.6, marginTop: 8 }}>
            Your identity file could not be decrypted. This can happen if you migrated to a new machine or the file was corrupted.
          </p>
        </div>
        <button className="btn btn-pill-primary btn-pill-full" onClick={() => setSub('seed-import')}>
          Import existing seed phrase
        </button>
        <button
          className="btn btn-pill-primary btn-pill-full"
          style={{ background: '#fff', color: '#111', border: '2px solid #111' }}
          onClick={async () => {
            if (confirm('This will permanently delete your saved identity. Make sure you have your seed phrase backed up.')) {
              await identityDelete()
              clearState()
              window.location.replace('/onboarding')
            }
          }}
        >
          Start over
        </button>
      </div>
    )
  }

  // ── Done (seed or zKey) ────────────────────────────────────────────────────
  const truncated = address ? address.slice(0, 8) + '…' + address.slice(-6) : ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
          <span style={{
            display: 'inline-block', padding: '4px 12px', borderRadius: 99,
            background: '#eaf8d1', color: '#111', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          }}>
            IDENTITY READY
          </span>
        </div>
        <h2 className="hero-title" style={{ fontSize: 28 }}>Wallet created</h2>
        {truncated && (
          <p style={{ fontSize: 13, color: '#888', fontFamily: 'monospace', marginTop: 6 }}>{truncated}</p>
        )}
      </div>
      <CopyableAddress address={address} />
      <button className="btn btn-pill-primary btn-pill-full" onClick={onNext}>Continue →</button>
    </div>
  )
}

// ── Handle ────────────────────────────────────────────────────────────────────
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
      const raw = typeof txHash === 'string' ? txHash : txHash?.transaction_hash ?? ''
      const hash = raw === 'already-registered' ? '' : raw
      saveState({ handle: handle.trim(), registered: true, registrationTx: hash })
      onNext()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setRegistering(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <h2 className="hero-title" style={{ fontSize: 28 }}>Choose a handle</h2>
        <p style={{ fontSize: 15, color: '#555', marginTop: 8 }}>
          Your handle is how others call you. It&apos;s registered on Starknet — one transaction.
        </p>
      </div>

      <div className="card-white" style={{ width: '100%', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          className="sketch-input"
          type="text"
          placeholder="yourhandle"
          value={handle}
          onChange={e => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
          disabled={registering}
          onKeyDown={e => e.key === 'Enter' && register()}
          autoFocus
          style={{ fontSize: 20, letterSpacing: -0.2, width: '100%' }}
        />
        <p style={{ fontSize: 12, color: '#888' }}>
          Only lowercase letters, numbers, hyphens. Cannot be changed.
        </p>
        <button
          className="btn btn-pill-primary btn-pill-full"
          onClick={register}
          disabled={!handle.trim() || registering || !torOk}
        >
          {registering ? 'Registering on Starknet…' : 'Register handle'}
        </button>
      </div>

      {!torOk && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px',
          borderRadius: 99, background: '#fee', border: '1px solid #e63946',
          fontSize: 12, color: '#e63946',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e63946', flexShrink: 0 }} />
          Tor required to register — install Tor and restart
        </div>
      )}

      {err && <p style={{ fontSize: 12, color: '#e63946', fontFamily: 'monospace', wordBreak: 'break-all' }}>{err}</p>}

      <div className="card-white" style={{ width: '100%', padding: '14px 16px' }}>
        <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6, margin: 0 }}>
          This registers a stealth meta-address (your public keys) on the StealthRegistry contract.
          The transaction costs ~0.001 STRK in gas. Your real wallet address is never linked to your calls.
        </p>
      </div>
    </div>
  )
}

// ── Fund ──────────────────────────────────────────────────────────────────────
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
  const low = BigInt(data.result[0])
  const high = BigInt(data.result[1] ?? '0x0')
  const total = low + (high << 128n)
  return (Number(total) / 1e18).toFixed(4)
}

function FundStep() {
  const state = loadState()
  const [balance, setBalance] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: '#111' }}>
            @{state.handle}
          </span>
          <span style={{
            display: 'inline-block', padding: '4px 12px', borderRadius: 99,
            background: '#eaf8d1', color: '#111', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          }}>
            REGISTERED
          </span>
        </div>
        <p style={{ fontSize: 15, color: '#555' }}>
          Your handle is now on Starknet.
          Add some STRK to pay for calls.
        </p>
      </div>

      <CopyableAddress address={accountAddr} />

      <div className="card-white" style={{ width: '100%', padding: 0, overflow: 'hidden' }}>
        {[
          { label: 'Handle', value: <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>@{state.handle}</span> },
          {
            label: 'Account', value: (
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#888' }}>
                {accountAddr.slice(0, 8)}…{accountAddr.slice(-6)}
              </span>
            )
          },
          {
            label: 'STRK balance', value: (
              <button
                onClick={checkBalance}
                disabled={checking}
                style={{
                  background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 8,
                  padding: '6px 12px', fontFamily: 'monospace', fontSize: 11,
                  color: balance !== null ? '#111' : '#888', letterSpacing: '0.06em', cursor: 'pointer',
                }}
              >
                {checking ? 'Checking…' : balance !== null ? `${balance} STRK` : '> checkBalance'}
              </button>
            )
          },
          ...(state.registrationTx ? [{
            label: 'Registration TX', value: (
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#888' }}>
                {state.registrationTx.slice(0, 8)}…
              </span>
            )
          }] : []),
        ].map((row, i, arr) => (
          <div key={row.label} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: i < arr.length - 1 ? '1px solid #eee' : 'none',
          }}>
            <span style={{ fontSize: 14, color: '#555' }}>{row.label}</span>
            {row.value}
          </div>
        ))}
      </div>

      <div className="card-white" style={{ width: '100%', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#111', margin: 0 }}>Add STRK for call payments</p>
        <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6, margin: 0 }}>
          Post-call payments use STRK20 shielded pool. ~0.1 STRK/minute.
          On Sepolia testnet: use the{' '}
          <a
            href="https://starknet-faucet.vercel.app"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#111', fontWeight: 600 }}
          >
            Starknet faucet
          </a>.
        </p>
        <div style={{
          background: '#f5f5f5', borderRadius: 8, padding: '8px 12px',
          fontFamily: 'monospace', fontSize: 11, color: '#888', wordBreak: 'break-all',
        }}>
          {accountAddr}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        <button className="btn btn-pill-primary btn-pill-full" onClick={finish}>
          START CALLING →
        </button>
        <button
          style={{ background: 'none', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: '8px 0' }}
          onClick={finish}
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

function OnboardingInner() {
  const params = useSearchParams()
  const torStatus = useTorStatus()
  const [step, setStep] = useState<Step>((params.get('step') as Step) ?? 'welcome')

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

  // Welcome step takes over the full screen with its own layout
  if (step === 'welcome') {
    return <WelcomeStep onNext={() => go('identity')} />
  }

  // Identity / Handle / Fund steps share a centred card layout
  const stepIndex = STEPS.indexOf(step)

  return (
    <main style={{
      minHeight: '100vh', background: 'var(--bg-lime, #eaf8d1)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '44px 28px 32px',
    }}>
      {/* Step bars */}
      <div className="step-bars" style={{ marginBottom: 40 }}>
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`step-bar${i === stepIndex ? ' active' : ''}`}
          />
        ))}
      </div>

      {step === 'identity' && <IdentityStep onNext={() => go('handle')} />}
      {step === 'handle' && <HandleStep onNext={() => go('fund')} torStatus={torStatus} />}
      {step === 'fund' && <FundStep />}
    </main>
  )
}

export default function Onboarding() {
  return (
    <Suspense>
      <OnboardingInner />
    </Suspense>
  )
}
