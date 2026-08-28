'use client'

import { useState } from 'react'

interface WalletConnectProps {
  onConnected: (addr: string) => void
}

/**
 * Minimal wallet connect button.
 * Uses window.starknet if available (Argent / Braavos extension),
 * otherwise marks connected in dev mode so the UI remains navigable.
 */
export default function WalletConnect({ onConnected }: WalletConnectProps) {
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const starknet = (window as Window & { starknet?: { enable?: () => Promise<void>; selectedAddress?: string } }).starknet
      if (starknet?.enable) {
        await starknet.enable()
        const addr = starknet.selectedAddress ?? '0xdev'
        setConnected(true)
        onConnected(addr)
      } else {
        // Dev mode — no wallet extension
        const addr = '0xdev_mode_no_extension'
        setConnected(true)
        onConnected(addr)
      }
    } catch (e) {
      console.error('[WalletConnect] error:', e)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <button
      onClick={handleConnect}
      disabled={connecting || connected}
      className="btn-primary"
      style={{ width: '100%' }}
    >
      {connected ? 'Wallet connected' : connecting ? 'Connecting…' : 'Connect wallet'}
    </button>
  )
}
