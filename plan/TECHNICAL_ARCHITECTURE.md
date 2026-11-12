<div align="center">

# NOSIH — Technical Architecture

### Three-Tier Cryptographic Storage · Single-Write Chain Anchor · 3-Way Live Verification

</div>

---

## 1. Architecture at a Glance (C4 Context)

```mermaid
graph TB
    subgraph EXT["External Actors & Systems"]
        REG["Registrar Officer"]
        CIT["Citizen / Bank / Court"]
        GEM["Google Gemini<br/>3.6 Flash"]
        PIN["Pinata IPFS"]
        POL["Polygon Amoy<br/>Chain ID 80002"]
        SUP["Supabase Postgres<br/>(RLS-enabled)"]
    end

    subgraph NOSIH["NOSIH Platform (Vercel)"]
        SPA["React 18 SPA<br/>/register · /records · /verify · /"]
        API["Express 4 API<br/>Node 22 ESM"]
        CONTRACT["LandRegistry.sol<br/>Solidity 0.8.20"]
    end

    REG --> SPA
    CIT --> SPA
    SPA -->|HTTPS /api/*| API
    API -->|gemini-3.6-flash| GEM
    API -->|AES-GCM ciphertext pin| PIN
    API -->|registerRecord 12 fields| CONTRACT
    CONTRACT -.->|deployed on| POL
    API -->|service-role key| SUP
    API -->|getRecord view reads| CONTRACT

    style NOSIH fill:#0d1b2a,color:#fff
    style EXT fill:#e0e1dd,color:#000
```

---

## 2. Three-Tier Storage Model

```mermaid
flowchart TB
    subgraph T1["Tier 1 · Off-Chain Encrypted Document"]
        direction TB
        T1A["AES-256-GCM ciphertext<br/>(.pdf.enc)"]
        T1B[("Pinata IPFS<br/>content-addressed CID")]
        T1A --> T1B
    end

    subgraph T2["Tier 2 · Public Immutable Proof"]
        direction TB
        T2A["12 cryptographic fields<br/>(zero PII · zero plaintext)"]
        T2B[["LandRegistry.sol<br/>Polygon Amoy / Besu QBFT"]]
        T2A --> T2B
    end

    subgraph T3["Tier 3 · Private Relational Vault"]
        direction TB
        T3A["Owner names · survey #s ·<br/>boundaries · IV / tag · head index"]
        T3B[("Supabase Postgres<br/>RLS · zero public policies")]
        T3A --> T3B
    end

    T3 -.->|HMAC propertyId links| T2
    T2 -.->|ipfsCID points to| T1
    T3 -.->|enc_iv + enc_tag decrypt| T1

    style T1 fill:#1d3557,color:#fff
    style T2 fill:#457b9d,color:#fff
    style T3 fill:#a8dadc,color:#000
```

| Tier | Storage | Contents | Access |
|---|---|---|---|
| **T1 — Encrypted Document** | Pinata IPFS (5-gateway race on read) | `AES-256-GCM` ciphertext only | Public CID, but decryptable only via backend IV+tag |
| **T2 — Immutable Proof** | `LandRegistry.sol` on Polygon Amoy | 12 fields: 9× `bytes32` hashes + 1× `string` CID + 1× `uint256` timestamp | Free public reads via `getRecord()` |
| **T3 — Private Vault** | Supabase Postgres with RLS | Owner PII, survey #s, boundaries, IV, tag, head index | Service-role key only — anon key blocked |

---

## 3. Component Architecture

