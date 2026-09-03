'use client'

let _cachedIdentityReady: { source: string; address?: string; error?: string } | null = null

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
  if (_cachedIdentityReady) {
    const cached = _cachedIdentityReady
    const id = setTimeout(() => cb(cached), 0)
    return () => clearTimeout(id)
  }
  if (!gc()?.onIdentityReady) return () => {}
  return gc().onIdentityReady((data: { source: string; address?: string; error?: string }) => {
    // Only cache a resolved identity (non-empty source: env | seed | zkey). A
    // source: '' event is the transient "no identity yet" state — caching it
    // would make a later onIdentityReady caller (e.g. Settings) replay the empty
    // value and wrongly redirect to onboarding even after an identity loads.
    if (data.source) _cachedIdentityReady = data
    cb(data)
  })
}

export function onZkeyResult(
  cb: (data: { ok: boolean; address?: string; error?: string }) => void
): () => void {
  return gc().onZkeyResult(cb)
}

export async function identityDelete(): Promise<void> {
  // Clear the module-level cache so the next onIdentityReady call registers a
  // live listener rather than replaying the old identity's stale cached event.
  // Without this, re-onboarding in the same renderer session would receive the
  // old source/address instead of the newly-created identity:ready event.
  _cachedIdentityReady = null
  return gc().identityDelete()
}
