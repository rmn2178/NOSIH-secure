<div align="center">

# NOSIH — Implementation Strategy

### Phased Execution Plan · 12 Weeks · 5 Phases · 14 Verification Gates

</div>

---

## 1. Execution Plan at a Glance

```mermaid
gantt
    title NOSIH — 12-Week Implementation Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  W%V

    section Phase 1 · Foundation
    Repo & env scaffold            :p1a, 2026-01-05, 5d
    Supabase schema + RLS          :p1b, after p1a, 3d
    Smart contract skeleton        :p1c, after p1a, 5d
    Hardhat + 4 unit tests         :p1d, after p1c, 4d
    Deploy to Polygon Amoy         :p1e, after p1d, 3d

    section Phase 2 · Core Backend
    Express API + middleware       :p2a, after p1e, 4d
    Auth (bcrypt + JWT)            :p2b, after p2a, 3d
    landIdentity (HMAC + AES-GCM)  :p2c, after p2a, 5d
    IPFS service (v3 + legacy)     :p2d, after p2a, 4d
    Blockchain service (ethers v6) :p2e, after p2a, 4d
    AI 4-strategy extraction       :p2f, after p2c, 7d
    QR generation                  :p2g, after p2c, 2d

    section Phase 3 · Integration
    /api/land endpoints            :p3a, after p2f, 6d
    /api/verify (3-way check)      :p3b, after p2e, 5d
    Deed storage + IPFS fallback   :p3c, after p2d, 4d
    Single-write register flow     :p3d, after p3a, 4d
    Revoke + void-transfer rule    :p3e, after p3d, 3d

    section Phase 4 · Hardening
    React SPA (5 routes)          :p4a, after p3e, 6d
    ErrorBoundary + interceptors   :p4b, after p4a, 2d
    39-step guided tour           :p4c, after p4a, 5d
    14 check scripts               :p4d, after p3e, 5d
    Vercel deploy + native bundling :p4e, after p4b, 4d

    section Phase 5 · Rollout
    E2E + load testing             :p5a, after p4e, 4d
    Security audit                 :p5b, after p5a, 4d
    Pilot with 1 SRO office        :p5c, after p5b, 7d
    Production cutover             :p5d, after p5c, 3d
```

---

## 2. Phase Breakdown

```mermaid
flowchart LR
    P1["Phase 1<br/>Foundation<br/>Wk 1-2"]
    P2["Phase 2<br/>Core Backend<br/>Wk 3-6"]
    P3["Phase 3<br/>Integration<br/>Wk 7-8"]
    P4["Phase 4<br/>Hardening<br/>Wk 9-10"]
    P5["Phase 5<br/>Rollout<br/>Wk 11-12"]

    P1 -->|contract deployed| P2
    P2 -->|services ready| P3
    P3 -->|API live locally| P4
    P4 -->|deployed to Vercel| P5
    P5 -->|pilot validated| GA(["Production GA"])

    style P1 fill:#1d3557,color:#fff
    style P2 fill:#457b9d,color:#fff
    style P3 fill:#2a9d8f,color:#fff
    style P4 fill:#e9c46a,color:#000
    style P5 fill:#e76f51,color:#fff
    style GA fill:#1b4332,color:#fff
```

### Phase 1 — Foundation (Weeks 1-2)

```mermaid
graph TB
    P1S["Start"] --> P1A["Repo scaffold<br/>root + backend + frontend + api + contracts + scripts"]
    P1A --> P1B["Supabase schema.sql<br/>3 tables + RLS + partial unique index"]
    P1B --> P1C["LandRegistry.sol<br/>12-field struct + 5 functions"]
    P1C --> P1D["Hardhat 4 unit tests<br/>register · link · dup · revoke"]
    P1D --> P1E["Deploy Amoy<br/>addIssuer.js authorizes backend"]
    P1E --> P1F["Seed admin<br/>seed:admin script"]

    style P1S fill:#1b4332,color:#fff
    style P1F fill:#2a9d8f,color:#fff
```

