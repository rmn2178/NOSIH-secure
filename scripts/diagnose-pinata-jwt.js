/**
 * Validate a Pinata scoped JWT.
 *
 *   node scripts/diagnose-pinata-jwt.js
 *
 * Reads the JWT from the root .env. It picks up the token even when the line
 * is commented out (which is how a token that fails validation is parked),
 * so you can test a new token before enabling it.
 *
 * Note: the payload's `scopeKeySecret` is the scoped key's own secret, NOT
 * the API secret - they are different values by design, so a mismatch there
 * is not a transcription error. The only authoritative check is whether
 * Pinata itself accepts the token.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function readEnvFile(file) {
  const values = {};
  const commented = {};
  if (!fs.existsSync(file)) return { values, commented };
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    if (raw.trim().startsWith("#")) {
      if (!commented[m[1]]) commented[m[1]] = v;
    } else {
      values[m[1]] = v;
    }
  }
  return { values, commented };
}

const { values: env, commented } = readEnvFile(path.join(ROOT, ".env"));
const jwt = env.PINATA_JWT || commented.PINATA_JWT;

if (!jwt) {
  console.log("PINATA_JWT not set (neither active nor commented) in .env");
  process.exit(0);
}

const [headerB64, payloadB64, sigB64] = jwt.split(".");
if (!headerB64 || !payloadB64 || !sigB64) {
  console.log("Malformed JWT - expected three dot-separated parts");
  process.exit(1);
}

const decode = (part) => Buffer.from(part, "base64url").toString("utf8");
const header = JSON.parse(decode(headerB64));
const payload = JSON.parse(decode(payloadB64));

console.log("header :", JSON.stringify(header));
console.log("payload:", JSON.stringify(payload, null, 2).replace(/\n/g, "\n         "));
console.log("");
console.log(`source        : ${env.PINATA_JWT ? "ACTIVE in .env" : "commented out in .env"}`);
console.log(`scopedKeyKey  : ${payload.scopedKeyKey}`);
console.log(`env API key   : ${env.PINATA_API_KEY}`);
console.log(
  `key matches   : ${payload.scopedKeyKey === env.PINATA_API_KEY ? "yes" : "NO - this token belongs to a different key"}`
);
console.log(
  `scopeKeySecret is the scoped key's own secret (${String(payload.scopeKeySecret).length} chars), not the API secret ` +
    `(${String(env.PINATA_API_SECRET).length} chars) - a difference here is expected, not a typo.`
);

if (payload.exp) {
  const expDate = new Date(payload.exp * 1000);
  const days = Math.round((expDate - Date.now()) / 86400000);
  console.log(`expires       : ${expDate.toISOString()} (${days >= 0 ? `${days} days left` : `expired ${-days} days ago`})`);
}

// The only authoritative check: does Pinata accept the token?
(async () => {
  console.log("\nLive validation against Pinata:");
  for (const [label, url] of [
    ["legacy pinFileToIPFS", "https://api.pinata.cloud/pinning/pinFileToIPFS"],
    ["v3 uploads", "https://uploads.pinata.cloud/v3/files"],
  ]) {
    try {
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${jwt}` } });
      const body = await res.text();
      let reason = "";
      try {
        const parsed = JSON.parse(body)?.error;
        reason = parsed?.reason || parsed?.message || "";
      } catch {
        /* non-json body */
      }
      const rejected =
        res.status === 401 || reason === "INVALID_CREDENTIALS" || reason === "INVALID_API_KEYS";
      console.log(
        `  [${rejected ? "FAIL" : "PASS"}] ${label.padEnd(22)} HTTP ${res.status} ${reason} ${
          rejected ? "- token rejected" : "- token accepted"
        }`
      );
    } catch (e) {
      console.log(`  [FAIL] ${label.padEnd(22)} ${e.message}`);
    }
  }
  console.log("\nIf both probes fail with INVALID_CREDENTIALS, the token string was altered in transit.");
  console.log("Copy the whole token again from the Pinata console and re-run this script.");
})();
