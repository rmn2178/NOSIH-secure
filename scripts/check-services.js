/**
 * Live credential check for the third-party services the backend depends on.
 * Reads backend/.env and exercises each API with a real, read-only call.
 *
 *   node scripts/check-services.js
 */
const fs = require("fs");
const path = require("path");

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

async function checkGemini() {
  const key = env.GEMINI_API_KEY;
  if (!key) return console.log("[SKIP] GEMINI_API_KEY not set");
  const model = env.GEMINI_MODEL || "gemini-3.6-flash";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with the single word: ready" }] }],
          generationConfig: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 16 },
        }),
      }
    );
    const body = await res.json();
    if (res.ok) {
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      console.log(`[PASS] Gemini  model=${model}  reply="${String(text).trim().slice(0, 40)}"`);
    } else {
      const msg = body?.error?.message || JSON.stringify(body).slice(0, 160);
      console.log(`[FAIL] Gemini  HTTP ${res.status} — ${msg}`);
    }
  } catch (e) {
    console.log(`[FAIL] Gemini  ${e.message}`);
  }
}

/**
 * Non-mutating Pinata auth probe.
 *
 * POSTs an empty body to the upload endpoints. Nothing is uploaded, so no pin
 * is created:
 *   401/403 UNAUTHORIZED  → credential rejected
 *   400 validation error  → auth PASSED, the request merely lacked a file
 */
async function probePinata(label, url, headers) {
  try {
    const res = await fetch(url, { method: "POST", headers });
    const body = await res.text();
    const authRejected = res.status === 401 || res.status === 403;
    const reason = (() => {
      try {
        return JSON.parse(body)?.error?.reason || "";
      } catch {
        return "";
      }
    })();
    if (authRejected) {
      console.log(`[FAIL] ${label}  HTTP ${res.status} ${reason} — ${body.slice(0, 130)}`);
      return false;
    }
    console.log(`[PASS] ${label}  HTTP ${res.status} auth accepted (${reason || "validation"}: ${body.slice(0, 90).replace(/\s+/g, " ")})`);
    return true;
  } catch (e) {
    console.log(`[FAIL] ${label}  ${e.message}`);
    return false;
  }
}

async function checkPinata() {
  const jwt = env.PINATA_JWT;
  const apiKey = env.PINATA_API_KEY;
  const apiSecret = env.PINATA_API_SECRET;

  const bearer = jwt ? { Authorization: `Bearer ${jwt}` } : null;
  const keypair =
    apiKey && apiSecret ? { pinata_api_key: apiKey, pinata_secret_api_key: apiSecret } : null;

  if (!bearer && !keypair) {
    console.log("[SKIP] No Pinata credentials set");
    return;
  }

  // v3 uploads API — the primary path used by backend/services/ipfs.js
  if (bearer) await probePinata("JWT  → uploads v3", "https://uploads.pinata.cloud/v3/files", bearer);
  if (keypair) await probePinata("KEY  → uploads v3", "https://uploads.pinata.cloud/v3/files", keypair);

  // Legacy pinning API — the fallback path in uploadViaPinataLegacy
  if (bearer) await probePinata("JWT  → pinFileToIPFS", "https://api.pinata.cloud/pinning/pinFileToIPFS", bearer);
  if (keypair) await probePinata("KEY  → pinFileToIPFS", "https://api.pinata.cloud/pinning/pinFileToIPFS", keypair);

  // Read-only listing — proves the key pair can read the account
  if (keypair) await probePinata("KEY  → pinList", "https://api.pinata.cloud/pinning/pinList?pageSize=1", keypair);
}

(async () => {
  console.log("── Google Gemini ──");
  await checkGemini();
  // Control: a bogus key must be rejected, otherwise the check above proves nothing.
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": "AIzaSyCONTROL-INVALID-KEY-0000000000" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ready" }] }] }),
      }
    );
    console.log(
      res.ok
        ? "[WARN] Gemini control  bogus key ACCEPTED — the endpoint is not validating keys"
        : `[PASS] Gemini control  bogus key rejected (HTTP ${res.status})`
    );
  } catch (e) {
    console.log(`[WARN] Gemini control  ${e.message}`);
  }
  console.log("\n── Pinata ──");
  await checkPinata();
})();