| Task | Deliverable | Gate |
|---|---|---|
| Repo + env scaffold | Monorepo with `backend/`, `frontend/`, `api/`, `contracts/`, `scripts/`, `.env.example` | `npm install` works in all 3 packages |
| Supabase schema | `backend/supabase/schema.sql` applied; 3 tables + RLS + partial unique index | `SELECT count(*) FROM users` returns 0, not error |
| Contract skeleton | `contracts/LandRegistry.sol` with 12-field `PropertyRecord` struct + 5 functions | `npx hardhat compile` clean |
| Unit tests | `test/LandRegistry.test.js` — 4 tests covering all paths | `npx hardhat test` → 4/4 passing |
| Deploy Amoy | `scripts/deploy.js` + `scripts/addIssuer.js` run on Amoy (chain 80002) | `CONTRACT_ADDRESS` set in `.env`; `authorizedRegistrars(issuer)` returns true |
| Seed admin | `npm run seed:admin` inserts first admin row | Login works with seeded credentials |

### Phase 2 — Core Backend (Weeks 3-6)

```mermaid
graph TB
    P2A["server.js + env.js<br/>+ envCheck.js + supabase.js"] --> P2B["middleware/auth.js<br/>protect · adminOnly"]
    P2A --> P2C["config.js + cors<br/>+ global error handler"]
    P2B --> P2D["routes/auth.js<br/>login · register · me"]
    P2A --> P2E["services/landIdentity.js<br/>HMAC + AES-GCM + Land ID"]
    P2A --> P2F["services/ipfs.js<br/>v3 + legacy + 5-gateway race"]
    P2A --> P2G["services/blockchain.js<br/>ethers v6 provider + signer"]
    P2E --> P2H["services/ai.js<br/>4-strategy extraction"]
    P2H --> P2I["services/ocr.js<br/>Tesseract worker"]
    P2H --> P2J["services/canvasIcu.js<br/>native ICU probe"]
    P2E --> P2K["services/qr.js<br/>480x480 labelled PNG"]
    P2F --> P2L["services/deedStorage.js<br/>Supabase cache + IPFS fallback"]

    style P2A fill:#1d3557,color:#fff
    style P2H fill:#2a9d8f,color:#fff
    style P2L fill:#457b9d,color:#fff
```

| Task | Deliverable | Gate |
|---|---|---|
| Express bootstrap | `server.js`, `env.js`, `envCheck.js`, `supabase.js`, `config.js` | `node server.js` boots; `/api/health` returns `200 ok` |
| Auth middleware | `middleware/auth.js` (`protect`, `adminOnly`) + `routes/auth.js` | `POST /api/auth/login` returns JWT; `GET /api/auth/me` returns user |
| Land identity | `services/landIdentity.js` — HMAC, AES-256-GCM encrypt/decrypt, Land ID derivation, owner pseudonym resolution | `assertLandSecrets()` passes at boot |
| IPFS service | `services/ipfs.js` — v3 upload, legacy fallback, 5-gateway race | `npm run check:ipfs` → CID pinned, gateways race, fetch returns ciphertext |
| Blockchain service | `services/blockchain.js` — ethers v6 provider + signer + contract read/write | `npm run check:gas` reports successful read |
| AI extraction | `services/ai.js` — 4-strategy chain, `EXTRACTION_BUDGET_MS`, retries, parallel mode | `npm run check:extract` returns 18 fields from sample PDF |
| OCR + canvas ICU | `services/ocr.js`, `services/canvasIcu.js` | `npm run check:pdf` validates both paths |
| QR + deed storage | `services/qr.js`, `services/deedStorage.js` | Sample QR generated at 480×480 with label |

### Phase 3 — Integration (Weeks 7-8)

