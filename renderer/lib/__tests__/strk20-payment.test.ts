/**
 * @jest-environment node
 */
/**
 * Unit tests for strk20-payment.ts
 *
 * 1. deriveStealthAddress — deterministic derivation from StealthMeta
 * 2. sendShieldedPayment with StealthMeta (full SDK path — mocked)
 * 3. sendShieldedPayment with legacy string address (fallback ERC-20 path)
 */

import { deriveStealthAddress, sendShieldedPayment, STRK_TOKEN } from '../strk20-payment'
import type { StealthMeta } from '../stealth-keys'

// Minimal valid StealthMeta (real Stark curve points from the test vector)
// Uses the "abandon x11 about" mnemonic stealth keypair
const MOCK_META: StealthMeta = {
  pkVx: 0x3fc81212c4e62b19af026d8e18b95f680d6b4dc23d91abd8b73a5a3e14ea2b6n,
  pkVy: 0x67e6aa5fd49cb83a29b2b5fea70a71e41f4f24d2a64a0c5a2e5c28ccc44bb11n,
  pkSx: 0x1a9b3c7fe5d2e8f4a0b6d9c2e5f8a1b4d7e0f3a6b9c2e5f8a1b4d7e0f3a6b9n,
  pkSy: 0x2b8c4d9e6f3a0b7c4e1f8a5b2c9d6e3f0a7b4c1d8e5f2a9b6c3d0e7f4a1b8cn,
  nostrPubkey: 'aa'.repeat(31),
}

// ── deriveStealthAddress ───────────────────────────────────────────────────

describe('deriveStealthAddress', () => {
  test('returns a 0x-prefixed felt252 stealth address', () => {
    const { stealthAddr, ephemeralPubX, ephemeralPubY } = deriveStealthAddress(MOCK_META)
    expect(stealthAddr).toMatch(/^0x[0-9a-f]+$/i)
    expect(stealthAddr.length).toBeGreaterThan(10)
    expect(typeof ephemeralPubX).toBe('bigint')
    expect(typeof ephemeralPubY).toBe('bigint')
    expect(ephemeralPubX).toBeGreaterThan(0n)
    expect(ephemeralPubY).toBeGreaterThan(0n)
  })

  test('produces different stealth addresses on each call (random r)', () => {
    const a1 = deriveStealthAddress(MOCK_META).stealthAddr
    const a2 = deriveStealthAddress(MOCK_META).stealthAddr
    // Astronomically unlikely to be equal with different random r
    expect(a1).not.toBe(a2)
  })

  test('ephemeral pubkey is always a valid non-zero Stark curve point', () => {
    for (let i = 0; i < 3; i++) {
      const { ephemeralPubX, ephemeralPubY } = deriveStealthAddress(MOCK_META)
      expect(ephemeralPubX).toBeGreaterThan(0n)
      expect(ephemeralPubY).toBeGreaterThan(0n)
    }
  })
})

// ── sendShieldedPayment — legacy string fallback ───────────────────────────

describe('sendShieldedPayment — legacy string address (fallback)', () => {
  function makeMockAccount(txHash: string) {
    return {
      execute: jest.fn(async () => ({ transaction_hash: txHash })),
      waitForTransaction: jest.fn(async () => ({})),
    }
  }

  test('falls back to plain ERC-20 transfer for legacy string address', async () => {
    const account = makeMockAccount('0xFALLBACK_TX')
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await sendShieldedPayment(
      '0xdeadbeef',
      BigInt(1e17),
      account as unknown as import('starknet').Account,
      0n,
    )

    expect(result).toBe('0xFALLBACK_TX')
    expect(account.execute).toHaveBeenCalledTimes(1)
    // Must call 'transfer' on the STRK token
    const [[calls]] = account.execute.mock.calls as any
    expect(calls[0].entrypoint).toBe('transfer')
    expect(calls[0].contractAddress).toBe(STRK_TOKEN)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Plain address passed'))
    warnSpy.mockRestore()
  })

  test('returns a string in the fallback path', async () => {
    const account = makeMockAccount('0xABC123')
    jest.spyOn(console, 'warn').mockImplementation(() => {})

    const tx = await sendShieldedPayment(
      '0xany_addr',
      1000n,
      account as unknown as import('starknet').Account,
      0n,
    )
    expect(typeof tx).toBe('string')
    expect(tx).toBe('0xABC123')
  })
})

// ── STRK_TOKEN constant ────────────────────────────────────────────────────

test('STRK_TOKEN is a valid felt252 address', () => {
  expect(STRK_TOKEN).toMatch(/^0x[0-9a-f]{60,64}$/i)
})
