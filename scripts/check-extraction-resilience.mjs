/**
 * Proves the extraction chain's failure behaviour — offline.
 *
 *   node scripts/check-extraction-resilience.mjs
 *
 * A local stand-in server answers in place of Gemini, so the retry, the
 * backoff, the time budget and the payload can all be asserted exactly, with
 * no quota spent, no network dependency and nothing written to the ledger.
 * The real-API companion is check-extraction.mjs.
 *
 * What is proved here:
 *
 *   1. the returnable schema really reaches the API — responseMimeType and
 *      responseSchema are in the request body, covering every deed field;
 *   2. a scanned deed is sent as a TEXT dump: no image part, no PDF part;
 *   3. a transient 503 is retried with a growing backoff, and the deed still
 *      reads on the attempt that succeeds;
 *   4. a permanent 400 is not retried and does not drag the chain through
 *      three more strategies that would fail identically;
 *   5. a model that stays busy exhausts its attempts on every strategy and
 *      then hands the registrar the manual-entry message;
 *   6. a spent budget stops the chain before it renders anything.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildTextDeed,
  buildScannedDeed,
  DEED_EXPECTED,
  DEED_AREA,
} from "./lib/deed-fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BACKEND = path.join(ROOT, "backend");
const SERVICE = path.join(BACKEND, "services", "ai.js");

const { DEED_FIELDS, RESPONSE_SCHEMA, EXTRACTION_STRATEGIES } = await import(
  pathToFileURL(SERVICE).href
);

const MANUAL_ENTRY =
  "This deed could not be read automatically. You can fill the form manually.";

/** The answer the stand-in model returns, matching what the fixtures state. */
const STAND_IN_ANSWER = {
  ...DEED_EXPECTED,
  area: String(DEED_AREA),
  subdivisionNumber: "",
  boundaryNorth: "",
  boundarySouth: "",
  boundaryEast: "",
  boundaryWest: "",
  sroOffice: "Andheri (SRO-04), Mumbai",
};

// ── The stand-in model ────────────────────────────────────

/** @type {{ at: number, body: any }[]} */
let requests = [];
/** How the stand-in answers. Changed between scenarios, which run in series. */
let mode = { status: 200, failFirst: 0 };

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      /* a malformed request is itself a finding */
    }
    requests.push({ at: Date.now(), body });

    const attempt = requests.length;
    const failing = mode.status !== 200 && attempt <= (mode.failFirst ?? Infinity);

    if (failing) {
      const message =
        mode.status === 503
          ? "The model is overloaded. Please try again later."
          : "API key not valid. Please pass a valid API key.";
      res.writeHead(mode.status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: mode.status,
            message,
            status: mode.status === 503 ? "UNAVAILABLE" : "INVALID_ARGUMENT",
          },
        })
      );
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify(STAND_IN_ANSWER) }], role: "model" },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        modelVersion: "stand-in",
      })
    );
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE_URL = `http://127.0.0.1:${server.address().port}`;

// ── The probe ─────────────────────────────────────────────

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nosih-resilience-"));
const textDeed = buildTextDeed(path.join(workDir, "text-deed.pdf"));
const scannedDeed = buildScannedDeed(path.join(workDir, "scanned-deed.pdf"));

const probe = path.join(workDir, "probe.mjs");
fs.writeFileSync(
  probe,
  `import { extractDeedMetadata, isUsefulExtraction, shutdownExtraction } from "${pathToFileURL(SERVICE).href}";
const lines = [];
for (const level of ["log", "warn", "error"]) {
  const original = console[level];
  console[level] = (...a) => { lines.push(a.join(" ")); original(...a); };
}
let error = "";
let data = null;
try {
  data = await extractDeedMetadata(process.argv[2], "resilience.pdf");
} catch (err) {
  error = err && err.message ? err.message : String(err);
} finally {
  try { await shutdownExtraction(); } catch { /* it is going away anyway */ }
}
const reached = [...new Set(lines.map((l) => l.match(/^\\[ai\\] strategy: ([a-z-]+)/)?.[1]).filter(Boolean))];
const retries = lines.filter((l) => /retry \\d+\\/\\d+ in \\d+ ms/.test(l)).length;
console.log("PROBE_RESULT " + JSON.stringify({ reached, retries, error, data, useful: isUsefulExtraction(data), lines }));
`,
  "utf8"
);

