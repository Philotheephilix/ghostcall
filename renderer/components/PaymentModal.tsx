'use client'

import { useState } from 'react'

interface Props {
  peer: string
  callId: string
  onDismiss: () => void
  onPaid: (txHash: string) => void
}

export default function PaymentModal({ peer, callId, onDismiss, onPaid }: Props) {
  const [amount, setAmount] = useState('0.1')
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle')
  const [txHash, setTxHash] = useState('')
  const [errMsg, setErrMsg] = useState('')

  const displayPeer = peer.includes('.onion') ? peer.slice(0, 12) + '…' : '@' + peer

  async function pay() {
    const gc = (window as any).ghostcall
    const amountWei = BigInt(Math.round(parseFloat(amount) * 1e18)).toString()
    setStatus('pending')
    setErrMsg('')
    try {
      const hash = await gc?.settlePayment?.(amountWei)
      setTxHash(hash ?? '')
      setStatus('success')
      onPaid(hash ?? '')
    } catch (e: unknown) {
      setStatus('error')
      setErrMsg((e instanceof Error ? e.message : String(e)).slice(0, 120))
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end',
      zIndex: 100,
    }}>
      <div style={{
        width: '100%',
        background: 'var(--bg-elevated, #1c1c1e)',
        border: '0.5px solid var(--glass-border-sub)',
        borderRadius: '20px 20px 0 0',
        padding: '28px 24px 40px',
      }}>
        {/* Handle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, color: 'var(--label-tertiary)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>
              Pay for call
            </p>
            <p style={{ fontSize: 16, fontWeight: 600 }}>{displayPeer}</p>
          </div>
          <button
            onClick={onDismiss}
            style={{
              background: 'var(--glass-thin)', border: '0.5px solid var(--glass-border-sub)',
              borderRadius: '50%', width: 32, height: 32,
              color: 'var(--label-tertiary)', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {status === 'success' ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <p style={{ fontSize: 28, marginBottom: 8 }}>✓</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(48,209,88,0.9)', marginBottom: 6 }}>
              Payment sent anonymously
            </p>
            <p style={{
              fontSize: 11, color: 'var(--label-tertiary)',
              fontFamily: 'var(--font-mono)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {txHash.slice(0, 20)}…
            </p>
            <button
              onClick={onDismiss}
              style={{
                marginTop: 20, width: '100%', padding: '13px 0',
                background: 'var(--glass)', border: '0.5px solid var(--glass-border-sub)',
                borderRadius: 13, color: 'var(--label-secondary)', fontSize: 15, cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Amount input */}
            <div style={{
              background: 'var(--glass-thin)',
              border: '0.5px solid var(--glass-border-sub)',
              borderRadius: 13, padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 10,
              marginBottom: 12,
            }}>
              <input
                type="number"
                min="0.001"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 22, fontWeight: 600, color: 'var(--label-primary)',
                  width: 0,
                }}
              />
              <span style={{ fontSize: 14, color: 'var(--label-tertiary)', fontWeight: 600 }}>STRK</span>
            </div>

            {errMsg && (
              <p style={{
                fontSize: 11, color: 'var(--system-red, #ff453a)',
                marginBottom: 10, fontFamily: 'var(--font-mono)',
              }}>
                {errMsg}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={onDismiss}
                style={{
                  flex: 1, padding: '13px 0',
                  background: 'var(--glass-thin)', border: '0.5px solid var(--glass-border-sub)',
                  borderRadius: 13, color: 'var(--label-secondary)', fontSize: 15, cursor: 'pointer',
                }}
              >
                Skip
              </button>
              <button
                onClick={pay}
                disabled={status === 'pending' || !amount || parseFloat(amount) <= 0}
                style={{
                  flex: 2, padding: '13px 0',
                  background: status === 'pending' ? 'rgba(10,132,255,0.3)' : 'rgba(10,132,255,0.85)',
                  border: 'none', borderRadius: 13,
                  color: '#fff', fontSize: 15, fontWeight: 600,
                  cursor: status === 'pending' ? 'default' : 'pointer',
                }}
              >
                {status === 'pending' ? 'Sending…' : '🔒 Pay anonymously'}
              </button>
            </div>

            <p style={{
              fontSize: 10, color: 'var(--label-tertiary)',
              textAlign: 'center', marginTop: 10,
            }}>
              Routed through STRK20 privacy pool · stealth address
            </p>
          </>
        )}
      </div>
    </div>
  )
}
