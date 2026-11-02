/**
 * Decides whether the canvas can safely draw text.
 *
 * @napi-rs/canvas ships a Skia build. Up to version 0.1.x that build loaded
 * its ICU data from a separate `icudtl.dat` file next to the native binary.
 * Without the file the module still loads, but the first call that draws text
 * aborts the process — a native abort, which no try/catch can catch, and which
 * takes the whole function down.
 *
 * From version 1.0.0 the ICU data is compiled into the binary, so the file is
 * no longer needed. The check below therefore answers two different questions:
 *
 *   - is the installed build self-contained?   → text rendering is safe
 *   - is the data file present next to the binary? → text rendering is safe
 *
 * The file reference at the bottom is for the deployment tracer. It names
 * every platform variant so the tracer has a literal to follow; the one that
 * is installed is the one that gets packaged, and it lands next to the binary
 * that looks for it.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);

/** From this version the ICU data is compiled into the binary. */
const SELF_CONTAINED_FROM = "1.0.0";

/** The ICU data file, one entry per platform @napi-rs/canvas publishes. */
const ICU_CANDIDATES = [
  "@napi-rs/canvas-linux-x64-gnu/icudtl.dat",
  "@napi-rs/canvas-linux-x64-musl/icudtl.dat",
  "@napi-rs/canvas-linux-arm64-gnu/icudtl.dat",
  "@napi-rs/canvas-linux-arm64-musl/icudtl.dat",
  "@napi-rs/canvas-darwin-x64/icudtl.dat",
  "@napi-rs/canvas-darwin-arm64/icudtl.dat",
  "@napi-rs/canvas-win32-x64-msvc/icudtl.dat",
  "@napi-rs/canvas-win32-arm64-msvc/icudtl.dat",
];

/** Compares two dotted version strings. */
function isAtLeast(version, target) {
  const a = String(version || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(target).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return true;
}

/** The installed @napi-rs/canvas version, or null when it cannot be read. */
export function canvasVersion() {
  try {
    return require("@napi-rs/canvas/package.json").version;
  } catch {
    return null;
  }
}

/** Resolves the ICU data file for the platform this is running on. */
export function icuDataPath() {
  for (const candidate of ICU_CANDIDATES) {
    try {
      const resolved = require.resolve(candidate);
      if (fs.existsSync(resolved)) return resolved;
    } catch {
      /* not this platform */
    }
  }
  return null;
}

/**
 * Whether the canvas can safely render text.
 *
 * The check is made before anything is rendered, because the failure mode is
 * a native abort rather than a JavaScript exception.
 */
export function canvasTextAvailable() {
  const version = canvasVersion();
  if (version && isAtLeast(version, SELF_CONTAINED_FROM)) return true;
  return Boolean(icuDataPath());
}

/** A short description of the canvas build, for the logs. */
export function canvasDescription() {
  const version = canvasVersion() ?? "unknown";
  const icu = icuDataPath();
  return icu
    ? `@napi-rs/canvas ${version} (ICU data at ${path.basename(path.dirname(icu))})`
    : `@napi-rs/canvas ${version} (self-contained)`;
}

/**
 * The ICU data files, kept in the deployment.
 *
 * The specifiers are written out one by one on purpose: the tracer reads them
 * from the source, so a loop over an array of names would leave it with a
 * variable it cannot resolve. The function is never called — requiring a data
 * file would fail — but the tracer sees the literals and packages the files.
 *
 * Only the builds before 1.0.0 need this. From 1.0.0 the data is compiled
 * into the binary, which is what the project pins.
 */
function keepIcuDataInTheBundle() {
  try { require("@napi-rs/canvas-linux-x64-gnu/icudtl.dat"); } catch { /* not this platform */ }
  try { require("@napi-rs/canvas-linux-x64-musl/icudtl.dat"); } catch { /* not this platform */ }
  try { require("@napi-rs/canvas-linux-arm64-gnu/icudtl.dat"); } catch { /* not this platform */ }
  try { require("@napi-rs/canvas-linux-arm64-musl/icudtl.dat"); } catch { /* not this platform */ }
  try { require("@napi-rs/canvas-darwin-x64/icudtl.dat"); } catch { /* not this platform */ }
  try { require("@napi-rs/canvas-darwin-arm64/icudtl.dat"); } catch { /* not this platform */ }
  try { require("@napi-rs/canvas-win32-x64-msvc/icudtl.dat"); } catch { /* not this platform */ }
  try { require("@napi-rs/canvas-win32-arm64-msvc/icudtl.dat"); } catch { /* not this platform */ }
}

/** Exported so the function is not tree-shaken away before the tracer sees it. */
export const KEEP_ICU_IN_BUNDLE = keepIcuDataInTheBundle;
