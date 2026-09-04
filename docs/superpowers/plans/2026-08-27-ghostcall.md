# GhostCall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a trustless, untraceable 1:1 audio calling Electron app on Starknet mainnet — stealth addresses, Tor onion transport, Noise_XX encryption, STRK20 shielded payments — with 3 mainnet transactions for hackathon qualification.

**Architecture:** Electron desktop app (Node + Chromium). Identity layer: two Cairo contracts on Starknet mainnet (`StealthRegistry`, `CallLog`). Signaling: Nostr NIP-59 gift wrap with ephemeral keys. Media transport: raw Opus audio frames over a Tor v3 onion service encrypted with Noise_XX (ChaCha20-Poly1305). Payment: STRK20 SDK private transfer post-call.

**Tech Stack:** Electron 32, Next.js 14 (App Router), TypeScript, Cairo 2.x, Scarb, starknet.js v6, @starkware-libs/starknet-privacy-sdk, nostr-tools, noise-protocol, opusscript, granax, @noble/curves, @noble/hashes, Tailwind CSS.

## Global Constraints

- Node.js >= 24 (required by starknet-privacy-sdk)
- Cairo 2.x / Scarb for contracts
- Electron 32 — renderer process uses contextIsolation: true, preload scripts for IPC
- All crypto operations (HKDF, ECDH, Noise) run in Node.js main/preload process, not renderer
- `iceTransportPolicy` is irrelevant — no WebRTC ICE at all; audio is TCP over Tor
- Every on-chain write targets Starknet mainnet (chain_id: SN_MAIN)
- `strk20.json` at repo root must be valid before deadline
- Apache-2.0 license

---

## File Structure

```
ghostcall/
├── package.json                        # Electron + Next.js workspace root
├── electron/
│   ├── main.ts                         # Electron main process: window, IPC handlers, tor spawn
│   ├── preload.ts                      # Exposes safe IPC API to renderer (contextBridge)
│   ├── tor-manager.ts                  # Spawn tor binary, control port, ADD_ONION / DEL_ONION
│   ├── onion-server.ts                 # TCP server on 127.0.0.1:7331, accepts Noise_XX handshake
│   ├── onion-client.ts                 # SOCKS5 connect through Tor to .onion:7331, Noise_XX
│   ├── noise-session.ts                # Noise_XX state machine (handshake + transport)
│   └── audio-bridge.ts                 # Capture getUserMedia in renderer → IPC → Node stream; decode → IPC → renderer
├── renderer/                           # Next.js app (runs in Electron renderer)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                    # Home: register or dial screen
│   │   ├── call/page.tsx               # Active call screen (mute, hang up, status)
│   │   └── setup/page.tsx              # First-run: wallet connect + stealth key register
│   ├── lib/
│   │   ├── stealth-keys.ts             # Derive (sk_v, sk_s, pk_v, pk_s) from wallet signature
│   │   ├── nostr-signal.ts             # NIP-44 encrypt/decrypt + NIP-59 gift wrap/unwrap
│   │   ├── starknet-client.ts          # starknet.js provider, account, contract calls
│   │   └── strk20-payment.ts           # createPrivateTransfers wrapper
│   └── components/
│       ├── DialPad.tsx
│       ├── CallScreen.tsx
│       └── WalletConnect.tsx
├── contracts/
│   ├── Scarb.toml
│   ├── src/
│   │   ├── lib.cairo
│   │   ├── stealth_registry.cairo      # register(), get_stealth_meta(), handle_hash lookup
│   │   └── call_log.cairo              # commit_call(), verify_commitment()
│   └── tests/
│       ├── test_stealth_registry.cairo
│       └── test_call_log.cairo
├── scripts/
│   ├── deploy-contracts.ts             # Deploy both contracts to mainnet, output addresses
│   └── gen-strk20-json.ts              # Generate strk20.json from tx hashes + config
└── strk20.json                         # Hackathon submission file (generated, committed)
```

---

## Task 1: Project Scaffold + Electron + Next.js Wired Together

**Files:**
- Create: `package.json`
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `renderer/app/layout.tsx`
- Create: `renderer/app/page.tsx`
- Create: `tsconfig.json`
- Create: `electron-builder.yml`

**Interfaces:**
- Produces: running `npm run dev` opens an Electron window showing Next.js renderer at localhost:3000

- [ ] **Step 1: Init repo and install deps**

```bash
cd /Users/I740422/projects/stark
git init
npm init -y
npm install --save-dev electron@32 electron-builder@25 concurrently cross-env ts-node typescript @types/node @types/react @types/react-dom
npm install next@14 react react-dom tailwindcss
npm install starknet@6 nostr-tools @noble/curves @noble/hashes
npm install noise-protocol opusscript granax
npm install @starkware-libs/starknet-privacy-sdk
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "paths": { "@/*": ["./renderer/*"] }
  },
  "include": ["electron/**/*", "renderer/**/*", "scripts/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `package.json` scripts**

```json
{
  "main": "dist/electron/main.js",
  "scripts": {
    "dev": "concurrently \"next dev renderer\" \"cross-env NODE_ENV=development ts-node electron/main.ts\"",
    "build": "next build renderer && tsc -p tsconfig.json && electron-builder",
    "test": "scarb test"
  }
}
```

- [ ] **Step 4: Write `electron/preload.ts`**

```typescript
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
```

- [ ] **Step 5: Write `electron/main.ts` (skeleton)**

```typescript
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'

let win: BrowserWindow | null = null

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 420,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const url = process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../renderer/out/index.html')}`
  win.loadURL(url)
})

app.on('window-all-closed', () => app.quit())

// IPC stubs — filled in by later tasks
ipcMain.handle('tor:status', async () => ({ running: false }))
```

- [ ] **Step 6: Write `renderer/app/layout.tsx`**

```tsx
import './globals.css'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-black text-white">
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  )
}
```

- [ ] **Step 7: Write `renderer/app/page.tsx` (placeholder)**

```tsx
export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center h-screen gap-6">
      <h1 className="text-3xl font-bold tracking-tight">GhostCall</h1>
      <p className="text-zinc-400 text-sm">Trustless audio. Zero trace.</p>
    </main>
  )
}
```

- [ ] **Step 8: Run and verify Electron window loads**

```bash
npm run dev
```
Expected: Electron window opens, shows "GhostCall" heading. No errors in terminal.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: scaffold Electron + Next.js app"
```

---

## Task 2: Cairo Contracts — StealthRegistry + CallLog

**Files:**
- Create: `contracts/Scarb.toml`
- Create: `contracts/src/lib.cairo`
- Create: `contracts/src/stealth_registry.cairo`
- Create: `contracts/src/call_log.cairo`
- Create: `contracts/tests/test_stealth_registry.cairo`
- Create: `contracts/tests/test_call_log.cairo`

**Interfaces:**
- Produces: `StealthRegistry` — `register(handle_hash: felt252, pk_v_x: felt252, pk_v_y: felt252, pk_s_x: felt252, pk_s_y: felt252)` and `get_stealth_meta(handle_hash: felt252) -> (felt252, felt252, felt252, felt252)`
- Produces: `CallLog` — `commit_call(commitment: felt252)` and `get_commitment(commitment: felt252) -> bool`

- [ ] **Step 1: Install Scarb**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh
scarb --version
```
Expected: `scarb 2.x.x`

- [ ] **Step 2: Init contracts project**

```bash
cd /Users/I740422/projects/stark/contracts
scarb init --name ghostcall_contracts
```

- [ ] **Step 3: Write `contracts/Scarb.toml`**

```toml
[package]
name = "ghostcall_contracts"
version = "0.1.0"
edition = "2024_07"

[dependencies]
starknet = ">=2.6.0"

[[target.starknet-contract]]
sierra = true
casm = true
```

- [ ] **Step 4: Write `contracts/src/stealth_registry.cairo`**

```rust
#[starknet::contract]
mod StealthRegistry {
    use starknet::{ContractAddress, get_caller_address};
    use core::poseidon::poseidon_hash_span;

    #[storage]
    struct Storage {
        // handle_hash -> (pk_v_x, pk_v_y, pk_s_x, pk_s_y)
        meta: LegacyMap<felt252, (felt252, felt252, felt252, felt252)>,
        // handle_hash -> registered bool
        registered: LegacyMap<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Registered: Registered,
    }

    #[derive(Drop, starknet::Event)]
    struct Registered {
        #[key]
        handle_hash: felt252,
        pk_v_x: felt252,
        pk_v_y: felt252,
        pk_s_x: felt252,
        pk_s_y: felt252,
    }

    #[abi(embed_v0)]
    impl StealthRegistryImpl of super::IStealthRegistry<ContractState> {
        fn register(
            ref self: ContractState,
            handle_hash: felt252,
            pk_v_x: felt252,
            pk_v_y: felt252,
            pk_s_x: felt252,
            pk_s_y: felt252,
        ) {
            assert(!self.registered.read(handle_hash), 'handle already taken');
            self.meta.write(handle_hash, (pk_v_x, pk_v_y, pk_s_x, pk_s_y));
            self.registered.write(handle_hash, true);
            self.emit(Registered { handle_hash, pk_v_x, pk_v_y, pk_s_x, pk_s_y });
        }

