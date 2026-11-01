# Guided walkthrough — implementation plan

A guided, animated tour of the NOSIH deed registry that a visitor can start on
demand, at any time, from any page. It walks the whole system and explains every
feature as it goes.

Nothing here is implemented yet. This is the plan.

---

## 1. What the live system actually does

Verified by walking https://nosih.vercel.app on 2026-11-01. The deployment is
healthy: `/api/health` returns `{"status":"ok","config":{"ok":true},"database":{"ok":true}}`,
and the current build matches `main` (the dashboard no longer shows the network tile).

Five surfaces, two audiences:

| Surface | Route | Audience | Anchors for the tour |
|---|---|---|---|
| Sign in | `/login` | public | `.auth-card`, `.auth-logo`, `.field`, `.btn-primary`, `.auth-links` |
| Dashboard | `/` | registrar | `.dashboard-headline`, `.stats-grid`, `.stat-card`, `.card`, `.action-grid`, `.action-card`, `.dashboard-declaration` |
| Register deed | `/register` | registrar | `.dropzone`, `.land-id-panel`, `.form-section-title`, `.form-grid`, `.privacy-note`, `.register-done`, `.qr-panel`, `.details-table` |
| Land records | `/records` | registrar | `.toolbar`, `.search-wrap`, `.toggle`, `.cert-table`, `.badge`, `.action-btns`, `.pagination` |
| Public verification | `/verify` | **anyone** | `.verify-header`, `.verify-card`, `.status-banner`, `.land-summary`, `.timeline`, `.timeline-item`, `.chain-check`, `.doc-modal`, `.disclaimer` |

Data that exists today and makes the tour concrete: one parcel, `LAND-B5F024C626`,
one record `REC-70AE6AD5`, owner `OWN-31E19C9D`, jurisdiction
`MAHARASHTRA-MUMBAISUBURBAN-ANDH`, one transaction on Amoy
`0x9b2eb523…6a28c5`, and a QR PNG served from `/api/verify/land/:landId/qr`.

---

## 2. What the walkthrough is

**One continuous tour, five pages, ~32 steps.** The visitor presses *Take a tour*
and the app takes over: a spotlight dims the screen, a card explains the element
under the spotlight, and the spotlight glides to the next element.

Design rules:

1. **On demand, never forced.** No auto-start, no modal on first load. A button
   in the sidebar footer, a "?" beside each page title, and a shareable
   `?tour=1` deep link are the only entry points.
2. **It explains, it does not demo.** The tour must never write to the chain.
   It shows screenshots-of-record (the existing parcel), never a live
   registration. That keeps it safe to run in front of anyone.
3. **It can be resumed and abandoned.** Closing the tab mid-tour is fine. Coming
   back shows a "Resume tour" chip rather than restarting from step one.
4. **It never traps.** ESC, the skip button, or clicking outside the card ends it.
   The app is fully usable with the tour never started.

---

## 3. The step catalogue

Each step: `route` → `anchor` (CSS selector) → `title` → `body`. The body is the
deliverable's substance; it should say what the element does *and* why it
matters, in one or two sentences.

### 3.1 Sign in — `/login`

| # | Anchor | Title | Body |
|---|---|---|---|
| 1 | `.auth-logo` | NOSIH | A decentralised registry of land deeds. Records are written to Polygon Amoy; the documents stay encrypted and off-chain. |
| 2 | `.field` (email) | Sign in | Registrar accounts only. The token is issued here and held for the session — it never leaves the browser. |
| 3 | `.auth-links` | Public verification | No account needed. Anyone with a Land ID can check who owns a parcel and whether the record still matches the chain. |
| 4 | `.auth-card` | What happens next | Four steps take you through the whole system: register a deed, watch the registry, open the records table, then verify a parcel as a stranger would. |

### 3.2 Dashboard — `/`

