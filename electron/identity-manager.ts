import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { app, ipcMain, safeStorage, shell, BrowserWindow } from 'electron'
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { ProjectivePoint } from '@scure/starknet'
import { initStarknetClient, getAccount } from '../renderer/lib/starknet-client'
import type { Account } from 'starknet'

// ── zKey pending callback (macOS open-url can fire before win is ready) ───
let _pendingCallbackUrl: string | null = null

// ── zKey session state ─────────────────────────────────────────────────────

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
  // Session keypair (ephemeral — held in memory for this OAuth session only; never logged or sent to renderer)
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

  // TODO: replace with actual zKey endpoint — authorization endpoint
  const authUrl = new URL('https://accounts.zkey.org/oauth/authorize')
  authUrl.searchParams.set('client_id', 'ghostcall') // TODO: replace with actual zKey endpoint — register client_id
  authUrl.searchParams.set('redirect_uri', 'ghostcall://zkey-callback')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid')
  authUrl.searchParams.set('state', zkeySession.state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  return { authUrl: authUrl.toString() }
}

export async function handleZkeyCallback(url: string): Promise<void> {
  if (!zkeySession.win) {
    // macOS open-url can fire before registerIdentityIpcHandlers sets zkeySession.win.
    // Store for replay once runIdentityStartupSequence has a live win reference.
    _pendingCallbackUrl = url
    return
  }
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

    // TODO: replace with actual zKey endpoint — token exchange
    const tokenRes = await fetch('https://api.zkey.org/oauth/token', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: zkeySession.codeVerifier,
        redirect_uri: 'ghostcall://zkey-callback',
        client_id: 'ghostcall', // TODO: replace with actual zKey endpoint — actual registered client_id
      }),
    })
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`)
    const { id_token } = await tokenRes.json() as { id_token: string }

    // TODO: replace with actual zKey endpoint — salt request
    const saltRes = await fetch('https://api.zkey.org/salt', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token }),
    })
    if (!saltRes.ok) throw new Error(`Salt request failed: ${saltRes.status}`)
    const { salt } = await saltRes.json() as { salt: string }

    // Derive the Stark curve public key from the ephemeral session private key.
    // The private key scalar MUST NOT leave the process — only the x-coordinate of the public point is sent.
    const sessionPrivBig = BigInt('0x' + zkeySession.sessionPrivKeyHex)
    const sessionPubPoint = ProjectivePoint.BASE.multiply(sessionPrivBig)
    const sessionPubKeyHex = sessionPubPoint.x.toString(16).padStart(64, '0')

    // TODO: replace with actual zKey endpoint — ZKP prove
    const proveRes = await fetch('https://api.zkey.org/zkp/prove', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token, salt, session_pub_key: '0x' + sessionPubKeyHex }),
    })
    if (!proveRes.ok) throw new Error(`ZKP proof failed: ${proveRes.status}`)

    // TODO: parse sub/aud/iss from id_token and compute H(sub,aud,iss,salt) per zKey spec
    const address = process.env.STARKNET_ACCOUNT_ADDRESS ?? '0xzkey_placeholder'
    initStarknetClient(rpcUrl, address, '0x' + zkeySession.sessionPrivKeyHex)
    notifyAccountReady()

    if (zkeySession.timeoutId) clearTimeout(zkeySession.timeoutId)
    win.webContents.send('identity:zkey-result', { ok: true, address })
    cancelZkeySession()
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') return // cancelled — do not emit an error event
    const msg = e instanceof Error ? e.message : String(e)
    zkeySession.win?.webContents.send('identity:zkey-result', { ok: false, error: msg })
    cancelZkeySession()
  }
}

// ── Session account setter (called by main.ts after runIdentityStartupSequence) ──
// main.ts owns SessionState; identity-manager calls back via this setter so
// sessionState.account stays populated for strk20:pay.
let _onAccountReady: ((account: Account) => void) | null = null

export function onAccountReady(cb: (account: Account) => void): void {
  _onAccountReady = cb
}

function notifyAccountReady(): void {
  try {
    _onAccountReady?.(getAccount())
  } catch {
    // getAccount throws if initStarknetClient was not called — ignore silently
  }
}

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

// ── Address derivation ─────────────────────────────────────────────────────

// TODO: replace with proper Starknet account address derivation when
// account deployment is implemented.
function deriveAddress(_privKeyHex: string): string {
  if (!process.env.STARKNET_ACCOUNT_ADDRESS) {
    throw new Error('STARKNET_ACCOUNT_ADDRESS is required — set it in .env')
  }
  return process.env.STARKNET_ACCOUNT_ADDRESS
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

  // 1. .env silent path — private key set directly in environment
  if (process.env.STARKNET_PRIVATE_KEY && process.env.STARKNET_ACCOUNT_ADDRESS) {
    initStarknetClient(rpcUrl, process.env.STARKNET_ACCOUNT_ADDRESS, process.env.STARKNET_PRIVATE_KEY)
    notifyAccountReady()
    win.webContents.send('identity:ready', { source: 'env', address: process.env.STARKNET_ACCOUNT_ADDRESS })
    return
  }

  // 2. Seed path — identity.enc exists on disk
  if (identityFileExists()) {
    try {
      const mnemonic = loadMnemonic()
      const privKey = derivePrivKeyFromMnemonic(mnemonic)
      const privKeyHex = privKey.toString(16).padStart(64, '0')
      const address = deriveAddress(privKeyHex)
      initStarknetClient(rpcUrl, address, '0x' + privKeyHex)
      notifyAccountReady()
      win.webContents.send('identity:ready', { source: 'seed', address })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const errorType = msg.includes('STARKNET_ACCOUNT_ADDRESS') ? 'missing-env' : 'decryption-failed'
      win.webContents.send('identity:ready', { source: '', error: errorType })
    }
    return
  }

  // 3. No identity found — renderer must trigger onboarding
  win.webContents.send('identity:ready', { source: '', address: '' })
}

/** Replay any OAuth callback URL that arrived before zkeySession.win was set (macOS open-url race). */
function replayPendingCallback(): void {
  if (_pendingCallbackUrl) {
    const url = _pendingCallbackUrl
    _pendingCallbackUrl = null
    handleZkeyCallback(url)
  }
}

// ── IPC handlers ───────────────────────────────────────────────────────────

let _identityHandlersRegistered = false
// Updated on every call so Task 3's zKey handlers always have a live reference
let _win: BrowserWindow | null = null

export function registerIdentityIpcHandlers(win: BrowserWindow): void {
  // Always update the win reference so it stays current across calls
  _win = win
  zkeySession.win = win

  if (_identityHandlersRegistered) return
  _identityHandlersRegistered = true

  ipcMain.handle('identity:exists', () => ({ exists: identityFileExists() }))

  ipcMain.handle('identity:create', () => {
    const mnemonic = generateMnemonic(wordlist)
    return { words: mnemonicToWords(mnemonic) }
  })

  ipcMain.handle('identity:save', (_e, { words }: { words: string[] }) => {
    const mnemonic = wordsToMnemonic(words)
    // derivePrivKeyFromMnemonic validates and throws uniformly on bad input
    const privKey = derivePrivKeyFromMnemonic(mnemonic)
    const privKeyHex = privKey.toString(16).padStart(64, '0')
    const address = deriveAddress(privKeyHex)
    const rpcUrl = process.env.STARKNET_RPC_URL ?? ''
    initStarknetClient(rpcUrl, address, '0x' + privKeyHex)
    notifyAccountReady()
    saveMnemonic(mnemonic)
    return { address }
  })

  ipcMain.handle('identity:import', (_e, { words }: { words: string[] }) => {
    const mnemonic = wordsToMnemonic(words)
    // derivePrivKeyFromMnemonic validates and throws uniformly on bad input
    const privKey = derivePrivKeyFromMnemonic(mnemonic)
    const privKeyHex = privKey.toString(16).padStart(64, '0')
    const address = deriveAddress(privKeyHex)
    const rpcUrl = process.env.STARKNET_RPC_URL ?? ''
    initStarknetClient(rpcUrl, address, '0x' + privKeyHex)
    notifyAccountReady()
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

  ipcMain.handle('identity:zkey-begin', async (_e, { provider: _provider }: { provider: 'google' | 'apple' }) => {
    // Cancel any in-flight session first
    if (zkeySession.inFlight) cancelZkeySession()
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

  // Replay any OAuth callback URL that arrived before zkeySession.win was set (macOS open-url race).
  // Must run after zkeySession.win is assigned above — guaranteed at this point.
  replayPendingCallback()
}