        fn get_stealth_meta(
            self: @ContractState, handle_hash: felt252
        ) -> (felt252, felt252, felt252, felt252) {
            assert(self.registered.read(handle_hash), 'handle not found');
            self.meta.read(handle_hash)
        }

        fn is_registered(self: @ContractState, handle_hash: felt252) -> bool {
            self.registered.read(handle_hash)
        }
    }
}

#[starknet::interface]
trait IStealthRegistry<TState> {
    fn register(
        ref self: TState,
        handle_hash: felt252,
        pk_v_x: felt252,
        pk_v_y: felt252,
        pk_s_x: felt252,
        pk_s_y: felt252,
    );
    fn get_stealth_meta(self: @TState, handle_hash: felt252) -> (felt252, felt252, felt252, felt252);
    fn is_registered(self: @TState, handle_hash: felt252) -> bool;
}
```

- [ ] **Step 5: Write `contracts/src/call_log.cairo`**

```rust
#[starknet::contract]
mod CallLog {
    #[storage]
    struct Storage {
        commitments: LegacyMap<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        CallCommitted: CallCommitted,
    }

    #[derive(Drop, starknet::Event)]
    struct CallCommitted {
        #[key]
        commitment: felt252,
    }

    #[abi(embed_v0)]
    impl CallLogImpl of super::ICallLog<ContractState> {
        fn commit_call(ref self: ContractState, commitment: felt252) {
            assert(!self.commitments.read(commitment), 'already committed');
            self.commitments.write(commitment, true);
            self.emit(CallCommitted { commitment });
        }

        fn is_committed(self: @ContractState, commitment: felt252) -> bool {
            self.commitments.read(commitment)
        }
    }
}

#[starknet::interface]
trait ICallLog<TState> {
    fn commit_call(ref self: TState, commitment: felt252);
    fn is_committed(self: @TState, commitment: felt252) -> bool;
}
```

- [ ] **Step 6: Write `contracts/src/lib.cairo`**

```rust
pub mod stealth_registry;
pub mod call_log;
```

- [ ] **Step 7: Write `contracts/tests/test_stealth_registry.cairo`**

```rust
#[cfg(test)]
mod test_stealth_registry {
    use ghostcall_contracts::stealth_registry::{
        StealthRegistry, IStealthRegistryDispatcher, IStealthRegistryDispatcherTrait
    };
    use starknet::testing;

    fn deploy() -> IStealthRegistryDispatcher {
        // deploy contract in test environment
        let contract = starknet::deploy_syscall(
            StealthRegistry::TEST_CLASS_HASH.try_into().unwrap(),
            0, array![].span(), false
        ).unwrap();
        IStealthRegistryDispatcher { contract_address: contract.0 }
    }

    #[test]
    fn test_register_and_lookup() {
        let contract = deploy();
        let handle_hash: felt252 = 0xdeadbeef;
        let pk_v_x: felt252 = 0x1111;
        let pk_v_y: felt252 = 0x2222;
        let pk_s_x: felt252 = 0x3333;
        let pk_s_y: felt252 = 0x4444;

        contract.register(handle_hash, pk_v_x, pk_v_y, pk_s_x, pk_s_y);

        let (rvx, rvy, rsx, rsy) = contract.get_stealth_meta(handle_hash);
        assert(rvx == pk_v_x, 'pk_v_x mismatch');
        assert(rvy == pk_v_y, 'pk_v_y mismatch');
        assert(rsx == pk_s_x, 'pk_s_x mismatch');
        assert(rsy == pk_s_y, 'pk_s_y mismatch');
    }

    #[test]
    #[should_panic(expected: ('handle already taken',))]
    fn test_register_duplicate_fails() {
        let contract = deploy();
        contract.register(0xabc, 1, 2, 3, 4);
        contract.register(0xabc, 5, 6, 7, 8); // must panic
    }

    #[test]
    #[should_panic(expected: ('handle not found',))]
    fn test_lookup_unregistered_fails() {
        let contract = deploy();
        contract.get_stealth_meta(0xdeadbeef); // must panic
    }
}
```

- [ ] **Step 8: Write `contracts/tests/test_call_log.cairo`**

```rust
#[cfg(test)]
mod test_call_log {
    use ghostcall_contracts::call_log::{
        CallLog, ICallLogDispatcher, ICallLogDispatcherTrait
    };

    fn deploy() -> ICallLogDispatcher {
        let contract = starknet::deploy_syscall(
            CallLog::TEST_CLASS_HASH.try_into().unwrap(),
            0, array![].span(), false
        ).unwrap();
        ICallLogDispatcher { contract_address: contract.0 }
    }

    #[test]
    fn test_commit_and_query() {
        let contract = deploy();
        let commitment: felt252 = 0xcafebabe;
        assert(!contract.is_committed(commitment), 'should not be committed yet');
        contract.commit_call(commitment);
        assert(contract.is_committed(commitment), 'should be committed');
    }

    #[test]
    #[should_panic(expected: ('already committed',))]
    fn test_double_commit_fails() {
        let contract = deploy();
        contract.commit_call(0x1234);
        contract.commit_call(0x1234); // must panic
    }
}
```

- [ ] **Step 9: Run tests**

```bash
cd /Users/I740422/projects/stark/contracts
scarb test
```
Expected: all 5 tests pass (3 StealthRegistry + 2 CallLog).

- [ ] **Step 10: Build contracts**

```bash
scarb build
```
Expected: Sierra + CASM artifacts in `target/dev/`.

- [ ] **Step 11: Commit**

```bash
cd /Users/I740422/projects/stark
git add contracts/
git commit -m "feat: Cairo StealthRegistry + CallLog contracts with tests"
```

---

## Task 3: Deploy Contracts to Starknet Mainnet (TX #1 prep)

**Files:**
- Create: `scripts/deploy-contracts.ts`
- Create: `.env.example`
- Create: `.env` (gitignored)

**Interfaces:**
- Produces: deployed contract addresses written to `contracts/deployments.json`
- Consumes: `STARKNET_ACCOUNT_ADDRESS`, `STARKNET_PRIVATE_KEY` from `.env`

- [ ] **Step 1: Write `.env.example`**

```bash
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
STARKNET_RPC_URL=https://starknet-mainnet.public.blastapi.io/rpc/v0_7
NOSTR_RELAY_URL=wss://relay.damus.io
STRK20_POOL_ADDRESS=0x...
STRK20_PROVER_URL=https://prover.strk20.starknet.io
STRK20_DISCOVERY_URL=https://discovery.strk20.starknet.io
```

- [ ] **Step 2: Add `.env` to `.gitignore`**

```bash
echo ".env" >> .gitignore
echo "node_modules" >> .gitignore
echo "dist" >> .gitignore
echo ".next" >> .gitignore
```

- [ ] **Step 3: Write `scripts/deploy-contracts.ts`**

```typescript
import { RpcProvider, Account, Contract, json, stark } from 'starknet'
import { readFileSync, writeFileSync } from 'fs'
import * as dotenv from 'dotenv'
dotenv.config()

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! })
const account = new Account(
  provider,
  process.env.STARKNET_ACCOUNT_ADDRESS!,
  process.env.STARKNET_PRIVATE_KEY!
)

async function deployContract(name: string, constructorCalldata: string[] = []) {
  const sierra = json.parse(
    readFileSync(`contracts/target/dev/ghostcall_contracts_${name}.contract_class.json`, 'utf8')
  )
  const casm = json.parse(
    readFileSync(`contracts/target/dev/ghostcall_contracts_${name}.compiled_contract_class.json`, 'utf8')
  )
  console.log(`Declaring ${name}...`)
  const declareRes = await account.declare({ contract: sierra, casm })
  await provider.waitForTransaction(declareRes.transaction_hash)
  console.log(`Deploying ${name}...`)
  const deployRes = await account.deployContract({
    classHash: declareRes.class_hash,
    constructorCalldata,
    salt: stark.randomAddress(),
  })
  await provider.waitForTransaction(deployRes.transaction_hash)
  console.log(`${name} deployed at: ${deployRes.contract_address}`)
  return { classHash: declareRes.class_hash, address: deployRes.contract_address, deployTx: deployRes.transaction_hash }
}

async function main() {
  const registry = await deployContract('StealthRegistry')
  const callLog = await deployContract('CallLog')
  const deployments = { StealthRegistry: registry, CallLog: callLog }
  writeFileSync('contracts/deployments.json', JSON.stringify(deployments, null, 2))
  console.log('Deployments saved to contracts/deployments.json')
}

main().catch(console.error)
```

- [ ] **Step 4: Deploy (requires funded mainnet account)**

```bash
cd /Users/I740422/projects/stark
cp .env.example .env
# Fill in STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY
npx ts-node scripts/deploy-contracts.ts
```
Expected: `contracts/deployments.json` created with two contract addresses + tx hashes.

- [ ] **Step 5: Commit deployments (not .env)**

```bash
git add contracts/deployments.json
git commit -m "feat: deploy StealthRegistry + CallLog to Starknet mainnet"
```

---

## Task 4: Stealth Key Derivation + Starknet Client

**Files:**
- Create: `renderer/lib/stealth-keys.ts`
- Create: `renderer/lib/starknet-client.ts`

**Interfaces:**
- Produces: `deriveStealthKeypair(walletSig: {r: bigint, s: bigint}): {skV: bigint, skS: bigint, pkV: {x: bigint, y: bigint}, pkS: {x: bigint, y: bigint}}`
- Produces: `registerHandle(handle: string, keypair: StealthKeypair): Promise<string>` — returns tx hash
- Produces: `lookupHandle(handle: string): Promise<StealthMeta>` — returns `{pkVx, pkVy, pkSx, pkSy}`
- Consumes: `starknet.js` Account + deployed contract address from `deployments.json`

- [ ] **Step 1: Write failing test for stealth key derivation**

```typescript
// renderer/lib/__tests__/stealth-keys.test.ts
import { deriveStealthKeypair, deriveHandleHash } from '../stealth-keys'

