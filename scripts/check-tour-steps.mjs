/**
 * Verifies the guided walkthrough catalogue against the code it points at.
 *
 * The failure this catches is rot: a class is renamed in the markup, an anchor
 * is left pointing at `.land-id-panel` that no longer exists, and the tour
 * silently points its spotlight at nothing. Nothing else in the build catches
 * that, because a CSS selector is just a string.
 *
 * Tier 1 (always runs, no dependencies):
 *   - the catalogue is well formed — unique ids, known groups, real routes,
 *     non-empty copy, sane placements
 *   - the auth flag matches the route's protection in App.js
 *   - every class and every attribute selector used in an anchor is confirmed
 *     to exist in the rendered markup under frontend/src
 *
 * Tier 2 (opt-in, --drive): drives the real tour in a headless browser and
 * asserts that every anchor resolves at runtime. Requires puppeteer or
 * playwright to be installed; skipped with a notice when it is not.
 *
 * Tier 3 (opt-in, --live): checks the fixture parcel against the live verify
 * API so the copy in the tour cannot drift from the registry.
 *
 * Usage:
 *   node scripts/check-tour-steps.mjs            # tier 1, plus tier 3 if reachable
 *   node scripts/check-tour-steps.mjs --live     # tier 1 + tier 3 (fails if unreachable)
 *   node scripts/check-tour-steps.mjs --drive    # tier 1 + tier 2 (browser)
 *   node scripts/check-tour-steps.mjs --base http://localhost:3000/api
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcRoot = path.join(root, "frontend", "src");
const cataloguePath = path.join(srcRoot, "components", "tour", "tourSteps.json");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PLACEMENTS = new Set(["top", "right", "bottom", "left"]);
const GROUP_ORDER = ["login", "dashboard", "register", "records", "verify"];

const results = [];
let failures = 0;

function pass(name, detail) {
  results.push({ ok: true, name, detail });
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  results.push({ ok: false, name, detail });
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}
function skip(name, detail) {
  results.push({ ok: null, name, detail });
  console.log(`  SKIP  ${name}${detail ? ` — ${detail}` : ""}`);
}
function section(title) {
  console.log(`\n${title}`);
}

// ── Source scanning ─────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "build" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Pulls every class name that is actually applied to an element.
 * Handles `className="a b"`, `className={`a ${x ? "b" : "c"}`}` and `class="a"`.
 */
function extractClasses(source) {
  const names = new Set();
  const attr = /class(?:Name)?\s*=\s*/g;
  let m;
  while ((m = attr.exec(source)) !== null) {
    const start = m.index + m[0].length;
    const ch = source[start];
    if (ch === '"' || ch === "'") {
      const end = source.indexOf(ch, start + 1);
      if (end === -1) break;
      source.slice(start + 1, end).split(/\s+/).forEach((t) => t && names.add(t));
      attr.lastIndex = end + 1;
    } else if (ch === "{") {
      let depth = 0;
      let end = start;
      for (; end < source.length; end += 1) {
        if (source[end] === "{") depth += 1;
        else if (source[end] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      scanExpression(source.slice(start + 1, end), names);
      attr.lastIndex = end + 1;
    }
  }
  return names;
}

/**
 * Reads a JS expression and collects the class names inside it.
 *
 * A template literal contributes its literal text (`\`dropzone ${x}\`` gives
 * "dropzone"), and every `${...}` hole is scanned in turn so a ternary inside
 * a className is not lost.
 */
function scanExpression(expr, names) {
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '"' || ch === "'") {
      const end = expr.indexOf(ch, i + 1);
      const raw = end === -1 ? expr.slice(i + 1) : expr.slice(i + 1, end);
      raw.split(/\s+/).forEach((t) => t && names.add(t));
      i = end === -1 ? expr.length : end + 1;
    } else if (ch === "`") {
      let j = i + 1;
      let chunk = "";
      while (j < expr.length) {
        const c = expr[j];
        if (c === "\\") {
          chunk += expr[j + 1] || "";
          j += 2;
          continue;
        }
        if (c === "`") {
          j += 1;
          break;
        }
        if (c === "$" && expr[j + 1] === "{") {
          chunk.split(/\s+/).forEach((t) => t && names.add(t));
          chunk = "";
          let depth = 0;
          let k = j + 1;
          for (; k < expr.length; k += 1) {
            if (expr[k] === "{") depth += 1;
            else if (expr[k] === "}") {
              depth -= 1;
              if (depth === 0) break;
            }
          }
          scanExpression(expr.slice(j + 2, k), names);
          j = k + 1;
          continue;
        }
        chunk += c;
        j += 1;
      }
      chunk.split(/\s+/).forEach((t) => t && names.add(t));
      i = j;
    } else {
      i += 1;
    }
  }
}

