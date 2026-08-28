'use client'
import { useState, useEffect } from 'react'

interface TorStatus {
  running: boolean
  error?: string
}

export function useTorStatus(): TorStatus | null {
  const [status, setStatus] = useState<TorStatus | null>(null)

  useEffect(() => {
    const gc = (window as unknown as { ghostcall?: {
      getTorStatus?: () => Promise<TorStatus>
      onTorStatus?: (cb: (s: TorStatus) => void) => (() => void)
    } }).ghostcall
    if (!gc) return
    gc.getTorStatus?.().then(setStatus)
    const cleanup = gc.onTorStatus?.(setStatus)
    return cleanup ?? undefined
  }, [])

  return status
}
