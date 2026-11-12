# NOSIH — 72-Hour Implementation Strategy

### 3 Days · 3 Phases · 6 Verification Gates · 2 Parallel Tracks

> **Compression note:** the 12-week plan is re-cut into a 72-hour sprint by running **2 engineers in parallel** (Track A = chain/DB, Track B = backend/AI) and by **deferring non-blocking polish** to a post-sprint backlog (see §4 Scope Triage). Every deferred item is listed explicitly — nothing is silently dropped.

---

## 1. Execution Plan at a Glance

```mermaid
gantt
    title NOSIH — 72-Hour Sprint
    dateFormat  YYYY-MM-DD HH:mm
    axisFormat  %a %H:%M

    section Day 1 · Foundation & Crypto
    Repo + env scaffold + .env.example        :d1a, 2026-01-05 08:00, 1h
    Supabase schema.sql + RLS + seedAdmin     :d1b, after d1a, 2h
    LandRegistry.sol (12-field struct)        :d1c, 2026-01-05 08:00, 2h
    Hardhat 4 unit tests                      :d1d, after d1c, 1h
    Deploy Amoy + addIssuer.js                :d1e, after d1d, 1h
    Express bootstrap + /api/health           :d1f, 2026-01-05 10:00, 2h
    Auth (bcrypt + JWT) + routes/auth.js      :d1g, after d1f, 2h
    landIdentity (HMAC + AES-GCM + Land ID)   :d1h, after d1g, 3h
    IPFS service (v3 + legacy + gateway race) :d1i, 2026-01-05 14:00, 2h
    Blockchain service (ethers v6)            :d1j, after d1i, 2h
    GATE 1 · env + services + ipfs green      :milestone, d1k, 2026-01-05 20:00, 0h

    section Day 2 · Integration & AI
    AI extraction (2-strategy + Tesseract)    :d2a, 2026-01-06 08:00, 3h
    QR service (480x480 labelled PNG)         :d2b, after d2a, 1h
    deedStorage (Supabase cache + IPFS)       :d2c, 2026-01-06 08:00, 2h
    /api/land endpoints (8)                   :d2d, after d2a, 3h
    /api/verify 3-way check                   :d2e, after d2d, 2h
    Revoke + void-transfer rule               :d2f, after d2e, 1h
    GATE 2 · extract + verify verdict         :milestone, d2g, 2026-01-06 19:00, 0h

    section Day 3 · Frontend, Deploy, Demo
    React SPA (5 routes) + Layout              :d3a, 2026-01-07 08:00, 4h
    ErrorBoundary + axios interceptors         :d3b, after d3a, 1h
    12-step guided tour (down from 39)         :d3c, after d3a, 2h
    6 check:* scripts wired to CI              :d3d, 2026-01-07 08:00, 2h
    Vercel deploy + native bundling            :d3e, 2026-01-07 14:00, 2h
    Smoke test + demo rehearsal                :d3f, after d3e, 2h
    GATE 3 · prod live + demo dry-run          :milestone, d3g, 2026-01-07 20:00, 0h
```

---

## 2. Phase Breakdown

```mermaid
flowchart LR
    P1["Day 1<br/>Foundation<br/>Chain · DB · Crypto"]
    P2["Day 2<br/>Integration<br/>API · AI · Verify"]
    P3["Day 3<br/>Ship<br/>SPA · Deploy · Demo"]

    P1 -->|contract + services live| P2
    P2 -->|3-way verdict returns| P3
    P3 -->|health 200 + demo passes| GA(["Demo-Ready<br/>nosih.vercel.app"])

    style P1 fill:#1d3557,color:#fff
    style P2 fill:#2a9d8f,color:#fff
    style P3 fill:#e76f51,color:#fff
    style GA fill:#1b4332,color:#fff
```

### Day 1 — Foundation & Crypto (08:00 → 20:00)

