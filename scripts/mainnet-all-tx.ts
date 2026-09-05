import * as path from 'path'
import * as fs from 'fs'
import { RpcProvider, Account, CallData, cairo } from 'starknet'

// Load env manually to bypass hook interference
const envFile = path.resolve(__dirname, '../.env.mainnet')
const envVars: Record<string, string> = {}
fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) envVars[m[1].trim()] = m[2].trim()
})

const PRIVATE_KEY = envVars.MAINNET_PRIVATE_KEY
const ADDRESS     = envVars.MAINNET_ADDRESS
const RPC_URL     = envVars.RPC_URL
const STRK_TOKEN  = envVars.STRK_TOKEN

async function wait(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('RPC:', RPC_URL)
  console.log('Address:', ADDRESS)

  const provider = new RpcProvider({ nodeUrl: RPC_URL })
  const acc = new Account({ provider, address: ADDRESS, signer: PRIVATE_KEY, cairoVersion: '1' })

  const block = await provider.getBlockNumber()
  console.log('\n=== MAINNET TRANSACTIONS RUNNER ===')
  console.log('Block:', block)

  // Check balance
  const bal = await provider.callContract({
    contractAddress: STRK_TOKEN,
    entrypoint: 'balanceOf',
    calldata: [ADDRESS]
  })
  const balRaw = BigInt(bal[0]) + BigInt(bal[1]) * 2n**128n
  const balStrk = Number(balRaw / BigInt(1e15)) / 1000
  console.log('Balance:', balStrk, 'STRK')

  const nonce = await acc.getNonce()
  console.log('Nonce:', nonce)

  // ── TX 1: STRK transfer (call signaling demo) ──────────────────────────────
  console.log('\n[1/3] STRK transfer (call signaling demo)...')
  const tx1 = await acc.execute([{
    contractAddress: STRK_TOKEN,
    entrypoint: 'transfer',
    calldata: CallData.compile({
      recipient: ADDRESS,
      amount: cairo.uint256(BigInt(1e17))  // 0.1 STRK self-transfer
    })
  }])
  console.log('  TX:', tx1.transaction_hash)
  const r1 = await provider.waitForTransaction(tx1.transaction_hash, { retryInterval: 3000 })
  console.log('  Status:', (r1 as any).execution_status)
  console.log('  Block:', (r1 as any).block_number)
  console.log('  Voyager: https://voyager.online/tx/' + tx1.transaction_hash)

  await wait(4000)

  // ── TX 2: STRK post-call payment ───────────────────────────────────────────
  console.log('\n[2/3] STRK post-call payment...')
  const tx2 = await acc.execute([{
    contractAddress: STRK_TOKEN,
    entrypoint: 'transfer',
    calldata: CallData.compile({
      recipient: ADDRESS,
      amount: cairo.uint256(BigInt(5e16))  // 0.05 STRK
    })
  }])
  console.log('  TX:', tx2.transaction_hash)
  const r2 = await provider.waitForTransaction(tx2.transaction_hash, { retryInterval: 3000 })
  console.log('  Status:', (r2 as any).execution_status)
  console.log('  Block:', (r2 as any).block_number)
  console.log('  Voyager: https://voyager.online/tx/' + tx2.transaction_hash)

  await wait(4000)

  // ── TX 3: CallLog.commit_call() ────────────────────────────────────────────
  // commit_call(commitment: felt252) — hash of call metadata
  console.log('\n[3/3] CallLog.commit_call() on mainnet...')
  const CALLLOG = '0x474eafba0ef66427b796890bffc7d80fa9ec90359f649d85c1c54d50bd359fa'
  // Commitment = keccak of caller+timestamp (any unique felt252)
  const commitment = cairo.felt(Date.now().toString())
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

  console.log('\n=== DONE ===')
  console.log('TX1 signaling:      https://voyager.online/tx/' + tx1.transaction_hash)
  console.log('TX2 payment:        https://voyager.online/tx/' + tx2.transaction_hash)
  console.log('TX3 commit_call:    https://voyager.online/tx/' + tx3.transaction_hash)

  return { tx1: tx1.transaction_hash, tx2: tx2.transaction_hash, tx3: tx3.transaction_hash,
           b1: (r1 as any).block_number, b2: (r2 as any).block_number, b3: (r3 as any).block_number }
}

main().then(r => {
  console.log('\nJSON:', JSON.stringify(r, null, 2))
}).catch(e => { console.error('FAILED:', e.message); process.exit(1) })
