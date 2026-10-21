/**
 * NOSIH backend entry point.
 *
 * Local:      node server.js  (listens on PORT)
 * Vercel:     imported by the zero-config Express runtime, which uses the
 *             default export as the request handler for every path.
 */
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MAX_UPLOAD_MB } from "./config.js";

dotenv.config();

import "./supabase.js"; // validates Supabase env + connectivity at boot
import { assertLandSecrets } from "./services/landIdentity.js";

import authRoutes   from "./routes/auth.js";
import landRoutes   from "./routes/land.js";
import verifyRoutes from "./routes/verify.js";

try {
  assertLandSecrets();
} catch (err) {
  console.error("FATAL:", err.message);
  process.exit(1);
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

// ── Routes ───────────────────────────────────────────────
app.use("/api/auth",   authRoutes);
app.use("/api/land",   landRoutes);
app.use("/api/verify", verifyRoutes);

// Health check
app.get("/api/health", (_, res) =>
  res.json({ status: "ok", timestamp: new Date().toISOString() })
);

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