```mermaid
graph TB
    D1S["Start 08:00"] --> TRACK_A["Track A · Chain/DB"]
    D1S --> TRACK_B["Track B · Backend"]

    TRACK_A --> A1["Supabase schema.sql<br/>3 tables + RLS + partial unique index"]
    A1 --> A2["LandRegistry.sol<br/>12-field struct + 5 functions"]
    A2 --> A3["Hardhat 4 tests<br/>register · link · dup · revoke"]
    A3 --> A4["Deploy Amoy (80002)<br/>+ addIssuer.js + seed:admin"]

    TRACK_B --> B1["server.js + env.js<br/>envCheck.js + /api/health"]
    B1 --> B2["middleware/auth.js<br/>protect · adminOnly + JWT"]
    B2 --> B3["landIdentity.js<br/>HMAC + AES-256-GCM + Land ID"]
    B3 --> B4["ipfs.js + blockchain.js<br/>pin · gateway race · ethers v6"]

    A4 --> G1["GATE 1 · 20:00"]
    B4 --> G1

    style D1S fill:#1b4332,color:#fff
    style G1 fill:#2a9d8f,color:#fff
    style TRACK_A fill:#1d3557,color:#fff
    style TRACK_B fill:#457b9d,color:#fff
```

| Hr | Task | Deliverable | Gate |
|---|---|---|---|
| 08–09 | Repo + env scaffold | Monorepo `backend/ frontend/ api/ contracts/ scripts/` + `.env.example` | `npm install` works ×3 |
| 08–10 | Contract skeleton | `LandRegistry.sol` — 12-field `PropertyRecord` + 5 functions | `npx hardhat compile` clean |
| 09–11 | Supabase schema | `schema.sql` applied — 3 tables, RLS, partial unique index | `SELECT count(*) FROM users` → `0`, not error |
| 10–12 | Express bootstrap | `server.js`, `env.js`, `envCheck.js`, `supabase.js` | `/api/health` → `200 ok` |
| 10–11 | Hardhat tests | `test/LandRegistry.test.js` — 4 paths | `npx hardhat test` → 4/4 |
| 11–12 | Deploy Amoy | `deploy.js` + `addIssuer.js` + `seed:admin` | `authorizedRegistrars(issuer) === true` |
| 12–14 | Auth | `middleware/auth.js` + `routes/auth.js` | `POST /api/auth/login` returns JWT; `/me` returns user |
| 14–17 | Land identity | `landIdentity.js` — HMAC, AES-GCM, Land ID, pseudonym | `assertLandSecrets()` passes at boot |
| 14–16 | IPFS service | `ipfs.js` — v3 + legacy + 5-gateway `Promise.any` | `npm run check:ipfs` → CID pinned, fetch returns ciphertext |
| 16–18 | Blockchain service | `blockchain.js` — provider + signer + read/write | `npm run check:gas` → successful read |
| 18–20 | **GATE 1** | `check:env` · `check:runtime` · `check:services` · `check:ipfs` | 4/4 green |

---

### Day 2 — Integration & AI (08:00 → 19:00)

```mermaid
sequenceDiagram
    autonumber
    participant U as Registrar
    participant R as routes/land.js
    participant AI as services/ai.js
    participant LI as landIdentity
    participant IPFS as services/ipfs
    participant BC as blockchain
    participant V as routes/verify.js

    U->>R: POST /api/land/extract
    R->>AI: extractDeedMetadata
    AI-->>R: 18 fields (or manual fallback)
    R-->>U: pre-filled form

    U->>R: POST /api/land/register
    R->>LI: hashes + AES encrypt
    R->>IPFS: pin ciphertext
    R->>BC: registerRecord(12 fields)
    R-->>U: receipt + QR + txHash

    U->>V: GET /api/verify/land/:id
    V->>BC: getRecord(recordIdHash)
    V-->>U: 3-way verdict (DB ↔ Chain ↔ PDF)
```

| Hr | Task | Deliverable | Gate |
|---|---|---|---|
| 08–11 | AI extraction | `ai.js` — **2-strategy chain** (Gemini → Tesseract), `EXTRACTION_BUDGET_MS`, retries | `check:extract` returns ≥18 fields from sample PDF |
| 08–10 | Deed storage | `deedStorage.js` — Supabase cache → IPFS fallback + backfill | `X-IPFS-Source` header reveals winning source |
| 11–12 | QR | `qr.js` — 480×480 labelled PNG | Sample QR renders with label |
| 11–14 | `/api/land` | `extract`, `preview`, `register`, list, `stats`, `get`, `document`, `revoke` | Postman suite passes all 8 |
| 14–16 | `/api/verify` | 3-way integrity check + public document upload + QR | Public read returns zero-PII timeline; verdict matches |
| 16–17 | Revoke + void-transfer | Revoke auto-restores prior head; next transfer links to pre-revoke owner | DB invariant: exactly one `is_latest=true` per `land_id` |
| 17–19 | **GATE 2** | `check:extract` · `check:verify` + manual register→verify→revoke cycle | 2/2 green + end-to-end walkthrough succeeds |

