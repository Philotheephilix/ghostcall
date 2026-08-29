import { deriveStealthKeypair, deriveHandleHash } from '../renderer/lib/stealth-keys'
import { initStarknetClient, registerHandle } from '../renderer/lib/starknet-client'
import { stealthToNostrKeypair } from '../renderer/lib/nostr-signal'

async function main() {
  // Bob — deterministic second user
  const sig = { r: 0x1337b0b000000001n, s: 0xfeedf00dcafed00dn }
  const kp = deriveStealthKeypair(sig)

  console.log('=== BOB (Second User) ===')
  console.log('skV:       ', kp.skV.toString(16))
  console.log('pkV.x:     ', kp.pkV.x.toString(16))
  console.log('pkV.y:     ', kp.pkV.y.toString(16))
  console.log('pkS.x:     ', kp.pkS.x.toString(16))
  console.log('pkS.y:     ', kp.pkS.y.toString(16))

  const nostr = stealthToNostrKeypair(kp.skV)
  console.log('routingPk: ', nostr.routingPk)
  console.log('nostrPk:   ', nostr.pk)

  const handleHash = deriveHandleHash('ghostcall-bob-001')
  console.log('handleHash:', handleHash.toString(16))
  console.log('')
  console.log('Registering on Sepolia...')

  initStarknetClient(
    process.env.STARKNET_RPC_URL!,
    process.env.STARKNET_ACCOUNT_ADDRESS!,
    process.env.STARKNET_PRIVATE_KEY!,
  )

  const txHash = await registerHandle('ghostcall-bob-001', kp)
  console.log('TX:', txHash)
  console.log('DONE — Bob registered as ghostcall-bob-001')
}

main().catch(e => { console.error(e.message); process.exit(1) })
