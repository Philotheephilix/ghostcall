'use client'

import { formatSize } from '../lib/format-utils'

export interface IncomingFile {
  transferId: string
  onionAddr: string  // empty string on direct IPC path (receiver already connected)
  handle: string
  name: string
  size: number
}

interface Props {
  file: IncomingFile
  onAccept: () => void
  onReject: () => void
}

export default function FileTransferModal({ file, onAccept, onReject }: Props) {
  // Determine a simple file type icon based on extension
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const isImage = ['jpg','jpeg','png','gif','webp','svg'].includes(ext)
  const isDoc = ['pdf','doc','docx','txt','md'].includes(ext)

  return (
    <div className="in-page-modal-overlay">
      <div className="in-page-modal" style={{ maxWidth: 320, gap: 20 }}>
        {/* File type icon + info */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ flexShrink: 0, color: 'var(--label-quaternary)', paddingTop: 2 }}>
            {isImage ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            ) : isDoc ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
              </svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
              </svg>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--label-quaternary)', marginBottom: 6 }}>
              INCOMING FILE
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--label-primary)', wordBreak: 'break-all', lineHeight: 1.4 }}>
              {file.name}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--label-tertiary)', marginTop: 4 }}>
              {formatSize(file.size)}{file.handle ? <> · <span style={{ color: 'var(--accent)' }}>@{file.handle}</span></> : ''}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-primary" onClick={onAccept} style={{ flex: 1, fontSize: 12 }}>
            ACCEPT
          </button>
          <button className="btn-destructive" onClick={onReject} style={{ flex: 1, fontSize: 12, borderRadius: 'var(--radius-sm)', padding: '12px 16px' }}>
            REJECT
          </button>
        </div>

        {/* Encryption indicator */}
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--label-quaternary)', textAlign: 'center', letterSpacing: '0.06em', lineHeight: 1.5 }}>
          ENCRYPTED WITH NOISE_XX OVER TOR · ZERO NEW TRUST SURFACE
        </p>
      </div>
    </div>
  )
}

