# Guided walkthrough — implementation plan

How the attached specification maps onto this codebase, what gets built, and where
the spec needs a decision before anyone writes code.

Nothing here is implemented. The plan is local only — nothing committed, nothing pushed.

---

## 0. As built

This section was added after the implementation. The plan below is kept as it was
written; this is what actually shipped and where it differs.

**Shipped.** 39 steps across five surfaces, all in `frontend/src/components/tour/`.
The catalogue lives in `tourSteps.json` (id, group, route, anchor, placement,
copy) and `tourSteps.js` loads it and attaches the behaviour hooks — the split
exists because the verification script has to read the catalogue without a
bundler, and the root `package.json` has no `"type": "module"`, so Node cannot
`import` a `.js` ESM file from `scripts/`.

**Two decisions came out differently from the plan.**

1. **Auth gating.** The plan filtered auth-gated steps out for a signed-out
   visitor. What shipped is a **sign-in gate**: the four opening steps run
   publicly, and when the tour reaches the registrar side it shows a "Sign in to
   continue" card instead. Nothing is skipped and there is no redirect loop.
2. **The check script.** Tier 1 shipped as planned and is the part that matters:
   it proves every class and attribute used by every anchor still exists in the
   rendered markup. Tier 2 (headless browser drive) shipped as an **opt-in
   `--drive` flag** that reports itself as skipped when no `puppeteer` or
   `playwright` is installed — nothing is added to the dependency tree to
   support a test.

**Two defects found and fixed during the browser pass.**

- The **Finish button was disabled** at the last step (`disabled={stepNumber >= total}`),
  so the tour could never be completed and `nosih.tour.decision` was never set
  to `completed`. The button is now enabled and `next()` finishes the run.
- The **welcome modal appeared over a deep-linked tour**. The deep-link effect
  now writes the decision itself and suppresses the welcome prompt.

**Verified.** All 39 anchors resolve in order with no counter jumps; the
spotlight's inline geometry matches the anchor box to within 0.6 px on every
step; the document modal opens and closes through the before/after hooks; the
gate signs in and resumes at step 5; the skip path fills the demo credentials
and they sign in against the real backend; the tour ends with the overlay and
card removed. Bundle cost: JS 100.41 kB → 108.79 kB gzipped (+8.4 kB), CSS
5.51 kB → 6.63 kB.

**Not done.** The tour work is committed locally and **not pushed**, on
instruction. The demo credentials in `demoCredentials.js` are in the public
bundle and must be removed before this is anything but a demo.

---

## 1. What it would make

A **39-step animated guided tour** of the whole NOSIH registry, startable on demand
from any page, that never writes to the blockchain.

| | |
|---|---|
| Entry points | `Take a tour` in the sidebar footer · a `?` chip beside every page title · `?tour=1` · `?tour=dashboard` · `?tour=verify` |
| What the visitor sees | The screen dims except the element under discussion; a card explains it; the spotlight glides to the next element |
| Coverage | Sign in (4) · Dashboard (7) · Register a deed (9) · Land records (9) · Public verification (10) |
| Signed out | The tour filters itself down to the public steps: sign in (1–4) and verify (30–39). No auth loop. |
| Chain writes | **None.** The registration flow is described, never performed. The Revoke button is described, never pressed. |
| Fixture | The live parcel `LAND-B5F024C626` — record `REC-70AE6AD5`, owner `OWN-31E19C9D`, Amoy tx `0x9b2eb523…6a28c5`, doc hash `0x18eb5b28…06324`, CID `QmQHvfCbH5hdEgVrG14QZtZjVBkZQ7t6ucga2uTEK7VgVG` |
| New dependency | None. CSS box-shadow cut-out, CSS transitions, React context. |

The tour reads the fixture from two places: the **live API** (`/api/verify/land/:landId`,
`/api/verify/land/:landId/qr` — both public and read-only) and **hard-coded copy** in the
step catalogue.

---

## 2. File-by-file

### 2.1 New — `frontend/src/components/tour/`

| File | Responsibility | Notes |
|---|---|---|
| `TourProvider.js` | Context + state machine + navigation + persistence | The engine. See §3.1. |
| `Spotlight.js` | The dimming overlay with the cut-out hole | Tracks `getBoundingClientRect()` of the active anchor. |
| `TourTooltip.js` | The explanatory card | Dialog semantics, focus trap, viewport clamping, bottom sheet. |
| `TourLauncher.js` | The buttons | Four variants: `sidebar`, `page-help`, `floating`, `chip`. |
| `tourSteps.js` | The 39-step catalogue | All copy from the spec, verbatim. |
| `tour.css` | Spotlight, tooltip, sheet, launcher, pulse, reduced motion | Imported by `TourProvider`. |