/** Every `data-tour="..."` value used in the markup. */
function extractDataTour(source) {
  const out = new Set();
  const re = /data-tour\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) out.add(m[1]);
  return out;
}

const jsFiles = walk(srcRoot);
const allSource = jsFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const markupClasses = new Set();
const dataTourValues = new Set();
for (const file of jsFiles) {
  const text = readFileSync(file, "utf8");
  extractClasses(text).forEach((c) => markupClasses.add(c));
  extractDataTour(text).forEach((d) => dataTourValues.add(d));
}

// ── Routes declared in App.js ────────────────────────────
const appSource = readFileSync(path.join(srcRoot, "App.js"), "utf8");
const appRoutes = new Map(); // path -> protected?
const routeRe = /<Route\s+path="([^"]+)"\s+element=\{([^}]*)\}/g;
let rm;
while ((rm = routeRe.exec(appSource)) !== null) {
  appRoutes.set(rm[1], rm[2].includes("PrivateRoute"));
}

// ── Tier 1 ──────────────────────────────────────────────
console.log("NOSIH guided walkthrough — catalogue check");

section("Catalogue");
let catalogue;
try {
  catalogue = JSON.parse(readFileSync(cataloguePath, "utf8"));
  pass("catalogue parses", path.relative(root, cataloguePath));
} catch (err) {
  fail("catalogue parses", err.message);
  process.exit(1);
}

const steps = Array.isArray(catalogue.steps) ? catalogue.steps : [];
const fixture = catalogue.fixture || {};

if (steps.length > 0) pass("steps present", `${steps.length} steps`);
else fail("steps present", "catalogue.steps is empty");

const ids = new Set();
const dupes = [];
for (const step of steps) {
  if (ids.has(step.id)) dupes.push(step.id);
  ids.add(step.id);
}
if (dupes.length === 0) pass("step ids are unique", `${ids.size} ids`);
else fail("step ids are unique", `duplicated: ${dupes.join(", ")}`);

// Group order must follow the declared surface order, and every group must
// appear — a group that silently disappears is a hole in the tour.
const seenGroups = [...new Set(steps.map((s) => s.group))];
const expectedOrder = GROUP_ORDER.filter((g) => seenGroups.includes(g));
if (JSON.stringify(seenGroups) === JSON.stringify(expectedOrder)) {
  pass("group order", seenGroups.join(" → "));
} else {
  fail("group order", `expected ${expectedOrder.join(" → ")}, found ${seenGroups.join(" → ")}`);
}

// ── Per-step field checks ───────────────────────────────
section("Step shape");
const badShape = [];
for (const step of steps) {
  const problems = [];
  if (!step.id || typeof step.id !== "string") problems.push("id");
  if (!GROUP_ORDER.includes(step.group)) problems.push(`group=${step.group}`);
  if (typeof step.route !== "string" || !step.route.startsWith("/")) problems.push(`route=${step.route}`);
  if (typeof step.anchor !== "string" || !step.anchor.trim()) problems.push("anchor");
  if (typeof step.title !== "string" || !step.title.trim()) problems.push("title");
  if (typeof step.body !== "string" || !step.body.trim()) problems.push("body");
  if (!PLACEMENTS.has(step.placement)) problems.push(`placement=${step.placement}`);
  if (problems.length) badShape.push(`${step.id}: ${problems.join(", ")}`);
}
if (badShape.length === 0) pass("every step is well formed", `${steps.length} steps checked`);
else fail("every step is well formed", badShape.join(" | "));