---

### Day 3 — Ship (08:00 → 20:00)

```mermaid
graph TB
    subgraph FE["Frontend (08:00–13:00)"]
        F1["App.js + 5 pages<br/>Login · Dashboard · Register · Records · Verify"]
        F2["ErrorBoundary + axios interceptors<br/>401 → clear token → /login"]
        F3["12-step guided tour<br/>auth-gated · read-only demo mode"]
    end

    subgraph QA["Checks & CI (08:00–10:00)"]
        Q1["6 check:* scripts wired to CI"]
        Q2["envCheck at boot · 503 not crash"]
    end

    subgraph DEPLOY["Deploy (14:00–16:00)"]
        D1["vercel.json includeFiles backend/**"]
        D2["api/index.js cached singleton"]
        D3["SPA + API on nosih.vercel.app"]
    end

    FE --> QA --> DEPLOY
    DEPLOY --> DEMO["Smoke + demo rehearsal<br/>16:00–20:00"]

    style FE fill:#1d3557,color:#fff
    style QA fill:#457b9d,color:#fff
    style DEPLOY fill:#2a9d8f,color:#fff
    style DEMO fill:#1b4332,color:#fff
```

| Hr | Task | Deliverable | Gate |
|---|---|---|---|
| 08–12 | React SPA | `App.js` + 5 pages + `Layout` + `PrivateRoute` | All 5 routes render; unsigned user redirected |
| 12–13 | Resilience | `ErrorBoundary` recovery card; 401 → token clear + `/login` | Malformed API response doesn't crash UI |
| 12–14 | Guided tour | **12 steps** (was 39) — auth gating, cross-route nav, read-only demo | Every anchor resolves against rendered markup |
| 08–10 | Check scripts | `check:env`, `check:runtime`, `check:services`, `check:ipfs`, `check:extract`, `check:verify` | 6/6 pass in CI |
| 14–16 | Vercel deploy | `vercel.json`, `api/index.js`, native bundling via `includeFiles` (`sharp`, `canvas`, `tesseract.wasm`) | `nosih.vercel.app/api/health` → `200`; SPA served |
| 16–18 | Smoke | `scripts/smoke-api.js` against prod: register → verify → revoke | Full cycle completes; `txHash` on Amoy explorer |
| 18–20 | **GATE 3** | Live demo rehearsal ×2, cold-start rehearsal | Demo passes twice consecutively |

---

## 3. Verification Gates (6 total)

```mermaid
flowchart LR
    G1["GATE 1<br/>Day 1 · 20:00<br/>env · runtime · services · ipfs"]
    G2["GATE 2<br/>Day 2 · 19:00<br/>extract · verify"]
    G3["GATE 3<br/>Day 3 · 20:00<br/>boot · prod smoke"]
    G1 --> G2 --> G3
    G3 --> LIVE(["Live + Demo-Ready"])

    style G1 fill:#1d3557,color:#fff
    style G2 fill:#457b9d,color:#fff
    style G3 fill:#e76f51,color:#fff
    style LIVE fill:#1b4332,color:#fff
```

| Gate | Script(s) | Pass Criteria | If It Fails |
|---|---|---|---|
| **G1** | `check:env` `check:runtime` `check:services` `check:ipfs` | 4/4 green · wallet has gas · CID fetchable | Stop, fix env — do not start Day 2 |
| **G2** | `check:extract` `check:verify` | 18 fields extracted · 3-way verdict returns in <2 s | Ship with manual-entry fallback + Tesseract only |
| **G3** | `check:boot` + prod smoke | `/api/health` → 200 on Vercel · full cycle in prod | Roll back via Vercel CLI; demo from `localhost` |

---

## 4. Scope Triage — What Ships vs. What Waits

