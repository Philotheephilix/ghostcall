import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ghostcall', {
  // Tor
  getTorStatus: () => ipcRenderer.invoke('tor:status'),
  // Identity
  registerStealth: (handle: string, pkV: string, pkS: string) =>
    ipcRenderer.invoke('starknet:register', { handle, pkV, pkS }),
  lookupStealth: (handle: string) =>
    ipcRenderer.invoke('starknet:lookup', { handle }),
  // Calling
  initiateCall: (onionAddr: string, callerNoisePubkey: string) =>
    ipcRenderer.invoke('call:initiate', { onionAddr, callerNoisePubkey }),
  answerCall: (callerNoisePubkey: string) =>
    ipcRenderer.invoke('call:answer', { callerNoisePubkey }),
  hangUp: () => ipcRenderer.invoke('call:hangup'),
  // Signaling
  publishSignal: (payload: string) => ipcRenderer.invoke('nostr:publish', { payload }),
  onIncomingSignal: (cb: (data: string) => void) =>
    ipcRenderer.on('nostr:incoming', (_e, data) => cb(data)),
  // Payment
  settlePayment: (amount: bigint) => ipcRenderer.invoke('strk20:pay', { amount }),
  // Call log
  commitCall: (callId: string) => ipcRenderer.invoke('starknet:commitCall', { callId }),
})
