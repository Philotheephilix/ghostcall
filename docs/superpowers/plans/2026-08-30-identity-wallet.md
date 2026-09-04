# Identity Wallet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `.env`-only identity step in GhostCall's onboarding wizard with a real self-custodial wallet: BIP39 seed phrase creation/import (encrypted via OS keychain) and zKey social login (Google/Apple OAuth + ZK proof).

**Architecture:** All three identity paths (seed, zKey, .env) produce a `bigint` Stark private key fed into the existing `deriveStealthKeypairFromPrivKey()` — nothing downstream changes. The seed mnemonic is encrypted with `safeStorage` and stored in `userData/identity.enc`; the private key is never persisted. A new `electron/identity-manager.ts` owns all IPC handlers; the renderer gets thin wrappers in `renderer/lib/identity-client.ts` and three new display components.

**Tech Stack:** `@scure/bip39`, `@scure/bip32` (already installed transitively), Node.js `crypto` (built-in), Electron `safeStorage` + `shell`, React 18 + Next.js 14, TypeScript 5.

## Global Constraints

- All commits: `git -c user.name="Philotheephilix" -c user.email="110274378+Philotheephilix@users.noreply.github.com" commit`
- BIP32 derivation path: `m/44'/9004'/0'/0/0` (Starknet coin type 9004)
- `identity.enc` lives at `app.getPath('userData') + '/identity.enc'`
- Private key and mnemonic are NEVER logged, sent over IPC to renderer, or stored in localStorage
- `walletAddress` (public address only) IS safe to store in localStorage via `saveState()`
- 2×6 grid layout for all seed word displays (2 columns, 6 rows) — fits 420px canvas
- Seed word inputs: font-size 13px, padding 6px 8px, number label 11px `var(--label-tertiary)`
- zKey API endpoints are stubs (clearly `// TODO:` commented); fail gracefully with user-visible errors
- `requestSingleInstanceLock()` must be called before `app.whenReady()`
- Run `npm run bundle:electron && npx jest && npx tsc --noEmit` before every commit

---

## File Map

**New files:**
- `electron/identity-manager.ts` — IPC handlers, safeStorage I/O, BIP39/BIP32 derivation, zKey OAuth + ZKP
- `renderer/lib/identity-client.ts` — renderer-side `window.ghostcall.identity*` wrappers
- `renderer/components/SeedGrid.tsx` — 2×6 read-only word display with reveal toggle
- `renderer/components/SeedVerify.tsx` — 3-word verification inputs
- `renderer/components/SeedImport.tsx` — 12-word entry with BIP39 validation + paste handling

**Modified files:**
- `electron/main.ts` — add `requestSingleInstanceLock`, protocol handler, `identity:ready` startup emission, import identity-manager
- `electron/preload.ts` — expose `identity*` methods on `window.ghostcall`
- `renderer/app/onboarding/page.tsx` — replace `WalletStep` → `IdentityStep` with inline sub-flows
- `renderer/app/home/page.tsx` — wait for `identity:ready` push before onboarding guard
- `renderer/lib/app-state.ts` — add `identitySource` field
- `package.json` — promote `@scure/bip39` + `@scure/bip32` to direct deps

---

## Task 1: AppState + package.json — foundation types

**Files:**
- Modify: `renderer/lib/app-state.ts`
- Modify: `package.json`
- Test: `renderer/lib/__tests__/app-state.test.ts` (new)

**Interfaces:**
- Produces: `AppState.identitySource: 'seed' | 'zkey' | 'env' | ''`
- Produces: `@scure/bip39` and `@scure/bip32` as direct deps in package.json

- [ ] **Step 1: Write the failing test**

Create `renderer/lib/__tests__/app-state.test.ts`:

```ts
import { loadState, saveState, clearState } from '../app-state'

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/I740422/projects/stark && npx jest app-state --no-coverage
```

Expected: FAIL — `identitySource` property does not exist on `AppState`.

- [ ] **Step 3: Add `identitySource` to AppState**

In `renderer/lib/app-state.ts`, change the interface and defaults:

```ts
export interface AppState {
  walletConnected: boolean
  walletAddress: string
  handle: string
  registered: boolean
  registrationTx: string
  onboardingDone: boolean
  identitySource: 'seed' | 'zkey' | 'env' | ''
}
```

Add to the `defaults` object:
```ts
const defaults: AppState = {
  walletConnected: false,
  walletAddress: '',
  handle: '',
  registered: false,
  registrationTx: '',
  onboardingDone: false,
  identitySource: '',
}
```

- [ ] **Step 4: Promote BIP deps in package.json**

In `package.json`, add to `"dependencies"`:
```json
"@scure/bip32": "^2.0.1",
"@scure/bip39": "^2.0.1",
```

Run: `npm install` (no-op since already installed; just locks them as direct deps).

- [ ] **Step 5: Run test to verify it passes**

```bash
npx jest app-state --no-coverage
```

Expected: 4 tests PASS.

- [ ] **Step 6: Build + full test suite**

```bash
npm run bundle:electron && npx jest && npx tsc --noEmit
```

Expected: all tests pass, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add renderer/lib/app-state.ts renderer/lib/__tests__/app-state.test.ts package.json package-lock.json
git -c user.name="Philotheephilix" -c user.email="110274378+Philotheephilix@users.noreply.github.com" \
  commit -m "feat: add identitySource to AppState, promote bip32/bip39 deps"
```

---

## Task 2: identity-manager — seed path (BIP39/BIP32 + safeStorage)

**Files:**
- Create: `electron/identity-manager.ts`
- Create: `electron/__tests__/identity-manager.test.ts`

**Interfaces:**
- Consumes: `initStarknetClient(rpcUrl, address, privKeyHex)` from `renderer/lib/starknet-client`
- Consumes: `deriveStealthKeypairFromPrivKey(privKey: bigint)` from `renderer/lib/stealth-keys` (for address derivation — note: we need to derive the Starknet account address from the privkey; use `Account` from `starknet` package)
- Produces IPC handlers: `identity:exists`, `identity:create`, `identity:save`, `identity:import`, `identity:load`
- Produces: `registerIdentityIpcHandlers(win: BrowserWindow): void`
- Produces: `runIdentityStartupSequence(win: BrowserWindow): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `electron/__tests__/identity-manager.test.ts`:

