/**
 * API smoke test against a running backend.
 *
 *   node scripts/smoke-api.js [baseUrl]
 *
 * Logs in with ADMIN_EMAIL/ADMIN_PASSWORD from backend/.env, then exercises
 * the protected read endpoints. Read-only: it never creates a land record and
 * never touches the blockchain.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASE = process.argv[2] || "http://localhost:5000";

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

const env = readEnvFile(path.join(ROOT, "backend", ".env"));

const results = [];
const record = (label, pass, detail) => {
  results.push({ label, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${label.padEnd(34)} ${detail}`);
};

(async () => {
  console.log(`Smoke test → ${BASE}\n`);

  // 1. Health
  try {
    const res = await fetch(`${BASE}/api/health`);
    const body = await res.json();
    record("GET /api/health", res.ok && body.status === "ok", `status=${body.status}`);
  } catch (e) {
    record("GET /api/health", false, e.message);
    return finish();
  }

  // 2. Login
  let token = null;
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      }),
    });
    const body = await res.json();
    token = body.token;
    record("POST /api/auth/login", res.ok && !!token, res.ok ? `role=${body.user?.role}` : body.error || `HTTP ${res.status}`);
  } catch (e) {
    record("POST /api/auth/login", false, e.message);
    return finish();
  }
  if (!token) return finish();

  const authed = { Authorization: `Bearer ${token}` };

  // 3. Identity
  try {
    const res = await fetch(`${BASE}/api/auth/me`, { headers: authed });
    const body = await res.json();
    record("GET /api/auth/me", res.ok && !!body.email, `email=${body.email} role=${body.role}`);
  } catch (e) {
    record("GET /api/auth/me", false, e.message);
  }

  // 4. Land records (should be empty on a fresh database)
  try {
    const res = await fetch(`${BASE}/api/land`, { headers: authed });
    const body = await res.json();
    const count = Array.isArray(body) ? body.length : body.records?.length ?? body.data?.length;
    record("GET /api/land", res.ok, `records=${count ?? "n/a"}`);
  } catch (e) {
    record("GET /api/land", false, e.message);
  }

  // 5. Stats
  try {
    const res = await fetch(`${BASE}/api/land/stats`, { headers: authed });
    const body = await res.json();
    record("GET /api/land/stats", res.ok, JSON.stringify(body).slice(0, 110));
  } catch (e) {
    record("GET /api/land/stats", false, e.message);
  }

  // 6. Auth is enforced
  try {
    const res = await fetch(`${BASE}/api/land`);
    record("GET /api/land (no token)", res.status === 401, `HTTP ${res.status} — ${res.status === 401 ? "rejected" : "NOT REJECTED"}`);
  } catch (e) {
    record("GET /api/land (no token)", false, e.message);
  }

  finish();
})();

function finish() {
  const failed = results.filter((r) => !r.pass);
  console.log("");
  console.log(failed.length ? `${failed.length} of ${results.length} checks failed.` : `All ${results.length} checks passed.`);
  process.exitCode = failed.length ? 1 : 0;
}
