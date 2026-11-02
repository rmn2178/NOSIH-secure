/**
 * Exercises the extraction chain against the real Gemini API.
 *
 *   node scripts/check-extraction.mjs [file.pdf]
 *
 * With no argument it builds both fixtures — a digital deed and a scanned
 * one — and runs each through the service. It asserts three things, not one:
 *
 *   - the extraction succeeded and was useful,
 *   - the *expected* strategy answered (a digital deed must not be rendered;
 *     a scanned deed must be read locally and sent as a text dump),
 *   - every field the fixture states came back with the value it states.
 *
 * The middle assertion is the one that matters most. A useful answer from the
 * wrong strategy means the chain fell through to a slower, more expensive path
 * — and, for a scanned deed, that deed images left the server when they did
 * not need to.
 *
 * Passing a file of your own skips the strategy and field assertions, since
 * the script cannot know what that deed says.
 *
 * This check calls the real API and spends quota. The offline companion,
 * check-extraction-resilience.mjs, proves the retry and budget behaviour
 * against a local stand-in instead.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

const given = process.argv[2];

// ── Run ───────────────────────────────────────────────────

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nosih-extract-"));
const cases = given
  ? [[path.resolve(given), path.basename(given), null]]
  : [
      // A digital deed must not be rendered at all.
      [buildTextDeed(path.join(workDir, "text-deed.pdf")), "text deed", "text-layer"],
      // A scanned deed must be read locally and sent as a text dump, not as
      // images and not as the whole PDF.
      [buildScannedDeed(path.join(workDir, "scanned-deed.pdf")), "scanned deed", "local-ocr"],
    ];

const service = path.join(BACKEND, "services", "ai.js");
const { EXTRACTION_STRATEGIES } = await import(pathToFileURL(service).href);
const strategyName = (id) => EXTRACTION_STRATEGIES.find((s) => s.id === id)?.name ?? id;
const probe = path.join(workDir, "probe.mjs");
fs.writeFileSync(
  probe,
  `import { extractDeedMetadata, isUsefulExtraction, shutdownExtraction } from "${pathToFileURL(service).href}";
const file = process.argv[2];
const lines = [];
const original = console.log;
console.log = (...a) => { lines.push(a.join(" ")); original(...a); };
let error = "";
let data = null;
try {
  data = await extractDeedMetadata(file, "check.pdf");
} catch (err) {
  error = err && err.message ? err.message : String(err);
} finally {
  // The OCR worker is a live thread; exiting with it running trips a libuv
  // assertion. Release it before the result is printed and the process ends.
  try { await shutdownExtraction(); } catch { /* it is going away anyway */ }
}
// The service logs the strategy that answered as "[ai] strategy: <id>".
// Reading that marker — rather than a copy of the wording — is what keeps this
// check honest when the chain is reordered or a log line is reworded.
const reached = [...new Set(lines.map((l) => l.match(/^\\[ai\\] strategy: ([a-z-]+)/)?.[1]).filter(Boolean))];
console.log("EXTRACT_RESULT " + JSON.stringify({ reached, error, data, useful: isUsefulExtraction(data) }));
`,
  "utf8"
);

console.log("Extraction check — real Gemini API");
console.log(`  gemini key : ${process.env.GEMINI_API_KEY ? "from the environment" : "from the root .env"}`);
console.log(`  model      : ${process.env.GEMINI_MODEL || "gemini-3.6-flash (default)"}`);

let failures = 0;
for (const [file, label, expectedStrategy] of cases) {
  const res = spawnSync(process.execPath, [probe, file], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300000,
    env: { ...process.env },
  });

  const out = `${res.stdout || ""}${res.stderr || ""}`;
  const line = out.split(/\r?\n/).find((l) => l.startsWith("EXTRACT_RESULT "));
  if (!line) {
    console.log(`  FAIL  ${label} — the extractor did not report a result`);
    out.split(/\r?\n/).slice(-8).forEach((l) => console.log(`        ${l}`));
    failures++;
    continue;
  }

  const parsed = JSON.parse(line.slice("EXTRACT_RESULT ".length));
  const strategy = parsed.reached.map(strategyName).join(" → ") || "none";

  if (parsed.error) {
    console.log(`  FAIL  ${label} — ${strategy}: ${parsed.error}`);
    failures++;
    continue;
  }
  if (!parsed.useful) {
    console.log(`  FAIL  ${label} — ${strategy}: the extraction was not useful`);
    console.log(`        ${JSON.stringify(parsed.data)}`);
    failures++;
    continue;
  }

  const problems = [];
  if (expectedStrategy) {
    if (parsed.reached[0] !== expectedStrategy) {
      problems.push(`expected ${strategyName(expectedStrategy)}, got ${strategy}`);
    }
    for (const [key, want] of Object.entries(DEED_EXPECTED)) {
      const got = parsed.data[key] ?? "";
      if (got.toLowerCase() !== want.toLowerCase()) problems.push(`${key}: "${got}" ≠ "${want}"`);
    }
    const area = Number(parsed.data.area);
    if (!Number.isFinite(area) || Math.abs(area - DEED_AREA) > 1e-6) {
      problems.push(`area: "${parsed.data.area}" ≠ ${DEED_AREA}`);
    }
  }

  if (problems.length) {
    console.log(`  FAIL  ${label} — ${strategy}`);
    problems.forEach((p) => console.log(`        ${p}`));
    failures++;
    continue;
  }

  console.log(`  PASS  ${label} — ${strategy}`);
  console.log(`        survey=${parsed.data.surveyNumber} area=${parsed.data.area} ${parsed.data.areaUnit}`);
  console.log(`        buyer=${parsed.data.buyerName} seller=${parsed.data.sellerName}`);
  console.log(`        ${parsed.data.village}, ${parsed.data.taluk}, ${parsed.data.district}, ${parsed.data.state}`);
  console.log(`        ${parsed.data.documentType} · ${parsed.data.registrationNumber} · ${parsed.data.registrationDate}`);
  console.log(`        ${parsed.data.sroOffice}`);
}

fs.rmSync(workDir, { recursive: true, force: true });
console.log("");
if (failures) {
  console.log(`✗ ${failures} extraction check(s) failed.`);
  process.exit(1);
}
console.log("✓ every extraction check passed.");
console.log("  A digital deed read through its text layer; a scanned deed was");
console.log("  recognised locally and sent to the model as a text dump.");