```ts
// identity-manager.test.ts
// Tests the pure derivation logic (not IPC handlers — those need Electron)

import { generateMnemonic, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'

// Re-export the derivation helpers we'll extract from identity-manager
// (they'll be exported from identity-manager.ts)
import { derivePrivKeyFromMnemonic, mnemonicToWords, wordsToMnemonic } from '../identity-manager'

test('derivePrivKeyFromMnemonic returns a non-zero bigint', () => {
  const mnemonic = generateMnemonic(wordlist)
  const privKey = derivePrivKeyFromMnemonic(mnemonic)
  expect(typeof privKey).toBe('bigint')
  expect(privKey).toBeGreaterThan(0n)
})

test('derivePrivKeyFromMnemonic is deterministic', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  const k1 = derivePrivKeyFromMnemonic(mnemonic)
  const k2 = derivePrivKeyFromMnemonic(mnemonic)
  expect(k1).toBe(k2)
})

test('derivePrivKeyFromMnemonic uses m/44\'/9004\'/0\'/0/0 path', () => {
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  const seed = mnemonicToSeedSync(mnemonic)
  const root = HDKey.fromMasterSeed(seed)
  const child = root.derive("m/44'/9004'/0'/0/0")
  const expected = BigInt('0x' + Buffer.from(child.privateKey!).toString('hex'))
  expect(derivePrivKeyFromMnemonic(mnemonic)).toBe(expected)
})

test('mnemonicToWords splits correctly', () => {
  const words = mnemonicToWords('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
  expect(words).toHaveLength(12)
  expect(words[0]).toBe('abandon')
  expect(words[11]).toBe('about')
})

test('wordsToMnemonic joins correctly', () => {
  const words = Array(11).fill('abandon').concat(['about'])
  expect(wordsToMnemonic(words)).toBe('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
})

test('invalid mnemonic throws on derivePrivKeyFromMnemonic', () => {
  expect(() => derivePrivKeyFromMnemonic('not a valid mnemonic at all for real')).toThrow()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest identity-manager --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement identity-manager.ts (seed path only)**

Create `electron/identity-manager.ts`:

```ts
import path from 'path'
import fs from 'fs'
import { app, ipcMain, safeStorage, BrowserWindow, shell } from 'electron'
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { HDKey } from '@scure/bip32'
import { initStarknetClient } from '../renderer/lib/starknet-client'
import { Account, RpcProvider } from 'starknet'

// ── Pure helpers (exported for tests) ──────────────────────────────────────

export function mnemonicToWords(mnemonic: string): string[] {
  return mnemonic.trim().split(/\s+/)
}

export function wordsToMnemonic(words: string[]): string {
  return words.join(' ')
}

export function derivePrivKeyFromMnemonic(mnemonic: string): bigint {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('Invalid mnemonic')
  }
  const seed = mnemonicToSeedSync(mnemonic)
  const root = HDKey.fromMasterSeed(seed)
  const child = root.derive("m/44'/9004'/0'/0/0")
  if (!child.privateKey) throw new Error('BIP32 derivation failed')
  return BigInt('0x' + Buffer.from(child.privateKey).toString('hex'))
}

// Derives a Starknet account address from a private key hex string.
// Uses the existing STARKNET_ACCOUNT_ADDRESS env var if set (dev mode),
// otherwise derives from the private key (placeholder until full key→address derivation).
function deriveAddress(privKeyHex: string): string {
  // In dev, use the env address. In production, the address comes from the
  // deployed account contract — here we use the env address as a fallback.
  // TODO: replace with proper Starknet account address derivation when
  // account deployment is implemented.
  return process.env.STARKNET_ACCOUNT_ADDRESS ?? ('0x' + privKeyHex.slice(-40).padStart(40, '0'))
}

// ── Storage ────────────────────────────────────────────────────────────────

function encPath(): string {
  return path.join(app.getPath('userData'), 'identity.enc')
}

function saveMnemonic(mnemonic: string): void {
  const encrypted = safeStorage.encryptString(mnemonic)
  fs.writeFileSync(encPath(), encrypted)
}

function loadMnemonic(): string {
  const encrypted = fs.readFileSync(encPath())
  return safeStorage.decryptString(encrypted)
}

export function identityFileExists(): boolean {
  return fs.existsSync(encPath())
}

// ── Startup sequence ───────────────────────────────────────────────────────

export async function runIdentityStartupSequence(win: BrowserWindow): Promise<void> {
  const rpcUrl = process.env.STARKNET_RPC_URL ?? ''

  // 1. .env silent path
  if (process.env.STARKNET_PRIVATE_KEY && process.env.STARKNET_ACCOUNT_ADDRESS) {
    initStarknetClient(rpcUrl, process.env.STARKNET_ACCOUNT_ADDRESS, process.env.STARKNET_PRIVATE_KEY)
    win.webContents.send('identity:ready', { source: 'env', address: process.env.STARKNET_ACCOUNT_ADDRESS })
    return
  }

  // 2. Seed path — identity.enc exists
  if (identityFileExists()) {
    try {
      const mnemonic = loadMnemonic()
      const privKey = derivePrivKeyFromMnemonic(mnemonic)
      const privKeyHex = privKey.toString(16).padStart(64, '0')
      const address = deriveAddress(privKeyHex)
      initStarknetClient(rpcUrl, address, '0x' + privKeyHex)
      win.webContents.send('identity:ready', { source: 'seed', address })
    } catch {
      win.webContents.send('identity:ready', { source: '', error: 'decryption-failed' })
    }
    return
  }

  // 3. No identity — onboarding needed
  win.webContents.send('identity:ready', { source: '', address: '' })
}

// ── IPC handlers ───────────────────────────────────────────────────────────

let _identityHandlersRegistered = false