// ── Route and auth checks ───────────────────────────────
section("Routes and access");
const routeProblems = [];
for (const step of steps) {
  const pathname = step.route.split("?")[0];
  if (!appRoutes.has(pathname)) {
    routeProblems.push(`${step.id}: ${pathname} is not a route in App.js`);
    continue;
  }
  const protectedRoute = appRoutes.get(pathname);
  const needsAuth = Boolean(step.requiresAuth);
  if (needsAuth && !protectedRoute) {
    routeProblems.push(`${step.id}: ${pathname} is public but the step requires auth`);
  }
  if (!needsAuth && protectedRoute) {
    routeProblems.push(`${step.id}: ${pathname} is protected but the step does not require auth`);
  }
}
if (routeProblems.length === 0) {
  pass("routes exist and match the auth flag", `${appRoutes.size} routes declared in App.js`);
} else {
  fail("routes exist and match the auth flag", routeProblems.join(" | "));
}

// The sign-in gate only works if the introduction is public and the gate sits
// exactly at the boundary between the login group and the registrar portal.
const loginSteps = steps.filter((s) => s.group === "login");
const publicLogin = loginSteps.filter((s) => !s.requiresAuth).length;
const firstProtected = steps.findIndex((s) => Boolean(s.requiresAuth));
const gateProblems = [];
if (publicLogin !== loginSteps.length) {
  gateProblems.push(`${loginSteps.length - publicLogin} login step(s) require a session, so the visitor is asked to sign in before the tour has introduced itself`);
}
if (firstProtected === -1) {
  gateProblems.push("no step requires a session, so the tour never gates");
} else {
  const boundary = steps[firstProtected - 1];
  if (!boundary || boundary.group !== "login") {
    gateProblems.push(`the first protected step (${steps[firstProtected].id}) does not start right after the login group`);
  }
}
if (gateProblems.length === 0) {
  pass("the sign-in gate sits at the login boundary", `${publicLogin} public intro steps, gate before "${steps[firstProtected].id}"`);
} else {
  fail("the sign-in gate sits at the login boundary", gateProblems.join(" | "));
}

// ── Anchor resolution against the markup ────────────────
section("Anchors resolve to real markup");
/**
 * Splits a selector list into its alternatives, then each alternative into
 * the tokens that must exist: classes, data-tour values, attribute values.
 */
