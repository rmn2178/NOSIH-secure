/**
 * Reproduces a Vercel deployment locally.
 *
 * The production failure — "DOMMatrix is not defined" — never appeared on a
 * developer machine, because the developer machine has every module the code
 * can reach. A serverless function only has the files the Vercel tracer
 * packaged, and the tracer cannot follow a runtime `require()` buried inside a
 * dependency.
 *
 * So this script does what Vercel does:
 *
 *   1. trace `backend/server.js` with @vercel/nft
 *   2. copy exactly the traced files into a clean directory
 *   3. run the extraction path inside that directory
 *
 * If it works here, it works on Vercel — and if it fails here, the failure is
 * the one that will happen in production.
 *
 *   node scripts/simulate-deploy.mjs            # trace + run the extraction
 *   node scripts/simulate-deploy.mjs --keep     # leave the bundle on disk
 *
 * Requires @vercel/nft. It is not a project dependency, so it is fetched into
 * a temporary directory rather than committed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BACKEND = path.join(ROOT, "backend");
const backendRequire = createRequire(path.join(BACKEND, "package.json"));
const KEEP = process.argv.includes("--keep");

const log = (msg) => console.log(msg);
const step = (msg) => console.log(`\n▸ ${msg}`);

function fail(msg, extra = "") {
  console.error(`\n✗ ${msg}${extra ? `\n${extra}` : ""}`);
  process.exit(1);
}

// ── 1. The tracer ─────────────────────────────────────────

const NFT_DIR = path.join(os.tmpdir(), "nosih-nft");

async function ensureTracer() {
  const probe = path.join(NFT_DIR, "node_modules", "@vercel", "nft", "package.json");
  if (fs.existsSync(probe)) return NFT_DIR;

  log(`  fetching @vercel/nft into ${NFT_DIR} …`);
  const res = spawnSync("npm", ["install", "--no-save", "--prefix", NFT_DIR, "@vercel/nft"], {
    stdio: "inherit",
    shell: true,
  });
  if (res.status !== 0) fail("could not install @vercel/nft");
  if (!fs.existsSync(probe)) fail("@vercel/nft was not installed");
  return NFT_DIR;
}

// ── 2. Trace and assemble ─────────────────────────────────

async function buildBundle(outDir) {
  const nftDir = await ensureTracer();
  // A file URL — an absolute Windows path is not a valid ESM specifier.
  // The entry point is read from the package itself, so the path follows
  // whatever layout the published version uses.
  const nftPkg = JSON.parse(
    fs.readFileSync(path.join(nftDir, "node_modules", "@vercel", "nft", "package.json"), "utf8")
  );
  const nftEntry = path.join(nftDir, "node_modules", "@vercel", "nft", nftPkg.main || "out/index.js");
  const { nodeFileTrace } = await import(pathToFileURL(nftEntry).href);

  const res = await nodeFileTrace([path.join(BACKEND, "server.js")], {
    base: BACKEND,
    mixedModules: true,
    log: () => {},
  });

  const files = [...(res.fileList?.keys?.() ?? [])];
  if (!files.length) fail("the tracer returned no files");

  log(`  traced ${files.length} files`);
  fs.mkdirSync(outDir, { recursive: true });

  let copied = 0;
  for (const rel of files) {
    const from = path.join(BACKEND, rel);
    const to = path.join(outDir, rel);
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied++;
    } catch {
      /* a file that vanished between trace and copy is not fatal */
    }
  }
  log(`  copied ${copied} files into the bundle`);

  // The canvas ICU data file.
  //
  // The Windows build of @napi-rs/canvas ships its ICU data as a separate
  // file next to the native binary; the Linux build compiles it into the
  // binary and ships no file. Vercel runs on Linux, so the file is not needed
  // there — but this simulation runs on the developer's machine, so it is
  // copied in to keep the two platforms comparable.
  const icuCopied = copyIcuData(BACKEND, outDir);
  if (icuCopied) log(`  copied the canvas ICU data file (${icuCopied})`);

  // The entry point and its own sources are traced too, but the probe needs
  // the backend's own module graph, which nft resolves from the base path.
  return { fileCount: files.length, copied };
}

/** Finds the canvas ICU data file in node_modules and copies it into the bundle. */
function copyIcuData(fromBase, toBase) {
  const scopes = path.join(fromBase, "node_modules", "@napi-rs");
  if (!fs.existsSync(scopes)) return null;
  for (const entry of fs.readdirSync(scopes, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("canvas-")) continue;
    const src = path.join(scopes, entry.name, "icudtl.dat");
    if (!fs.existsSync(src)) continue;
    const dst = path.join(toBase, "node_modules", "@napi-rs", entry.name, "icudtl.dat");
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return entry.name;
  }
  return null;
}

// ── 3. Run the extraction inside the bundle ───────────────

