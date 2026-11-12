<div align="center">

# NOSIH — Solution Design

### Immutable Decentralized Deed Authentication & Verification

*One Land. One Hash. One Chain. Verifiable in 1.4 seconds.*

</div>

---

## 1. Problem at a Glance

```mermaid
mindmap
  root((Land Fraud
  in India))
    Scale
      66% of civil cases
      20 yrs avg dispute
      200B+ USD at risk
      1332 illegal deeds Bengaluru
    Vectors
      Impersonation 23%
      Sub-registrar collusion 20%
      Portal tampering 18%
      Forged PoA 15%
      Govt land grabs 12%
      Stamp factories 12%
    Root Causes
      Paper deeds forgeable
      Centralized portals mutable
      No continuous ownership proof
      No public tamper-evidence
```

| Statistic | Source |
|---|---|
| `66%` of Indian civil cases are property disputes | *Sammiullah v. State of Bihar, Supreme Court, Nov 2025* |
| `1,332` illegal registrations in Bengaluru (Dec 2024–Dec 2025) | Kaveri 2.0 audit |
| `10,000+` suspicious transactions on Dharani | Telangana forensic audit |
| `$12.3B` global document fraud (2024), `+37% YoY` | Industry report |

---

## 2. Design Goals

```mermaid
graph TD
    G1[Tamper-Evident] -->|SHA-256 + on-chain anchor| R1[Any edit flips the hash]
    G2[Privacy-Preserving] -->|HMAC pepper + AES-GCM + RLS| R2[Zero PII on chain]
    G3[Instant Verifiable] -->|3-way live check| R3[Verdict in 1.4 s]
    G4[Continuous Ownership] -->|previousRecordId linking| R4[A → B → C unbroken]
    G5[Zero Silent Fallback] -->|409 on mismatch| R5[No manual override]
    G6[Human-in-the-Loop] -->|Registrar approves AI| R6[AI assists, not decides]

    style G1 fill:#1b4332,color:#fff
    style G2 fill:#1b4332,color:#fff
    style G3 fill:#1b4332,color:#fff
    style G4 fill:#1b4332,color:#fff
    style G5 fill:#1b4332,color:#fff
    style G6 fill:#1b4332,color:#fff
```

---

## 3. Solution Concept

```mermaid
flowchart LR
    subgraph INPUT["1 · Input"]
        A1["Executed Deed PDF<br/>(registrar upload)"]
    end

    subgraph EXTRACT["2 · AI Extraction"]
        B1["Gemini 3.6 Flash<br/>text-layer → OCR → vision"]
        B2["18 structured fields<br/>(registrar reviews)"]
    end

    subgraph CRYPTO["3 · Cryptographic Engine"]
        C1["HMAC-SHA256<br/>→ propertyId"]
        C2["SHA-256<br/>→ documentHash"]
        C3["AES-256-GCM<br/>→ ciphertext"]
        C4["keccak256<br/>→ recordId · ownerIds"]
    end

    subgraph STORE["4 · Three-Tier Storage"]
        D1[("IPFS<br/>ciphertext")]
        D2[["Polygon / Besu<br/>12 hashes"]]
        D3[("Supabase RLS<br/>private PII")]
    end

    subgraph VERIFY["5 · Public Verification"]
        E1["QR scan / PDF drop"]
        E2["DB == Chain == PDF"]
        E3["Verdict 1.4 s"]
    end

    A1 --> B1 --> B2 --> C1 & C2 & C3 & C4
    C1 & C2 & C4 --> D2
    C3 --> D1
    B2 --> D3
    D1 & D2 & D3 --> E1 --> E2 --> E3

    style INPUT fill:#0d1b2a,color:#fff
    style EXTRACT fill:#1b263b,color:#fff
    style CRYPTO fill:#415a77,color:#fff
    style STORE fill:#778da9,color:#000
    style VERIFY fill:#e0e1dd,color:#000
```

---

## 4. Actor Roles & Portal Surfaces

