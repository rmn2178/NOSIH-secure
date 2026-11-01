/**
 * Audit the Vercel environment-variable list in README.md against the vars
 * the code actually reads.
 *
 *   node scripts/check-vercel-env.js
 *
 * Flags any variable the backend or frontend reads that the README's Vercel
 * section does not mention, so nothing is discovered as a runtime error
 * after deploying.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const README = path.join(ROOT, "README.md");

// Vars read only by local admin scripts, or deliberately absent on Vercel.
const LOCAL_ONLY = new Set([
  "DATABASE_URL",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "DEPLOYER_PRIVATE_KEY",
  "ISSUER_ADDRESS",
  "CHAIN_ID",
  "POLYGONSCAN_API_KEY",
  "MUMBAI_RPC_URL",
  "POLYGON_RPC_URL",
  // Production derives the verify URL from the incoming request host.
  "VERIFY_BASE_URL",
  // Single-domain deployment: the SPA calls same-origin /api, so no absolute
  // API URL is needed and none should be baked into the bundle.
  "REACT_APP_API_URL",
]);

// Hardcoded by the platform on Vercel.
const PLATFORM_MANAGED = new Set(["VERCEL", "PORT", "NODE_ENV"]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "build") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|cjs|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const used = new Map(); // var -> Set of files

for (const file of [...walk(path.join(ROOT, "backend")), ...walk(path.join(ROOT, "frontend", "src"))]) {
  if (file.includes("node_modules")) continue;
  const src = fs.readFileSync(file, "utf8");
  const patterns = [/process\.env\.([A-Z_][A-Z0-9_]*)/g, /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g, /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(path.relative(ROOT, file).replace(/\\/g, "/"));
    }
  }
}

// Also catch vars read by name via a lookup helper (landIdentity.js requireHexKey).
for (const file of walk(path.join(ROOT, "backend"))) {
  const src = fs.readFileSync(file, "utf8");
  const re = /requireHexKey\(\s*"([A-Z_][A-Z0-9_]*)"\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(path.relative(ROOT, file).replace(/\\/g, "/"));
  }
}

// The README's Vercel env block
const readme = fs.readFileSync(README, "utf8");
const sectionStart = readme.indexOf("## Deploy to Vercel");
const section = sectionStart === -1 ? "" : readme.slice(sectionStart, readme.indexOf("\n## ", sectionStart + 10) === -1 ? undefined : readme.indexOf("\n## ", sectionStart + 10));

const mentioned = new Set();
const requiredBlock = new Set();
let firstBlock = true;
const blockRe = /```[ \t]*\r?\n([\s\S]*?)```/g;
let bm;
while ((bm = blockRe.exec(section))) {
  for (const line of bm[1].split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)/);
    if (!m) continue;
    mentioned.add(m[1]);
    if (firstBlock) requiredBlock.add(m[1]);
  }
  firstBlock = false;
}

// "Optional: a, b, c" lines
const optionalLine = new Set();
for (const m of section.matchAll(/Optional: (.+)/g)) {
  for (const token of m[1].split(",")) {
    const name = token.trim().replace(/`/g, "").match(/^([A-Z_][A-Z0-9_]*)/);
    if (name) {
      mentioned.add(name[1]);
      optionalLine.add(name[1]);
    }
  }
}

// The code hard-fails at boot without these, so they must never be optional.
const BOOT_CRITICAL = {
  SUPABASE_URL: "backend/supabase.js exits the process",
  SUPABASE_SERVICE_ROLE_KEY: "backend/supabase.js exits the process",
  JWT_SECRET: "backend/middleware/auth.js exits the process",
  DOCUMENT_ENC_KEY: "backend/services/landIdentity.js exits the process",
  HASH_PEPPER: "backend/services/landIdentity.js exits the process",
};

console.log("Variables the code reads (excluding local-only and platform-managed):\n");
const missing = [];
for (const [name, files] of [...used].sort()) {
  if (LOCAL_ONLY.has(name) || PLATFORM_MANAGED.has(name)) continue;
  const inReadme = mentioned.has(name);
  if (!inReadme) missing.push({ name, files: [...files] });
  console.log(`  ${inReadme ? "[listed ]" : "[MISSING]"} ${name.padEnd(28)} ${[...files].join(", ")}`);
}

console.log("\nListed in README but never read by the code:");
for (const name of [...mentioned].sort()) {
  if (!used.has(name)) console.log(`  ${name}`);
}

console.log("");
let problems = 0;

if (missing.length) {
  problems++;
  console.log(`⚠ ${missing.length} variable(s) read by the code but absent from the Vercel section:`);
  for (const m of missing) console.log(`    ${m.name}`);
}

for (const [name, why] of Object.entries(BOOT_CRITICAL)) {
  if (optionalLine.has(name)) {
    problems++;
    console.log(`⚠ ${name} is boot-critical (${why}) but listed as optional`);
  } else if (!requiredBlock.has(name)) {
    problems++;
    console.log(`⚠ ${name} is boot-critical (${why}) but not in the required list`);
  }
}

console.log("");
if (problems) {
  console.log(`${problems} issue(s) found in the README's Vercel section.`);
  process.exitCode = 1;
} else {
  console.log("✓ Every variable the code reads is documented, and every boot-critical one is required.");
}