test('deriveStealthKeypair produces valid secp256k1 points', () => {
  const sig = { r: 0xdeadbeefn, s: 0xcafebaben }
  const kp = deriveStealthKeypair(sig)
  expect(kp.skV).toBeGreaterThan(0n)
  expect(kp.skS).toBeGreaterThan(0n)
  expect(kp.pkV.x).toBeGreaterThan(0n)
  expect(kp.pkS.x).toBeGreaterThan(0n)
  // same sig → same keys (deterministic)
  const kp2 = deriveStealthKeypair(sig)
  expect(kp2.skV).toBe(kp.skV)
})

test('deriveHandleHash is deterministic', () => {
  const h1 = deriveHandleHash('alice')
  const h2 = deriveHandleHash('alice')
  expect(h1).toBe(h2)
  expect(deriveHandleHash('alice')).not.toBe(deriveHandleHash('bob'))
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx jest renderer/lib/__tests__/stealth-keys.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `renderer/lib/stealth-keys.ts`**

```typescript
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { secp256k1 } from '@noble/curves/secp256k1'

export interface StealthKeypair {
  skV: bigint
  skS: bigint
  pkV: { x: bigint; y: bigint }
  pkS: { x: bigint; y: bigint }
}

export interface StealthMeta {
  pkVx: bigint; pkVy: bigint
  pkSx: bigint; pkSy: bigint
}

// Derives deterministic stealth keypair from a wallet signature.
// The signature must be over a fixed message so the same wallet always
// produces the same stealth keys — never reuse r,s from a tx.
export function deriveStealthKeypair(sig: { r: bigint; s: bigint }): StealthKeypair {
  const sigBytes = new Uint8Array(64)
  const rBytes = bigintToBytes32(sig.r)
  const sBytes = bigintToBytes32(sig.s)
  sigBytes.set(rBytes, 0)
  sigBytes.set(sBytes, 32)

  const skVBytes = hkdf(sha256, sigBytes, undefined, 'ghostcall-viewing-key-v1', 32)
  const skSBytes = hkdf(sha256, sigBytes, undefined, 'ghostcall-spending-key-v1', 32)

  const skV = secp256k1.utils.normPrivateKeyToScalar(skVBytes)
  const skS = secp256k1.utils.normPrivateKeyToScalar(skSBytes)
  const pkV = secp256k1.ProjectivePoint.fromPrivateKey(skV)
  const pkS = secp256k1.ProjectivePoint.fromPrivateKey(skS)

  return {
    skV, skS,
    pkV: { x: pkV.x, y: pkV.y },
    pkS: { x: pkS.x, y: pkS.y },
  }
}

// Derive a nostr-compatible one-time pubkey for signaling.
// ECDH: caller uses their ephemeral r; callee uses their sk_v.
export function deriveSessionKey(localPriv: bigint, remotePubX: bigint, remotePubY: bigint): Uint8Array {
  const remotePoint = secp256k1.ProjectivePoint.fromAffine({ x: remotePubX, y: remotePubY })
  const shared = remotePoint.multiply(localPriv)
  const sharedBytes = bigintToBytes32(shared.x)
  return hkdf(sha256, sharedBytes, undefined, 'ghostcall-session-v1', 32)
}

// Handle hash for on-chain storage — keccak of lowercase handle.
export function deriveHandleHash(handle: string): bigint {
  const bytes = new TextEncoder().encode(handle.toLowerCase().trim())
  const hash = sha256(bytes)
  // Truncate to felt252 (< 2^251) by masking top bits
  const full = bytesToBigint(hash)
  return full & ((1n << 251n) - 1n)
}

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0')
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

function bytesToBigint(bytes: Uint8Array): bigint {
  return BigInt('0x' + Buffer.from(bytes).toString('hex'))
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx jest renderer/lib/__tests__/stealth-keys.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Write `renderer/lib/starknet-client.ts`**

```typescript
import { RpcProvider, Account, Contract, CallData, num } from 'starknet'
import { StealthKeypair, StealthMeta, deriveHandleHash } from './stealth-keys'
import deployments from '../../contracts/deployments.json'

// Initialized once with wallet credentials from the renderer IPC bridge
let _provider: RpcProvider
let _account: Account

export function initStarknetClient(rpcUrl: string, accountAddress: string, privateKey: string) {
  _provider = new RpcProvider({ nodeUrl: rpcUrl })
  _account = new Account(_provider, accountAddress, privateKey)
}

// TX #1 — register stealth meta-address on mainnet
export async function registerHandle(handle: string, kp: StealthKeypair): Promise<string> {
  const handleHash = deriveHandleHash(handle)
  const contract = new Contract(STEALTH_REGISTRY_ABI, deployments.StealthRegistry.address, _account)
  const res = await contract.register(
    num.toHex(handleHash),
    num.toHex(kp.pkV.x),
    num.toHex(kp.pkV.y),
    num.toHex(kp.pkS.x),
    num.toHex(kp.pkS.y),
  )
  await _provider.waitForTransaction(res.transaction_hash)
  return res.transaction_hash
}

export async function lookupHandle(handle: string): Promise<StealthMeta> {
  const handleHash = deriveHandleHash(handle)
  const contract = new Contract(STEALTH_REGISTRY_ABI, deployments.StealthRegistry.address, _provider)
  const [pkVx, pkVy, pkSx, pkSy] = await contract.get_stealth_meta(num.toHex(handleHash))
  return {
    pkVx: BigInt(pkVx), pkVy: BigInt(pkVy),
    pkSx: BigInt(pkSx), pkSy: BigInt(pkSy),
  }
}

// TX #3 — commit call receipt hash on-chain
export async function commitCall(callId: string): Promise<string> {
  const contract = new Contract(CALL_LOG_ABI, deployments.CallLog.address, _account)
  const res = await contract.commit_call(callId)
  await _provider.waitForTransaction(res.transaction_hash)
  return res.transaction_hash
}

const STEALTH_REGISTRY_ABI = [
  { type: 'function', name: 'register', inputs: [
    { name: 'handle_hash', type: 'felt252' },
    { name: 'pk_v_x', type: 'felt252' }, { name: 'pk_v_y', type: 'felt252' },
    { name: 'pk_s_x', type: 'felt252' }, { name: 'pk_s_y', type: 'felt252' },
  ], outputs: [], state_mutability: 'external' },
  { type: 'function', name: 'get_stealth_meta', inputs: [
    { name: 'handle_hash', type: 'felt252' }
  ], outputs: [
    { type: '(felt252, felt252, felt252, felt252)' }
  ], state_mutability: 'view' },
]

const CALL_LOG_ABI = [
  { type: 'function', name: 'commit_call', inputs: [
    { name: 'commitment', type: 'felt252' }
  ], outputs: [], state_mutability: 'external' },
]
```

- [ ] **Step 6: Commit**

```bash
git add renderer/lib/stealth-keys.ts renderer/lib/starknet-client.ts renderer/lib/__tests__/
git commit -m "feat: stealth key derivation + starknet client (register, lookup, commitCall)"
```

---

## Task 5: Nostr Signaling — NIP-44 + NIP-59 Gift Wrap

**Files:**
- Create: `renderer/lib/nostr-signal.ts`
- Create: `renderer/lib/__tests__/nostr-signal.test.ts`

**Interfaces:**
- Produces: `buildCallOffer(callerEphSkV: bigint, calleeMeta: StealthMeta, onionAddr: string, callId: string): Promise<string>` — returns serialized gift-wrap event JSON
- Produces: `parseCallOffer(eventJson: string, mySkV: bigint): Promise<{onionAddr: string, callId: string, callerNoisePubkey: string} | null>`
- Produces: `publishToRelay(relayUrl: string, eventJson: string): Promise<void>`
- Produces: `subscribeIncoming(relayUrl: string, myEphPubkey: string, onMessage: (raw: string) => void): () => void`

- [ ] **Step 1: Write failing tests**

```typescript
// renderer/lib/__tests__/nostr-signal.test.ts
import { buildCallOffer, parseCallOffer } from '../nostr-signal'
import { secp256k1 } from '@noble/curves/secp256k1'

test('roundtrip: buildCallOffer → parseCallOffer recovers onionAddr and callId', async () => {
  // Callee keypair
  const calleeSkV = secp256k1.utils.randomPrivateKey()
  const calleeSkVBig = BigInt('0x' + Buffer.from(calleeSkV).toString('hex'))
  const calleePkV = secp256k1.ProjectivePoint.fromPrivateKey(calleeSkV)
  const calleeMeta = {
    pkVx: calleePkV.x, pkVy: calleePkV.y,
    pkSx: calleePkV.x, pkSy: calleePkV.y, // simplified for test
  }

  // Caller ephemeral key
  const callerSkV = secp256k1.utils.randomPrivateKey()
  const callerSkVBig = BigInt('0x' + Buffer.from(callerSkV).toString('hex'))

  const onionAddr = 'aaaabbbbccccdddd.onion:7331'
  const callId = '0xdeadbeef1234'

  const eventJson = await buildCallOffer(callerSkVBig, calleeMeta, onionAddr, callId)
  const parsed = await parseCallOffer(eventJson, calleeSkVBig)

  expect(parsed).not.toBeNull()
  expect(parsed!.onionAddr).toBe(onionAddr)
  expect(parsed!.callId).toBe(callId)
})
```

- [ ] **Step 2: Run — verify fails**

```bash
npx jest renderer/lib/__tests__/nostr-signal.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `renderer/lib/nostr-signal.ts`**

```typescript
import {
  generateSecretKey, getPublicKey, finalizeEvent,
} from 'nostr-tools/pure'
import { nip44, nip59 } from 'nostr-tools'
import { secp256k1 } from '@noble/curves/secp256k1'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import type { StealthMeta } from './stealth-keys'

// Derive a deterministic nostr privkey from a stealth viewing key scalar
// so we can receive messages at a consistent pubkey per session
export function stealthToNostrKey(skV: bigint): Uint8Array {
  const skBytes = bigintToBytes32(skV)
  return hkdf(sha256, skBytes, undefined, 'ghostcall-nostr-key-v1', 32)
}

interface CallSignalPayload {
  onionAddr: string
  callId: string
  callerNoisePubkey: string  // hex of caller's Noise_XX ephemeral pubkey
}

// Build a NIP-59 gift-wrapped call offer from caller to callee.
// The gift wrap conceals both sender and recipient identity.
export async function buildCallOffer(
  callerEphSkV: bigint,
  calleeMeta: StealthMeta,
  onionAddr: string,
  callId: string,
  callerNoisePubkey: string = '',
): Promise<string> {
  // Derive shared session key via ECDH
  const remotePoint = secp256k1.ProjectivePoint.fromAffine({
    x: calleeMeta.pkVx, y: calleeMeta.pkVy,
  })
  const shared = remotePoint.multiply(callerEphSkV)
  const sharedBytes = bigintToBytes32(shared.x)
  // Use sharedBytes as NIP-44 conversation key input (skip hkdf — nip44 does its own)
  const callerSkBytes = bigintToBytes32(callerEphSkV)
  const callerSk = callerSkBytes
  const calleePubBytes = serializePoint(calleeMeta.pkVx, calleeMeta.pkVy)
  // Derive callee nostr pubkey from their viewing key via ECC compress
  const calleePubHex = Buffer.from(calleePubBytes).toString('hex').slice(2) // strip prefix

  const payload: CallSignalPayload = { onionAddr, callId, callerNoisePubkey }
  const plaintext = JSON.stringify(payload)

  // NIP-44 encrypt inner content
  const convKey = nip44.utils.getConversationKey(callerSk, calleePubHex)
  const ciphertext = nip44.encrypt(plaintext, convKey)

  // Build kind:14 rumor (unsigned inner event)
  const rumor = {
    kind: 14,
    content: ciphertext,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', calleePubHex]],
    pubkey: getPublicKey(callerSk),
  }

  // NIP-59 gift wrap: seal then wrap with random one-time key
  const sealerSk = generateSecretKey()
  const wrapperSk = generateSecretKey()

  // Seal: encrypt rumor with sender's ephemeral key to callee pubkey
  const sealConvKey = nip44.utils.getConversationKey(sealerSk, calleePubHex)
  const sealedContent = nip44.encrypt(JSON.stringify(rumor), sealConvKey)
  const seal = finalizeEvent({
    kind: 13,
    content: sealedContent,
    created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
    tags: [],
  }, sealerSk)

  // Gift wrap: encrypt seal with wrapper key, tag with callee pubkey
  const wrapConvKey = nip44.utils.getConversationKey(wrapperSk, calleePubHex)
  const wrappedContent = nip44.encrypt(JSON.stringify(seal), wrapConvKey)
  const giftWrap = finalizeEvent({
    kind: 1059,
    content: wrappedContent,
    created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
    tags: [['p', calleePubHex]],
  }, wrapperSk)

  return JSON.stringify(giftWrap)
}

// Parse an incoming gift-wrapped call offer using callee's viewing key
export async function parseCallOffer(
  eventJson: string,
  mySkV: bigint,
): Promise<CallSignalPayload | null> {
  try {
    const giftWrap = JSON.parse(eventJson)
    const mySkBytes = bigintToBytes32(mySkV)
    const myPubHex = getPublicKey(mySkBytes)

    // Unwrap outer gift wrap
    const wrapConvKey = nip44.utils.getConversationKey(mySkBytes, giftWrap.pubkey)
    const sealJson = nip44.decrypt(giftWrap.content, wrapConvKey)
    const seal = JSON.parse(sealJson)

    // Unseal inner seal
    const sealConvKey = nip44.utils.getConversationKey(mySkBytes, seal.pubkey)
    const rumorJson = nip44.decrypt(seal.content, sealConvKey)
    const rumor = JSON.parse(rumorJson)

    // Decrypt rumor content
    const callerPubHex = rumor.pubkey
    const innerConvKey = nip44.utils.getConversationKey(mySkBytes, callerPubHex)
    const plaintext = nip44.decrypt(rumor.content, innerConvKey)
    return JSON.parse(plaintext) as CallSignalPayload
  } catch {
    return null
  }
}

// Publish event to a Nostr relay via WebSocket
export function publishToRelay(relayUrl: string, eventJson: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl)
    ws.onopen = () => {
      ws.send(JSON.stringify(['EVENT', JSON.parse(eventJson)]))
    }
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data as string)
      if (data[0] === 'OK') { ws.close(); resolve() }
    }
    ws.onerror = (e) => reject(e)
    setTimeout(() => reject(new Error('relay timeout')), 5000)
  })
}

// Subscribe to incoming gift-wrapped events tagged with myPubHex
export function subscribeIncoming(
  relayUrl: string,
  myPubHex: string,
  onMessage: (raw: string) => void,
): () => void {
  const ws = new WebSocket(relayUrl)
  const subId = Math.random().toString(36).slice(2)
  ws.onopen = () => {
    ws.send(JSON.stringify(['REQ', subId, { kinds: [1059], '#p': [myPubHex] }]))
  }
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data as string)
    if (data[0] === 'EVENT' && data[1] === subId) {
      onMessage(JSON.stringify(data[2]))
    }
  }
  return () => ws.close()
}

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0')
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

function serializePoint(x: bigint, y: bigint): Uint8Array {
  // compressed SEC format: 02 if y is even, 03 if odd
  const prefix = (y & 1n) === 0n ? 0x02 : 0x03
  const bytes = new Uint8Array(33)
  bytes[0] = prefix
  bytes.set(bigintToBytes32(x), 1)
  return bytes
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx jest renderer/lib/__tests__/nostr-signal.test.ts
```
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add renderer/lib/nostr-signal.ts renderer/lib/__tests__/nostr-signal.test.ts
git commit -m "feat: Nostr NIP-44/NIP-59 signaling — buildCallOffer + parseCallOffer"
```

---

## Task 6: Tor Manager — Spawn Tor, Control Port, Onion Service

**Files:**
- Create: `electron/tor-manager.ts`
- Create: `electron/onion-server.ts`

**Interfaces:**
- Produces: `TorManager.start(): Promise<void>` — spawns `tor` binary, waits for SOCKS5 port 9050 ready
- Produces: `TorManager.addOnion(): Promise<string>` — returns `.onion` address (e.g. `abc123.onion`)
- Produces: `TorManager.removeOnion(serviceId: string): Promise<void>`
- Produces: `TorManager.stop(): void`
- Produces: `OnionServer.listen(port: number, onConnection: (socket: net.Socket) => void): Promise<void>`

- [ ] **Step 1: Write `electron/tor-manager.ts`**

```typescript
import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import * as path from 'path'
// granax: Node.js Tor control port client
// npm install granax
const Tor = require('granax')

export class TorManager {
  private proc: ChildProcess | null = null
  private control: any = null
  private activeOnions: Set<string> = new Set()

  // Start bundled tor binary and wait for SOCKS5 to be ready
  async start(): Promise<void> {
    // Try system tor first, fall back to bundled
    const torBin = process.env.TOR_BINARY_PATH || 'tor'
    return new Promise((resolve, reject) => {
      this.proc = spawn(torBin, [
        '--SocksPort', '9050',
        '--ControlPort', '9051',
        '--CookieAuthentication', '1',
        '--DataDirectory', path.join(process.env.HOME || '/tmp', '.ghostcall-tor'),
      ], { stdio: ['ignore', 'pipe', 'pipe'] })

      this.proc.stderr?.on('data', (d: Buffer) => {
        const line = d.toString()
        if (line.includes('Bootstrapped 100%')) {
          this.connectControl().then(resolve).catch(reject)
        }
      })
      this.proc.on('error', reject)
      // Timeout after 60s
      setTimeout(() => reject(new Error('Tor failed to start within 60s')), 60000)
    })
  }

  private async connectControl(): Promise<void> {
    return new Promise((resolve, reject) => {
      // granax auto-authenticates using cookie file
      this.control = new Tor({ port: 9051 })
      this.control.on('ready', resolve)
      this.control.on('error', reject)
    })
  }

  // Create a fresh v3 ephemeral onion service, returns full .onion:port string
  async addOnion(localPort: number = 7331): Promise<string> {
    return new Promise((resolve, reject) => {
      this.control.createHiddenService(
        `${localPort}`,
        { keyType: 'NEW', keyBlob: 'ED25519-V3' },
        (err: Error | null, serviceId: string) => {
          if (err) return reject(err)
          this.activeOnions.add(serviceId)
          resolve(`${serviceId}.onion:${localPort}`)
        }
      )
    })
  }

  async removeOnion(serviceId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.control.destroyHiddenService(serviceId, (err: Error | null) => {
        if (err) return reject(err)
        this.activeOnions.delete(serviceId)
        resolve()
      })
    })
  }

  getSocksProxy(): { host: string; port: number } {
    return { host: '127.0.0.1', port: 9050 }
  }

  stop() {
    this.proc?.kill()
  }
}