```mermaid
sequenceDiagram
    autonumber
    participant U as Registrar
    participant R as routes/land.js
    participant V as routes/verify.js
    participant DS as services/deedStorage
    participant BC as services/blockchain
    participant AI as services/ai
    participant IPFS as services/ipfs
    participant LI as services/landIdentity
    participant DB as Supabase

    Note over R,DS: Phase 3 · wire services into endpoints
    U->>R: POST /api/land/extract
    R->>AI: extractDeedMetadata
    AI-->>R: 18 fields
    R-->>U: Pre-fill form

    U->>R: POST /api/land/register
    R->>LI: compute hashes + AES encrypt
    R->>IPFS: pin ciphertext
    R->>DS: store .enc in Supabase bucket
    R->>BC: registerRecord(12 fields)
    R->>DB: insert row + flip head
    R-->>U: receipt + QR + txHash

    U->>V: GET /api/verify/land/:id
    V->>DB: fetch all records
    loop for each record
        V->>BC: getRecord(recordIdHash)
        V->>V: compare DB ↔ Chain
    end
    V-->>U: 3-way verdict
```

| Task | Deliverable | Gate |
|---|---|---|
| `/api/land` endpoints | `routes/land.js` — `extract`, `preview`, `register`, list, `stats`, `get`, `document`, `revoke` | Postman suite passes for all 8 endpoints |
| `/api/verify` endpoints | `routes/verify.js` — 3-way integrity check, public document upload, QR | Public read returns zero-PII timeline; PDF upload verdict matches |
| Deed storage integration | `services/deedStorage.js` orchestrates Supabase → IPFS fallback + backfill | `X-IPFS-Source` header reveals winning source |
| Single-write register flow | 8-step orchestration with failure recovery | Manual revoke + restore prior head works; old head `is_latest=true` again |
| Void-transfer rule | Revoke auto-restores prior head; next transfer links to the pre-revoke owner | DB invariant: exactly one `is_latest=true` per `land_id` |

### Phase 4 — Hardening (Weeks 9-10)

```mermaid
graph TB
    subgraph FE["Frontend Build"]
        F1["App.js + 5 pages"]
        F2["ErrorBoundary at root"]
        F3["Axios + interceptors"]
        F4["React Query 5"]
        F5["39-step tour system<br/>8 files · zero-dep"]
    end

    subgraph QA["Quality & Hardening"]
        Q1["14 npm run check:* scripts"]
        Q2["envCheck at boot"]
        Q3["Native module bundling<br/>sharp · canvas · tesseract wasm"]
        Q4["Misconfig gate → 503 not crash"]
    end

    subgraph DEPLOY["Deploy"]
        D1["vercel.json<br/>includeFiles backend/**"]
        D2["api/index.js cached singleton"]
        D3["SPA + API on nosih.vercel.app"]
    end

    FE --> QA --> DEPLOY

    style FE fill:#1d3557,color:#fff
    style QA fill:#457b9d,color:#fff
    style DEPLOY fill:#2a9d8f,color:#fff
```

| Task | Deliverable | Gate |
|---|---|---|
| React SPA | `App.js` + 5 pages (Login, Dashboard, Register, Records, Verify) + Layout | All 5 routes render; `PrivateRoute` redirects unsigned users |
| ErrorBoundary + interceptors | Recovery card on throw; 401 → token clear + `/login` redirect | Deliberately malformed API response doesn't crash the UI |
| 39-step tour | 8-file tour system with auth gating, cross-route nav, read-only demo mode | `npm run check:tour` validates all 39 anchors against rendered markup |
| 14 check scripts | `check:env`, `check:runtime`, `check:services`, `check:ipfs`, `check:pdf`, `check:tour`, `check:boot`, `check:ui-failure`, `check:extract`, `check:extract:resilience`, `check:gas`, `check:login`, `check:vercel`, `check:deploy` | All 14 pass in CI on every PR |
| Vercel deploy | `vercel.json`, `api/index.js`, native bundling via `includeFiles` | `nosih.vercel.app` responds `200` on `/api/health` and serves SPA |

### Phase 5 — Rollout (Weeks 11-12)

```mermaid
graph TB
    E2E["E2E + load testing"] --> SEC["Security audit<br/>(env · keys · RLS · contract)"]
    SEC --> PILOT["Pilot with 1 SRO office<br/>50 deeds / 1 week"]
    PILOT --> FIX["Bug fixes + tuning"]
    FIX --> CUTOVER["Production cutover<br/>+ monitoring dashboards"]
    CUTOVER --> GA(["GA · public launch"])

    style GA fill:#2a9d8f,color:#fff
```

