'use client'

export interface AppState {
  walletConnected: boolean
  walletAddress: string
  handle: string
  registered: boolean        // handle registered on-chain
  registrationTx: string
  onboardingDone: boolean
  viewingKey: string         // hex skV for this session
}

const KEY = 'ghostcall:state'

const defaults: AppState = {
  walletConnected: false,
  walletAddress: '',
  handle: '',
  registered: false,
  registrationTx: '',
  onboardingDone: false,
  viewingKey: '',
}

export function loadState(): AppState {
  if (typeof window === 'undefined') return { ...defaults }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return { ...defaults }
  }
}

export function saveState(patch: Partial<AppState>): AppState {
  const next = { ...loadState(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function clearState(): void {
  localStorage.removeItem(KEY)
}