export const torManager = new TorManager()
```

- [ ] **Step 2: Write `electron/onion-server.ts`**

```typescript
import * as net from 'net'

// TCP server that binds on localhost:port — Tor routes external .onion
// connections to this local port. Caller gets one socket per inbound connection.
export class OnionServer {
  private server: net.Server | null = null

  listen(
    port: number,
    onConnection: (socket: net.Socket) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer(onConnection)
      this.server.listen(port, '127.0.0.1', () => resolve())
      this.server.on('error', reject)
    })
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server?.close(() => resolve()))
  }
}

export const onionServer = new OnionServer()
```

- [ ] **Step 3: Wire into `electron/main.ts` IPC handler**

Add to `electron/main.ts`:
```typescript
import { torManager } from './tor-manager'
import { onionServer } from './onion-server'

// Start Tor when app is ready (before any call)
app.whenReady().then(async () => {
  // ... existing window setup ...
  try {
    await torManager.start()
    console.log('Tor started, SOCKS5 on :9050')
  } catch (e) {
    console.error('Tor failed to start:', e)
  }
})

ipcMain.handle('tor:status', async () => ({
  running: torManager !== null,
  socksProxy: torManager.getSocksProxy(),
}))

ipcMain.handle('tor:add-onion', async (_e, { port }: { port: number }) => {
  return torManager.addOnion(port)
})

