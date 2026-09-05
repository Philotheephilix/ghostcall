'use client'

import React, { useState } from 'react'

export default function SeedGrid({ words }: { words: string[] }): React.JSX.Element {
  const [revealed, setRevealed] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8,
        width: '100%',
      }}>
        {words.map((word, i) => (
          <div key={i} className="seed-cell">
            <span className="seed-cell-index">{String(i + 1).padStart(2, '0')}</span>
            <span className="seed-cell-word">{revealed ? word : '••••••'}</span>
          </div>
        ))}
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
