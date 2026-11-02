/**
 * Deploys to Vercel, but only after the preflight passes.
 *
 *   node scripts/vercel-deploy.mjs            # production
 *   node scripts/vercel-deploy.mjs --preview  # a preview deployment
 *   node scripts/vercel-deploy.mjs --dry-run  # check only, deploy nothing
 *
 * The preflight is the point of this script. Every production failure this
 * project had was invisible until the code was running in production, and
 * every one of them would have been caught by the preflight.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const preview = args.includes("--preview");

console.log("Preflight\n");
const preflight = spawnSync(process.execPath, [path.join(HERE, "vercel-preflight.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
  timeout: 300000,
});

if (preflight.status !== 0) {
  console.error("\n✗ The preflight failed. Nothing was deployed.");
  process.exit(1);
}

if (dryRun) {
  console.log("\n✓ The preflight passed. --dry-run was given, so nothing was deployed.");
  process.exit(0);
}

const vercelArgs = preview ? ["--preview"] : ["--prod"];
console.log(`\n▸ vercel ${vercelArgs.join(" ")}\n`);

const vercel = spawnSync("vercel", vercelArgs, { cwd: ROOT, stdio: "inherit", shell: true });

if (vercel.status !== 0) {
  console.error("\n✗ The Vercel CLI failed. Run `vercel login` and `vercel link` first.");
  process.exit(vercel.status || 1);
}

console.log("\n✓ Deployed. Verify it with:");
console.log("  curl -s https://<your-domain>/api/health");