| # | Anchor | Title | Body |
|---|---|---|---|
| 5 | `.dashboard-headline` | The registry at a glance | Every deed is anchored on-chain and mirrored in an access-controlled database. This page is the registrar's view of both. |
| 6 | `.stat-card` | Live counters | Parcels, records, transfers and revocations, read from the database on every load. They are never cached. |
| 7 | `.card` | Recent records | The five most recent registrations. A Land ID here is the permanent identity of a parcel — it survives every later transfer. |
| 8 | `.action-card` (Register Deed) | Register a deed | Upload the signed PDF. The server reads it, encrypts it, pins it, and writes only hashes and owner IDs to the chain. |
| 9 | `.action-card` (Land Records) | Search the registry | Search by Land ID, record, survey number, village or owner. Open a deed, download its QR, or revoke it. |
| 10 | `.action-card` (Verify Land) | Verify as the public | The same view a citizen sees: an ownership timeline with no registrar login, cross-checked against the chain on every request. |
| 11 | `.sidebar-footer` | Your session | The signed-in registrar and their role. Sign out clears the token from this tab only. |

### 3.3 Register a deed — `/register`

| # | Anchor | Title | Body |
|---|---|---|---|
| 12 | `.dropzone` | Start with the document | Drop the registered deed PDF. AI reads the survey number, boundaries and registration details, and pre-fills the form — every field stays editable. |
| 13 | `.land-id-panel` | The parcel identity | The Land ID is derived from jurisdiction, survey number and subdivision. The same parcel always derives the same Land ID, whatever the owner. |
| 14 | `.land-id-panel` (linked state) | Linking to an existing parcel | When the Land ID already exists, the new deed becomes the next record in that chain and inherits the previous owner automatically. |
| 15 | `.form-section-title` (Parties) | Parties | Buyer and seller. Names stay in the database; the chain only ever sees keyed hashes and registry IDs like `OWN-31E19C9D`. |
| 16 | `.form-section-title` (Location) | Location | State, district, taluk, village and survey number. Together they derive the jurisdiction code and the Land ID. |
| 17 | `.form-section-title` (Land details / Registration) | Land details and registration | Area and boundaries, document type, registration number, date and the sub-registrar office. |
| 18 | `.privacy-note` | What actually goes on-chain | Only hashes, the encrypted file's CID and owner registry IDs. Names, survey numbers and boundaries stay in the access-controlled database. |
| 19 | `.register-done` | The receipt | A QR code for the parcel, the Land ID and Record ID, the transaction on Amoy, the document hash and the encrypted CID. |
| 20 | `.qr-panel` | The QR code | Scanning it opens the public verification page for that exact parcel. It is the handoff from registrar to citizen. |

### 3.4 Land records — `/records`

| # | Anchor | Title | Body |
|---|---|---|---|
| 21 | `.search-wrap` | Search | One box across Land ID, record ID, survey number, village and owner name. |
| 22 | `.toggle` | Current records only | Off shows the full history of every parcel. On shows only the head of each chain. |
| 23 | `.cert-table` | The registry table | Land ID, record, owner, location, document, status. Every row is cross-checkable against the contract. |
| 24 | `.badge` | Status | `ACTIVE` or `REVOKED`. Revocation is recorded on-chain; the record stays visible forever. |
| 25 | `.action-btns` (Verify) | Verify | Opens the public verification page for that parcel. |
| 26 | `.action-btns` (Deed) | Open the original | Decrypts the stored PDF for this registrar and opens it. The hash is checked against the chain on the way out. |
| 27 | `.action-btns` (QR) | Download QR | The same QR the citizen would scan. |
| 28 | `.action-btns` (Revoke) | Revoke | Permanently marks the record revoked on-chain. It requires a written reason, which is recorded on the ledger. |
| 29 | `.pagination` | Paging | Server-side paging, so the registry stays responsive with thousands of records. |

### 3.5 Public verification — `/verify`

