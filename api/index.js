/**
 * Vercel Serverless Function Entry Point
 *
 * Wraps the Express backend for Vercel's serverless environment.
 * All /api/* routes are handled through this single function.
 *
 * The backend uses ESM ("type": "module" in backend/package.json).
 * This file re-exports the Express app for Vercel's @vercel/node runtime.
 */

// @vercel/node runtime uses the "type" field from the nearest package.json.
// The backend's package.json has "type": "module", so dynamic import works.
// We use a thin CommonJS wrapper that async-imports the ESM backend.

let appPromise;

function getApp() {
  if (!appPromise) {
    appPromise = import("../backend/server.js").then((mod) => mod.default);
  }
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
