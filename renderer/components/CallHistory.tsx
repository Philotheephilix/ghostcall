'use client'

import { loadCallLog, type CallLogEntry } from '../lib/app-state'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60 > 0 ? `${s % 60}s` : ''}`
}

function shortPeer(peer: string): string {
  if (!peer) return 'unknown'
  if (peer.endsWith('.onion') || peer.includes('.onion:')) {
    return peer.slice(0, 10) + '…'
  }
  return '@' + peer
}

export default function CallHistory() {
  const entries: CallLogEntry[] = loadCallLog()
  if (entries.length === 0) {
    return (
      <div style={{
        padding: '20px 14px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)',
        borderRadius: 'var(--radius-md)',
        textAlign: 'center',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--label-quaternary)', letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          No calls
        </span>
      </div>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      {entries.map((e, i) => (
        <div key={e.id} style={{
          display: 'flex', alignItems: 'center',
          padding: '10px 0',
          borderBottom: i < entries.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
          gap: 12,
        }}>
          {/* Status dot */}
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="var(--label-quaternary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2h3l1.5 3.5-1.75 1.05A9.5 9.5 0 0 0 8.45 9.25L9.5 7.5 13 9v3a1 1 0 0 1-1.09 1A10 10 0 0 1 1 3 1 1 0 0 1 2 2z"/>
            </svg>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
              color: 'var(--label-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              letterSpacing: '0.02em',
            }}>
              {shortPeer(e.peer)}
            </p>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              color: 'var(--label-quaternary)', marginTop: 2,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              {formatDuration(e.duration)} · {relativeTime(e.ts)}
            </p>
          </div>

          {e.txHash ? (
            <div style={{
              fontSize: 8, padding: '2px 6px', borderRadius: 'var(--radius-xs)',
              background: 'rgba(48,209,88,0.08)',
              border: '1px solid rgba(48,209,88,0.15)',
              color: 'var(--system-green)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600, flexShrink: 0,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              PAID
            </div>
          ) : (
            <div style={{
              fontSize: 8, padding: '2px 6px', borderRadius: 'var(--radius-xs)',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              color: 'var(--label-quaternary)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 500, flexShrink: 0,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              UNPAID
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
