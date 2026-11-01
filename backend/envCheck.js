/**
 * Startup configuration audit.
 *
 * The backend used to call `process.exit(1)` at import time when a variable
 * was missing. On Vercel that surfaces as `FUNCTION_INVOCATION_FAILED` — an
 * opaque platform error that says nothing about the actual cause, and it
 * takes down every route including the health check.
 *
 * Instead the app audits its configuration on boot, keeps serving, and
 * reports the exact problems over HTTP so a misconfigured deployment can be
 * diagnosed from the browser.
 */

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Variables the API cannot serve traffic without.
 * `test` decides whether a present value is also usable.
 */
export const REQUIRED_ENV = [
  {
    name: "SUPABASE_URL",
    test: (v) => /^https:\/\/\S+\.supabase\.co/.test(v),
    hint: "Project URL from Supabase → Project Settings → API",
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    test: (v) => v.startsWith("sb_secret_") || v.length >= 32,
    hint: "Service-role (secret) key — the publishable key cannot read the users table",
  },
  {
    name: "JWT_SECRET",
    test: (v) => v.length >= 16,
    hint: "Random string used to sign session tokens",
  },
  {
    name: "DOCUMENT_ENC_KEY",
    test: (v) => HEX64.test(v),
    hint: "32-byte hex key used to encrypt deed PDFs (back it up — losing it loses every deed)",
  },
  {
    name: "HASH_PEPPER",
    test: (v) => HEX64.test(v),
    hint: "32-byte hex key mixed into Land ID and owner hashes (back it up)",
  },
];

/**
 * Audits the environment.
 *
 * @returns {{ ok: boolean, problems: Array<{name: string, reason: string, hint: string}> }}
 */
export function auditEnv(env = process.env) {
  const problems = [];

  for (const spec of REQUIRED_ENV) {
    const value = String(env[spec.name] ?? "").trim();

    if (!value) {
      problems.push({ name: spec.name, reason: "not set", hint: spec.hint });
    } else if (!spec.test(value)) {
      problems.push({ name: spec.name, reason: "set but malformed", hint: spec.hint });
    }
  }

  return { ok: problems.length === 0, problems };
}

/** One-line-per-problem summary for the server log. */
export function describeProblems(problems) {
  return problems.map((p) => `  - ${p.name}: ${p.reason} (${p.hint})`).join("\n");
}
