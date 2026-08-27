# Private Registration / Time-Attack Prevention

## The Problem

When you broadcast a tx from your wallet, your address appears in the `from` field — always, unconditionally. If you deposit funds at T0 and post your address publicly at T1, an observer correlates T0 ≈ T1 and knows "this person registered at T0."

**Goal:** Your public address (0xMAIN) must have zero on-chain trace until the moment you choose to reveal it.

---

## Why Two Addresses

You cannot hide `msg.sender`. The only solution is to use an address that isn't linked to your identity for the payment step.

| Address | Purpose | Exposed when | To whom |
|---|---|---|---|
| 0xFRESH | Pays, holds no identity | T0 | Everyone — but nobody knows it's you |
| 0xMAIN | Your public identity | T2 (batch claim) | Everyone — but T0 is already cold |

**If you use only 0xMAIN throughout:**
```
T0: 0xMAIN deposits → on-chain record exists
T1: you post 0xMAIN → observer finds T0 deposit → time attack succeeds
```

**With the split:**
```
T0: 0xFRESH deposits → observer sees unknown address, no identity
T1: you post 0xMAIN → observer searches 0xMAIN → finds nothing at T0
T2: Devcon batch claims → 0xMAIN gets ticket → T0 is cold, no link
```

---

## What Is Exposed at Each Stage

```
T0 (deposit):
  On-chain:  0xFRESH sent funds to escrow contract
  Visible:   0xFRESH address, amount, timestamp
  Hidden:    who controls 0xFRESH, any link to 0xMAIN

T1 (your post):
  On-chain:  nothing
  Visible:   0xMAIN (you chose to reveal it)
  Hidden:    that you paid at T0, when you decided

T2 (Devcon batch claim):
  On-chain:  ticket minted to 0xMAIN, funds released to Devcon
  Visible:   0xMAIN received ticket
  Hidden:    when funds were locked, that 0xFRESH = you
```

---

## The Remaining Leak: How Did 0xFRESH Get Funded?

If funded from 0xMAIN:
```
0xMAIN → 0xFRESH → escrow
```
One-hop chain analysis links them. Everything breaks.

**Options to fund 0xFRESH without linking to 0xMAIN:**

| Method | How | Trade-off |
|---|---|---|
| CEX withdrawal | Withdraw directly to 0xFRESH from exchange | CEX knows your identity (different threat model) |
| Privacy Pools | 0xMAIN deposits → ZK proof → 0xFRESH withdraws | Live on Ethereum mainnet, legally defensible |
| Cross-chain bridge | Fund on different chain, bridge to fresh address | Extra steps |
| Fresh CEX account | Separate exchange account → 0xFRESH | KYC on second account |

---

## Full Flow (Devcon Scenario)

```
T0 (private — zero on-chain trace for 0xMAIN):
  1. Generate: salt = random 32 bytes (keep this secret)
  2. Compute:  commitment = keccak256(0xMAIN, salt)
  3. 0xFRESH calls: escrow.deposit(commitment, deadline) + sends ticket price
  4. Give Devcon off-chain: (0xMAIN, your ERC-712 signature)
  5. Funds locked — can only ever go to 0xMAIN, nowhere else

T1 (whenever you want):
  Post: "Going to Devcon! Address: 0xMAIN"
  Observer searches 0xMAIN on-chain → finds nothing

T2 (Devcon triggers — batch for all attendees):
  Devcon calls: batchClaim([...all signed messages...])
  Contract for each entry:
    - recompute commitment = keccak256(recipient, salt)
    - verify signature: ecrecover(ERC712hash, sig) == recipient
    - release funds to Devcon
    - mint ticket to recipient (0xMAIN)
  All claims happen in one tx → 500 addresses revealed simultaneously
  Observer cannot tell which ones committed at T0 vs T0+6days
```

**The batch is critical:** individual purchase timestamps collapse into a single T2. No timing signal survives.

---

## What Devcon Needs From You (Off-Chain Only)

| Data | When | Channel |
|---|---|---|
| 0xMAIN address | At registration | Off-chain form |
| ERC-712 signature | At registration | Off-chain |
| salt | Never | Contract handles verification |

Devcon stores signed messages off-chain. Nothing hits the chain until they trigger the batch.

---

## Contract Interface

```solidity
// 0xFRESH calls this at T0
function deposit(bytes32 commitment, uint256 deadline) external payable;

// Only Devcon calls this at T2
function batchClaim(ClaimParams[] calldata claims) external onlyDevcon;

struct ClaimParams {
    address recipient;      // 0xMAIN
    bytes32 salt;
    uint8 v; bytes32 r; bytes32 s;  // 0xMAIN's ERC-712 signature
}

// If Devcon never claims, 0xFRESH gets refunded after deadline
function refund(bytes32 commitment) external;
```

**Inside batchClaim:**
1. Recompute `commitment = keccak256(recipient, salt)`
2. Verify `ecrecover(ERC712hash, sig) == recipient`
3. Check commitment exists in escrow and is unclaimed
4. Mark claimed, release funds to Devcon, mint ticket to recipient

---

## Guarantees

| Property | Status | Why |
|---|---|---|
| Purchase timestamp hidden | ✅ | T0 has no on-chain trace for 0xMAIN |
| Funds locked, cannot be mismoved | ✅ | Commitment binds recipient at deposit — no function allows redirect |
| Devcon controls claim timing | ✅ | `onlyDevcon` modifier on batchClaim |
| Individual timing hidden in batch | ✅ | All T0s collapse into single T2 |
| Trustless fund safety | ✅ | Expiry refund if Devcon never claims |
| 0xFRESH ↔ 0xMAIN unlinked on-chain | ✅ | No tx ever connects them |
| No third party can redirect funds | ✅ | Salt + signature both required to claim |

---

## What Is NOT Solved

| Gap | Notes |
|---|---|
| Devcon knows 0xMAIN before T2 | You give it to them off-chain at registration — they just can't prove when you paid |
| 0xFRESH is still on-chain at T0 | Visible, but unidentifiable unless funded from 0xMAIN |
| Funding source of 0xFRESH | Must use CEX withdrawal or Privacy Pools — this is the only remaining leak |
| Devcon could publish registration timestamps | Off-chain operational security — contract cannot prevent this |

---

## Mechanisms Considered and Why They Were Ruled Out

| Mechanism | Why Not |
|---|---|
| Commit-reveal (ENS-style) | `msg.sender` still visible at T0 — hides content, not identity |
| Shutter Network | Encrypts calldata only, not `from` field. Not on Ethereum mainnet or Starknet |
| ERC-4337 time guards | Sender visible in bundler mempool from T0 — delays execution, not exposure |
| Single address with delay | Same address at T0 and T1 — trivially linkable |
| Stealth addresses alone | Stealth address needs gas from unlinkable source — same chicken-and-egg as 0xFRESH |

---

## Privacy Pools (Strongest Funding Option for 0xFRESH)

Live on Ethereum mainnet: `0xF241d57C6DebAe225c0F2e6eA1529373C9A9C9fB`

```
0xMAIN → Privacy Pools deposit
         [days pass, anonymity set grows]
         ZK proof (Groth16) → relayer withdraws to 0xFRESH
0xFRESH → escrow deposit (T0)
```

Unlike Tornado Cash: includes an association set proof certifying funds are clean. Legally defensible. Ragequit prevents censorship by the ASP (Association Set Provider).

UI: https://privacypools.com
Repo: https://github.com/0xbow-io/privacy-pools-core
