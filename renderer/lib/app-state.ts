'use client'

export interface AppState {
  walletConnected: boolean
  walletAddress: string
  handle: string
  registered: boolean
  registrationTx: string
  onboardingDone: boolean
}

// viewingKey is kept in memory only — never persisted to localStorage
let _sessionViewingKey = ''
export function getSessionViewingKey(): string { return _sessionViewingKey }
export function setSessionViewingKey(k: string): void { _sessionViewingKey = k }

const KEY = 'ghostcall:state'

const defaults: AppState = {
  walletConnected: false,
  walletAddress: '',
  handle: '',
  registered: false,
  registrationTx: '',
  onboardingDone: false,
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
  _sessionViewingKey = ''
  localStorage.removeItem(KEY)
}