| # | Anchor | Title | Body |
|---|---|---|---|
| 30 | `.verify-card` | Enter a Land ID | The only field on the public page. A Land ID is in the QR code on the deed itself, so a citizen can check their own parcel without asking anyone. |
| 31 | `.status-banner` | The verdict | `REGISTERED LAND RECORD` only appears when the database and the contract agree. A revoked record says so; an unknown ID says so. |
| 32 | `.land-summary` | The parcel | Location, jurisdiction code, current record and current owner **ID**. Owner names are deliberately not published. |
| 33 | `.land-summary-qr` | The parcel's QR | The public face of the parcel, rendered on demand by the API. |
| 34 | `.timeline` | Ownership history | Every transfer, newest first, with the owner ID it moved to and the owner ID it moved from. |
| 35 | `.chain-check` | On-chain match | The record was re-read from the contract just now and matches the database. This check runs on every visit, not on a cached copy. |
| 36 | `.timeline-hashes` | Proof data | The document hash, the previous-record hash, the encrypted CID and the moment of registration. |
| 37 | `.timeline-actions` (View original document) | View the original | For a registrar, the decrypted PDF opens in a modal. The public sees a locked state unless the policy is set to `public`. |
| 38 | `.dropzone-compact` | Check a deed PDF | Anyone can drop their own copy of a deed. It is hashed and compared with the registered versions — and never stored. |
| 39 | `.disclaimer` | What a match proves | A matching hash proves the file is the one that was registered. It does not by itself prove legal ownership or the validity of the transaction. |

---

## 4. Architecture

New folder, six files, no new dependency:

```
frontend/src/components/tour/
├── TourProvider.jsx     state machine + context + persistence
├── Spotlight.jsx        the animated dimming overlay with the cut-out
├── TourTooltip.jsx      the explanatory card
├── TourLauncher.jsx     the "Take a tour" button and the "?" chip
├── tourSteps.js         the catalogue in section 3
└── tour.css             animations and card styling
```

Touched files:

| File | Change |
|---|---|
| `frontend/src/App.js` | Wrap the app in `TourProvider`; read `?tour=` and start the right tour |
| `frontend/src/components/Layout.js` | Mount the launcher in the sidebar footer; show the tour chip |
| `frontend/src/pages/VerifyPage.js` | Mount the launcher for signed-out visitors on the public page |
| `frontend/src/pages/styles.css` | Import `tour.css`, or keep it self-contained in the component |

**No new dependency.** The spotlight is CSS box-shadow over a positioned
rectangle; the transitions are CSS. Keeping it dependency-free matters — the
bundle is already the main size cost on Vercel.

### `TourProvider` — the state machine

State: `{ tourId, stepIndex, status }` where `status` is
`idle | running | paused | done`.

```
start(tourId, stepIndex) → running
next()        → stepIndex + 1, or status = 'done' at the end
prev()        → stepIndex - 1
skip()        → status = 'idle', remember the position as 'paused'
end()         → status = 'idle', clear the pause marker
```

Persistence in `localStorage`, two keys:

- `nosih.tour.completed` — set when a tour finishes. The launcher then reads
  *Replay tour* instead of *Take a tour*.
- `nosih.tour.position` — `{ tourId, stepIndex }`, written on every step. On the
  next visit the launcher offers *Resume tour (step 7 of 32)*.

### Step shape

```js
{
  id: "records-actions",
  route: "/records",              // navigate here before the step
  anchor: ".action-btns",         // CSS selector for the spotlight
  placement: "bottom-left",       // where the card sits relative to the hole
  title: "Row actions",
  body: "Verify opens the public page. Deed decrypts the original…",
  before: async () => { … },      // optional: expand a <details>, open a modal
  advance: "route",               // optional: 'route' moves to the next route
  optional: false                 // optional steps are skipped if the anchor is absent
}
```

`before` is what makes the tour able to reach elements that only exist after an
action — for example step 37 (the document modal) runs `before: () => click the
"View original document" button` and then anchors on `.doc-modal`.

**Selector rot is the main risk.** Two guards:
1. In development, the provider logs a warning when an anchor matches nothing.
2. `scripts/check-tour-steps.mjs` asserts every step in the catalogue resolves
   against the running app, so a renamed CSS class fails a check instead of
   silently skipping a step.

---

## 5. The animation

**The spotlight.** One fixed-position rectangle is moved to the target's
bounding box and darkened with an oversized box-shadow:

```css
.tour-spotlight {
  position: fixed;
  border-radius: 12px;
  box-shadow: 0 0 0 9999px rgba(24, 26, 30, .62);
  transition: top .38s cubic-bezier(.22, .61, .36, 1),
              left .38s cubic-bezier(.22, .61, .36, 1),
              width .38s cubic-bezier(.22, .61, .36, 1),
              height .38s cubic-bezier(.22, .61, .36, 1);
  pointer-events: none;
}
```