```mermaid
graph TB
    subgraph CLIENT["Client Layer"]
        C1["Registrar Portal<br/>/register · /records"]
        C2["Public Verifier<br/>/verify · QR scan"]
        C3["Guided Tour<br/>39 steps · zero-dep"]
    end

    subgraph EDGE["Vercel Edge"]
        E1["vercel.json<br/>SPA fallback + /api rewrite"]
        E2["api/index.js<br/>cached Express app"]
    end

    subgraph MIDDLE["API Layer · Express 4 ESM"]
        M1["middleware/auth.js<br/>JWT HS256 · 8h"]
        M2["routes/auth.js<br/>login · register · me"]
        M3["routes/land.js<br/>7 endpoints"]
        M4["routes/verify.js<br/>public 3-way check"]
        M5["envCheck.js<br/>5 required vars"]
    end

    subgraph SERVICES["Service Layer"]
        S1["services/ai.js<br/>4-strategy extraction"]
        S2["services/blockchain.js<br/>ethers v6"]
        S3["services/ipfs.js<br/>v3 + legacy fallback"]
        S4["services/ocr.js<br/>Tesseract worker"]
        S5["services/landIdentity.js<br/>HMAC + AES-GCM"]
        S6["services/deedStorage.js<br/>Supabase Storage cache"]
        S7["services/qr.js<br/>480×480 labelled PNG"]
        S8["services/canvasIcu.js<br/>native ICU probe"]
    end

    subgraph DATA["Data Layer"]
        D1[("Supabase Postgres<br/>users · owners · land_records")]
        D2[("Supabase Storage<br/>private deeds bucket")]
        D3[("Pinata IPFS<br/>5 gateways")]
        D4[["Polygon Amoy<br/>0xE5a941d9628A7d7Ab497636A204B627F29070952"]]
    end

    C1 & C2 & C3 --> E1
    E1 --> E2 --> M1
    M1 --> M2 & M3 & M4
    M2 & M3 & M4 --> S1 & S2 & S3 & S4 & S5 & S6 & S7
    S2 --> M5
    S1 --> S4 & S8
    S3 --> D3
    S2 --> D4
    S5 & S6 --> D1 & D2

    style CLIENT fill:#0d1b2a,color:#fff
    style EDGE fill:#1b263b,color:#fff
    style MIDDLE fill:#415a77,color:#fff
    style SERVICES fill:#778da9,color:#000
    style DATA fill:#e0e1dd,color:#000
```

---

## 4. Module Dependency Graph (Backend)

```mermaid
graph LR
    SERVER["server.js"] --> ENV["env.js"]
    SERVER --> ENVCHK["envCheck.js"]
    SERVER --> SUPA["supabase.js"]
    SERVER --> CONFIG["config.js"]
    SERVER --> AUTHMW["middleware/auth.js"]
    SERVER --> R_AUTH["routes/auth.js"]
    SERVER --> R_LAND["routes/land.js"]
    SERVER --> R_VERIFY["routes/verify.js"]

    R_AUTH --> SUPA
    R_AUTH --> S_LI["services/landIdentity.js"]
    R_LAND --> S_AI["services/ai.js"]
    R_LAND --> S_BC["services/blockchain.js"]
    R_LAND --> S_IPFS["services/ipfs.js"]
    R_LAND --> S_LI
    R_LAND --> S_DS["services/deedStorage.js"]
    R_LAND --> S_QR["services/qr.js"]
    R_VERIFY --> S_BC
    R_VERIFY --> S_DS
    R_VERIFY --> S_LI
    R_VERIFY --> S_QR

    S_AI --> S_OCR["services/ocr.js"]
    S_AI --> S_CI["services/canvasIcu.js"]
    S_DS --> S_IPFS
    S_LI --> ENV

    style SERVER fill:#1b4332,color:#fff
    style S_AI fill:#2a9d8f,color:#fff
    style S_BC fill:#457b9d,color:#fff
    style S_LI fill:#e76f51,color:#fff
```

---

## 5. Database Schema (ERD)

