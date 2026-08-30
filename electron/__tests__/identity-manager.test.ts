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