A pulsing ring on the spotlight (`@keyframes tour-pulse`) draws the eye. The
hole has `pointer-events: none`, so the page underneath stays clickable — the
visitor can click the thing the tour is describing while it is described.

**The card.** Slides in from the side it will occupy, 220 ms, fading and
scaling from 0.96. The progress bar under the title fills as the tour advances.

**Between pages.** The tour navigates with the router (no full page load, so
the app state and the session survive). Sequence: card fades out (160 ms) →
navigate → wait for the new anchor to exist → spotlight grows from the centre
of the anchor to its full box (300 ms) → card fades in.

**Reduced motion.** `prefers-reduced-motion: reduce` removes every transition
and the pulse. The tour still works, it just cuts instead of glides.

---

## 6. On-demand behaviour

| Entry point | Where | Behaviour |
|---|---|---|
| *Take a tour* | Sidebar footer, below *Sign Out* | Starts the full tour from step 1 |
| *?* chip | Beside each page title | Starts the tour **at that page's first step** |
| `?tour=1` | Any URL | Starts the full tour on load — a shareable link |
| `?tour=dashboard` | Any URL | Starts at a named page |
| *Resume tour (n of 32)* | Sidebar footer | Continues from the stored position |
| *Replay tour* | Sidebar footer | Restarts from step 1 and clears the completed flag |

On the public `/verify` page the sidebar does not exist, so the launcher is a
small floating chip in the bottom-right corner. On screens under 768 px the
sidebar is hidden entirely, so the launcher becomes the floating chip there
too.

---

## 7. Accessibility

- **ESC** ends the tour. **→** / **←** move between steps. **Enter** advances.
- Focus moves into the card when it opens; a focus trap keeps Tab inside the
  card while the tour runs.
- The step is announced through an `aria-live="polite"` region.
- The spotlight is `aria-hidden`; the card is `role="dialog"`
  `aria-modal="true"` with a labelled title.
- Every control is a real `<button>` with a visible focus ring.

---

## 8. Implementation order

| Phase | Work | Done when |
|---|---|---|
| 1 | `TourProvider`, `Spotlight`, `TourTooltip`, `tour.css` | A hard-coded two-step tour runs on `/` |
| 2 | `tourSteps.js` — the full catalogue from section 3 | Every step in section 3 is in the file |
| 3 | `TourLauncher`, the `?` chip, `?tour=` deep links, persistence | Every entry point in section 6 works |
| 4 | Cross-page navigation, `before` hooks, the modal step | The tour reaches step 37 (the document modal) |
| 5 | Responsive sheet for small screens, reduced motion, a11y pass | Keyboard-only run completes the tour |
| 6 | `scripts/check-tour-steps.mjs`, README section | The selector check passes on all five routes |

Phase 6's check needs a running app. The script starts the backend and the
built frontend the way `scripts/check-ui-failure.mjs` already does, then
asserts each anchor resolves.

---

## 9. Verification

| Check | How |
|---|---|
| Every anchor resolves | `npm run check:tour` — fails on a renamed class |
| The tour never writes to the chain | No step calls a mutating endpoint; `revoke` is described, never pressed |
| It survives a reload mid-tour | Position is stored in `localStorage` on every step |
| It works signed out | The `/verify` tour needs no token |
| It works on a phone | The card becomes a bottom sheet under 768 px |
| Keyboard only | Complete a full run with Tab/arrows/Enter, no mouse |
| Reduced motion | Emulate the OS setting; the tour still completes |
| No console errors | A full run logs nothing |
| Bundle size | Compare `main.*.js` before and after; the target is under +15 kB gzipped |

---

## 10. Notes and limits

- **The tour never registers anything.** Step 12–20 explain the registration
  flow; the tour does not upload a PDF or write a record. The existing parcel
  `LAND-B5F024C626` is used as the worked example throughout.
- **The revoke step describes the button, it does not press it.** Revoking is
  permanent and writes to the chain.
- **Copy is not final.** The body text in section 3 is a first pass. It should
  be read by someone who knows the brief before it ships.
- **Nothing is pushed.** This plan is local only.