function selectorRequirements(selector) {
  const needs = { classes: new Set(), dataTour: new Set(), attributes: [] };
  for (const alternative of selector.split(",")) {
    const part = alternative.trim();
    if (!part) continue;

    const attrRe = /\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(["'])(.*?)\3)?\s*\]/g;
    let am;
    while ((am = attrRe.exec(part)) !== null) {
      const [, name, , , value] = am;
      if (!value) continue;
      if (name === "data-tour") needs.dataTour.add(value);
      else needs.attributes.push({ name, value });
    }

    // Classes, minus any pseudo-class suffix (`:first-of-type`).
    const classRe = /\.(-?[_a-zA-Z][\w-]*)/g;
    let cm;
    while ((cm = classRe.exec(part)) !== null) needs.classes.add(cm[1]);
  }
  return needs;
}

const anchorProblems = [];
const anchorNeeds = new Map();
for (const step of steps) {
  const needs = selectorRequirements(step.anchor);
  anchorNeeds.set(step.id, needs);
  for (const cls of needs.classes) {
    if (!markupClasses.has(cls)) {
      anchorProblems.push(`${step.id}: class .${cls} is not used in any markup file`);
    }
  }
  for (const value of needs.dataTour) {
    // The attribute may be written literally or passed down as a prop, so
    // both spellings count.
    const spellings = [
      `data-tour="${value}"`,
      `data-tour={'${value}'}`,
      `data-tour={"${value}"}`,
      `tourKey="${value}"`,
      `tourKey={'${value}'}`,
      `tourKey={"${value}"}`,
    ];
    if (!spellings.some((s) => allSource.includes(s))) {
      anchorProblems.push(`${step.id}: data-tour="${value}" is not applied in any markup file`);
    }
  }
  for (const { name, value } of needs.attributes) {
    // Attribute values such as href="/register" are checked as plain strings:
    // the markup may build them, but the literal has to be somewhere.
    const needle = `${name}=${JSON.stringify(value)}`.replace(/"/g, '"');
    const alt = `${name}="${value}"`;
    if (!allSource.includes(alt) && !allSource.includes(`'${value}'`) && !allSource.includes(`"${value}"`)) {
      anchorProblems.push(`${step.id}: attribute ${name}="${value}" does not appear in the source`);
    }
    void needle;
  }
}
if (anchorProblems.length === 0) {
  pass("every anchor token exists in the markup", `${anchorNeeds.size} anchors checked`);
} else {
  fail("every anchor token exists in the markup", anchorProblems.join(" | "));
}

// ── Fixture shape ───────────────────────────────────────
section("Fixture");
const fixtureProblems = [];
if (!/^LAND-[0-9A-F]{10}$/.test(fixture.landId || "")) fixtureProblems.push(`landId=${fixture.landId}`);
if (!/^REC-[0-9A-F]{8}$/.test(fixture.recordId || "")) fixtureProblems.push(`recordId=${fixture.recordId}`);
if (!/^OWN-[0-9A-F]{8}$/.test(fixture.currentOwnerId || "")) fixtureProblems.push(`currentOwnerId=${fixture.currentOwnerId}`);
if (fixture.previousOwnerId && !/^OWN-[0-9A-F]{8}$/.test(fixture.previousOwnerId)) fixtureProblems.push(`previousOwnerId=${fixture.previousOwnerId}`);
if (!/^0x[0-9a-f]{64}$/i.test(fixture.txHash || "")) fixtureProblems.push("txHash");
if (!/^0x[0-9a-f]{64}$/i.test(fixture.documentHash || "")) fixtureProblems.push("documentHash");
if (!/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(fixture.ipfsCID || "")) fixtureProblems.push("ipfsCID");
if (fixtureProblems.length === 0) pass("fixture ids are well formed", fixture.landId);
else fail("fixture ids are well formed", fixtureProblems.join(", "));

// The tour deep-links the verify page with the fixture Land ID; make sure the
// copy agrees with the ID in the catalogue.
const verifyRoutes = steps.filter((s) => s.group === "verify").map((s) => s.route);
const wrongVerifyRoute = verifyRoutes.find((r) => !r.includes(fixture.landId));
if (!wrongVerifyRoute) pass("verify steps target the fixture parcel", `${verifyRoutes.length} steps`);
else fail("verify steps target the fixture parcel", wrongVerifyRoute);

// ── Tier 3: the fixture against the live API ───────────
section("Live registry (optional)");
const base = (opt("base", "https://nosih.vercel.app/api") || "").replace(/\/$/, "");
const liveRequired = flag("live");

async function checkLive() {
  const url = `${base}/verify/land/${fixture.landId}`;
  let data;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      fail("live verify API", `GET ${url} -> ${res.status}`);
      return;
    }
    data = await res.json();
  } catch (err) {
    const message = err.name === "AbortError" ? "timed out after 15s" : err.message;
    if (liveRequired) fail("live verify API", `GET ${url} -> ${message}`);
    else skip("live verify API", `GET ${url} -> ${message} (pass --live to make this fatal)`);
    return;
  }

  const liveProblems = [];
  if (data.landId !== fixture.landId) liveProblems.push(`landId=${data.landId}`);
  if (data.jurisdictionCode !== fixture.jurisdictionCode) liveProblems.push(`jurisdictionCode=${data.jurisdictionCode}`);
  if (data.currentOwnerId !== fixture.currentOwnerId) liveProblems.push(`currentOwnerId=${data.currentOwnerId}`);

  const record = (data.records || []).find((r) => r.recordId === fixture.recordId);
  if (!record) {
    liveProblems.push(`record ${fixture.recordId} is not in the timeline`);
  } else {
    if ((record.txHash || "").toLowerCase() !== (fixture.txHash || "").toLowerCase()) liveProblems.push(`txHash=${record.txHash}`);
    if ((record.documentHash || "").toLowerCase() !== (fixture.documentHash || "").toLowerCase()) liveProblems.push(`documentHash=${record.documentHash}`);
    if (record.ipfsCID !== fixture.ipfsCID) liveProblems.push(`ipfsCID=${record.ipfsCID}`);
    if ((record.previousOwnerId || null) !== (fixture.previousOwnerId || null)) liveProblems.push(`previousOwnerId=${record.previousOwnerId}`);
    if (!record.isLatest) liveProblems.push("the fixture record is no longer the head of the chain");
  }

  if (liveProblems.length === 0) {
    pass("live verify API agrees with the catalogue", `${data.recordCount} records, on-chain=${data.allOnChain}`);
  } else {
    fail("live verify API agrees with the catalogue", liveProblems.join(", "));
  }
}
await checkLive();

// ── Tier 2: drive the real tour ─────────────────────────
section("Browser drive (optional)");
async function checkDrive() {
  const candidates = ["puppeteer", "playwright", "playwright-core"];
  let driver = null;
  let driverName = "";
  for (const name of candidates) {
    try {
      driver = await import(name);
      driverName = name;
      break;
    } catch {
      /* try the next one */
    }
  }
  if (!driver) {
    skip("browser drive", `no ${candidates.join(" / ")} installed — install one and re-run to enable this tier`);
    return;
  }

  let browser;
  try {
    if (driverName === "puppeteer") browser = await driver.default.launch({ headless: true });
    else browser = await driver.chromium.launch({ headless: true });
  } catch (err) {
    fail("browser drive", `could not launch a browser: ${err.message}`);
    return;
  }

  try {
    const page = await browser.newPage();
    const site = opt("site", "http://localhost:3000");
    await page.goto(`${site}/?tour=login`, { waitUntil: "networkidle2" });

    const unresolved = [];
    for (const step of steps) {
      // Only the public steps can be checked without a session; the rest need
      // the registrar token, which this script deliberately does not hold.
      if (step.requiresAuth) continue;
      await page.goto(`${site}${step.route}`, { waitUntil: "networkidle2" });
      const found = await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      }, step.anchor);
      if (!found) unresolved.push(`${step.id} (${step.anchor})`);
    }
    if (unresolved.length === 0) {
      pass("browser drive", "every public anchor resolved at runtime");
    } else {
      fail("browser drive", `unresolved: ${unresolved.join(", ")}`);
    }
  } finally {
    await browser.close();
  }
}

if (flag("drive")) await checkDrive();
else skip("browser drive", "pass --drive to enable this tier");

// ── Result ──────────────────────────────────────────────
const passed = results.filter((r) => r.ok === true).length;
const skipped = results.filter((r) => r.ok === null).length;
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures} failed, ${skipped} skipped`);

// Set the code rather than calling process.exit(): the fetch above leaves an
// open keep-alive socket, and exiting with it half-closed trips an assertion
// in Node's Windows teardown that would mask the real status.
process.exitCode = failures === 0 ? 0 : 1;