```mermaid
erDiagram
    USERS ||--o{ LAND_RECORDS : "registers (registered_by FK)"
    OWNERS ||--o{ LAND_RECORDS : "transfers from (previous_owner_id FK)"
    OWNERS ||--o{ LAND_RECORDS : "transfers to (current_owner_id FK)"

    USERS {
        uuid id PK
        text email UK "lowercase unique"
        text password_hash "bcrypt 12 rounds"
        text role "admin | issuer"
        text wallet_address "registrar signer"
        text organization_name "SRO office"
        boolean active "default true"
        timestamptz created_at
        timestamptz updated_at "trigger set_updated_at()"
    }

    OWNERS {
        uuid id PK
        text owner_id UK "OWN-XXXXXXXX pseudonymous"
        char_66 owner_hash UK "0x + keccak256(owner_id) on-chain pointer"
        text full_name "Private (Vault only)"
        text match_key UK "HMAC(pepper, name|govId) dedup key"
        char_64 gov_id_hash "HMAC(pepper, govId) no plaintext"
        timestamptz created_at
        timestamptz updated_at
    }

    LAND_RECORDS {
        uuid id PK
        text land_id "LAND-XXXXXXXXXX indexed"
        text record_id UK "REC-XXXXXXXX unique"
        text previous_record_id "Prior head NULL if first"
        text previous_owner_id FK
        text current_owner_id FK
        char_66 property_id "HMAC-SHA256 bytes32"
        char_66 survey_number_hash "HMAC pepper brute-force-safe"
        text jurisdiction_code "STATE-DISTRICT-TALUK"
        char_66 land_details_hash "SHA-256 canonical JSON"
        char_66 document_hash UK "SHA-256 PDF duplicate guard"
        char_66 metadata_hash "SHA-256 canonical JSON"
        char_66 record_id_hash UK "keccak256(REC-XXXXXXXX)"
        char_66 previous_record_hash "keccak256 prior REC"
        char_66 previous_owner_hash "keccak256 prior OWN"
        char_66 current_owner_hash "keccak256 current OWN"
        text ipfs_cid "Pinata ciphertext CID"
        text enc_iv "AES-256-GCM 96-bit IV hex"
        text enc_tag "AES-256-GCM auth tag hex"
        text tx_hash "Polygon/Besu transaction"
        text document_type "Sale Deed, Gift Deed..."
        text registration_number
        date registration_date
        text sro_office
        text survey_number "Private (Vault only)"
        text subdivision_number "Private"
        numeric area "Private"
        text area_unit "Private"
        text boundary_north "Private"
        text boundary_south "Private"
        text boundary_east "Private"
        text boundary_west "Private"
        text village "Private"
        text taluk "Private"
        text district "Private"
        text state "Private"
        boolean is_latest "Partial unique index per land_id"
        text status "active | revoked"
        text revoked_tx_hash
        timestamptz revoked_at
        text revoke_reason "Max 300 chars on-chain"
        text qr_code_data "PNG data URI"
        text verify_url
        uuid registered_by FK
        timestamptz registered_at
        timestamptz created_at
        timestamptz updated_at
    }
```

**Critical indexes:**
- `land_records_one_latest_per_land` — `UNIQUE(land_id) WHERE is_latest` → **one head per parcel invariant**
- `land_records_land_id_idx`, `survey_number_idx`, `current_owner_idx`, `created_at_idx`

**Row-Level Security:** enabled on all 3 tables with **zero public policies** → anon key reads nothing; backend service-role bypasses RLS.

---

## 6. Smart Contract Specification

```mermaid
classDiagram
    class LandRegistry {
        <<Solidity 0.8.20>>
        +Openable owner
        +mapping(bytes32 => PropertyRecord) records
        +mapping(bytes32 => bool) revoked
        +mapping(address => bool) authorizedRegistrars
        +registerRecord(PropertyRecord r) onlyRegistrar
        +revokeRecord(bytes32 id, string reason) onlyRegistrar
        +getRecord(bytes32 id) view → (PropertyRecord, bool)
        +recordExists(bytes32 id) view → bool
        +addRegistrar(address) onlyOwner
        +removeRegistrar(address) onlyOwner
    }

    class PropertyRecord {
        bytes32 propertyId
        bytes32 surveyNumberHash
        bytes32 jurisdictionCode
        bytes32 landDetailsHash
        bytes32 documentHash
        bytes32 metadataHash
        string  ipfsCID
        bytes32 recordId
        bytes32 previousRecordId
        bytes32 previousOwnerId
        bytes32 currentOwnerId
        uint256 registeredAt
    }

    class Event_RecordRegistered {
        bytes32 indexed recordId
        bytes32 indexed propertyId
        bytes32 indexed currentOwnerId
        bytes32 previousRecordId
        bytes32 documentHash
        address registrar
        uint256 registeredAt
    }

    class Event_RecordRevoked {
        bytes32 indexed recordId
        address indexed revokedBy
        string reason
    }

    LandRegistry "1" --> "12 fields" PropertyRecord
    LandRegistry ..> Event_RecordRegistered : emits
    LandRegistry ..> Event_RecordRevoked : emits
```

