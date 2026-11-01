/**
 * NOSIH backend entry point.
 *
 * Local:      node server.js  (listens on PORT)
 * Vercel:     imported by the zero-config Express runtime, which uses the
 *             default export as the request handler for every path.
 */
import "./env.js"; // loads the repository-root .env — must come first
import express from "express";
import cors from "cors";
import { MAX_UPLOAD_MB } from "./config.js";

import { supabaseBootError } from "./supabase.js"; // connects + validates at boot
import { auditEnv, describeProblems } from "./envCheck.js";

import authRoutes   from "./routes/auth.js";
import landRoutes   from "./routes/land.js";
import verifyRoutes from "./routes/verify.js";

const envAudit = auditEnv();

if (!envAudit.ok) {
  console.error("FATAL: the backend environment is incomplete:");
  console.error(describeProblems(envAudit.problems));
  console.error("The API will answer with 503 and these details until they are fixed.");
}

const app = express();

// ── CORS ─────────────────────────────────────────────────
// FRONTEND_URL accepts a comma-separated list (production + preview URLs).
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // No Origin header: curl, server-to-server, same-origin navigations.
    if (!origin) return cb(null, true);
    const clean = origin.replace(/\/$/, "");
    if (allowedOrigins.includes("*") || allowedOrigins.includes(clean)) return cb(null, true);
    if (/^http:\/\/localhost:\d+$/.test(clean) || /^http:\/\/127\.0\.0\.1:\d+$/.test(clean)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ─────────────────────────────────────────
// Registered before every other route so it always answers, even when the
// deployment is misconfigured. It is the first thing to check when the
// frontend shows a blank page.
app.get("/api/health", (_req, res) => {
  const databaseOk = !supabaseBootError;
  const ok = envAudit.ok && databaseOk;

  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    config: envAudit.ok
      ? { ok: true }
      : { ok: false, problems: envAudit.problems },
    database: databaseOk
      ? { ok: true }
      : { ok: false, error: supabaseBootError },
  });
});

// ── Misconfiguration gate ───────────────────────────────
// A missing variable is reported instead of crashing the function: on Vercel
// a crash at import time answers every route with FUNCTION_INVOCATION_FAILED
// and no clue about the cause.
app.use((req, res, next) => {
  if (envAudit.ok) return next();
  res.status(503).json({
    error: "Server misconfigured: required environment variables are missing",
    problems: envAudit.problems,
  });
});

// ── Routes ───────────────────────────────────────────────
app.use("/api/auth",   authRoutes);
app.use("/api/land",   landRoutes);
app.use("/api/verify", verifyRoutes);

// 404 handler
app.use((_, res) => res.status(404).json({ error: "Route not found" }));

// Global error handler (multer file-type / size errors land here)
app.use((err, _req, res, _next) => {
  console.error("[Error]", err.message);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File is too large (max ${MAX_UPLOAD_MB} MB)` });
  }
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

// ── Start (local only) ───────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

export default app;