/**
 * Runs one extraction against the stand-in.
 *
 * A fresh child process per scenario, because the service caches its client
 * and its OCR worker for the life of the instance — reusing one process would
 * let a previous scenario's state answer for the next.
 */
function run(pdf, env) {
  requests = [];
  const startedAt = Date.now();
  const res = spawnSync(process.execPath, [probe, pdf], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180000,
    env: {
      ...process.env,
      GEMINI_API_KEY: "stand-in-key-not-a-real-secret",
      GEMINI_BASE_URL: BASE_URL,
      GEMINI_MODEL: "gemini-3.6-flash",
      GEMINI_TIMEOUT_MS: "8000",
      GEMINI_PDF_TIMEOUT_MS: "8000",
      GEMINI_MAX_ATTEMPTS: "3",
      GEMINI_BACKOFF_MS: "120",
      EXTRACTION_BUDGET_MS: "60000",
      ...env,
    },
  });

  const out = `${res.stdout || ""}${res.stderr || ""}`;
  const elapsed = Date.now() - startedAt;
  const line = out.split(/\r?\n/).find((l) => l.startsWith("PROBE_RESULT "));
  if (!line) {
    return { failed: true, out, elapsed, reached: [], retries: 0, error: "the probe did not report", data: null };
  }
  return { ...JSON.parse(line.slice("PROBE_RESULT ".length)), failed: false, out, elapsed };
}

// ── Assertions ────────────────────────────────────────────

let failures = 0;
let checks = 0;

