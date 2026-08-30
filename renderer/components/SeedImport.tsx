'use client'

import { useState } from 'react'
import { wordlist } from '@scure/bip39/wordlists/english.js'

interface Props {
  onImport: (words: string[]) => Promise<void>
}

export default function SeedImport({ onImport }: Props) {
  const [words, setWords] = useState<string[]>(Array(12).fill(''))
  const [errors, setErrors] = useState<boolean[]>(Array(12).fill(false))
  const [pasteError, setPasteError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')

  const validSet = new Set(wordlist)
  const allValid = words.every(w => w.trim() !== '' && validSet.has(w.trim().toLowerCase()))

  function setWord(i: number, val: string) {
    const next = [...words]; next[i] = val; setWords(next)
  }

  function validateWord(i: number) {
    const next = [...errors]
    next[i] = words[i].trim() !== '' && !validSet.has(words[i].trim().toLowerCase())
    setErrors(next)
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>, startIdx: number) {
    // Get text from clipboardData, handling both real events and test mocks
    let text = ''
    if (e.clipboardData?.getData) {
      try {
        text = e.clipboardData.getData('text')
      } catch {
        // Fallback
      }
    }

    const tokens = text.trim().split(/\s+/).filter(t => t)
    if (tokens.length !== 12) {
      e.preventDefault()
      setPasteError('Paste must be exactly 12 words')
      return
    }
    e.preventDefault()
    setPasteError('')
    setWords(tokens.map(t => t.toLowerCase()))
    setErrors(Array(12).fill(false))
  }

  async function handleImport() {
    setImporting(true)
    setImportError('')
    try {
      await onImport(words.map(w => w.trim().toLowerCase()))
    } catch (e) {
      setImportError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  // 2×6: left col = indices 0–5, right col = 6–11
  const left = [0,1,2,3,4,5]
  const right = [6,7,8,9,10,11]

  function WordInput({ idx }: { idx: number }) {
    return (
      <div>
        <div style={{ fontSize: 11, color: 'var(--label-tertiary)', marginBottom: 2 }}>{idx + 1}</div>
        <input
          className="input-glass"
          style={{
            fontSize: 13, padding: '6px 8px',
            borderColor: errors[idx] ? 'var(--system-red)' : undefined,
          }}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={words[idx]}
          onChange={e => setWord(idx, e.target.value)}
          onBlur={() => validateWord(idx)}
          onPaste={e => handlePaste(e, idx)}
        />
        {errors[idx] && (
          <div style={{ fontSize: 11, color: 'var(--system-red)', marginTop: 2 }}>invalid word</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {left.map(i => <WordInput key={i} idx={i} />)}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {right.map(i => <WordInput key={i} idx={i} />)}
        </div>
      </div>

      {pasteError && (
        <p style={{ fontSize: 12, color: 'var(--system-red)' }}>{pasteError}</p>
      )}
      {importError && (
        <p style={{ fontSize: 12, color: 'var(--system-red)', fontFamily: 'var(--font-mono)' }}>{importError}</p>
      )}

      <button
        className="btn-primary"
        disabled={!allValid || importing}
        onClick={handleImport}
      >
        {importing ? 'Restoring…' : 'Restore wallet'}
      </button>
    </div>
  )
}