```mermaid
flowchart TB
    subgraph SHIP["✅ Ships in 72h"]
        S1["Contract + 4 tests on Amoy"]
        S2["Auth · landIdentity · IPFS · blockchain"]
        S3["8 /api/land + 3 /api/verify endpoints"]
        S4["AI extraction (2-strategy)"]
        S5["5-page SPA + ErrorBoundary"]
        S6["6 check scripts"]
        S7["Vercel prod deploy"]
    end

    subgraph DEFER["⏸ Post-sprint backlog"]
        D1["Full 39-step tour → shipped 12 steps"]
        D2["4-strategy AI → shipped 2 strategies"]
        D3["14 check scripts → shipped 6"]
        D4["Playwright E2E suite"]
        D5["k6 load test (100 concurrent)"]
        D6["External security audit"]
        D7["HSM key management"]
        D8["NIC Besu migration"]
        D9["Pilot with SRO office"]
    end

    style SHIP fill:#2a9d8f,color:#fff
    style DEFER fill:#e9c46a,color:#000
```

| Item | 12-Week Plan | 72-Hour Plan | Rationale |
|---|---|---|---|
| Guided tour | 39 steps | **12 steps** (register → verify happy path) | Demo-critical path only; anchors rest in backlog |
| AI extraction | 4-strategy chain | **2-strategy** (Gemini → Tesseract) + manual override | Registrar approves every extraction anyway |
| Check scripts | 14 | **6** (the boot/security-critical ones) | Remaining 8 are polish, not correctness |
| AI retries | Parallel mode + retries | Sequential + 1 retry | Latency budget absorbed by manual fallback |
| E2E | Playwright 5 surfaces | **Manual + smoke script** | Not enough time to stabilize Playwright selectors |
| Load test | 100 concurrent, p95 <2 s | **Deferred** | Single-office pilot doesn't need it yet |
| Security audit | External, 4 days | **Deferred** to Week 2 | Nothing in a 3-day sprint is production-critical |
| Pilot | 1 SRO, 50 deeds | **Demo to stakeholders** | Pilot needs audit sign-off first |

---

## 5. Testing Strategy (Compressed)

| Layer | Tool | In Sprint? | Coverage |
|---|---|---|---|
| Smart contract | Hardhat + Chai | ✅ | 4/4 — register, link, dup/auth revert, revoke |
| Crypto units | Node `assert` | ✅ | HMAC determinism, AES round-trip, canonical JSON stability |
| API smoke | Postman + supertest | ✅ | 11 endpoints × happy path + 401/409 errors |
| AI extraction | `check:extract` | ✅ | 18 fields from one sample scanned deed |
| 3-way verify | `check:verify` | ✅ | DB ↔ Chain ↔ PDF verdict on 3 seeded records |
| E2E (Playwright) | Playwright | ⏸ Deferred | — |
| Load (k6) | k6 | ⏸ Deferred | — |
| Tour anchors | `check:tour` | ⚠️ Partial | 12 shipped steps only |

---

## 6. CI/CD (Minimal Viable)

```mermaid
flowchart LR
    PUSH["push to branch"] --> LINT["eslint + prettier"]
    LINT --> HT["hardhat test (4/4)"]
    HT --> CHK["6 check:* scripts"]
    CHK --> BUILD["frontend build"]
    BUILD --> PREV["Vercel preview"]
    PREV --> MERGE["merge → main"]
    MERGE --> PROD["Vercel prod"]
    PROD --> SMOKE["smoke-api.js"]

    style CHK fill:#e9c46a,color:#000
    style PROD fill:#e76f51,color:#fff
```

| Stage | Command | Blocking? |
|---|---|---|
| Lint | `eslint .` | Yes |
| Contract | `npx hardhat test` | Yes |
| Checks | `npm run check:env check:runtime check:services check:ipfs check:extract check:verify` | Yes |
| Build | `npm run build --prefix frontend` | Yes |
| Preview | Vercel per-PR | No |
| Prod | auto on merge to `main` | — |
| Smoke | `node scripts/smoke-api.js` | Yes (post-deploy) |

---

## 7. Risk Register (Sprint-Scoped)

