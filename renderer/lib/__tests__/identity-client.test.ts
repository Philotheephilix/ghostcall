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

// jsdom provides window — assign ghostcall directly on the existing object
;(window as any).ghostcall = {
  identityExists: mockIdentityExists,
  identityCreate: mockIdentityCreate,
  identitySave: mockIdentitySave,
  identityImport: mockIdentityImport,
  identityLoad: mockIdentityLoad,
  identityZkeyBegin: mockIdentityZkeyBegin,
  identityZkeyCancel: mockIdentityZkeyCancel,
  onIdentityReady: mockOnIdentityReady,
  onZkeyResult: mockOnZkeyResult,
}

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

test('identityLoad delegates to ghostcall', async () => {
  const result = await identityLoad()
  expect(mockIdentityLoad).toHaveBeenCalledTimes(1)
  expect(result).toEqual({ address: '0xghi', source: 'seed' })
})

test('identityZkeyCancel delegates to ghostcall', async () => {
  await identityZkeyCancel()
  expect(mockIdentityZkeyCancel).toHaveBeenCalledTimes(1)
})

test('onZkeyResult returns cleanup fn', () => {
  const cb = jest.fn()
  const cleanup = onZkeyResult(cb)
  expect(typeof cleanup).toBe('function')
})