| Field | Type | Algorithm | PII? |
|---|---|---|---|
| `propertyId` | `bytes32` | HMAC-SHA256(pepper, jurisdiction\|survey\|subdiv) | No |
| `surveyNumberHash` | `bytes32` | HMAC-SHA256(pepper, jurisdiction\|survey) | No |
| `jurisdictionCode` | `bytes32` | `ethers.encodeBytes32String("STATE-DISTRICT-TALUK")` | No |
| `landDetailsHash` | `bytes32` | SHA-256(canonicalJSON) | No |
| `documentHash` | `bytes32` | SHA-256(raw PDF bytes) | No |
| `metadataHash` | `bytes32` | SHA-256(canonicalJSON) | No |
| `ipfsCID` | `string` | Pinata v3 CID of `AES-256-GCM` ciphertext | No (encrypted) |
| `recordId` | `bytes32` | keccak256("REC-XXXXXXXX") | No |
| `previousRecordId` | `bytes32` | keccak256(prior REC) or `0x0` | No |
| `previousOwnerId` | `bytes32` | keccak256(prior "OWN-XXXXXXXX") or `0x0` | No |
| `currentOwnerId` | `bytes32` | keccak256("OWN-XXXXXXXX") | No |
| `registeredAt` | `uint256` | `block.timestamp` (set by contract) | No |

**Deployment:** Polygon Amoy (Chain ID `80002`) · Address `0xE5a941d9628A7d7Ab497636A204B627F29070952` · Compiler Solidity `0.8.20` · OpenZeppelin `Ownable` + `onlyRegistrar` allowlist.

---

## 7. AI Extraction Pipeline (4-Strategy Chain)

```mermaid
flowchart TB
    START(["PDF upload"]) --> MB{"%PDF-<br/>magic byte check"}
    MB -->|invalid| REJ["400 reject"]
    MB -->|valid| TL{"Text layer<br/>≥ 200 chars & ≤ 60 KB?"}

    TL -->|yes| S1["Strategy 1 · text-layer<br/>pdf-parse v2"]
    TL -->|no| S2["Strategy 2 · local-ocr<br/>Tesseract worker (pixels never leave)"]

    S1 --> OK1{18 fields<br/>valid?}
    S2 --> OK2{18 fields<br/>valid?}

    OK1 -->|yes| DONE(["Return to registrar"])
    OK2 -->|yes| DONE

    OK1 -->|no| S3["Strategy 3 · whole-pdf<br/>inline base64 → Gemini"]
    OK2 -->|no| S3

    S3 --> OK3{Valid?}
    OK3 -->|yes| DONE
    OK3 -->|no| S4["Strategy 4 · rendered-vision<br/>1600px JPEG q90 · max 3 pages"]

    S4 --> DONE

    style S1 fill:#2a9d8f,color:#fff
    style S2 fill:#2a9d8f,color:#fff
    style S3 fill:#e9c46a,color:#000
    style S4 fill:#e9c46a,color:#000
    style DONE fill:#1b4332,color:#fff
```

| Strategy | Tool | When Used | Privacy |
|---|---|---|---|
| **1 · text-layer** | `pdf-parse` v2 | Text layer exists (≥200 chars, ≤60 KB) | Bytes never leave server |
| **2 · local-ocr** | `Tesseract.js` worker | Scanned PDF, no text layer | Pixels never leave server |
| **3 · whole-pdf** | Gemini inlineData | Both above fail | Raw PDF sent to Gemini |
| **4 · rendered-vision** | `pdf-to-png-converter` + `sharp` + Gemini Vision | Strategy 3 fails | JPEG images sent to Gemini (max 3 pages) |

**Resilience:** `EXTRACTION_BUDGET_MS=120000` total deadline · `GEMINI_MAX_ATTEMPTS=3` exponential backoff (`750ms · 1.5s · 3s`) · transient (429/5xx/network) retries, fatal (400/401/403/404) short-circuits.

**18 extracted fields:** `sellerName, buyerName, surveyNumber, subdivisionNumber, area, areaUnit, boundaryNorth/South/East/West, village, taluk, district, state, documentType, registrationNumber, registrationDate, sroOffice`.

---

## 8. API Surface

