/**
 * Calls commit_call() on the mainnet CallLog contract multiple times.
 * Each commitment is a unique felt252 (hash of call metadata).
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.join(__dirname, '..', '.env.mainnet') })

import { RpcProvider, Account, CallData, num } from 'starknet'

const RPC_URL  = 'https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_7/oJTjnNCsJEOqYv3MMtrtT6LUFhwcW9pR'
const PRIV_KEY = process.env.MAINNET_PRIVATE_KEY!
const ADDRESS  = process.env.MAINNET_ADDRESS!
const CALL_LOG = '0x474eafba0ef66427b796890bffc7d80fa9ec90359f649d85c1c54d50bd359fa'

const provider = new RpcProvider({ nodeUrl: RPC_URL })

async function main() {
  const account = new Account({ provider, address: ADDRESS, signer: PRIV_KEY })
  console.log('Account:', ADDRESS)

  // Create unique commitments using current timestamp + index
  const now = Date.now()
  const commitments = [
    num.toHex(BigInt(now)),
    num.toHex(BigInt(now + 1)),
    num.toHex(BigInt(now + 2)),
  ]

  for (const commitment of commitments) {
    console.log(`\n→ commit_call(${commitment})`)
    const { transaction_hash } = await account.execute({
      contractAddress: CALL_LOG,
      entrypoint: 'commit_call',
      calldata: CallData.compile({ commitment }),
    })
    console.log('  tx:', transaction_hash)
    await provider.waitForTransaction(transaction_hash)
    console.log('  SUCCEEDED')
  }

  console.log('\nDone — CallLog now has transactions on mainnet.')
}

main().catch(e => { console.error(e); process.exit(1) })
