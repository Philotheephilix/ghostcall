'use client'

import React, { useState } from 'react'

export default function SeedGrid({ words }: { words: string[] }): React.JSX.Element {
  const [revealed, setRevealed] = useState(false)

  // 2×6 layout: left column = indices 0–5 (words 1–6), right col = 6–11 (words 7–12)
  const left = words.slice(0, 6)
  const right = words.slice(6, 12)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[left, right].map((col, colIdx) =>
          col.map((word, rowIdx) => {
            const num = colIdx * 6 + rowIdx + 1
            return (
              <div
                key={num}
                style={{
                  background: 'var(--glass-thin)',
                  border: '0.5px solid var(--glass-border-sub)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 8px',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--label-tertiary)', marginBottom: 2 }}>
                  {num}
                </div>
                <div style={{ fontSize: 13, color: 'var(--label-primary)', letterSpacing: -0.1 }}>
                  {revealed ? word : '••••••'}
                </div>
              </div>
            )
          })
        )}
      </div>

      <button
        type="button"
        className="btn-secondary"
        style={{ fontSize: 14, padding: '10px 16px' }}
        onClick={() => setRevealed(r => !r)}
      >
        {revealed ? 'Hide seed phrase' : 'Reveal seed phrase'}
      </button>
    </div>
  )
}