function runProbe(bundleDir, pdfPath, label = "probe.pdf") {
  // The probe imports the service exactly as the route does.
  const probe = path.join(bundleDir, "__probe.mjs");
  fs.writeFileSync(
    probe,
    `import { extractDeedMetadata, shutdownExtraction } from "./services/ai.js";
import { existsSync } from "node:fs";

// The service logs the strategy that answered as "[ai] strategy: <id>".
// Reading that marker — rather than a copy of the wording — means the probe
// keeps reporting the truth when the chain is reordered.
const lines = [];
const original = console.log;
console.log = (...args) => { lines.push(args.join(" ")); original(...args); };

const pdf = process.argv[2];
if (!pdf || !existsSync(pdf)) {
  console.log("PROBE_RESULT no-pdf");
  process.exit(0);
}

// Every local step runs before Gemini is called, so the strategies that were
// reached prove the local machinery works. The Gemini call itself fails
// immediately without a key, which is exactly what is wanted here: the
// network is not what this probe is testing.
let error = "";
try {
  await extractDeedMetadata(pdf, process.argv[3] || "probe.pdf");
} catch (err) {
  error = err && err.message ? err.message : String(err);
} finally {
  // Release the OCR worker thread before the process exits.
  try { await shutdownExtraction(); } catch { /* it is going away anyway */ }
}

const reached = [...new Set(lines.map((l) => l.match(/^\\[ai\\] strategy: ([a-z-]+)/)?.[1]).filter(Boolean))];
console.log("PROBE_RESULT " + (reached.join("+") || "none") + (error ? " error=" + error : ""));
`,
    "utf8"
  );

  const res = spawnSync(process.execPath, [probe, pdfPath || "", label], {
    cwd: bundleDir,
    encoding: "utf8",
    timeout: Number(process.env.PROBE_TIMEOUT_MS || 240000),
    env: {
      ...process.env,
      NODE_PATH: path.join(bundleDir, "node_modules"),
      // No key on purpose: the Gemini call fails at once, and the probe
      // measures the local machinery rather than the network.
      GEMINI_API_KEY: "",
    },
  });

  const out = `${res.stdout || ""}${res.stderr || ""}`;
  const line = out.split(/\r?\n/).find((l) => l.startsWith("PROBE_RESULT "));
  return { result: line ? line.slice("PROBE_RESULT ".length) : "no-result", output: out };
}

// ── 4. Check what the bundle contains ─────────────────────

/**
 * Builds a scanned-style deed: one page holding a JPEG image and no text
 * layer. This is the shape of PDF that sends the extractor down the
 * whole-PDF, vision and OCR paths.
 */
function buildScannedPdf(outFile) {
  const { createCanvas } = backendRequire("@napi-rs/canvas");

  const canvas = createCanvas(1000, 700);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1000, 700);
  ctx.fillStyle = "#111111";
  ctx.font = "bold 30px Helvetica";
  ctx.fillText("DEED OF SALE", 60, 90);
  ctx.font = "18px Helvetica";
  [
    "This deed of sale is made between the vendor and the purchaser.",
    "Survey Number 1963/3000, Village Malibu Nagar,",
    "Taluk Andheri, District Mumbai Suburban, State Maharashtra.",
    "Area 0.0450 acres. Document type Sale Deed.",
    "Registration number 1234/2026 dated 2026-11-01.",
    "Sub-Registrar Office Andheri (SRO-04), Mumbai.",
  ].forEach((line, i) => ctx.fillText(line, 60, 160 + i * 40));
  const jpeg = canvas.toBuffer("image/jpeg", 90);

  // A minimal PDF whose only page shows that image.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 350] " +
      "/Resources << /XObject << /Im0 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /XObject /Subtype /Image /Width 1000 /Height 700 ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\n` +
      `stream\n${jpeg.toString("binary")}\nendstream`,
    "<< /Length 44 >>\nstream\nq 500 0 0 350 0 0 cm /Im0 Do Q\nendstream",
  ];

  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  fs.writeFileSync(outFile, Buffer.from(body, "binary"));
  return outFile;
}

/**
 * Builds a one-page PDF with a text layer, so the probe has something real
 * to read.
 *
 * The page has to be wide enough for the text: PDF.js only extracts what
 * falls inside the page box, so text laid out beyond it is invisible to the
 * extractor. The layer also has to exceed the 200-character threshold the
 * service uses, otherwise the probe falls through to a path that needs the
 * Gemini key.
 */
