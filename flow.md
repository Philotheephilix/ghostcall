# Private Registration Flow

## What the Sniffer Is Trying to Do

Watch the chain for any wallet activity near your social post timestamp,
then link "this wallet = this person attending Devcon."

---

## Linear Flow

```mermaid
flowchart TD
    T0["T0 — REGISTRATION\n──────────────────\nYou fill out Devcon form\nYou give Devcon: 0xMAIN + signature (off-chain)\n0xFRESH deposits funds into escrow\ncommitment = keccak256(0xMAIN, salt) stored on-chain"]

    T1["T1 — SOCIAL POST\n──────────────────\nYou post: 'I will be attending Devcon'\nNo address, no wallet, no tx hash mentioned\nNothing on-chain from 0xMAIN"]

    T2["T2 — DEVCON BATCH CLAIM\n──────────────────\nDevcon calls batchClaim for all attendees at once\nTicket minted to 0xMAIN\nFunds released to Devcon"]

    T0 --> T1 --> T2
```

---

## Who Knows What at Each Phase

```mermaid
flowchart LR
    subgraph T0["T0 — Registration"]
        direction TB
        Y0["YOU\n✅ 0xMAIN\n✅ 0xFRESH\n✅ salt\n✅ decision timestamp"]
        D0["DEVCON\n✅ 0xMAIN\n✅ your signature\n❌ 0xFRESH\n❌ salt"]
        S0["SNIFFER\n✅ 0xFRESH paid escrow\n✅ amount + timestamp\n❌ who owns 0xFRESH\n❌ 0xMAIN\n❌ any link to you"]
    end

    subgraph T1["T1 — Social Post"]
        direction TB
        Y1["YOU\n✅ everything"]
        D1["DEVCON\n✅ 0xMAIN\n✅ you posted\n❌ 0xFRESH"]
        S1["SNIFFER\n✅ 'someone' posted about Devcon\n❌ your address\n❌ 0xMAIN\n❌ any on-chain link\n❌ 0xFRESH = poster"]
    end

    subgraph T2["T2 — Batch Claim"]
        direction TB
        Y2["YOU\n✅ everything"]
        D2["DEVCON\n✅ 0xMAIN got ticket\n✅ funds received"]
        S2["SNIFFER\n✅ 0xMAIN received ticket at T2\n✅ batch of N addresses claimed together\n❌ which address posted at T1\n❌ when funds were locked\n❌ 0xFRESH = 0xMAIN"]
    end

    T0 --> T1 --> T2
```

---

## Fund Flow

```mermaid
flowchart TD
    CEX["CEX / Bridge\n(no link to 0xMAIN)"]
    FRESH["0xFRESH\n(throwaway wallet)"]
    ESCROW["Escrow Contract\n(on-chain)"]
    DEVCON["Devcon\n(recipient)"]
    MAIN["0xMAIN\n(your identity)"]
    TICKET["Ticket NFT"]

    CEX -->|"fund 0xFRESH\n(breaks chain link)"| FRESH
    FRESH -->|"T0: deposit ticket price\n+ commitment hash"| ESCROW
    ESCROW -->|"T2: release funds\n(after batch claim)"| DEVCON
    ESCROW -->|"T2: mint ticket"| TICKET
    TICKET -->|"delivered to"| MAIN

    ESCROW -->|"if Devcon never claims\nbefore deadline → refund"| FRESH

    style CEX fill:#555,color:#fff
    style FRESH fill:#c0392b,color:#fff
    style ESCROW fill:#2471a3,color:#fff
    style DEVCON fill:#1e8449,color:#fff
    style MAIN fill:#1e8449,color:#fff
    style TICKET fill:#7d3c98,color:#fff
```

### What moves when

| Step | From | To | What | Visible to sniffer |
|---|---|---|---|---|
| Fund 0xFRESH | CEX/bridge | 0xFRESH | Gas + ticket price | 0xFRESH address only — no link to 0xMAIN |
| T0 deposit | 0xFRESH | Escrow | Ticket price + commitment hash | 0xFRESH, amount, commitment blob |
| T2 claim | Escrow | Devcon | Ticket price | 0xMAIN revealed here for first time |
| T2 mint | Escrow | 0xMAIN | Ticket NFT | 0xMAIN, but T0 is cold and batch hides timing |
| Refund (if no claim) | Escrow | 0xFRESH | Ticket price | 0xFRESH only |

---

## What the Sniffer Sees vs Needs

```mermaid
flowchart TD
    A["Sniffer sees at T0:\n0xFRESH → escrow tx"]
    B["Sniffer sees at T1:\nSocial post: 'attending Devcon'\nNo address mentioned"]
    C["Sniffer sees at T2:\nN addresses received tickets\n0xMAIN is one of them"]

    A -. "no identity attached to 0xFRESH" .-> X1["❌ cannot link T0 tx to poster"]
    B -. "no on-chain footprint from poster" .-> X2["❌ cannot find a wallet for this person"]
    C -. "batch — all T0s collapsed into T2\nno timing signal" .-> X3["❌ cannot tell when 0xMAIN decided to attend"]

    X1 & X2 & X3 --> WIN["Sniffer learns nothing\nabout who you are\nor when you committed"]
```
