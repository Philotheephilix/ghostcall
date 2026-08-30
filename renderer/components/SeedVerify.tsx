'use client'

import { useState } from 'react'

interface Props {
  words: string[]
  onVerified: () => void
  onBack: () => void
}

export default function SeedVerify({ words, onVerified, onBack }: Props) {
  // Choose 3 random indices at mount — never re-rolled
  const [indices] = useState<number[]>(() => {
    const pool = Array.from({ length: 12 }, (_, i) => i)
    const picked: number[] = []
    while (picked.length < 3) {
      const i = Math.floor(Math.random() * pool.length)
      picked.push(pool.splice(i, 1)[0])
    }
    return picked.sort((a, b) => a - b)
  })

  const [answers, setAnswers] = useState<string[]>(['', '', ''])

  const allCorrect = indices.every(
    (idx, i) => answers[i].trim().toLowerCase() === words[idx].toLowerCase()
  )

  function setAnswer(i: number, val: string) {
    setAnswers(prev => { const next = [...prev]; next[i] = val; return next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p style={{ fontSize: 14, color: 'var(--label-secondary)', textAlign: 'center' }}>
        Enter these words from your seed phrase to confirm you saved them.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {indices.map((wordIdx, i) => (
          <div key={wordIdx}>
            <label style={{ fontSize: 12, color: 'var(--label-tertiary)', display: 'block', marginBottom: 4 }}>
              Word #{wordIdx + 1}
            </label>
            <input
              className="input-glass"
              style={{ fontSize: 13, padding: '8px 12px' }}
              type="text"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={answers[i]}
              onChange={e => setAnswer(i, e.target.value)}
            />
          </div>
        ))}
      </div>

      <button
        className="btn-primary"
        disabled={!allCorrect}
        onClick={onVerified}
      >
        Continue
      </button>

      <button
        type="button"
        className="btn-text"
        style={{ fontSize: 13, color: 'var(--label-tertiary)' }}
        onClick={onBack}
      >
        ← Back to words
      </button>
    </div>
  )
}