**Deviation: `.js`, not `.jsx`.** The spec names `.jsx`. Every component in this repo is
`.js` (`Layout.js`, `PolygonMark.js`, `api.js`) and the imports are extensionless. CRA 5
supports both, but matching the house style is worth more than matching the spec's file
names. The names change from `TourProvider.jsx` → `TourProvider.js` and so on; nothing else.

### 2.2 New — `scripts/check-tour-steps.mjs`

Wired as `"check:tour": "node scripts/check-tour-steps.mjs"`. See §3.3 — this one needs a
decision.

### 2.3 Modified

| File | Change |
|---|---|
| `frontend/src/App.js` | Wrap `<Routes>` in `<TourProvider>` **inside** `<BrowserRouter>` (the provider needs `useNavigate`). Read `?tour=` with `useSearchParams`. |
| `frontend/src/components/Layout.js` | Mount `<TourLauncher variant="sidebar" />` in `.sidebar-footer`. Render `<TourLauncher variant="page-help" />` next to the `<h1>` in `.page-header`. |
| `frontend/src/pages/LoginPage.js` | Mount `<TourLauncher variant="page-help" />` beside the `NOSIH` heading. Add `data-tour="login-email"`. |
| `frontend/src/pages/VerifyPage.js` | Mount `<TourLauncher variant="page-help" />` in `.verify-header` and `<TourLauncher variant="floating" />` (bottom-right chip, no sidebar on this page). |
| `frontend/src/pages/RegisterPage.js` | The tour-mode preview state. See §3.2. |
| `frontend/src/pages/RecordsPage.js` | Add `data-tour` to the four row-action controls. |
| `frontend/src/pages/DashboardPage.js` | Nothing — the dashboard anchors are all unique already (`.action-card[href='/register']` etc.). |
| `package.json` | Add the `check:tour` script. |

---

## 3. The three hard parts

### 3.1 The engine — cross-route transition

A step can live on a different route than the previous one. The sequence the spec
prescribes, and how it is implemented:

```
next()
  │
  ├─ step.route !== current location
  │    1. fade the card out            (160 ms)
  │    2. navigate(step.route)          ← useNavigate, SPA route change, session survives
  │    3. await step.before?.()         ← e.g. set the register tour mode
  │    4. poll every 50 ms (max 4000 ms) until document.querySelector(step.anchor)
  │       resolves AND has non-zero dimensions
  │    5. target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth',
  │                               block: 'center' })
  │    6. move the spotlight            (380 ms)
  │    7. fade the card in              (220 ms)
  │
  └─ same route → skip 1–2, keep the spotlight, just move it
```

**State machine**

```js
status: 'idle' | 'running' | 'paused' | 'done'

start(tourId, index) → running, index
next()   → index + 1, or status = 'done' at the last step
prev()   → index - 1
skip()   → status = 'paused', position saved        (ESC does this too)
end()    → status = 'idle', position cleared
```

**Persistence** — two `localStorage` keys:

| Key | Written | Read |
|---|---|---|
| `nosih.tour.position` | `{ tourId, index }` on every step change | The launcher reads it to offer *Resume tour (step 7 of 39)* |
| `nosih.tour.completed` | On `done` | The launcher reads it to offer *Replay tour* instead of *Take a tour* |

**Keyboard** — `Escape` → `skip()`, `ArrowRight` / `Enter` → `next()`, `ArrowLeft` → `prev()`,
`Tab` / `Shift+Tab` trapped strictly inside `.tour-tooltip`.

**Announcer** — a visually hidden `aria-live="polite"` region reading
`"Step 7 of 39: Live counters. Parcels, records, transfers and revocations…"`.

**Spotlight geometry** — a single fixed rectangle, padded by 8 px, positioned over the
anchor's bounding box, darkened with `box-shadow: 0 0 0 9999px rgba(24,26,30,.62)`.
`pointer-events: none` on the hole, so the page underneath stays clickable while it is
being described. A `ResizeObserver` plus `scroll` and `resize` listeners keep it glued to
the element.

### 3.2 The register tour modes — the largest single piece

