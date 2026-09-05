/**
 * strk20-pool-ops.ts
 *
 * Executes STRK20 privacy pool operations on Starknet mainnet:
 *  1. Register account with pool (publish viewing key)
 *  2. ERC-20 approve STRK spend
 *  3. Deposit 0.5 STRK into the pool
 *  4. Private self-transfer 0.1 STRK
 *  5. Update strk20.json with the 3 pool TX hashes
 *
 * Reads credentials from .env.mainnet (gitignored).
 * Run: npx ts-node scripts/strk20-pool-ops.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
dotenv.config({ path: path.join(__dirname, '..', '.env.mainnet') })

import { RpcProvider, Account, CallData, constants } from 'starknet'

const RPC_URL    = process.env.RPC_URL!
const PRIV_KEY   = process.env.MAINNET_PRIVATE_KEY!
const ADDRESS    = process.env.MAINNET_ADDRESS!
const STRK_TOKEN = process.env.STRK_TOKEN ?? '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const POOL       = process.env.STRK20_POOL ?? '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const STRK20_JSON = path.join(__dirname, '..', 'strk20.json')

const PROVER_URL    = 'https://prover.strk20.starknet.io'
const DISCOVERY_URL = 'https://discovery.strk20.starknet.io'

const SHIELD_AMOUNT   = BigInt('500000000000000000')  // 0.5 STRK
const TRANSFER_AMOUNT = BigInt('100000000000000000')  // 0.1 STRK

const provider = new RpcProvider({ nodeUrl: RPC_URL })

async function blockOf(txHash: string): Promise<number> {
  const receipt = await provider.getTransactionReceipt(txHash) as any
  return receipt.block_number ?? receipt.blockNumber ?? 0
}

async function waitForProvingBase(minBlock: number) {
  process.stdout.write(`  Waiting for proving base > ${minBlock}`)
  while (true) {
    const cur = await provider.getBlockNumber()
    const base = cur - 10
    process.stdout.write(`\r  Proving base: ${base} (need > ${minBlock})   `)
    if (base > minBlock) break
    await new Promise(r => setTimeout(r, 8000))
  }
  console.log()
}

async function provingBase(): Promise<number> {
  return (await provider.getBlockNumber()) - 10
}

async function main() {
  if (!RPC_URL || !PRIV_KEY || !ADDRESS) {
    console.error('Missing env vars. Check .env.mainnet')
    process.exit(1)
  }

  const account = new Account({ provider, address: ADDRESS, signer: PRIV_KEY })

  const bal = await provider.callContract({ contractAddress: STRK_TOKEN, entrypoint: 'balanceOf', calldata: [ADDRESS] })
  const balStrk = Number(BigInt(bal[0]) * 100n / BigInt('1000000000000000000')) / 100
  console.log('=== STRK20 Pool Operations ===')
  console.log('Account:', ADDRESS)
  console.log(`Balance: ${balStrk} STRK`)
  if (balStrk < 0.6) {
    console.error('Insufficient balance for deposit (need > 0.6 STRK for deposit + fees)')
    process.exit(1)
  }

  const nonce = await provider.getNonceForAddress(ADDRESS)
  const deployBlock = Math.max(0, (await provider.getBlockNumber()) - 1)
  console.log(`Nonce: ${nonce}, deploy block estimate: ${deployBlock}\n`)

  const { createPrivateTransfers } = require('@starkware-libs/starknet-privacy-sdk')
  const viewingKey = BigInt(PRIV_KEY)
  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: { url: PROVER_URL, chainId: constants.StarknetChainId.SN_MAIN },
    discoveryProvider: { url: DISCOVERY_URL },
    poolContractAddress: POOL,
  })

  // ── 1. Register ──
  console.log('→ Registering with STRK20 pool...')
  await waitForProvingBase(deployBlock)
  const regBase = await provingBase()
  const { callAndProof: regProof } = await transfers.build().register().execute({ provingBlockId: regBase })
  const regProofDetails = regProof.proof.proofFacts?.length
    ? { proofFacts: regProof.proof.proofFacts, proof: regProof.proof.data }
    : {}
  const regTx = await account.execute(regProof.call, { tip: 0n, ...regProofDetails })
  await provider.waitForTransaction(regTx.transaction_hash)
  const regBlock = await blockOf(regTx.transaction_hash)
  console.log('✓ Registered. TX:', regTx.transaction_hash)

  // ── 2. Approve STRK ──
  console.log('\n→ Approving STRK spend...')
  const approveTx = await account.execute({
    contractAddress: STRK_TOKEN,
    entrypoint: 'approve',
    calldata: CallData.compile({ spender: POOL, amount: { low: SHIELD_AMOUNT, high: 0n } }),
  })
  await provider.waitForTransaction(approveTx.transaction_hash)
  const approveBlock = await blockOf(approveTx.transaction_hash)
  console.log('✓ Approved. TX:', approveTx.transaction_hash)

  // ── 3. Deposit ──
  await waitForProvingBase(Math.max(regBlock, approveBlock))
  console.log('\n→ Depositing 0.5 STRK into pool...')
  const depBase = await provingBase()
  const { callAndProof: depProof } = await transfers
    .build({ autoDiscover: { notes: 'missing' } })
    .with(STRK_TOKEN, (t: any) => t.deposit({ amount: SHIELD_AMOUNT, surplusTo: ADDRESS, autoSetup: true }))
    .execute({ provingBlockId: depBase })
  const depProofDetails = depProof.proof.proofFacts?.length
    ? { proofFacts: depProof.proof.proofFacts, proof: depProof.proof.data }
    : {}
  const depTx = await account.execute(depProof.call, { tip: 0n, ...depProofDetails })
  await provider.waitForTransaction(depTx.transaction_hash)
  const depBlock = await blockOf(depTx.transaction_hash)
  console.log('✓ Deposited. TX:', depTx.transaction_hash)

  // ── 4. Private self-transfer ──
  await waitForProvingBase(depBlock + 10)
  console.log('\n→ Private self-transfer (0.1 STRK)...')
  const xferBase = await provingBase()
  const { callAndProof: xferProof } = await transfers
    .build({ autoDiscover: { notes: 'missing' } })
    .with(STRK_TOKEN, (t: any) =>
      t.transfer({ to: ADDRESS, amount: TRANSFER_AMOUNT, autoSelectNotes: 'naive', surplusTo: ADDRESS })
    )
    .execute({ provingBlockId: xferBase })
  const xferProofDetails = xferProof.proof.proofFacts?.length
    ? { proofFacts: xferProof.proof.proofFacts, proof: xferProof.proof.data }
    : {}
  const xferTx = await account.execute(xferProof.call, { tip: 0n, ...xferProofDetails })
  await provider.waitForTransaction(xferTx.transaction_hash)
  console.log('✓ Private transfer done. TX:', xferTx.transaction_hash)

  // ── 5. Update strk20.json ──
  const strk20 = JSON.parse(fs.readFileSync(STRK20_JSON, 'utf8'))
  if (!strk20.transactions.includes(regTx.transaction_hash)) strk20.transactions.push(regTx.transaction_hash)
  if (!strk20.transactions.includes(depTx.transaction_hash)) strk20.transactions.push(depTx.transaction_hash)
  if (!strk20.transactions.includes(xferTx.transaction_hash)) strk20.transactions.push(xferTx.transaction_hash)
  const len = strk20.transactions.length
  strk20._notes[`transactions[${len - 3}]`] = 'STRK20 pool register() — mainnet'
  strk20._notes[`transactions[${len - 2}]`] = 'STRK20 pool deposit() 0.5 STRK — mainnet'
  strk20._notes[`transactions[${len - 1}]`] = 'STRK20 pool private self-transfer 0.1 STRK — mainnet'
  delete strk20._notes['TODO_tx_3']
  fs.writeFileSync(STRK20_JSON, JSON.stringify(strk20, null, 2))
  console.log('\n✓ strk20.json updated')

  console.log('\n=== STRK20 POOL OPS COMPLETE ===')
  console.log('register TX:   ', regTx.transaction_hash)
  console.log('deposit TX:    ', depTx.transaction_hash)
  console.log('transfer TX:   ', xferTx.transaction_hash)
}

main().catch(e => {
  console.error('\nFatal:', e?.baseError?.data ?? e?.message ?? e)
  process.exit(1)
})