| Task | Deliverable | Gate |
|---|---|---|
| E2E + load testing | Playwright suite covering register → verify → revoke; 100 concurrent verify requests | p95 verification latency < 2 s |
| Security audit | External review of env vars, key rotation policy, RLS policies, contract bytecode | No critical findings open |
| Pilot deployment | 1 SRO office registers 50 deeds over 1 week | Zero data-loss events; 100% chain-DB consistency |
| Production cutover | Monitoring dashboards (Vercel + Supabase + Pinata + Polygon); runbook for revoke/restore | 99.9% uptime over 7-day observation |

---

## 3. Milestones & Deliverables

```mermaid
flowchart LR
    M1["M1 · End Wk 2<br/>Contract on Amoy<br/>4/4 tests passing"]
    M2["M2 · End Wk 4<br/>Auth + Land ID +<br/>IPFS service live"]
    M3["M3 · End Wk 6<br/>AI 4-strategy<br/>extraction works"]
    M4["M4 · End Wk 8<br/>8 endpoints wired<br/>3-way verify returns verdict"]
    M5["M5 · End Wk 10<br/>Vercel deploy live<br/>14 check scripts green"]
    M6["M6 · End Wk 12<br/>Pilot validated<br/>Production GA"]

    M1 --> M2 --> M3 --> M4 --> M5 --> M6

    style M1 fill:#1d3557,color:#fff
    style M2 fill:#457b9d,color:#fff
    style M3 fill:#2a9d8f,color:#fff
    style M4 fill:#e9c46a,color:#000
    style M5 fill:#f4a261,color:#000
    style M6 fill:#e76f51,color:#fff
```

| Milestone | Week | Deliverable | Acceptance Criteria |
|---|---|---|---|
| **M1** | 2 | Smart contract on Polygon Amoy | `npx hardhat test` → 4/4 · `CONTRACT_ADDRESS` set · `addIssuer.js` run |
| **M2** | 4 | Backend foundation (auth + crypto + IPFS) | `npm run check:env`, `check:services`, `check:ipfs` all green |
| **M3** | 6 | AI extraction pipeline | `npm run check:extract` returns 18 fields from a sample scanned deed |
| **M4** | 8 | Full API surface | Manual Postman suite covers all 15 endpoints; 3-way verify returns verdict in <2 s |
| **M5** | 10 | Vercel production deploy | All 14 `check:*` scripts pass in CI; `nosih.vercel.app` live with `/verify` public |
| **M6** | 12 | Pilot validated → GA | 1 SRO office · 50 deeds · zero data loss · 99.9% uptime observed |

---

## 4. Testing Strategy

```mermaid
graph TB
    subgraph UNIT["Unit Tests"]
        U1["4 Hardhat tests<br/>register · link · dup · revoke"]
        U2["Service unit tests<br/>HMAC · AES-GCM · canonicalJson"]
        U3["Joi schema tests<br/>preview · register · revoke"]
    end

    subgraph INT["Integration Tests"]
        I1["API endpoint tests<br/>15 routes · auth + validation"]
        I2["3-way verify flow<br/>DB ↔ Chain ↔ PDF"]
        I3["Void-transfer rule<br/>revoke restores head"]
    end

    subgraph E2E["End-to-End"]
        E1["Playwright<br/>5 portal surfaces"]
        E2["39-step tour<br/>anchor + nav checks"]
        E3["Priya vs Marco<br/>parallel verify race"]
    end

    subgraph LOAD["Load & Resilience"]
        L1["100 concurrent /verify<br/>p95 < 2 s"]
        L2["AI fallback chain<br/>kill switch per strategy"]
        L3["IPFS 5-gateway race<br/>1-of-5 outage survives"]
    end

    subgraph CI["CI Gate"]
        CI1["14 npm run check:* scripts"]
        CI2["All tests green on every PR"]
        CI3["Vercel preview deploy per PR"]
    end

    UNIT --> INT --> E2E --> LOAD --> CI

    style UNIT fill:#1d3557,color:#fff
    style INT fill:#457b9d,color:#fff
    style E2E fill:#2a9d8f,color:#fff
    style LOAD fill:#e9c46a,color:#000
    style CI fill:#e76f51,color:#fff
```

