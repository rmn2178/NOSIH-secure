/**
 * Single source of truth for the environment.
 *
 * Every secret lives in the repository-root `.env`. The path is resolved
 * from this module's own location, so it does not matter which directory the
 * process was started from — `node backend/server.js`, `npm --prefix backend
 * run dev` and `npm run smoke:api` all read the same file.
 *
 * On Vercel there is no `.env` file: the platform injects the variables, so
 * the load is a no-op and the same code path serves both environments.
 *
 * Import this module FIRST in any file that reads `process.env` at module
 * scope. ESM evaluates imports in source order, so the first import wins.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the one env file: <repo>/.env */
export const ROOT_ENV_PATH = path.resolve(here, "..", ".env");

const result = dotenv.config({ path: ROOT_ENV_PATH });

/** True when the repository-root `.env` was found and read. */
export const loadedFromFile = !result.error;

// No file is expected on a platform that injects variables. Only complain
// when there is no file AND nothing came from the ambient environment.
if (result.error && !process.env.VERCEL && !process.env.SUPABASE_URL) {
  console.warn(
    `[env] No .env found at ${ROOT_ENV_PATH} — copy .env.example to .env and fill it in.`
  );
}
