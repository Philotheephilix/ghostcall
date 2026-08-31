'use client'

import { loadCallLog, type CallLogEntry } from '../lib/app-state'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function shortPeer(peer: string): string {
  if (!peer) return 'Unknown'
  if (peer.endsWith('.onion') || peer.includes('.onion:')) {
    return peer.slice(0, 8) + '…' + peer.slice(-6).replace(/:\d+$/, '')
  }
  return '@' + peer
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2h3l1.5 3.5-1.75 1.05A9.5 9.5 0 0 0 8.45 9.25L9.5 7.5 13 9v3a1 1 0 0 1-1.09 1A10 10 0 0 1 1 3 1 1 0 0 1 2 2z"/>
    </svg>
  )
}

export default function CallHistory() {
  const entries: CallLogEntry[] = loadCallLog()
  if (entries.length === 0) return null

  return (
    <div style={{ width: '100%', maxWidth: 360, marginTop: 'var(--space-5)' }}>
      <p style={{
        fontSize: 11, fontWeight: 600, letterSpacing: 0.8,
        color: 'var(--label-tertiary)', textTransform: 'uppercase',
        marginBottom: 'var(--space-2)', paddingLeft: 4,
      }}>
        Recent calls
      </p>
      <div style={{
        background: 'var(--glass-thin)',
        border: '0.5px solid var(--glass-border-sub)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}>
        {entries.map((e, i) => (
          <div key={e.id} style={{
            display: 'flex', alignItems: 'center',
            padding: '10px 14px',
            borderTop: i > 0 ? '0.5px solid var(--glass-border-sub)' : 'none',
            gap: 10,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--glass-regular)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--label-tertiary)', flexShrink: 0,
            }}>
              <PhoneIcon />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize: 13, fontWeight: 500,
                color: 'var(--label-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {shortPeer(e.peer)}
              </p>
              <p style={{ fontSize: 11, color: 'var(--label-tertiary)', marginTop: 1 }}>
                {formatDuration(e.duration)} · {relativeTime(e.ts)}
              </p>
            </div>

            {e.txHash && (
              <div style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 'var(--radius-full)',
                background: 'rgba(48,209,88,0.12)',
                color: 'var(--system-green)',
                fontWeight: 600, flexShrink: 0,
              }}>
                Paid
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