| Layer | Tool | Coverage Target |
|---|---|---|
| Smart contract | Hardhat + Chai | 4/4 paths (registration, linking, auth/duplicate revert, single revocation) |
| Service units | Node `assert` + manual | HMAC determinism, AES round-trip, canonical JSON stability |
| API integration | Postman + supertest | All 15 endpoints × happy + error paths |
| E2E | Playwright | 5 portal surfaces; full register → verify → revoke cycle |
| Tour | `check-tour-steps.mjs` | All 39 anchors resolve against rendered markup |
| Load | k6 or autocannon | 100 concurrent verifies, p95 < 2 s |
| Resilience | Chaos test | Kill 1 IPFS gateway, kill Gemini API → verify must still complete |
| CI gate | `npm run check:*` × 14 | All green on every PR; Vercel preview auto-deployed |

---

## 5. CI/CD Pipeline

```mermaid
flowchart LR
    DEV["Developer push<br/>to feature branch"] --> PR["Open PR to main"]
    PR --> LINT["Lint<br/>ESLint + Prettier"]
    LINT --> UNIT["Unit tests<br/>hardhat test + service tests"]
    UNIT --> CHECK["14 check:* scripts"]
    CHECK --> BUILD["Build<br/>frontend npm run build"]
    BUILD --> PREVIEW["Vercel preview deploy<br/>per-PR URL"]
    PREVIEW --> SMOKE["Smoke test<br/>/api/health + /api/verify"]
    SMOKE --> REVIEW["Code review<br/>+ security review"]
    REVIEW --> MERGE["Merge to main"]
    MERGE --> PROD["Vercel prod deploy<br/>nosih.vercel.app"]
    PROD --> MONITOR["Monitoring<br/>Vercel + Supabase + Pinata + Polygon"]

    style DEV fill:#1d3557,color:#fff
    style CHECK fill:#e9c46a,color:#000
    style PREVIEW fill:#2a9d8f,color:#fff
    style PROD fill:#e76f51,color:#fff
    style MONITOR fill:#1b4332,color:#fff
```

| Stage | Command | Failure Action |
|---|---|---|
| Lint | `eslint .` + `prettier --check` | Block PR |
| Contract test | `npx hardhat test` (4/4) | Block PR |
| Env audit | `npm run check:env` + `check:runtime` | Block PR |
| Service check | `npm run check:services` + `check:ipfs` | Block PR |
| PDF / tour check | `npm run check:pdf` + `check:tour` | Block PR |
| Boot / UI check | `npm run check:boot` + `check:ui-failure` | Block PR |
| Frontend build | `npm run build --prefix frontend` | Block PR |
| Preview deploy | Vercel auto-deploy per PR | Manual review |
| Smoke test | `node scripts/smoke-api.js` against preview | Block merge |
| Prod deploy | Auto on merge to `main` | Rollback via Vercel CLI |

---

## 6. Deployment Strategy

```mermaid
flowchart TB
    subgraph ENV_DEPLOY["Environment Progression"]
        E1["Local dev<br/>localhost:3000 + :5000"]
        E2["Preview per PR<br/><pr>.vercel.app"]
        E3["Production<br/>nosih.vercel.app"]
        E4["Institutional<br/>NIC Besu QBFT"]
    end

    subgraph SECRETS["Secrets Management"]
        S1[".env.example<br/>documents required vars"]
        S2["Vercel env vars<br/>per environment"]
        S3["DOCUMENT_ENC_KEY<br/>HASH_PEPPER<br/>in HSM for prod"]
        S4["ISSUER_PRIVATE_KEY<br/>registrar hot-wallet"]
    end

    subgraph DB["Database Migrations"]
        D1["schema.sql<br/>applied once"]
        D2["seedAdmin.js<br/>first admin"]
        D3["reset-supabase.js<br/>dev-only reset"]
    end

    E1 --> E2 --> E3 --> E4
    E3 -.-> S2 & S3 & S4
    E3 -.-> D1 & D2

    style ENV_DEPLOY fill:#1d3557,color:#fff
    style SECRETS fill:#e76f51,color:#fff
    style DB fill:#457b9d,color:#fff
```

