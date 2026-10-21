# NOSIH — Land Deed Registry

> Register land deeds (PDF) on Polygon, store them **encrypted** on IPFS, keep personal details in access-controlled Supabase, and let anyone verify a parcel's ownership chain from a QR code showing its Land ID.

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [On-chain Record (12 fields)](#on-chain-record-12-fields)
- [Privacy Model](#privacy-model)
- [Linking & Ownership Chain](#linking--ownership-chain)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Install & Database](#install--database)
- [Smart Contract](#smart-contract)
- [Run Locally](#run-locally)
- [Deploy to Vercel](#deploy-to-vercel)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

---

## Overview

| Capability | Who | Where |
|---|---|---|
| Register a deed (PDF only, AI auto-fill) | Registrar (logged in) | `/register` |
| Browse / search records, open decrypted deed, download QR, revoke | Registrar | `/records` |
| Dashboard stats (parcels, records, transfers, revoked) | Registrar | `/` |
| Verify a Land ID, view ownership timeline, check a PDF against the registry | Public | `/verify?landId=LAND-…` |

> **Disclaimer:** a matching hash confirms that a document matches a registered version. It does **not** independently prove legal ownership or document authenticity.

---

## How It Works

```
 Registrar uploads deed PDF
          │
          ▼
 Gemini extracts parties, survey no., location, boundaries, registration info
          │   (registrar reviews / edits)
          ▼
 Land ID derived:  LAND- + first 10 hex of HMAC(pepper, state|district|taluk|survey|subdivision)
          │
          ├── Existing head record in Supabase?  → link to it (previous record / owner)
          │                                        — resolved off-chain, no blockchain read
          ▼
 PDF  ──AES-256-GCM──▶ ciphertext ──▶ IPFS (Pinata)  →  CID
          │
          ▼
 LandRegistry.registerRecord(12 fields)  on Polygon Amoy  →  RecordRegistered event
          │
          ▼
 Supabase: owners + land_records row (private details, IV/tag, tx hash, QR)
          │
          ▼
 QR PNG generated server-side, labelled with the Land ID → /verify?landId=…
```

Revocation calls `revokeRecord(recordId, reason)` (emits `RecordRevoked`). If the revoked record was the parcel's head, the previous active record becomes the head again.

---

## On-chain Record (12 fields)

Contract: `contracts/LandRegistry.sol` (Solidity 0.8.20). Only authorised registrars can write.

| Field | Type | Value |
|---|---|---|
| `propertyId` | bytes32 | HMAC-SHA256(pepper, normalised location + survey + subdivision) |
| `surveyNumberHash` | bytes32 | HMAC-SHA256(pepper, normalised survey number) |
| `jurisdictionCode` | bytes32 | `STATE-DISTRICT-TALUK` encoded as bytes32 |
| `landDetailsHash` | bytes32 | SHA-256 of canonical JSON of area, boundaries, village… |
| `documentHash` | bytes32 | SHA-256 of the original (unencrypted) PDF |
| `metadataHash` | bytes32 | SHA-256 of canonical JSON of registration metadata |
| `ipfsCID` | string | CID of the **encrypted** PDF |
| `recordId` | bytes32 | keccak256(`REC-XXXXXXXX`) |
| `previousRecordId` | bytes32 | keccak256 of the previous record, or zero |
| `previousOwnerId` | bytes32 | keccak256(`OWN-XXXXXXXX`) of the seller, or zero |
| `currentOwnerId` | bytes32 | keccak256(`OWN-XXXXXXXX`) of the buyer |
| `registeredAt` | uint64 | block timestamp |

Functions: `addRegistrar`, `removeRegistrar` (owner only), `registerRecord`, `revokeRecord` (registrar only), `getRecord`, `recordExists`.
Events: `RegistrarAdded`, `RegistrarRemoved`, `RecordRegistered`, `RecordRevoked`.

---

## Privacy Model

- **Documents are encrypted** with AES-256-GCM (`DOCUMENT_ENC_KEY`) before upload. The public CID only exposes ciphertext.
- **No personal data on-chain**: names, government IDs, survey numbers and boundaries live only in Supabase (RLS enabled, service-role access from the backend only).
- **Owner registry IDs** (`OWN-XXXXXXXX`) are used instead of identities; on-chain only their keccak256 hash appears. Government IDs are stored as keyed hashes, never plaintext.
- Survey numbers and property IDs are **peppered HMACs**, so they cannot be brute-forced from the chain without `HASH_PEPPER`.
- The verify page can open the **current deed**, but only after the record is confirmed on-chain and only for signed-in registrars. Set `VIEW_DOCUMENT_POLICY=public` to serve it to anyone holding the Land ID (this makes deeds public).
- Uploads are restricted to PDFs (MIME + `%PDF-` magic bytes, max 15 MB). Identical PDFs are rejected (`documentHash` unique).

---

## Linking & Ownership Chain

- Each parcel has one **head** record (`is_latest = true`, enforced by a partial unique index).
- When a new deed resolves to an existing Land ID, it is linked automatically: `previousRecordId` = head, `previousOwnerId` = head's current owner. Lookup is done in Supabase — no extra blockchain calls.
- If the extracted location doesn't produce the same Land ID (e.g. spelling differences), the registrar can enter a **Land ID override** on the register form to force linking to that parcel.
- The verify page shows the full timeline, newest first, and checks each record against the contract.

---

## Project Structure

```
contracts/LandRegistry.sol        Smart contract
scripts/deploy.js, addIssuer.js   Deploy + authorise registrar
backend/
  server.js                       Express app (/api/auth, /api/land, /api/verify)
  supabase.js                     Client + row mappers
  supabase/schema.sql             users, owners, land_records
  routes/land.js                  Registrar API (JWT)
  routes/verify.js                Public verification API
  services/ai.js                  Gemini deed extraction
  services/landIdentity.js        Hashing, Land ID, AES-GCM encryption
  services/blockchain.js          Contract calls
  services/ipfs.js                Pinata upload
  services/qr.js                  Labelled QR generation
frontend/src/pages/               Dashboard, Register, Records, Verify, Login
```

---

## Prerequisites

- Node.js 20+, npm 10+
- Supabase project, Pinata JWT, Alchemy Amoy RPC URL, Gemini API key
- Registrar wallet with Amoy test POL

---

## Environment Setup

### Root `.env` (Hardhat)

```env
ALCHEMY_AMOY_URL=https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY
DEPLOYER_PRIVATE_KEY=YOUR_DEPLOYER_KEY_WITHOUT_0x
ISSUER_ADDRESS=0xRegistrarWalletAddress
CONTRACT_ADDRESS=0xYourLandRegistryAddress
CHAIN_ID=80002
```

### `backend/.env`

Copy `backend/env.example`. Key values:

| Variable | Purpose |
|---|---|
| `CONTRACT_ADDRESS` | Deployed LandRegistry |
| `ISSUER_PRIVATE_KEY` | Registrar wallet that signs register/revoke |
| `DOCUMENT_ENC_KEY` | 64 hex chars — AES key for deeds |
| `HASH_PEPPER` | 64 hex chars — pepper for Land IDs / survey hashes |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Database |
| `PINATA_JWT` | IPFS |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Extraction (`gemini-3.6-flash`) |
| `VERIFY_BASE_URL` | Encoded in QR codes |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Back up `DOCUMENT_ENC_KEY` and `HASH_PEPPER`.** Losing the encryption key makes every stored deed unreadable; changing the pepper changes every Land ID, so new deeds stop linking to existing parcels. The backend refuses to start if either is missing or malformed.

### `frontend/.env.local`

```env
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_TX_EXPLORER_URL=https://amoy.polygonscan.com/tx
```

---

## Install & Database

```bash
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

Open the Supabase **SQL Editor**, paste [`backend/supabase/schema.sql`](backend/supabase/schema.sql) and run it (safe to re-run). It creates `users`, `owners` and `land_records`.

Seed the admin user:

```bash
cd backend && npm run seed:admin
```

---

## Smart Contract

```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network amoy
npx hardhat run scripts/addIssuer.js --network amoy   # authorises ISSUER_ADDRESS as registrar
```

Current Amoy deployment: `0xE5a941d9628A7d7Ab497636A204B627F29070952`.

---

## Run Locally

```bash
cd backend && npm run dev      # http://localhost:5000/api
cd frontend && npm start       # http://localhost:3000
```

Health check: `GET http://localhost:5000/api/health`.

---

## Deploy to Vercel

The repo is a single Vercel project using **Services** (beta, all plans): the React app and the Express API build together, share one domain, and route by path. No URLs or CORS to wire up.

```
https://<project>.vercel.app/          → frontend (React)
https://<project>.vercel.app/api/*     → backend (Express)
```

### Steps

1. **Import the repository** at [vercel.com/new](https://vercel.com/new). Leave the Root Directory as the repo root; `vercel.json` declares both services.
2. **Add environment variables** (Project → Settings → Environment Variables). Copy the values from your local `backend/.env`:

   ```
   ALCHEMY_AMOY_URL
   CONTRACT_ADDRESS
   CHAIN_ID
   ISSUER_PRIVATE_KEY
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   PINATA_JWT
   JWT_SECRET
   JWT_EXPIRES_IN
   DOCUMENT_ENC_KEY
   HASH_PEPPER
   GEMINI_API_KEY
   GEMINI_MODEL
   ```

   Optional: `PINATA_API_KEY`, `PINATA_API_SECRET`, `IPFS_GATEWAY_BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (seed only).
3. **Deploy.** That's it.

Nothing else is deployment-specific:

- `REACT_APP_API_URL` is not needed; the frontend calls same-origin `/api`.
- `VERIFY_BASE_URL` is only used locally. In production the QR verify URL is derived from the incoming request, so QR codes always point at the deployment domain (including custom domains).
- `MAX_UPLOAD_MB` defaults to 4 when `VERCEL` is set.
- `FRONTEND_URL` (CORS) only matters if you later split the frontend onto a different domain.

The frontend service rewrites deep links to `index.html`, so `/register`, `/records` and `/verify?landId=…` survive a refresh.

### Vercel limits that matter here

- **Request body: 4.5 MB.** Vercel rejects larger uploads before the app runs, so the API caps uploads at 4 MB on Vercel with a clear 413. Deeds larger than that need a direct-to-blob upload flow or a non-serverless host for the API.
- **Duration: 300 s** (Fluid compute default), enough for AI extraction and the on-chain write.
- **Bundle: 250 MB** uncompressed — the current backend dependencies fit.
- **Filesystem:** read-only except `/tmp`; deed extraction already uses `os.tmpdir()`.

Run `npm run seed:admin` locally (not on Vercel) if you ever need to recreate the admin user. The Supabase schema is applied separately via the SQL editor.

### Separate projects (alternative)

If Services is unavailable on your account, deploy twice: backend Root Directory `backend` (Express preset) and frontend Root Directory `frontend` (CRA preset). Then set `REACT_APP_API_URL=https://<backend>.vercel.app/api` on the frontend, and `FRONTEND_URL` plus `VERIFY_BASE_URL` on the backend.

---

## API Reference

### Registrar (`/api/land`, Bearer JWT)

| Method | Path | Description |
|---|---|---|
| POST | `/extract` | Multipart `deed` (PDF) → extracted fields |
| POST | `/preview` | Location + survey (+ optional `landIdOverride`) → Land ID, whether it exists, current head |
| POST | `/register` | Multipart `deed` + fields → encrypt, IPFS, chain, DB, QR. Returns `landId`, `recordId`, `linked`, `txHash`, `ipfsCID`, `verifyUrl`, `qrCode` |
| GET | `/` | List records (`search`, `page`, `limit`, `latestOnly`) |
| GET | `/stats` | `{ records, parcels, transfers, revoked, owners }` |
| GET | `/records/:recordId` | Record + parcel history |
| GET | `/records/:recordId/document` | Decrypted PDF (`X-Document-Hash-Match` header) |
| POST | `/records/:recordId/revoke` | `{ reason }` → on-chain revoke |

### Public (`/api/verify`)

| Method | Path | Description |
|---|---|---|
| GET | `/land/:landId` | Parcel summary, ownership timeline, per-record chain integrity |
| GET | `/land/:landId/document` | Decrypted deed of the current record, or `?record=REC-XXXXXXXX` for a specific ownership. Registrar-only by default; set `VIEW_DOCUMENT_POLICY=public` to open it to anyone with the Land ID. Served only after that record's on-chain check passes |
| POST | `/land/:landId/document` | Multipart `deed` → whether the PDF matches a registered version |
| GET | `/land/:landId/qr` | QR PNG (`?download=1` for attachment) |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not find the table 'public.land_records'` | Run `backend/supabase/schema.sql` in Supabase |
| Backend exits on boot about secrets | Set 64-hex `DOCUMENT_ENC_KEY` and `HASH_PEPPER` |
| `not an authorised registrar` revert | Run `scripts/addIssuer.js` for the `ISSUER_PRIVATE_KEY` wallet |
| New deed didn't link to the parcel | Location/survey normalised differently — use the Land ID override |
| 409 on register | That exact PDF is already registered |
| Extraction slow / empty | Check `GEMINI_API_KEY`; scanned PDFs fall back to vision (~30 s) |