`RegisterPage` today has one state machine — `upload → extracting → form → registering →
done` — and the elements the tour needs (`.land-id-panel`, `.form-section-title`,
`.privacy-note`, `.register-done`, `.qr-panel`) only exist inside the `form` and `done`
states. Getting to them normally means uploading a PDF and running the AI, and the `done`
state means a real registration, which is a chain write and is forbidden.

**So the page gets a second, read-only state that only the tour can enter.**

```js
const [tourMode, setTourMode] = useState(null);   // null | 'default' | 'linked' | 'receipt'

useEffect(() => {
  const onMode = (e) => setTourMode(e.detail?.mode ?? null);
  window.addEventListener("nosih:tour-register-mode", onMode);
  return () => window.removeEventListener("nosih:tour-register-mode", onMode);
}, []);
```

A window event rather than a tour context keeps the page independent of the tour
component — the page has no idea a tour exists, it just renders a different preview when
told to.

| Mode | Renders | Fixture |
|---|---|---|
| `default` (steps 12–13, 15–18) | The real `.dropzone` **alongside** a preview of the form: `.land-id-panel` in the *new parcel* state, the four `.form-section-title` sections with a few representative fields, and the real `.privacy-note` | Land ID `LAND-··········` (unresolved, as in the real first-run state) |
| `linked` (step 14) | `.land-id-panel` in the *linked* state — the `is-linked` class, the link icon, "Existing parcel. This deed links to REC-70AE6AD5 (1 record)", and the previous owner line | `LAND-B5F024C626`, `REC-70AE6AD5`, previous owner `OWN-31E19C9D` |
| `receipt` (steps 19–20) | A read-only `.register-done` with the real `.qr-panel` and the real `.details-table` | Land ID, Record ID, owner IDs, tx `0x9b2eb523…6a28c5`, doc hash, CID `QmQHvfCb…` |

The QR image in `receipt` mode points at the **live public endpoint**
`/api/verify/land/LAND-B5F024C626/qr` — a read-only GET that needs no token and writes
nothing. The register endpoint is never called.

`data-tour` attributes added to the page so the catalogue can disambiguate the repeated
section titles:

```jsx
<h3 className="form-section-title" data-tour="section-parties">…</h3>
<h3 className="form-section-title" data-tour="section-location">…</h3>
<h3 className="form-section-title" data-tour="section-details">…</h3>
<h3 className="form-section-title" data-tour="section-registration">…</h3>
```

The mode resets to `default` when the tour leaves `/register` or ends.

### 3.3 The verification script — where the spec needs a decision

The spec asks `scripts/check-tour-steps.mjs` to "sign in as registrar, step through all
5 routes … and assert that every step's anchor selector resolves to a visible DOM
element", using "the same local server / browser harness pattern as
`scripts/check-ui-failure.mjs`".

`check-ui-failure.mjs` **is not a browser harness** — it is a static file server. It
serves `frontend/build` and stubs the API. It does not drive a browser, and nothing in
this repo can: there is no Puppeteer, no Playwright, and §1 of the spec forbids adding
one.

**Proposed: a two-tier script that respects the zero-dependency rule.**

| Tier | Runs | What it proves |
|---|---|---|
| **1 — always** | Every time | The catalogue is well formed: unique ids, valid route, non-empty anchor/title/body. Plus, for each anchor, every class name it mentions is confirmed to exist somewhere in `frontend/src/`. This is the check that actually catches rot — a renamed `.land-id-panel` fails the script. |
| **2 — opt-in** | Only if a browser automation package is already present in the environment (detected, never installed) | Drives the real app and asserts every anchor resolves live, including the `/register` tour modes and the open `.doc-modal`. If no such package is found, the script prints that tier 2 was skipped and still exits 0 on tier 1's result. |

Tier 1 is dependency-free and catches the failure mode that actually happens. Tier 2 is
the spec's literal ask, available when the environment allows it.

**If you would rather have tier 2 always run**, the only zero-install option is to drive
the browser from outside Node — the agent's browser tooling, or a hand-run checklist.
That is a workflow, not a script, and it cannot be run from `npm run`.

**Recommendation: build tier 1 now, wire tier 2 as an opt-in flag, and verify the live
behaviour through the browser during implementation.** That is the honest version of the
spec's intent without smuggling in a browser-automation dependency.

---

## 4. Other decisions

