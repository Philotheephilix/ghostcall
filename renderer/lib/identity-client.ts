'use client'

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
  return gc().onIdentityReady(cb)
}

export function onZkeyResult(
  cb: (data: { ok: boolean; address?: string; error?: string }) => void
): () => void {
  return gc().onZkeyResult(cb)
}

export async function identityDelete(): Promise<void> {
  return gc().identityDelete()
}