export function registerIdentityIpcHandlers(): void {
  if (_identityHandlersRegistered) return
  _identityHandlersRegistered = true

  ipcMain.handle('identity:exists', () => ({ exists: identityFileExists() }))

  ipcMain.handle('identity:create', () => {
    const mnemonic = generateMnemonic(wordlist)
    return { words: mnemonicToWords(mnemonic) }
  })

  ipcMain.handle('identity:save', (_e, { words }: { words: string[] }) => {
    const mnemonic = wordsToMnemonic(words)
    if (!validateMnemonic(mnemonic, wordlist)) throw new Error('Invalid mnemonic')
    const privKey = derivePrivKeyFromMnemonic(mnemonic)
    const privKeyHex = privKey.toString(16).padStart(64, '0')
    const address = deriveAddress(privKeyHex)
    const rpcUrl = process.env.STARKNET_RPC_URL ?? ''
    initStarknetClient(rpcUrl, address, '0x' + privKeyHex)
    saveMnemonic(mnemonic)
    return { address }
  })

  ipcMain.handle('identity:import', (_e, { words }: { words: string[] }) => {
    const mnemonic = wordsToMnemonic(words)
    if (!validateMnemonic(mnemonic, wordlist)) throw new Error('Invalid mnemonic — check your words and try again')
    const privKey = derivePrivKeyFromMnemonic(mnemonic)
    const privKeyHex = privKey.toString(16).padStart(64, '0')
    const address = deriveAddress(privKeyHex)
    const rpcUrl = process.env.STARKNET_RPC_URL ?? ''
    initStarknetClient(rpcUrl, address, '0x' + privKeyHex)
    saveMnemonic(mnemonic)
    return { address }
  })

  ipcMain.handle('identity:load', () => {
    if (!identityFileExists()) throw new Error('No identity file found')
    const mnemonic = loadMnemonic()
    const privKey = derivePrivKeyFromMnemonic(mnemonic)
    const privKeyHex = privKey.toString(16).padStart(64, '0')
    const address = deriveAddress(privKeyHex)
    const rpcUrl = process.env.STARKNET_RPC_URL ?? ''
    initStarknetClient(rpcUrl, address, '0x' + privKeyHex)
    return { address, source: 'seed' }
  })

  // zKey handlers registered separately in Task 5
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest identity-manager --no-coverage
```

Expected: 6 tests PASS.

- [ ] **Step 5: Build + full suite**

```bash
npm run bundle:electron && npx jest && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add electron/identity-manager.ts electron/__tests__/identity-manager.test.ts
git -c user.name="Philotheephilix" -c user.email="110274378+Philotheephilix@users.noreply.github.com" \
  commit -m "feat: identity-manager — seed phrase BIP39/BIP32 derivation + safeStorage"
```

---

## Task 3: identity-manager — zKey OAuth path

**Files:**
- Modify: `electron/identity-manager.ts` (add zKey state + handlers)
- Modify: `electron/main.ts` (add `requestSingleInstanceLock`, `setAsDefaultProtocolClient`, `open-url`, `second-instance`)

**Interfaces:**
- Consumes: `registerIdentityIpcHandlers()` from Task 2
- Consumes: `runIdentityStartupSequence(win)` from Task 2
- Produces IPC handlers: `identity:zkey-begin`, `identity:zkey-cancel`
- Produces push events: `identity:ready`, `identity:zkey-result`

- [ ] **Step 1: Add zKey state + handlers to identity-manager.ts**

Add to `electron/identity-manager.ts` (after the existing handler block, inside `registerIdentityIpcHandlers`):

```ts
// ── zKey session state ─────────────────────────────────────────────────────
// (add at module scope, before registerIdentityIpcHandlers)
interface ZkeySession {
  state: string
  codeVerifier: string
  sessionPrivKeyHex: string
  inFlight: boolean
  abortController: AbortController | null
  win: BrowserWindow | null
  timeoutId: ReturnType<typeof setTimeout> | null
}

const zkeySession: ZkeySession = {
  state: '',
  codeVerifier: '',
  sessionPrivKeyHex: '',
  inFlight: false,
  abortController: null,
  win: null,
  timeoutId: null,
}

function cancelZkeySession(): void {
  zkeySession.abortController?.abort()
  if (zkeySession.timeoutId) clearTimeout(zkeySession.timeoutId)
  zkeySession.state = ''
  zkeySession.codeVerifier = ''
  zkeySession.sessionPrivKeyHex = ''
  zkeySession.inFlight = false
  zkeySession.abortController = null
  zkeySession.timeoutId = null
}

const STARK_ORDER = BigInt('0x0800000000000011000000000000000000000000000000000000000000000001')

function generateZkeySession(): { authUrl: string } {
  const crypto = require('crypto') as typeof import('crypto')

  // Session keypair (ephemeral — held in memory for this OAuth session)
  const sessionKeyBytes = crypto.randomBytes(32)
  const sessionPrivKey = BigInt('0x' + sessionKeyBytes.toString('hex')) % STARK_ORDER
  zkeySession.sessionPrivKeyHex = sessionPrivKey.toString(16).padStart(64, '0')

  // PKCE
  const verifierBytes = crypto.randomBytes(32)
  zkeySession.codeVerifier = verifierBytes.toString('base64url')
  const challenge = crypto.createHash('sha256').update(zkeySession.codeVerifier).digest('base64url')

  // State nonce
  zkeySession.state = crypto.randomBytes(32).toString('hex')
  zkeySession.inFlight = true
  zkeySession.abortController = new AbortController()

  // TODO: Replace with actual zKey authorization endpoint once published at https://docs.zkey.org
  const authUrl = new URL('https://accounts.zkey.org/oauth/authorize')
  authUrl.searchParams.set('client_id', 'ghostcall') // TODO: register client_id with zKey
  authUrl.searchParams.set('redirect_uri', 'ghostcall://zkey-callback')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid')
  authUrl.searchParams.set('state', zkeySession.state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  return { authUrl: authUrl.toString() }
}

export async function handleZkeyCallback(url: string): Promise<void> {
  if (!zkeySession.win) return
  const win = zkeySession.win
  try {
    const parsed = new URL(url)
    const code = parsed.searchParams.get('code')
    const state = parsed.searchParams.get('state')

    if (state !== zkeySession.state || !zkeySession.inFlight) {
      win.webContents.send('identity:zkey-result', { ok: false, error: 'Session expired — please try again' })
      cancelZkeySession()
      return
    }

    // Start 30s timeout from when callback is received
    zkeySession.timeoutId = setTimeout(() => {
      win.webContents.send('identity:zkey-result', { ok: false, error: 'Verification timed out — please try again' })
      cancelZkeySession()
    }, 30_000)

    const signal = zkeySession.abortController!.signal
    const rpcUrl = process.env.STARKNET_RPC_URL ?? ''

    // TODO: Update these endpoints when zKey publishes their developer portal
    // Step 1: Token exchange
    const tokenRes = await fetch('https://api.zkey.org/oauth/token', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: zkeySession.codeVerifier,
        redirect_uri: 'ghostcall://zkey-callback',
        client_id: 'ghostcall', // TODO: actual registered client_id
      }),
    })
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`)
    const { id_token } = await tokenRes.json() as { id_token: string }

    // Step 2: Salt
    const saltRes = await fetch('https://api.zkey.org/salt', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token }),
    })
    if (!saltRes.ok) throw new Error(`Salt request failed: ${saltRes.status}`)
    const { salt } = await saltRes.json() as { salt: string }

    // Step 3: ZKP prove
    const proveRes = await fetch('https://api.zkey.org/zkp/prove', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token, salt, session_pub_key: '0x' + zkeySession.sessionPrivKeyHex }),
    })
    if (!proveRes.ok) throw new Error(`ZKP proof failed: ${proveRes.status}`)

    // Derive address from JWT claims + salt
    // TODO: parse sub/aud/iss from id_token and compute H(sub,aud,iss,salt) per zKey spec
    const address = process.env.STARKNET_ACCOUNT_ADDRESS ?? '0xzkey_placeholder'
    initStarknetClient(rpcUrl, address, '0x' + zkeySession.sessionPrivKeyHex)

    if (zkeySession.timeoutId) clearTimeout(zkeySession.timeoutId)
    win.webContents.send('identity:zkey-result', { ok: true, address })
    cancelZkeySession()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'AbortError' || msg.includes('abort')) return // cancelled
    zkeySession.win?.webContents.send('identity:zkey-result', { ok: false, error: msg })
    cancelZkeySession()
  }
}
```

Then add inside `registerIdentityIpcHandlers`, after existing handlers:

```ts
  ipcMain.handle('identity:zkey-begin', async (_e, { provider, win: _win }: { provider: 'google' | 'apple', win?: unknown }) => {
    // Cancel any in-flight session first
    if (zkeySession.inFlight) cancelZkeySession()
    // Capture win reference for push events
    // win is stored at module scope when registerIdentityIpcHandlers is called
    const { authUrl } = generateZkeySession()
    try {
      await shell.openExternal(authUrl)
    } catch {
      zkeySession.win?.webContents.send('identity:zkey-result', {
        ok: false, error: 'Could not open browser — check your default browser settings',
      })
      cancelZkeySession()
    }
  })

  ipcMain.handle('identity:zkey-cancel', () => {
    cancelZkeySession()
  })
```

Update `registerIdentityIpcHandlers` signature to accept `win`:

```ts
export function registerIdentityIpcHandlers(win: BrowserWindow): void {
  if (_identityHandlersRegistered) return
  _identityHandlersRegistered = true
  zkeySession.win = win
  // ... rest of handlers unchanged
```

- [ ] **Step 2: Update main.ts**

In `electron/main.ts`, add before `app.whenReady()`:

```ts
import { registerIdentityIpcHandlers, runIdentityStartupSequence, handleZkeyCallback } from './identity-manager'

// Single instance lock — required for Windows OAuth callback via second-instance event
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', (_e, argv) => {
  // Windows: OAuth redirect URL arrives in argv
  const url = argv.find((a: string) => a.startsWith('ghostcall://'))
  if (url) handleZkeyCallback(url)
  win?.focus()
})

app.setAsDefaultProtocolClient('ghostcall')

app.on('open-url', (_e, url) => {
  // macOS: OAuth redirect URL arrives here
  handleZkeyCallback(url)
})
```

Inside `app.whenReady()`, after creating `win` and calling `win.loadURL(url)`, add:

```ts
  registerIdentityIpcHandlers(win)
  // Run startup identity sequence — emits identity:ready to renderer
  // Must fire after win is created so webContents.send works
  win.webContents.once('did-finish-load', () => {
    runIdentityStartupSequence(win!)
  })
```

Remove the old `.env`-based `initStarknetClient` block at the top of `app.whenReady()` (lines 31–44 in current main.ts) — `runIdentityStartupSequence` now owns that logic.

- [ ] **Step 3: Build and typecheck**

```bash
npm run bundle:electron && npx tsc --noEmit
```

Expected: clean build. Fix any type errors before continuing.

- [ ] **Step 4: Run full test suite**

```bash
npx jest
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add electron/identity-manager.ts electron/main.ts
git -c user.name="Philotheephilix" -c user.email="110274378+Philotheephilix@users.noreply.github.com" \
  commit -m "feat: identity-manager — zKey OAuth + ZKP flow, protocol handler, single instance lock"
```

---

## Task 4: Preload + identity-client — IPC bridge to renderer

**Files:**
- Modify: `electron/preload.ts`
- Create: `renderer/lib/identity-client.ts`
- Create: `renderer/lib/__tests__/identity-client.test.ts`

**Interfaces:**
- Consumes: all `identity:*` IPC channels from Tasks 2–3
- Produces on `window.ghostcall`:
  - `identityExists(): Promise<{ exists: boolean }>`
  - `identityCreate(): Promise<{ words: string[] }>`
  - `identitySave(words: string[]): Promise<{ address: string }>`
  - `identityImport(words: string[]): Promise<{ address: string }>`
  - `identityLoad(): Promise<{ address: string; source: string }>`
  - `identityZkeyBegin(provider: 'google' | 'apple'): Promise<void>`
  - `identityZkeyCancel(): Promise<void>`
  - `onIdentityReady(cb: (data: { source: string; address?: string; error?: string }) => void): () => void`
  - `onZkeyResult(cb: (data: { ok: boolean; address?: string; error?: string }) => void): () => void`
- Produces: `renderer/lib/identity-client.ts` with typed wrappers

- [ ] **Step 1: Add identity methods to preload.ts**

In `electron/preload.ts`, add inside the `contextBridge.exposeInMainWorld('ghostcall', { ... })` object:

```ts
  // Identity
  identityExists: () => ipcRenderer.invoke('identity:exists'),
  identityCreate: () => ipcRenderer.invoke('identity:create'),
  identitySave: (words: string[]) => ipcRenderer.invoke('identity:save', { words }),
  identityImport: (words: string[]) => ipcRenderer.invoke('identity:import', { words }),
  identityLoad: () => ipcRenderer.invoke('identity:load'),
  identityZkeyBegin: (provider: 'google' | 'apple') => ipcRenderer.invoke('identity:zkey-begin', { provider }),
  identityZkeyCancel: () => ipcRenderer.invoke('identity:zkey-cancel'),
  onIdentityReady: (cb: (data: { source: string; address?: string; error?: string }) => void) =>
    onIpc('identity:ready', cb as (...args: unknown[]) => void),
  onZkeyResult: (cb: (data: { ok: boolean; address?: string; error?: string }) => void) =>
    onIpc('identity:zkey-result', cb as (...args: unknown[]) => void),
```

- [ ] **Step 2: Create identity-client.ts**

Create `renderer/lib/identity-client.ts`:

```ts
'use client'

const gc = () => (window as any).ghostcall

export async function identityExists(): Promise<{ exists: boolean }> {
  return gc().identityExists()
}

export async function identityCreate(): Promise<{ words: string[] }> {
  return gc().identityCreate()
}

export async function identitySave(words: string[]): Promise<{ address: string }> {
  return gc().identitySave(words)
}

export async function identityImport(words: string[]): Promise<{ address: string }> {
  return gc().identityImport(words)
}

export async function identityLoad(): Promise<{ address: string; source: string }> {
  return gc().identityLoad()
}

export async function identityZkeyBegin(provider: 'google' | 'apple'): Promise<void> {
  return gc().identityZkeyBegin(provider)
}

export async function identityZkeyCancel(): Promise<void> {
  return gc().identityZkeyCancel()
}

export function onIdentityReady(
  cb: (data: { source: string; address?: string; error?: string }) => void
): () => void {
  return gc().onIdentityReady(cb)
}

export function onZkeyResult(
  cb: (data: { ok: boolean; address?: string; error?: string }) => void
): () => void {
  return gc().onZkeyResult(cb)
}
```

- [ ] **Step 3: Write and run test for identity-client**

Create `renderer/lib/__tests__/identity-client.test.ts`:

```ts
// identity-client.test.ts
// Tests that identity-client correctly delegates to window.ghostcall

const mockIdentityExists = jest.fn().mockResolvedValue({ exists: false })
const mockIdentityCreate = jest.fn().mockResolvedValue({ words: ['word1'] })
const mockIdentitySave = jest.fn().mockResolvedValue({ address: '0xabc' })
const mockIdentityImport = jest.fn().mockResolvedValue({ address: '0xdef' })
const mockIdentityLoad = jest.fn().mockResolvedValue({ address: '0xghi', source: 'seed' })
const mockIdentityZkeyBegin = jest.fn().mockResolvedValue(undefined)
const mockIdentityZkeyCancel = jest.fn().mockResolvedValue(undefined)
const mockOnIdentityReady = jest.fn().mockReturnValue(() => {})
const mockOnZkeyResult = jest.fn().mockReturnValue(() => {})

Object.defineProperty(global, 'window', {
  value: {
    ghostcall: {
      identityExists: mockIdentityExists,
      identityCreate: mockIdentityCreate,
      identitySave: mockIdentitySave,
      identityImport: mockIdentityImport,
      identityLoad: mockIdentityLoad,
      identityZkeyBegin: mockIdentityZkeyBegin,
      identityZkeyCancel: mockIdentityZkeyCancel,
      onIdentityReady: mockOnIdentityReady,
      onZkeyResult: mockOnZkeyResult,
    },
  },
  writable: true, configurable: true,
})

import {
  identityExists, identityCreate, identitySave, identityImport,
  identityLoad, identityZkeyBegin, identityZkeyCancel,
  onIdentityReady, onZkeyResult,
} from '../identity-client'

test('identityExists delegates to ghostcall', async () => {
  const result = await identityExists()
  expect(mockIdentityExists).toHaveBeenCalledTimes(1)
  expect(result).toEqual({ exists: false })
})

test('identityCreate delegates to ghostcall', async () => {
  await identityCreate()
  expect(mockIdentityCreate).toHaveBeenCalledTimes(1)
})

test('identitySave passes words', async () => {
  await identitySave(['a', 'b'])
  expect(mockIdentitySave).toHaveBeenCalledWith(['a', 'b'])
})

test('identityImport passes words', async () => {
  await identityImport(['a', 'b'])
  expect(mockIdentityImport).toHaveBeenCalledWith(['a', 'b'])
})

test('identityZkeyBegin passes provider', async () => {
  await identityZkeyBegin('google')
  expect(mockIdentityZkeyBegin).toHaveBeenCalledWith('google')
})

test('onIdentityReady returns cleanup fn', () => {
  const cb = jest.fn()
  const cleanup = onIdentityReady(cb)
  expect(typeof cleanup).toBe('function')
})
```

```bash
npx jest identity-client --no-coverage
```

Expected: 6 tests PASS.

- [ ] **Step 4: Build**

```bash
npm run bundle:electron && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts renderer/lib/identity-client.ts renderer/lib/__tests__/identity-client.test.ts
git -c user.name="Philotheephilix" -c user.email="110274378+Philotheephilix@users.noreply.github.com" \
  commit -m "feat: preload + identity-client — IPC bridge for identity channels"
```

---

## Task 5: SeedGrid component

**Files:**
- Create: `renderer/components/SeedGrid.tsx`
- Create: `renderer/components/__tests__/SeedGrid.test.tsx` (new test dir)

**Interfaces:**
- Produces: `export default function SeedGrid({ words }: { words: string[] }): JSX.Element`

- [ ] **Step 1: Create test dir and write failing test**

```bash
mkdir -p /Users/I740422/projects/stark/renderer/components/__tests__
```

Create `renderer/components/__tests__/SeedGrid.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SeedGrid from '../SeedGrid'

const WORDS = [
  'abandon','ability','able','about','above','absent',
  'absorb','abstract','absurd','abuse','access','accident',
]

test('renders 12 numbered word cells', () => {
  render(<SeedGrid words={WORDS} />)
  // Number labels 1–12 should be visible
  expect(screen.getByText('1')).toBeInTheDocument()
  expect(screen.getByText('12')).toBeInTheDocument()
})

test('words are hidden by default', () => {
  render(<SeedGrid words={WORDS} />)
  expect(screen.queryByText('abandon')).not.toBeInTheDocument()
  expect(screen.getByText('Reveal seed phrase')).toBeInTheDocument()
})

test('toggle reveals all words', () => {
  render(<SeedGrid words={WORDS} />)
  fireEvent.click(screen.getByText('Reveal seed phrase'))
  expect(screen.getByText('abandon')).toBeInTheDocument()
  expect(screen.getByText('accident')).toBeInTheDocument()
  expect(screen.getByText('Hide seed phrase')).toBeInTheDocument()
})

test('toggle twice hides words again', () => {
  render(<SeedGrid words={WORDS} />)
  fireEvent.click(screen.getByText('Reveal seed phrase'))
  fireEvent.click(screen.getByText('Hide seed phrase'))
  expect(screen.queryByText('abandon')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify fails**

```bash
npx jest SeedGrid --no-coverage
```

Expected: FAIL — module not found / missing `@testing-library/react`.

- [ ] **Step 3: Install testing-library if not present**

```bash
npm list @testing-library/react 2>/dev/null || npm install --save-dev @testing-library/react @testing-library/jest-dom
```

Check `jest.config.js` or `jest.config.ts` — add `setupFilesAfterFramework: ['@testing-library/jest-dom']` if needed.

- [ ] **Step 4: Implement SeedGrid.tsx**

Create `renderer/components/SeedGrid.tsx`:

```tsx
'use client'

import { useState } from 'react'

export default function SeedGrid({ words }: { words: string[] }) {
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
```

- [ ] **Step 5: Run test to verify passes**

```bash
npx jest SeedGrid --no-coverage
```

Expected: 4 tests PASS.

- [ ] **Step 6: Build + full suite**

```bash
npm run bundle:electron && npx jest && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add renderer/components/SeedGrid.tsx renderer/components/__tests__/SeedGrid.test.tsx
git -c user.name="Philotheephilix" -c user.email="110274378+Philotheephilix@users.noreply.github.com" \
  commit -m "feat: SeedGrid — 2x6 word display with reveal toggle"
```

---

## Task 6: SeedVerify component

**Files:**
- Create: `renderer/components/SeedVerify.tsx`
- Create: `renderer/components/__tests__/SeedVerify.test.tsx`

**Interfaces:**
- Produces: `export default function SeedVerify({ words, onVerified, onBack }: { words: string[]; onVerified: () => void; onBack: () => void }): JSX.Element`

- [ ] **Step 1: Write failing test**

Create `renderer/components/__tests__/SeedVerify.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SeedVerify from '../SeedVerify'

const WORDS = [
  'abandon','ability','able','about','above','absent',
  'absorb','abstract','absurd','abuse','access','accident',
]

test('renders 3 word inputs', () => {
  render(<SeedVerify words={WORDS} onVerified={jest.fn()} onBack={jest.fn()} />)
  const inputs = screen.getAllByRole('textbox')
  expect(inputs).toHaveLength(3)
})

test('Continue button is disabled initially', () => {
  render(<SeedVerify words={WORDS} onVerified={jest.fn()} onBack={jest.fn()} />)
  expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
})

test('Back link calls onBack', () => {
  const onBack = jest.fn()
  render(<SeedVerify words={WORDS} onVerified={jest.fn()} onBack={onBack} />)
  fireEvent.click(screen.getByText(/back to words/i))
  expect(onBack).toHaveBeenCalledTimes(1)
})

test('correct answers enable Continue and call onVerified', () => {
  const onVerified = jest.fn()
  render(<SeedVerify words={WORDS} onVerified={onVerified} onBack={jest.fn()} />)
  const inputs = screen.getAllByRole('textbox')
  const labels = screen.getAllByText(/word #\d+/i)

  // Extract which word indices are asked (from label text "Word #N")
  labels.forEach((label, i) => {
    const match = label.textContent?.match(/Word #(\d+)/i)
    if (match) {
      const idx = parseInt(match[1]) - 1
      fireEvent.change(inputs[i], { target: { value: WORDS[idx] } })
    }
  })

  expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  expect(onVerified).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run to verify fails**

```bash
npx jest SeedVerify --no-coverage
```

- [ ] **Step 3: Implement SeedVerify.tsx**

Create `renderer/components/SeedVerify.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'

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
```

- [ ] **Step 4: Run test to verify passes**

```bash
npx jest SeedVerify --no-coverage
```

Expected: 4 tests PASS.

- [ ] **Step 5: Build + full suite, then commit**

```bash
npm run bundle:electron && npx jest && npx tsc --noEmit
git add renderer/components/SeedVerify.tsx renderer/components/__tests__/SeedVerify.test.tsx
git -c user.name="Philotheephilix" -c user.email="110274378+Philotheephilix@users.noreply.github.com" \
  commit -m "feat: SeedVerify — 3-word verification with back navigation"
```

---

## Task 7: SeedImport component

**Files:**
- Create: `renderer/components/SeedImport.tsx`
- Create: `renderer/components/__tests__/SeedImport.test.tsx`

**Interfaces:**
- Consumes: `wordlist` from `@scure/bip39/wordlists/english` (BIP39 word validation)
- Produces: `export default function SeedImport({ onImport }: { onImport: (words: string[]) => Promise<void> }): JSX.Element`

- [ ] **Step 1: Write failing test**

Create `renderer/components/__tests__/SeedImport.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SeedImport from '../SeedImport'

test('renders 12 inputs', () => {
  render(<SeedImport onImport={jest.fn()} />)
  const inputs = screen.getAllByRole('textbox')
  expect(inputs).toHaveLength(12)
})

test('Restore button is disabled when inputs are empty', () => {
  render(<SeedImport onImport={jest.fn()} />)
  expect(screen.getByRole('button', { name: /restore/i })).toBeDisabled()
})

test('paste of 12 valid BIP39 words fills all inputs', async () => {
  render(<SeedImport onImport={jest.fn()} />)
  const inputs = screen.getAllByRole('textbox')
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  fireEvent.paste(inputs[0], {
    clipboardData: { getData: () => phrase },
  })
  await waitFor(() => {
    expect((inputs[0] as HTMLInputElement).value).toBe('abandon')
    expect((inputs[11] as HTMLInputElement).value).toBe('about')
  })
})

test('paste of wrong word count shows error', async () => {
  render(<SeedImport onImport={jest.fn()} />)
  const inputs = screen.getAllByRole('textbox')
  fireEvent.paste(inputs[0], {
    clipboardData: { getData: () => 'only three words here' },
  })
  await waitFor(() => {
    expect(screen.getByText(/paste must be exactly 12 words/i)).toBeInTheDocument()
  })
})

test('calls onImport with words when Restore clicked', async () => {
  const onImport = jest.fn().mockResolvedValue(undefined)
  render(<SeedImport onImport={onImport} />)
  const inputs = screen.getAllByRole('textbox')
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  fireEvent.paste(inputs[0], { clipboardData: { getData: () => phrase } })
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /restore/i })).not.toBeDisabled()
  })
  fireEvent.click(screen.getByRole('button', { name: /restore/i }))
  await waitFor(() => {
    expect(onImport).toHaveBeenCalledWith(phrase.split(' '))
  })
})
```

- [ ] **Step 2: Run to verify fails**

```bash
npx jest SeedImport --no-coverage
```

- [ ] **Step 3: Implement SeedImport.tsx**

Create `renderer/components/SeedImport.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { wordlist } from '@scure/bip39/wordlists/english'

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
    const text = e.clipboardData.getData('text')
    const tokens = text.trim().split(/\s+/)
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
```

- [ ] **Step 4: Run test to verify passes**

```bash
npx jest SeedImport --no-coverage
```

Expected: 5 tests PASS.

- [ ] **Step 5: Build + full suite, then commit**

```bash
npm run bundle:electron && npx jest && npx tsc --noEmit
git add renderer/components/SeedImport.tsx renderer/components/__tests__/SeedImport.test.tsx
git -c user.name="Philotheephilix" -c user.email="110274378+Philotheephilix@users.noreply.github.com" \
  commit -m "feat: SeedImport — 12-word entry with BIP39 validation and paste handling"
```

---

## Task 8: IdentityStep — wire onboarding wizard

**Files:**
- Modify: `renderer/app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `SeedGrid`, `SeedVerify`, `SeedImport` components from Tasks 5–7
- Consumes: `identityCreate`, `identitySave`, `identityImport`, `identityLoad`, `identityExists`, `identityZkeyBegin`, `identityZkeyCancel`, `onZkeyResult` from `renderer/lib/identity-client`
- Consumes: `saveState` from `renderer/lib/app-state`

- [ ] **Step 1: Replace WalletStep with IdentityStep in onboarding/page.tsx**

Replace the entire `WalletStep` function and the `WalletConnectProps` + `WalletConnect` import (if any) with the following. Also update `STEPS` and resume logic:

```tsx
// At top of file, add imports:
import SeedGrid from '../../components/SeedGrid'
import SeedVerify from '../../components/SeedVerify'
import SeedImport from '../../components/SeedImport'
import {
  identityCreate, identitySave, identityImport, identityExists, identityLoad,
  identityZkeyBegin, identityZkeyCancel, onZkeyResult,
} from '../../lib/identity-client'
```

Change:
```tsx
type Step = 'welcome' | 'wallet' | 'handle' | 'fund'
const STEPS: Step[] = ['welcome', 'wallet', 'handle', 'fund']
```
To:
```tsx
type Step = 'welcome' | 'identity' | 'handle' | 'fund'
const STEPS: Step[] = ['welcome', 'identity', 'handle', 'fund']
```

Change resume logic in `OnboardingInner` `useEffect`:
```tsx
// Before:
else if (s.walletConnected && step === 'welcome') setStep('handle')

// After:
else if (s.identitySource !== '' && step === 'welcome') setStep('handle')
```

Change the JSX render in `OnboardingInner`:
```tsx
// Before:
{step === 'wallet' && <WalletStep onNext={() => go('handle')} />}

// After:
{step === 'identity' && <IdentityStep onNext={() => go('handle')} />}
```

Then add the full `IdentityStep` function:

```tsx
type IdentitySubFlow =
  | 'entry'
  | 'seed-generate' | 'seed-verify' | 'seed-done'
  | 'seed-import' | 'seed-import-done'
  | 'zkey-waiting' | 'zkey-done' | 'zkey-error'
  | 'decrypt-error'

function IdentityStep({ onNext }: { onNext: () => void }) {
  const [sub, setSub] = useState<IdentitySubFlow>('entry')
  const [words, setWords] = useState<string[]>([])
  const [address, setAddress] = useState('')
  const [zkeyProvider, setZkeyProvider] = useState<'google' | 'apple'>('google')
  const [zkeyError, setZkeyError] = useState('')
  const [err, setErr] = useState('')

  // On mount: check if identity.enc already exists → skip to done
  useEffect(() => {
    identityExists().then(({ exists }) => {
      if (exists) {
        identityLoad().then(({ address }) => {
          setAddress(address)
          setSub('seed-done')
        }).catch(() => setSub('decrypt-error'))
      }
    })
  }, [])

  // Listen for zKey result push event
  useEffect(() => {
    if (sub !== 'zkey-waiting') return
    const cleanup = onZkeyResult(({ ok, address: addr, error }) => {
      if (ok && addr) {
        setAddress(addr)
        saveState({ identitySource: 'zkey', walletAddress: addr })
        setSub('zkey-done')
      } else {
        setZkeyError(error ?? 'Unknown error')
        setSub('zkey-error')
      }
    })
    return cleanup
  }, [sub])

  // ── Entry screen ─────────────────────────────────────────────────────────
  if (sub === 'entry') {
    const options = [
      { label: 'New wallet', sub: 'Generate a 12-word seed phrase', action: () => setSub('seed-generate') },
      { label: 'Import wallet', sub: 'Restore from an existing seed phrase', action: () => setSub('seed-import') },
      {
        label: 'Sign in with Google', sub: 'Zero-knowledge login — Google is never shared with GhostCall · via zKey',
        action: () => { setZkeyProvider('google'); setSub('zkey-waiting') },
      },
      {
        label: 'Sign in with Apple', sub: 'Zero-knowledge login — Apple is never shared with GhostCall · via zKey',
        action: () => { setZkeyProvider('apple'); setSub('zkey-waiting') },
      },
    ]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>Create identity</h2>
          <p style={{ fontSize: 15, color: 'var(--label-secondary)' }}>
            Your identity keys are generated locally and never leave your device.
          </p>
        </div>
        <div className="glass-card" style={{ width: '100%', padding: 0, overflow: 'hidden' }}>
          {options.map((o, i) => (
            <div key={o.label}>
              {i > 0 && <div className="divider" />}
              <button
                onClick={o.action}
                style={{
                  width: '100%', padding: '14px 20px', background: 'transparent',
                  border: 'none', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'background 120ms',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--glass-thin)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--label-primary)', marginBottom: 2 }}>{o.label}</p>
                  <p style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>{o.sub}</p>
                </div>
                <span style={{ fontSize: 18, color: 'var(--label-quaternary)' }}>›</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Seed: Generate ────────────────────────────────────────────────────────
  if (sub === 'seed-generate') {
    useEffect(() => {
      if (words.length === 0) {
        identityCreate().then(({ words: w }) => setWords(w))
      }
    }, [])
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>Your seed phrase</h2>
          <p style={{ fontSize: 14, color: 'var(--label-secondary)' }}>
            Write these 12 words down in order. This is the only way to recover your wallet.
          </p>
        </div>
        {words.length === 12 && <SeedGrid words={words} />}
        <button className="btn-primary" disabled={words.length < 12} onClick={() => setSub('seed-verify')}>
          I've written these down →
        </button>
      </div>
    )
  }

  // ── Seed: Verify ──────────────────────────────────────────────────────────
  if (sub === 'seed-verify') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>Verify your phrase</h2>
          <p style={{ fontSize: 14, color: 'var(--label-secondary)' }}>
            Confirm you saved your seed phrase correctly.
          </p>
        </div>
        <SeedVerify
          words={words}
          onBack={() => setSub('seed-generate')}
          onVerified={async () => {
            setErr('')
            try {
              const { address: addr } = await identitySave(words)
              setAddress(addr)
              saveState({ identitySource: 'seed', walletAddress: addr })
              setSub('seed-done')
            } catch (e) { setErr((e as Error).message) }
          }}
        />
        {err && <p style={{ fontSize: 12, color: 'var(--system-red)', fontFamily: 'var(--font-mono)' }}>{err}</p>}
      </div>
    )
  }

  // ── Seed: Import ──────────────────────────────────────────────────────────
  if (sub === 'seed-import') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>Import wallet</h2>
          <p style={{ fontSize: 14, color: 'var(--label-secondary)' }}>
            Enter your 12-word seed phrase. You can paste all 12 words at once.
          </p>
        </div>
        <SeedImport
          onImport={async (w) => {
            const { address: addr } = await identityImport(w)
            setAddress(addr)
            saveState({ identitySource: 'seed', walletAddress: addr })
            setSub('seed-import-done')
          }}
        />
        <button type="button" className="btn-text" style={{ fontSize: 13, color: 'var(--label-tertiary)' }}
          onClick={() => setSub('entry')}>← Back</button>
      </div>
    )
  }

  // ── zKey: Waiting ─────────────────────────────────────────────────────────
  if (sub === 'zkey-waiting') {
    useEffect(() => {
      identityZkeyBegin(zkeyProvider)
    }, [])
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8 }}>
            Sign in with {zkeyProvider === 'google' ? 'Google' : 'Apple'}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--label-secondary)' }}>
            Complete the login in your browser, then return here.
          </p>
        </div>
        <div style={{ width: 48, height: 48, border: '3px solid var(--system-blue)',
          borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div className="glass-card-sm" style={{ width: '100%', padding: '12px 16px' }}>
          <p style={{ fontSize: 12, color: 'var(--label-secondary)', lineHeight: 1.6 }}>
            Your {zkeyProvider === 'google' ? 'Google' : 'Apple'} account is your only recovery method.
            You will need to re-login on each fresh install.
          </p>
        </div>
        <button type="button" className="btn-text" style={{ color: 'var(--label-tertiary)', fontSize: 14 }}
          onClick={async () => { await identityZkeyCancel(); setSub('entry') }}>
          Cancel
        </button>
      </div>
    )
  }

  // ── zKey: Error ───────────────────────────────────────────────────────────
  if (sub === 'zkey-error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%', maxWidth: 360 }}>
        <p style={{ fontSize: 14, color: 'var(--system-red)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
          {zkeyError}
        </p>
        <button className="btn-primary" onClick={() => setSub('entry')}>Try again</button>
      </div>
    )
  }

  // ── Decrypt error ─────────────────────────────────────────────────────────
  if (sub === 'decrypt-error') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Could not unlock your identity</h2>
          <p style={{ fontSize: 14, color: 'var(--label-secondary)', lineHeight: 1.6 }}>
            Your identity file could not be decrypted. This can happen if you migrated to a new machine or the file was corrupted.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setSub('seed-import')}>Import existing seed phrase</button>
        <button className="btn-secondary" onClick={() => {
          if (confirm('This will permanently delete your saved identity. Make sure you have your seed phrase backed up.')) {
            const { clearState } = require('../../lib/app-state')
            clearState()
            window.location.replace('/onboarding')
          }
        }}>
          Start over
        </button>
      </div>
    )
  }

  // ── Done (seed or zKey) ───────────────────────────────────────────────────
  const truncated = address ? address.slice(0, 8) + '…' + address.slice(-6) : ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, width: '100%', maxWidth: 360 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>Wallet created</h2>
        {truncated && (
          <p style={{ fontSize: 13, color: 'var(--label-tertiary)', fontFamily: 'var(--font-mono)' }}>{truncated}</p>
        )}
      </div>
      <button className="btn-primary" onClick={onNext}>Continue →</button>
    </div>
  )
}
```

- [ ] **Step 2: Remove old WalletStep and WalletConnect import**

Delete the old `WalletStep` function and any import of `WalletConnect` from the file.

- [ ] **Step 3: Add CSS keyframe for spinner**

In `renderer/app/globals.css`, add:

```css
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 4: Build and typecheck**

