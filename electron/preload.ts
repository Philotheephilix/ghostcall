import { contextBridge, ipcRenderer } from 'electron'

// Helper: adds a one-use listener and returns a cleanup fn to remove it.
// Use for events that need cleanup (avoids stacking listeners on re-mount).
function onIpc(channel: string, cb: (...args: unknown[]) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('ghostcall', {
  // Tor
  getTorStatus: () => ipcRenderer.invoke('tor:status'),
  onTorStatus: (cb: (status: { running: boolean; error?: string }) => void) =>
    onIpc('tor:status-update', cb as (...args: unknown[]) => void),

  // Identity
  registerStealth: (handle: string) =>
    ipcRenderer.invoke('starknet:register', { handle }),
  lookupStealth: (handle: string) =>
    ipcRenderer.invoke('starknet:lookup', { handle }),

  // Calling
  goOnline: () => ipcRenderer.invoke('call:go-online'),
  initiateCall: (onionAddr: string) =>
    ipcRenderer.invoke('call:initiate', { onionAddr }),
  hangUp: () => ipcRenderer.invoke('call:hang-up'),
  // Pull the active-call snapshot — used on mount to recover a missed
  // 'call:connected' push (see call-orchestrator activeCall).
  getCallState: () => ipcRenderer.invoke('call:current-state'),
  onCallConnected: (cb: (info: { direction: string; onionAddr?: string }) => void) =>
    onIpc('call:connected', cb as (...args: unknown[]) => void),
  onCallError: (cb: (err: { message: string }) => void) =>
    onIpc('call:error', cb as (...args: unknown[]) => void),
  onCallEnded: (cb: (info: { callId: string; peer: string; duration: number }) => void) =>
    onIpc('call:ended', cb as (...args: unknown[]) => void),

  // Audio
  sendAudioFrame: (frame: Buffer) => ipcRenderer.send('audio:outbound-frame', frame),
  onInboundFrame: (cb: (frame: ArrayBuffer) => void) =>
    onIpc('audio:inbound-frame', (frame: unknown) => {
      // Electron IPC delivers a real ArrayBuffer (or a view) — normalize to a clean ArrayBuffer
      if (frame instanceof ArrayBuffer) {
        cb(frame)
      } else if (ArrayBuffer.isView(frame)) {
        const v = frame as ArrayBufferView
        cb(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer)
      } else {
        cb(frame as ArrayBuffer)
      }
    }),

  // Signaling
  publishSignal: (payload: string) => ipcRenderer.invoke('nostr:publish', { payload }),
  subscribeSignals: (myPubHex: string) => ipcRenderer.invoke('nostr:subscribe', { myPubHex }),
  unsubscribeSignals: () => ipcRenderer.invoke('nostr:unsubscribe'),
  onIncomingSignal: (cb: (data: string) => void) =>
    onIpc('nostr:incoming', cb as (...args: unknown[]) => void),
  // Build a gift-wrapped call offer for the callee (main-side crypto over ws/Buffer).
  buildCallOffer: (
    payload: { onionAddr: string; callId: string; callerNoisePubkey: string },
    callee: { nostrPubkey: string; pkVx: string; pkVy: string },
  ) => ipcRenderer.invoke('nostr:build-offer', { payload, callee }),
  // Decrypt an incoming offer with our own Nostr SK; resolves to the payload or null.
  parseCallOffer: (raw: string) => ipcRenderer.invoke('nostr:parse-offer', { raw }),
  // Our full 64-hex Nostr pubkey — used as the subscribe filter.
  getMyNostrPubkey: () => ipcRenderer.invoke('nostr:my-pubkey'),

  // Payment
  settlePayment: (amount: string) => ipcRenderer.invoke('strk20:pay', { amount }),
  transferStrk: (args: { recipient: string; amount: string }) =>
    ipcRenderer.invoke('strk20:transfer', args),

  // Clipboard (native — navigator.clipboard is blocked in the file:// context)
  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', { text }),

  // Shell — open URLs in the system browser (target="_blank" stays in Electron)
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', { url }),

  // Call log
  commitCall: (callId: string) => ipcRenderer.invoke('starknet:commitCall', { callId }),

  // File transfer
  pickFile: () => ipcRenderer.invoke('file:pick'),
  sendFile: (filePath: string) => ipcRenderer.invoke('file:send', { filePath }),
  fileGoOnline: (filePath: string, transferId: string) => ipcRenderer.invoke('file:go-online', { filePath, transferId }),
  fileConnect: (onionAddr: string) => ipcRenderer.invoke('file:connect', { onionAddr }),
  fileHangUp: () => ipcRenderer.invoke('file:hang-up'),
  acceptFileTransfer: (transferId: string) => ipcRenderer.invoke('file:accept', { transferId }),
  rejectFileTransfer: (transferId: string) => ipcRenderer.invoke('file:reject', { transferId }),
  cancelFileTransfer: () => ipcRenderer.invoke('file:cancel'),
  onIncomingFile: (cb: (data: { handle: string; name: string; size: number; transferId: string; onionAddr: string }) => void) =>
    onIpc('file:incoming', cb as (...args: unknown[]) => void),
  onFileProgress: (cb: (data: { transferId: string; bytesSent?: number; bytesReceived?: number; total: number }) => void) =>
    onIpc('file:progress', cb as (...args: unknown[]) => void),
  onFileDone: (cb: (data: { transferId: string; savedPath: string }) => void) =>
    onIpc('file:done', cb as (...args: unknown[]) => void),
  onFileError: (cb: (data: { transferId: string; message: string }) => void) =>
    onIpc('file:error', cb as (...args: unknown[]) => void),

  // Identity
  identityExists: () => ipcRenderer.invoke('identity:exists'),
  identityCreate: () => ipcRenderer.invoke('identity:create'),
  identitySave: (words: string[]) => ipcRenderer.invoke('identity:save', { words }),
  identityImport: (words: string[]) => ipcRenderer.invoke('identity:import', { words }),
  identityLoad: () => ipcRenderer.invoke('identity:load'),
  identityZkeyBegin: (provider: 'google' | 'apple') => ipcRenderer.invoke('identity:zkey-begin', { provider }),
  identityZkeyCancel: () => ipcRenderer.invoke('identity:zkey-cancel'),
  identityDelete: () => ipcRenderer.invoke('identity:delete'),
  onIdentityReady: (cb: (data: { source: string; address?: string; error?: string }) => void) =>
    onIpc('identity:ready', cb as (...args: unknown[]) => void),
  onZkeyResult: (cb: (data: { ok: boolean; address?: string; error?: string }) => void) =>
    onIpc('identity:zkey-result', cb as (...args: unknown[]) => void),
})
