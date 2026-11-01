/**
 * Regression test for the Vercel crash.
 *
 * The backend used to exit at import time when an environment variable was
 * missing. On Vercel that shows up as FUNCTION_INVOCATION_FAILED on every
 * route — an opaque platform error that hides the cause.
 *
 * This boots a second copy of the backend with a deliberately broken
 * environment and checks that it stays up and names the missing variables
 * over HTTP.
 *
 *   node scripts/check-boot-report.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "..", "backend");
const PORT = 5057;
const BASE = `http://127.0.0.1:${PORT}`;

// Variables that must be missing/blank for the test to be meaningful.
const BROKEN = {
  JWT_SECRET: "",
  SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  DOCUMENT_ENC_KEY: "",
  HASH_PEPPER: "",
};

// The server writes to a log file rather than a pipe: on Windows, killing a
// child while its stdout pipe is still open trips a libuv assertion.
const logPath = path.join(os.tmpdir(), `nosih-boot-report-${process.pid}.log`);
const logFd = fs.openSync(logPath, "w");

const child = spawn(process.execPath, ["server.js"], {
  cwd: backendDir,
  env: { ...process.env, ...BROKEN, PORT: String(PORT) },
  stdio: ["ignore", logFd, logFd],
});

const readLog = () => {
  try {
    return fs.readFileSync(logPath, "utf8");
  } catch {
    return "";
  }
};

const fail = (message) => {
  console.error(`[FAIL] ${message}`);
  const log = readLog().trim();
  if (log) console.error(`\nServer output:\n${log}`);
  fs.closeSync(logFd);
  process.exit(1);
};

// ── Wait for the health endpoint ──
let health = null;
const deadline = Date.now() + 30000;

while (Date.now() < deadline) {
  try {
    const res = await fetch(`${BASE}/api/health`);
    health = { status: res.status, body: await res.json() };
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 400));
  }
}

if (!health) fail("the backend did not answer /api/health — it probably exited at boot");
if (child.exitCode !== null) fail(`the backend exited with code ${child.exitCode}`);

console.log(`GET /api/health -> ${health.status}`);
console.log(JSON.stringify(health.body, null, 2));

const problems = health.body?.config?.problems || [];
const names = problems.map((p) => p.name);

const expected = Object.keys(BROKEN);
const missing = expected.filter((n) => !names.includes(n));

if (health.status !== 503) fail(`expected HTTP 503 for a misconfigured server, got ${health.status}`);
if (health.body?.status !== "degraded") fail(`expected status "degraded", got ${health.body?.status}`);
if (missing.length) fail(`the report did not name these missing variables: ${missing.join(", ")}`);
if (!problems.every((p) => p.reason && p.hint)) fail("each problem needs a reason and a hint");

// Every other route must answer with the same readable report, not crash.
const other = await fetch(`${BASE}/api/land/stats`);
console.log(`\nGET /api/land/stats -> ${other.status}`);
const otherBody = await other.json();
if (other.status !== 503) fail(`expected /api/land/stats to answer 503, got ${other.status}`);
if (!otherBody?.problems) fail("/api/land/stats must include the problem list");

console.log("");
console.log("The server stayed up and named every missing variable.");

// Stop the child and wait for it to go away before this process exits.
if (child.exitCode === null && child.signalCode === null) {
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

fs.closeSync(logFd);
fs.rmSync(logPath, { force: true });
