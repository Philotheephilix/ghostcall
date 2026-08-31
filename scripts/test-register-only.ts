import { Account, RpcProvider } from 'starknet'
import { CallMockProofProvider } from '@starkware-libs/starknet-privacy-sdk/testing'
import { createPrivateTransfers } from '@starkware-libs/starknet-privacy-sdk'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const POOL = '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91'

async function main() {
  const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL!, blockIdentifier: 'latest' })
  const account = new Account(provider, process.env.STARKNET_ACCOUNT_ADDRESS!, process.env.STARKNET_PRIVATE_KEY!)

  const viewingKey = BigInt(process.env.STARKNET_PRIVATE_KEY!)

  const chainId = await provider.getChainId()  // '0x534e5f5345504f4c4941'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prover = new CallMockProofProvider(provider as any, chainId as any, { validateSignature: false })

  const transfers = createPrivateTransfers({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    account: account as any,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provingProvider: prover as any,
    discoveryProvider: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      discoverNotes: async () => ({ notes: [] as any[], cursor: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      discoverChannels: async () => ({ channels: [] as any[], cursor: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    poolContractAddress: POOL,
  })

  const blockNumber = await provider.getBlockNumber()
  const provingBlockId = blockNumber - 10
  console.log('[reg] provingBlockId:', provingBlockId)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { callAndProof } = await (transfers as any).build().register().execute({ provingBlockId })
    console.log('[reg] proofFacts count:', callAndProof.proof.proofFacts?.length ?? 0)
    const tx = await account.execute(callAndProof.call as any, { tip: 0n })
    console.log('[reg] tx submitted:', tx.transaction_hash)
    await provider.waitForTransaction(tx.transaction_hash)
    console.log('[reg] REGISTERED in pool')
  } catch(e: unknown) {
    const msg = (e instanceof Error ? e.message : String(e))
    if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('viewing key') || msg.toLowerCase().includes('registered')) {
      console.log('[reg] Already registered — ok')
    } else {
      // Print just the execution_error payload, not the full RPC params dump
      const execIdx = msg.indexOf('transaction execution error')
      if (execIdx >= 0) {
        console.error('[reg] Execution error:', msg.slice(execIdx, execIdx + 600))
      } else {
        const lastLine = msg.split('\n').slice(-3).join('\n')
        console.error('[reg] FAILED (last lines):\n', lastLine)
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