| Environment | URL | DB | Chain | Secrets |
|---|---|---|---|---|
| Local | `localhost:3000` + `:5000` | Supabase project (dev) | Polygon Amoy | `.env` file |
| Preview | `<pr-hash>.vercel.app` | Supabase project (dev) | Polygon Amoy | Vercel env (preview) |
| Production | `nosih.vercel.app` | Supabase project (prod) | Polygon Amoy → Besu | Vercel env (prod) + HSM for keys |
| Institutional | custom domain | NIC-hosted Postgres | NIC Besu QBFT (5 validators) | HSM-bound keys · on-prem |

**Rollback strategy:** Vercel instant rollback to previous deployment via CLI or dashboard. Database writes are append-only (records never deleted) — no rollback needed for chain or DB. Vercel env var change requires redeploy.

---

## 7. Risk Management

```mermaid
quadrantChart
    title Risk Matrix
    x-axis "Low impact" --> "High impact"
    y-axis "Low probability" --> "High probability"
    quadrant-1 "Mitigate aggressively"
    quadrant-2 "Monitor closely"
    quadrant-3 "Accept"
    quadrant-4 "Plan for"

    "DOCUMENT_ENC_KEY loss": [0.9, 0.3]
    "HASH_PEPPER change": [0.85, 0.25]
    "Pinata IPFS outage": [0.55, 0.55]
    "Gemini API quota": [0.4, 0.65]
    "Polygon Amoy deprecation": [0.6, 0.2]
    "Vercel native module cold-start": [0.35, 0.7]
    "RLS misconfiguration": [0.75, 0.35]
    "AI hallucinated fields": [0.45, 0.8]
    "Sub-registrar adoption": [0.7, 0.5]
    "Legal admissibility": [0.65, 0.4]
```

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **DOCUMENT_ENC_KEY loss** | Low | Catastrophic | HSM-backed key vault in prod; documented in `.env.example` as "losing it loses every deed". Backup key in offline safe. |
| **HASH_PEPPER rotation** | Low | Catastrophic | Pepper migration script + planned backfill window. Documented as "changes every Land ID so new deeds stop linking to old ones". |
| **Pinata IPFS outage** | Medium | High | 5-gateway `Promise.any` race + Supabase Storage ciphertext cache as primary read path. |
| **Gemini API quota / outage** | Medium | Medium | 4-strategy fallback chain ends in local Tesseract OCR; worst case the registrar types fields manually. |
| **Polygon Amoy deprecation** | Low | High | Contract is EVM-equivalent; redeployment to Besu QBFT is a `hardhat.config.js` change. |
| **Vercel native cold-start issue** | High | Low | `includeFiles: backend/**` + `keepCoreInTheBundle` / `keepIcuDataInTheBundle` literal `require()` specifiers; lazy-load native modules. |
| **RLS misconfiguration** | Low | Catastrophic | `envCheck.js` validates `SUPABASE_SERVICE_ROLE_KEY` shape; boot audit `SELECT id LIMIT 1` on every cold start. |
| **AI hallucinated fields** | High | Medium | Registrar approves every extraction; `Joi` validates output; `FIELD_DESCRIPTIONS` map drives both prompt and schema (no drift). |
| **Sub-registrar adoption resistance** | Medium | High | 39-step guided tour; in-person training; pilot office with 50-deed trial; minimal registrar UI surface. |
| **Legal admissibility** | Medium | High | NOSIH produces **evidence**, not verdicts — `disclaimer` field returned on every verify response. |

---

## 8. Key Material Management

