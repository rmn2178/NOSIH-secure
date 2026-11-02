/**
 * Preflight for a Vercel deployment.
 *
 * Every deployment failure this project has had was invisible until the code
 * was already running in production: a missing environment variable, a
 * native module the file tracer could not see, a PDF.js worker that was never
 * packaged. This script answers all of those questions on the developer's
 * machine, before anything is uploaded.
 *
 *   node scripts/vercel-preflight.mjs
 *
 * It checks, in order:
 *   1. the root .env exists and every boot-critical variable is set
 *   2. the live credentials actually work — Supabase, Pinata, the chain
 *   3. the native modules resolve, including the platform binaries
 *   4. the PDF.js worker and the PDF.js browser globals are in place
 *   5. the OCR core is in place
 *   6. the deployment trace contains every file the code needs
 *
 * It exits 1 when anything is missing, so it can gate a deploy.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BACKEND = path.join(ROOT, "backend");
const require = createRequire(path.join(BACKEND, "package.json"));

let failures = 0;
let checks = 0;

function ok(label, detail = "") {
  checks++;
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
}

function bad(label, detail = "") {
  checks++;
  failures++;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

function skip(label, detail = "") {
  console.log(`  SKIP  ${label}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n▸ ${title}`);
}

// ── 1. Environment ────────────────────────────────────────

function readRootEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return null;
  const values = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function checkEnv() {
  section("Environment");

  const env = readRootEnv();
  if (!env) {
    bad("the root .env exists", `expected it at ${path.join(ROOT, ".env")}`);
    return null;
  }
  ok("the root .env exists");

  // The same list the backend audits at boot.
  const required = [
    ["SUPABASE_URL", (v) => /^https:\/\/\S+\.supabase\.co/.test(v)],
    ["SUPABASE_SERVICE_ROLE_KEY", (v) => v.startsWith("sb_secret_") || v.length >= 32],
    ["JWT_SECRET", (v) => v.length >= 16],
    ["DOCUMENT_ENC_KEY", (v) => /^[0-9a-f]{64}$/i.test(v)],
    ["HASH_PEPPER", (v) => /^[0-9a-f]{64}$/i.test(v)],
    ["CONTRACT_ADDRESS", (v) => /^0x[0-9a-f]{40}$/i.test(v)],
    ["ISSUER_PRIVATE_KEY", (v) => v.replace(/^0x/, "").length === 64],
  ];

  for (const [name, test] of required) {
    const value = String(env[name] || "").trim();
    if (!value) bad(`${name} is set`);
    else if (!test(value)) bad(`${name} is well formed`);
    else ok(`${name} is set and well formed`);
  }

  const optional = ["GEMINI_API_KEY", "PINATA_JWT", "PINATA_API_KEY", "PINATA_API_SECRET"];
  for (const name of optional) {
    if (env[name]) ok(`${name} is set`);
    else skip(`${name} is not set`);
  }

  if (!env.PINATA_JWT && !(env.PINATA_API_KEY && env.PINATA_API_SECRET)) {
    bad("a Pinata credential is available", "set PINATA_JWT or PINATA_API_KEY + PINATA_API_SECRET");
  } else {
    ok("a Pinata credential is available");
  }

  return env;
}

// ── 2. Live credentials ───────────────────────────────────

function checkServices(env) {
  section("Live credentials");

  const run = (script) =>
    spawnSync(process.execPath, [path.join(ROOT, "scripts", script)], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 90000,
      env: { ...process.env, ...env },
    });

  const services = run("check-services.js");
  const output = `${services.stdout || ""}${services.stderr || ""}`;
  if (services.status === 0) {
    ok("the live services accept the configured credentials");
    output
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(0, 8)
      .forEach((l) => console.log(`        ${l.trim()}`));
  } else {
    bad("the live services accept the configured credentials");
    output
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(0, 12)
      .forEach((l) => console.log(`        ${l.trim()}`));
  }

  // The gas report is read-only: it simulates, it never broadcasts.
  const gas = run("check-gas.mjs");
  if (gas.status === 0) {
    ok("the registrar wallet can pay for a registration");
  } else {
    bad("the registrar wallet can pay for a registration");
    console.log(`        ${(gas.stdout || gas.stderr || "").split(/\r?\n/).slice(0, 6).join("\n        ")}`);
  }
}

// ── 3. Native modules ─────────────────────────────────────

function checkNative() {
  section("Native modules");

  const packages = ["sharp", "@napi-rs/canvas"];
  for (const name of packages) {
    try {
      require.resolve(name);
      ok(`${name} is installed`);
    } catch {
      bad(`${name} is installed`);
      continue;
    }
  }

  // The platform binary is what actually makes the module work.
  const scopes = path.join(BACKEND, "node_modules", "@napi-rs");
  let binary = null;
  if (fs.existsSync(scopes)) {
    for (const entry of fs.readdirSync(scopes, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("canvas-")) continue;
      const dir = path.join(scopes, entry.name);
      const found = fs.readdirSync(dir).find((f) => f.endsWith(".node"));
      if (found) binary = path.join(dir, found);
    }
  }
  if (binary) ok("the canvas native binary is present", path.basename(binary));
  else bad("the canvas native binary is present");

  // The canvas build from 1.0.0 compiles its ICU data into the binary. Older
  // builds need a data file next to it, and drawing text without it aborts
  // the process.
  try {
    const version = require("@napi-rs/canvas/package.json").version;
    const [major] = version.split(".").map(Number);
    if (major >= 1) {
      ok("the canvas build carries its own ICU data", `version ${version}`);
    } else {
      const icu = fs
        .readdirSync(path.dirname(binary || ""))
        .some((f) => f === "icudtl.dat");
      if (icu) ok("the canvas ICU data file is present", `version ${version}`);
      else bad("the canvas ICU data file is present", `version ${version} needs icudtl.dat next to the binary`);
    }
  } catch {
    /* the package check above already reported it */
  }
}

