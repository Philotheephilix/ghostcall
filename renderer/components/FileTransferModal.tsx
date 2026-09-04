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
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(10,10,8,0.82)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: 320, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Header */}
        <div>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--label-quaternary)', marginBottom: 8,
          }}>
            INCOMING FILE
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--label-primary)', wordBreak: 'break-all' }}>
            {file.name}
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--label-tertiary)', marginTop: 4 }}>
            {formatSize(file.size)}{file.handle ? ` · from @${file.handle}` : ''}
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn-primary"
            onClick={onAccept}
            style={{ flex: 1, fontSize: 12 }}
          >
            ACCEPT
          </button>
          <button
            className="btn-secondary"
            onClick={onReject}
            style={{ flex: 1, fontSize: 12 }}
          >
            REJECT
          </button>
        </div>
      </div>
    </div>
  )
}
