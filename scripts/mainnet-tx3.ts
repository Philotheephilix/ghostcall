import * as path from 'path'
import * as fs from 'fs'
import { RpcProvider, Account, CallData, cairo } from 'starknet'

const envFile = path.resolve(__dirname, '../.env.mainnet')
const envVars: Record<string, string> = {}
fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) envVars[m[1].trim()] = m[2].trim()
})

const PRIVATE_KEY = envVars.MAINNET_PRIVATE_KEY
const ADDRESS     = envVars.MAINNET_ADDRESS
const RPC_URL     = envVars.RPC_URL

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC_URL })
  const acc = new Account({ provider, address: ADDRESS, signer: PRIVATE_KEY, cairoVersion: '1' })

  const block = await provider.getBlockNumber()
  console.log('Block:', block)
  console.log('Address:', ADDRESS)

  const nonce = await acc.getNonce()
  console.log('Nonce:', nonce)

  console.log('\n[TX3] CallLog.commit_call() on mainnet...')
  const CALLLOG = '0x474eafba0ef66427b796890bffc7d80fa9ec90359f649d85c1c54d50bd359fa'
  const commitment = cairo.felt(Date.now().toString())
  console.log('  commitment felt:', commitment)

  const tx3 = await acc.execute([{
    contractAddress: CALLLOG,
    entrypoint: 'commit_call',
    calldata: CallData.compile({ commitment })
  }])
  console.log('  TX:', tx3.transaction_hash)
  const r3 = await provider.waitForTransaction(tx3.transaction_hash, { retryInterval: 3000 })
  console.log('  Status:', (r3 as any).execution_status)
  console.log('  Block:', (r3 as any).block_number)
  console.log('  Voyager: https://voyager.online/tx/' + tx3.transaction_hash)
  return tx3.transaction_hash
}

main().then(h => console.log('\nDONE:', h)).catch(e => { console.error('FAILED:', e.message); process.exit(1) })