| Risk | Likelihood | Impact | Mitigation in 72h |
|---|---|---|---|
| Amoy faucet dry / no gas | High | Blocks Deploy | Fund wallet **before 08:00 Day 1**; 2 backup wallets ready |
| Native module bundling breaks on Vercel (`sharp`/`canvas`/`tesseract`) | High | Blocks deploy | Test `includeFiles` on a **stub deploy at 10:00 Day 1**, not Day 3 |
| AI extraction fails on sample deed | Medium | Demo shows blank form | Manual-entry fallback is always reachable; pre-extract 3 sample deeds as fixtures |
| `DOCUMENT_ENC_KEY` / `HASH_PEPPER` mismatch between local and Vercel | Medium | Deeds unreadable in prod | `check:env` validates shape at boot; paste from single source of truth |
| IPFS (Pinata) outage mid-demo | Low | Verify stalls | Supabase ciphertext cache is the primary read path |
| Postgres RLS misconfigured | Low | Catastrophic | `envCheck` boot audit `SELECT id LIMIT 1` on every cold start |
| Scope creep from 12-week doc | High | Nothing ships | **§4 triage is binding** — anything not in the ✅ column is a stretch goal |

---

## 8. Secrets (Unchanged — Still 5 Critical)

| Secret | Validation | 72h Handling |
|---|---|---|
| `DOCUMENT_ENC_KEY` | 64 hex (32 bytes) | Generated Day 1 08:00, pasted into Vercel + offline note |
| `HASH_PEPPER` | 64 hex (32 bytes) | Same |
| `JWT_SECRET` | ≥16 chars | Same |
| `ISSUER_PRIVATE_KEY` | `0x` + 64 hex | Faucet-funded Day 0 |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_` prefix | Day 1 09:00 |

> **Loss impact unchanged:** losing `DOCUMENT_ENC_KEY` loses every deed; changing `HASH_PEPPER` breaks every Land ID and all chain linking. Neither is rotated during the sprint.

---

## 9. Definition of Done — Hour 72

```mermaid
graph TB
    DONE["Hour 72 · Done"] --> C1["✅ Contract deployed on Amoy<br/>4/4 tests passing"]
    DONE --> C2["✅ 11 endpoints wired<br/>3-way verify returns verdict <2s"]
    DONE --> C3["✅ 5 SPA routes render<br/>register→verify→revoke cycle works"]
    DONE --> C4["✅ 6 check:* scripts green"]
    DONE --> C5["✅ nosih.vercel.app/api/health → 200"]
    DONE --> C6["✅ Demo rehearsed twice<br/>cold-start included"]

    style DONE fill:#1b4332,color:#fff
```

| # | Done When | Verified By |
|---|---|---|
| 1 | `npx hardhat test` → 4/4; `CONTRACT_ADDRESS` set | Gate 1 |
| 2 | Full register → verify → revoke cycle on prod returns a verdict | Gate 2 + Gate 3 smoke |
| 3 | `/verify` public page shows zero-PII timeline | Manual |
| 4 | Revoke restores prior head; exactly one `is_latest=true` per `land_id` | SQL invariant check |
| 5 | All 6 `check:*` scripts pass in CI | Gate 3 |
| 6 | `nosih.vercel.app` serves SPA + API; native modules load on cold start | Gate 3 |
| 7 | Demo runs twice consecutively without a manual fix | Rehearsal |

---

## 10. Post-Sprint Backlog (Week 2+)

| Priority | Item | Unblocks |
|---|---|---|
| P0 | External security audit (env, keys, RLS, bytecode) | Any real pilot |
| P0 | Restore 39-step tour + remaining 8 check scripts | Registrar adoption |
| P1 | Playwright E2E + k6 load (100 concurrent, p95 <2 s) | District rollout |
| P1 | 4-strategy AI chain with parallel mode | 95% first-strategy extraction |
| P2 | HSM-backed key management | Institutional prod |
| P2 | NIC Besu QBFT migration (5 validators) | State rollout |
| P3 | Pilot with 1 SRO office — 50 deeds / 1 week | GA |

---

<div align="center">

**[Live App](https://nosih.vercel.app/)** · **[Public Verifier](https://nosih.vercel.app/verify)** · **[GitHub](https://github.com/rmn2178/nosih-secure)**

*72 hours. 3 phases. 6 gates. One immutable registry.*

</div>