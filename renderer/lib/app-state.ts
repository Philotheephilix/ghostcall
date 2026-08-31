'use client'

export interface AppState {
  walletConnected: boolean
  walletAddress: string
  handle: string
  registered: boolean
  registrationTx: string
  onboardingDone: boolean
  identitySource: 'seed' | 'zkey' | 'env' | ''
}

// viewingKey is kept in memory only — never persisted to localStorage

const KEY = 'ghostcall:state'

const defaults: AppState = {
  walletConnected: false,
  walletAddress: '',
  handle: '',
  registered: false,
  registrationTx: '',
  onboardingDone: false,
  identitySource: '',
}

export function loadState(): AppState {
  if (typeof window === 'undefined') return { ...defaults }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw)
    // Strip any leaked viewingKey from old serialized state
    delete parsed.viewingKey
    return { ...defaults, ...parsed }
  } catch {
    return { ...defaults }
  }
}

export function saveState(patch: Partial<AppState>): AppState {
  const { ...safePatch } = patch as AppState & { viewingKey?: string }
  delete (safePatch as any).viewingKey  // never persist private key
  const next = { ...loadState(), ...safePatch }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function clearState(): void {
  localStorage.removeItem(KEY)
}

// ── Call log ──────────────────────────────────────────────────────────────

export interface CallLogEntry {
  id: string        // callId (random hex)
  peer: string      // handle or onion address
  duration: number  // seconds
  ts: number        // unix ms
  committed: boolean
  txHash?: string   // STRK20 payment tx if settled
}

const CALL_LOG_KEY = 'ghostcall:callLog'
const MAX_LOG = 20

export function loadCallLog(): CallLogEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CALL_LOG_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function appendCallLog(entry: CallLogEntry): void {
  const log = loadCallLog()
  log.unshift(entry)
  localStorage.setItem(CALL_LOG_KEY, JSON.stringify(log.slice(0, MAX_LOG)))
}

export function markCallPaid(id: string, txHash: string): void {
  const log = loadCallLog()
  const idx = log.findIndex(e => e.id === id)
  if (idx >= 0) {
    log[idx] = { ...log[idx], txHash, committed: true }
    localStorage.setItem(CALL_LOG_KEY, JSON.stringify(log))
  }
}