ipcMain.handle('tor:remove-onion', async (_e, { serviceId }: { serviceId: string }) => {
  return torManager.removeOnion(serviceId)
})

app.on('before-quit', () => torManager.stop())
```

- [ ] **Step 4: Manual smoke test**

```bash
# Ensure tor is installed
brew install tor   # or: apt install tor
npm run dev
```
Expected: Electron console logs "Tor started, SOCKS5 on :9050" within ~30s of launch.

- [ ] **Step 5: Commit**

```bash
git add electron/tor-manager.ts electron/onion-server.ts electron/main.ts
git commit -m "feat: TorManager + OnionServer — spawn tor, ADD_ONION, TCP listener"
```

---

## Task 7: Noise_XX Session — Handshake + Framed Transport

**Files:**
- Create: `electron/noise-session.ts`
- Create: `electron/noise-session.test.ts`

**Interfaces:**
- Produces: `NoiseSession.handshakeInitiator(socket: net.Socket, localStaticPriv: Uint8Array): Promise<{send: (frame: Buffer) => void, recv: AsyncIterable<Buffer>}>`
- Produces: `NoiseSession.handshakeResponder(socket: net.Socket, localStaticPriv: Uint8Array): Promise<{send: (frame: Buffer) => void, recv: AsyncIterable<Buffer>}>`

- [ ] **Step 1: Write failing test**

```typescript
// electron/noise-session.test.ts
import * as net from 'net'
import { NoiseSession } from './noise-session'

test('Noise_XX: initiator and responder establish session and exchange frames', (done) => {
  const server = net.createServer(async (serverSocket) => {
    const { send, recv } = await NoiseSession.handshakeResponder(serverSocket, responderStatic)
    for await (const frame of recv) {
      expect(frame.toString()).toBe('hello from initiator')
      send(Buffer.from('hello from responder'))
      server.close()
      done()
      break
    }
  })
  server.listen(19999, '127.0.0.1', async () => {
    const clientSocket = net.connect(19999, '127.0.0.1')
    clientSocket.on('connect', async () => {
      const { send, recv } = await NoiseSession.handshakeInitiator(clientSocket, initiatorStatic)
      send(Buffer.from('hello from initiator'))
      for await (const frame of recv) {
        expect(frame.toString()).toBe('hello from responder')
        break
      }
    })
  })
}, 5000)

// Test static keys
import { x25519 } from '@noble/curves/ed25519'
const initiatorStatic = x25519.utils.randomPrivateKey()
const responderStatic = x25519.utils.randomPrivateKey()
```

- [ ] **Step 2: Run — verify fails**

```bash
npx jest electron/noise-session.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `electron/noise-session.ts`**

```typescript
import * as net from 'net'
// noise-protocol implements Noise_XX with X25519 + ChaCha20-Poly1305 + SHA256
const noise = require('noise-protocol')

export interface NoiseTransport {
  send: (frame: Buffer) => void
  recv: AsyncIterable<Buffer>
}

export class NoiseSession {
  // Initiator side: -> e; <- e,ee,s,es; -> s,se
  static async handshakeInitiator(
    socket: net.Socket,
    localStaticPriv: Uint8Array,
  ): Promise<NoiseTransport> {
    const localStaticPub = noise.keygen(localStaticPriv).publicKey
    const hs = noise.initialize('XX', true, Buffer.alloc(0), {
      s: { publicKey: localStaticPub, secretKey: localStaticPriv },
    })
    return performHandshake(hs, socket)
  }

  // Responder side: <- e; -> e,ee,s,es; <- s,se
  static async handshakeResponder(
    socket: net.Socket,
    localStaticPriv: Uint8Array,
  ): Promise<NoiseTransport> {
    const localStaticPub = noise.keygen(localStaticPriv).publicKey
    const hs = noise.initialize('XX', false, Buffer.alloc(0), {
      s: { publicKey: localStaticPub, secretKey: localStaticPriv },
    })
    return performHandshake(hs, socket)
  }
}

async function performHandshake(
  hs: any,
  socket: net.Socket,
): Promise<NoiseTransport> {
  const readExact = makeFrameReader(socket)

  while (!hs.complete) {
    if (hs.action === 'send') {
      const msg = noise.writeMessage(hs, Buffer.alloc(0))
      // Length-prefix: 2-byte big-endian
      const frame = Buffer.alloc(2 + msg.length)
      frame.writeUInt16BE(msg.length, 0)
      msg.copy(frame, 2)
      await socketWrite(socket, frame)
    } else if (hs.action === 'recv') {
      const incoming = await readExact()
      noise.readMessage(hs, incoming, Buffer.alloc(0))
    }
  }

  const { tx, rx } = hs.split()

  // Transport layer: length-prefixed ChaCha20-Poly1305 frames
  function send(plaintext: Buffer) {
    const ct = noise.encryptWithAd(tx, Buffer.alloc(0), plaintext)
    const frame = Buffer.alloc(2 + ct.length)
    frame.writeUInt16BE(ct.length, 0)
    ct.copy(frame, 2)
    socket.write(frame)
  }

  async function* recv(): AsyncIterable<Buffer> {
    while (true) {
      const ct = await readExact()
      if (!ct || ct.length === 0) return
      const pt = noise.decryptWithAd(rx, Buffer.alloc(0), ct)
      yield pt as Buffer
    }
  }

  return { send, recv: recv() }
}

// Read exactly one length-prefixed frame from socket
function makeFrameReader(socket: net.Socket) {
  let buf = Buffer.alloc(0)
  const queue: Buffer[] = []
  let resolve: ((b: Buffer) => void) | null = null

  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 2) {
      const len = buf.readUInt16BE(0)
      if (buf.length < 2 + len) break
      const frame = buf.slice(2, 2 + len)
      buf = buf.slice(2 + len)
      if (resolve) { resolve(frame); resolve = null }
      else queue.push(frame)
    }
  })

  return (): Promise<Buffer> => {
    if (queue.length > 0) return Promise.resolve(queue.shift()!)
    return new Promise((res) => { resolve = res })
  }
}

function socketWrite(socket: net.Socket, data: Buffer): Promise<void> {
  return new Promise((res, rej) =>
    socket.write(data, (err) => err ? rej(err) : res())
  )
}
```

- [ ] **Step 4: Run test — verify passes**

```bash
npx jest electron/noise-session.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/noise-session.ts electron/noise-session.test.ts
git commit -m "feat: Noise_XX session — handshake + framed ChaCha20-Poly1305 transport"
```

---

## Task 8: Onion Client — SOCKS5 Connect Through Tor

**Files:**
- Create: `electron/onion-client.ts`

**Interfaces:**
- Produces: `connectToOnion(onionAddr: string, socksProxy: {host: string, port: number}): Promise<net.Socket>`
- Consumes: `torManager.getSocksProxy()`, `onionAddr` string like `abc123.onion:7331`

