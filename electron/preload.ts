import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ghostcall', {
  // Tor
  getTorStatus: () => ipcRenderer.invoke('tor:status'),
  onTorStatus: (cb: (status: { running: boolean; error?: string }) => void) =>
    ipcRenderer.on('tor:status-update', (_e, status) => cb(status)),

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
  onCallConnected: (cb: (info: { direction: string; onionAddr?: string }) => void) =>
    ipcRenderer.on('call:connected', (_e, info) => cb(info)),
  onCallError: (cb: (err: { message: string }) => void) =>
    ipcRenderer.on('call:error', (_e, err) => cb(err)),

  // Audio
  sendAudioFrame: (frame: Buffer) => ipcRenderer.send('audio:outbound-frame', frame),
  onInboundFrame: (cb: (frame: ArrayBuffer) => void) =>
    ipcRenderer.on('audio:inbound-frame', (_e, frame: Buffer) => cb(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer)),

  // Signaling
  publishSignal: (payload: string) => ipcRenderer.invoke('nostr:publish', { payload }),
  onIncomingSignal: (cb: (data: string) => void) =>
    ipcRenderer.on('nostr:incoming', (_e, data) => cb(data)),

  // Payment
  settlePayment: (amount: string) => ipcRenderer.invoke('strk20:pay', { amount }),

  // Call log
  commitCall: (callId: string) => ipcRenderer.invoke('starknet:commitCall', { callId }),
})
