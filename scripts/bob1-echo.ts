/**
 * bob1 — a handle-callable echo peer.
 *
 * Registers the handle "bob1" on-chain with a FRESH stealth identity, funded by
 * the .env account, then runs the callee flow: subscribe to Nostr, receive a
 * gift-wrapped call offer, dial back to the caller's onion, and echo audio.
 *
 * Phases:
 *   setup  — generate bob1 key, fund from .env, deploy bob1 account, register "bob1"
 *   serve  — go online (onion + Noise echo responder) + subscribe; dial back on offer
 *   all    — setup (idempotent) then serve   [default]
 *
 * bob1's private key is persisted to scripts/.bob1-key so setup is one-time.
 *
 * Usage:
 *   npx tsx scripts/bob1-echo.ts            # all
 *   npx tsx scripts/bob1-echo.ts setup
 *   npx tsx scripts/bob1-echo.ts serve
 */
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { ec, hash, CallData, Contract, cairo } from 'starknet'
import {
  initStarknetClient, registerHandle, isRegistered, lookupHandle,
  deployAccountIfNeeded,
} from '../renderer/lib/starknet-client'
import { deriveStealthKeypairFromPrivKey } from '../renderer/lib/stealth-keys'
import { stealthToNostrKeypair, subscribeIncoming, parseCallOffer } from '../renderer/lib/nostr-signal'
import { STRK_TOKEN } from '../renderer/lib/strk20-payment'
import { TorManager } from '../electron/tor-manager'
import { OnionServer } from '../electron/onion-server'
import { connectToOnion, ONION_ADDR_RE } from '../electron/onion-client'
import { NoiseSession, noiseKeygen } from '../electron/noise-session'

dotenv.config({ path: '.env' })

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpusScript = require('opusscript')

const OZ_ACCOUNT_CLASS_HASH = '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f'
const HANDLE = 'bob1'
const KEY_FILE = path.join(__dirname, '.bob1-key')
const NOSTR_RELAY = process.env.NOSTR_RELAY_URL ?? 'wss://relay.primal.net'
const RPC = process.env.STARKNET_RPC_URL!
const ONION_PORT = 7331
const SAMPLE_RATE = 16000
const FRAME_SIZE = 320
const CHANNELS = 1
// STRK to send bob1 for gas (deploy account + register). Sepolia deploy-account
// fee estimates run ~0.14 STRK; 0.3 leaves comfortable headroom for register too.
const FUND_AMOUNT = 300_000_000_000_000_000n // 0.3 * 10^18

const ERC20_ABI = [
  { type: 'function', name: 'transfer', state_mutability: 'external',
    inputs: [{ name: 'recipient', type: 'core::starknet::contract_address::ContractAddress' },
             { name: 'amount', type: 'core::integer::u256' }], outputs: [] },
  { type: 'function', name: 'balanceOf', state_mutability: 'view',
    inputs: [{ name: 'account', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ type: 'core::integer::u256' }] },
]

function deriveAddress(privKeyHex: string): string {
  const pubKey = ec.starkCurve.getStarkKey('0x' + privKeyHex)
  const calldata = CallData.compile({ publicKey: pubKey })
  return hash.calculateContractAddressFromHash(pubKey, OZ_ACCOUNT_CLASS_HASH, calldata, 0)
}

function loadOrCreateBobKey(): string {
  if (fs.existsSync(KEY_FILE)) {
    return fs.readFileSync(KEY_FILE, 'utf8').trim()
  }
  // Fresh 32-byte scalar — randomPrivateKey() already returns a valid reduced
  // Stark-curve scalar (order ≈ 2^251.6), so use all 64 hex chars; truncating
  // would throw away entropy.
  const bytes = ec.starkCurve.utils.randomPrivateKey()
  const hex = Buffer.from(bytes).toString('hex').padStart(64, '0')
  fs.writeFileSync(KEY_FILE, hex, { mode: 0o600 })
  console.log('[bob1] generated fresh key →', KEY_FILE)
  return hex
}

// ── WAV-less Opus echo transport helper reused from bob-receive-dump ─────────

async function runEchoResponder(onionServer: OnionServer, onDone: () => void) {
  const decoder = new OpusScript(SAMPLE_RATE, CHANNELS)
  const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP)
  onionServer.listen(ONION_PORT, async (socket) => {
    console.log('[bob1] inbound connection — Noise_XX responder handshake...')
    const keys = noiseKeygen()
    try {
      const transport = await NoiseSession.handshakeResponder(socket, keys.secretKey)
      console.log('[bob1] connected (inbound) — echoing audio')
      let n = 0
      for await (const opusFrame of transport.recv) {
        const pcm: Buffer = decoder.decode(opusFrame)
        try { transport.send(encoder.encode(pcm, FRAME_SIZE)) } catch { /* echo err */ }
        if (++n % 25 === 0) process.stdout.write('.')
      }
      console.log(`\n[bob1] inbound call ended (${n} frames echoed)`)
    } catch (e) {
      console.error('[bob1] inbound handshake failed:', (e as Error).message)
      socket.destroy()
    }
  }).catch((e: Error) => console.error('[bob1] listen error:', e.message))
}