- [ ] **Step 1: Write `electron/onion-client.ts`**

```typescript
import * as net from 'net'

// SOCKS5 connect to a .onion address through local Tor proxy
export function connectToOnion(
  onionAddr: string,
  socks: { host: string; port: number },
): Promise<net.Socket> {
  const [host, portStr] = onionAddr.split(':')
  const destPort = parseInt(portStr, 10)

  return new Promise((resolve, reject) => {
    const socket = net.connect(socks.port, socks.host, () => {
      // SOCKS5 greeting: version=5, nmethods=1, method=0 (no auth)
      socket.write(Buffer.from([0x05, 0x01, 0x00]))
    })

    socket.once('data', (res: Buffer) => {
      // Server choice: 05 00 = no auth
      if (res[0] !== 0x05 || res[1] !== 0x00) {
        return reject(new Error(`SOCKS5 auth negotiation failed: ${res.toString('hex')}`))
      }
      // SOCKS5 CONNECT request for .onion domain
      const hostBuf = Buffer.from(host, 'ascii')
      const req = Buffer.alloc(7 + hostBuf.length)
      req[0] = 0x05   // version
      req[1] = 0x01   // CONNECT
      req[2] = 0x00   // reserved
      req[3] = 0x03   // DOMAINNAME address type
      req[4] = hostBuf.length
      hostBuf.copy(req, 5)
      req.writeUInt16BE(destPort, 5 + hostBuf.length)
      socket.write(req)

      socket.once('data', (reply: Buffer) => {
        if (reply[1] !== 0x00) {
          return reject(new Error(`SOCKS5 CONNECT failed, code: ${reply[1]}`))
        }
        // Connected — hand off raw socket to caller
        resolve(socket)
      })
    })

    socket.on('error', reject)
    setTimeout(() => reject(new Error('SOCKS5 connect timeout')), 30000)
  })
}
```

- [ ] **Step 2: Manual integration test (requires Tor running)**

```bash
# In a separate terminal, ensure tor is running: brew services start tor
node -e "
const { connectToOnion } = require('./dist/electron/onion-client');
// Connect to check.torproject.org via onion (it's not .onion but proves SOCKS5 works)
// We'll just test that SOCKS5 handshake completes
"
```

- [ ] **Step 3: Commit**

```bash
git add electron/onion-client.ts
git commit -m "feat: SOCKS5 onion client — connect through Tor to .onion addresses"
```

---

## Task 9: Audio Bridge — Capture, Encode, Decode, Play

**Files:**
- Create: `electron/audio-bridge.ts`

**Interfaces:**
- Produces: `AudioCapture.start(): Promise<void>` — opens mic via navigator.mediaDevices in renderer, sends frames via IPC
- Produces: `AudioCapture.stop(): void`
- Produces: `AudioPlayback.push(opusFrame: Buffer): void` — decodes and plays in renderer
- Consumes: `noise-session.ts` `NoiseTransport.send()` / `recv`

Note: `getUserMedia` must run in the Electron renderer (Chromium). Encoded Opus frames are sent to the main process via IPC for Noise encryption and transmission. Incoming frames come back the same way.

- [ ] **Step 1: Write `electron/audio-bridge.ts` (main process side)**

```typescript
import { ipcMain, WebContents } from 'electron'
import type { NoiseTransport } from './noise-session'

let activeTransport: NoiseTransport | null = null
let rendererContents: WebContents | null = null

// Called by call orchestrator when Noise session is established
export function setActiveTransport(transport: NoiseTransport, wc: WebContents) {
  activeTransport = transport
  rendererContents = wc

  // Pump incoming audio frames → renderer for decode + play
  ;(async () => {
    for await (const frame of transport.recv) {
      rendererContents?.send('audio:inbound-frame', frame)
    }
  })()
}

export function clearTransport() {
  activeTransport = null
  rendererContents = null
}

// Renderer sends encoded Opus frames here → Noise encrypt → send over Tor
ipcMain.on('audio:outbound-frame', (_event, opusFrame: Buffer) => {
  if (activeTransport) {
    activeTransport.send(opusFrame)
  }
})
```

- [ ] **Step 2: Write renderer-side audio capture in `renderer/lib/audio-engine.ts`**

```typescript
// Runs in Electron renderer process (browser context)
// opusscript provides Opus WASM encoder/decoder
import OpusScript from 'opusscript'

const SAMPLE_RATE = 16000  // 16kHz — good quality for voice, lower bandwidth
const FRAME_SIZE = 320     // 20ms at 16kHz
const CHANNELS = 1

let encoder: any = null
let decoder: any = null
let audioContext: AudioContext | null = null
let micStream: MediaStream | null = null
let scriptProcessor: ScriptProcessorNode | null = null

export async function startCapture() {
  encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP)
  decoder = new OpusScript(SAMPLE_RATE, CHANNELS)

  micStream = await navigator.mediaDevices.getUserMedia({ audio: {
    sampleRate: SAMPLE_RATE,
    channelCount: CHANNELS,
    echoCancellation: true,
    noiseSuppression: true,
  }, video: false })

  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
  const source = audioContext.createMediaStreamSource(micStream)

  // ScriptProcessorNode collects PCM frames and encodes them
  scriptProcessor = audioContext.createScriptProcessor(FRAME_SIZE, CHANNELS, CHANNELS)
  scriptProcessor.onaudioprocess = (e) => {
    const pcm = e.inputBuffer.getChannelData(0)
    const pcm16 = float32ToInt16(pcm)
    const encoded: Uint8Array = encoder.encode(pcm16, FRAME_SIZE)
    // Send to main process for Noise encryption + Tor transmission
    ;(window as any).ghostcall.sendAudioFrame(Buffer.from(encoded))
  }

  source.connect(scriptProcessor)
  scriptProcessor.connect(audioContext.destination)
}

export function stopCapture() {
  scriptProcessor?.disconnect()
  micStream?.getTracks().forEach(t => t.stop())
  audioContext?.close()
}

// Called when inbound Opus frame arrives from main process
export function playInboundFrame(opusFrameBuffer: ArrayBuffer) {
  if (!decoder || !audioContext) return
  const frame = new Uint8Array(opusFrameBuffer)
  const pcm16: Int16Array = decoder.decode(frame)
  const pcmFloat = int16ToFloat32(pcm16)
  const audioBuffer = audioContext.createBuffer(CHANNELS, FRAME_SIZE, SAMPLE_RATE)
  audioBuffer.copyToChannel(pcmFloat, 0)
  const source = audioContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(audioContext.destination)
  source.start()
}

function float32ToInt16(f32: Float32Array): Int16Array {
  const i16 = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)))
  }
  return i16
}

function int16ToFloat32(i16: Int16Array): Float32Array {
  const f32 = new Float32Array(i16.length)
  for (let i = 0; i < i16.length; i++) {
    f32[i] = i16[i] / 32767
  }
  return f32
}
```

- [ ] **Step 3: Add preload bridge for audio frames**

Add to `electron/preload.ts`:
```typescript
// In the exposeInMainWorld block, add:
sendAudioFrame: (frame: Buffer) => ipcRenderer.send('audio:outbound-frame', frame),
onInboundFrame: (cb: (frame: ArrayBuffer) => void) =>
  ipcRenderer.on('audio:inbound-frame', (_e, frame: Buffer) => cb(frame.buffer)),
```

- [ ] **Step 4: Commit**

```bash
git add electron/audio-bridge.ts renderer/lib/audio-engine.ts electron/preload.ts
git commit -m "feat: audio bridge — getUserMedia, Opus encode/decode, IPC pipeline"
```

---

## Task 10: Call Orchestrator — Wire All Layers Together

**Files:**
- Create: `electron/call-orchestrator.ts`

**Interfaces:**
- Produces: `initiateCall(calleeMeta: StealthMeta, mySkV: bigint, myNoiseStaticPriv: Uint8Array, win: BrowserWindow): Promise<void>`
- Produces: `answerCall(callerNoisePubkey: string, myNoiseStaticPriv: Uint8Array, win: BrowserWindow): Promise<string>` — returns onion addr
- Produces: `hangUp(): Promise<void>`
- Consumes: `torManager`, `onionServer`, `onionClient`, `NoiseSession`, `audioBridge`, `nostr-signal`

- [ ] **Step 1: Write `electron/call-orchestrator.ts`**

