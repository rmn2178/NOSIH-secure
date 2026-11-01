/**
 * Environment preflight checker.
 *
 * Verifies that every env var the app needs is present, correctly shaped and
 * actually usable — the single root .env and the on-chain registrar wiring.
 *
 *   node scripts/check-env.js
 *
 * Exits non-zero if a boot-critical variable is missing or invalid.
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");

// ── Minimal .env parser (no dependency, tolerates quotes and # comments) ──
function readEnvFile(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (/^".*"$|^'.*'$/.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

// One env file for the whole project. The backend reads the root .env too
// (backend/env.js resolves it from the module's own location).
const rootEnv = readEnvFile(path.join(ROOT, ".env"));
const frontendEnv = {
  ...readEnvFile(path.join(ROOT, "frontend", ".env.local")),
  ...readEnvFile(path.join(ROOT, "frontend", ".env")),
};

const results = [];
const ok = (label, detail) => results.push({ level: "ok", label, detail });
const warn = (label, detail) => results.push({ level: "warn", label, detail });
const fail = (label, detail) => results.push({ level: "fail", label, detail });

const HEX64 = /^[0-9a-fA-F]{64}$/;
const isHex64 = (v) => typeof v === "string" && HEX64.test(v.trim());
const normKey = (k) => (!k ? null : k.startsWith("0x") ? k : `0x${k.trim()}`);

// ── 1. Boot-critical backend secrets ──────────────────────
const checkHexKey = (name, env) => {
  const value = env[name];
  if (!value) return fail(name, "missing");
  if (!isHex64(value)) {
    return fail(name, `must be exactly 64 hex characters (got ${value.length})`);
  }
  ok(name, "64 hex chars");
};

checkHexKey("DOCUMENT_ENC_KEY", rootEnv);
checkHexKey("HASH_PEPPER", rootEnv);

if (!rootEnv.SUPABASE_URL) fail("SUPABASE_URL", "missing — server exits at boot");
else ok("SUPABASE_URL", rootEnv.SUPABASE_URL);

if (!rootEnv.SUPABASE_SERVICE_ROLE_KEY)
  fail("SUPABASE_SERVICE_ROLE_KEY", "missing — server exits at boot");
else ok("SUPABASE_SERVICE_ROLE_KEY", "set (length " + rootEnv.SUPABASE_SERVICE_ROLE_KEY.length + ")");

if (!rootEnv.JWT_SECRET) fail("JWT_SECRET", "missing — server exits at boot");
else ok("JWT_SECRET", `set (length ${rootEnv.JWT_SECRET.length})`);

// ── 2. Feature-gated variables ────────────────────────────
const optional = [
  ["CONTRACT_ADDRESS", rootEnv.CONTRACT_ADDRESS, "chain reads/writes"],
  ["ISSUER_PRIVATE_KEY", rootEnv.ISSUER_PRIVATE_KEY, "signing records"],
  ["PINATA_JWT", rootEnv.PINATA_JWT, "IPFS uploads"],
  ["GEMINI_API_KEY", rootEnv.GEMINI_API_KEY, "PDF field extraction"],
  ["ALCHEMY_AMOY_URL", rootEnv.ALCHEMY_AMOY_URL, "faster RPC"],
  ["ADMIN_EMAIL", rootEnv.ADMIN_EMAIL, "seed:admin"],
  ["ADMIN_PASSWORD", rootEnv.ADMIN_PASSWORD, "seed:admin"],
];
for (const [name, value, purpose] of optional) {
  if (value) ok(name, `set — ${purpose}`);
  else warn(name, `not set — ${purpose} unavailable`);
}
if (!rootEnv.PINATA_JWT && !(rootEnv.PINATA_API_KEY && rootEnv.PINATA_API_SECRET))
  warn("PINATA_API_KEY/PINATA_API_SECRET", "not set — needed only if PINATA_JWT is absent");

// ── 3. Frontend build-time vars ───────────────────────────
for (const name of ["REACT_APP_API_URL", "REACT_APP_TX_EXPLORER_URL"]) {
  if (frontendEnv[name]) ok(name, frontendEnv[name]);
  else warn(name, "not set — runtime default applies (/api, amoy polygonscan)");
}

// ── 4. Wallet addresses (offline, no RPC needed) ──────────
const WALLET_KEYS = [
  ["DEPLOYER_PRIVATE_KEY", rootEnv.DEPLOYER_PRIVATE_KEY],
  ["ISSUER_PRIVATE_KEY", rootEnv.ISSUER_PRIVATE_KEY],
];

const wallets = [];
for (const [name, key] of WALLET_KEYS) {
  if (!key) {
    fail(name, "missing");
    continue;
  }
  try {
    const wallet = new ethers.Wallet(normKey(key));
    wallets.push({ name, address: wallet.address });
    ok(name, wallet.address);
  } catch (e) {
    fail(name, `invalid private key: ${e.message}`);
  }
}

// ── 5. Chain state ────────────────────────────────────────
async function checkChain() {
  const rpc = rootEnv.ALCHEMY_AMOY_URL || rootEnv.AMOY_RPC_URL ||
    "https://rpc-amoy.polygon.technology";
  const contractAddress = rootEnv.CONTRACT_ADDRESS;

  const provider = new ethers.JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  ok("RPC", `${rpc} — chainId ${network.chainId}`);

  if (!contractAddress) {
    warn("CONTRACT_ADDRESS", "not set — cannot verify on-chain state");
    return;
  }

  const code = await provider.getCode(contractAddress);
  if (!code || code === "0x") {
    fail("CONTRACT_ADDRESS", `no contract code at ${contractAddress} on chain ${network.chainId}`);
    return;
  }
  ok("CONTRACT_ADDRESS", `deployed at ${contractAddress}`);

  const ABI = [
    "function authorizedRegistrars(address) external view returns (bool)",
    "function owner() external view returns (address)",
  ];
  const contract = new ethers.Contract(contractAddress, ABI, provider);
  const owner = await contract.owner();
  ok("contract.owner", owner);

  for (const { name, address } of wallets) {
    const isRegistrar = await contract.authorizedRegistrars(address);
    const isOwner = address.toLowerCase() === owner.toLowerCase();
    const role = isRegistrar ? "authorised registrar" : isOwner ? "contract owner (not a registrar)" : "not authorised";
    if (isRegistrar) ok(`${name} on-chain`, `${address} — ${role}`);
    else fail(`${name} on-chain`, `${address} — ${role}. Run: npm run issuer:add`);
  }
}

// ── 6. Database ───────────────────────────────────────────
async function checkSupabase() {
  const url = rootEnv.SUPABASE_URL;
  const key = rootEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const res = await fetch(`${url}/rest/v1/users?select=id&limit=1`, { headers });
    const body = await res.text();
    if (res.ok) {
      ok("supabase.users table", "reachable — schema is installed");
    } else {
      fail("supabase.users table", `HTTP ${res.status} — ${body.slice(0, 200)}. Run backend/supabase/schema.sql`);
    }
  } catch (e) {
    fail("supabase.users table", `request failed: ${e.message}`);
  }
}

// ── Run ───────────────────────────────────────────────────
(async () => {
  try {
    await checkChain();
  } catch (e) {
    warn("chain check", `skipped: ${e.message}`);
  }
  await checkSupabase();

  const icon = { ok: "PASS", warn: "WARN", fail: "FAIL" };
  console.log("");
  for (const r of results) console.log(`[${icon[r.level]}] ${r.label.padEnd(30)} ${r.detail}`);
  const failures = results.filter((r) => r.level === "fail");
  const warnings = results.filter((r) => r.level === "warn");
  console.log("");
  console.log(
    failures.length
      ? `${failures.length} blocking issue(s), ${warnings.length} warning(s).`
      : `No blocking issues. ${warnings.length} warning(s).`
  );
  process.exitCode = failures.length ? 1 : 0;
})();
