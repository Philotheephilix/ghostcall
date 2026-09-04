# File Transfer Design — GhostCall

**Date:** 2026-09-04  
**Status:** Approved

## Overview

Peer-to-peer encrypted file transfer over a live Tor onion tunnel. Reuses the existing Noise_XX handshake and onion infrastructure. Separate session from calls — no audio, same crypto.

## Wire Protocol

Every `NoiseTransport` frame is prefixed with a 1-byte message type:

| Byte | Name        | Payload |
|------|-------------|---------|
| 0x01 | AUDIO_FRAME | (existing) |
| 0x02 | FILE_META   | JSON: `{ name, size, mime, transferId }` |
| 0x03 | FILE_CHUNK  | `transferId[16B] + chunkIndex[4B uint32BE] + data[≤64KB]` |
| 0x04 | FILE_ACK    | `transferId[16B] + status[1B]` (0=ok, 1=rejected, 2=done) |

Max file size: 50 MB. Chunk size: 64 KB. Transfer is unidirectional; receiver sends ACKs. No resume on disconnect.

## Demux Layer (`electron/demux.ts`)

Wraps any `NoiseTransport`, splits `recv` stream into per-type async queues. Audio bridge and file bridge each subscribe to their own type byte. ~40 lines, fully testable with a mock transport.

## Session Flow

1. Sender picks file in UI → `file:send` IPC with handle + file path
2. Main calls `goOnline()` → creates onion, binds listener
3. Main publishes Nostr offer with `type: "file"`, `{ name, size, transferId }` in payload
4. Receiver sees `nostr:incoming` with type=file → UI shows accept/reject prompt
5. Receiver accepts → `file:accept` IPC → `initiateCall(onionAddr)` path → Noise_XX handshake → file bridge wires up
6. Sender streams FILE_META then FILE_CHUNKs; receiver ACKs each; progress events pushed to renderer
7. On completion: receiver prompted with save dialog; onion torn down both sides

## New Files

- `electron/demux.ts` — transport demultiplexer
- `electron/file-bridge.ts` — sender/receiver state machines, IPC handlers
- `renderer/components/FileTransferPage.tsx` — send + incoming UI
- `renderer/components/FileTransferModal.tsx` — incoming accept/reject overlay

## Modified Files

- `electron/preload.ts` — add file transfer IPC bridge methods
- `electron/main.ts` — register file IPC handlers
- `renderer/app/home/page.tsx` — wire incoming file signal listener
- `renderer/app/home/page.tsx` — add Files tab to Dock

## IPC Surface (preload)

```ts
sendFile(handle: string, filePath: string): Promise<{ transferId: string }>
acceptFileTransfer(transferId: string): Promise<void>
rejectFileTransfer(transferId: string): Promise<void>
cancelFileTransfer(transferId: string): Promise<void>
onIncomingFile(cb): () => void   // push: { handle, name, size, transferId }
onFileProgress(cb): () => void   // push: { transferId, bytesReceived, total }
onFileDone(cb): () => void       // push: { transferId, savedPath }
onFileError(cb): () => void      // push: { transferId, message }
```

## Testing

All logic testable without Tor via mock `NoiseTransport` (in-memory duplex stream pair). Tests cover: demux dispatch, chunk reassembly, ACK flow, 50MB limit enforcement, cancellation, error propagation.
