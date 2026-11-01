/**
 * Verify a Pinata scoped JWT offline: decode the payload and test candidate
 * HMAC secrets against the signature. Reveals whether a pasted JWT is
 * internally consistent or was mangled in transit.
 *
 *   node scripts/diagnose-pinata-jwt.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

const env = readEnvFile(path.join(ROOT, "backend", ".env"));
const jwt = env.PINATA_JWT;

if (!jwt) {
  console.log("PINATA_JWT not set");
  process.exit(0);
}

const [headerB64, payloadB64, sigB64] = jwt.split(".");
if (!headerB64 || !payloadB64 || !sigB64) {
  console.log("Malformed JWT — expected three dot-separated parts");
  process.exit(1);
}

const decode = (part) => Buffer.from(part, "base64url").toString("utf8");
const header = JSON.parse(decode(headerB64));
const payload = JSON.parse(decode(payloadB64));

console.log("header :", JSON.stringify(header));
console.log("payload:", JSON.stringify(payload, null, 2).replace(/\n/g, "\n         "));

const signingInput = `${headerB64}.${payloadB64}`;
const signature = Buffer.from(sigB64, "base64url");

console.log("\nHMAC-SHA256 signature check against candidate secrets:");
const candidates = {
  "PINATA_API_SECRET": env.PINATA_API_SECRET,
  "PINATA_API_KEY": env.PINATA_API_KEY,
  "payload.scopeKey": payload.scopeKey,
  "payload.scopeKeyKey": payload.scopeKeyKey,
  "payload.scopeKeySecret": payload.scopeKeySecret,
};

let matched = false;
for (const [name, secret] of Object.entries(candidates)) {
  if (!secret) continue;
  const expected = crypto.createHmac("sha256", secret).update(signingInput).digest();
  const ok = expected.length === signature.length && crypto.timingSafeEqual(expected, signature);
  if (ok) matched = true;
  console.log(`  ${name.padEnd(24)} ${ok ? "MATCH ✓" : "no match"}`);
}

console.log(
  matched
    ? "\n✓ JWT signature is internally consistent with a local secret."
    : "\n✗ JWT signature does NOT match any local secret — the token was not signed by Pinata with these credentials (mangled in transit, or signed with a different scope secret)."
);

if (payload.exp) {
  const expDate = new Date(payload.exp * 1000);
  const days = Math.round((expDate - Date.now()) / 86400000);
  console.log(`exp: ${expDate.toISOString()} (${days >= 0 ? `${days} days left` : `expired ${-days} days ago`})`);
}