| Question | Decision | Why |
|---|---|---|
| `.jsx` or `.js`? | `.js` | Matches every other component in the repo |
| Where does the `?` chip live? | `Layout` renders it beside the `<h1>`; `LoginPage` and `VerifyPage` render their own | `Layout` already owns the page title for dashboard/register/records, so one mount covers three pages. `VerifyPage` does not use `Layout` — it has its own header |
| `/login` force-redirect | **Not needed.** There is no such redirect today | The redirect that matters is `PrivateRoute` → `/login` when signed out. The spec's §4.2 signed-out filter solves it: the tour never asks for a route the visitor cannot reach, so it never hits the redirect |
| Start point of `?tour=1` | Step 0 (`/login`) | As specified. A signed-in visitor sees the sign-in page, then the tour continues into the registrar surfaces |
| `?tour=dashboard` etc. | First step of that route | The spec names `login\|dashboard\|register\|records\|verify` |
| Tour length shown in the UI | "Step X of 39" | Matches the spec's `Step X of Y` requirement, with the count fixed at 39 |
| Does the tour navigate with `<a>` or the router? | The router (`navigate`) | The dashboard's action cards are plain `<a href>` — full page loads. The tour must not use them, or the tour state would be lost |
| Bundle impact | Target under +15 kB gzipped | Zero dependencies, but 39 steps of copy and a spotlight layer add weight. Measured before and after |

---

## 5. Phases

| Phase | Work | Done when |
|---|---|---|
| 1 | `TourProvider`, `Spotlight`, `TourTooltip`, `tour.css` | A hard-coded two-step tour runs on `/` and glides between two elements |
| 2 | `tourSteps.js` — all 39 steps, copy verbatim from the spec | The file exists with every id, title, body, route, anchor and hook |
| 3 | `TourLauncher` (all four variants), `?tour=` deep links, persistence | Every entry point works; a reload mid-tour offers *Resume* |
| 4 | Cross-route navigation, `before`/`after` hooks, the `?` chip per page | The tour reaches step 30 on `/verify` |
| 5 | `RegisterPage` tour modes (`default` / `linked` / `receipt`) + `data-tour` attributes | Steps 12–20 anchor correctly with no PDF and no chain write |
| 6 | `RecordsPage` `data-tour` attributes, the signed-out filter | Steps 21–29 anchor; a signed-out visitor gets 1–4 + 30–39 |
| 7 | `scripts/check-tour-steps.mjs` tier 1, `package.json` script, README section | `npm run check:tour` passes |

Phases 1–2 are the engine and the content and can be reviewed independently. Phase 5 is
the one that can surprise, so it gets its own pass.

---

## 6. Verification

| Check | How |
|---|---|
| Catalogue integrity | `npm run check:tour` — unique ids, non-empty fields, every class in every anchor exists in the source |
| No chain writes | The tour calls no mutating endpoint. `grep` the tour directory for `registerDeed`, `revokeLandRecord` — must find nothing |
| Never registers | The `/api/land/register` endpoint is never called during a full tour run (watch the network panel) |
| Signed out | Clear the token, run the tour on `/verify` — it must filter to the public steps and never bounce to `/login` |
| Reload mid-tour | Pause at step 12, reload — the launcher offers *Resume tour (step 12 of 39)* |
| Keyboard only | Complete a full run with Tab / arrows / Enter, no mouse |
| Reduced motion | Emulate the OS setting — the tour still completes, without transitions |
| Mobile | Viewport under 768 px — the card becomes a bottom sheet, the launcher becomes the floating chip |
| Bundle size | Compare `main.*.js` before and after |
| Console | A full run logs nothing (in production builds) |

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Selector rot** — a class is renamed and a step silently stops working | `npm run check:tour` tier 1 fails on a rename; the dev build also logs a warning when an anchor matches nothing |
| The register preview drifts from the real form | The `default` mode reuses the real `.privacy-note` and the real section markup rather than duplicating it |
| The tour misleads | Every claim in the copy is checked against the live fixture before shipping — the doc hash, CID, owner ID and transaction are read from the API, not typed by hand |
| Bundle growth | Measured before and after; the tour is the only new surface |
| The fixture parcel is deleted or revoked later | The verify steps degrade to the "not found" state, which is itself correct behaviour; the tour does not fabricate a record |

---

## 8. Open questions for you

1. **Tier 2 of the check script** — build it opt-in as proposed, or drop it and rely on
   tier 1 plus the manual browser pass?
2. **Copy review** — the 39 body strings are drafted here and taken from the spec. They
   should be read by whoever wrote the brief before they ship.
3. **`?tour=1` start point** — begin at the sign-in page as specified, or at the dashboard
   for a visitor who is already signed in?
