import {
  RpcProvider, Account, Contract, json, stark,
  CallData, hash, ec, CairoOption, CairoOptionVariant,
} from 'starknet'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
dotenv.config()

const CONTRACTS_DIR = path.join(__dirname, '..', 'contracts', 'target', 'dev')

// OZ account class hash (used for account deployment)
const OZ_CLASS_HASH = '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f'

const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL! })

async function deployAccount(privateKey: string, publicKey: string, address: string): Promise<Account> {
  // Check if account is already deployed
  try {
    const nonce = await provider.getNonceForAddress(address)
    console.log(`Account already deployed (nonce: ${nonce})`)
    return new Account({ provider, address, signer: privateKey })
  } catch {
    // Not deployed yet — deploy it
    console.log('Deploying account...')
    const account = new Account({ provider, address, signer: privateKey })
    const { transaction_hash, contract_address } = await account.deployAccount({
      classHash: OZ_CLASS_HASH,
      constructorCalldata: CallData.compile({ publicKey }),
      addressSalt: publicKey,
    })
    console.log('Account deploy tx:', transaction_hash)
    await provider.waitForTransaction(transaction_hash)
    console.log('Account deployed at:', contract_address)
    return new Account({ provider, address: contract_address, signer: privateKey })
  }
}

async function declareAndDeploy(
  account: Account,
  contractName: string,
  constructorCalldata: string[] = [],
): Promise<{ classHash: string; address: string; declareTx: string; deployTx: string }> {
  const sierraPath = path.join(CONTRACTS_DIR, `ghostcall_contracts_${contractName}.contract_class.json`)
  const casmPath = path.join(CONTRACTS_DIR, `ghostcall_contracts_${contractName}.compiled_contract_class.json`)

  if (!existsSync(sierraPath)) {
    throw new Error(`Sierra not found: ${sierraPath}\nRun 'scarb build' in contracts/ first.`)
  }

  const sierra = json.parse(readFileSync(sierraPath, 'utf8'))
  const casm = json.parse(readFileSync(casmPath, 'utf8'))

  console.log(`\nDeclaring ${contractName}...`)
  let classHash: string
  let declareTx: string
  try {
    const declareRes = await account.declare({ contract: sierra, casm })
    declareTx = declareRes.transaction_hash
    classHash = declareRes.class_hash
    console.log(`  Declared. class_hash: ${classHash}`)
    console.log(`  Waiting for tx: ${declareTx}`)
    await provider.waitForTransaction(declareTx)
  } catch (e: any) {
    if (e.message?.includes('already declared') || e.message?.includes('ClassAlreadyDeclared')) {
      // Already declared — compute class hash from Sierra
      classHash = hash.computeContractClassHash(sierra)
      declareTx = 'already-declared'
      console.log(`  Already declared. class_hash: ${classHash}`)
    } else {
      throw e
    }
  }

  console.log(`Deploying ${contractName}...`)
  const deployRes = await account.deployContract({
    classHash,
    constructorCalldata,
    salt: stark.randomAddress(),
  })
  console.log(`  Deploy tx: ${deployRes.transaction_hash}`)
  await provider.waitForTransaction(deployRes.transaction_hash)
  console.log(`  Deployed at: ${deployRes.contract_address}`)

  return {
    classHash,
    address: deployRes.contract_address,
    declareTx,
    deployTx: deployRes.transaction_hash,
  }
}

async function main() {
  const privateKey = process.env.STARKNET_PRIVATE_KEY!
  const publicKey = process.env.STARKNET_PUBLIC_KEY!
  const address = process.env.STARKNET_ACCOUNT_ADDRESS!

  if (!privateKey || !address) {
    throw new Error('STARKNET_PRIVATE_KEY and STARKNET_ACCOUNT_ADDRESS must be set in .env')
  }

  console.log('=== GhostCall Contract Deployment ===')
  console.log('Network:', process.env.STARKNET_CHAIN_ID ?? 'unknown')
  console.log('Account:', address)

  const account = await deployAccount(privateKey, publicKey, address)

  const registry = await declareAndDeploy(account, 'StealthRegistry')
  const callLog = await declareAndDeploy(account, 'CallLog')

  const deployments = {
    network: process.env.STARKNET_CHAIN_ID ?? 'SN_SEPOLIA',
    timestamp: new Date().toISOString(),
    StealthRegistry: registry,
    CallLog: callLog,
  }

  const outPath = path.join(__dirname, '..', 'contracts', 'deployments.json')
  writeFileSync(outPath, JSON.stringify(deployments, null, 2))
  console.log('\n=== Deployment complete ===')
  console.log('StealthRegistry:', registry.address)
  console.log('CallLog:', callLog.address)
  console.log('Written to: contracts/deployments.json')
}

main().catch((e) => { console.error(e); process.exit(1) })
