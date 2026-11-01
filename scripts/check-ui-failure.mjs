/**
 * Serves the production frontend with a deliberately broken API.
 *
 * Reproduces the platform failure that produced a blank page: the API
 * answers 500 with the platform's error envelope
 * `{ "error": { "code": "...", "message": "..." } }`. The old frontend put
 * that object straight into React state, which threw error #31 and
 * unmounted the whole tree.
 *
 *   npm run build --prefix frontend
 *   node scripts/check-ui-failure.mjs
 *
 * Then open http://127.0.0.1:5058/login and try to sign in: the page must
 * show a readable message, not a blank screen.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(here, "..", "frontend", "build");
const PORT = Number(process.argv[2]) || 5058;

if (!fs.existsSync(path.join(buildDir, "index.html"))) {
  console.error("No production build found. Run: npm run build --prefix frontend");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  // Every API route fails the way a platform-level failure does.
  if (req.url.startsWith("/api/")) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "500", message: "A server error has occurred" } }));
    return;
  }

  const clean = req.url.split("?")[0];
  let filePath = path.join(buildDir, decodeURIComponent(clean));

  // Keep the served path inside the build directory.
  if (!filePath.startsWith(buildDir)) filePath = path.join(buildDir, "index.html");

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(buildDir, "index.html"); // SPA fallback
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Serving ${buildDir} with a failing API on http://127.0.0.1:${PORT}`);
  console.log("Try to sign in — the page must show a message, not a blank screen.");
});