function check(label, condition, detail = "") {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

/** Every request must carry the returnable schema. */
function schemaSent() {
  return requests.every((r) => {
    const gc = r.body?.generationConfig;
    return (
      gc?.responseMimeType === "application/json" &&
      Array.isArray(gc?.responseSchema?.required) &&
      gc.responseSchema.required.length === DEED_FIELDS.length &&
      DEED_FIELDS.every((f) => f in (gc.responseSchema.properties ?? {}))
    );
  });
}

/** The parts of a request, flattened. */
function partsOf(request) {
  return (request?.body?.contents ?? []).flatMap((c) => c.parts ?? []);
}

console.log("Extraction resilience check — local stand-in, no API quota");
console.log(`  stand-in : ${BASE_URL}`);
console.log(`  fields   : ${DEED_FIELDS.length}`);

// ── 1. The schema is a contract, not a suggestion ─────────

console.log("\n▸ the returnable schema");
check(
  "RESPONSE_SCHEMA covers every deed field, in order",
  RESPONSE_SCHEMA.required.join() === DEED_FIELDS.join() &&
    Object.keys(RESPONSE_SCHEMA.properties).join() === DEED_FIELDS.join(),
  `required=${RESPONSE_SCHEMA.required.length} properties=${Object.keys(RESPONSE_SCHEMA.properties).length}`
);
check(
  "every field has a description",
  DEED_FIELDS.every((f) => (RESPONSE_SCHEMA.properties[f]?.description || "").length > 0)
);
check(
  "the strategy list and the chain agree on four paths",
  EXTRACTION_STRATEGIES.map((s) => s.id).join() === "text-layer,local-ocr,whole-pdf,rendered-vision",
  EXTRACTION_STRATEGIES.map((s) => s.id).join()
);

// ── 2. A scanned deed leaves as text ──────────────────────

console.log("\n▸ a scanned deed is sent as a text dump");
mode = { status: 200 };
let r = run(scannedDeed, {});
check("the local OCR strategy answered first", r.reached[0] === "local-ocr", r.reached.join(" → ") || "none");
check("exactly one model call was needed", requests.length === 1, `${requests.length} calls`);
check("the extraction succeeded", !r.error && r.useful, r.error);
check(
  "the request carried the returnable schema",
  requests.length > 0 && schemaSent()
);
{
  const parts = partsOf(requests[0]);
  const inline = parts.filter((p) => p.inlineData || p.fileData);
  check("no image and no PDF part was sent", parts.length > 0 && inline.length === 0, `${inline.length} binary part(s)`);
  const text = parts.map((p) => p.text || "").join("\n");
  check("the payload is the OCR dump, page marker and all", text.includes("--- page 1 ---"));
  check("the deed's own survey number is in the dump", text.includes("1963/3000"));
}

// ── 3. A transient failure is retried ─────────────────────

console.log("\n▸ a busy model is retried with a backoff");
mode = { status: 503, failFirst: 2 };
r = run(textDeed, { GEMINI_MAX_ATTEMPTS: "3", GEMINI_BACKOFF_MS: "120" });
check("three attempts were made", requests.length === 3, `${requests.length} calls`);
check("two retries were logged", r.retries === 2, `${r.retries} logged`);
check("the deed still read on the attempt that succeeded", !r.error && r.useful, r.error);
check("the text layer answered — no rendering was needed", r.reached.join() === "text-layer", r.reached.join());
{
  const gap1 = requests[1] && requests[0] ? requests[1].at - requests[0].at : 0;
  const gap2 = requests[2] && requests[1] ? requests[2].at - requests[1].at : 0;
  check("the first backoff was waited out", gap1 >= 110, `${gap1} ms`);
  check("the second backoff grew", gap2 >= 230 && gap2 > gap1, `${gap1} ms then ${gap2} ms`);
}
check(
  "the fields came back as the fixture states them",
  r.data && DEED_FIELDS.every((f) => f in r.data) && r.data.surveyNumber === DEED_EXPECTED.surveyNumber,
  JSON.stringify(r.data)
);

// ── 4. A permanent failure is not retried ─────────────────

console.log("\n▸ a rejected key stops the chain at once");
mode = { status: 400 };
r = run(textDeed, {});
check("exactly one call was made — no retry, no fall-through", requests.length === 1, `${requests.length} calls`);
check("no retry was logged", r.retries === 0, `${r.retries} logged`);
check("the cause is in the log", /failed permanently/.test(r.out));
check("the registrar is told to fill the form in", r.error === MANUAL_ENTRY, r.error);
check(
  "no server configuration detail reached the caller",
  !/api[ _-]?key|GEMINI|stand-in/i.test(r.error),
  r.error
);

// ── 5. A model that stays busy exhausts its attempts ──────

console.log("\n▸ a model that never recovers");
mode = { status: 503 };
r = run(textDeed, { GEMINI_MAX_ATTEMPTS: "2", GEMINI_BACKOFF_MS: "60" });
check("at least one strategy was tried", requests.length >= 2, `${requests.length} calls`);
check(
  "every strategy used exactly its two attempts",
  requests.length % 2 === 0 && r.retries === requests.length / 2,
  `${requests.length} calls, ${r.retries} retries`
);
check("the chain ended with the manual-entry message", r.error === MANUAL_ENTRY, r.error);
check("the whole run stayed inside its 60 s budget", r.elapsed < 60000, `${r.elapsed} ms`);

// ── 6. A spent budget stops before the expensive work ─────

console.log("\n▸ a spent time budget");
mode = { status: 200 };
r = run(scannedDeed, { EXTRACTION_BUDGET_MS: "1" });
check("no model call was made", requests.length === 0, `${requests.length} calls`);
check("no page was rendered", !/render pages:/.test(r.out));
check("the budget is named in the log", /the extraction budget of 1 ms is spent/.test(r.out));
check("the registrar is told to fill the form in", r.error === MANUAL_ENTRY, r.error);

// ── Done ──────────────────────────────────────────────────

server.close();
fs.rmSync(workDir, { recursive: true, force: true });

console.log("");
if (failures) {
  console.log(`✗ ${failures} of ${checks} resilience checks failed.`);
  process.exit(1);
}
console.log(`✓ all ${checks} resilience checks passed.`);
console.log("  The schema reaches the API, a scan leaves as text, a busy model");
console.log("  is retried, a rejected key stops at once, and a spent budget");
console.log("  stops before any page is rendered.");