/**
 * @jest-environment node
 */
import { deriveStealthKeypair, deriveHandleHash, deriveSessionKey } from '../stealth-keys'

describe('deriveStealthKeypair', () => {
  const sig = { r: 0xdeadbeefn, s: 0xcafebaben }

  test('produces valid Stark curve points (x,y > 0)', () => {
    const kp = deriveStealthKeypair(sig)
    expect(kp.skV).toBeGreaterThan(0n)
    expect(kp.skS).toBeGreaterThan(0n)
    expect(kp.pkV.x).toBeGreaterThan(0n)
    expect(kp.pkV.y).toBeGreaterThan(0n)
    expect(kp.pkS.x).toBeGreaterThan(0n)
    expect(kp.pkS.y).toBeGreaterThan(0n)
  })

  test('is deterministic — same sig produces same keys', () => {
    const kp1 = deriveStealthKeypair(sig)
    const kp2 = deriveStealthKeypair(sig)
    expect(kp2.skV).toBe(kp1.skV)
    expect(kp2.skS).toBe(kp1.skS)
    expect(kp2.pkV.x).toBe(kp1.pkV.x)
    expect(kp2.pkV.y).toBe(kp1.pkV.y)
    expect(kp2.pkS.x).toBe(kp1.pkS.x)
    expect(kp2.pkS.y).toBe(kp1.pkS.y)
  })

  test('different sigs produce different keys', () => {
    const kp1 = deriveStealthKeypair(sig)
    const kp2 = deriveStealthKeypair({ r: 0x1234n, s: 0x5678n })
    expect(kp2.skV).not.toBe(kp1.skV)
    expect(kp2.skS).not.toBe(kp1.skS)
  })

  test('skV and skS are different keys', () => {
    const kp = deriveStealthKeypair(sig)
    expect(kp.skV).not.toBe(kp.skS)
    expect(kp.pkV.x).not.toBe(kp.pkS.x)
  })
})

describe('deriveHandleHash', () => {
  test('is deterministic', () => {
    const h1 = deriveHandleHash('alice')
    const h2 = deriveHandleHash('alice')
    expect(h1).toBe(h2)
  })

  test('different handles produce different hashes', () => {
    expect(deriveHandleHash('alice')).not.toBe(deriveHandleHash('bob'))
  })

  test('result fits in felt252 range (< 2^251)', () => {
    const hash = deriveHandleHash('alice')
    expect(hash).toBeGreaterThan(0n)
    expect(hash).toBeLessThan(1n << 251n)
  })

  test('is case-insensitive (lowercased)', () => {
    expect(deriveHandleHash('Alice')).toBe(deriveHandleHash('alice'))
    expect(deriveHandleHash('GHOSTCALL')).toBe(deriveHandleHash('ghostcall'))
  })

  test('trims whitespace', () => {
    expect(deriveHandleHash('  alice  ')).toBe(deriveHandleHash('alice'))
  })
})

describe('deriveSessionKey', () => {
  const sigA = { r: 0xaaaa1111n, s: 0xbbbb2222n }
  const sigB = { r: 0xcccc3333n, s: 0xdddd4444n }

  test('ECDH commutativity: deriveSessionKey(skA, pkB) === deriveSessionKey(skB, pkA)', () => {
    const kpA = deriveStealthKeypair(sigA)
    const kpB = deriveStealthKeypair(sigB)

    // A uses their sk, B's viewing pubkey
    const sessionA = deriveSessionKey(kpA.skV, { x: kpB.pkV.x, y: kpB.pkV.y })
    // B uses their sk, A's viewing pubkey
    const sessionB = deriveSessionKey(kpB.skV, { x: kpA.pkV.x, y: kpA.pkV.y })

    expect(Buffer.from(sessionA).toString('hex')).toBe(
      Buffer.from(sessionB).toString('hex')
    )
  })

  test('produces 32-byte key', () => {
    const kpA = deriveStealthKeypair(sigA)
    const kpB = deriveStealthKeypair(sigB)
    const session = deriveSessionKey(kpA.skV, { x: kpB.pkV.x, y: kpB.pkV.y })
    expect(session.length).toBe(32)
  })

  test('different keys produce different sessions', () => {
    const kpA = deriveStealthKeypair(sigA)
    const kpB = deriveStealthKeypair(sigB)
    const sigC = { r: 0xeeee5555n, s: 0xffff6666n }
    const kpC = deriveStealthKeypair(sigC)

    const sessionAB = deriveSessionKey(kpA.skV, { x: kpB.pkV.x, y: kpB.pkV.y })
    const sessionAC = deriveSessionKey(kpA.skV, { x: kpC.pkV.x, y: kpC.pkV.y })

    expect(Buffer.from(sessionAB).toString('hex')).not.toBe(
      Buffer.from(sessionAC).toString('hex')
    )
  })
})