```mermaid
flowchart TB
    subgraph SECRETS["5 Critical Secrets"]
        S1["DOCUMENT_ENC_KEY<br/>32-byte hex<br/>AES-256-GCM master"]
        S2["HASH_PEPPER<br/>32-byte hex<br/>HMAC-SHA256 pepper"]
        S3["JWT_SECRET<br/>≥16 chars<br/>HS256 signing key"]
        S4["ISSUER_PRIVATE_KEY<br/>registrar signer<br/>on-chain onlyRegistrar"]
        S5["SUPABASE_SERVICE_ROLE_KEY<br/>bypasses RLS<br/>backend only"]
    end

    subgraph LIFECYCLE["Lifecycle"]
        L1["Generated once<br/>at bootstrap"]
        L2["Stored in Vercel env<br/>+ offline backup"]
        L3["Rotated:<br/>JWT 90d · others on incident"]
        L4["HSM-backed<br/>for institutional prod"]
    end

    subgraph VALIDATION["Validation Gates"]
        V1["envCheck.js<br/>regex/predicate at boot"]
        V2["assertLandSecrets<br/>64-hex / 32-byte check"]
        V3["check:runtime<br/>wallet gas + allowlist"]
        V4["503 on misconfig<br/>never process.exit"]
    end

    SECRETS --> LIFECYCLE --> VALIDATION

    style SECRETS fill:#e63946,color:#fff
    style LIFECYCLE fill:#e9c46a,color:#000
    style VALIDATION fill:#2a9d8f,color:#fff
```

| Secret | Validation | Rotation Policy | Loss Impact |
|---|---|---|---|
| `DOCUMENT_ENC_KEY` | 64 hex chars (32 bytes) | Only on incident; backfill required | Every deed becomes unreadable |
| `HASH_PEPPER` | 64 hex chars (32 bytes) | Only on incident; backfill required | Every Land ID changes — breaks chain linking |
| `JWT_SECRET` | ≥ 16 chars | Every 90 days | All sessions invalidated |
| `ISSUER_PRIVATE_KEY` | `0x` + 64 hex | Quarterly via `addRegistrar` + `removeRegistrar` | Unauthorized writes possible until revoked |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_` prefix or ≥ 32 chars | Quarterly via Supabase dashboard | Anon RLS still blocks; only service-role bypass lost |

---

## 9. Operational Readiness

```mermaid
graph TB
    subgraph RUN["Runbook"]
        R1["Boot failure<br/>→ check /api/health → fix env vars"]
        R2["Verify slow<br/>→ check IPFS gateway latency<br/>→ fall back to Supabase cache"]
        R3["AI extraction fails<br/>→ check Gemini quota<br/>→ registrar manual entry fallback"]
        R4["Chain tx stuck<br/>→ check Polygon RPC<br/>→ bump gas or resubmit"]
        R5["Revoke needed<br/>→ POST /api/land/records/:id/revoke<br/>→ auto-restores prior head"]
    end

    subgraph MON["Monitoring"]
        M1["Vercel function logs<br/>+ /api/health uptime probe"]
        M2["Supabase dashboard<br/>DB connections + RLS"]
        M3["Pinata pin list<br/>+ gateway latency probe"]
        M4["Polygon scan<br/>registrar wallet gas balance"]
        M5["Gemini quota dashboard"]
    end

    subgraph ALERT["Alerting"]
        A1["503 on /api/health<br/>→ PagerDuty"]
        A2["Verify p95 > 3s<br/>→ Slack"]
        A3["Pinata pin failure<br/>→ PagerDuty"]
        A4["Wallet gas < 0.1 MATIC<br/>→ Slack"]
    end

    RUN --> MON --> ALERT

    style RUN fill:#1d3557,color:#fff
    style MON fill:#457b9d,color:#fff
    style ALERT fill:#e76f51,color:#fff