```mermaid
graph TB
    subgraph ACTORS["Actors"]
        REG["Registrar<br/>(authorised officer)"]
        ADM["Admin<br/>(dept head)"]
        CIT["Citizen / Buyer"]
        BNK["Bank Officer"]
        CRT["Court / Tribunal"]
    end

    subgraph PORTALS["NOSIH Portal Surfaces"]
        P1["/login<br/>JWT 8h HS256"]
        P2["/register<br/>PDF → AI → chain"]
        P3["/records<br/>search · decrypt · revoke"]
        P4["/verify<br/>public · no auth"]
        P5["/dashboard<br/>stats + recent"]
    end

    REG --> P2 & P3 & P5
    ADM --> P1 & P5
    CIT --> P4
    BNK --> P4
    CRT --> P4

    style REG fill:#264653,color:#fff
    style ADM fill:#264653,color:#fff
    style CIT fill:#2a9d8f,color:#fff
    style BNK fill:#2a9d8f,color:#fff
    style CRT fill:#2a9d8f,color:#fff
```

| Surface | Actor | Auth | Capability |
|---|---|---|---|
| `/register` | Registrar | JWT | Upload PDF · AI extract · preview Land ID · pin IPFS · write chain · issue QR |
| `/records` | Registrar | JWT | Search · decrypt verified deed · download QR · revoke fraudulent record |
| `/verify` | Public | None | Scan QR / drop PDF → 3-way live integrity check |
| `/dashboard` | Registrar | JWT | Real-time stats (parcels, records, transfers, revocations) |
| `/?tour=1` | Reviewer | None | 39-step interactive walkthrough |

---

## 5. End-to-End Registration Flow

```mermaid
sequenceDiagram
    autonumber
    participant R as Registrar
    participant UI as React SPA
    participant API as Express API
    participant AI as Gemini 3.6 Flash
    participant CR as Crypto Engine
    participant IPFS as Pinata IPFS
    participant CH as LandRegistry.sol
    participant DB as Supabase (RLS)

    R->>UI: Drop executed PDF
    UI->>API: POST /api/land/extract
    API->>API: Validate %PDF- magic bytes
    API->>AI: Text-layer (≥200c) OR 1600px Vision OCR
    AI-->>API: 18 fields (JSON schema-bound)
    API-->>UI: Pre-fill form for review
    R->>UI: Approve + Submit
    UI->>API: POST /api/land/register
    API->>CR: Compute HMAC propertyId + SHA-256 documentHash
    CR->>CR: AES-256-GCM encrypt(pdf) → {ciphertext, iv, tag}
    API->>IPFS: Pin ciphertext (.pdf.enc)
    IPFS-->>API: ipfsCID
    API->>DB: Find/create owners · fetch prior head
    API->>CH: registerRecord(12 fields)
    CH-->>API: txHash + block.timestamp
    API->>DB: Insert row · flip old head is_latest=false
    API->>API: Generate labelled QR PNG (480×480)
    API-->>UI: Receipt + QR + txHash

    Note over R,UI: ~7 seconds end-to-end
```

---

## 6. End-to-End Verification Flow

```mermaid
sequenceDiagram
    autonumber
    actor V as Buyer / Bank / Court
    participant UI as /verify
    participant API as Public API
    participant DB as Supabase
    participant CH as LandRegistry.sol
    participant IPFS as Pinata Gateways

    V->>UI: Scan QR OR drop candidate PDF
    UI->>API: GET /api/verify/land/:landId
    API->>DB: Fetch all records for parcel (zero PII)
    loop For each record in chain
        API->>CH: getRecord(recordIdHash)
        CH-->>API: 12 on-chain fields + isRevoked
        API->>API: Compare DB hash == Chain hash
    end
    API-->>UI: Timeline + 3-way verdict per record

    alt PDF upload path
        V->>UI: Drop candidate PDF
        UI->>API: POST /verify/land/:landId/document
        API->>API: SHA-256(uploaded bytes)
        API->>DB: Lookup by document_hash
        API->>CH: Cross-check chain hash
        API-->>UI: Verdict: matches-current / revoked / unknown
    end

    Note over V,API: Verdict rendered in ~1.4 s
```

---

