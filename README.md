# NOSIH — Land Deed Registry

> Register land deeds as encrypted PDFs on IPFS, anchor their fingerprints on Polygon, keep personal details in an access-controlled Postgres database, and let anyone verify a parcel's ownership history from a Land ID or QR code.

**Network:** Polygon Amoy (chain ID `80002`) · **Contract:** Solidity `0.8.20` · **App:** Express 4 + React 18 · **Storage:** Supabase Postgres + Pinata IPFS

The testnet deployment configured in this checkout is `0xE5a941d9628A7d7Ab497636A204B627F29070952`. Confirm it against the root `.env` before relying on it.

---

## Contents

- [Overview](#overview)
- [The Innovations](#the-innovations)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [The Pipelines](#the-pipelines)
- [Identity, Hashing and Privacy](#identity-hashing-and-privacy)
- [Ownership Chain and Linking](#ownership-chain-and-linking)
- [Smart Contract](#smart-contract)
- [Data Model](#data-model)
- [API Reference](#api-reference)
- [Frontend](#frontend)
- [Guided Walkthrough](#guided-walkthrough)
- [QR Codes](#qr-codes)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Setup from Scratch](#setup-from-scratch)
- [Local Development](#local-development)
- [Testing](#testing)
- [Deploy to Vercel](#deploy-to-vercel)
- [Security Controls](#security-controls)
- [Operations Runbook](#operations-runbook)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Disclaimer](#disclaimer)

---

## Overview

NOSIH is a registrar-operated land deed registry with a public verification portal.

| Capability | Who | Where |
|---|---|---|
| Register a deed (PDF only, AI pre-fill) | Registrar (signed in) | `/register` |
| Browse, search, open decrypted deeds, download QR, revoke | Registrar | `/records` |
| Dashboard counters and recent records | Registrar | `/` |
| Verify a Land ID, inspect ownership history, compare a PDF | Public | `/verify?landId=LAND-…` |
| Create registrar accounts | Admin user | `POST /api/auth/register` |

What the system establishes:

- Every registration is anchored with a single Polygon transaction containing content hashes, the CID of the encrypted deed, and owner registry IDs.
- The deed itself is encrypted with AES-256-GCM before it leaves the API; IPFS only ever stores ciphertext.
- Public verification confirms that each record exists on-chain and that the document hash, property hash, and revocation status match the off-chain mirror.
- A new deed for the same parcel links to the current head of that parcel's ownership chain.

What it does **not** establish:

- It does not prove legal title or the authenticity of the underlying transaction. A hash match only proves that a document matches a registered version.
- It is not fully decentralised: a registrar, a database, an IPFS pinning service, and an RPC provider remain trusted infrastructure.
- It does not make owners anonymous. Owner IDs are pseudonymous, but repeated appearances are linkable; coarse location is public by design.

---

## The Innovations

Land registries are usually one of two things: a database that a clerk trusts, or a
ledger that everyone can read but nobody can use. NOSIH is a third thing — a database
that is trusted *because* it is continuously checked against a public ledger, and a
ledger that is useful *because* everything personal never reaches it.

The twenty ideas below are the ones that make that work. Each is written as the
problem it solves, the mechanism that solves it, and what it buys in practice.

### A. Privacy by construction

**1. Parcel identity is derived, not stored.**
A parcel's identity is not a database row that someone assigns — it is a function of
the jurisdiction, survey number and subdivision. `propertyId = HMAC-SHA256("property",
"STATE-DISTRICT-TALUK|survey|subdivision")`, and the human-readable `LAND-…` is the
first ten hex characters of that.

> **Why it matters:** the same parcel written in two different forms produces the same
> Land ID, so a deed cannot silently fork a parcel's history by being filed slightly
> differently. Identity is a property of the land, not of the paperwork.

**2. Keyed hashes for enumerable fields.**
Survey numbers are small — `1`, `2`, `123/4A`. A plain SHA-256 of one on a public
chain can be brute-forced in seconds by generating candidates until the hash matches.
So `propertyId` and `surveyNumberHash` are HMAC-SHA256 keyed with a server-held
`HASH_PEPPER`, and owner identities are keyed hashes of normalised name plus government
ID reference.

> **Why it matters:** the chain leaks nothing reversible, and the same land cannot be
> enumerated by an attacker who guesses survey numbers. The trade-off is deliberate:
> the Land ID is a *capability*, not a public derivation — nobody without the pepper
> can recompute it.

**3. Encrypt, then pin.**
IPFS is public, permanent and content-addressed. Uploading a deed PDF to it would
publish it to anyone who learns the CID — and the CID is written to a public chain. So
the PDF is encrypted with AES-256-GCM (random 96-bit IV, authenticated) *before* it
leaves the API. IPFS only ever stores ciphertext. The IV and authentication tag live in
Postgres; the key never leaves the server.

> **Why it matters:** the on-chain CID is safe to publish, because what it points at
> is meaningless without the key. Confidentiality depends entirely on key custody —
> which is why `DOCUMENT_ENC_KEY` must be backed up and never rotated casually.

**4. Response projection as a privacy boundary.**
The public verification API does not serialise a database row and hide fields in the
UI. It selects an explicit allowlist of columns and returns registry IDs
(`OWN-8F3A21C4`) instead of names. Owner names, survey numbers, areas and boundaries
never enter a public response.

> **Why it matters:** privacy is enforced by the server's query, not by the frontend's
> discretion. There is no code path where a name could be leaked by forgetting to hide
> it.

**5. Document serving is policy-gated and fail-closed.**
`GET /api/verify/land/:landId/document` returns the decrypted PDF only if the record
is confirmed on-chain *and* the viewer is permitted. Unauthenticated callers get 401
under the default `VIEW_DOCUMENT_POLICY=registrar`; a record that cannot be confirmed
on-chain gets 409 and the document is never served.

> **Why it matters:** a database-only row — the failure mode of a compromised or
> half-migrated mirror — cannot leak a document. The check is on the read path, every
> time, not on the write path once.

### B. Truth anchored in a public ledger

**6. One chain write per registration — everything else is free.**
The duplicate-document check, the head lookup, the owner resolution and the link
resolution all happen against Postgres before the transaction is built. The contract
then stores the twelve resulting fields in a single `registerRecord` call. Chain
*reads* are `view` functions and cost nothing.

> **Why it matters:** registration costs one gas payment regardless of how deep the
> parcel's history is, and the common failure modes (duplicate, bad link) are caught
> for free before anything is signed.

**7. Off-chain linking, on-chain anchoring.**
The contract deliberately does not walk history. `previousRecordId` and `previousOwnerId`
are resolved by the registrar backend and passed in as trusted values. The chain stores
the *result* of the linkage rather than re-deriving it.

> **Why it matters:** flat gas, one write, no on-chain read amplification. The
> trade-off is honest: the API's link resolution becomes part of the trusted base. That
> is a choice, and the contract's docblock says so.

**8. Three-way integrity check on every public read.**
For each record the API compares the database mirror against the contract on three
independent axes — `documentHash`, `propertyId`, and the revoked flag — and returns a
per-record integrity block plus an `allOnChain` roll-up for the parcel.

> **Why it matters:** a drifted or tampered database is detectable *per record*, not
> merely trusted. The verifier sees exactly which record failed and on which axis.

**9. Hash matching as public proof without public disclosure.**
A visitor drops a PDF into the verifier. The API hashes the bytes and looks for a
matching `document_hash`. The verdict distinguishes four cases: no match, registered
under a different Land ID, matches a revoked version, or matches a version that is not
current.

> **Why it matters:** anyone can prove *a document matches a registered version*
> without the registry ever publishing the document. This is the cryptographic core of
> the public portal.

**10. Dual-path AI extraction, chosen automatically.**
One endpoint, two strategies. The PDF's text layer is probed first; if it holds at
least 200 characters, Gemini structures that text (fast, cheap, accurate). Otherwise the
first three pages are rendered to 1600 px JPEGs and sent to Gemini's vision model.

> **Why it matters:** there is no "scanned mode" toggle and no separate code path for
> the user to choose correctly. A digital deed and a photocopy of a digital deed are
> the same upload.

**11. The AI pre-fills; it never decides.**
The extraction prompt forbids guessing. The response is re-validated — dates must match
`YYYY-MM-DD` or are discarded, areas are re-parsed as numbers — and a usefulness gate
requires a survey number, a location and at least one party before the result is even
offered. The registrar reviews and edits every field.

> **Why it matters:** no value that reaches the chain was ever chosen by a model. The
> AI reduces typing; it does not exercise judgement.

### C. History that repairs itself

**12. Revocation is additive and restores the head.**
Records are never deleted. A registrar marks a record revoked on-chain (with a
mandatory reason) and in the mirror. If the revoked record was the parcel head and its
predecessor is still active, the predecessor becomes the head again.

> **Why it matters:** the chain is an append-only audit trail, and the parcel's current
> owner is always well-defined even after a revocation.

**13. The void-transfer rule.**
When a head has been revoked, its transfer is void — so for the *next* deed on that
parcel, the seller is the owner **before** the revoked record, not the owner it named.

> **Why it matters:** revoking a fraudulent transfer does not corrupt the ownership
> chain that follows it. This is a real legal distinction that most implementations
> miss.

**14. Deterministic identity with a validated human override.**
If the location on a new deed is spelled differently from an earlier deed on the same
parcel, the registrar may enter the existing Land ID. The override is validated against
a real record — it must exist, and its stored identity is reused so the history does
not split.

> **Why it matters:** the system is deterministic by default and forgiving on
> request, but the escape hatch is checked rather than trusted.

### D. Systems that fail loudly and prove themselves

**15. Misconfiguration is reported, never fatal.**
The backend audits its environment at boot. A missing variable is *not* `process.exit(1)`.
The server stays up, `/api/health` returns 503 with the exact list of missing or
malformed variables, and every other route answers with the same detail.

> **Why it matters:** the previous behaviour — exiting at import time — surfaced on
> Vercel as `FUNCTION_INVOCATION_FAILED` on every route with no hint of the cause.
> Now a broken deployment is diagnosable from a browser.

**16. The frontend cannot be blanked by an API error.**
`apiErrorMessage()` coerces every error shape into a string: `{error: "…"}`,
`{error: {code, message}}`, `{message}`, or a plain-text gateway body. An
`ErrorBoundary` wraps the whole tree, including the router and the tour provider.

> **Why it matters:** the platform's error envelope used to be placed directly into
> React state, which threw error #31 and unmounted the entire tree — the white page.
> The worst case is now a readable message with a link to `/api/health`.

**17. Every artefact verifies itself.**
Thirteen `check:*` scripts are part of the project, not an afterthought, alongside a
read-only smoke test:

| Script | What it proves |
|---|---|
| `check:env` | Every variable is present, correctly shaped, and usable |
| `check:runtime` | The registrar wallet has gas and the seeded users exist |
| `check:gas` | How many registrations the current balance covers |
| `check:services` | Supabase, Pinata and the chain accept the live credentials |
| `check:jwt` | The Pinata token is actually accepted by Pinata |
| `check:ipfs` | The real upload path works, with either credential style |
| `check:vercel` | The README's env list covers every variable the code reads |
| `check:login` | The exact browser request sequence, step by step |
| `check:boot` | A deliberately broken backend stays up and names its missing variables |
| `check:ui-failure` | The production build shows a message, not a blank page, against a broken API |
| `check:pdf` | Both PDF.js paths work, and it exits 1 if the worker file is missing |
| `check:tour` | Every tour anchor still exists in the rendered markup |
| `check:readme` | Every box diagram in this README is aligned |
| `smoke:api` | The protected read endpoints answer, read-only — no registration, no chain write |

> **Why it matters:** each of these exists because a real failure was observed and
> diagnosed. The set is the project's immune system.

**18. One env file, resolved by module location.**
`backend/env.js` resolves the repository-root `.env` from its own path, not from the
working directory. On Vercel there is no file — the platform injects the variables and
the same code path becomes a no-op.

> **Why it matters:** `node backend/server.js`, `npm --prefix backend run dev` and
> `npm run smoke:api` all read the same secrets, and local and production share one
> configuration code path.

**19. The walkthrough catalogue is verified against the markup.**
A CSS selector is just a string. Nothing in a normal build notices when a class is
renamed and the tour's spotlight silently points at nothing. `check:tour` confirms
every anchor token still exists in the rendered source, that each step's auth flag
matches the route's protection in `App.js`, and that the fixture parcel agrees with
the live verify API.

> **Why it matters:** onboarding cannot rot silently.

### E. The registry as a product

**20. A guided walkthrough that drives the real application.**
A 39-step tour across five surfaces, implemented from scratch with zero tour
libraries. It navigates real routes, scrolls real elements, opens real modals, pauses
at a sign-in gate and resumes afterwards. The spotlight is one fixed rectangle moved
onto the anchor and darkened with an oversized `box-shadow`; the hole is
`pointer-events: none`, so the page underneath stays usable.

> **Why it matters:** onboarding is a feature that behaves like the product, not a
> deck of screenshots that lies about it.

---

## Architecture

### System diagram

```mermaid
flowchart LR
    subgraph Clients["Clients"]
        R["Registrar browser<br/>React SPA"]
        P["Public verifier<br/>React SPA / QR scan"]
    end

    subgraph Host["Single Vercel project (or local dev)"]
        W["React SPA<br/>CRA build, static"]
        A["Express API<br/>/api/*"]
    end

    subgraph Services["Managed services"]
        S[("Supabase Postgres<br/>users · owners · land_records")]
        I[("Pinata / IPFS<br/>AES-GCM ciphertext")]
        B["Polygon Amoy<br/>LandRegistry contract"]
        G["Gemini API<br/>deed field extraction"]
    end

    R -->|HTTPS| W
    P -->|HTTPS| W
    W -->|same-origin /api| A
    A -->|service-role key| S
    A -->|pin ciphertext / fetch gateways| I
    A -->|registerRecord · revokeRecord · getRecord| B
    A -->|text or vision extraction| G
    S -.->|record mirror + private details| A
    B -.->|record + revoked flag| A
    I -.->|encrypted bytes| A
```

The browser never talks to Supabase, Pinata, or Polygon directly. All privileged access is mediated by the API. The public verification page calls the same API, which cross-checks Supabase against the chain.

### Layers

| Layer | Components | Responsibility |
|---|---|---|
| Experience | `frontend/src` (React 18, React Router, axios, dropzone, Lucide) | Registrar portal, public verifier, QR/timeline rendering |
| Application | `backend/server.js`, `routes/*`, `middleware/auth.js` | HTTP surface, JWT auth, validation, upload limits, CORS |
| Domain services | `services/landIdentity.js`, `ai.js`, `ipfs.js`, `blockchain.js`, `qr.js` | Parcel identity, hashing, encryption, extraction, pinning, chain calls, QR generation |
| Persistence and anchors | Supabase Postgres, Pinata IPFS, LandRegistry on Polygon Amoy | Private details and mirrors, encrypted content, immutable fingerprints |

### Component responsibilities

| Component | File | Responsibility |
|---|---|---|
| API entrypoint | `backend/server.js` | CORS, JSON parsing, routes, health check, error handler, local listener |
| Runtime config | `backend/config.js` | Upload cap (15 MB local, 4 MB on Vercel) |
| Database client | `backend/supabase.js` | Service-role client, boot connectivity check, row mappers |
| Auth middleware | `backend/middleware/auth.js` | JWT verification, `adminOnly` guard, JWT boot guard |
| Registrar routes | `backend/routes/land.js` | Extract, preview, register, list, stats, record detail, document, revoke |
| Public routes | `backend/routes/verify.js` | Parcel timeline, chain checks, policy-gated document view, PDF comparison, QR |
| Identity and crypto | `backend/services/landIdentity.js` | Normalisation, HMAC/SHA-256/keccak, Land ID, AES-256-GCM |
| AI extraction | `backend/services/ai.js` | Gemini text/vision extraction and field normalisation |
| IPFS | `backend/services/ipfs.js` | Pinata v3 upload with legacy fallback, multi-gateway fetch |
| Chain | `backend/services/blockchain.js` | ethers v6 provider/signer, contract ABI, read/write calls |
| QR | `backend/services/qr.js` | Verify URL derivation, labelled PNG generation |
| Contract | `contracts/LandRegistry.sol` | Registrar allowlist, record anchoring, revocation, reads, events |

### Registration sequence

```mermaid
sequenceDiagram
    autonumber
    participant U as Registrar browser
    participant A as Express API
    participant AI as Gemini
    participant DB as Supabase
    participant IP as Pinata / IPFS
    participant C as Polygon Amoy

    U->>A: POST /api/land/extract (PDF)
    A->>AI: Text layer or rendered pages
    AI-->>A: Extracted fields
    A-->>U: Pre-filled form (registrar reviews)
    U->>A: POST /api/land/register (PDF + fields)
    A->>DB: Check duplicate SHA-256 document hash
    A->>A: Resolve Land ID, head record, owners
    A->>A: AES-256-GCM encrypt the PDF
    A->>IP: Pin ciphertext
    IP-->>A: CID
    A->>C: registerRecord(12 fields)
    C-->>A: Receipt + block timestamp
    A->>A: Generate labelled QR
    A->>DB: Insert record, move parcel head
    A-->>U: landId, recordId, txHash, CID, QR
```

There is exactly **one chain write per registration**. Linking (`previousRecordId`, `previousOwnerId`) is resolved from Supabase first and passed into that write; the contract does not walk history.

### Verification sequence

1. The verifier submits a Land ID or scans the QR.
2. The API loads every record for that `land_id` from Supabase, ascending by creation time.
3. Each record is checked against the contract with a free read: `recordExists`, then `getRecord`.
4. The API compares `documentHash`, `propertyId`, and the revoked flag; a record passes only if all three match.
5. The response returns the timeline, owner registry IDs, hashes, CIDs, transactions, and a per-record integrity block. No owner names, survey numbers, areas, or boundaries are returned.
6. If the caller asks for the original deed, the API enforces the viewing policy, confirms the record on-chain, fetches ciphertext from IPFS, decrypts with AES-256-GCM, verifies the SHA-256, and serves the PDF.

### Trust boundaries

| Boundary | Protection |
|---|---|
| Browser to API | Bearer JWT for registrar routes; public routes are read-only except PDF comparison |
| API to Supabase | Service-role key only; RLS is enabled with no policies, so anon/public keys cannot read tables |
| API to Pinata | JWT or API key pair; only ciphertext is uploaded |
| API to Polygon | Single authorised registrar hot wallet signs writes; reads are free |
| Public verifier to API | No authentication; privacy is enforced by response projection and policy |
| Deployment to clients | HTTPS at the edge (Vercel); CORS allowlist for browser origins |

### Design decisions and trade-offs

- **Off-chain linking, on-chain anchoring.** Supabase is the source of truth for parcel history; the chain stores the resulting pointers. This keeps registration to one transaction and avoids gas-heavy history walks, but means the API's link resolution must be trusted.
- **Hashes, not documents, on-chain.** Only fingerprints and the encrypted CID are public. Confidentiality depends on key custody.
- **Keyed hashes for enumerable fields.** Survey numbers are small and guessable, so `propertyId` and `surveyNumberHash` are HMAC-SHA256 with `HASH_PEPPER` rather than plain hashes.
- **One head per parcel.** A partial unique index enforces a single `is_latest = true` row per Land ID, making the current owner unambiguous.
- **Revocation is additive.** Records are never deleted; a registrar marks them revoked on-chain and in the mirror. The API restores the previous active record as head when a head is revoked.
- **Single origin in production.** Vercel Services routes `/api/*` to Express and everything else to the SPA, so there is no production CORS or API URL to configure.

### Deployment topology

```
Internet
   │
   ▼
Vercel edge  ── /api/* ──▶  Express service (backend/)
   │
   └────────── /* ──────▶  CRA static build (frontend/build)

Express ──▶ Supabase (Postgres, service role)
        ──▶ Pinata (pin/fetch encrypted PDFs)
        ──▶ Polygon Amoy RPC (register/revoke/read)
        ──▶ Gemini API (extraction)
```

The same Express app runs locally on port `5000` and as the Vercel API service. The SPA runs on port `3000` in development and is built statically for production. See [Deploy to Vercel](#deploy-to-vercel) for limits that affect uploads and function duration.

### Failure boundaries

- **AI unavailable:** extraction returns `success: false`; the registrar fills the form manually.
- **Pinata unavailable:** registration aborts before the chain write.
- **Chain write fails:** no database row is inserted; the encrypted pin may remain orphaned.
- **Chain write succeeds, database insert fails:** the API returns `recordId` and `txHash` in the error payload, restores the previous head flag, and logs the mismatch. Manual reconciliation is required.
- **Chain read fails during verification:** the record is reported as unconfirmed (`onChain: null` with an error), not as valid.
- **IPFS gateway fails:** the API races configured and public gateways; the deed cannot be served until one succeeds.

---

## How It Works

### 1. Registrar signs in

`POST /api/auth/login` checks the email against the `users` table, requires `active = true`, compares the password with bcrypt (12 rounds), and returns a JWT valid for `JWT_EXPIRES_IN` (default `8h`). The SPA stores the token and user in `sessionStorage` and attaches the token to every API request. A protected route validates the token against `GET /api/auth/me` before rendering.

### 2. Deed is uploaded and read

Only PDFs are accepted. The API checks both the client-supplied MIME type and the `%PDF-` magic bytes, then writes the bytes to a temporary file. If the PDF has a text layer of at least 200 characters, Gemini structures that text. Otherwise the first three pages are rendered to 1600 px JPEGs and sent to Gemini vision. The AI only pre-fills the form; the registrar reviews every field.

### 3. Parcel identity is derived

The Land ID is derived from the normalised jurisdiction, survey number, and subdivision. The API also looks up the current head for that Land ID, so the UI can show whether the deed will start a new parcel or link to an existing one. If the extracted location differs from an earlier deed, the registrar can enter an existing Land ID override.

### 4. Owners are resolved

Buyer and seller are represented by `OWN-XXXXXXXX` registry IDs. The API finds or creates an owner using a keyed match on normalised name plus optional government ID reference. Only `keccak256(owner_id)` goes on-chain. Government ID references are stored only as keyed hashes, never plaintext.

### 5. Hashes and ciphertext are prepared

The original PDF is hashed with SHA-256 for duplicate detection and on-chain anchoring. Land details and registration metadata are hashed as canonical JSON. The PDF is encrypted with AES-256-GCM using a random 96-bit IV; the IV and authentication tag are stored in Postgres, while the ciphertext is pinned to IPFS.

### 6. Record is anchored on Polygon

The API calls `registerRecord` with the 12 fields. The contract sets `registeredAt` from the block timestamp and emits `RecordRegistered`. The API reads the block timestamp and mirrors it into Supabase.

### 7. Off-chain mirror and head are written

The previous head, if any, is demoted (`is_latest = false`), and the new record is inserted as the head. If the insert fails, the previous head is restored. The response includes the Land ID, record ID, transaction hash, CID, document hash, verify URL, and QR data URL.

### 8. Public verification

Anyone with the Land ID can load the parcel timeline. The API checks every record against the contract and returns owner IDs only. The public page shows the current status, timeline, per-record chain integrity, proof hashes, and the QR. It can also hash an uploaded PDF and report whether it matches a registered version.

### 9. Revocation

A registrar supplies a reason (required, max 300 characters). The API calls `revokeRecord` on-chain, then records the status, transaction hash, timestamp, and reason in Supabase. If the revoked record was the parcel head and its predecessor is still active, the predecessor becomes the head again. Revocation never deletes data.

---

## The Pipelines

This section traces every pipeline in the system end to end: what triggers it, what
each stage does, where it can fail, and how you prove it works. The diagrams are
plain text so they render identically everywhere.

### Pipeline 0 — Request lifecycle (every request)

```
  Browser
     │
     ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ backend/server.js                                                │
  │                                                                  │
  │  1. import "./env.js"      → loads <repo>/.env (no-op on         │
  │                              Vercel, where vars are injected)    │
  │  2. auditEnv()             → 5 required vars audited             │
  │  3. express.json() / urlencoded()                                │
  │  4. cors()                 → FRONTEND_URL allowlist +            │
  │                              any localhost port                  │
  │  5. GET /api/health        → ALWAYS answers (200 or 503)         │
  │  6. misconfig gate         → 503 + problems, if audit failed     │
  │  7. router                 → /api/auth · /api/land · /api/verify │
  │  8. 404 handler            → { error: "Route not found" }        │
  │  9. global error handler   → multer LIMIT_FILE_SIZE → 413        │
  └──────────────────────────────────────────────────────────────────┘
     │
     ▼
  Response
```

The health check is registered **before** every other route, so it answers even when
the deployment is broken. The misconfiguration gate sits after it, so a broken
deployment still produces a readable diagnosis rather than a mystery.

---

### Pipeline 1 — Deed ingestion and AI extraction

**Trigger:** the registrar drops a PDF onto the register page.
**Endpoint:** `POST /api/land/extract` (multipart, field name `deed`).

```
  Drop PDF (react-dropzone)
     │  accepts: application/pdf · .pdf · max 1 file · max 15 MB
     ▼
  Multer memory storage ── fileFilter: mimetype must be application/pdf
     │
     ▼
  assertPdf()  ── magic bytes must be "%PDF-" (client mimetype is untrusted)
     │
     ▼
  Write to os.tmpdir()/nosih-deed-<ts>.pdf      (deleted in `finally`)
     │
     ▼
  ┌───────────────────────────────────────────────────────────┐
  │ extractDeedMetadata()                                     │
  │                                                           │
  │  await primePdfWorker()  → pdfjs-dist/legacy/build/       │
  │                            pdf.worker.mjs                 │
  │                                                           │
  │  tryPdfTextLayer()   (pdf-parse)                          │
  │      └─ text ≥ 200 chars ──► structureWithGemini(text)    │
  │      └─ no text layer    ──► renderPdfPages()             │
  │                              pages 1–3 · scale 2.0        │
  │                              pdf-to-png-converter + sharp │
  │                              → 1600px JPEG q85            │
  │                              → base64 inlineData          │
  │                              └─► extractWithGeminiVision()│
  └───────────────────────────────────────────────────────────┘
     │
     ▼
  parseGeminiJsonResponse()
     · strip ``` fences · extract {…} · JSON.parse
     · keep only the 18 DEED_FIELDS · trim to string
     · area      → re-parsed as a number ("2.45" → 2.45)
     · date      → dropped unless it matches ^\d{4}-\d{2}-\d{2}$
     │
     ▼
  isUsefulExtraction()?   surveyNumber ∧ (district|state) ∧ (buyer|seller)
     │
     ├── no  → { success:false, error:"…fill the form manually" }
     └── yes → { success:true, data:{…} }  →  form pre-fills
```

**Failure modes**

| Failure | Result |
|---|---|
| Not a PDF, or bad magic bytes | 400, the form stays manual |
| Text layer below 200 chars | Falls through to the vision path |
| PDF.js worker missing from the deployment | `Setting up fake worker failed` → caught by `npm run check:pdf` before deploy |
| Gemini times out (60 s) or returns bad JSON | `success:false` with a readable message; the registrar types the fields |
| Temp file leaked | `finally` removes it on every path |

**Proof:** `npm run check:pdf` renders a page and reads a text layer through the same
code. A live extraction of a text deed logs `Text layer found — Gemini text
structuring`; of an image-only deed, `No text layer — Gemini vision`.

---

### Pipeline 2 — Identity derivation and hashing

**Trigger:** the registrar completes the review form (or the preview request).
**Endpoint:** `POST /api/land/preview` (JSON) and `POST /api/land/register`.

```
  Form fields
     │
     ▼
  Joi validation  (stripUnknown, abortEarly:false)  → 400 with every detail
     │
     ▼
  normalise()  NFKC · uppercase · keep letters/digits/.-/  · collapse spaces
     │
     ├── normSurvey()      "123 / 4A" → "123/4A"
     │
     ▼
  buildJurisdictionCode()
     STATE-DISTRICT-TALUK   alphanumeric only   ≤ 31 bytes
     │
     ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ computeLandIdentity()                                         │
  │                                                               │
  │  propertyId       = HMAC-SHA256(pepper,                       │
  │                        "property|code|sur|sub")               │
  │  landId           = "LAND-" + propertyId[2:12]                │
  │  surveyNumberHash = HMAC-SHA256(pepper, "survey|code|sur")    │
  └───────────────────────────────────────────────────────────────┘
     │
     ▼
  computeLandDetailsHash()  = SHA256(canonicalJson{survey, subdivision,
                                     area, areaUnit, 4 boundaries})
  computeMetadataHash()     = SHA256(canonicalJson{documentType,
                                     registrationNumber, registrationDate,
                                     sroOffice})
  computeDocumentHash(pdf)  = SHA256(file bytes)
  idHash(recordId)          = keccak256(recordId)
  owner_hash                = keccak256(owner_id)
     │
     ▼
  12 on-chain fields assembled ─────────────────────────────────────────
```

**Why two hash families?** `landDetailsHash`, `metadataHash` and `documentHash` are
plain SHA-256 over canonical JSON, so **anyone holding the same data can recompute and
check them**. `propertyId` and `surveyNumberHash` are keyed, because survey numbers
are enumerable and a public chain would leak them.

**Canonical JSON** sorts keys and normalises every value, so `{"a":1,"b":2}` and
`{"b":2,"a":1}` hash identically, and `" Andheri "` and `"ANDHERI"` hash identically.

---

### Pipeline 3 — Encryption and content-addressed storage

**Trigger:** the registrar submits the registration.
**Endpoint:** `POST /api/land/register`.

```
  PDF bytes
     │
     ▼
  computeDocumentHash(pdf) ─────────────────► SHA-256
     │
     ▼
  Duplicate guard: SELECT ... WHERE document_hash = ?
     ├── found → 409 { existingRecordId, existingLandId }   (free, no gas)
     └── none → continue
     │
     ▼
  ┌─────────────────────────────────────────────┐
  │ encryptDocument(pdf)                        │
  │   key = DOCUMENT_ENC_KEY (32 bytes)         │
  │   iv  = randomBytes(12)                     │
  │   AES-256-GCM                               │
  │   → { ciphertext, iv(hex), tag(hex) }       │
  └─────────────────────────────────────────────┘
     │
     ▼
  uploadToIPFS(ciphertext, "<REC>.pdf.enc", "application/octet-stream")
     │
     ├── canUseV3Uploads()?  (JWT, or a UUID-shaped key)
     │      └── POST https://uploads.pinata.cloud/v3/files
     │      └── on failure → fall back to the legacy endpoint
     └── else → POST https://api.pinata.cloud/pinning/pinFileToIPFS
     │
     ▼
  CID  ──► written into the on-chain record
```

The file is uploaded as `application/octet-stream` with an `.enc` name. **IPFS never
receives a readable deed.** The IV and authentication tag stay in Postgres; the key
never leaves the server.

**Failure modes**

| Failure | Result |
|---|---|
| Pinata rejects the credential | 502 with the reason; registration aborts **before** the chain write |
| Both Pinata endpoints fail | Same — no orphaned transaction, no half-registered record |
| Network drop mid-upload | Same — the abort happens before any gas is spent |

---

### Pipeline 4 — Chain anchoring (the one write)

**Trigger:** the PDF is encrypted and pinned.
**Contract:** `LandRegistry.registerRecord(PropertyRecord)`.

```
  12 fields assembled by the API
     │
     │  propertyId         surveyNumberHash   jurisdictionCode
     │  landDetailsHash    documentHash        metadataHash
     │  ipfsCID            recordId            previousRecordId
     │  previousOwnerId    currentOwnerId      registeredAt = 0 (ignored)
     ▼
  ethers v6 Wallet(ISSUER_PRIVATE_KEY) → JsonRpcProvider(Alchemy | public Amoy)
     │
     ▼
  registerRecord(r)  ── onlyRegistrar modifier ──▶  Polygon Amoy
     │   reverts on: empty recordId · empty propertyId · empty documentHash
     │                empty CID · record exists · not an authorized registrar
     ▼
  tx.wait()  →  receipt
     │
     ▼
  getProvider().getBlock(receipt.blockNumber).timestamp
     │
     ▼
  { txHash, registeredAt }   ← the block's own clock, not the server's
```

The contract sets `registeredAt` itself from `block.timestamp`; the API reads the
block back to mirror the same value into Postgres, so the off-chain record carries the
**chain's** time rather than the server's.

**Why the linking fields are trusted inputs:** the contract stores
`previousRecordId` and `previousOwnerId` as given. It does not walk history, does not
validate the link, and does not read the previous record. That is what keeps a
registration to one transaction and its gas flat.

---

### Pipeline 5 — Off-chain mirror and head management

**Trigger:** the chain write confirmed.

```
  head = SELECT … WHERE land_id = ? AND is_latest = true
     │
     ├── head exists → UPDATE land_records SET is_latest = false WHERE id = head.id
     │                    (on failure → 500, previous head untouched)
     │
     ▼
  INSERT INTO land_records (41 columns)
     · 12 on-chain fields as 0x-hex
     · private details (survey, area, 4 boundaries, village/taluk/district/state)
     · document metadata (type, registration number/date, SRO office)
     · enc_iv · enc_tag · ipfs_cid · tx_hash · qr_code_data · verify_url
     · is_latest = true · status = 'active' · registered_by = req.userId
     │
     ├── insert fails → restore the previous head to is_latest = true
     │                  → 500 with { recordId, txHash } in the payload
     │                  → log "CHAIN WRITTEN BUT DB INSERT FAILED"
     │                  → manual reconciliation required
     └── insert succeeds
           │
           ▼
      201 { landId, recordId, linked, previousRecordId, previousOwnerId,
            currentOwnerId, txHash, ipfsCID, documentHash, registeredAt,
            verifyUrl, qrCode }
```

**The head invariant** is enforced by the database, not by application code:

```sql
create unique index land_records_one_latest_per_land
  on land_records (land_id) where is_latest;
```

A partial unique index means "exactly one current record per parcel" is a **schema
constraint**. Two concurrent registrations for the same parcel cannot both become the
head — the second insert fails, its head is restored, and the chain write is reported
for reconciliation.

---

### Pipeline 6 — QR issuance

**Trigger:** after the chain write, for every registration and every public view.

```
  landId  →  buildVerifyUrl()
              VERIFY_BASE_URL (if non-local)
              else  x-forwarded-proto + x-forwarded-host + "/verify"
              else  http://localhost:3000/verify
              →  <base>?landId=LAND-XXXXXXXXXX
     │
     ▼
  QRCode.toBuffer(url, { width:480, margin:2, errorCorrectionLevel:"M",
                          color:{ dark:"#1E2126", light:"#FFFFFF" } })
     │
     ▼
  sharp: 480×480 white canvas
     ├─ composite QR PNG at (0,0)
     └─ composite an SVG label strip (480×84):
            LAND-XXXXXXXXXX        (monospace, 30px, bold)
            NOSIH Land Registry · scan to verify   (16px, grey)
     │
     ▼
  PNG ─┬─► data:image/png;base64,…  → stored in land_records.qr_code_data
        │                             and returned in the receipt
        └─► GET /api/verify/land/:landId/qr  (public PNG, cached 24 h)
```

The base URL is derived from the **incoming request**, so the QR is correct on every
deployment without a deployment-specific environment variable.

---

### Pipeline 7 — Public verification and integrity proof

**Trigger:** someone scans the QR or types a Land ID.
**Endpoint:** `GET /api/verify/land/:landId` — no authentication.

```
  ?landId=LAND-XXXXXXXXXX
     │
     ▼
  parseLandId()  ── must match ^LAND-[0-9A-F]{10}$
     │  invalid → 400
     ▼
  SELECT the parcel's records, ordered by created_at ASC
     │  none → 404 { found:false }
     ▼
  For EACH record, in parallel:
     │
     ├─► getRecordFromChain(record_id_hash)
     │      ├─ recordExists(recordId)?        → false ⇒ onChain:false
     │      └─ getRecord(recordId)            → the 12 fields + revoked flag
     │
     ├─ documentHashMatch = chain.documentHash == row.document_hash
     ├─ propertyIdMatch   = chain.propertyId   == row.property_id
     └─ statusMatch       = chain.revoked      == (row.status == "revoked")
     │
     │   chain read throws → { onChain:null, error:"Chain read failed: …" }
     ▼
  Build the timeline
     · currentOwnerId · currentRecordId · jurisdictionCode · location
     · recordCount · allOnChain = every record passed all three checks
     · per record: hashes, CID, txHash, owner transfer arrow, integrity block
     · DISCLAIMER: a hash match does not prove legal ownership
     ▼
  Response — owner IDs only, never names
```

The API returns owner **registry IDs** (`OWN-8F3A21C4`), not names. A verifier can see
that ownership moved from one registry identity to another without learning who they
are.

---

### Pipeline 8 — Document hash comparison

**Trigger:** a visitor drops a deed PDF into the public verifier.
**Endpoint:** `POST /api/verify/land/:landId/document` — no authentication.

```
  PDF upload
     │
     ▼
  magic bytes "%PDF-"  ── invalid → 400
     │
     ▼
  uploadedHash = SHA256(bytes)
     │
     ▼
  SELECT … FROM land_records WHERE document_hash = uploadedHash
     │
     ├── no row → { match:false,
     │              verdict:"No registered version matches this PDF." }
     │
     ├── row but row.land_id ≠ requested Land ID
     │        → { match:false,
     │            verdict:"This PDF is registered, but under a different
     │                    Land ID." }
     │
     └── row matches
          │
          ├─ chain check fails → verdict:"Database match, but the on-chain
          │                      hash could not be confirmed."
          ├─ status = revoked  → verdict:"Matches a registered version that
          │                      has been REVOKED."
          ├─ not is_latest     → verdict:"Matches a registered version, but it
          │                      is not the current record for this land."
          └─ is_latest + active → verdict:"Matches the current registered
                                  version for this land."
```

The verdict is deliberately nuanced. "This document is registered" and "this document
is the *current* version" are different claims, and the UI tones them differently.

---

### Pipeline 9 — Revocation and head restoration

**Trigger:** a registrar revokes a record from the records table.
**Endpoint:** `POST /api/land/records/:recordId/revoke`.

```
  reason (required, ≤ 300 chars)
     │  empty → 400
     ▼
  SELECT the record
     │  status = 'revoked' → 409 "Record is already revoked"
     ▼
  revokeRecord(record_id_hash, reason)  ── on-chain, with the reason in the event
     │  reverts on: record not found · already revoked
     ▼
  UPDATE land_records SET status='revoked', revoked_tx_hash, revoked_at,
                          revoke_reason
     │
     ▼
  Is this the head, and does it have a previous record?
     │
     ├── no  → done
     └── yes → SELECT the previous record
               │
               ├── previous.status = 'active'
               │     → this record    → is_latest = false
               │     → previous record → is_latest = true    (head restored)
               └── previous is also revoked → leave the head as it is
     │
     ▼
  { success:true, recordId, txHash }
```

**The void-transfer rule applies on the next registration:** because the revoked
head's transfer is void, the seller for the next deed on that parcel is the owner
**before** the revoked record — read from `head.previous_owner_id` rather than
`head.current_owner_id`.

Nothing is ever deleted. The revocation is an append-only fact on the chain and a
status change in the mirror.

---

### Pipeline 10 — The guided walkthrough engine

**Trigger:** a first-time visitor accepts the walkthrough, or a `?tour=<group>` deep
link is opened.
**Files:** `frontend/src/components/tour/` — nine files, zero dependencies.

```
  ?tour=1 | ?tour=<group>          (deep link: no welcome prompt, decision
     │                              written as "started")
     ▼
  start(index) → status = "running"
     │
     ▼
  ┌───────────────────── step transition effect ─────────────────────┐
  │                                                                  │
  │  setMoving(true)          the spotlight FREEZES on its target    │
  │  navigate(step.route)     if the current route differs           │
  │  await step.before?.()    a hook may drive the page              │
  │  await waitForLayoutToSettle()   late images/data stopped        │
  │  await waitForElement(step.anchor)   selector exists AND has size│
  │  await scrollIntoViewAndSettle(element)  smooth scroll + rest    │
  │                                                                  │
  │  setTarget(element)  ┐  released in the SAME commit, so the      │
  │  setPlacement(step)  ┘  hole TRAVELS instead of blinking         │
  │  setMoving(false)                                                │
  │  setVisible(true)                                                │
  │                                                                  │
  │  if last step → dwellTimer = 4 000 ms → finish()                 │
  │                                                                  │
  │  cleanup: cancel the dwell timer, run the previous step's after()│
  └──────────────────────────────────────────────────────────────────┘
     │
     ▼
  Spotlight  →  fixed rect at the anchor, darkened with a giant box-shadow
                hole is pointer-events:none  →  the page stays usable
                ResizeObserver on the target AND document.body → follows reflow
     │
     ▼
  TourTooltip →  card follows the hole; the copy is keyed by step.id so it
                 re-animates on every step while the card shell stays mounted
     │
     ▼
  Keyboard:  → / Enter = next   ← = previous   Esc = skip
     │
     ▼
  Gate: a step with requiresAuth and no session shows "Sign in to continue".
        The tour PAUSES at that index — it does not filter the step out —
        and resumes at the same index once a token exists in sessionStorage.
     │
     ▼
  End (any of three ways)
     · Finish   → decision "completed", position cleared
     · Skip/Esc → decision "skipped", position KEPT so it can resume
     · Last step → auto-finishes after 4 000 ms
     All three run the current step's after() hook, so the deed modal closes.
```

**The spotlight travels.** The earlier implementation faded the spotlight and the card
out and back in on every step change, which read as a blink. Holding the hole steady
exposed three placement faults it had been hiding — the smooth scroll had not
finished, late data reflowed the page under the hole, and a step hook could change the
layout before placement. All three are now handled explicitly.

**Verification tiers** (`npm run check:tour`):

| Tier | Runs when | Checks |
|---|---|---|
| 1 | Always | Catalogue is well formed; auth flags match `App.js`; every anchor token exists in the markup |
| 2 | `--drive` | Drives the real tour in a headless browser |
| 3 | Reachable | The fixture parcel agrees with the live verify API |

---

### Pipeline 11 — Deployment and verification

```
  ┌──────────────────────────── local ────────────────────────────┐
  │  .env (repo root)                                             │
  │     │  backend/env.js resolves it by module location          │
  │     │  frontend/.env.local holds REACT_APP_* (build-time)     │
  │     ▼                                                         │
  │  npm run check:env ──► check:services ──► check:runtime       │
  │  npm run check:pdf ──► check:tour ──► check:login             │
  │  npm run compile && npx hardhat test                          │
  │     ▼                                                         │
  │  node backend/server.js   (port 5000)                         │
  │  npm start --prefix frontend (port 3000, proxy → 5000)        │
  └───────────────────────────────────────────────────────────────┘
     │
     ▼
  ┌─────────────────────────── Vercel ────────────────────────────┐
  │  vercel login                                                 │
  │  npm run vercel:env        reads the root .env, pushes vars   │
  │  git push → Vercel build                                      │
  │                                                               │
  │  web service:  root=frontend/  CRA build → build/             │
  │  api service:  root=backend/   Express, zero-config           │
  │                                                               │
  │  /api/* → api service        /* → web service                 │
  │                                                               │
  │  One domain. No production CORS. No API URL to configure.     │
  └───────────────────────────────────────────────────────────────┘
```

**Two things that bite on Vercel and are handled here:**

1. **The PDF.js worker.** PDF.js imports its worker with a bundler-ignore hint, so
   Vercel's file tracer never packaged it and the deployment failed with
   `Setting up fake worker failed`. The fix is to import the worker *by name* in
   `backend/services/ai.js` so the tracer has a literal specifier to follow, and to
   pin one `pdfjs-dist` version across all dependents so `pdf-parse` and
   `pdf-to-png-converter` share the same PDF.js. `npm run check:pdf` fails with exit 1
   if the worker file is missing.

2. **Native modules.** `sharp` and `pdf-to-png-converter` are loaded on first use, not
   at import time, so a platform-level binary problem cannot take down the whole
   function — only the affected feature.

---

## Identity, Hashing and Privacy

### Land ID derivation

```
jurisdictionCode = STATE-DISTRICT-TALUK        (alphanumeric, max 31 bytes)
propertyId       = HMAC-SHA256(HASH_PEPPER, "property|jurisdiction|survey|subdivision")
landId           = "LAND-" + first 10 hex chars of propertyId, uppercase
```

Normalisation: NFKC, uppercase, punctuation outside letters/numbers/`/`/`-`/`.` collapsed to spaces, whitespace collapsed. Survey numbers also drop all spaces, so `123 / 4A` equals `123/4A`.

The same jurisdiction, survey number, and subdivision always produce the same Land ID. This is the linking key for the parcel's history.

### Hash reference

| On-chain field | Type | Derivation | Who can recompute |
|---|---|---|---|
| `propertyId` | `bytes32` | HMAC-SHA256(`HASH_PEPPER`, `property\|JURISDICTION\|SURVEY\|SUBDIV`) | Holder of the pepper |
| `surveyNumberHash` | `bytes32` | HMAC-SHA256(`HASH_PEPPER`, `survey\|JURISDICTION\|SURVEY`) | Holder of the pepper |
| `jurisdictionCode` | `bytes32` | ASCII `STATE-DISTRICT-TALUK`, bytes32-encoded | Anyone (readable, not hashed) |
| `landDetailsHash` | `bytes32` | SHA-256 of canonical JSON: survey, subdivision, area, unit, four boundaries | Anyone with the details |
| `documentHash` | `bytes32` | SHA-256 of the original PDF bytes | Anyone with the PDF |
| `metadataHash` | `bytes32` | SHA-256 of canonical JSON: document type, registration number/date, SRO office | Anyone with the metadata |
| `ipfsCID` | `string` | Pinata CID of the **encrypted** PDF | Anyone (content is ciphertext) |
| `recordId` | `bytes32` | keccak256 of `REC-XXXXXXXX` | Anyone |
| `previousRecordId` | `bytes32` | keccak256 of the previous `REC-…`, or zero | Anyone |
| `previousOwnerId` | `bytes32` | keccak256 of `OWN-…`, or zero | Anyone |
| `currentOwnerId` | `bytes32` | keccak256 of `OWN-…` | Anyone |
| `registeredAt` | `uint256` | Block timestamp; the contract ignores any supplied value | Anyone |

Canonical JSON sorts keys and normalises string values; null/undefined become empty strings; numbers are preserved. The details hash includes the normalised survey number, subdivision, numeric area, area unit, and the four boundary descriptions. The metadata hash includes document type, registration number, registration date, and SRO office.

### Owner identity

- `owner_id` is `OWN-` plus 8 uppercase hex characters.
- `owner_hash` is `keccak256(owner_id)`; this is the only owner value on-chain.
- `match_key` is a keyed HMAC over normalised name plus optional government ID reference; it is used only for de-duplication.
- `gov_id_hash` is a keyed HMAC of the government ID reference; the plaintext reference is never stored.
- Government ID references are optional. Without one, two different people with the same normalised name will resolve to the same owner record.

### Document encryption

- Algorithm: AES-256-GCM.
- Key: `DOCUMENT_ENC_KEY` (64 hex characters, validated at boot).
- IV: 12 random bytes per document, stored as hex in `enc_iv`.
- Authentication tag: stored as hex in `enc_tag`.
- IPFS receives only ciphertext. The original PDF exists only in transit, in memory/temporary storage during registration, and when a policy-authorised viewer decrypts it.
- There is no key versioning. Changing `DOCUMENT_ENC_KEY` makes all previously stored deeds unreadable.

### What is public and what is private

| Data | On-chain | Public verify API | Registrar API |
|---|---|---|---|
| Deed PDF | Encrypted CID only | Policy-gated plaintext (registrar by default) | Plaintext with JWT |
| Owner full name | No | No | Yes |
| Government ID reference | No | No | Keyed hash only |
| Survey number (plaintext) | No (keyed hash only) | No | Yes |
| Subdivision, area, boundaries | No (hash only) | No | Yes |
| Village, taluk, district, state | Jurisdiction code only (state-district-taluk) | Yes | Yes |
| Document type, registration date, SRO office | Hash only | Yes | Yes |
| Document hash, CID, record ID, tx hashes | Yes | Yes | Yes |
| Owner registry IDs | Yes (as keccak hashes) | Yes | Yes |
| Original filename | No | No | Yes |
| Encryption IV and tag | No | No | No (server-side only) |
| QR code | No | Generated from Land ID | Yes |

The public verifier intentionally reveals coarse location and document metadata. Survey numbers, boundaries, area, names, and government ID references stay off the public surface.

---

## Ownership Chain and Linking

Each parcel has one **head** record: the row with `is_latest = true`. A partial unique index (`land_records_one_latest_per_land`) guarantees at most one head per Land ID.

When a new deed is registered:

1. The API derives the Land ID from the reviewed location and survey fields.
2. It looks up the head in Supabase (no chain read).
3. If a head exists, the new record gets:
   - `previousRecordId` = head's record ID,
   - `previousOwnerId` = head's current owner (or the owner before a revoked head),
   - `currentOwnerId` = buyer.
4. The old head is demoted and the new record becomes the head in the same database operation sequence, with a restore if the insert fails.

If the deed's location is spelled differently and therefore produces a different Land ID, the registrar can enter an existing Land ID in the **Link to existing Land ID** field. The API validates the format, requires that the parcel already has records, and reuses that parcel's stored `property_id`, `survey_number_hash`, and `jurisdiction_code` so the history does not split.

Revocation semantics:

- A revoked record stays in the timeline with its reason, revocation transaction, and timestamp.
- If the revoked record was the head and its predecessor is active, the predecessor is promoted back to head.
- If the revoked record was the first record and no active predecessor exists, the parcel temporarily has no head; verification falls back to the latest record in the timeline (which is revoked). A later registration can create a new head.

The contract does not validate links. It stores the pointers the registrar supplies. Public verification checks each record's hashes and revocation status against the chain, but the correctness of the link itself depends on the registrar and the off-chain resolution logic.

---

## Smart Contract

`contracts/LandRegistry.sol` — Solidity `0.8.20`, OpenZeppelin `Ownable`.

### Record struct

```solidity
struct PropertyRecord {
    bytes32 propertyId;
    bytes32 surveyNumberHash;
    bytes32 jurisdictionCode;
    bytes32 landDetailsHash;
    bytes32 documentHash;
    bytes32 metadataHash;
    string  ipfsCID;
    bytes32 recordId;
    bytes32 previousRecordId;
    bytes32 previousOwnerId;
    bytes32 currentOwnerId;
    uint256 registeredAt;
}
```

### State

| Name | Visibility | Purpose |
|---|---|---|
| `records` | private mapping | Records keyed by `recordId` |
| `revoked` | public mapping | Revocation flag per record |
| `authorizedRegistrars` | public mapping | Wallets allowed to write |

### Functions

| Function | Access | Behaviour |
|---|---|---|
| `addRegistrar(address)` | owner | Authorises a wallet; rejects zero address and duplicates |
| `removeRegistrar(address)` | owner | Revokes a wallet's authorisation |
| `registerRecord(PropertyRecord)` | registrar | Requires non-zero record ID, property ID, document hash, non-empty CID, and a new record ID; sets `registeredAt = block.timestamp` |
| `revokeRecord(bytes32, string)` | registrar | Requires an existing, not-yet-revoked record; stores the flag and emits the reason |
| `getRecord(bytes32)` | anyone | Returns the record and revocation flag; reverts for unknown IDs |
| `recordExists(bytes32)` | anyone | Boolean existence check |

`Ownable` also provides `owner()`, `transferOwnership(address)`, and `renounceOwnership()`.

### Events

```solidity
event RegistrarAdded(address indexed registrar);
event RegistrarRemoved(address indexed registrar);
event RecordRegistered(
    bytes32 indexed recordId,
    bytes32 indexed propertyId,
    bytes32 indexed currentOwnerId,
    bytes32 previousRecordId,
    bytes32 documentHash,
    address registrar,
    uint256 registeredAt
);
event RecordRevoked(bytes32 indexed recordId, address indexed revokedBy, string reason);
```

### Revert messages

- `LandReg: not an authorized registrar`
- `LandReg: zero address`
- `LandReg: already authorized`
- `LandReg: not authorized`
- `LandReg: empty recordId`
- `LandReg: empty propertyId`
- `LandReg: empty documentHash`
- `LandReg: empty CID`
- `LandReg: record exists`
- `LandReg: record not found`
- `LandReg: already revoked`

### Roles

| Role | Held by | Can do |
|---|---|---|
| Contract owner | Deployer wallet | Add/remove registrars, transfer ownership |
| Registrar | Backend `ISSUER_PRIVATE_KEY` wallet | Register and revoke records |
| App admin | `users.role = 'admin'` | Sign in, register/revoke through the API, create users |
| App issuer | `users.role = 'issuer'` | Sign in, register/revoke through the API |

The app role and the chain role are separate. Every API user acts through the **single backend registrar wallet**; on-chain events identify that wallet, while `land_records.registered_by` records the app user who submitted the registration.

### Tests

`test/LandRegistry.test.js` covers registration of all 12 fields, timestamping, follow-up linking, duplicate rejection, unauthorized callers, and single revocation. The suite passes with four tests:

```bash
npx hardhat test
```

---

## Data Model

The authoritative schema is [`backend/supabase/schema.sql`](backend/supabase/schema.sql). It is safe to re-run.

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `email` | text | Unique, stored lowercase |
| `password_hash` | text | bcrypt, 12 rounds |
| `role` | text | `admin` or `issuer` |
| `wallet_address` | text | Informational; not used for signing |
| `organization_name` | text | Registration office |
| `active` | boolean | Checked at login |
| `created_at`, `updated_at` | timestamptz | `updated_at` maintained by trigger |

### `owners`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `owner_id` | text | `OWN-XXXXXXXX`, unique |
| `owner_hash` | char(66) | `keccak256(owner_id)`, unique; on-chain value |
| `full_name` | text | Private |
| `match_key` | text | Keyed hash of name + optional government ID; unique |
| `gov_id_hash` | char(64) | Keyed hash; null when no reference supplied |
| `created_at`, `updated_at` | timestamptz | `updated_at` maintained by trigger |

### `land_records`

The table mirrors the 12 on-chain fields and adds private details and bookkeeping.

| Group | Columns |
|---|---|
| Identifiers | `land_id`, `record_id`, `previous_record_id`, `previous_owner_id`, `current_owner_id` |
| On-chain mirror | `property_id`, `survey_number_hash`, `jurisdiction_code`, `land_details_hash`, `document_hash`, `metadata_hash`, `ipfs_cid`, `record_id_hash`, `previous_record_hash`, `previous_owner_hash`, `current_owner_hash`, `registered_at` |
| Private land details | `survey_number`, `subdivision_number`, `area`, `area_unit`, `boundary_north/south/east/west`, `village`, `taluk`, `district`, `state` |
| Document metadata | `document_type`, `registration_number`, `registration_date`, `sro_office` |
| Storage bookkeeping | `enc_iv`, `enc_tag`, `original_filename`, `tx_hash`, `qr_code_data`, `verify_url` |
| Lifecycle | `is_latest`, `status` (`active`/`revoked`), `revoked_tx_hash`, `revoked_at`, `revoke_reason`, `registered_by` |
| Timestamps | `created_at`, `updated_at` |

Constraints and indexes:

- `record_id`, `record_id_hash`, `document_hash` are unique.
- `previous_owner_id` and `current_owner_id` reference `owners(owner_id)`.
- `registered_by` references `users(id)`.
- Partial unique index allows only one `is_latest = true` row per `land_id`.
- Indexes on `land_id`, `survey_number`, `current_owner_id`, and `created_at desc`.
- `updated_at` triggers on all three tables.
- RLS is enabled on all three tables with no policies, so only the service-role key used by the backend can read or write them.

A legacy passport `certificates` table is intentionally left untouched and unused.

---

## API Reference

Base URL locally: `http://localhost:5000/api`. In production: same origin under `/api`.

All responses are JSON unless a PDF or PNG is returned. Errors use `{ "error": "message" }`, with `details` or payload fields where noted.

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | none | `{ email, password }` → `{ token, user }` |
| `POST` | `/auth/register` | Bearer, admin | Creates an app user (`issuer` by default) |
| `GET` | `/auth/me` | Bearer | Returns the current user |

Login errors are deliberately generic (`Invalid credentials`) and do not reveal whether an email exists.

### Registrar routes (`/land`, Bearer JWT)

| Method | Path | Description |
|---|---|---|
| `POST` | `/extract` | Multipart `deed` (PDF) → extracted fields. Returns `success: false` rather than failing when extraction is unusable |
| `POST` | `/preview` | JSON location/survey fields → Land ID, existence, record count, current head |
| `POST` | `/register` | Multipart `deed` + fields → encrypt, pin, anchor, mirror, QR |
| `GET` | `/` | List/search records; `page`, `limit` (max 100), `search`, `latestOnly=true` |
| `GET` | `/stats` | `{ records, parcels, transfers, revoked, owners }` |
| `GET` | `/records/:recordId` | Record plus full parcel history |
| `GET` | `/records/:recordId/document` | Decrypted PDF; sets `X-Document-Hash-Match` |
| `POST` | `/records/:recordId/revoke` | `{ reason }` → on-chain revoke and mirror update |

Registration response (`201`):

```json
{
  "success": true,
  "landId": "LAND-XXXXXXXXXX",
  "recordId": "REC-XXXXXXXX",
  "linked": true,
  "previousRecordId": "REC-YYYYYYYY",
  "previousOwnerId": "OWN-AAAAAAAA",
  "currentOwnerId": "OWN-BBBBBBBB",
  "txHash": "0x…",
  "ipfsCID": "bafy…",
  "documentHash": "0x…",
  "registeredAt": "2026-10-22T…",
  "verifyUrl": "http://localhost:3000/verify?landId=LAND-XXXXXXXXXX",
  "qrCode": "data:image/png;base64,…"
}
```

`POST /land/register` fields:

- Required: `state`, `district`, `surveyNumber`, `buyerName`.
- Optional: `taluk`, `village`, `subdivisionNumber`, `sellerName`, `sellerGovId`, `buyerGovId`, `area`, `areaUnit`, `boundaryNorth`, `boundarySouth`, `boundaryEast`, `boundaryWest`, `documentType`, `registrationNumber`, `registrationDate` (`YYYY-MM-DD`), `sroOffice`, `landIdOverride`.
- Unknown fields are stripped; invalid fields return `400` with `details`.
- `landIdOverride` must match `LAND-[0-9A-F]{10}` and already exist.

### Public routes (`/verify`, no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/land/:landId` | Parcel summary, timeline, per-record chain integrity |
| `GET` | `/land/:landId/document` | Decrypted deed of the current record, or `?record=REC-XXXXXXXX`; policy-gated |
| `POST` | `/land/:landId/document` | Multipart `deed` → SHA-256 comparison against registered versions |
| `GET` | `/land/:landId/qr` | QR PNG; `?download=1` returns an attachment |

Timeline response shape:

```json
{
  "found": true,
  "landId": "LAND-XXXXXXXXXX",
  "jurisdictionCode": "TN-CHENNAI-GUINDY",
  "location": { "village": "…", "taluk": "…", "district": "…", "state": "…" },
  "currentOwnerId": "OWN-BBBBBBBB",
  "currentRecordId": "REC-XXXXXXXX",
  "status": "active",
  "recordCount": 2,
  "allOnChain": true,
  "contractAddress": "0x…",
  "records": [
    {
      "recordId": "REC-XXXXXXXX",
      "previousRecordId": "REC-YYYYYYYY",
      "currentOwnerId": "OWN-BBBBBBBB",
      "previousOwnerId": "OWN-AAAAAAAA",
      "documentType": "Sale Deed",
      "registrationDate": "2026-01-15",
      "registeredAt": "…",
      "txHash": "0x…",
      "ipfsCID": "bafy…",
      "documentHash": "0x…",
      "isLatest": true,
      "status": "active",
      "integrity": {
        "onChain": true,
        "documentHashMatch": true,
        "propertyIdMatch": true,
        "statusMatch": true
      }
    }
  ],
  "disclaimer": "…"
}
```

`allOnChain` is true only when every record passes all three comparisons. If an RPC read fails, that record's `integrity.onChain` is `null` and the error is reported; it is never treated as valid.

Document viewing:

- Default policy `registrar`: requires any valid bearer token issued by this backend.
- `VIEW_DOCUMENT_POLICY=public`: anyone with the Land ID can open the deed.
- The API serves plaintext only after the record is confirmed on-chain and its document hash matches.
- Response headers include `X-Record-Id`, `X-IPFS-CID`, `X-IPFS-Source`, and `X-Document-Hash-Match`.
- A record's revocation does not by itself block viewing; the chain confirmation and hash match do.

PDF comparison response:

```json
{
  "match": true,
  "uploadedHash": "0x…",
  "landId": "LAND-XXXXXXXXXX",
  "isLatest": true,
  "record": { "…": "…" },
  "verdict": "Matches the current registered version for this land.",
  "disclaimer": "…"
}
```

Verdicts include: no registered match; match under a different Land ID; database match but unconfirmed on-chain; match to a revoked version; match to a non-current version; match to the current version. The uploaded file is hashed in memory and is not stored.

### Status codes

| Code | Meaning |
|---|---|
| `400` | Invalid field, malformed Land/Record ID, non-PDF, or invalid PDF magic bytes |
| `401` | Missing/expired JWT, or deed viewing requires sign-in |
| `403` | Admin-only route called by an issuer |
| `404` | Unknown Land ID, record, or override target |
| `409` | Duplicate PDF, already-revoked record, or record not confirmed on-chain for viewing |
| `413` | Upload exceeds the configured cap |
| `500` | Database or unexpected server error |
| `502` | IPFS/Pinata or gateway failure, or decryption failure during document retrieval |

### Example requests

```bash
# Health
curl -s http://localhost:5000/api/health

# Login
TOKEN=$(curl -s http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"your-password"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# Register a deed
curl -s http://localhost:5000/api/land/register \
  -H "Authorization: Bearer $TOKEN" \
  -F deed=@deed.pdf \
  -F state="Tamil Nadu" \
  -F district="Chennai" \
  -F taluk="Guindy" \
  -F village="Velachery" \
  -F surveyNumber="123/4" \
  -F subdivisionNumber="A" \
  -F buyerName="Buyer Name" \
  -F sellerName="Seller Name"

# Public verification
curl -s http://localhost:5000/api/verify/land/LAND-XXXXXXXXXX
```

---

## Frontend

The SPA is a Create React App project in `frontend/`.

### Routes

| Route | Access | Page |
|---|---|---|
| `/login` | Public | Email/password sign-in |
| `/verify` | Public | Land ID verification, timeline, PDF comparison, QR |
| `/` | Signed in | Dashboard: five stat cards, five recent records, quick actions |
| `/register` | Signed in | Upload, AI extraction, review, register, result |
| `/records` | Signed in | Search, current-only filter, pagination, deed/QR/revoke actions |

`PrivateRoute` validates the stored token with `/auth/me` before rendering a protected page. The shared axios client clears the session and redirects to `/login` on `401`; the public deed fetch deliberately bypasses that interceptor so it can show an inline sign-in message instead.

### Registrar workflow

1. Drop a PDF (maximum 15 MB in the browser).
2. The API extracts fields and returns them; the form shows a notice that every value must be reviewed.
3. A debounced preview (450 ms) shows the derived Land ID, whether the parcel exists, its record count, and the current owner. Entering a Land ID override switches the preview to that parcel.
4. On submit, the UI cycles through encryption, pinning, chain write, and save/QR steps.
5. The result screen shows the Land ID, record ID, owner IDs, transaction link, document hash, CID, registration time, QR download, and a link to the verify page.

### Records table

Search covers Land ID, record ID, survey number, village, district, registration number, and owner name. The table can be limited to current records. Actions:

- **Verify** opens the public timeline.
- **Deed** decrypts and opens the PDF in a new tab; if `X-Document-Hash-Match: false`, the UI warns.
- **QR** downloads the labelled PNG.
- **Revoke** prompts for a reason, which is recorded on-chain and in the database.

### Verifier workflow

- Enter a Land ID or scan a QR (the page auto-verifies when `?landId=` is present).
- See the status banner, location summary, current owner/record IDs, jurisdiction, record count, and chain confirmation.
- Browse the timeline newest-first with owner transfer, document metadata, transaction links, chain-integrity pills, revocation details, and expandable proof hashes.
- View an original deed if authorised; errors distinguish sign-in required, unconfirmed record, and missing record.
- Drop a PDF to compare its hash with every registered version.
- Download or display the parcel QR.

The token and user profile are stored in `sessionStorage`, not `localStorage`. There is no refresh-token flow; the user signs in again after expiry.

---

## Guided Walkthrough

The SPA ships with a built-in, zero-dependency product tour. On a first visit the app asks whether to take it; skipping fills in the demo sign-in so the visitor lands straight on the registry.

All of it lives in one folder — `frontend/src/components/tour/`:

| File | Role |
|---|---|
| `TourProvider.js` | The engine: step state, routing, persistence, the sign-in gate, keyboard control |
| `Spotlight.js` | The dimming overlay with a cut-out hole over the element under discussion |
| `TourTooltip.js` | The step card: title, copy, progress, Previous/Next/Skip, focus trap |
| `TourWelcome.js` | The first-visit prompt: take the walkthrough, or skip |
| `TourLauncher.js` | The entry points: sidebar button, inline `?`, floating chip |
| `tourSteps.json` | The 39-step catalogue — id, group, route, anchor, placement, copy |
| `tourSteps.js` | Loads the catalogue and attaches the behaviour hooks |
| `demoCredentials.js` | The demo sign-in used by the skip path |
| `tour.css` | The overlay, card, welcome and launcher styles |

### How it works

- **39 steps** across five surfaces: sign-in (4), dashboard (7), register a deed (9), records (9), public verification (10).
- **A spotlight, not a screenshot.** One fixed rectangle is moved onto the anchor element and darkened with an oversized `box-shadow`. The hole is `pointer-events: none`, so the page underneath stays usable.
- **Nothing blinks.** The hole travels from one element to the next instead of fading out and back in: it holds position while the page navigates and scrolls, then glides to the new anchor over 480 ms. The card never disappears either — its copy rises into place and the card glides after the hole. One easing curve (`--tour-ease`) governs every movement.
- **The last step is the deed.** Step 39 opens the registered document: the encrypted file is fetched from IPFS, decrypted on the server, and its hash compared with the one recorded on the blockchain. Leaving the tour — Finish, Skip or Esc — closes it again.
- **The anchor is the contract.** Each step names a CSS selector; the engine waits for that element to exist and to have a non-zero size before it shows the card. The `resize` and `scroll` listeners keep the hole glued while the page moves.
- **Read-only by construction.** Nothing in the tour registers a deed, revokes a record, or writes to the chain. The register steps drive a read-only preview of the form, and the receipt step renders from a parcel that already exists.
- **The sign-in gate.** The four opening steps are public. When the tour reaches the registrar side it shows a "Sign in to continue" card rather than filtering steps out, so nothing is skipped and there is no redirect loop. Signing in resumes the tour at the step it paused on.
- **Resumable.** The current position and the walkthrough/skipped decision are kept in `localStorage` under `nosih.tour.position` and `nosih.tour.decision`. The sidebar launcher shows "Resume tour (step N of 39)" and the walkthrough can be restarted at any time.
- **Accessible.** The card is a `role="dialog" aria-modal="true"` with a focus trap, an `aria-live` announcer, and full keyboard control (`←`/`→`, `Enter`, `Esc`). `prefers-reduced-motion` disables every transition.

### Running it

| Entry point | Effect |
|---|---|
| First visit | Prompts: "Take the walkthrough?" or "Skip" |
| Skip | Fills the demo credentials and signs in |
| Sidebar button | Take a tour, or resume from the saved step |
| `?` on any page | Inline launcher for that surface |
| `?tour=1` | Starts the tour at step 1 |
| `?tour=records` | Starts at the first step of that group |

`?tour=<group>` accepts `login`, `dashboard`, `register`, `records` and `verify`.

### Checking the catalogue

```bash
npm run check:tour
```

This is the check that catches rot, because a CSS selector is just a string — renaming a class in the markup would otherwise break a step silently. It verifies that the catalogue is well formed, that every route exists in `App.js` and that its auth flag matches, that the sign-in gate sits at the login boundary, and that **every class and attribute used by every anchor still exists in the rendered markup**. It also checks the fixture parcel against the live verify API so the copy cannot drift from the registry.

```
PASS  every step is well formed — 39 steps checked
PASS  routes exist and match the auth flag — 6 routes declared in App.js
PASS  the sign-in gate sits at the login boundary — 4 public intro steps, gate before "dashboard-headline"
PASS  every anchor token exists in the markup — 39 anchors checked
PASS  live verify API agrees with the catalogue — 1 records, on-chain=true
```

Flags: `--live` makes an unreachable API fatal, `--base <url>` points at another API, `--drive` enables the optional browser tier.

### Demo credentials

`frontend/src/components/tour/demoCredentials.js` holds the demo registrar sign-in so the skip path can fill it in. **Those values are in the public bundle.** That is acceptable for a demo and unacceptable for a real registry — replace the file with an empty object, or remove it and the skip path with it, before this goes anywhere real.

---

## QR Codes

Each QR encodes:

```
<base>/verify?landId=LAND-XXXXXXXXXX
```

- The API generates a 480 px QR (error correction level M) with an 84 px label containing the Land ID and `NOSIH Land Registry · scan to verify`.
- `POST /api/land/register` returns a data URL for immediate display/download.
- `GET /api/verify/land/:landId/qr` returns the PNG; `?download=1` adds an attachment filename.
- The base URL is derived from the incoming request (`x-forwarded-host`/`x-forwarded-proto`) in production, so QR codes follow the deployment or custom domain.
- Locally, `VERIFY_BASE_URL=http://localhost:3000/verify` is used when the request host is localhost.
- A localhost `VERIFY_BASE_URL` is ignored for non-local hosts, so production QRs still follow the deployment domain. Set it only for local development; a production value overrides host derivation.

---

## Project Structure

```
NOSIH-secure/
├── contracts/
│   └── LandRegistry.sol            Contract: records, registrars, revocation
├── scripts/
│   ├── deploy.js                   Deploy and authorise the registrar
│   ├── addIssuer.js                Add an authorised registrar
│   ├── check-tour-steps.mjs        Verifies the walkthrough catalogue against the markup
│   ├── check-readme.mjs            Checks the README's fences and diagrams
│   └── format-readme-diagrams.mjs  Re-pads the README's box diagrams├── test/
│   └── LandRegistry.test.js        Four Hardhat tests
├── backend/
│   ├── server.js                   Express entrypoint, CORS, routes, health
│   ├── env.js                      Loads the root .env (cwd-independent)
│   ├── envCheck.js                 Startup audit of the boot-critical variables
│   ├── config.js                   Upload cap (15 MB local / 4 MB Vercel)
│   ├── supabase.js                 Service-role client, boot check, row mappers
│   ├── middleware/
│   │   └── auth.js                 JWT guard, admin-only guard
│   ├── routes/
│   │   ├── auth.js                 Login, admin user creation, current user
│   │   ├── land.js                 Registrar API
│   │   └── verify.js               Public verification API
│   ├── services/
│   │   ├── ai.js                   Gemini text/vision extraction
│   │   ├── blockchain.js           ethers contract reads and writes
│   │   ├── ipfs.js                 Pinata upload, multi-gateway fetch
│   │   ├── landIdentity.js         Normalisation, hashing, encryption, IDs
│   │   └── qr.js                   Verify URL and labelled QR PNG
│   ├── scripts/
│   │   ├── seedAdmin.js            Create or reset the admin user
│   │   ├── checkPdfRender.js       Proves both PDF.js paths work (the deploy check)
│   │   └── makeScannedDeed.js      Builds a scanned-style deed PDF for testing
│   └── supabase/
│       └── schema.sql              Tables, constraints, indexes, triggers, RLS
├── frontend/
│   ├── src/
│   │   ├── App.js                  Routes and protected-route guard
│   │   ├── components/
│   │   │   ├── Layout.js           Sidebar, user info, sign out
│   │   │   ├── ErrorBoundary.js    Renders a readable message instead of a blank page
│   │   │   └── tour/              The guided walkthrough (one folder, zero dependencies)
│   │   ├── pages/
│   │   │   ├── LoginPage.js
│   │   │   ├── DashboardPage.js
│   │   │   ├── RegisterPage.js
│   │   │   ├── RecordsPage.js
│   │   │   ├── VerifyPage.js
│   │   │   └── styles.css          Full design system and page styles
│   │   ├── utils/
│   │   │   └── api.js              Axios client and API helpers
│   │   └── assets/
│   │       └── nosih-logo.png
│   ├── env.example                  REACT_APP_* template (build-time only)
│   └── package.json                CRA, proxy to localhost:5000
├── .env                            The one env file (not committed)
├── .env.example                    Template for every key in the project
├── hardhat.config.js               Solidity 0.8.20, Amoy and Polygon networks
├── vercel.json                     Two services, one domain
├── package.json                    Hardhat scripts and contract dependencies
└── README.md
```

---

## Tech Stack

### What is used, and why

| Area | Technology | Why this one |
|---|---|---|
| Contract | **Solidity 0.8.20**, OpenZeppelin Contracts 5 | 0.8.x gives checked arithmetic by default; OpenZeppelin's `Ownable` supplies the registrar allowlist without hand-rolling access control |
| Contract tooling | **Hardhat 2**, `@nomic-foundation/hardhat-toolbox` | Same toolchain compiles, tests and deploys; `chainId 80002` is pinned for Amoy |
| Chain client | **ethers v6** | Native BigInt, a first-class `Provider`/`Signer` split, and a minimal ABI so only the five functions the backend calls are exposed |
| Chain | **Polygon Amoy** (chain ID 80002) | A real EVM testnet with cheap gas, so the whole anchoring path is exercised for real — not mocked |
| API runtime | **Node.js 22**, **Express 4** | One file that runs as a local server *and* as a Vercel function; Express is what Vercel's zero-config runtime expects |
| API body | **Multer** (memory storage) | Deeds are hashed, encrypted and pinned in memory; there is no reason to write plaintext to disk |
| Validation | **Joi** | Schema-based validation with `stripUnknown`, so unknown fields cannot ride along into a hash |
| Passwords | **bcryptjs** | 12 rounds, no native build step — so the same code runs on Vercel without a compilation step |
| Sessions | **jsonwebtoken** | Stateless: the registrar session survives a function restart, which matters on a serverless platform |
| Database | **Supabase Postgres** (service role) | A real relational database with constraints — the partial unique index that enforces "one head per parcel" is a Postgres feature that Postgres-less stores cannot offer |
| Database safety | **RLS enabled, no policies** | Defence in depth: even if the publishable key leaks, no table is readable without the service-role key |
| Storage | **Pinata IPFS** (v3 uploads, legacy fallback) | Content addressing gives a CID that is a hash of the bytes; the fallback path means a scoped key the v3 gateway rejects still works |
| Fetch resilience | **multi-gateway race** (`Promise.any`) | The configured gateway plus four public ones are raced at once, so a single gateway outage must not make the registry unverifiable |
| Document crypto | **AES-256-GCM** | Authenticated encryption: tampering with the ciphertext fails the tag check, not silently |
| Hashing | **SHA-256**, **HMAC-SHA256**, **keccak256** | SHA-256 for recomputable fingerprints, HMAC for the enumerable ones, keccak256 for on-chain identifiers |
| AI | **Google Gemini** (`@google/generative-ai`) | One model serves both the text-layer and the vision path; `thinkingBudget: 0` keeps extraction fast and predictable |
| PDF | **pdf-parse** (text), **pdf-to-png-converter** + **sharp** (vision) | Text extraction is exact; scanned pages are rendered and downscaled to 1600 px JPEG before upload, which keeps the request small |
| QR | **qrcode** + **sharp** compositing | The QR and its printed label are composed into one PNG, so the Land ID is legible on paper without a second print step |
| Frontend | **React 18**, **Create React App 5** | CRA's static build output drops straight into Vercel's web service; no custom bundler configuration to keep in sync |
| Routing | **React Router 6** | A `PrivateRoute` wrapper validates the token against the API before any protected page renders |
| HTTP client | **axios** | Interceptors attach the JWT on every request and handle 401 globally, with a deliberate exception for the login call |
| File input | **react-dropzone** | The same component drives the registrar's deed upload and the public verifier's hash comparison |
| Icons | **Lucide React** | A single monochrome stroke weight across the whole interface |
| Hosting | **Vercel Services** | One project, two services, one domain — `/api/*` to Express and everything else to the static SPA |
| Database & pin tooling | **`@supabase/supabase-js`**, **axios**, **form-data** | The Supabase client's typed query builder; `form-data` streams the multipart upload to Pinata |
| Tooling | **13 `check:*` scripts + a smoke test** | Every known production failure has a script that reproduces it, so the failure cannot return unnoticed |

### Versions in use

```
Contract         Solidity 0.8.20  ·  OpenZeppelin 5  ·  Hardhat 2.19  ·  ethers 6
Chain            Polygon Amoy, chainId 80002
API              Node 22  ·  Express 4.18  ·  Joi 18  ·  Multer 1.4.5  ·  jsonwebtoken 9
Database         Supabase Postgres via @supabase/supabase-js 2.118
Storage          Pinata IPFS  ·  pdfjs-dist 5.4.296  (pinned, single version)
AI               @google/generative-ai 0.24  ·  gemini-3.6-flash
Frontend         React 18.2  ·  react-scripts 5.0.1  ·  react-router-dom 6.20
                 react-dropzone 14.2  ·  lucide-react 1.60  ·  axios 1.6
```

`pdfjs-dist` is pinned to **5.4.296** rather than a range, and `overrides` forces every
dependent to that same version. `pdf-parse` bundles its own PDF.js and refuses a
worker from a different version — "The API version 5.4.296 does not match the Worker
version 5.4.624" — so a second copy under `pdf-to-png-converter` is exactly what
caused the mismatch.

---

## Prerequisites

- Node.js 22 LTS (the packages declare `22.x`); npm 10+.
- A Supabase project and its service-role key.
- A Pinata account and JWT with upload/pin scopes (or API key + secret).
- A Polygon Amoy RPC URL (Alchemy or the public endpoint).
- A deployer wallet with test POL and a registrar wallet for the backend.
- A Gemini API key for automatic extraction (optional; manual entry still works).
- Optional: a Polygonscan API key for contract verification.

---

## Environment Variables

**One env file: `.env` in the repository root.** Every key the project reads lives there —
the Hardhat deployment keys and the backend runtime keys side by side, grouped by purpose.

The backend resolves that file from its own module location (`backend/env.js`), not from the
working directory, so `node backend/server.js`, `npm --prefix backend run dev` and
`npm run smoke:api` all read the same file no matter where you start them. On Vercel there
is no `.env` file — the platform injects the variables, so the same code path serves both
environments.

The frontend keeps one separate file, `frontend/.env.local`, because CRA inlines
`REACT_APP_*` values into the production bundle at build time.

### `.env` (repository root)

Boot-critical values are validated before the server listens.

| Variable | Required | Default / notes |
|---|---|---|
| `SUPABASE_URL` | Yes | The server reports it missing instead of starting |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service-role key; the publishable key cannot read the `users` table |
| `JWT_SECRET` | Yes | Random string used to sign session tokens |
| `JWT_EXPIRES_IN` | No | `8h` |
| `DOCUMENT_ENC_KEY` | Yes | Exactly 64 hex characters |
| `HASH_PEPPER` | Yes | Exactly 64 hex characters |
| `CONTRACT_ADDRESS` | For chain features | LandRegistry address |
| `ISSUER_PRIVATE_KEY` | For writes | Registrar wallet; `0x` optional |
| `ALCHEMY_AMOY_URL` | No | Falls back to `AMOY_RPC_URL`, then `https://rpc-amoy.polygon.technology` |
| `AMOY_RPC_URL` | No | Public Amoy RPC |
| `PINATA_JWT` | For uploads | Preferred Pinata credential |
| `PINATA_API_KEY`, `PINATA_API_SECRET` | Alternative | Used when `PINATA_JWT` is absent |
| `GEMINI_API_KEY` | For extraction | Without it, `/extract` reports an error and the form is manual |
| `GEMINI_MODEL` | No | `gemini-3.6-flash` |
| `VIEW_DOCUMENT_POLICY` | No | `registrar` (default) or `public` |
| `PORT` | No | `5000` |
| `FRONTEND_URL` | No | `http://localhost:3000`; comma-separated list accepted |
| `VERIFY_BASE_URL` | Local only | `http://localhost:3000/verify` |
| `IPFS_GATEWAY_BASE_URL` | No | Preferred gateway; falls back to Pinata, ipfs.io, dweb.link, w3s.link |
| `IPFS_FETCH_TIMEOUT_MS` | No | `15000` |
| `MAX_UPLOAD_MB` | No | `15` locally, `4` when `VERCEL` is set |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Seed only | Used by `npm run seed:admin` |
| `DATABASE_URL` | Admin scripts only | Direct Postgres; used by `npm run db:reset` |
| `DEPLOYER_PRIVATE_KEY` | For deploy | Contract owner; pays gas and is the only account that can add or remove registrars |
| `ISSUER_ADDRESS` | Recommended | Registrar wallet to authorise during deploy |
| `CHAIN_ID` | Informational | Printed by the deploy script; Hardhat networks are fixed at 80002/137 |
| `POLYGONSCAN_API_KEY` | Optional | Contract verification |
| `VERCEL` | Auto | Set by the platform; switches the upload default and listener behaviour |

Generate the two 32-byte secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Back up `DOCUMENT_ENC_KEY` and `HASH_PEPPER`.** Losing the encryption key makes every stored deed unreadable. Changing the pepper changes every Land ID, so new deeds stop linking to existing parcels and owner matching changes.

### `frontend/.env.local`

| Variable | Required | Purpose |
|---|---|---|
| `REACT_APP_API_URL` | No | Defaults to `/api`; set to `http://localhost:5000/api` for local dev if not using the CRA proxy |
| `REACT_APP_TX_EXPLORER_URL` | No | Defaults to `https://amoy.polygonscan.com/tx`; used for transaction links |

In production, same-origin `/api` is used and neither variable is required.

### Preflight checks

`scripts/` contains checks that verify an environment before you rely on it. Every check below is read-only with respect to the blockchain — none of them writes a land record or sends a transaction.

| Command | Checks |
|---|---|
| `npm run check:env` | Boot-critical secrets are present and correctly shaped; the registrar wallet is authorised on the deployed contract |
| `npm run check:runtime` | Amoy gas balance of the registrar wallet; seeded users |
| `npm run check:gas` | Balances, current gas price, and how many registrations each wallet covers (the cost comes from `eth_estimateGas`, which simulates rather than broadcasting) |
| `npm run check:services` | Gemini and Pinata credentials are accepted by the live APIs (includes a control request with a deliberately invalid key) |
| `npm run check:jwt` | Decodes a Pinata scoped JWT and validates it against Pinata's live API (also reads a commented-out `PINATA_JWT`, so a candidate token can be tested before enabling it) |
| `npm run check:ipfs` | Uploads a 1-byte file through the real `uploadToIPFS` service |
| `npm run smoke:api` | Logs in as the seeded admin and exercises the protected read endpoints |
| `npm run check:login` | Replays the exact browser login sequence (POST `/auth/login` then GET `/auth/me`) using `ADMIN_EMAIL`/`ADMIN_PASSWORD` from the root `.env`; pass a base URL to point it at a deployed host |
| `npm run check:boot` | Boots a second copy of the backend with a deliberately broken environment and proves it stays up and names the missing variables instead of crashing |
| `npm run check:ui-failure` | Serves the production build with an API that always fails, to confirm the UI shows a message rather than a blank page |
| `npm run vercel:env` | Uploads every variable the code reads from the root `.env` to the Vercel project (needs `vercel login`) |
| `npm run db:reset` | Drops every table in the `public` schema and re-applies `backend/supabase/schema.sql` — pass `--dry-run` to preview first |

```bash
npm run check:env && npm run check:services
```

---

## Setup from Scratch

### 1. Install dependencies

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

### 2. Create the database

1. Create a Supabase project.
2. Open the SQL Editor.
3. Paste and run [`backend/supabase/schema.sql`](backend/supabase/schema.sql). It is safe to re-run.
4. Copy the project URL and service-role key into the root `.env`.

To start from an empty database instead of applying the schema by hand, set `DATABASE_URL` in the root `.env` and run `npm run db:reset --dry-run` to preview, then `npm run db:reset`. It drops every table in the `public` schema and re-applies `schema.sql`.

### 3. Configure the backend

```bash
cp .env.example .env
```

Fill in Supabase, Polygon, Pinata, Gemini, JWT, encryption, and pepper values. Generate the two 64-hex secrets with the command above. Set `VERIFY_BASE_URL` for local QR codes.

### 4. Seed the admin user

```bash
cd backend
npm run seed:admin
```

The script creates the user if the email is new, or resets its password and restores `role = 'admin'`, `active = true` if it already exists. It requires `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the root `.env`.

### 5. Compile and test the contract

```bash
npx hardhat compile
npx hardhat test
```

### 6. Deploy to Amoy

Create the root `.env` from `.env.example` and set `DEPLOYER_PRIVATE_KEY`, `ALCHEMY_AMOY_URL`, and `ISSUER_ADDRESS` (or `ISSUER_PRIVATE_KEY`).

```bash
npx hardhat run scripts/deploy.js --network amoy
```

or:

```bash
npm run deploy:amoy
```

The script deploys `LandRegistry`, prints the address and chain ID, and authorises the registrar if an address is available. Copy the address into the root `.env` as `CONTRACT_ADDRESS`.

If the registrar was not authorised during deploy:

```bash
npx hardhat run scripts/addIssuer.js --network amoy
```

or:

```bash
npm run issuer:add
```

`addIssuer.js` is idempotent: it reports an already-authorised registrar and exits.

### 7. Run locally

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm start
```

Open `http://localhost:3000`, sign in with the admin credentials you seeded, and register a deed.

---

## Local Development

| Service | URL | Command |
|---|---|---|
| API | `http://localhost:5000/api` | `cd backend && npm run dev` |
| SPA | `http://localhost:3000` | `cd frontend && npm start` |
| Health | `http://localhost:5000/api/health` | `curl` |
| Public verify | `http://localhost:3000/verify?landId=…` | browser |

`npm start` in the frontend uses the CRA dev server. `package.json` proxies to `http://localhost:5000` when `REACT_APP_API_URL` is unset; the checked-in local env sets it explicitly.

Useful scripts:

| Location | Command | Action |
|---|---|---|
| root | `npm run compile` | Compile contracts |
| root | `npm run deploy:amoy` | Deploy to Amoy |
| root | `npm run issuer:add` | Authorise the registrar |
| backend | `npm start` | Run without nodemon |
| backend | `npm run dev` | Run with nodemon |
| backend | `npm run seed:admin` | Create/reset admin |
| frontend | `npm start` | Development server |
| frontend | `npm run build` | Production build |

---

## Testing

### Contract suite

```bash
npx hardhat test
```

Current result: **4 passing**. The tests cover:

1. Registering a record with all 12 fields and a block timestamp.
2. Linking a follow-up record without on-chain lookups.
3. Rejecting duplicate records and unauthorised callers.
4. Revoking once and rejecting a second revocation.

### Walkthrough catalogue

```bash
npm run check:tour
```

Current result: **PASS**. It proves the 39-step catalogue is well formed, that every route and auth flag matches `App.js`, that the sign-in gate sits at the login boundary, and that every class and attribute used by an anchor still exists in the rendered markup. See [Guided Walkthrough](#guided-walkthrough).

### README structure

```bash
npm run check:readme
```

Current result: **PASS**. It confirms that the code fences are balanced — an
unbalanced fence swallows the rest of the document — and that every box diagram has
its right border on a single column. A diagram that has drifted out of alignment
reads as broken, and markdown renders code blocks in a monospace font where that is
visible at a glance.

`npm run check:readme` only reports. `node scripts/format-readme-diagrams.mjs` is the
companion that re-pads the boxes, and it is idempotent — running it twice changes
nothing.

### Manual smoke checklist

1. `GET /api/health` returns `{ "status": "ok" }`.
2. Sign in at `/login`; a token appears in `sessionStorage`.
3. Dashboard loads stats and recent records.
4. `/register`: upload a PDF; fields are pre-filled or a manual-entry notice appears; the Land ID preview resolves.
   For a scanned deed with no text layer, `npm run check:pdf` must pass first — it is the same PDF.js path the deployment failed on.
5. Register the deed; the result shows a transaction hash, CID, and QR.
6. Open `/verify?landId=…`; the timeline shows an on-chain match for every record.
7. Upload the same PDF to the comparison dropzone; the verdict says it matches the current version.
8. Open the original deed as a signed-in registrar; the PDF loads.
9. Revoke the record with a reason; the timeline shows `REVOKED` and the revocation transaction.
10. Register a second deed for the same parcel (or use the override); it links to the previous record.

### Gaps

There is no automated backend test suite in this repository. The contract tests and the manual checklist are the current verification path. Add API integration tests before treating the backend as production-critical.

---

## Deploy to Vercel

The repository is a single Vercel project using **Services**. `vercel.json` declares:

- `web`: `frontend/`, CRA framework, build output `build/`, all routes rewritten to `index.html`.
- `api`: `backend/`, Express framework.
- Top-level rewrites: `/api/*` → the API service; everything else → the web service.

### The PDF.js worker

Deployed extraction of a scanned deed failed with `Setting up fake worker failed`. PDF.js imports its worker module with a bundler-ignore hint, so Vercel's file tracer never packaged it, and the function had no worker to start.

Two things fix it, and both are in the repository:

- **`backend/package.json` pins `pdfjs-dist` and overrides every dependent to that one version.** `pdf-parse` bundles its own copy of PDF.js and refuses a worker from a different version, so the versions have to match — a second copy of `pdfjs-dist` under `pdf-to-png-converter` is what caused the mismatch.
- **`backend/services/ai.js` imports the worker by name.** The import exists only so the tracer follows it and packages the file next to the PDF.js module that looks for it. The worker is never handed to PDF.js by hand, for the reason above.

`npm run check:pdf` proves both paths still work: it renders a page to an image and reads a text layer, and it fails with exit 1 if the worker file is missing.

```bash
npm run check:pdf
```

### Steps

1. Import the repository at [vercel.com/new](https://vercel.com/new). Keep the root directory as the repository root.
2. Add environment variables from the root `.env` in Project → Settings → Environment Variables:

   ```
   ALCHEMY_AMOY_URL
   CONTRACT_ADDRESS
   ISSUER_PRIVATE_KEY
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   PINATA_API_KEY
   PINATA_API_SECRET
   JWT_SECRET
   JWT_EXPIRES_IN
   DOCUMENT_ENC_KEY
   HASH_PEPPER
   GEMINI_API_KEY
   GEMINI_MODEL
   VIEW_DOCUMENT_POLICY
   ```

   Optional: `PINATA_JWT`, `AMOY_RPC_URL`, `IPFS_GATEWAY_BASE_URL`, `IPFS_FETCH_TIMEOUT_MS`, `MAX_UPLOAD_MB`, `FRONTEND_URL`, `REACT_APP_TX_EXPLORER_URL`.

   `PINATA_API_KEY` and `PINATA_API_SECRET` are the credentials that matter: the scoped key
   uploads through the legacy Pinata endpoint. Set `PINATA_JWT` only if it validates —
   the backend prefers the JWT whenever one is present, so an unusable token turns every
   deed upload into a 401. Check it with `npm run check:jwt` before deploying it.

   `REACT_APP_*` values are inlined at build time, so they must be set on the **web**
   service, not the API service. Neither is required here: the SPA calls same-origin
   `/api` and the transaction explorer defaults to the Amoy explorer.

3. Deploy. No frontend API URL or CORS configuration is needed for the single-domain setup.

   Instead of pasting every value into the dashboard, push the root `.env` to the
   project in one command:

   ```bash
   vercel login
   npm run vercel:env            # add --preview to cover preview deployments too
   vercel --prod
   ```

   The script reads the root `.env`, uploads only the variables the
   code actually reads, and rewrites `FRONTEND_URL` to the production domain when the
   local value points at `localhost`. Use `--dry-run` to preview the list first.

Production behaviour:

- The SPA calls same-origin `/api`.
- QR verify URLs derive from the request host, so custom domains work without changing `VERIFY_BASE_URL`.
- `MAX_UPLOAD_MB` defaults to `4` on Vercel.
- The frontend service rewrites unknown paths to `index.html`, so `/register`, `/records`, and `/verify?landId=…` survive refreshes.

### Vercel limits that matter

| Limit | Consequence |
|---|---|
| Request body 4.5 MB | The API caps uploads at 4 MB on Vercel and returns `413`; the browser dropzone still allows 15 MB, so large files can be rejected by the platform |
| Function duration 300 s (Fluid default) | Enough for AI extraction plus the chain write; slow PDFs may still approach the limit |
| Bundle size 250 MB uncompressed | Current dependencies fit |
| Read-only filesystem except `/tmp` | Extraction writes temporary files under `os.tmpdir()`; nothing persistent is written locally |
| Serverless cold starts | First request after idle is slower; IPFS and RPC calls dominate registration time |

`npm run seed:admin` should be run locally or in an environment with the same Supabase credentials, not as a deployment step. The database schema is applied separately in the Supabase SQL editor. `backend/.vercelignore` excludes `supabase/` and `scripts/` from the function bundle.

### Separate projects alternative

If Services is unavailable:

- Deploy `backend/` as an Express project.
- Deploy `frontend/` as a CRA project.
- Set `REACT_APP_API_URL=https://<backend-domain>/api` on the frontend.
- Set `FRONTEND_URL` and `VERIFY_BASE_URL` on the backend.

---

## Security Controls

| Area | Implementation |
|---|---|
| Password storage | bcrypt, 12 rounds; no plaintext passwords |
| Sessions | HS256 JWT, `JWT_EXPIRES_IN` (default 8h), stored in `sessionStorage`, attached as a bearer token |
| Authorisation | `protect` for registrar routes; `adminOnly` for user creation; contract registrar allowlist for writes |
| Account state | Login requires `active = true`; existing tokens remain valid until expiry if a user is later deactivated |
| Database exposure | Service-role key only on the server; RLS enabled with no policies on all tables |
| Secret validation | JWT, Supabase, encryption key, and pepper are checked at boot; the process exits on failure |
| Deed confidentiality | AES-256-GCM before pinning; IV and tag stored only in Postgres; CID exposes ciphertext |
| Enumerable identifiers | `propertyId` and `surveyNumberHash` use HMAC-SHA256 with a secret pepper, not plain hashes |
| Personal data | Names and government ID references never go on-chain; government IDs are stored only as keyed hashes |
| Upload validation | MIME check plus `%PDF-` magic bytes; memory storage; configurable size cap; PDF-only dropzone |
| Duplicate documents | SHA-256 `document_hash` unique in Postgres; pre-check returns `409` with the existing record |
| Integrity checks | Every public verification performs `recordExists` and `getRecord`; document hash, property ID, and revoked flag are compared |
| Deed serving | Policy-gated; only after on-chain confirmation and hash match; `Cache-Control: private, no-store` |
| Search safety | Special characters are stripped before building Supabase filter expressions |
| CORS | Explicit `FRONTEND_URL` allowlist plus localhost/127.0.0.1; no wildcard by default |
| Chain write safety | Contract checks non-zero IDs/hash, non-empty CID, and duplicate record IDs; registrar allowlist |
| Failure reporting | Partial registration returns `recordId` and `txHash`; the API logs chain-written/DB-failed cases distinctly |
| Revocation | Reason required and length-capped; on-chain event; mirror stores transaction, time, and reason |

Controls that are **not** present:

- Application-level rate limiting or brute-force lockout on `/auth/login`.
- Helmet/CSP or other security headers configured in Express.
- Refresh tokens, token revocation lists, or device/session management.
- Key rotation/versioning for `DOCUMENT_ENC_KEY` or `HASH_PEPPER`.
- Multi-signature or HSM custody for the registrar/owner wallets.
- Automatic reconciliation when a chain write succeeds but the database insert fails.

---

## Operations Runbook

### Key inventory

| Secret | Protects | If lost | Rotation |
|---|---|---|---|
| `DOCUMENT_ENC_KEY` | All deed plaintext | Stored deeds become unreadable | Requires re-encrypting every deed and updating IV/tag; no built-in versioning |
| `HASH_PEPPER` | Land IDs, survey/owner matching | New deeds stop linking; owner matching changes | Cannot be rotated without splitting historical identities; keep permanently |
| `JWT_SECRET` | App sessions | All users are signed out | Rotate in backend env; no other migration |
| `ISSUER_PRIVATE_KEY` | Chain writes | Cannot register/revoke | Add a new registrar with the owner key, update env, remove the old one |
| `DEPLOYER_PRIVATE_KEY` | Contract ownership | Cannot add/remove registrars, but existing registrars still write | Transfer ownership to a new owner wallet beforehand |
| Supabase service-role key | Full database access | Backend cannot read/write | Rotate in Supabase and update env |
| Pinata JWT/keys | Pinning and fetching | Registration and deed viewing fail | Rotate in Pinata and update env |
| Gemini API key | Extraction only | Manual form entry still works | Rotate in Google AI Studio |

Store the encryption key and pepper in a password manager or secret manager, separate from the repository and the Supabase backup. Losing either is not recoverable from the chain.

### Registrar management

- The contract owner adds/removes registrars with `addRegistrar`/`removeRegistrar`.
- The backend signs every write with one wallet. Rotating that wallet requires an on-chain change and an env update; app users are unaffected.
- Keep the registrar wallet funded with a small amount of POL. Do not use the owner wallet as the day-to-day hot wallet.
- On-chain events identify the registrar wallet, not the app user. `land_records.registered_by` is the only app-user attribution.

### Blank page or `FUNCTION_INVOCATION_FAILED` on Vercel

Check `https://<your-domain>/api/health` first. It answers even when the deployment is
broken and reports what is wrong:

```json
{ "status": "degraded", "config": { "ok": false, "problems": [ { "name": "JWT_SECRET", "reason": "not set", "hint": "…" } ] } }
```

A `200` with `"status": "ok"` means the function is healthy and the problem is in the
browser or the routing. A `503` means the environment is incomplete — push the local
env files with `npm run vercel:env` and redeploy.

`FUNCTION_INVOCATION_FAILED` on every route means the function crashed before it could
answer. The backend used to exit at import time when a variable was missing, which
Vercel reported as exactly that, with no hint about the cause. It no longer exits: a
missing variable is reported over HTTP, and the native modules (`sharp`,
`pdf-to-png-converter`) are loaded on first use so a platform-level binary problem
cannot take the whole function down.

A blank white page after signing in has a second cause worth knowing about. A platform
error is shaped `{ "error": { "code": "…", "message": "…" } }`, not `{ "error": "…" }`.
The old frontend put that object straight into React state, React threw error #31 and
unmounted the whole tree, and the user saw an empty page. Every error now goes through
`apiErrorMessage()` in `frontend/src/utils/api.js`, and a renderer error boundary wraps
the app, so a failure shows a message instead of a blank screen.

### Sign-in troubleshooting

If "Sign In" appears to do nothing, the password in the root `.env` is not the one stored for the user. `ADMIN_PASSWORD` is only a seed input — the live password lives as a bcrypt hash in the `users` table, so editing the env file alone changes nothing until you re-seed:

```bash
npm run seed:admin --prefix backend
npm run check:login
```

`check:login` replays the browser sequence (`POST /auth/login` then `GET /auth/me`) and prints the status of each step, so it distinguishes "the password is wrong" from "the session token is rejected".

A wrong password now renders `Invalid credentials` inline on the form. Earlier builds bounced the page back to `/login` on any 401, which cleared the message before it could be read and made a rejected sign-in look like a button that does nothing.

### Partial-failure reconciliation

If registration returns `Recorded on-chain but database save failed`:

1. Capture `recordId` and `txHash` from the error payload and server logs.
2. Confirm the transaction and record with `getRecord(keccak256(recordId))`.
3. Do not re-register the same PDF; the chain record and encrypted pin already exist.
4. Reconcile the database row manually or add an idempotent recovery endpoint.
5. If a head was demoted and the insert failed, the API restores the old head flag; verify that the parcel still has exactly one `is_latest` row.

Failed chain writes can leave an orphaned encrypted pin. It contains only ciphertext, but it still consumes Pinata storage. Unpin it if the registration is abandoned.

### Monitoring checklist

- API health endpoint and error rate.
- Supabase availability and storage growth.
- Registrar wallet POL balance.
- Pinata pin failures and gateway latency.
- RPC latency and chain-read failures on the verify page.
- `allOnChain: false` responses, which indicate database/chain drift.
- Vercel function duration and 413 responses.

### Backups

- Supabase: enable point-in-time recovery or scheduled backups.
- Pinata: pins are content-addressed; keep the CID and encryption key. A database backup without the key cannot decrypt deeds.
- Contract: records are immutable, but back up the deployment address, ABI, and owner/registrar addresses.
- Environment: store secrets in a secret manager, not only in the root `.env` file.

---

## Known Limitations

- **Trusted registrar and backend.** The contract accepts `previousRecordId` and `previousOwnerId` from the authorised registrar without validating the chain. The off-chain linking logic is trusted.
- **Trusted database for history.** Public verification checks each record against the chain, but the list of records, the current head, and names/metadata come from Supabase. A database compromise can hide records or alter private fields; hashes and on-chain records expose tampering only when checked.
- **Hash match is not legal proof.** It proves that a PDF matches a registered version. It does not prove title, execution validity, or that the registrar had authority.
- **Single hot wallet.** All registrar writes share one key. Compromise allows arbitrary registrations and revocations until the owner removes the wallet.
- **No key rotation.** Encryption and pepper keys are fixed. Changing them breaks access or linking.
- **Owner name collisions.** With no government ID reference, the owner match key is based only on the normalised name, so namesakes share an owner identity.
- **Revocation does not erase data.** Revoked deeds remain fetchable when policy allows; the status is public.
- **Coarse location is public.** Village, taluk, district, state, document type, registration date, and SRO office are exposed by the verifier. Do not use this for confidential locations.
- **No app-level rate limiting or security headers.** Login brute-force protection and CSP/Helmet are left to the hosting platform or a reverse proxy.
- **Session model.** Tokens live in `sessionStorage`, are bearer-only, and cannot be revoked before expiry. Deactivating a user does not invalidate an existing token.
- **Backend test gap.** There is no automated API or end-to-end test suite.
- **Upload cap mismatch.** The browser accepts up to 15 MB, but Vercel rejects bodies over 4.5 MB and the API caps at 4 MB on Vercel.
- **Long timelines cost RPC reads.** Verification performs two reads per record; very long histories can be slow.
- **IPFS availability.** Deed viewing depends on Pinata or a public gateway serving the CID; content addressing does not guarantee availability.
- **Non-upgradeable contract.** A bug requires a new deployment and migration; there is no proxy or pause mechanism.
- **Orphaned pins.** A failed chain write can leave an encrypted pin with no record.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend exits with `FATAL: JWT_SECRET environment variable is not set` | Missing JWT secret | Set `JWT_SECRET` in the root `.env` |
| Backend exits with `DOCUMENT_ENC_KEY must be set … 64 hex characters` | Missing or malformed key | Generate 32 random bytes as hex and set it |
| Backend exits with `FATAL: Supabase connection check failed` | Wrong URL/key or missing schema | Run `backend/supabase/schema.sql`; verify project URL and service-role key |
| Warning `land_records table not reachable` | Schema not applied | Run the SQL schema; auth still works but land routes will fail |
| `Could not find the table 'public.land_records'` | Schema missing | Run `schema.sql` in the SQL editor |
| Login returns `Invalid credentials` | Wrong password, inactive user, or different email case | Re-run `npm run seed:admin` to reset the admin; check `active` |
| `403 Admin access required` | Issuer tried to create a user | Use an admin account |
| `401 No token provided` or `Invalid or expired token` | Missing/expired JWT | Sign in again |
| `not an authorized registrar` revert | Backend wallet not on the contract allowlist | Run `scripts/addIssuer.js` for the `ISSUER_PRIVATE_KEY` wallet |
| `409 This exact deed PDF is already registered` | SHA-256 duplicate | Use the existing record or a genuinely different deed |
| Registration fails at `Pinata authentication/permission failed` | Bad/expired Pinata JWT or missing scopes | Regenerate a JWT with upload/pin scopes |
| `Cannot parse UUID parameter: "<key>"` | Pinata v3 uploads endpoint requires a UUID-format key; a scoped key must use the legacy endpoint | The backend skips v3 for scoped keys automatically — if you see this in a log, the upload fell back to legacy |
| `NO_SCOPES_FOUND` from Pinata | The API key authenticates but has no upload scope attached | In the Pinata console, give the key the `pinFileToIPFS` scope |
| `API_KEY_REVOKED` from Pinata | The key was revoked when a replacement was created | Use the current key and secret from the console |
| `Pinata key has no upload scopes` | Key lacks v3 upload permission | Create a key with the required scopes or use a legacy key pair |
| Extraction returns `success: false` | Scanned/blank PDF or Gemini failure | Fill the form manually; check `GEMINI_API_KEY` |
| Extraction is slow | Scanned PDF falls back to vision | Expect roughly 30 seconds; the UI allows up to 90 seconds |
| `413 File is too large` | Upload exceeds the cap | Compress the PDF; on Vercel keep it under 4 MB |
| Deed opens with a hash-mismatch warning | IPFS bytes, IV/tag, or database hash disagree | Investigate the CID and database row; do not trust the document |
| `Unable to fetch CID … from IPFS gateways` | All gateways timed out or the CID is unpinned | Set a working `IPFS_GATEWAY_BASE_URL`, raise `IPFS_FETCH_TIMEOUT_MS`, check Pinata |
| Verify page says `Chain unreachable` | RPC/network failure | Check `ALCHEMY_AMOY_URL` and Amoy status |
| Verify page says `On-chain mismatch` | Database mirror and chain disagree | Compare `getRecord` output with the row; do not treat the record as valid |
| QR points to localhost in production | `VERIFY_BASE_URL` is set to localhost | Remove it or set the production URL; production otherwise derives the host |
| New deed does not link to the parcel | Location/survey normalisation produced a different Land ID | Use the Land ID override field |
| CORS error in the browser | Origin not in `FRONTEND_URL` | Add the exact origin (comma-separated) or use localhost |
| `Duplicate key value violates unique constraint` on register | Concurrent duplicate PDF or record ID collision | Re-check the existing record; retry only if the IDs differ |
| `Recorded on-chain but database save failed` | Chain write succeeded, insert failed | Reconcile using the returned `recordId` and `txHash`; do not re-register blindly |

---

## Disclaimer

A matching hash confirms that a document matches a version registered on the NOSIH ledger. It does not independently prove legal ownership or the authenticity of the underlying transaction. This project is a testnet-oriented registry implementation, not a substitute for a legally authoritative land records system.

The contract is licensed under MIT via its SPDX identifier. No repository-wide license file is included.