```mermaid
graph LR
    subgraph PUBLIC["Public (no auth)"]
        P1["GET /api/health"]
        P2["GET /api/verify/land/:landId"]
        P3["POST /api/verify/land/:landId/document"]
        P4["GET /api/verify/land/:landId/qr"]
    end

    subgraph PROTECTED["Registrar JWT required"]
        A1["POST /api/auth/login"]
        A2["GET /api/auth/me"]
        A3["POST /api/auth/register (admin only)"]
        L1["POST /api/land/extract"]
        L2["POST /api/land/preview"]
        L3["POST /api/land/register"]
        L4["GET /api/land"]
        L5["GET /api/land/stats"]
        L6["GET /api/land/records/:id"]
        L7["GET /api/land/records/:id/document"]
        L8["POST /api/land/records/:id/revoke"]
    end

    style PUBLIC fill:#2a9d8f,color:#fff
    style PROTECTED fill:#457b9d,color:#fff
```

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | bcrypt compare + JWT HS256 (8h) |
| `POST` | `/api/auth/register` | Admin JWT | bcrypt 12 rounds · create issuer/admin |
| `GET` | `/api/auth/me` | JWT | Current user profile |
| `POST` | `/api/land/extract` | JWT | Magic-byte check · 4-strategy AI extraction |
| `POST` | `/api/land/preview` | JWT | HMAC Land ID · preview head & chain depth |
| `POST` | `/api/land/register` | JWT | Encrypt · IPFS pin · chain write · DB mirror · QR |
| `GET` | `/api/land` | JWT | Paginated search (max 100) |
| `GET` | `/api/land/stats` | JWT | 5 counts (records · parcels · transfers · revoked · owners) |
| `GET` | `/api/land/records/:id` | JWT | Single record + parcel history (with owner joins) |
| `GET` | `/api/land/records/:id/document` | JWT | Decrypt + stream PDF + `X-Document-Hash-Match` header |
| `POST` | `/api/land/records/:id/revoke` | JWT | `revokeRecord` on-chain + restore prior head |
| `GET` | `/api/verify/land/:landId` | Public | 3-way integrity check · zero-PII timeline |
| `POST` | `/api/verify/land/:landId/document` | Public | SHA-256 uploaded PDF → lookup by hash |
| `GET` | `/api/verify/land/:landId/qr` | Public | 480×480 labelled QR PNG |
| `GET` | `/api/health` | Public | Boot audit · `200` ok or `503` degraded with problem list |

---

## 9. Frontend Architecture

```mermaid
graph TB
    subgraph ROOT["index.js"]
        RB["React.StrictMode"] --> EB["ErrorBoundary"] --> APP["App.js"]
    end

    APP --> BR["BrowserRouter"] --> TP["TourProvider"]
    TP --> ROUTES["Routes"]

    subgraph PUBLIC_PAGES["Public"]
        LP["LoginPage"]
        VP["VerifyPage"]
    end

    subgraph PROTECTED_PAGES["JWT-guarded"]
        DASH["DashboardPage"]
        REGP["RegisterPage"]
        RECP["RecordsPage"]
    end

    ROUTES -->|/login| LP
    ROUTES -->|/verify| VP
    ROUTES -->|PrivateRoute| DASH
    ROUTES -->|PrivateRoute| REGP
    ROUTES -->|PrivateRoute| RECP

    subgraph COMPONENTS["Shared Components"]
        LAY["Layout · sidebar · NavLink"]
        ERR["ErrorBoundary · prevents blank screen"]
        TOUR["Tour system · 8 files · 39 steps"]
        DROP["react-dropzone"]
        ICON["lucide-react icons"]
        QR["qrcode.react"]
    end

    subgraph STATE["State & API"]
        AX["utils/api.js · axios instance<br/>+ interceptors (401 redirect)"]
        RQ["@tanstack/react-query"]
        SS["sessionStorage token"]
    end

    LP & VP & DASH & REGP & RECP --> COMPONENTS & STATE

    style ROOT fill:#1b4332,color:#fff
    style PUBLIC_PAGES fill:#2a9d8f,color:#fff
    style PROTECTED_PAGES fill:#457b9d,color:#fff
```

**Frontend design choices:**
- **Token in sessionStorage** (not localStorage) → cleared on tab close
- **Axios interceptor** → on 401 (except `/auth/login`) clears token + redirects to `/login`
- **ErrorBoundary at root** → prevents React 18 unmount-on-throw → no blank pages
- **Per-endpoint timeouts** — extract 90s · register 180s · revoke 120s · fetch 60s
- **`Array.isArray` + `typeof === "object"` defensive checks** → bad API shape never throws