function buildTestPdf(outFile) {
  const lines = [
    "NOSIH deployment simulation.",
    "This document stands in for a registered property deed. It exists to",
    "prove that the extraction path works inside a packaged serverless",
    "function, on the same code path the registrar uses in production.",
    "Survey number 1963, subdivision 4A, Malibu Nagar, Andheri East,",
    "Andheri, Mumbai Suburban District, Maharashtra. Area 0.0450 acres.",
    "Sale Deed, registration number 1234 of 2026, dated 2026-11-01,",
    "Sub-Registrar Office Andheri. Executant Peter Parker, claimant",
    "Zendaya. North boundary road, south boundary canal, east boundary",
    "field, west boundary plot number 77.",
  ];

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 220] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  // One text-showing operation per line, laid out down the page.
  const parts = ["BT /F1 9 Tf 20 190 Td 12 TL"];
  lines.forEach((line, i) => {
    if (i > 0) parts.push("T*");
    parts.push(`(${line}) Tj`);
  });
  parts.push("ET");
  const stream = parts.join("\n");
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);

  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  fs.writeFileSync(outFile, Buffer.from(body, "latin1"));
  return outFile;
}
function auditBundle(bundleDir) {
  const nm = path.join(bundleDir, "node_modules");
  const has = (rel) => fs.existsSync(path.join(nm, rel));

  console.log("  bundle contents:");

  const named = [
    ["PDF.js worker", "pdfjs-dist/legacy/build/pdf.worker.mjs"],
    ["PDF.js main module", "pdfjs-dist/legacy/build/pdf.mjs"],
    ["@napi-rs/canvas (root)", "@napi-rs/canvas/index.js"],
    ["@napi-rs/canvas (under pdfjs-dist)", "pdfjs-dist/node_modules/@napi-rs/canvas/index.js"],
    ["@napi-rs/canvas (under pdf-to-png-converter)", "pdf-to-png-converter/node_modules/@napi-rs/canvas/index.js"],
    ["sharp", "sharp/package.json"],
  ];
  for (const [label, rel] of named) {
    console.log(`    ${has(rel) ? "present" : "MISSING"}  ${label}`);
  }

  // Every native binary in the bundle, wherever it sits.
  const binaries = [];
  const walk = (dir, depth = 0) => {
    if (depth > 5) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.endsWith(".node")) binaries.push(path.relative(nm, p));
      else if (e.isDirectory()) walk(p, depth + 1);
    }
  };
  walk(nm);
  console.log(`    ${binaries.length ? "present" : "MISSING"}  native binaries → ${binaries.join(", ") || "none"}`);

  // The platform-specific canvas packages decide whether the native module can
  // actually load on the deploy platform.
  const platformPkgs = [];
  for (const e of fs.existsSync(nm) ? fs.readdirSync(nm, { withFileTypes: true }) : []) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("@")) {
      for (const s of fs.readdirSync(path.join(nm, e.name), { withFileTypes: true })) {
        if (s.isDirectory() && /canvas|sharp/.test(s.name)) platformPkgs.push(`${e.name}/${s.name}`);
      }
    } else if (/canvas|sharp/.test(e.name)) {
      platformPkgs.push(e.name);
    }
  }
  console.log(`    platform packages → ${platformPkgs.join(", ") || "none"}`);
}

// ── Main ──────────────────────────────────────────────────

console.log("Vercel deployment simulation");
console.log(`  repo    : ${ROOT}`);
console.log(`  backend : ${BACKEND}`);

const bundleDir = path.join(os.tmpdir(), `nosih-deploy-sim-${Date.now()}`);

step("tracing the function with @vercel/nft");
await buildBundle(bundleDir);

step("auditing the assembled bundle");
auditBundle(bundleDir);

step("running the extraction path inside the bundle");

// Two fixtures, because they exercise different halves of the chain.
//
//   text.pdf     has a text layer, so the chain stops at the first strategy
//   scanned.pdf  has no text layer, so the pages are rendered and recognised
//                locally, and the resulting text dump is what goes to Gemini
//
// Both have to work: a deployment that reads a digital deed but cannot read
// a photocopy of one is only half fixed.
const probePdf = buildTestPdf(path.join(bundleDir, "probe-text.pdf"));
const scannedPdf = buildScannedPdf(path.join(bundleDir, "probe-scanned.pdf"));

const textRun = runProbe(bundleDir, probePdf, "text.pdf");
console.log("  text deed   :", textRun.result);

const scannedRun = runProbe(bundleDir, scannedPdf, "scanned.pdf");
console.log("  scanned deed:", scannedRun.result);
console.log("  --- function output (scanned) ---");
console.log(scannedRun.output.split(/\r?\n/).map((l) => `  ${l}`).join("\n"));

const results = [textRun.result, scannedRun.result];
// startsWith, not includes: the scanned deed must be read by local OCR first,
// not rescued by it after the whole-PDF and vision paths have already failed.
const okText = results[0].startsWith("text-layer");
const okScanned = results[1].startsWith("local-ocr");

if (!okText || !okScanned) {
  console.log("\n  The simulated deployment FAILS. The trace above is the package");
  console.log("  Vercel would upload — a module it cannot see is a module that");
  console.log("  will not be there in production.");
  if (!KEEP) fs.rmSync(bundleDir, { recursive: true, force: true });
  process.exit(2);
}

if (!KEEP) fs.rmSync(bundleDir, { recursive: true, force: true });
else log(`\n  bundle kept at ${bundleDir}`);

console.log("\n✓ The simulated deployment works.");
console.log("  A digital deed reads through the text layer.");
console.log("  A scanned deed falls through to the local OCR path — every module");
console.log("  it needs was in the package the tracer produced.");
