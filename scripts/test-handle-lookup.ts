import { initStarknetClient, lookupHandle, isRegistered } from '../renderer/lib/starknet-client'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env' })

async function main() {
  initStarknetClient(
    process.env.STARKNET_RPC_URL!,
    process.env.STARKNET_ACCOUNT_ADDRESS!,
    process.env.STARKNET_PRIVATE_KEY!
  )

  const handle = 'philo'
  console.log('[lookup] Checking if handle registered:', handle)
  const registered = await isRegistered(handle)
  console.log('[lookup] isRegistered:', registered)

  if (registered) {
    const meta = await lookupHandle(handle)
    console.log('[lookup] StealthMeta:')
    console.log('  pkVx:', meta.pkVx.toString(16).slice(0, 20) + '...')
    console.log('  pkVy:', meta.pkVy.toString(16).slice(0, 20) + '...')
    console.log('  pkSx:', meta.pkSx.toString(16).slice(0, 20) + '...')
    console.log('  pkSy:', meta.pkSy.toString(16).slice(0, 20) + '...')
    console.log('  nostrPubkey:', meta.nostrPubkey.slice(0, 20) + '...')
    console.log('[lookup] SUCCESS — handle resolves correctly')
  } else {
    console.log('[lookup] Handle not registered on-chain')
  }
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