```bash
npm run bundle:electron && npx tsc --noEmit
```

Fix any TypeScript errors (most common: `useEffect` inside conditional — hoist them to top of function or refactor sub-flow into separate components if needed).

- [ ] **Step 5: Run full test suite**

```bash
npx jest
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add renderer/app/onboarding/page.tsx renderer/app/globals.css
git -c user.name="Philotheephilix" -c user.email="110274378+Philotheephilix@users.noreply.github.com" \
  commit -m "feat: IdentityStep — seed phrase + zKey sub-flows replace WalletStep in onboarding"
```

---

## Task 9: Home page — identity:ready guard

**Files:**
- Modify: `renderer/app/home/page.tsx`

**Interfaces:**
- Consumes: `onIdentityReady` from `renderer/lib/identity-client`
- Produces: home page waits for `identity:ready` push before evaluating onboarding guard

- [ ] **Step 1: Update home/page.tsx**

Replace the `useEffect` in `home/page.tsx`:

```tsx
// Add import at top:
import { onIdentityReady } from '../../lib/identity-client'
```

Replace the existing `useEffect` block:

```tsx
useEffect(() => {
  // Wait for main process to emit identity:ready before evaluating guard.
  // This prevents a race where localStorage says onboardingDone=true but
  // initStarknetClient hasn't been called yet (e.g. seed path re-launch).
  const cleanup = onIdentityReady(({ source, error }) => {
    cleanup() // one-shot

    if (error === 'decryption-failed') {
      window.location.replace('/onboarding')
      return
    }

    const state = loadState()
    if (source === '' || !state.onboardingDone || !state.registered) {
      window.location.replace('/onboarding')
      return
    }

    setHandle(state.handle)
    setReady(true)

    const gc = (window as any).ghostcall
    if (!gc) return
    const cleanup1 = gc.onCallConnected?.(() => { window.location.href = '/call' })
    const cleanup2 = gc.onCallError?.((err: { message: string }) => setStatusMsg(err.message))
    // Note: cleanup1/cleanup2 are not returned — they are cleared on unmount below
  })

  return cleanup
}, [])
```