## 7. Three-Family Cryptographic Design

```mermaid
flowchart TB
    subgraph F1["Family 1 · Keyed HMAC-SHA256<br/>(peppered, brute-force-resistant)"]
        direction LR
        A1["State-District-Taluk<br/>+ survey + subdivision"] --> B1["propertyId (bytes32)<br/>LAND-XXXXXXXXXX"]
        A2["Survey number<br/>(tiny keyspace)"] --> B2["surveyNumberHash (bytes32)"]
        A3["Owner name + gov ID"] --> B3["ownerMatchKey + govIdHash"]
    end

    subgraph F2["Family 2 · Plain SHA-256<br/>(publicly re-computable)"]
        direction LR
        A4["Raw PDF bytes"] --> B4["documentHash<br/>(1-byte edit flips hash)"]
        A5["Canonical JSON<br/>(survey, subdiv, area,<br/>4 boundaries)"] --> B5["landDetailsHash"]
        A6["Canonical JSON<br/>(docType, reg#, regDate, SRO)"] --> B6["metadataHash"]
    end

    subgraph F3["Family 3 · EVM keccak256<br/>(on-chain pointers)"]
        direction LR
        A7["REC-XXXXXXXX"] --> B7["recordId · previousRecordId"]
        A8["OWN-XXXXXXXX"] --> B8["previousOwnerId · currentOwnerId"]
    end

    style F1 fill:#1d3557,color:#fff
    style F2 fill:#457b9d,color:#fff
    style F3 fill:#a8dadc,color:#000
```

| Family | Algorithm | Used For | Why |
|---|---|---|---|
| **Keyed HMAC-SHA256** | `HMAC(HASH_PEPPER, label\|value)` | `propertyId`, `surveyNumberHash`, `ownerMatchKey` | Survey numbers (`1`, `2`, `123/4A`) come from a tiny keyspace — plain SHA-256 on a public chain could be brute-forced in seconds. The 256-bit pepper prevents enumeration. |
| **Plain SHA-256** | `SHA-256(canonicalJson)` | `documentHash`, `landDetailsHash`, `metadataHash` | Anyone holding the original PDF can hash it locally on `/verify` and confirm it matches `documentHash` without trusting the server. |
| **EVM keccak256** | `keccak256("REC-XXXXXXXX")` | On-chain record & owner pointers | Compact `bytes32` storage; deterministic pointers for chain traversal. |

---

## 8. Continuous Ownership Linking & Void-Transfer Rule

```mermaid
flowchart LR
    R1["Record 1<br/>genesis · owner A"] --> R2["Record 2<br/>sale A → B"]
    R2 --> R3["Record 3<br/>sale B → C<br/>(head: is_latest=true)"]
    R3 -.->|fraudulent transfer<br/>revoked by registrar| R4[("Record 4<br/>REVOKED · kept in audit")]
    R3 ==>|void-transfer rule<br/>next valid sale<br/>links directly to C| R5["Record 5<br/>sale C → E<br/>(new head)"]

    style R3 fill:#2a9d8f,color:#fff
    style R4 fill:#e63946,color:#fff
    style R5 fill:#2a9d8f,color:#fff
```

**Three invariants guarantee chain integrity:**

```mermaid
graph TB
    I1["Invariant 1<br/>Off-chain Linking"] --> M1["Backend resolves previousRecordId<br/>+ previousOwnerId from Supabase<br/>before the single chain write"]
    I2["Invariant 2<br/>Single-Head DB Index"] --> M2["Partial unique index:<br/>CREATE UNIQUE INDEX land_records_one_latest_per_land<br/>ON land_records (land_id) WHERE is_latest"]
    I3["Invariant 3<br/>Additive Revocation"] --> M3["Records never deleted;<br/>revokeRecord() stamps reason + tx hash on-chain;<br/>prior head auto-restored"]

    style I1 fill:#1b4332,color:#fff
    style I2 fill:#1b4332,color:#fff
    style I3 fill:#1b4332,color:#fff
```

---

## 9. Three-Way Verification Engine