---

## 10. Security Architecture

```mermaid
flowchart TB
    subgraph NET["Network Edge"]
        N1["Vercel WAF & DDoS"]
        N2["CORS allow-list<br/>FRONTEND_URL env"]
        N3["HTTPS only"]
    end

    subgraph APP_GUARD["Application Guard"]
        A1["Magic-byte PDF check<br/>not just mimetype"]
        A2["MAX_UPLOAD_MB<br/>4 MB on Vercel · 15 MB local"]
        A3["Joi schema validation<br/>per endpoint"]
        A4["Boot env audit<br/>5 required vars"]
    end

    subgraph AUTH["Auth & Identity"]
        AU1["bcrypt 12 rounds"]
        AU2["JWT HS256 8h"]
        AU3["protect + adminOnly middleware"]
        AU4["authorizedRegistrars allowlist<br/>on-chain onlyRegistrar"]
    end

    subgraph CRYPTO["Cryptographic Layer"]
        CR1["HMAC-SHA256 + HASH_PEPPER<br/>64-hex / 32-byte secret"]
        CR2["AES-256-GCM<br/>DOCUMENT_ENC_KEY 32-byte"]
        CR3["keccak256 for on-chain pointers"]
        CR4["SHA-256 for verifiable docs"]
    end

    subgraph DATA["Data Protection"]
        D1["Supabase RLS<br/>zero public policies"]
        D2["Service-role key only<br/>never exposed to browser"]
        D3["PII columns blacklisted<br/>from /verify response"]
        D4["Encrypted PDF in IPFS<br/>plaintext never pinned"]
    end

    NET --> APP_GUARD --> AUTH --> CRYPTO --> DATA

    style NET fill:#0d1b2a,color:#fff
    style APP_GUARD fill:#1b263b,color:#fff
    style AUTH fill:#415a77,color:#fff
    style CRYPTO fill:#778da9,color:#000
    style DATA fill:#e0e1dd,color:#000
```

---

## 11. Deployment Topology

```mermaid
flowchart LR
    subgraph VERCEL["Vercel Single-Domain (nosih.vercel.app)"]
        V1["Edge CDN<br/>static + functions"]
        V2["frontend/build<br/>SPA bundle"]
        V3["api/index.js<br/>@vercel/node serverless"]
        V4["vercel.json<br/>includeFiles: backend/**"]
    end

    subgraph EXTERNAL["External Services"]
        E1[("Supabase Postgres<br/>+ Storage")]
        E2[("Pinata IPFS<br/>5 gateways")]
        E3[["Polygon Amoy<br/>RPC: rpc-amoy.polygon.technology"]]
        E4["Google Gemini<br/>gemini-3.6-flash"]
    end

    USER["Citizen / Registrar"] -->|HTTPS| V1
    V1 --> V2
    V1 -->|/api/*| V3
    V3 --> E1 & E2 & E3 & E4

    V2 -.->|static build assets| V1
    V4 -.->|bundles native modules<br/>sharp · @napi-rs/canvas · tesseract wasm| V3

    style VERCEL fill:#1b4332,color:#fff
    style EXTERNAL fill:#e0e1dd,color:#000
```

**Vercel-specific engineering:**
- `vercel.json` `includeFiles: "backend/**"` → bundles native modules (`sharp`, `@napi-rs/canvas`, Tesseract WASM) with the serverless function
- `api/index.js` caches the Express app promise → loaded once per warm instance
- No `process.exit()` at boot → misconfig reports via `/api/health` instead of opaque `FUNCTION_INVOCATION_FAILED`
- `keepIcuDataInTheBundle()` + `keepCoreInTheBundle()` → literal `require()` specifiers (not in loops) so Vercel's file tracer follows them
- SPA fallback rewrite `/(.*) → /index.html` + API rewrite `/api/(.*) → /api/index.js`

---

## 12. Data Flow — Registration (Single-Write Anchor)

