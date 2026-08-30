import path from 'path'
import fs from 'fs'
import { app, ipcMain, safeStorage, BrowserWindow } from 'electron'
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { initStarknetClient } from '../renderer/lib/starknet-client'

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
function deriveAddress(privKeyHex: string): string {
  // In dev/test mode, use the env address directly.
  // In production the address comes from the deployed account contract.
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

  // 1. .env silent path — private key set directly in environment
  if (process.env.STARKNET_PRIVATE_KEY && process.env.STARKNET_ACCOUNT_ADDRESS) {
    initStarknetClient(rpcUrl, process.env.STARKNET_ACCOUNT_ADDRESS, process.env.STARKNET_PRIVATE_KEY)
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
      win.webContents.send('identity:ready', { source: 'seed', address })
    } catch {
      win.webContents.send('identity:ready', { source: '', error: 'decryption-failed' })
    }
    return
  }

  // 3. No identity found — renderer must trigger onboarding
  win.webContents.send('identity:ready', { source: '', address: '' })
}

// ── IPC handlers ───────────────────────────────────────────────────────────

let _identityHandlersRegistered = false

export function registerIdentityIpcHandlers(win: BrowserWindow): void {
  if (_identityHandlersRegistered) return
  _identityHandlersRegistered = true

  // win is accepted for Task 3 compatibility (zKey OAuth path needs it)
  void win

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

  // zKey handlers registered separately in Task 3
}