```mermaid
flowchart TB
    START(["Verify request<br/>(landId + optional PDF)"]) --> FETCH["Fetch all records<br/>from Supabase"]
    FETCH --> LOOP{"For each record<br/>in chain"}

    LOOP --> READ_CHAIN["getRecord(recordIdHash)<br/>from LandRegistry.sol"]
    READ_CHAIN --> CMP{"Compare<br/>DB ↔ Chain"}
    CMP -->|documentHash| C1["documentHashMatch"]
    CMP -->|propertyId| C2["propertyIdMatch"]
    CMP -->|status| C3["statusMatch<br/>(revoked flag)"]

    C1 & C2 & C3 --> VERDICT{All three match?}
    VERDICT -->|Yes| OK["integrityOk = true<br/>verified ✅"]
    VERDICT -->|No| FAIL["integrityOk = false<br/>409 Conflict<br/>flag for audit ❌"]

    OK --> RESPONSE["Return timeline<br/>(zero PII · OWN-IDs only)"]
    FAIL --> RESPONSE

    style OK fill:#2a9d8f,color:#fff
    style FAIL fill:#e63946,color:#fff
```

---

## 10. Design Principles

```mermaid
graph LR
    P1[Privacy by Design] -->|Zero PII on-chain · AES-GCM · RLS| O1[Citizen data never public]
    P2[Defence in Depth] -->|5 env audits · 14 check scripts · boot validation| O2[Fail loudly, never silently]
    P3[Human-in-the-Loop] -->|AI extracts · registrar approves| O3[AI assists, never decides]
    P4[Additive Audit] -->|Records never deleted · revocations on-chain| O4[Full history retrievable]
    P5[Zero Silent Fallback] -->|409 on mismatch · no manual override| O5[No backdoor for fraud]
    P6[Deterministic Identity] -->|HMAC + pepper · same parcel → same Land ID| O6[Transfers link cleanly]

    style P1 fill:#1b4332,color:#fff
    style P2 fill:#1b4332,color:#fff
    style P3 fill:#1b4332,color:#fff
    style P4 fill:#1b4332,color:#fff
    style P5 fill:#1b4332,color:#fff
    style P6 fill:#1b4332,color:#fff
```

---

## 11. Priya vs Marco — Live Verification Race

```mermaid
sequenceDiagram
    participant P as Priya (genuine buyer)
    participant M as Marco (forger)
    participant V as /verify portal
    participant CH as On-chain registry

    par Parallel attempt
        P->>V: Scan QR of deed
        V->>CH: getRecord(recordIdHash)
        CH-->>V: documentHash matches PDF
        V-->>P: ✅ Verified in 1.4 s
    and
        M->>V: Drop forged PDF + counterfeit stamp
        V->>V: SHA-256(forged bytes)
        V->>CH: Lookup by hash
        CH-->>V: No match
        V-->>M: ❌ 409 Conflict · deed flagged
    end

    Note over V,CH: No silent fallback · no manual override
```

---

## 12. Solution Boundaries

| What NOSIH Does | What NOSIH Does NOT Do |
|---|---|
| Makes a registered deed **mathematically self-proving** in 1.4 s | Replace the legal registration process — registrars still approve |
| Anchor **SHA-256 + CID + ownership links** on-chain | Store plaintext PDFs, owner names, or survey numbers on-chain |
| Detect tampering via **3-way live integrity check** | Independently adjudicate civil disputes — it produces evidence, not verdicts |
| **Revoke** fraudulent records with audit trail | Delete history — every record (incl. revoked) remains queryable |
| Generate a **public QR** per parcel | Expose PII via the public API — `/verify` returns only `OWN-XXXXXXXX` IDs |
| Support **Polygon Amoy** today, **Hyperledger Besu QBFT** tomorrow | Mandate a single chain — the architecture is chain-agnostic by design |

---

<div align="center">

**[Live App](https://nosih.vercel.app/)** · **[Public Verifier](https://nosih.vercel.app/verify)** · **[GitHub](https://github.com/rmn2178/nosih-secure)**

*Immutable Records. Verifiable Documents. Continuous Ownership.*

</div>