```typescript
import * as net from 'net'
import { ipcMain, BrowserWindow } from 'electron'
import { torManager } from './tor-manager'
import { onionServer, OnionServer } from './onion-server'
import { connectToOnion } from './onion-client'
import { NoiseSession } from './noise-session'
import { setActiveTransport, clearTransport } from './audio-bridge'
import { x25519 } from '@noble/curves/ed25519'

const AUDIO_PORT = 7331

// State for an active call
interface CallState {
  onionServiceId?: string
  socket?: net.Socket
}
let currentCall: CallState | null = null
let callServer: OnionServer | null = null

// === CALLEE SIDE ===
// Called when callee goes "online" — creates onion, starts TCP server
export async function goOnline(): Promise<string> {
  callServer = new OnionServer()
  await callServer.listen(AUDIO_PORT, (_socket) => {
    // Connection arrives during answerCall — handled there
  })
  const onionAddr = await torManager.addOnion(AUDIO_PORT)
  currentCall = { onionServiceId: onionAddr.split('.')[0] }
  return onionAddr
}

// Called when callee accepts the incoming call signal
export async function answerCall(
  socket: net.Socket,
  myNoiseStaticPriv: Uint8Array,
  win: BrowserWindow,
): Promise<void> {
  const transport = await NoiseSession.handshakeResponder(socket, myNoiseStaticPriv)
  setActiveTransport(transport, win.webContents)
}

// === CALLER SIDE ===
// Called when caller wants to connect to callee's onion address
export async function initiateCall(
  onionAddr: string,
  myNoiseStaticPriv: Uint8Array,
  win: BrowserWindow,
): Promise<void> {
  const socks = torManager.getSocksProxy()
  const socket = await connectToOnion(onionAddr, socks)
  currentCall = { socket }
  const transport = await NoiseSession.handshakeInitiator(socket, myNoiseStaticPriv)
  setActiveTransport(transport, win.webContents)
}

// === HANG UP ===
export async function hangUp(): Promise<void> {
  clearTransport()
  currentCall?.socket?.destroy()
  if (currentCall?.onionServiceId) {
    await torManager.removeOnion(currentCall.onionServiceId)
  }
  await callServer?.close()
  callServer = null
  currentCall = null
}

// === IPC HANDLERS ===
export function registerCallIpcHandlers(win: BrowserWindow) {
  // Generate a per-session Noise static key and store in memory only
  const noiseStaticPriv = x25519.utils.randomPrivateKey()

  ipcMain.handle('call:go-online', async () => {
    return goOnline()
  })

  ipcMain.handle('call:initiate', async (_e, { onionAddr }: { onionAddr: string }) => {
    await initiateCall(onionAddr, noiseStaticPriv, win)
  })

  ipcMain.handle('call:hangup', async () => {
    await hangUp()
  })
}
```

- [ ] **Step 2: Add handler registration to `electron/main.ts`**

```typescript
import { registerCallIpcHandlers } from './call-orchestrator'

app.whenReady().then(async () => {
  // ... existing window + tor setup ...
  registerCallIpcHandlers(win!)
})
```

- [ ] **Step 3: End-to-end local smoke test (two Electron windows)**

```bash
# Terminal 1 — Bob (callee)
NODE_ENV=development GHOSTCALL_ROLE=callee npm run dev

# Terminal 2 — Alice (caller)
NODE_ENV=development GHOSTCALL_ROLE=caller npm run dev
```
Steps:
1. Bob clicks "Go Online" — logs `.onion` address
2. Alice enters Bob's handle, app resolves his `.onion` via Nostr signal
3. Both windows show "Connected"
4. Speak into mic on one machine — hear audio on the other

Expected: audio flows, no errors in console.

- [ ] **Step 4: Commit**

```bash
git add electron/call-orchestrator.ts electron/main.ts
git commit -m "feat: call orchestrator — wires Tor + Noise + audio + IPC"
```

---

## Task 11: STRK20 Shielded Payment (TX #2)

**Files:**
- Create: `renderer/lib/strk20-payment.ts`

**Interfaces:**
- Produces: `sendShieldedPayment(toStealthAddr: string, amountStrk: bigint, account: Account): Promise<string>` — returns tx hash
- Consumes: `@starkware-libs/starknet-privacy-sdk`, `.env` provider URLs

- [ ] **Step 1: Write `renderer/lib/strk20-payment.ts`**

```typescript
import { createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk'
import type { Account } from 'starknet'

const POOL_ADDRESS = process.env.STRK20_POOL_ADDRESS!
const PROVER_URL = process.env.STRK20_PROVER_URL!
const DISCOVERY_URL = process.env.STRK20_DISCOVERY_URL!

export async function sendShieldedPayment(
  toStealthAddr: string,
  amountStrk: bigint,
  account: Account,
  viewingKey: bigint,
): Promise<string> {
  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: { url: PROVER_URL, chainId: 'SN_MAIN' },
    discoveryProvider: { url: DISCOVERY_URL },
    poolContractAddress: POOL_ADDRESS,
  })

  // First ensure the account is registered with the pool (idempotent)
  await ensurePoolRegistered(transfers, account)

  const latestBlock = await account.getBlock('latest')
  const { callAndProof } = await transfers
    .build()
    .privateTransfer({ to: toStealthAddr, amount: amountStrk })
    .execute({ provingBlockId: latestBlock.block_hash })

  const res = await account.execute(callAndProof.call)
  await account.waitForTransaction(res.transaction_hash)
  return res.transaction_hash
}

async function ensurePoolRegistered(transfers: any, account: Account) {
  try {
    const latestBlock = await account.getBlock('latest')
    const { callAndProof } = await transfers
      .build()
      .register()
      .execute({ provingBlockId: latestBlock.block_hash })
    const res = await account.execute(callAndProof.call)
    await account.waitForTransaction(res.transaction_hash)
  } catch (e: any) {
    // Already registered — ignore
    if (!e.message?.includes('already registered')) throw e
  }
}
```

- [ ] **Step 2: Add IPC handler to `electron/main.ts`**

```typescript
import { sendShieldedPayment } from '../renderer/lib/strk20-payment'

ipcMain.handle('strk20:pay', async (_e, { amount }: { amount: string }) => {
  // account + viewingKey loaded from session state (set during setup flow)
  const txHash = await sendShieldedPayment(
    sessionState.calleeStealthAddr,
    BigInt(amount),
    sessionState.account,
    sessionState.viewingKey,
  )
  return txHash
})
```

- [ ] **Step 3: Commit**

```bash
git add renderer/lib/strk20-payment.ts electron/main.ts
git commit -m "feat: STRK20 shielded payment — createPrivateTransfers post-call (TX #2)"
```

---

## Task 12: UI — Setup, Dial, Active Call Screens

**Files:**
- Create: `renderer/app/setup/page.tsx`
- Create: `renderer/app/call/page.tsx`
- Modify: `renderer/app/page.tsx`
- Create: `renderer/components/DialPad.tsx`
- Create: `renderer/components/CallScreen.tsx`
- Create: `renderer/components/WalletConnect.tsx`

**Interfaces:**
- Consumes: `window.ghostcall` preload API
- Produces: fully navigable UI — setup → home (dial) → active call → post-call payment

- [ ] **Step 1: Write `renderer/components/WalletConnect.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { connect } from 'get-starknet'

export default function WalletConnect({ onConnected }: { onConnected: (addr: string) => void }) {
  const [connecting, setConnecting] = useState(false)

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const starknet = await connect({ modalMode: 'alwaysAsk' })
      await starknet.enable()
      onConnected(starknet.selectedAddress!)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <button
      onClick={handleConnect}
      disabled={connecting}
      className="px-6 py-3 bg-white text-black font-mono text-sm rounded-none hover:bg-zinc-200 transition-colors"
    >
      {connecting ? 'CONNECTING...' : 'CONNECT WALLET'}
    </button>
  )
}
```

- [ ] **Step 2: Write `renderer/app/setup/page.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import WalletConnect from '../../components/WalletConnect'

export default function Setup() {
  const [addr, setAddr] = useState<string | null>(null)
  const [handle, setHandle] = useState('')
  const [status, setStatus] = useState('')
  const router = useRouter()

  const register = async () => {
    if (!handle.trim()) return
    setStatus('Registering on Starknet mainnet...')
    try {
      const txHash = await (window as any).ghostcall.registerStealth(handle.trim())
      setStatus(`Registered! TX: ${txHash.slice(0, 16)}...`)
      setTimeout(() => router.push('/'), 2000)
    } catch (e: any) {
      setStatus(`Error: ${e.message}`)
    }
  }

  return (
    <main className="flex flex-col items-center justify-center h-screen gap-6 p-8">
      <h1 className="text-2xl font-mono font-bold">SETUP</h1>
      <p className="text-zinc-400 text-sm text-center max-w-xs">
        Register your stealth identity on Starknet. One transaction, one time.
      </p>
      {!addr
        ? <WalletConnect onConnected={setAddr} />
        : (
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <input
              value={handle}
              onChange={e => setHandle(e.target.value)}
              placeholder="choose a handle (e.g. alice)"
              className="bg-zinc-900 border border-zinc-700 px-4 py-2 font-mono text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white"
            />
            <button
              onClick={register}
              className="bg-white text-black font-mono text-sm py-2 hover:bg-zinc-200"
            >
              REGISTER ON-CHAIN
            </button>
            {status && <p className="text-xs text-zinc-400 font-mono">{status}</p>}
          </div>
        )
      }
    </main>
  )
}
```

