/**
 * Reproduces the "login doesn't take me inside" report.
 * Walks the exact request sequence the browser makes:
 *   1. POST /api/auth/login
 *   2. GET  /api/auth/me  with the returned bearer token
 * Prints each step's status and body so the break point is obvious.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// ── Pull the admin email/password straight from backend/.env ──
const envText = readFileSync(path.join(root, "backend", ".env"), "utf8");
function envValue(key) {
  const m = envText.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, "m"));
  if (!m) return "";
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

const email = envValue("ADMIN_EMAIL") || "admin@nosih.com";
const password = envValue("ADMIN_PASSWORD");
const base = process.argv[2] || "http://localhost:3000/api";

console.log(`Base URL     : ${base}`);
console.log(`ADMIN_EMAIL  : ${email}`);
console.log(`ADMIN_PASS   : ${password ? `set (${password.length} chars)` : "MISSING"}`);
console.log("");

// ── Step 1: login ──
const loginRes = await fetch(`${base}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const loginBody = await loginRes.text();
console.log(`[1] POST /auth/login -> ${loginRes.status} ${loginRes.statusText}`);
console.log(`    body: ${loginBody.slice(0, 300)}`);

let token = null;
try {
  token = JSON.parse(loginBody).token || null;
} catch {
  /* leave null */
}

if (!token) {
  console.log("");
  console.log("==> Login did not return a token. The browser stays on /login.");
  console.log("==> Checking whether the account exists at all (same failure mode).");
  const badRes = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: `${password}-wrong` }),
  });
  console.log(`    wrong-password response: ${badRes.status} ${await badRes.text()}`);
  console.log(`    same status as correct password? ${badRes.status === loginRes.status}`);
  process.exit(1);
}

// ── Step 2: /auth/me with the token ──
const meRes = await fetch(`${base}/auth/me`, {
  headers: { Authorization: `Bearer ${token}` },
});
console.log(`[2] GET  /auth/me     -> ${meRes.status} ${meRes.statusText}`);
console.log(`    body: ${(await meRes.text()).slice(0, 300)}`);
