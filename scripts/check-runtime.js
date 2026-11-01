/**
 * Runtime readiness probe: registrar gas balance + seeded users.
 *   node scripts/check-runtime.js
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");

function readEnvFile(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    values[m[1]] = v;
  }
  return values;
}

const rootEnv = readEnvFile(path.join(ROOT, ".env"));
const beEnv = readEnvFile(path.join(ROOT, "backend", ".env"));
const normKey = (k) => (!k ? null : k.startsWith("0x") ? k : `0x${k.trim()}`);

(async () => {
  const rpc = beEnv.AMOY_RPC_URL || beEnv.ALCHEMY_AMOY_URL || rootEnv.AMOY_RPC_URL;
  const provider = new ethers.JsonRpcProvider(rpc);

  console.log("── Amoy balances ──");
  for (const [name, key] of [
    ["DEPLOYER", rootEnv.DEPLOYER_PRIVATE_KEY],
    ["ISSUER  ", rootEnv.ISSUER_PRIVATE_KEY],
  ]) {
    if (!key) continue;
    const w = new ethers.Wallet(normKey(key));
    const bal = await provider.getBalance(w.address);
    console.log(`  ${name.trim()} ${w.address}  ${ethers.formatEther(bal)} POL`);
  }

  console.log("\n── Supabase users ──");
  const url = beEnv.SUPABASE_URL;
  const key = beEnv.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  try {
    const res = await fetch(`${url}/rest/v1/users?select=id,email,role,active`, { headers });
    const rows = await res.json();
    if (!Array.isArray(rows)) {
      console.log("  unexpected response:", JSON.stringify(rows).slice(0, 300));
    } else if (!rows.length) {
      console.log("  no users yet — run: cd backend && npm run seed:admin");
    } else {
      for (const u of rows) console.log(`  ${u.email}  role=${u.role}  active=${u.active}`);
    }
  } catch (e) {
    console.log("  request failed:", e.message);
  }

  console.log("\n── Land records already on chain ──");
  const c = new ethers.Contract(
    beEnv.CONTRACT_ADDRESS,
    ["function recordExists(bytes32) external view returns (bool)"],
    provider
  );
  console.log(`  contract ${beEnv.CONTRACT_ADDRESS}`);
})();
