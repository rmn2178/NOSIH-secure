/**
 * Pushes every environment variable the backend needs to the Vercel project.
 *
 * The values come straight from the local .env files, so the only manual step
 * is `vercel login` (and, the first time, linking the folder to the project).
 *
 *   vercel login
 *   node scripts/vercel-env.mjs
 *
 * Options:
 *   --project <name>   Vercel project to link (default: nosih-secure)
 *   --env <name>       Target environment (default: production)
 *   --preview          Also add the variables to the preview environment
 *   --dry-run          Print what would be sent without contacting Vercel
 *   --only a,b,c       Restrict to these variable names
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// ── Arguments ──
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PROJECT = option("--project", "nosih-secure");
const TARGET = option("--env", "production");
const ALSO_PREVIEW = flag("--preview");
const DRY_RUN = flag("--dry-run");
const ONLY = option("--only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ── Read the env files ──
function readEnvFile(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return {};

  const out = {};
  for (const raw of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const backendEnv = readEnvFile(path.join("backend", ".env"));
const rootEnv = readEnvFile(".env");

// backend/.env wins, then the root file.
const merged = { ...rootEnv, ...backendEnv };

// The variables the Vercel function needs. Everything else (PORT, NODE_ENV,
// DATABASE_URL, VERIFY_BASE_URL, BACKEND_PUBLIC_URL) stays local — Vercel
// sets VERCEL itself and derives the public URL from the request host.
const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
  "JWT_EXPIRES_IN",
  "DOCUMENT_ENC_KEY",
  "HASH_PEPPER",
  "CONTRACT_ADDRESS",
  "ISSUER_PRIVATE_KEY",
  "AMOY_RPC_URL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "PINATA_API_KEY",
  "PINATA_API_SECRET",
  "VIEW_DOCUMENT_POLICY",
  "IPFS_GATEWAY_BASE_URL",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
];

const OPTIONAL = ["ALCHEMY_AMOY_URL", "PINATA_JWT", "MAX_UPLOAD_MB", "FRONTEND_URL"];

const wanted = ONLY.length ? REQUIRED.filter((n) => ONLY.includes(n)) : [...REQUIRED, ...OPTIONAL];

const missing = [];
const present = [];

for (const name of wanted) {
  let value = merged[name];
  if (value && value.trim()) {
    // The local FRONTEND_URL points at the dev server. In production the
    // SPA is served from the same domain as the API, so the allowed origin
    // is the project's own domain.
    if (name === "FRONTEND_URL" && /localhost|127\.0\.0\.1/.test(value)) {
      value = `https://${PROJECT}.vercel.app`;
    }
    present.push([name, value]);
  } else if (REQUIRED.includes(name)) {
    missing.push(name);
  }
}

console.log(`Project    : ${PROJECT}`);
console.log(`Environment: ${TARGET}${ALSO_PREVIEW ? " (+ preview)" : ""}`);
console.log(`Variables  : ${present.length} found, ${missing.length} missing`);
console.log("");

if (missing.length) {
  console.error("Missing required variables (not present in .env files):");
  for (const name of missing) console.error(`  - ${name}`);
  console.error("");
}

if (DRY_RUN) {
  for (const [name, value] of present) {
    const shown = value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : "***";
    console.log(`  ${name} = ${shown}`);
  }
  console.log("");
  console.log("Dry run — nothing was sent to Vercel.");
  process.exit(missing.length ? 1 : 0);
}

// ── Vercel CLI ──
function run(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("vercel", args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";

    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));

    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

// Link first — the CLI needs a project to attach the variables to.
console.log("Linking the local folder to the Vercel project…");
const link = await run(["link", "--project", PROJECT, "--yes"]);
if (link.code !== 0) {
  console.error(link.out || link.err);
  console.error("\nRun `vercel login` first, then try again.");
  process.exit(1);
}
console.log("Linked.");
console.log("");

const environments = ALSO_PREVIEW ? [TARGET, "preview"] : [TARGET];
let failures = 0;

for (const env of environments) {
  console.log(`→ ${env}`);
  for (const [name, value] of present) {
    const res = await run(["env", "add", name, env, "--force"], { input: value });
    const ok = res.code === 0;
    if (!ok) failures++;
    console.log(`  ${ok ? "added" : "FAILED"}  ${name}`);
    if (!ok) console.error(`      ${(res.err || res.out).trim().split("\n").slice(-3).join(" ")}`);
  }
}

console.log("");
console.log(failures ? `${failures} variable(s) failed.` : "All variables uploaded.");
console.log("Redeploy for them to take effect:  vercel --prod");

process.exit(failures ? 1 : 0);
