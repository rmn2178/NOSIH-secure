# Deploying NOSIH to Vercel

Everything you need to put this registry on Vercel, in the order you need it.
The commands assume the repository root as the working directory.

---

## 0. What the deployment looks like

One Vercel project, two services, one domain:

```
                    ┌──────────── Vercel edge ────────────┐
   browser ────────▶│  /api/*  →  api service (backend/)   │
   QR scan ────────▶│  /*      →  web service (frontend/)  │
                    └──────────────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        Supabase Postgres     Pinata (IPFS)      Polygon Amoy
        users · owners      encrypted deeds      LandRegistry
        land_records
```

The browser never talks to Supabase, Pinata or Polygon directly. Every privileged
call goes through the API service, which is why the API's environment variables
matter so much.

---

## 1. Before you start

| You need | Why | Where |
|---|---|---|
| A Vercel account | The hosting | [vercel.com](https://vercel.com) |
| A Supabase project with the schema applied | Every record and the user table | [supabase.com](https://supabase.com) |
| A Pinata credential | The encrypted deed files | [pinata.cloud](https://pinata.cloud) |
| A Polygon Amoy wallet with POL | Signing registrations | Polygon wallet |
| A Gemini API key | Reading a deed PDF | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| The repository pushed to GitHub | Vercel builds from it | — |

The contract must already be deployed to Amoy and the backend's registrar wallet
must be authorised on it. If it is not:

```bash
npm run compile
npm run deploy:amoy      # prints CONTRACT_ADDRESS and CHAIN_ID
npm run issuer:add       # authorises ISSUER_ADDRESS on the contract
```

---

## 2. The local environment file

There is **one** env file: `.env` in the repository root. It is not committed.

```bash
cp .env.example .env
```

Fill it in. The values that decide whether a deployment works:

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | Yes | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | The **service-role** key. The publishable key cannot read the `users` table. |
| `JWT_SECRET` | Yes | A long random string |
| `DOCUMENT_ENC_KEY` | Yes | 64 hex characters. **Back it up** — losing it makes every stored deed unreadable. |
| `HASH_PEPPER` | Yes | 64 hex characters. **Back it up** — changing it changes every Land ID. |
| `CONTRACT_ADDRESS` | Yes | The deployed LandRegistry address |
| `ISSUER_PRIVATE_KEY` | Yes | The registrar wallet. It signs every registration and must be authorised on the contract. |
| `ALCHEMY_AMOY_URL` | Recommended | Falls back to `AMOY_RPC_URL`, then the public endpoint |
| `PINATA_JWT` | One of these | Preferred. A scoped key that Pinata's v3 endpoint rejects still works through the legacy endpoint. |
| `PINATA_API_KEY` + `PINATA_API_SECRET` | One of these | The alternative to a JWT |
| `GEMINI_API_KEY` | For extraction | Without it the form is filled manually |
| `JWT_EXPIRES_IN` | No | Defaults to `8h` |
| `VIEW_DOCUMENT_POLICY` | No | `registrar` (default) or `public` |
| `MAX_UPLOAD_MB` | No | Defaults to `15` locally and `4` on Vercel, whose request body limit is 4.5 MB |
| `FRONTEND_URL` | No | Comma-separated list of allowed origins. On the single-domain deployment this is not needed. |
| `VERIFY_BASE_URL` | No | Only for a separate-domain deployment |

Generate the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> The local-only variables — `PORT`, `NODE_ENV`, `BACKEND_PUBLIC_URL`,
> `VERIFY_BASE_URL` — are not needed on Vercel. The platform injects its own.

---

## 3. Check it before you upload it

This is the step that used to be skipped, and it is the step that would have
caught the production bug this project actually had.

```bash
npm run check:deploy
```

It verifies, in order:

- the root `.env` exists and every boot-critical variable is set and well formed
- the live credentials work — Supabase, Pinata and the chain answer
- the registrar wallet can pay for a registration
- the native modules resolve, including their platform binaries
- the PDF.js worker and the browser globals PDF.js needs are in place
- the Tesseract WebAssembly core is in place
- **the deployment trace contains every file the code needs**

That last one is the important one. It traces `backend/server.js` with the same
tracer Vercel uses, then confirms that the PDF.js worker, the canvas native
binary, the sharp binary and the Tesseract core are all in the package that
would be uploaded.

The full simulation — which assembles a clean function bundle from the trace
and runs the extraction path inside it — is:

```bash
npm run check:deploy -- --full
```

That one takes a few minutes, because it downloads the OCR language data on
first run. It is worth running before a release.

### Why the trace matters

Three production failures in this project were all the same shape: a file the
development machine had and the deployment did not.

| Missing file | Production error |
|---|---|
| `pdfjs-dist/legacy/build/pdf.worker.mjs` | `Setting up fake worker failed` |
| `@napi-rs/canvas` | `DOMMatrix is not defined` |
| `tesseract.js-core/*.wasm` | `failed to asynchronously prepare wasm` |

None of them can be caught by a unit test, because the development machine has
every file. They can only be caught by assembling the deployment bundle locally
and running the code inside it.

---

## 4. Create the Vercel project

```bash
npm install -g vercel
vercel login
vercel link          # pick or create the project; use the repository root
```

`vercel.json` is already in the repository root and declares both services:

```json
{
  "services": {
    "web": { "root": "frontend/", "framework": "create-react-app", "buildCommand": "npm run build", "outputDirectory": "build" },
    "api": { "root": "backend/", "framework": "express" }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "api" } },
    { "source": "/(.*)", "destination": { "service": "web" } }
  ]
}
```

Nothing in the Vercel dashboard needs changing beyond what the CLI sets up.

---

## 5. Push the environment variables

```bash
npm run vercel:env
```

This reads the root `.env` and pushes every variable to the project. Options:

```bash
npm run vercel:env -- --dry-run        # print what would be sent
npm run vercel:env -- --preview        # also add them to the preview environment
npm run vercel:env -- --project <name> # a different project
```

The script skips the local-only variables. It never prints a secret value.

If you prefer the dashboard, the variables that must be present are the ones
marked **Required** in the table above, plus the Pinata credential and the
Gemini key.

---

## 6. Deploy

```bash
git push                       # Vercel builds from the pushed commit
vercel --prod                  # or let the Git integration do it
```

To deploy without pushing:

```bash
npm run vercel:deploy
```

That runs the preflight first and refuses to deploy if anything is missing.

---

## 7. Verify the deployment

Do these in order. Each one catches a different class of failure.

```bash
# 1. The health check — always answers, even when broken
curl -s https://<your-domain>/api/health | head -c 400
```

```json
{ "status": "ok", "timestamp": "...", "config": { "ok": true }, "database": { "ok": true } }
```

A `503` with `"problems"` means an environment variable is missing or
malformed — the response names it.

```bash
# 2. The public verification API
curl -s https://<your-domain>/api/verify/land/LAND-XXXXXXXXXX | head -c 400
```

```bash
# 3. The frontend
curl -s -o /dev/null -w "%{http_code}\n" https://<your-domain>/
```

```bash
# 4. Sign in, then read a record
curl -s -X POST https://<your-domain>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<ADMIN_EMAIL>","password":"<ADMIN_PASSWORD>"}'
```

```bash
# 5. Extract a deed — the path that was broken
curl -s -X POST https://<your-domain>/api/land/extract \
  -H "Authorization: Bearer <TOKEN>" \
  -F "deed=@some-deed.pdf"
```

A working response names the strategy that ran:

| Log line | Meaning |
|---|---|
| `Text layer found — Gemini text structuring` | The deed was a digital PDF |
| `Whole PDF sent to Gemini — PDF structuring` | The deed had no text layer; Gemini read the PDF itself |
| `Rendered pages sent to Gemini — vision structuring` | The pages were rendered and read as images |
| `Local OCR produced N characters — Gemini text structuring` | Everything else failed; Tesseract read the pages locally |

### The extraction strategies

The extractor tries four strategies in order and falls through on failure:

1. **Text layer.** The PDF has an extractable text layer. Gemini structures it.
   Fast, cheap, exact.
2. **The whole PDF.** Gemini reads the PDF directly — the original file goes
   over the wire untouched, with its SHA-256 in the prompt. No rendering, no
   canvas, no image conversion.
3. **Rendered pages.** The first three pages are rendered to JPEG and Gemini
   reads them as images.
4. **Local OCR.** The pages are rendered, recognised by Tesseract here, and only
   the resulting text is sent to Gemini to be structured. The only path that
   keeps the pixels on the server.

Strategy 2 is the reason a scanned deed no longer needs the PDF.js worker, the
canvas binary or the Tesseract core to be present at all.

---

## 8. Limits that will bite you

| Limit | Value | What to do |
|---|---|---|
| Request body | 4.5 MB | Uploads are capped at 4 MB on Vercel by default |
| Function duration | 60 s (Pro), 15 s (Hobby, Fluid) | The whole-PDF strategy is the fastest; a render plus OCR can be slow |
| Function memory | 1024 MB default | The canvas and the OCR core are memory-hungry |
| Bundle size | 250 MB | The canvas binary is ~36 MB; the OCR core adds more |

If extraction times out on the Hobby plan, the render and OCR strategies will
be the first to suffer. Set `GEMINI_PDF_TIMEOUT_MS` lower so the chain falls
through to a faster strategy rather than timing out.

---

## 9. Rolling back

```bash
vercel rollback                       # the previous deployment
vercel rollback <deployment-url>      # a specific one
vercel ls                            # list the deployments
```

The database is not touched by a rollback, so a rolled-back deployment may read
records written by a newer one. That is safe — the verification API checks every
record against the chain before serving it.

---

## 10. If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `FUNCTION_INVOCATION_FAILED` on every route | The backend exited at import time | Run `npm run check:deploy`. The environment audit now names the missing variable instead of crashing. |
| `503` with a `problems` list | An environment variable is missing or malformed | The response names the variable. `npm run vercel:env` pushes the whole `.env`. |
| `DOMMatrix is not defined` | The canvas package was not packaged | `npm run check:deploy -- --full`. The canvas must be a direct dependency, imported by name. |
| `Setting up fake worker failed` | The PDF.js worker was not packaged | The worker must be imported by name so the tracer follows it. |
| `failed to asynchronously prepare wasm` | The Tesseract core was not packaged | The core `.wasm` files must be referenced with literal specifiers. |
| `Extraction failed: … You can fill the form manually.` | Every strategy failed | Read the function log — it names the strategy and the reason for each fall-through. |
| The QR points at the wrong domain | `VERIFY_BASE_URL` is set to a local address | Unset it. The URL is derived from the incoming request, so the single-domain deployment needs no value. |
| A blank page in the browser | The API returned an error shape the UI could not render | Check `/api/health`. The frontend now renders every error as text. |

---

## 11. After deploying

Two things are still outstanding from earlier work and neither is a code change:

- **Rotate the credentials that appeared in the chat transcript.** The Supabase
  secret key and the database password were pasted into a conversation. Rotate
  both, then update the Vercel environment with `npm run vercel:env`.
- **Change the demo admin password.** `NOSIH123` is in the public bundle so the
  guided walkthrough can sign in without typing. It is a demo credential and it
  must not be the production one.
