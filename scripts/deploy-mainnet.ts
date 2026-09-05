/**
 * deploy-mainnet.ts
 *
 * Full mainnet deployment pipeline:
 *  1. Deploy OZ account (if not already deployed)
 *  2. Deploy StealthRegistry + CallLog contracts
 *  3. Register account with STRK20 privacy pool
 *  4. Shield STRK into pool (deposit)
 *  5. Private self-transfer (demonstrates pool transfer)
 *  6. Update strk20.json with all mainnet tx hashes and contract addresses
 *
 * Run:
 *   npx ts-node scripts/deploy-mainnet.ts
 *
 * Reads credentials from .env.mainnet (gitignored).
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
dotenv.config({ path: path.join(__dirname, '..', '.env.mainnet') })

import {
  RpcProvider, Account, CallData, hash, json, stark, constants,
} from 'starknet'

const RPC_URL    = process.env.RPC_URL!
const PRIV_KEY   = process.env.MAINNET_PRIVATE_KEY!
const PUB_KEY    = process.env.MAINNET_PUBLIC_KEY!
const ADDRESS    = process.env.MAINNET_ADDRESS!
const STRK_TOKEN = process.env.STRK_TOKEN ?? '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const POOL       = process.env.STRK20_POOL ?? '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts', 'target', 'dev')
const STRK20_JSON   = path.join(__dirname, '..', 'strk20.json')
const DEPLOYMENTS_JSON = path.join(__dirname, '..', 'contracts', 'deployments-mainnet.json')

const OZ_CLASS_HASH = '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f'
const PROVER_URL    = 'https://prover.strk20.starknet.io'
const DISCOVERY_URL = 'https://discovery.strk20.starknet.io'

// 0.5 STRK in wei (18 decimals)
const SHIELD_AMOUNT = BigInt('500000000000000000')

const provider = new RpcProvider({ nodeUrl: RPC_URL })

// ─────────────── helpers ───────────────

async function waitBlocks(n: number) {
  const start = await provider.getBlockNumber()
  process.stdout.write(`  Waiting ${n} blocks (current: ${start})`)
  while (true) {
    await new Promise(r => setTimeout(r, 8000))
    const cur = await provider.getBlockNumber()
    process.stdout.write(`\r  Waiting ${n} blocks — current: ${cur}, target: ${start + n}   `)
    if (cur >= start + n) break
  }
  console.log(' done.')
}

async function blockOf(txHash: string): Promise<number> {
  const receipt = await provider.getTransactionReceipt(txHash) as any
  return receipt.block_number ?? receipt.blockNumber ?? 0
}

async function provingBase(): Promise<number> {
  return (await provider.getBlockNumber()) - 10
}

// ─────────────── Step 1: deploy OZ account ───────────────

async function ensureAccountDeployed(): Promise<Account> {
  const account = new Account({ provider, address: ADDRESS, signer: PRIV_KEY })
  try {
    const nonce = await provider.getNonceForAddress(ADDRESS)
    console.log(`✓ Account already deployed (nonce: ${nonce})`)
    return account
  } catch {
    console.log('→ Deploying OZ account...')
    const { transaction_hash } = await account.deployAccount({
      classHash: OZ_CLASS_HASH,
      constructorCalldata: CallData.compile({ publicKey: PUB_KEY }),
      addressSalt: PUB_KEY,
    })
    console.log('  deploy-account tx:', transaction_hash)
    await provider.waitForTransaction(transaction_hash)
    console.log('✓ Account deployed:', ADDRESS)
    return account
  }
}

// ─────────────── Step 2: declare + deploy contracts ───────────────

async function declareAndDeploy(
  account: Account,
  name: string,
  constructorCalldata: string[] = [],
): Promise<{ classHash: string; address: string; declareTx: string; deployTx: string }> {
  const sierraPath = path.join(CONTRACTS_DIR, `ghostcall_contracts_${name}.contract_class.json`)
  const casmPath   = path.join(CONTRACTS_DIR, `ghostcall_contracts_${name}.compiled_contract_class.json`)
  const sierra = json.parse(fs.readFileSync(sierraPath, 'utf8'))
  const casm   = json.parse(fs.readFileSync(casmPath, 'utf8'))

  let classHash: string
  let declareTx: string
  try {
    // Estimate first to get actual fee, then cap to 1.5x to stay under balance
    const feeEst = await account.estimateDeclareFee({ contract: sierra, casm })
    const l2Max  = (feeEst.resourceBounds.l2_gas.max_amount * 3n / 2n)
    const l2Price= feeEst.resourceBounds.l2_gas.max_price_per_unit
    const l1Max  = feeEst.resourceBounds.l1_gas.max_amount
    const l1Price= feeEst.resourceBounds.l1_gas.max_price_per_unit
    const ldMax  = feeEst.resourceBounds.l1_data_gas?.max_amount ?? 0n
    const ldPrice= feeEst.resourceBounds.l1_data_gas?.max_price_per_unit ?? 0n
    console.log(`  [${name}] estimated fee: ${feeEst.overall_fee} wei`)
    const res = await account.declare({ contract: sierra, casm }, {
      resourceBounds: {
        l2_gas:    { max_amount: l2Max, max_price_per_unit: l2Price },
        l1_gas:    { max_amount: l1Max, max_price_per_unit: l1Price },
        l1_data_gas: { max_amount: ldMax, max_price_per_unit: ldPrice },
      },
      tip: 0n,
    })
    declareTx = res.transaction_hash
    classHash = res.class_hash
    console.log(`  [${name}] declare tx: ${declareTx}`)
    await provider.waitForTransaction(declareTx)
  } catch (e: any) {
    if (e.message?.includes('already declared') || e.message?.includes('ClassAlreadyDeclared')) {
      classHash = hash.computeContractClassHash(sierra)
      declareTx = 'already-declared'
      console.log(`  [${name}] already declared: ${classHash}`)
    } else throw e
  }

  const deployRes = await account.deployContract({ classHash, constructorCalldata, salt: stark.randomAddress() })
  console.log(`  [${name}] deploy tx: ${deployRes.transaction_hash}`)
  await provider.waitForTransaction(deployRes.transaction_hash)
  console.log(`  [${name}] ✓ address: ${deployRes.contract_address}`)

  return { classHash, address: deployRes.contract_address, declareTx, deployTx: deployRes.transaction_hash }
}

// ─────────────── Step 3-5: STRK20 pool ops ───────────────

async function strk20Ops(account: Account, deployBlock: number): Promise<{ registerTx: string; depositTx: string; transferTx: string }> {
  const { createPrivateTransfers } = require('@starkware-libs/starknet-privacy-sdk')

  const viewingKey = BigInt(PRIV_KEY)
  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: { url: PROVER_URL, chainId: constants.StarknetChainId.SN_MAIN },
    discoveryProvider: { url: DISCOVERY_URL },
    poolContractAddress: POOL,
  })

  // ── Step 3: Register ──
  // Must wait until provingBase > deployBlock
  console.log('\n→ Waiting for proving base to pass account deploy block...')
  while (true) {
    const base = await provingBase()
    if (base > deployBlock) break
    await new Promise(r => setTimeout(r, 8000))
    process.stdout.write(`\r  proving base: ${base}, deploy block: ${deployBlock}   `)
  }
  console.log('\n→ Registering with STRK20 pool...')
  const regBase = await provingBase()
  const { callAndProof: regProof } = await transfers.build().register().execute({ provingBlockId: regBase })
  const proofDetailsReg = regProof.proof.proofFacts?.length
    ? { proofFacts: regProof.proof.proofFacts, proof: regProof.proof.data }
    : {}
  const regTxRes = await account.execute(regProof.call, { tip: 0n, ...proofDetailsReg })
  await provider.waitForTransaction(regTxRes.transaction_hash)
  console.log('✓ Registered. TX:', regTxRes.transaction_hash)
  const regBlock = await blockOf(regTxRes.transaction_hash)

  // ── Step 4: ERC-20 approve then deposit ──
  // Wait for registration to be in proving base
  console.log('\n→ Approving STRK spend...')
  const approveTxRes = await account.execute({
    contractAddress: STRK_TOKEN,
    entrypoint: 'approve',
    calldata: CallData.compile({ spender: POOL, amount: { low: SHIELD_AMOUNT, high: 0n } }),
  })
  await provider.waitForTransaction(approveTxRes.transaction_hash)
  console.log('✓ Approved. TX:', approveTxRes.transaction_hash)
  const approveBlock = await blockOf(approveTxRes.transaction_hash)

  console.log('\n→ Waiting for proving base to include registration + approval...')
  while (true) {
    const base = await provingBase()
    if (base > Math.max(regBlock, approveBlock)) break
    await new Promise(r => setTimeout(r, 8000))
    process.stdout.write(`\r  proving base: ${base}, need: >${Math.max(regBlock, approveBlock)}   `)
  }
  console.log('\n→ Depositing 0.5 STRK into pool...')
  const depBase = await provingBase()
  const { callAndProof: depProof } = await transfers
    .build({ autoDiscover: { notes: 'missing' } })
    .with(STRK_TOKEN, (t: any) => t.deposit({ amount: SHIELD_AMOUNT, surplusTo: ADDRESS, autoSetup: true }))
    .execute({ provingBlockId: depBase })
  const proofDetailsDep = depProof.proof.proofFacts?.length
    ? { proofFacts: depProof.proof.proofFacts, proof: depProof.proof.data }
    : {}
  const depTxRes = await account.execute(depProof.call, { tip: 0n, ...proofDetailsDep })
  await provider.waitForTransaction(depTxRes.transaction_hash)
  console.log('✓ Deposited. TX:', depTxRes.transaction_hash)
  const depBlock = await blockOf(depTxRes.transaction_hash)

  // ── Step 5: Private self-transfer ──
  console.log('\n→ Waiting for deposit note to mature (10+ blocks)...')
  while (true) {
    const base = await provingBase()
    if (base > depBlock + 10) break
    await new Promise(r => setTimeout(r, 8000))
    process.stdout.write(`\r  proving base: ${base}, need: >${depBlock + 10}   `)
  }

  console.log('\n→ Discovering notes...')
  const notes = await transfers.discoverNotes({ tokens: [BigInt(STRK_TOKEN)] })
  const myNotes = notes.get(BigInt(STRK_TOKEN)) ?? []
  console.log(`  Found ${myNotes.length} note(s)`)

  console.log('\n→ Private self-transfer (0.1 STRK back to self)...')
  const transferAmount = BigInt('100000000000000000') // 0.1 STRK
  const xferBase = await provingBase()
  const { callAndProof: xferProof } = await transfers
    .build({ autoDiscover: { notes: 'missing' } })
    .with(STRK_TOKEN, (t: any) =>
      t.transfer({ to: ADDRESS, amount: transferAmount, autoSelectNotes: 'naive', surplusTo: ADDRESS })
    )
    .execute({ provingBlockId: xferBase })
  const proofDetailsXfer = xferProof.proof.proofFacts?.length
    ? { proofFacts: xferProof.proof.proofFacts, proof: xferProof.proof.data }
    : {}
  const xferTxRes = await account.execute(xferProof.call, { tip: 0n, ...proofDetailsXfer })
  await provider.waitForTransaction(xferTxRes.transaction_hash)
  console.log('✓ Private transfer done. TX:', xferTxRes.transaction_hash)

  return {
    registerTx: regTxRes.transaction_hash,
    depositTx:  depTxRes.transaction_hash,
    transferTx: xferTxRes.transaction_hash,
  }
}

// ─────────────── main ───────────────

async function main() {
  if (!RPC_URL || !PRIV_KEY || !ADDRESS) {
    console.error('Missing env vars. Run: source .env.mainnet or check .env.mainnet exists')
    process.exit(1)
  }

  console.log('=== GhostCall Mainnet Deployment ===')
  console.log('Account:', ADDRESS)
  console.log('RPC:', RPC_URL)

  const bal = await provider.callContract({ contractAddress: STRK_TOKEN, entrypoint: 'balanceOf', calldata: [ADDRESS] })
  const balStrk = Number(BigInt(bal[0]) * 100n / BigInt('1000000000000000000')) / 100
  console.log(`Balance: ${balStrk} STRK\n`)

  // 1. Deploy account
  const account = await ensureAccountDeployed()
  let deployBlock = 0
  try {
    const receipt = await provider.getTransactionReceipt(ADDRESS) as any
    deployBlock = receipt?.block_number ?? 0
  } catch {}
  if (deployBlock === 0) deployBlock = (await provider.getBlockNumber()) - 1

  // 2. Deploy contracts
  console.log('\n=== Deploying StealthRegistry ===')
  const registry = await declareAndDeploy(account, 'StealthRegistry')

  console.log('\n=== Deploying CallLog ===')
  const callLog = await declareAndDeploy(account, 'CallLog')

  const deployments = {
    network: 'SN_MAIN',
    timestamp: new Date().toISOString(),
    StealthRegistry: registry,
    CallLog: callLog,
  }
  fs.writeFileSync(DEPLOYMENTS_JSON, JSON.stringify(deployments, null, 2))
  console.log('\n✓ Deployments saved to contracts/deployments-mainnet.json')

  // 3-5. STRK20 pool: register → deposit → transfer
  console.log('\n=== STRK20 Pool Operations ===')
  let poolTxs = { registerTx: '', depositTx: '', transferTx: '' }
  try {
    poolTxs = await strk20Ops(account, deployBlock)
  } catch (e: any) {
    console.error('\n⚠ STRK20 pool ops failed:', e.message ?? e)
    console.log('Continuing — contracts deployed successfully. Re-run pool ops separately.')
  }

  // 6. Update strk20.json
  const strk20 = JSON.parse(fs.readFileSync(STRK20_JSON, 'utf8'))
  strk20.contracts = [registry.address, callLog.address]
  strk20._notes['contracts[0]'] = 'StealthRegistry — Starknet MAINNET'
  strk20._notes['contracts[1]'] = 'CallLog — Starknet MAINNET'
  if (poolTxs.registerTx) {
    strk20.transactions.push(poolTxs.registerTx)
    strk20._notes[`transactions[${strk20.transactions.length - 1}]`] = 'STRK20 pool register() — mainnet'
  }
  if (poolTxs.depositTx) {
    strk20.transactions.push(poolTxs.depositTx)
    strk20._notes[`transactions[${strk20.transactions.length - 1}]`] = 'STRK20 pool deposit() 0.5 STRK — mainnet'
  }
  if (poolTxs.transferTx) {
    strk20.transactions.push(poolTxs.transferTx)
    strk20._notes[`transactions[${strk20.transactions.length - 1}]`] = 'STRK20 pool private self-transfer 0.1 STRK — mainnet'
    delete strk20._notes['TODO_tx_3']
  }
  fs.writeFileSync(STRK20_JSON, JSON.stringify(strk20, null, 2))
  console.log('\n✓ strk20.json updated')

  console.log('\n=== MAINNET DEPLOYMENT COMPLETE ===')
  console.log('StealthRegistry:', registry.address)
  console.log('CallLog:', callLog.address)
  if (poolTxs.registerTx)  console.log('STRK20 register TX:', poolTxs.registerTx)
  if (poolTxs.depositTx)   console.log('STRK20 deposit TX:', poolTxs.depositTx)
  if (poolTxs.transferTx)  console.log('STRK20 transfer TX:', poolTxs.transferTx)
}

main().catch(e => { console.error(e); process.exit(1) })
