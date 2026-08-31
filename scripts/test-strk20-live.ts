import { Account, RpcProvider } from 'starknet'
import { sendShieldedPayment } from '../renderer/lib/strk20-payment'
import { deriveStealthKeypairFromPrivKey } from '../renderer/lib/stealth-keys'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env' })

async function main() {
  const RPC_URL = process.env.STARKNET_RPC_URL!
  const ADDR = process.env.STARKNET_ACCOUNT_ADDRESS!
  const PRIV = process.env.STARKNET_PRIVATE_KEY!

  console.log('[test] Account:', ADDR)
  console.log('[test] RPC:', RPC_URL.slice(0, 50) + '...')

  const provider = new RpcProvider({ nodeUrl: RPC_URL, blockIdentifier: 'latest' })
  const account = new Account(provider, ADDR, PRIV)

  const kp = deriveStealthKeypairFromPrivKey(BigInt(PRIV))
  console.log('[test] Stealth keypair — pkVx:', kp.pkV.x.toString(16).slice(0, 16) + '...')

  const meta = {
    pkVx: kp.pkV.x,
    pkVy: kp.pkV.y,
    pkSx: kp.pkS.x,
    pkSy: kp.pkS.y,
    nostrPubkey: 'aa'.repeat(31),
  }

  // Small amount to minimize gas cost on Sepolia
  const amount = BigInt('1000000000000000') // 0.001 STRK

  console.log('[test] Sending', amount.toString(), 'base units STRK via STRK20 privacy pool...')

  const txHash = await sendShieldedPayment(meta, amount, account, kp.skV)
  console.log('[test] SUCCESS — tx hash:', txHash)
  console.log('[test] Voyager: https://sepolia.voyager.online/tx/' + txHash)
}

main().catch(err => {
  console.error('[test] FAILED:', err?.message ?? err)
  if (err?.cause) console.error('[test] Cause:', err.cause)
  process.exit(1)
})
