# Identity Wallet — Design Spec
**Date:** 2026-08-30  
**Status:** Approved  
**Scope:** Seed-phrase account creation + zKey social login in GhostCall Electron onboarding

---

## 1. Goal

Replace the current `.env`-only identity step in the onboarding wizard with a proper self-custodial wallet setup. Users can create or import a BIP39 seed phrase, or authenticate via Google/Apple through zKey's ZK-based social login. All three paths produce a Stark private key that feeds the existing identity pipeline unchanged.

---

## 2. Architecture

### 2.1 Identity Sources

All three sources produce a single `bigint` private key. Nothing downstream changes.

```
Seed phrase  →  BIP39 mnemonic → BIP32 m/44'/9004'/0'/0/0 → stark privkey (bigint)
zKey social  →  OAuth JWT → ZKP proof → zKey wallet session key (bigint)
.env silent  →  STARKNET_PRIVATE_KEY env var → privkey (bigint)   [dev/CI only]
```

The `.env` path silently skips the identity step if `STARKNET_PRIVATE_KEY` is present at startup. It is never shown in the UI.

### 2.2 Key Storage

- **Mnemonic** encrypted via `electron.safeStorage.encryptString` → written to `app.getPath('userData')/identity.enc`
- **Private key** is never written to disk — derived fresh on each app launch by decrypting the mnemonic and running BIP32 derivation
- **Session viewing key** stays in `sessionState.viewingKey` in main process (in-memory only, as today)
- **`AppState` (localStorage)** gains one new field: `identitySource: 'seed' | 'zkey' | 'env' | ''` — no keys are ever stored here

### 2.3 BIP32 Derivation Path

```
m / 44' / 9004' / 0' / 0 / 0
```

`9004` is the Starknet coin type (SLIP-0044). The resulting 32-byte private key is passed directly to `deriveStealthKeypairFromPrivKey(privKey)`.

### 2.4 IPC Surface (main process → renderer)

| Channel | Direction | Description |
|---|---|---|
| `identity:create` | invoke | Generate fresh 12-word mnemonic, return words array. Does NOT persist yet. |
| `identity:save` | invoke | Encrypt + write mnemonic to `identity.enc` via safeStorage. Returns account address. |
| `identity:import` | invoke | Validate BIP39 wordlist, encrypt + write. Returns account address. |
| `identity:load` | invoke | Decrypt `identity.enc`, derive privkey, call `initStarknetClient`. Returns `{ address, source }`. |
| `identity:zkey-begin` | invoke | Generate PKCE + state nonce, open OAuth URL in system browser. Returns immediately. |
| `identity:zkey-result` | on (push) | Fired by main after `ghostcall://zkey-callback` received. Payload: `{ ok, address?, error? }`. |

---

## 3. Onboarding UI Flow

Current wizard: `welcome → wallet → handle → fund`  
New wizard: `welcome → identity → handle → fund`

The identity step renders all sub-flows inline (no route change). Once any sub-flow completes, the wizard advances to `handle`.

### 3.1 Identity Step — Entry Screen

A list card with four rows (same visual pattern as the existing glass-card list):

```
┌─────────────────────────────────────┐
│  New wallet          Generate 12-word seed  ›  │
│  ─────────────────────────────────  │
│  Import wallet       Restore from seed phrase ›  │
│  ─────────────────────────────────  │
│  Sign in with Google  via zKey                ›  │
│  ─────────────────────────────────  │
│  Sign in with Apple   via zKey                ›  │
└─────────────────────────────────────┘
```

### 3.2 Seed Sub-Flow (New Wallet)

Three inline screens, no route change:

**Screen 1 — Generate**
- Call `identity:create` on mount, display 12 words in `SeedGrid` (3×4 numbered grid)
- Words are blurred by default; user taps to reveal
- "I've written these down →" button advances to Verify

**Screen 2 — Verify**
- Pick 3 random word indices (chosen at component mount time, stored in component state — regenerated each time the verify screen is shown)
- `SeedVerify` renders 3 labeled inputs: "Word #N"
- All 3 must match (case-insensitive, trimmed) before Continue is enabled
- On success: call `identity:save`, advance to Done

**Screen 3 — Done**
- "Wallet created" heading
- Truncated account address (`0x1234…abcd`)
- "Continue →" advances wizard to Handle step

### 3.3 Seed Sub-Flow (Import Wallet)

Two inline screens:

**Screen 1 — Import**
- `SeedImport`: 12 controlled inputs arranged in 3×4 grid
- Each input validates against BIP39 wordlist on blur (red border if invalid word)
- "Restore wallet →" enabled only when all 12 are valid BIP39 words
- On click: call `identity:import`, on success advance to Done