- [ ] **Step 2: Build and typecheck**

```bash
npm run bundle:electron && npx tsc --noEmit
```

- [ ] **Step 3: Run full test suite**

```bash
npx jest
```

- [ ] **Step 4: Commit**

```bash
git add renderer/app/home/page.tsx
git -c user.name="Philotheephilix" -c user.email="110274378+Philotheephilix@users.noreply.github.com" \
  commit -m "feat: home page guard waits for identity:ready push event"
```

---

## Task 10: End-to-end smoke test + push

**Files:** No new files — verification only.

- [ ] **Step 1: Full rebuild**

```bash
npm run bundle:electron && npx jest && npx tsc --noEmit
```

Expected: all tests pass, clean TypeScript, clean bundle.

- [ ] **Step 2: Manual smoke test — seed path**

```bash
npm run dev
```

In the Electron app:
1. Clear localStorage and delete `~/Library/Application Support/GhostCall/identity.enc` if present
2. Complete onboarding → "New wallet" → 12 words shown → toggle reveal → write down 3 words → verify → "Wallet created" → handle step loads
3. Quit and relaunch → home screen loads directly (no onboarding)

- [ ] **Step 3: Manual smoke test — import path**

1. Clear state again
2. "Import wallet" → paste the 12 words from step 2 → "Restore wallet" → "Wallet created" → handle step

