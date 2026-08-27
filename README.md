# GhostCall

> Trustless, untraceable 1:1 audio calls on Starknet. No TURN server. No trusted relay. No IP exposure.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Starknet](https://img.shields.io/badge/Starknet-Mainnet-black)](https://starknet.io)
[![STRK20](https://img.shields.io/badge/STRK20-Private_Sprint-purple)](https://strk20.starknet.io/hackathon)

---

## What Is GhostCall?

GhostCall is a desktop app for making private audio calls where **neither party's real IP is ever exposed**, audio is encrypted end-to-end with no server in the decryption path, identities are stealth addresses (not wallet addresses), and payments are shielded through the STRK20 privacy pool.

Every existing private calling app — Signal, Status.im, Session, Brave Talk — solves at most two of these properties. GhostCall solves all four simultaneously on a trustless, open-source stack.

---

## How It's Different

| Property | Signal | Status.im | Session | **GhostCall** |
|---|---|---|---|---|
| Real IP hidden from callee | ❌ | ❌ | ❌ | ✅ Tor onion service |
| Trustless relay (no operator to trust) | ❌ TURN | ❌ Waku relays | ❌ Service nodes | ✅ Tor network |
| On-chain stealth identity | ❌ | ❌ | ❌ | ✅ ERC-5564 on Starknet |
| Shielded payments per call | ❌ | ❌ | ❌ | ✅ STRK20 pool |
| ZK call receipt (provable, no participants) | ❌ | ❌ | ❌ | ✅ Poseidon commitment |
| Open source | ✅ | ✅ | ✅ | ✅ Apache-2.0 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1 — IDENTITY (Starknet mainnet)                      │
│  StealthRegistry contract                                    │
│  ERC-5564 stealth meta-address: (pk_v, pk_s)                │
│  → Register once. Receive calls without revealing wallet.   │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2 — SIGNALING (Nostr NIP-59, off-chain)              │
│  Gift-wrapped call offers: ephemeral keys + random timestamps│
│  → Relay sees random pubkeys + encrypted blobs. Nothing else.│
├─────────────────────────────────────────────────────────────┤
│  LAYER 3 — TRANSPORT (Tor v3 onion service)                  │
│  Raw TCP through Tor. No TURN. No ICE. No relay operator.   │
│  Noise_XX handshake → ChaCha20-Poly1305 session keys        │
│  Opus audio frames (20ms, 16kHz mono)                       │
│  → Callee's machine never learns caller's real IP.          │
├─────────────────────────────────────────────────────────────┤
│  LAYER 4 — PAYMENT (STRK20 shielded pool)                   │
│  Post-call shielded STRK transfer                           │
│  → Pool breaks sender↔recipient link entirely.              │
└─────────────────────────────────────────────────────────────┘
```

### Call Flow

```
1. SETUP (one time)
   Alice signs deterministic message with Starknet wallet
   → HKDF derives (sk_v, sk_s) → secp256k1 keypairs
   → StealthRegistry.register(handle_hash, pk_v, pk_s) [TX #1]

2. GO ONLINE (each session)
   Bob's app: tor ADD_ONION → gets fresh .onion address
   Bob's app: TCP server binds on 127.0.0.1:7331
   Bob's Nostr subscription: watching for inbound gift-wrapped signals

3. CALL INITIATION (Alice → Bob)
   Alice: lookup Bob's (pk_v, pk_s) from StealthRegistry [free read]
   Alice: ECDH(r, pk_v) → session key → encrypt call signal
   Alice: NIP-59 gift wrap (random outer keypair, randomized timestamp)
   Alice: publish to Nostr relay

4. HANDSHAKE
   Bob: unwrap NIP-59, decrypt signal → get Alice's Noise pubkey
   Bob: reply with .onion address (same channel, encrypted)
   Alice: SOCKS5 connect through Tor to Bob's .onion:7331
   Both: Noise_XX handshake → (k_send, k_recv) ChaCha20-Poly1305

5. ACTIVE CALL
   getUserMedia() → Opus encode (20ms frames) → Noise encrypt → Tor → decode → speaker
   TURN server: does not exist
   Audio content: never touches any server

6. POST-CALL
   Alice: STRK20 SDK private transfer → Bob's stealth address [TX #2]
   Alice: CallLog.commit_call(Poseidon(call_id, stealth_pk)) [TX #3]
   Pool breaks sender↔recipient link. Chain stores only a hash.
```

---

## Privacy Guarantees

| Threat | Protection | Residual |
|---|---|---|
| Callee learns caller's IP | Tor onion — callee's machine sees only a Tor circuit | Global passive adversary (theoretical) |
| Relay learns both IPs | Tor relay nodes each see only one hop | — |
| Audio sniffed in transit | Noise_XX (ChaCha20-Poly1305) + Tor encryption layers | — |
| Signaling links caller to callee | NIP-59 ephemeral keys, randomized timestamps ±48h | Nostr relay sees recipient's ephemeral p-tag |
| On-chain call linkage | Only Poseidon hash stored — no participants, no timing | Hash is public (meaningless without keys) |
| Payment links to call | STRK20 pool breaks transaction graph | Pool anonymity set size |
| Fake SDP fingerprint (MITM) | No SDP — Noise_XX mutual authentication replaces it | Requires NIP-44 compromise to substitute keys |

---

## Tech Stack

| Layer | Technology |
|---|---|
| App shell | Electron 32 (Node.js + Chromium) |
| Frontend | Next.js 14 (App Router) + TypeScript |
| Tor integration | `granax` (control port) + bundled `tor` binary |
| Audio | Web Audio API + `opusscript` (Opus WASM encoder/decoder) |
| Transport encryption | `noise-protocol` (Noise_XX: X25519 + ChaCha20-Poly1305) |
| Signaling | `nostr-tools` (NIP-44 + NIP-59 gift wrap) |
| Identity contracts | Cairo 2.x — `StealthRegistry` + `CallLog` |
| Payment | `@starkware-libs/starknet-privacy-sdk` |
| Chain | `starknet.js` v6, Starknet mainnet |
| Crypto primitives | `@noble/curves` (secp256k1, X25519), `@noble/hashes` (HKDF-SHA256) |
| Styling | Tailwind CSS |

---

## Contracts

| Contract | Address | Purpose |
|---|---|---|
| `StealthRegistry` | `TBD` | Register stealth meta-addresses (handle → pk_v, pk_s) |
| `CallLog` | `TBD` | Store post-call Poseidon commitments (no participants) |

---

## STRK20 Integration

GhostCall qualifies for the STRK20 Private Sprint through three mainnet transactions:

| TX | Contract | What |
|---|---|---|
| #1 | `StealthRegistry` | `register(handle_hash, pk_v_x, pk_v_y, pk_s_x, pk_s_y)` |
| #2 | STRK20 pool (`0x040337b1...`) | `createPrivateTransfers().build().privateTransfer().execute()` |
| #3 | `CallLog` | `commit_call(Poseidon(call_id, caller_stealth_pk_x))` |

The STRK20 pool integration uses the full SDK path:
- `createPrivateTransfers` with `viewingKeyProvider`, `provingProvider`, `discoveryProvider`
- Shielded note creation and spending (sender↔recipient link broken by pool)
- Note discovery via `discoveryProvider` with viewing key scan
- Registration gate enforced before first transfer

---

## Prerequisites

- macOS or Linux (Windows untested)
- [Tor](https://www.torproject.org/) — `brew install tor` (macOS) or `apt install tor` (Linux)
- Node.js ≥ 24
- A Starknet wallet (Argent or Braavos) with STRK on mainnet

---

## Development Setup

```bash
# 1. Clone
git clone https://github.com/Philotheephilix/ghostcall.git
cd ghostcall

# 2. Install deps
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env — add your Starknet RPC URL, account address, private key

# 4. Start Tor (must be running before the app launches)
tor &
# or: brew services start tor

# 5. Run in development mode
npm run dev
# → Electron window opens at localhost:3000
```

---

## Building for Production

```bash
# Build Cairo contracts first
cd contracts && scarb build && cd ..

# Deploy contracts (requires funded mainnet account in .env)
npx ts-node scripts/deploy-contracts.ts

# Build + package Electron app
npm run build
# Output: dist/ — .dmg (macOS), .AppImage (Linux)
```

---

## Environment Variables

```bash
# .env.example
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
STARKNET_RPC_URL=https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY

NOSTR_RELAY_URL=wss://relay.damus.io

STRK20_POOL_ADDRESS=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
STRK20_PROVER_URL=https://prover.strk20.starknet.io
STRK20_DISCOVERY_URL=https://discovery.strk20.starknet.io
```

**Never commit `.env`.**

---

## Project Structure

```
ghostcall/
├── electron/
│   ├── main.ts                 # Electron main process, IPC, Tor spawn
│   ├── preload.ts              # contextBridge API exposed to renderer
│   ├── tor-manager.ts          # Tor daemon + control port + onion service
│   ├── onion-server.ts         # TCP server on 127.0.0.1:7331
│   ├── onion-client.ts         # SOCKS5 connect through Tor
│   ├── noise-session.ts        # Noise_XX handshake + transport
│   ├── audio-bridge.ts         # IPC bridge for audio frames
│   └── call-orchestrator.ts    # Wires all layers together
├── renderer/                   # Next.js app (Electron renderer)
│   ├── app/
│   │   ├── page.tsx            # Home / dial screen
│   │   ├── setup/page.tsx      # First-run wallet + stealth registration
│   │   └── call/page.tsx       # Active call screen
│   ├── lib/
│   │   ├── stealth-keys.ts     # HKDF key derivation from wallet signature
│   │   ├── nostr-signal.ts     # NIP-44/NIP-59 signaling
│   │   ├── starknet-client.ts  # Contract reads/writes
│   │   ├── strk20-payment.ts   # STRK20 SDK shielded payment
│   │   └── audio-engine.ts     # getUserMedia + Opus encode/decode
│   └── components/
│       ├── DialPad.tsx
│       ├── CallScreen.tsx
│       └── WalletConnect.tsx
├── contracts/
│   ├── src/
│   │   ├── stealth_registry.cairo
│   │   └── call_log.cairo
│   └── tests/
├── scripts/
│   ├── deploy-contracts.ts
│   └── gen-strk20-json.ts
├── strk20.json                 # Hackathon submission file
├── .env.example
└── README.md
```

---

## How Tor Replaces TURN

Traditional WebRTC requires a TURN relay server. The operator of that server sees both callers' real IP addresses. This is an unavoidable trust requirement in the WebRTC model.

GhostCall replaces TURN with a Tor v3 onion service:

```
Traditional:  Alice ──→ TURN server (sees both IPs) ──→ Bob
GhostCall:    Alice ──→ [Tor relay 1 → relay 2 → relay 3] ──→ Bob's .onion
```

Bob's machine creates a fresh `.onion` address each session via the Tor control port (`ADD_ONION NEW:ED25519-V3`). Alice connects through her local Tor daemon using SOCKS5. The Tor network routes the connection through three intermediate relays, none of which know both endpoints. Bob's machine receives a TCP connection from a Tor circuit — it never learns Alice's real IP address.

Audio travels as length-prefixed Opus frames encrypted with ChaCha20-Poly1305 (Noise_XX session keys). The Tor network additionally encrypts each circuit hop. Two independent encryption layers protect the audio content.

The latency cost is real: Tor circuits typically add 100–250ms. Opus at 20ms frames handles up to 500ms of jitter gracefully, so call quality is acceptable. The gain is genuine trustlessness — no third party is in the media path.

---

## License

Apache-2.0 — see [LICENSE](LICENSE).

---

## Hackathon

Built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon) — August 14–31, 2026.

> Eighteen days to ship a real privacy app on Starknet mainnet.