**Screen 2 — Done**
- Same "Wallet created" card as new-wallet path

### 3.4 zKey Sub-Flow

Two inline screens:

**Screen 1 — Waiting**
- Call `identity:zkey-begin` on mount
- Spinner + "Complete login in your browser"
- Provider label (Google or Apple) shown
- "Cancel" link returns to identity entry screen
- Listen for `identity:zkey-result` push event from main

**Screen 2 — Done / Error**
- On `ok: true`: same "Wallet created" card, advance to Handle
- On `ok: false`: show `error` message, "Try again" button returns to entry screen

---

## 4. zKey Integration Detail

### 4.1 Protocol Registration

```ts
// electron/main.ts
app.setAsDefaultProtocolClient('ghostcall')
app.on('open-url', (_e, url) => {
  // parse ghostcall://zkey-callback?code=CODE&state=NONCE
  // validate state matches sessionState.zkeyState
  // forward to renderer: win.webContents.send('identity:zkey-result', ...)
})
```

On macOS, `open-url` fires on the existing process. On Windows, a second instance is launched and the URL arrives via `process.argv` — handled in `second-instance` event.

### 4.2 OAuth URL Construction

```
https://accounts.zkey.org/oauth/authorize
  ?client_id=ghostcall
  &redirect_uri=ghostcall://zkey-callback
  &response_type=code
  &scope=openid
  &state=<32-byte hex nonce>
  &code_challenge=<S256 PKCE challenge>
  &code_challenge_method=S256
```

> **TODO:** Replace `accounts.zkey.org` with the actual authorization endpoint once zKey publishes their developer portal. `client_id=ghostcall` is a placeholder — requires registration.

### 4.3 Token + ZKP Flow (main process)

```
POST https://api.zkey.org/oauth/token
  { code, code_verifier, redirect_uri, client_id }
→ { id_token (JWT) }

POST https://api.zkey.org/salt
  { id_token }
→ { salt }

POST https://api.zkey.org/zkp/prove
  { id_token, salt }
→ { proof, public_signals }   (~2s)

derive address: H(sub, aud, iss, salt)
call initStarknetClient(rpcUrl, derivedAddress, sessionPrivKey)
```

> **TODO:** All three API endpoints are best-guess from zKey architecture docs. Update when `https://docs.zkey.org` publishes an integration guide. Each call is wrapped in try/catch and surfaces a user-visible error on failure.

### 4.4 Session Key for zKey Path

The ZKP proof's session keypair acts as the Stark private key for `initStarknetClient`. The session private key is held in `sessionState` (main process in-memory) and never written to disk — same security model as the seed path.

---

## 5. New Files

| File | Purpose |
|---|---|
| `electron/identity-manager.ts` | All identity IPC handlers, safeStorage I/O, BIP39/BIP32 derivation, zKey OAuth + token + ZKP |
| `renderer/lib/identity-client.ts` | Renderer-side IPC wrappers for identity channels |
| `renderer/components/SeedGrid.tsx` | 12-word display grid (numbered, blur-to-reveal) |
| `renderer/components/SeedVerify.tsx` | 3-slot word verification input |
| `renderer/components/SeedImport.tsx` | 12-input mnemonic entry with per-word BIP39 validation |

## 6. Changed Files

| File | Change |
|---|---|
| `electron/main.ts` | Add `setAsDefaultProtocolClient`, `open-url` / `second-instance` handlers, import `identity-manager` |
| `renderer/app/onboarding/page.tsx` | Replace `WalletStep` → `IdentityStep` with inline sub-flow state machine |
| `renderer/lib/app-state.ts` | Add `identitySource: 'seed' \| 'zkey' \| 'env' \| ''` to `AppState` |
| `package.json` | Promote `@scure/bip39` and `@scure/bip32` to direct dependencies |

## 7. Unchanged

`stealth-keys.ts`, `starknet-client.ts`, `call-orchestrator.ts`, `audio-bridge.ts`, `audio-engine.ts`, all Nostr/Tor/call code.

---

## 8. Security Notes

- Mnemonic is encrypted with OS-level key via `safeStorage` — not accessible to other processes or raw filesystem reads
- Private key is never logged, never sent over IPC, never stored in localStorage
- PKCE prevents authorization code interception attacks on the OAuth callback
- `state` nonce prevents CSRF on the OAuth redirect
- zKey API calls go over HTTPS; JWT is never forwarded to the renderer
- `identity.enc` is specific to the OS user account; migrating to a new machine requires the seed phrase

---

## 9. Out of Scope

- Multi-account support
- Hardware wallet (Ledger) path
- zKey session key rotation
- Wallet contract deployment for zKey path (handled by zKey's infrastructure)
- Handle recovery / re-registration
