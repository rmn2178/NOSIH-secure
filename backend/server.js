import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import "./supabase.js"; // validates Supabase env + connectivity at boot (exits on failure)
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

// ── Middleware ───────────────────────────────────────────
app.use(cors({
  origin: [process.env.FRONTEND_URL || "http://localhost:3000"],
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
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

// ── Start ────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