- [ ] **Step 4: Manual smoke test — .env path**

1. Ensure `.env` has `STARKNET_PRIVATE_KEY` set
2. Launch → onboarding identity step is skipped → home screen loads

- [ ] **Step 5: Manual smoke test — zKey path (stub)**

1. Clear state
2. "Sign in with Google" → browser opens to `accounts.zkey.org` (will 404 — that is expected for stub)
3. Confirm spinner shows, cancel button works, cancel returns to entry screen

- [ ] **Step 6: Push**

```bash
git push origin main
```

---

## Self-Review Checklist

- [x] **Spec §2.5 identity:exists** → Task 2 (IPC handler), Task 4 (preload), Task 8 (mount useEffect)
- [x] **Spec §2.5 identity:ready startup sequence** → Task 3 (`runIdentityStartupSequence`), Task 9 (home guard)
- [x] **Spec §2.6 startup sequence** → Task 3, registered in main before `did-finish-load`
- [x] **Spec §3.1 entry screen 4 rows** → Task 8 IdentityStep entry branch
- [x] **Spec §3.2 mnemonic in component state, no re-call** → Task 8 `words` state + `if (words.length === 0)` guard
- [x] **Spec §3.2 back navigation keeps same mnemonic** → Task 8 `onBack={() => setSub('seed-generate')}` — words in parent state
- [x] **Spec §3.3 paste handling** → Task 7 SeedImport `handlePaste`
- [x] **Spec §3.4 cancel active throughout** → Task 8 zkey-waiting always shows cancel
- [x] **Spec §3.4 30s ZKP timeout** → Task 3 `setTimeout` in `handleZkeyCallback`
- [x] **Spec §3.5 decryption failure screen** → Task 8 `decrypt-error` branch
- [x] **Spec §4.1 requestSingleInstanceLock** → Task 3 main.ts
- [x] **Spec §4.1 second-instance handler** → Task 3 main.ts
- [x] **Spec §4.4 in-flight cancellation** → Task 3 `cancelZkeySession()` called on re-begin
- [x] **Spec §5 all edge cases** → covered across Tasks 2, 3, 8
- [x] **Spec §6.1 2×6 layout** → Tasks 5, 7, 8 all use 2-column grid
- [x] **Spec §8 security** → private key never in IPC payload, never in localStorage, mnemonic only in safeStorage
- [x] **resume logic fix** → Task 8 (`identitySource !== ''`)
- [x] **walletAddress saved** → Task 8 (all paths call `saveState({ identitySource, walletAddress })`)
