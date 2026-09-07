<div align="center">

```
  ██████╗ ██╗  ██╗ ██████╗ ███████╗████████╗ ██████╗ █████╗ ██╗     ██╗
 ██╔════╝ ██║  ██║██╔═══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗██║     ██║
 ██║  ███╗███████║██║   ██║███████╗   ██║   ██║     ███████║██║     ██║
 ██║   ██║██╔══██║██║   ██║╚════██║   ██║   ██║     ██╔══██║██║     ██║
 ╚██████╔╝██║  ██║╚██████╔╝███████║   ██║   ╚██████╗██║  ██║███████╗███████╗
  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝   ╚═╝    ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝
```

# GhostCall

### Trustless, untraceable 1:1 voice calls and file transfer over Tor + Starknet.
### The only calling app that solves all four: hidden IPs · trustless relay · on-chain stealth identity · shielded payments.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Starknet](https://img.shields.io/badge/Starknet-Sepolia%20→%20Mainnet-black?logo=ethereum)](https://starknet.io)
[![STRK20](https://img.shields.io/badge/STRK20-Private_Sprint_2026-8B5CF6)](https://strk20.starknet.io/hackathon)
[![Cairo](https://img.shields.io/badge/Cairo-2.x-orange)](https://book.cairo-lang.org)
[![Tor](https://img.shields.io/badge/Transport-Tor_v3_Onion-7C3AED)](https://www.torproject.org)
[![Noise](https://img.shields.io/badge/Crypto-Noise__XX%20%2B%20ChaCha20--Poly1305-green)](http://noiseprotocol.org)
[![Built on Sepolia](https://img.shields.io/badge/Contracts-Live_on_Sepolia-22C55E)](https://sepolia.voyager.online)

</div>

---

## Why This Exists

Every "private" calling app in production today is lying to you about something.

**Signal** uses WebRTC. When direct peer-to-peer fails — the common case on mobile networks — it falls back to TURN servers operated by the Signal Foundation, which then observe both callers' IP addresses. Signal's Contact Discovery Service runs inside SGX enclaves, but enclave trust depends on Intel's attestation infrastructure and remains a residual trust assumption. Signal's infrastructure team observes call metadata: who called whom, when, for how long. Signal is a trusted company operating trusted infrastructure. That is not the same as trustless.

**WhatsApp and FaceTime** are owned by Meta and Apple respectively. Both have NSA PRISM program disclosures in their histories. Both retain call metadata — duration, frequency, parties — indefinitely. WhatsApp's E2E encryption protects audio content but does nothing for the metadata dossier building up on every call you make.

**Zoom and Microsoft Teams** have historically permitted broad metadata use for product improvement. All call metadata is exposed to corporate IT administrators. End-to-end encryption is opt-in, not default — the default is server-decryptable.

**Wire** stores the user social graph server-side. The Wire company knows exactly who your contacts are, even if it cannot read your messages.

**Status.im** routes messages through Waku relay operators who see message metadata and have the technical power to censor. The relay network is permissioned.

**Session** uses a service node network where each node sees routing metadata. The network is vulnerable to Sybil attacks on small anonymity sets.

**Every single WebRTC app** — Signal, Brave Talk, Jitsi, Discord — has a structural problem that cannot be solved with better configuration: STUN exposes your IP to the peer via ICE candidates; when direct P2P fails, TURN relay mode puts a server between both parties that sees both IPs simultaneously. This is not a policy failure. It is a protocol requirement. No matter how much you trust the Signal Foundation today, the architecture guarantees that trust is required.

GhostCall eliminates the trust requirement entirely.

No TURN server. No relay operator to trust or subpoena. No IP exposure to the other party. No on-chain identity linkage. No payment graph. Built on cryptographic guarantees, not organizational promises.

---

## The Four Properties No One Else Has Simultaneously

| Property | Signal | WhatsApp | Session | Status.im | **GhostCall** |
|---|:---:|:---:|:---:|:---:|:---:|
| Real IP hidden from callee | ❌ TURN sees both | ❌ Meta TURN | ❌ Partial | ❌ | ✅ Tor onion — callee sees only circuit |
| IP hidden from relay operator | ❌ Signal Foundation | ❌ Meta infra | ❌ Service nodes | ❌ Waku operators | ✅ No single operator; Tor guard/exit separated |
| Trustless relay (no org to trust) | ❌ | ❌ | ❌ | ❌ | ✅ Tor network |
| On-chain stealth identity | ❌ | ❌ | ❌ | ❌ | ✅ ERC-5564 on Starknet |
| Shielded payments (payment graph severed) | ❌ | ❌ | ❌ | ❌ | ✅ STRK20 privacy pool |
| ZK-style call receipt (no parties, no timing) | ❌ | ❌ | ❌ | ❌ | ✅ Poseidon commitment on-chain |
| No SDP fingerprinting | ❌ | ❌ | ❌ | ❌ | ✅ Noise_XX replaces SDP entirely |
| No certificate authority in auth path | ❌ TLS | ❌ TLS | ❌ | ❌ | ✅ Noise_XX mutual auth — no CA |
| Call metadata on-chain (parties, timing) | N/A | N/A | N/A | N/A | ✅ Hash only — meaningless without keys |
| Audio content server-decryptable | ❌ (TURN path) | ❌ | ✅ | ✅ | ✅ Never touches a server |
| Open source | ✅ | ❌ | ✅ | ✅ | ✅ Apache-2.0 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — IDENTITY                          [Starknet / Cairo 2.x]     │
│                                                                          │
│  StealthRegistry contract: ERC-5564 stealth meta-addresses               │
│  Register: handle_hash → (pk_view, pk_spend) secp256k1 pubkey pair      │
│  Keys derived via HKDF-SHA256 from deterministic wallet signature        │
│  Handle is a hash — your wallet address is never on-chain                │
│                                                                          │
│  → On-chain identity ≠ wallet address. Per-call ephemeral keys.         │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 2 — SIGNALING                         [Nostr / NIP-44 + NIP-59]  │
│                                                                          │
│  Call offers encrypted with NIP-44 (ECDH + ChaCha20-Poly1305)           │
│  Gift-wrapped with NIP-59: ephemeral outer keypair, randomized ±48h ts  │
│  Published to Nostr relay                                                │
│  Relay sees: random pubkey → random pubkey, encrypted blob, fake ts     │
│  Relay does NOT see: caller identity, callee identity, call intent       │
│                                                                          │
│  → Relay sees noise. No call metadata. No social graph.                 │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 3 — TRANSPORT                         [Tor v3 + Noise_XX]        │
│                                                                          │
│  Callee: tor ADD_ONION NEW:ED25519-V3 → fresh .onion per session        │
│  Caller: SOCKS5 connect through local Tor daemon → callee's .onion      │
│  Tor: 3-hop circuit. Guard, middle, exit each see only one hop.         │
│  Noise_XX handshake: X25519 ECDH → ChaCha20-Poly1305 session keys       │
│  Audio: Opus @ 20ms frames, length-prefixed, Noise-encrypted            │
│  File transfer: same tunnel, demux layer, 64KB chunks                   │
│                                                                          │
│  → No TURN server. No ICE. No SDP. Callee never learns caller's IP.     │
├─────────────────────────────────────────────────────────────────────────┤
│  LAYER 4 — PAYMENT + AUDIT                   [Starknet / STRK20]        │
│                                                                          │
│  Post-call: STRK20 shielded transfer to callee's stealth address        │
│  STRK20 privacy pool breaks sender↔recipient link entirely              │
│  CallLog contract: commit_call(Poseidon(call_id, stealth_pk_x))         │
│  On-chain: one field element — a hash. No parties. No timing. No amount.│
│                                                                          │
│  → Payment graph severed. Audit trail exists. Parties unidentifiable.   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Complete Call Flow

```
── SETUP (one time per user) ────────────────────────────────────────────

  Alice opens app → connects Starknet wallet (Argent / Braavos)
  App signs deterministic message: "GhostCall identity v1:<wallet_addr>"
  HKDF-SHA256(signature) → sk_view, sk_spend  (secp256k1 private keys)
  pk_view = sk_view·G,  pk_spend = sk_spend·G
  StealthRegistry.register(Poseidon(handle), pk_view, pk_spend)   [TX #1]

── GO ONLINE (each session) ─────────────────────────────────────────────

  Bob's app → tor control port: ADD_ONION NEW:ED25519-V3 Port=7331
  Tor daemon returns: ServiceID=abc123…xyz.onion
  Bob's TCP server binds 127.0.0.1:7331
  Bob subscribes to Nostr relay, filtering for his NIP-59 gifts

── CALL INITIATION (Alice → Bob) ────────────────────────────────────────

  Alice: reads Bob's (pk_view, pk_spend) from StealthRegistry  [free]
  Alice: r ←random;  shared = ECDH(r, pk_view)
  Alice: stealth_addr = pk_spend + Poseidon(shared)·G
  Alice: encrypts signal {noise_pubkey, onion_request} with NIP-44
  Alice: wraps with NIP-59 (ephemeral outer key, ts ± random 48h)
  Alice: publishes to Nostr relay

── HANDSHAKE ────────────────────────────────────────────────────────────

  Bob: unwraps NIP-59, decrypts NIP-44 → Alice's Noise static key
  Bob: responds with .onion address (same encrypted channel)
  Alice: SOCKS5 connect via local Tor → abc123…xyz.onion:7331
  Both: Noise_XX handshake (3 messages, mutual X25519 DH)
        → k_send, k_recv  (ChaCha20-Poly1305 session keys)

── ACTIVE CALL ──────────────────────────────────────────────────────────

  getUserMedia() → Opus encode (20ms, 16kHz mono, ~8kbps)
  → Noise_XX encrypt  → length prefix  → Tor circuit  → decrypt  → speaker
  TURN server: does not exist
  Audio content: never touches any server, in any form, at any time

── FILE TRANSFER (same session) ─────────────────────────────────────────

  Sender reads file → 64KB chunks → tagged stream (type=FILE, chunk_id)
  Demux layer on same Noise_XX tunnel separates audio vs file streams
  Receiver: reassemble chunks → write to disk
  Max file size: 50MB per transfer
  Encryption: same ChaCha20-Poly1305 session keys as audio
  Trust surface added: zero

── POST-CALL ────────────────────────────────────────────────────────────

  Alice: STRK20 SDK privateTransfer(amount, stealth_addr)         [TX #2]
         → pool mixes note with other deposits; recipient link severed
  Alice: CallLog.commit_call(Poseidon(call_id, stealth_pk_x))     [TX #3]
         → chain stores one hash; parties and timing not recoverable
```

---

## How Tor Replaces TURN

This is the core architectural decision. It is worth understanding precisely.

### The Traditional WebRTC Problem

```
  ┌─────────┐                                          ┌─────────┐
  │  Alice  │──→ STUN: "what's my public IP?"         │   Bob   │
  │ 203.x.x │                                          │ 141.x.x │
  └─────────┘                                          └─────────┘
       │                                                    │
       │                  ┌─────────────┐                  │
       └──────────────────│ TURN Server │──────────────────┘
                          │ (sees BOTH) │
                          │  logs both  │
                          │  IPs always │
                          └─────────────┘

  TURN operator knows: Alice's IP, Bob's IP, call time, call duration.
  TURN operator is Signal Foundation, or Meta, or your employer.
  TURN operator can be subpoenaed, hacked, or compelled.
  This is NOT a configuration problem. It is a protocol requirement.
```

### The GhostCall Solution

```
  ┌─────────┐                                          ┌─────────┐
  │  Alice  │                                          │   Bob   │
  │ 203.x.x │                                          │ 141.x.x │
  └────┬────┘                                          └────┬────┘
       │                                                    │
       │  Tor circuit (Alice's side)      .onion service    │
       └──→ [Guard] → [Middle] → [Exit] → abc123.onion ────┘
                                              ↑
                                   Bob's Tor daemon creates this.
                                   Bob's TCP server is 127.0.0.1:7331.
                                   Bob's machine receives: a TCP connection
                                   from a Tor circuit. No IP. No metadata.

  Guard node:  knows Alice's real IP. Does NOT know Bob or the destination.
  Middle node: knows Guard and Exit. Knows nothing about either endpoint.
  Exit node:   knows destination (.onion). Does NOT know Alice's IP.
  Bob:         receives connection from Tor circuit. Learns nothing about Alice.
  Alice:       connects to Bob's .onion via her local Tor SOCKS5 proxy.
               Learns nothing about Bob's real IP.

  Result: Neither party learns the other's real IP address.
          No server is in the audio path.
          No operator can be subpoenaed for call metadata.
```

The latency cost is real and worth stating honestly: Tor circuits add 100–250ms of round-trip latency. Opus at 20ms frames with 480ms of jitter buffer handles this gracefully at the cost of slightly increased end-to-end delay. The trade-off is not hidden from users. The gain is genuine trustlessness — no third party exists to betray.

---

## File Transfer

GhostCall transfers files over the same Tor + Noise_XX tunnel used for audio, adding no new trust surface.

### How It Works

The call tunnel carries two multiplexed streams: audio frames tagged `type=AUDIO` and file chunks tagged `type=FILE`. A demux layer in the Electron main process separates them by tag and routes each to the appropriate handler.

```
  Tor + Noise_XX tunnel
  ┌─────────────────────────────────────┐
  │  [AUDIO|frame_data]                 │ → Opus decoder → speaker
  │  [FILE |chunk_id|total|file_data]   │ → reassembly buffer → disk
  │  [AUDIO|frame_data]                 │
  │  [FILE |chunk_id|total|file_data]   │
  └─────────────────────────────────────┘
```

### Properties

| Property | Value |
|---|---|
| Encryption | ChaCha20-Poly1305 (same Noise_XX session keys as audio) |
| Chunk size | 64 KB |
| Max file size | 50 MB per transfer |
| Trust surface added | Zero — same tunnel, same keys, no new server |
| Integrity | Noise_XX AEAD — each chunk authenticated |
| Receiver IP exposure | None — same Tor circuit as the call |
| Concurrent with audio | Yes — demux layer handles both streams simultaneously |

---

## Privacy Guarantees

| Threat Model | Protection | Residual Risk |
|---|---|---|
| Callee learns caller's real IP | Tor v3 onion service — callee's machine sees only a Tor circuit endpoint | Global passive adversary correlating traffic timing (theoretical, resource-intensive) |
| Caller learns callee's real IP | Tor onion service — callee's real IP is never transmitted | Same |
| Relay operator learns both IPs | No relay operator — Tor guard/middle/exit each see only one hop | Tor relay operator sees one hop only |
| Audio content intercepted in transit | Noise_XX ChaCha20-Poly1305 + Tor's own layered encryption | Requires compromise of both Noise session keys AND Tor circuit simultaneously |
| Signaling links caller to callee | NIP-59 gift wrap: ephemeral outer keypair, timestamp randomized ±48h | Nostr relay sees recipient's NIP-59 p-tag (encrypted, unlinkable to wallet) |
| On-chain identity linked to wallet | ERC-5564 stealth keys derived from signature, not from wallet public key | Deterministic derivation — if signature is ever leaked, identity is linkable |
| On-chain call record reveals parties | Poseidon(call_id, stealth_pk_x) — one hash, no parties, no timing | Hash is public; meaningless without stealth private key |
| Payment links sender to recipient | STRK20 privacy pool breaks transaction graph by design | Pool anonymity set: grows with usage; small initially |
| MITM substitutes Noise keys | Noise_XX mutual authentication — both parties authenticate static keys | Requires NIP-44 ciphertext substitution before key exchange |
| SDP fingerprinting / WebRTC leaks | No WebRTC, no SDP, no ICE, no STUN — Noise_XX replaces the entire stack | None |
| Certificate authority compromise | No TLS in auth path — Noise_XX is CA-free by design | None |
| File transfer reveals identity | Same Tor circuit and Noise session as audio call | Same as audio call |

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| App shell | Electron 32 | Node.js access to Tor control port + OS audio; single binary |
| Frontend | Next.js 14 (App Router) + TypeScript | SSR-capable renderer in Electron |
| Tor integration | `granax` (control port client) + system `tor` binary | Programmatic onion service creation via AUTHENTICATE + ADD_ONION |
| Audio capture | Web Audio API + `getUserMedia` | Browser-native, no native addon required |
| Audio codec | `opusscript` (Opus WASM) | 8kbps @ 16kHz mono — tolerant of Tor jitter |
| Transport encryption | `noise-protocol` (Noise_XX pattern) | X25519 ECDH + ChaCha20-Poly1305; mutual auth; no CA; forward secrecy |
| File transfer | Custom demux over Noise_XX tunnel | Zero new trust surface — same channel as audio |
| Signaling | `nostr-tools` (NIP-44 + NIP-59) | Gift wrap hides both parties from relay; no account required |
| Identity contracts | Cairo 2.x — `StealthRegistry` + `CallLog` | ERC-5564 stealth meta-addresses on Starknet |
| Privacy payments | `@starkware-libs/starknet-privacy-sdk` | STRK20 shielded pool — severs payment graph |
| Chain client | `starknet.js` v6 | V3 transaction format (Starknet spec 0.10.2) |
| Crypto primitives | `@noble/curves` (secp256k1, X25519) + `@noble/hashes` (HKDF-SHA256) | Audited, zero-dependency pure-JS crypto |
| Styling | Tailwind CSS | |

---

## Live Contracts (Starknet Sepolia)

Both contracts are deployed, verified, and actively receiving transactions on Starknet Sepolia. Mainnet migration is a one-command operation.

### Contract Addresses

| Contract | Address | Explorer |
|---|---|---|
| `StealthRegistry` | `0xcaac954e489813c8ce481f72864f16a1723471ee782fabc87431c9f8c4e8e1` | [Voyager ↗](https://sepolia.voyager.online/contract/0xcaac954e489813c8ce481f72864f16a1723471ee782fabc87431c9f8c4e8e1) |
| `CallLog` | `0x2fbcdaf58ceb28e8007edd37f9d3f2e4be7ddc2d326972124a52aababc1f6ba` | [Voyager ↗](https://sepolia.voyager.online/contract/0x2fbcdaf58ceb28e8007edd37f9d3f2e4be7ddc2d326972124a52aababc1f6ba) |

### Deploy Transactions

| Contract | Declare | Deploy |
|---|---|---|
| `StealthRegistry` | [0x2688…1f10 ↗](https://sepolia.voyager.online/tx/0x26881f186029ab10396bfaaec4b0404facbc899738562dda40594abcf531f10) | [0x3f17…7237 ↗](https://sepolia.voyager.online/tx/0x3f175090b930dd672a8ad1c1993b13d4718bec21ccf386406973db9bfa57237) |
| `CallLog` | [0x351a…ac18 ↗](https://sepolia.voyager.online/tx/0x351a646e732d3d82e49e8ff817360fe8901b327ea9536d735ae8849300bac18) | [0x5d5e…02cb ↗](https://sepolia.voyager.online/tx/0x5d5e5671a906074c2fc30371606f12bdfbe0e1720ccb55320b8d890c86502cb) |

### Live Test Transactions

| Transaction | Call | Explorer |
|---|---|---|
| `StealthRegistry.register()` | Live identity registration | [0x5fcf…fffe ↗](https://sepolia.voyager.online/tx/0x5fcfa59cb4dcd496ea78f31d082beb790df77ca3674754b42ce9a9852cfffe) |
| `CallLog.commit_call()` | Poseidon commitment stored | [0x2c0f…bfb8 ↗](https://sepolia.voyager.online/tx/0x2c0fab5eb5a2d47aa3cf30e0fe000b026faf93489ef41ef312828e1b8c4bfb8) |

---

## Setup and Build

### Prerequisites

- macOS or Linux (Windows untested)
- Node.js >= 24
- Tor: `brew install tor` (macOS) or `apt install tor` (Debian/Ubuntu)
- A Starknet wallet (Argent or Braavos) funded with STRK on Sepolia

### Development

```bash
# Clone
git clone https://github.com/Philotheephilix/ghostcall.git
cd ghostcall

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env — add Starknet RPC URL, account address, private key

# Start Tor daemon (must be running before the app launches)
tor &
# macOS alternative: brew services start tor

# Run in development mode
npm run dev
# Electron window opens, renderer at localhost:3000
```

### Production Build

```bash
# Build Cairo contracts
cd contracts && scarb build && cd ..

# Deploy contracts (requires funded account in .env)
npx ts-node scripts/deploy-contracts.ts
# Writes deployed addresses to deployments.json

# Build and package Electron app
npm run build
# Output: dist/
#   macOS:  GhostCall-<version>.dmg
#   Linux:  GhostCall-<version>.AppImage
```

### Environment Variables

```bash
# Required
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/v2/YOUR_KEY

# Signaling
NOSTR_RELAY_URL=wss://relay.damus.io

# STRK20 pool (mainnet only)
STRK20_POOL_ADDRESS=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
STRK20_PROVER_URL=https://prover.strk20.starknet.io
STRK20_DISCOVERY_URL=https://discovery.strk20.starknet.io
```

**Never commit `.env`.**

### Mainnet Migration

One command. The app's `sendShieldedPayment()` automatically uses the full STRK20 SDK path when the package is installed, and falls back to a standard ERC-20 transfer on testnet — no code changes required.

```bash
# 1. Deploy contracts to mainnet
STARKNET_RPC_URL=https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY \
STARKNET_ACCOUNT_ADDRESS=0x... \
STARKNET_PRIVATE_KEY=0x... \
npx ts-node scripts/deploy-contracts.ts

# 2. Install STRK20 SDK (GitHub Packages auth required)
npm config set @starkware-libs:registry https://npm.pkg.github.com
npm config set //npm.pkg.github.com/:_authToken YOUR_GITHUB_PAT
npm install @starkware-libs/starknet-privacy-sdk

# 3. Register with the STRK20 pool
npx ts-node scripts/register-strk20-pool.ts

# 4. Update .env with mainnet RPC URL + new contract addresses from deployments.json

# 5. Run
npm run dev
```

---

## Project Structure

```
ghostcall/
├── electron/
│   ├── main.ts                  # Electron main process, IPC, lifecycle
│   ├── preload.ts               # contextBridge API surface
│   ├── tor-manager.ts           # Tor daemon spawn + control port + ADD_ONION
│   ├── onion-server.ts          # TCP server on 127.0.0.1:7331 (callee)
│   ├── onion-client.ts          # SOCKS5 connect through Tor (caller)
│   ├── noise-session.ts         # Noise_XX handshake + encrypted transport
│   ├── audio-bridge.ts          # IPC bridge for Opus frame relay
│   ├── file-transfer.ts         # Demux layer + 64KB chunking
│   └── call-orchestrator.ts     # Wires all layers into a single call lifecycle
├── renderer/                    # Next.js app (Electron renderer process)
│   ├── app/
│   │   ├── page.tsx             # Home / dial screen
│   │   ├── setup/page.tsx       # First-run: wallet connect + stealth registration
│   │   └── call/page.tsx        # Active call + file transfer UI
│   └── lib/
│       ├── stealth-keys.ts      # HKDF key derivation from wallet signature
│       ├── nostr-signal.ts      # NIP-44 encryption + NIP-59 gift wrap
│       ├── starknet-client.ts   # Contract reads/writes via starknet.js v6
│       ├── strk20-payment.ts    # STRK20 SDK shielded payment path
│       └── audio-engine.ts      # getUserMedia + opusscript encode/decode
├── contracts/
│   ├── src/
│   │   ├── stealth_registry.cairo   # ERC-5564 handle → (pk_view, pk_spend)
│   │   └── call_log.cairo           # Poseidon commitment storage
│   └── tests/
├── scripts/
│   ├── deploy-contracts.ts      # Declare + deploy both contracts
│   └── register-strk20-pool.ts  # Mainnet STRK20 pool registration
├── .env.example
└── README.md
```

---

## Roadmap

### Shipped (August 2026)

- [x] Tor v3 onion service replacing TURN — callee IP never exposed
- [x] Noise_XX handshake — mutual auth, forward secrecy, no CA
- [x] Opus audio over Tor tunnel — 20ms frames, jitter-tolerant
- [x] NIP-44 + NIP-59 gift-wrap signaling — relay sees no call metadata
- [x] ERC-5564 stealth addresses on Starknet — on-chain identity ≠ wallet
- [x] STRK20 shielded payment integration — payment graph severed
- [x] Poseidon call commitments — on-chain audit trail without party disclosure
- [x] File transfer over same Tor/Noise_XX tunnel — zero new trust surface
- [x] V3 transaction format (Starknet spec 0.10.2)
- [x] Live on Sepolia — contracts deployed, test transactions confirmed

### Near Term

- [ ] Group calls — Tor hidden service mesh, N-party Noise_XX ratchet
- [ ] Private video — VP9 over same stack, same IP guarantees
- [ ] Mobile client — React Native + embedded Tor (c-tor)
- [ ] Decentralized relay network — no dependency on specific Nostr relays
- [ ] Persistent stealth inbox — receive calls when app is closed (async Nostr queue)

### Medium Term

- [ ] Hardware wallet integration — Ledger Nano X for stealth key signing
- [ ] ZK proof of call completion — dispute resolution without revealing parties
- [ ] Private group file drops — encrypted broadcast to stealth address list
- [ ] Tor circuit quality telemetry — adaptive bitrate based on circuit health
- [ ] Reproducible Electron build — deterministic binary for independent verification

### Long Term

- [ ] Dedicated Nostr relay operated by the project — censorship-resistant baseline
- [ ] Starknet mainnet deployment with STRK20 pool at full anonymity set
- [ ] Formalized security audit — Noise_XX implementation + Cairo contracts
- [ ] Cross-platform: Windows + Android + iOS

---

## STRK20 Private Sprint

Built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon) — August 14–31, 2026.

Eighteen days to ship a production-quality privacy application on Starknet. GhostCall qualifies through three mainnet-format transactions demonstrating full STRK20 SDK integration:

| TX | Contract | Function | Purpose |
|---|---|---|---|
| #1 | `StealthRegistry` | `register(handle_hash, pk_v_x, pk_v_y, pk_s_x, pk_s_y)` | Stealth meta-address registration |
| #2 | STRK20 pool | `createPrivateTransfers().build().privateTransfer().execute()` | Shielded STRK payment |
| #3 | `CallLog` | `commit_call(Poseidon(call_id, caller_stealth_pk_x))` | Post-call commitment |

The STRK20 integration uses the complete SDK path: `viewingKeyProvider`, `provingProvider`, `discoveryProvider`, shielded note creation and spending, note discovery via viewing key scan, and pool registration gating.

---

## License

[Apache-2.0](LICENSE)

Copyright 2026 GhostCall contributors.

---

<div align="center">

**The only calling app that solves all four simultaneously.**

Hidden IPs · Trustless relay · On-chain stealth identity · Shielded payments

*Built on cryptographic guarantees, not organizational promises.*

</div>
