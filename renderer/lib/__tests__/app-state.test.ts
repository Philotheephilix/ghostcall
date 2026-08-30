import { loadState, saveState, clearState } from '../app-state'

// Mock window and localStorage for node test environment
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString()
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

// jsdom provides window and localStorage — patch localStorage on the existing object
Object.defineProperty(window, 'localStorage', {
  writable: true,
  configurable: true,
  value: localStorageMock,
})

beforeEach(() => {
  localStorage.clear()
})

test('identitySource defaults to empty string', () => {
  expect(loadState().identitySource).toBe('')
})

test('saveState persists identitySource', () => {
  saveState({ identitySource: 'seed' })
  expect(loadState().identitySource).toBe('seed')
})

test('saveState with zkey sets identitySource', () => {
  saveState({ identitySource: 'zkey' })
  expect(loadState().identitySource).toBe('zkey')
})

test('clearState resets identitySource', () => {
  saveState({ identitySource: 'seed' })
  clearState()
  expect(loadState().identitySource).toBe('')
})