async function dialBackAndEcho(torManager: TorManager, callerOnion: string) {
  console.log('[bob1] dialing back caller onion:', callerOnion)
  const decoder = new OpusScript(SAMPLE_RATE, CHANNELS)
  const encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP)
  const socks = torManager.getSocksProxy()
  const socket = await connectToOnion(callerOnion, socks)
  console.log('[bob1] TCP connected through Tor — Noise_XX initiator handshake...')
  const keys = noiseKeygen()
  const transport = await NoiseSession.handshakeInitiator(socket, keys.secretKey)
  console.log('[bob1] connected (dial-back) — echoing audio')
  let n = 0
  for await (const opusFrame of transport.recv) {
    const pcm: Buffer = decoder.decode(opusFrame)
    try { transport.send(encoder.encode(pcm, FRAME_SIZE)) } catch { /* echo err */ }
    if (++n % 25 === 0) process.stdout.write('.')
  }
  console.log(`\n[bob1] dial-back call ended (${n} frames echoed)`)
}

// ── setup ────────────────────────────────────────────────────────────────────

async function setup(bobPrivHex: string) {
  const bobAddr = deriveAddress(bobPrivHex)
  const bobPriv = BigInt('0x' + bobPrivHex)
  const kp = deriveStealthKeypairFromPrivKey(bobPriv)
  console.log('[bob1] account address:', bobAddr)

  // 1) Register client as bob1 so we can check on-chain state.
  initStarknetClient(RPC, bobAddr, '0x' + bobPrivHex)
  if (await isRegistered(HANDLE)) {
    const meta = await lookupHandle(HANDLE)
    if (meta.pkVx === kp.pkV.x && meta.pkVy === kp.pkV.y) {
      console.log('[bob1] handle "bob1" already registered to this key — skipping setup')
      return
    }
    throw new Error('Handle "bob1" is registered to a DIFFERENT key. Delete scripts/.bob1-key or pick another handle.')
  }

  // 2) Fund bob1 from the .env account (transfer STRK for gas).
  console.log(`[bob1] funding ${(Number(FUND_AMOUNT) / 1e18).toFixed(3)} STRK from .env account...`)
  const funder = new (await import('starknet')).Account({
    provider: new (await import('starknet')).RpcProvider({ nodeUrl: RPC, blockIdentifier: 'latest' }),
    address: process.env.STARKNET_ACCOUNT_ADDRESS!,
    signer: process.env.STARKNET_PRIVATE_KEY!,
  })
  const strk = new Contract({ abi: ERC20_ABI as any, address: STRK_TOKEN, providerOrAccount: funder })
  const transferTx = await strk.transfer(bobAddr, cairo.uint256(FUND_AMOUNT))
  await funder.provider.waitForTransaction(transferTx.transaction_hash)
  console.log('[bob1] funded, tx:', transferTx.transaction_hash)

  // 3) Deploy bob1's account (counterfactual → deployed) + register.
  console.log('[bob1] deploying account...')
  await deployAccountIfNeeded()
  console.log('[bob1] registering handle "bob1"...')
  const tx = await registerHandle(HANDLE, kp)
  console.log('[bob1] registered, tx:', tx)

  const meta = await lookupHandle(HANDLE)
  console.log('[bob1] verify nostrPubkey:', meta.nostrPubkey)
}

// ── serve ──────────────────────────────────────────────────────────────────

async function serve(bobPrivHex: string) {
  const bobPriv = BigInt('0x' + bobPrivHex)
  const { pk: myNostrPk } = stealthToNostrKeypair(deriveStealthKeypairFromPrivKey(bobPriv).skV)
  console.log('[bob1] nostr pubkey (subscribe filter):', myNostrPk)

  const torManager = new TorManager()
  const onionServer = new OnionServer()
  const seen = new Set<string>()

  process.on('SIGINT', () => { console.log('\n[bob1] stopping'); torManager.stop(); process.exit(0) })

  console.log('[bob1] starting Tor...')
  await torManager.start()
  console.log('[bob1] Tor ready')

  // Open our onion + inbound Noise echo responder (covers the direct-call path too).
  const myOnion = await torManager.addOnion(ONION_PORT)
  console.log('[bob1] online at onion:', myOnion)
  await runEchoResponder(onionServer, () => {})

  // Subscribe for gift-wrapped offers addressed to our full Nostr pubkey.
  console.log('[bob1] subscribing to relay:', NOSTR_RELAY)
  subscribeIncoming(NOSTR_RELAY, myNostrPk, async (raw: string) => {
    const payload = await parseCallOffer(raw, bobPriv)
    if (!payload?.onionAddr || !payload.callId) return
    if (seen.has(payload.callId)) return
    seen.add(payload.callId)
    if (!ONION_ADDR_RE.test(payload.onionAddr)) {
      console.warn('[bob1] offer has malformed onion, ignoring:', payload.onionAddr)
      return
    }
    console.log('\n[bob1] received call offer (callId', payload.callId + ') — dialing back')
    try {
      await dialBackAndEcho(torManager, payload.onionAddr)
    } catch (e) {
      console.error('[bob1] dial-back failed:', (e as Error).message)
    }
  })

  console.log('\n[bob1] READY — call "bob1" by handle from the UI. (Ctrl+C to stop)\n')
  // Keep the process alive.
  await new Promise<void>(() => {})
}

async function main() {
  const mode = process.argv[2] ?? 'all'
  const bobPrivHex = loadOrCreateBobKey()
  if (mode === 'setup' || mode === 'all') await setup(bobPrivHex)
  if (mode === 'serve' || mode === 'all') await serve(bobPrivHex)
}

main().catch(e => { console.error('[bob1] FATAL:', e.message); process.exit(1) })
