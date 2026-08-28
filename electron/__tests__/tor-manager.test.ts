import { TorManager } from '../tor-manager'

describe('TorManager', () => {
  test('1. detects when tor is not running and rejects with clear error', async () => {
    const tm = new TorManager()
    // Override tor binary to a non-existent one AND prevent attach-to-existing-tor
    // by temporarily pointing to an unused port via env (test isolation)
    process.env.TOR_BINARY_PATH = '/nonexistent/tor-binary-that-does-not-exist'
    // Patch _checkAlreadyRunning to always return false for this test
    // (avoids false pass when Tor happens to be running on the test machine)
    ;(tm as any)._checkAlreadyRunning = async () => false

    await expect(tm.start()).rejects.toThrow()

    delete process.env.TOR_BINARY_PATH
  }, 5_000)

  test('2. getSocksProxy returns correct default values', () => {
    const tm = new TorManager()
    const proxy = tm.getSocksProxy()
    expect(proxy.host).toBe('127.0.0.1')
    expect(proxy.port).toBe(9050)
  })

  test('3. isRunning returns false before start', () => {
    const tm = new TorManager()
    expect(tm.isRunning()).toBe(false)
  })

  test('4. addOnion rejects when Tor is not running', async () => {
    const tm = new TorManager()
    await expect(tm.addOnion()).rejects.toThrow('not running')
  })
})