```

| Runbook Scenario | Trigger | Action |
|---|---|---|
| Boot failure | `/api/health` returns `503` | Read `problems[]` from response → fix env var in Vercel → redeploy |
| Verify latency spike | p95 > 3 s | Check IPFS gateway latency; Supabase cache should mask IPFS outage |
| AI extraction failure | `extractDeedMetadata` returns `{success: false}` | Check Gemini quota; registrar types fields manually |
| Chain tx stuck | `tx.wait()` not mining in 60 s | Check Polygon RPC; bump gas or resubmit via `registerRecordOnChain` |
| Fraudulent record needs revocation | Registrar reports forged deed | `POST /api/land/records/:id/revoke` with reason → void-transfer rule restores prior head |
| Wallet gas low | Gas balance < 0.1 MATIC | Top up via faucet (testnet) or treasury (mainnet); alert Slack |

---

## 10. Institutional Rollout Path

```mermaid
flowchart LR
    PILOT["Pilot<br/>1 SRO · 50 deeds<br/>Wk 11-12"] --> DISTRICT["District Rollout<br/>5 SROs · 500 deeds<br/>Month 4"]
    DISTRICT --> STATE["State Rollout<br/>50 SROs · 5000 deeds<br/>Month 6-9"]
    STATE --> BESU["NIC Besu Migration<br/>5-validator QBFT<br/>Month 9"]
    BESU --> NATIONAL["National Rollout<br/>Multi-state federation<br/>Year 2"]

    style PILOT fill:#2a9d8f,color:#fff
    style DISTRICT fill:#457b9d,color:#fff
    style STATE fill:#1d3557,color:#fff
    style BESU fill:#e9c46a,color:#000
    style NATIONAL fill:#1b4332,color:#fff
```

| Phase | Scope | Chain | Key Change |
|---|---|---|---|
| **Pilot** | 1 SRO office, 50 deeds | Polygon Amoy (testnet) | Validate UX, latency, registrar workflow |
| **District** | 5 SROs, 500 deeds | Polygon Amoy | Validate multi-registrar concurrency, search/verify load |
| **State** | 50 SROs, 5000+ deeds | Polygon mainnet OR Besu staging | Real gas costs, public-verifier load |
| **Besu migration** | State-wide | NIC Hyperledger Besu QBFT (5 validators) | Zero gas, permissioned validator set, on-prem DB |
| **National** | Multi-state federation | Federated Besu network | Cross-state verify; Bhu-Aadhaar ULPIN binding at scale |

---

## 11. Success Metrics

```mermaid
graph TB
    subgraph TECH["Technical KPIs"]
        T1["Verify p95 latency<br/>≤ 1.4 s"]
        T2["Chain write latency<br/>≤ 4.8 s"]
        T3["AI extraction success<br/>≥ 95% on first strategy"]
        T4["Uptime<br/>≥ 99.9%"]
    end

    subgraph BIZ["Business KPIs"]
        B1["Pilot: 50 deeds<br/>zero data loss"]
        B2["District: 500 deeds<br/>zero fraud slippage"]
        B3["Verify adoption<br/>≥ 80% of buyers use QR"]
        B4["Time-to-verify<br/>reduced from days to seconds"]
    end

    subgraph SEC["Security KPIs"]
        S1["Zero PII on chain<br/>(verified by audit)"]
        S2["RLS enforced<br/>(anon key blocked)"]
        S3["14 check scripts<br/>green on every PR"]
        S4["Zero silent fallbacks<br/>(409 on mismatch)"]
    end

    style TECH fill:#1d3557,color:#fff
    style BIZ fill:#2a9d8f,color:#fff
    style SEC fill:#e76f51,color:#fff
```

| KPI Category | Metric | Target |
|---|---|---|
| **Latency** | Public verify p95 | ≤ 1.4 s |
| **Latency** | Chain write p95 | ≤ 4.8 s |
| **Latency** | AI extraction success rate (first strategy) | ≥ 95% |
| **Availability** | Uptime | ≥ 99.9% |
| **Adoption** | Pilot deeds registered | ≥ 50 in week 1 |
| **Adoption** | Verify usage | ≥ 80% of buyers use QR |
| **Integrity** | DB ↔ Chain mismatches | 0 |
| **Security** | PII fields on-chain | 0 |
| **Resilience** | Silent fallbacks | 0 (every mismatch → 409) |
| **CI** | `check:*` scripts green | 14 / 14 on every PR |

---

<div align="center">

**[Live App](https://nosih.vercel.app/)** · **[Public Verifier](https://nosih.vercel.app/verify)** · **[GitHub](https://github.com/rmn2178/nosih-secure)**

*12 weeks. 5 phases. 14 verification gates. One immutable registry.*

</div>