- [ ] **Step 3: Write `renderer/components/DialPad.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DialPad() {
  const [handle, setHandle] = useState('')
  const [status, setStatus] = useState('')
  const router = useRouter()

  const dial = async () => {
    if (!handle.trim()) return
    setStatus('Looking up handle...')
    try {
      const meta = await (window as any).ghostcall.lookupStealth(handle.trim())
      setStatus('Initiating call through Tor...')
      await (window as any).ghostcall.initiateCall(meta)
      router.push('/call')
    } catch (e: any) {
      setStatus(`Error: ${e.message}`)
    }
  }

  const goOnline = async () => {
    setStatus('Going online — creating onion service...')
    const onionAddr = await (window as any).ghostcall.goOnline()
    setStatus(`Online: ${onionAddr.slice(0, 16)}...`)
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-xs">
      <input
        value={handle}
        onChange={e => setHandle(e.target.value)}
        placeholder="enter handle to call"
        className="bg-zinc-900 border border-zinc-700 px-4 py-2 font-mono text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white"
        onKeyDown={e => e.key === 'Enter' && dial()}
      />
      <button onClick={dial} className="bg-white text-black font-mono text-sm py-2 hover:bg-zinc-200">
        CALL
      </button>
      <button onClick={goOnline} className="border border-zinc-700 font-mono text-sm py-2 hover:border-white">
        GO ONLINE (receive calls)
      </button>
      {status && <p className="text-xs text-zinc-500 font-mono">{status}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Write `renderer/components/CallScreen.tsx`**

```tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { startCapture, stopCapture, playInboundFrame } from '../lib/audio-engine'

export default function CallScreen() {
  const [muted, setMuted] = useState(false)
  const [duration, setDuration] = useState(0)
  const [settling, setSettling] = useState(false)
  const router = useRouter()

  useEffect(() => {
    startCapture()
    // Register inbound audio frame handler
    ;(window as any).ghostcall.onInboundFrame((frame: ArrayBuffer) => {
      playInboundFrame(frame)
    })
    // Timer
    const interval = setInterval(() => setDuration(d => d + 1), 1000)
    return () => {
      clearInterval(interval)
      stopCapture()
    }
  }, [])

  const toggleMute = () => {
    setMuted(m => !m)
    // TODO: gate audio capture based on mute state
  }

  const hangUp = async () => {
    stopCapture()
    await (window as any).ghostcall.hangUp()
    router.push('/?settled=1')
  }

  const settle = async () => {
    setSettling(true)
    try {
      const amount = BigInt(Math.ceil(duration / 60)) * BigInt(1e17) // 0.1 STRK/minute
      await (window as any).ghostcall.settlePayment(amount.toString())
    } finally {
      setSettling(false)
    }
  }

  const fmt = (s: number) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-8">
      <div className="text-5xl font-mono text-zinc-300">{fmt(duration)}</div>
      <p className="text-xs text-zinc-600 font-mono">CONNECTED · TOR · NOISE_XX · SRTP OFF</p>
      <div className="flex gap-4">
        <button
          onClick={toggleMute}
          className={`px-6 py-3 font-mono text-sm border ${muted ? 'border-red-500 text-red-500' : 'border-zinc-700 text-white'}`}
        >
          {muted ? 'UNMUTE' : 'MUTE'}
        </button>
        <button
          onClick={hangUp}
          className="px-6 py-3 font-mono text-sm bg-red-600 text-white hover:bg-red-700"
        >
          END CALL
        </button>
      </div>
      <button
        onClick={settle}
        disabled={settling}
        className="text-xs text-zinc-500 font-mono underline hover:text-white"
      >
        {settling ? 'SETTLING...' : 'SETTLE PAYMENT (STRK20)'}
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Update `renderer/app/page.tsx`**

```tsx
import DialPad from '../components/DialPad'

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center h-screen gap-6 p-8">
      <h1 className="text-3xl font-bold tracking-tight font-mono">GHOSTCALL</h1>
      <p className="text-zinc-600 text-xs font-mono">TRUSTLESS · UNTRACEABLE · PRIVATE</p>
      <DialPad />
    </main>
  )
}
```

- [ ] **Step 6: Write `renderer/app/call/page.tsx`**

```tsx
import CallScreen from '../../components/CallScreen'
export default function CallPage() { return <CallScreen /> }
```

- [ ] **Step 7: Run and test full flow in dev mode**

```bash
npm run dev
```
Walk through: Setup → register handle (uses mainnet wallet) → Go Online → second window calls handle → audio flows → End Call → Settle Payment.

- [ ] **Step 8: Commit**

```bash
git add renderer/
git commit -m "feat: UI — setup, dial, active call, payment settlement screens"
```

---

## Task 13: Deploy + strk20.json + Hackathon Submission

**Files:**
- Create: `scripts/gen-strk20-json.ts`
- Create: `strk20.json`
- Create: `README.md`

**Interfaces:**
- Produces: valid `strk20.json` with 3 mainnet tx hashes
- Produces: `README.md` with setup instructions, architecture overview, demo link

- [ ] **Step 1: Run on mainnet — capture 3 tx hashes**

In a test run with real mainnet accounts:
1. Register handle → note TX hash A
2. Make a test call → settle STRK20 payment → note TX hash B
3. CommitCall → note TX hash C

- [ ] **Step 2: Write `scripts/gen-strk20-json.ts`**

```typescript
import { writeFileSync } from 'fs'
import deployments from '../contracts/deployments.json'

const submission = {
  name: "GhostCall",
  description: "Trustless 1:1 audio calls on Starknet. Tor onion transport (no TURN server), stealth addresses (ERC-5564), Noise_XX encryption, STRK20 shielded payments. First Web3 calling app with genuine IP privacy.",
  demo: process.env.DEMO_VIDEO_URL || "https://youtu.be/TODO",
  contracts: {
    StealthRegistry: deployments.StealthRegistry.address,
    CallLog: deployments.CallLog.address,
  },
  transactions: [
    process.env.TX_REGISTER   || "0x_register_tx_hash",
    process.env.TX_PAYMENT    || "0x_strk20_payment_tx_hash",
    process.env.TX_COMMITCALL || "0x_commit_call_tx_hash",
  ],
  stack: [
    "Cairo 2.x", "Starknet", "STRK20 SDK",
    "Tor v3 onion services", "Noise_XX (X25519 + ChaCha20-Poly1305)",
    "Nostr NIP-44/NIP-59", "Opus (opusscript)", "Electron 32", "Next.js 14"
  ],
  repo: process.env.GITHUB_REPO || "https://github.com/TODO/ghostcall",
  license: "Apache-2.0",
}

writeFileSync('strk20.json', JSON.stringify(submission, null, 2))
console.log('strk20.json written')
```

- [ ] **Step 3: Write `README.md`**

````markdown
# GhostCall

Trustless, untraceable 1:1 audio calls on Starknet.

## What Makes It Different

| | Status.im | Session | GhostCall |
|--|--|--|--|
| IP hidden from callee | No | No | **Yes (Tor)** |
| Trustless relay | No (Waku relays) | No (service nodes) | **Yes (Tor network)** |
| On-chain identity | Pseudonymous | None | **Stealth addresses** |
| Shielded payments | No | No | **STRK20 pool** |

## Architecture

```
Alice → [Tor 3 hops] → Bob's .onion service
        Noise_XX (X25519 + ChaCha20-Poly1305)
        Opus audio frames (20ms, 16kHz)

Identity:   Starknet StealthRegistry contract (ERC-5564 adapted)
Signaling:  Nostr NIP-59 Gift Wrap (ephemeral keys, random timestamps)
Payment:    STRK20 SDK private transfer (pool breaks sender↔recipient link)
Receipt:    CallLog contract (Poseidon commitment, no participant data)
```

## Setup

1. Install Tor: `brew install tor` (macOS) or `apt install tor` (Linux)
2. Download the latest release from GitHub Releases
3. Run `GhostCall.app` (macOS) or `ghostcall` (Linux)
4. Connect your Starknet wallet (Argent / Braavos)
5. Register a handle (one mainnet transaction)

## Development

```bash
git clone https://github.com/TODO/ghostcall
cd ghostcall
cp .env.example .env   # fill in your keys
npm install
brew install tor && tor &
npm run dev
```

## Contracts

- `StealthRegistry`: `0x...` ([Starkscan](https://starkscan.co/contract/0x...))
- `CallLog`: `0x...` ([Starkscan](https://starkscan.co/contract/0x...))

## License

Apache-2.0
````

- [ ] **Step 4: Generate and commit strk20.json**

```bash
DEMO_VIDEO_URL="https://youtu.be/YOUR_VIDEO" \
TX_REGISTER="0x..." \
TX_PAYMENT="0x..." \
TX_COMMITCALL="0x..." \
GITHUB_REPO="https://github.com/YOUR_HANDLE/ghostcall" \
npx ts-node scripts/gen-strk20-json.ts

git add strk20.json README.md
git commit -m "feat: strk20.json submission + README"
```

- [ ] **Step 5: Open registration PR on STRK20 repo**

```bash
# Fork https://github.com/starkware-libs/strk20-registry
# Add entry to registry.json:
{
  "repo": "https://github.com/YOUR_HANDLE/ghostcall",
  "telegram": "@YOUR_TELEGRAM"
}
# Open PR titled: "GhostCall: trustless Tor audio + stealth addresses + STRK20 payments"
```

- [ ] **Step 6: Final commit**

```bash
git tag v1.0.0-sprint
git push origin main --tags
```

---

## Qualification Checklist

- [ ] `StealthRegistry.register()` tx hash in `strk20.json`
- [ ] STRK20 `privateTransfer()` tx hash in `strk20.json`
- [ ] `CallLog.commitCall()` tx hash in `strk20.json`
- [ ] Demo video recorded and URL in `strk20.json`
- [ ] Registry PR opened before Aug 31 23:59 UTC
- [ ] Public GitHub repo with Apache-2.0 license
- [ ] `README.md` with setup instructions
- [ ] Tor running + real audio call demonstrated in demo video