// ── 4. PDF.js ─────────────────────────────────────────────

function checkPdfJs() {
  section("PDF.js");

  const worker = path.join(
    BACKEND,
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs"
  );
  if (fs.existsSync(worker)) ok("the PDF.js worker is present");
  else bad("the PDF.js worker is present");

  // The browser globals PDF.js reads at module scope. They are the cause of
  // the "DOMMatrix is not defined" failure in a deployment.
  const canvas = (() => {
    try {
      return require("@napi-rs/canvas");
    } catch {
      return null;
    }
  })();

  if (!canvas) {
    bad("the browser globals PDF.js needs are available");
  } else {
    const missing = ["DOMMatrix", "ImageData", "Path2D"].filter((k) => typeof canvas[k] !== "function");
    if (missing.length) bad("the browser globals PDF.js needs are available", `missing: ${missing.join(", ")}`);
    else ok("the browser globals PDF.js needs are available");
  }
}

// ── 5. OCR ────────────────────────────────────────────────

function checkOcr() {
  section("Local OCR");

  try {
    require.resolve("tesseract.js");
    ok("the Tesseract package is installed");
  } catch {
    bad("the Tesseract package is installed");
    return;
  }

  const coreDir = path.join(BACKEND, "node_modules", "tesseract.js-core");
  const wasm = fs.existsSync(coreDir)
    ? fs.readdirSync(coreDir).filter((f) => f.endsWith(".wasm"))
    : [];
  if (wasm.length) ok("the Tesseract WebAssembly core is present", `${wasm.length} builds`);
  else bad("the Tesseract WebAssembly core is present");
}

// ── 6. The deployment trace ───────────────────────────────

async function checkTrace() {
  section("Deployment trace");

  const nftDir = path.join(os.tmpdir(), "nosih-nft");
  const nftPkg = path.join(nftDir, "node_modules", "@vercel", "nft", "package.json");

  if (!fs.existsSync(nftPkg)) {
    skip("the deployment trace", "@vercel/nft is not installed — run npm run check:deploy for the full check");
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(nftPkg, "utf8"));
  const entry = path.join(nftDir, "node_modules", "@vercel", "nft", manifest.main || "out/index.js");
  const { nodeFileTrace } = await import(pathToFileURL(entry).href);

  const res = await nodeFileTrace([path.join(BACKEND, "server.js")], {
    base: BACKEND,
    mixedModules: true,
    log: () => {},
  });
  const files = [...(res.fileList?.keys?.() ?? [])].map((f) => f.split(path.sep).join("/"));

  const must = [
    ["the PDF.js worker", /pdfjs-dist\/legacy\/build\/pdf\.worker\.mjs$/],
    ["the PDF.js module", /pdfjs-dist\/legacy\/build\/pdf\.mjs$/],
    ["the canvas package", /node_modules\/@napi-rs\/canvas\/package\.json$/],
    ["the canvas native binary", /@napi-rs\/canvas-[^/]+\/.*\.node$/],
    ["the sharp binary", /@img\/sharp-[^/]+\/.*\.node$/],
    ["a Tesseract core", /tesseract\.js-core\/tesseract-core.*\.wasm$/],
    ["the OCR language worker", /tesseract\.js\/.*worker-script\/node\/index\.js$/],
  ];

  for (const [label, pattern] of must) {
    if (files.some((f) => pattern.test(f))) ok(`the trace contains ${label}`);
    else bad(`the trace contains ${label}`, "it would be missing in the deployment");
  }
}

// ── Main ──────────────────────────────────────────────────

console.log("Vercel deployment preflight");
console.log(`  repo : ${ROOT}`);

const env = checkEnv();
if (env) {
  checkServices(env);
} else {
  skip("the live credentials", "no .env to read");
}

checkNative();
checkPdfJs();
checkOcr();
await checkTrace();

console.log("");
if (failures) {
  console.log(`✗ ${failures} of ${checks} checks failed. Fix them before deploying.`);
  process.exit(1);
}
console.log(`✓ all ${checks} checks passed.`);
