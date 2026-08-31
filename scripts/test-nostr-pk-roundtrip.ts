import { initStarknetClient, registerHandle, lookupHandle, isRegistered, deployAccountIfNeeded } from '../renderer/lib/starknet-client'
import { deriveStealthKeypairFromPrivKey } from '../renderer/lib/stealth-keys'
import { stealthToNostrKeypair } from '../renderer/lib/nostr-signal'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env' })

async function main() {
  initStarknetClient(
    process.env.STARKNET_RPC_URL!,
    process.env.STARKNET_ACCOUNT_ADDRESS!,
    process.env.STARKNET_PRIVATE_KEY!
  )

  const privKey = BigInt(process.env.STARKNET_PRIVATE_KEY!)
  const kp = deriveStealthKeypairFromPrivKey(privKey)
  const { pk: expectedFullPk } = stealthToNostrKeypair(kp.skV)

  // Fresh handle so we exercise register() against the newly-deployed contract.
  const handle = 'roundtrip-' + expectedFullPk.slice(0, 8)
  console.log('[rt] handle:', handle)
  console.log('[rt] expected full nostr pk (64-hex):', expectedFullPk)

  if (!(await isRegistered(handle))) {
    await deployAccountIfNeeded()
    console.log('[rt] registering...')
    const tx = await registerHandle(handle, kp)
    console.log('[rt] register tx:', tx)
  } else {
    console.log('[rt] already registered — reading back')
  }

  const meta = await lookupHandle(handle)
  console.log('[rt] read-back nostrPubkey:', meta.nostrPubkey)

  const okLen = /^[0-9a-f]{64}$/.test(meta.nostrPubkey)
  const okMatch = meta.nostrPubkey === expectedFullPk
  console.log('[rt] 64-hex:', okLen, '| matches derived pk:', okMatch)
  if (okLen && okMatch) {
    console.log('[rt] SUCCESS — full 32-byte Nostr pk round-trips on-chain')
  } else {
    console.error('[rt] FAIL — pk did not round-trip')
    process.exit(1)
  }
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
