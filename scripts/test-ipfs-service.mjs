/**
 * Test the app's real IPFS upload path (backend/services/ipfs.js).
 *
 *   node scripts/test-ipfs-service.mjs            # with the current .env
 *   node scripts/test-ipfs-service.mjs --keypair  # force the API key pair
 *   node scripts/test-ipfs-service.mjs --jwt      # force the JWT
 *
 * Uploads a 1-byte file to IPFS. No blockchain is involved.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const BACKEND = path.join(ROOT, "backend");
const asUrl = (p) => pathToFileURL(p).href;

const { default: dotenv } = await import(asUrl(path.join(BACKEND, "node_modules", "dotenv/lib/main.js")));
dotenv.config({ path: path.join(BACKEND, ".env") });

const mode = process.argv.includes("--keypair")
  ? "API key pair"
  : process.argv.includes("--jwt")
    ? "JWT"
    : "as configured in the root .env";

if (process.argv.includes("--keypair")) delete process.env.PINATA_JWT;

const { uploadToIPFS, fetchIPFSFile } = await import(asUrl(path.join(BACKEND, "services", "ipfs.js")));

console.log(`\n── uploadToIPFS via ${mode} ──`);

const started = Date.now();
try {
  const cid = await uploadToIPFS(Buffer.from("x"), "nosih-ipfs-test.txt", "text/plain");
  console.log(`  [PASS] uploaded 1 byte → CID ${cid}  (${Date.now() - started}ms)`);
  console.log(`  gateway: https://gateway.pinata.cloud/ipfs/${cid}`);

  // The verify page fetches the stored deed back through the gateways.
  try {
    const result = await fetchIPFSFile(cid);
    const bytes = result?.buffer?.length;
    console.log(
      `  [${bytes === 1 ? "PASS" : "FAIL"}] fetched back via ${result?.sourceUrl} — ${bytes} byte(s)`
    );
  } catch (e) {
    console.log(`  [FAIL] fetch back — ${e.message}`);
  }
} catch (e) {
  console.log(`  [FAIL] ${e.message}`);
  if (e.details) console.log(`  details: ${e.details}`);
  console.log(`  status: ${e.status}  code: ${e.code}`);
}
