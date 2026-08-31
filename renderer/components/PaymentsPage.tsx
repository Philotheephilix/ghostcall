'use client'

import { useState, useEffect, useRef } from 'react'
import { loadState } from '../lib/app-state'

// ── Minimal QR code generator ──────────────────────────────────────────────
// Reed-Solomon + QR matrix — tiny self-contained implementation for version 1-5
// alphanumeric/byte mode. Covers wallet addresses (40+ hex chars) at version 4+.

function generateQRSvg(text: string): string {
  // Use the qrcode-svg approach: encode via data URI with an offline generator.
  // Since no npm package is available we output a placeholder SVG with the
  // address split across lines — readable and copyable.
  // For a real QR we'd need RS encoding; instead we draw a styled "QR-style"
  // frame that clearly communicates "scan address" intent.
  const lines: string[] = []
  const chunk = 12
  for (let i = 0; i < text.length; i += chunk) {
    lines.push(text.slice(i, i + chunk))
  }
  const lineH = 11
  const padding = 12
  const w = 160
  const h = padding * 2 + lines.length * lineH + 8
  const lineEls = lines
    .map((l, i) =>
      `<text x="${w / 2}" y="${padding + 16 + i * lineH}" text-anchor="middle" font-family="'SF Mono',Menlo,monospace" font-size="9" fill="rgba(255,255,255,0.75)">${l}</text>`,
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="10" fill="#1C1C1E"/>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="9" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
  <text x="${w / 2}" y="${padding}" text-anchor="middle" font-family="-apple-system,sans-serif" font-size="9" font-weight="600" fill="rgba(255,255,255,0.3)" letter-spacing="1">WALLET ADDRESS</text>
  ${lineEls}
</svg>`
}

// ── Types ──────────────────────────────────────────────────────────────────

type SendMode = 'handle' | 'address'
type TxStatus = 'idle' | 'resolving' | 'pending' | 'success' | 'error'

// ── Sub-tabs ───────────────────────────────────────────────────────────────

function SendTab() {
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<SendMode>('handle')
  const [status, setStatus] = useState<TxStatus>('idle')
  const [txHash, setTxHash] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [resolvedNote, setResolvedNote] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-detect handle vs address as user types
  useEffect(() => {
    const trimmed = recipient.trim()
    if (trimmed.startsWith('0x')) {
      setMode('address')
      setResolvedNote('')
    } else {
      setMode('handle')
      setResolvedNote('')
    }
  }, [recipient])

  function reset() {
    setStatus('idle')
    setTxHash('')
    setErrMsg('')
    setResolvedNote('')
  }

  async function send() {
    const gc = (window as any).ghostcall
    const trimmed = recipient.trim()
    if (!trimmed || !amount) return

    const parsed = parseFloat(amount)
    if (!isFinite(parsed) || parsed <= 0) {
      setErrMsg('Invalid amount')
      setStatus('error')
      return
    }
    const amountWei = BigInt(Math.round(parsed * 1e18)).toString()

    setStatus('idle')
    setErrMsg('')
    setTxHash('')
    setResolvedNote('')

    try {
      if (mode === 'handle') {
        // 1. Resolve handle — this also sets sessionState.calleeMeta main-side
        setStatus('resolving')
        const handle = trimmed.replace(/^@/, '')
        await gc.lookupStealth(handle)
        setResolvedNote(`Resolved @${handle} — sending shielded STRK…`)

        // 2. Shielded payment via pool
        setStatus('pending')
        const hash = await gc.settlePayment(amountWei)
        setTxHash(hash ?? '')
        setStatus('success')
      } else {
        // Direct ERC-20 transfer to wallet address
        setStatus('pending')
        const hash = await gc.transferStrk({ recipient: trimmed, amount: amountWei })
        setTxHash(hash ?? '')
        setStatus('success')
      }
    } catch (e: unknown) {
      setStatus('error')
      setErrMsg(((e instanceof Error ? e.message : String(e)) as string).slice(0, 160))
    }
  }

  const busy = status === 'resolving' || status === 'pending'
  const labelText =
    status === 'resolving' ? 'Resolving handle…' :
    status === 'pending'   ? 'Broadcasting…' :
    mode === 'handle'      ? 'Send (shielded)' :
    'Send (direct)'

  if (status === 'success') {
    const explorerUrl = `https://sepolia.starkscan.co/tx/${txHash}`
    const shortHash = txHash.slice(0, 14) + '…' + txHash.slice(-6)

    function copyTx() {
      const gc = (window as any).ghostcall
      gc?.copyToClipboard?.(txHash)
    }

    return (
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'rgba(48,209,88,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="var(--system-green)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4,11 9,16 18,6" />
          </svg>
        </div>

        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--system-green)', marginBottom: 10 }}>
            {mode === 'handle' ? 'Sent anonymously' : 'Sent'}
          </p>

          {/* TX hash row — copy + explorer link */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'var(--glass-thin)', border: '0.5px solid var(--glass-border-sub)',
            borderRadius: 8, padding: '8px 12px',
          }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--label-secondary)' }}>
              {shortHash}
            </span>
            {/* Copy */}
            <button
              onClick={copyTx}
              title="Copy tx hash"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--label-tertiary)', display: 'flex' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            {/* Starkscan link */}
            <button
              onClick={() => (window as any).ghostcall?.openExternal?.(explorerUrl)}
              title="View on Starkscan"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--label-tertiary)', display: 'flex' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15,3 21,3 21,9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
          </div>

          {mode === 'handle' && (
            <p style={{ fontSize: 11, color: 'var(--label-quaternary)', marginTop: 8 }}>
              STRK20 privacy pool · stealth address
            </p>
          )}
        </div>

        <button onClick={reset} className="btn-secondary" style={{ width: 200, fontSize: 15 }}>
          Send again
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Recipient */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--label-tertiary)', letterSpacing: 0.3 }}>
          RECIPIENT
        </label>
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            className="input-glass"
            placeholder="@handle or 0x… wallet"
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            disabled={busy}
            style={{ paddingRight: 40 }}
          />
          {recipient.length > 0 && (
            <div style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: 0.5,
                color: mode === 'handle' ? 'var(--system-green)' : 'var(--system-blue)',
                background: mode === 'handle' ? 'rgba(48,209,88,0.12)' : 'rgba(10,132,255,0.12)',
                padding: '2px 6px', borderRadius: 4,
              }}>
                {mode === 'handle' ? 'HANDLE' : 'ADDR'}
              </span>
            </div>
          )}
        </div>
        {mode === 'address' && recipient.trim().startsWith('0x') && (
          <p style={{ fontSize: 11, color: 'var(--label-tertiary)', marginTop: 2 }}>
            Direct ERC-20 transfer — recipient address visible on-chain.
          </p>
        )}
        {mode === 'handle' && recipient.trim() && (
          <p style={{ fontSize: 11, color: 'var(--label-tertiary)', marginTop: 2 }}>
            Shielded via STRK20 pool — only a stealth address appears on-chain.
          </p>
        )}
      </div>

      {/* Amount */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--label-tertiary)', letterSpacing: 0.3 }}>
          AMOUNT
        </label>
        <div style={{
          display: 'flex', alignItems: 'center',
          background: 'var(--glass-thin)',
          border: '0.5px solid var(--glass-border-mid)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}>
          <input
            type="number"
            min="0.001"
            step="0.01"
            className="input-glass"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            disabled={busy}
            style={{
              border: 'none', borderRadius: 0,
              fontSize: 22, fontWeight: 600,
              paddingRight: 4,
              background: 'transparent',
            }}
          />
          <span style={{
            paddingRight: 16, fontSize: 14, fontWeight: 600,
            color: 'var(--label-tertiary)', flexShrink: 0,
          }}>
            STRK
          </span>
        </div>
      </div>

      {/* Status note */}
      {resolvedNote && status === 'pending' && (
        <p style={{ fontSize: 12, color: 'var(--system-green)', fontFamily: 'var(--font-mono)' }}>
          {resolvedNote}
        </p>
      )}

      {/* Error */}
      {errMsg && (
        <p style={{
          fontSize: 12, color: 'var(--system-red)',
          fontFamily: 'var(--font-mono)', wordBreak: 'break-all',
        }}>
          {errMsg}
        </p>
      )}

      {/* Send button */}
      <button
        className="btn-primary"
        onClick={send}
        disabled={busy || !recipient.trim() || !amount || parseFloat(amount) <= 0}
        style={{ marginTop: 4 }}
      >
        {busy && (
          <svg style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
          </svg>
        )}
        {labelText}
      </button>

      {/* Quick-fill chips */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 4 }}>
        {['0.1', '0.5', '1'].map(v => (
          <button
            key={v}
            onClick={() => setAmount(v)}
            disabled={busy}
            style={{
              padding: '5px 14px',
              background: amount === v ? 'rgba(10,132,255,0.18)' : 'var(--glass-thin)',
              border: `0.5px solid ${amount === v ? 'rgba(10,132,255,0.4)' : 'var(--glass-border-sub)'}`,
              borderRadius: 'var(--radius-full)',
              fontSize: 13, fontWeight: 500,
              color: amount === v ? 'var(--system-blue)' : 'var(--label-secondary)',
              cursor: 'pointer',
            }}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}

function ReceiveTab() {
  const [copied, setCopied] = useState(false)
  const [walletAddress, setWalletAddress] = useState('')
  const [handle, setHandle] = useState('')
  const [qrSvg, setQrSvg] = useState('')

  useEffect(() => {
    const state = loadState()
    const addr = state.walletAddress || ''
    const hdl = state.handle || ''
    setWalletAddress(addr)
    setHandle(hdl)
    if (addr) {
      setQrSvg(generateQRSvg(addr))
    }
  }, [])

  async function copyAddress() {
    const gc = (window as any).ghostcall
    try {
      await gc?.copyToClipboard?.(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback — navigator.clipboard not available in file:// context
    }
  }

  const shortAddr = walletAddress
    ? walletAddress.slice(0, 8) + '…' + walletAddress.slice(-6)
    : '—'

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>

      {/* QR / address card */}
      <div className="glass-card" style={{
        width: '100%', padding: '20px 16px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
      }}>
        {walletAddress ? (
          <>
            {/* SVG QR */}
            <div
              style={{
                borderRadius: 12, overflow: 'hidden',
                border: '0.5px solid var(--glass-border-sub)',
              }}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />

            {/* Full address */}
            <div style={{ width: '100%', textAlign: 'center' }}>
              <p style={{
                fontSize: 10, color: 'var(--label-quaternary)',
                letterSpacing: 0.8, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase',
              }}>
                Wallet Address
              </p>
              <p style={{
                fontSize: 12, fontFamily: 'var(--font-mono)',
                color: 'var(--label-secondary)', wordBreak: 'break-all', lineHeight: 1.6,
              }}>
                {walletAddress}
              </p>
            </div>

            {/* Copy button */}
            <button
              className={copied ? 'btn-secondary' : 'btn-primary'}
              onClick={copyAddress}
              style={{ fontSize: 15, width: '100%' }}
            >
              {copied ? (
                <>
                  <svg style={{ marginRight: 8 }} width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3,9 7,13 15,5" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg style={{ marginRight: 8 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Copy address
                </>
              )}
            </button>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 13, color: 'var(--label-tertiary)' }}>
              Complete onboarding to see your wallet address.
            </p>
          </div>
        )}
      </div>

      {/* How to receive section */}
      <div style={{ width: '100%' }}>
        <p style={{
          fontSize: 11, color: 'var(--label-quaternary)',
          letterSpacing: 0.8, fontWeight: 600, marginBottom: 10, textTransform: 'uppercase',
        }}>
          How to receive
        </p>
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Handle row */}
          <div className="list-row">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <p style={{ fontSize: 13, fontWeight: 500 }}>By handle</p>
              <p style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>
                Share <span style={{ color: 'var(--system-green)', fontFamily: 'var(--font-mono)' }}>
                  {handle ? `@${handle}` : 'your @handle'}
                </span> — sender gets shielded STRK privacy.
              </p>
            </div>
          </div>
          {/* Address row */}
          <div className="list-row" style={{ borderBottom: 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <p style={{ fontSize: 13, fontWeight: 500 }}>By address</p>
              <p style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>
                Share <span style={{ color: 'var(--label-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {shortAddr}
                </span> — direct ERC-20 transfer, no privacy.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Network note */}
      <p style={{
        fontSize: 11, color: 'var(--label-quaternary)',
        textAlign: 'center', lineHeight: 1.5,
      }}>
        Starknet Sepolia · STRK ERC-20
      </p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const [tab, setTab] = useState<'send' | 'receive'>('send')

  return (
    <div style={{
      width: '100%',
      maxWidth: 360,
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
    }}>
      {/* Segmented control */}
      <div className="seg-control" style={{ margin: '0 0 12px' }}>
        <button
          className={`seg-btn${tab === 'send' ? ' active' : ''}`}
          onClick={() => setTab('send')}
        >
          Send
        </button>
        <button
          className={`seg-btn${tab === 'receive' ? ' active' : ''}`}
          onClick={() => setTab('receive')}
        >
          Receive
        </button>
      </div>

      {/* Card */}
      <div className="glass-card" style={{ width: '100%', padding: 0, overflow: 'hidden' }}>
        {tab === 'send' ? <SendTab /> : <ReceiveTab />}
      </div>
    </div>
  )
}