```mermaid
flowchart TB
    START(["Registrar approves form"]) --> STEP1["1 · Duplicate PDF guard<br/>lookup by document_hash"]
    STEP1 -->|exists| ERR1["409 reject"]
    STEP1 -->|unique| STEP2["2 · Resolve parcel identity<br/>HMAC propertyId from jurisdiction+survey"]
    STEP2 --> STEP3["3 · Find/create owners<br/>by ownerMatchKey (HMAC)"]
    STEP3 --> STEP4["4 · Compute hashes<br/>landDetails · metadata · recordId · ownerHash"]
    STEP4 --> STEP5["5 · AES-256-GCM encrypt<br/>+ IPFS pin (octet-stream)<br/>+ Supabase Storage mirror"]
    STEP5 --> STEP6["6 · Single chain write<br/>registerRecord(12 fields)"]
    STEP6 --> STEP7["7 · Generate labelled QR<br/>480×480 PNG via sharp"]
    STEP7 --> STEP8["8 · Update DB<br/>flip old head is_latest=false<br/>insert new row with tx_hash"]

    STEP8 --> END(["Receipt + QR + txHash<br/>~7 s"])

    style STEP6 fill:#e76f51,color:#fff
    style END fill:#2a9d8f,color:#fff
```

**Failure recovery:** if DB insert fails *after* chain write succeeds → old head is restored, response returns `500` with `{recordId, txHash}` so the registrar can manually reconcile.

---

## 13. Data Flow — Verification (3-Way Live Check)

```mermaid
flowchart TB
    REQ(["GET /api/verify/land/:landId"]) --> DB["Supabase: SELECT *<br/>WHERE land_id = :landId ORDER BY created_at"]
    DB --> EMPTY{No rows?}
    EMPTY -->|yes| NOTFOUND["404 not found"]
    EMPTY -->|no| LOOP["For each record in chain"]

    LOOP --> CH["getRecord(recordIdHash)<br/>on Polygon Amoy (free view)"]
    CH --> CMP["Compare DB ↔ Chain"]

    CMP --> C1{"documentHash<br/>DB == Chain?"}
    CMP --> C2{"propertyId<br/>DB == Chain?"}
    CMP --> C3{"status<br/>DB.status == revoked[Chain]?"}

    C1 & C2 & C3 --> VERDICT{All match?}
    VERDICT -->|yes| OK["integrityOk = true"]
    VERDICT -->|no| BAD["integrityOk = false<br/>flag for audit"]

    OK --> RESP["Return zero-PII timeline<br/>OWN-IDs only · ~1.4 s"]
    BAD --> RESP

    style OK fill:#2a9d8f,color:#fff
    style BAD fill:#e63946,color:#fff
```

---

## 14. Resilience & Failure Modes

```mermaid
graph TB
    subgraph BOOT["Boot-time"]
        B1["envCheck audits 5 vars"]
        B2["Supabase SELECT id LIMIT 1"]
        B3["If !ok → 503 on every route<br/>/api/health reports problems"]
    end

    subgraph RUN["Run-time"]
        R1["AI extraction<br/>4-strategy fallback chain"]
        R2["IPFS read<br/>5-gateway Promise.any race"]
        R3["Supabase Storage<br/>→ IPFS fallback + backfill"]
        R4["Misconfig gate<br/>never crashes"]
    end

    subgraph NATIVE["Native module safety"]
        N1["sharp · @napi-rs/canvas<br/>lazy-loaded on first use"]
        N2["canvasIcu probes 8 ICU variants<br/>skips OCR if absent"]
        N3["tesseract wasm · 6 core candidates<br/>keepCoreInTheBundle"]
    end

    subgraph UX["User-facing safety"]
        U1["ErrorBoundary<br/>no blank screen"]
        U2["401 interceptor<br/>auto-redirect to /login"]
        U3["defensive Array.isArray<br/>+ typeof checks"]
    end

    style BOOT fill:#1b4332,color:#fff
    style RUN fill:#2a9d8f,color:#fff
    style NATIVE fill:#457b9d,color:#fff
    style UX fill:#a8dadc,color:#000
```

---

<div align="center">

**[Live App](https://nosih.vercel.app/)** · **[Public Verifier](https://nosih.vercel.app/verify)** · **[GitHub](https://github.com/rmn2178/nosih-secure)**

*Three tiers. One hash. Verifiable forever.*

</div>
