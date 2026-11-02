/**
 * Local OCR — turns a rendered page into a text dump.
 *
 * The text dump is what leaves this module. The AI model is never shown an
 * image: it receives plain text and returns the deed's fields as JSON
 * against a fixed schema. That keeps the payload small, the model call fast,
 * and the pixels on the server.
 *
 * Several engines can be registered. They are tried in order and the first
 * one that returns usable text wins. Tesseract is built in; another engine
 * is a few lines:
 *
 *   import { registerOcrEngine } from "./ocr.js";
 *   registerOcrEngine("my-engine", async (buffer) => myRecognise(buffer));
 *
 * The language data is cached in one stable directory. Tesseract's own
 * default is the current working directory, which means it re-downloads the
 * model on every run — several megabytes, every time — and drops a file into
 * whatever folder the process happens to be in.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/** How long a single page may take before it is abandoned. */
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 60000);

/** The language to recognise. */
const OCR_LANG = process.env.OCR_LANG || "eng";

/**
 * Where the language data is cached.
 *
 * A stable path, so the model is downloaded once per machine rather than once
 * per working directory. On a serverless platform /tmp survives between
 * invocations of a warm instance, so a warm function pays for the download
 * once as well.
 */
const OCR_CACHE_DIR =
  process.env.TESSERACT_CACHE_PATH || path.join(os.tmpdir(), "nosih-tesseract");

// ── The engine registry ───────────────────────────────────

/**
 * @typedef {(buffer: Buffer) => Promise<string>} OcrEngine
 * @type {Map<string, { name: string, run: OcrEngine }>}
 */
const engines = new Map();

/**
 * Registers an OCR engine.
 *
 * @param {string} name
 * @param {OcrEngine} run
 */
export function registerOcrEngine(name, run) {
  engines.set(name, { name, run });
  console.log(`[ocr] engine registered: ${name}`);
}

/** The registered engine names, in the order they are tried. */
export function ocrEngineNames() {
  return [...engines.keys()];
}

// ── The Tesseract engine ──────────────────────────────────

/**
 * The WebAssembly core, one entry per build the worker might pick.
 *
 * The worker script is a JavaScript file that loads its `.wasm` sibling at
 * runtime. The deployment tracer follows the JavaScript but not the binary
 * it names, so the core would be missing in production and OCR would fail
 * with "failed to asynchronously prepare wasm".
 */
const CORE_CANDIDATES = [
  "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm",
  "tesseract.js-core/tesseract-core-relaxedsimd.wasm",
  "tesseract.js-core/tesseract-core-simd-lstm.wasm",
  "tesseract.js-core/tesseract-core-simd.wasm",
  "tesseract.js-core/tesseract-core-lstm.wasm",
  "tesseract.js-core/tesseract-core.wasm",
];

let workerPromise = null;

/**
 * Creates the Tesseract worker once and reuses it.
 *
 * Loading the language data and spinning up the worker costs seconds, so it is
 * kept for the life of the instance rather than rebuilt per request.
 *
 * A failure inside the worker thread arrives asynchronously, so the error
 * handler is what rejects the promise. Without that the rejection is
 * unhandled and it takes the whole function down.
 */
async function getWorker() {
  if (!workerPromise) {
    workerPromise = new Promise((resolve, reject) => {
      let settled = false;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      fs.mkdirSync(OCR_CACHE_DIR, { recursive: true });

      import("tesseract.js")
        .then(({ createWorker }) =>
          createWorker(OCR_LANG, 1, {
            // Quiet by default — the extraction service logs the outcome.
            logger: () => {},
            errorHandler: fail,
            // The stable cache directory. Without this the language model is
            // downloaded into the working directory on every run.
            cachePath: OCR_CACHE_DIR,
            // A self-hosted copy of the language data, when one is configured.
            ...(process.env.TESSERACT_LANG_PATH
              ? { langPath: process.env.TESSERACT_LANG_PATH.replace(/\/$/, "") }
              : {}),
          })
        )
        .then((worker) => {
          if (settled) {
            worker.terminate?.().catch?.(() => {});
            return;
          }
          settled = true;
          console.log(`[ocr] Tesseract ready (${OCR_LANG})`);
          resolve(worker);
        })
        .catch(fail);
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Runs a promise with a deadline. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The Tesseract engine. */
registerOcrEngine("tesseract", async (imageBuffer) => {
  const worker = await getWorker();
  const { data } = await withTimeout(worker.recognize(imageBuffer), OCR_TIMEOUT_MS, "OCR");
  return (data?.text || "").trim();
});

// ── The API ───────────────────────────────────────────────

/**
 * Reads the text out of one image with the first engine that works.
 *
 * @param {Buffer} imageBuffer PNG or JPEG bytes
 * @returns {Promise<{ text: string, engine: string }>}
 */
export async function ocrImage(imageBuffer) {
  let lastError = null;

  for (const [name, engine] of engines) {
    try {
      const text = await engine.run(imageBuffer);
      if (text && text.trim()) return { text: text.trim(), engine: name };
      lastError = new Error(`${name} returned no text`);
    } catch (err) {
      lastError = err;
      console.warn(`[ocr] ${name} failed: ${err.message}`);
    }
  }

  throw lastError || new Error("no OCR engine is registered");
}

/**
 * Reads the text out of several images and joins the pages into one dump.
 *
 * @param {Buffer[]} imageBuffers PNG or JPEG bytes, in page order
 * @returns {Promise<{ text: string, engine: string }>}
 */
export async function ocrImages(imageBuffers) {
  const pages = [];
  let engineUsed = null;

  for (const [i, buffer] of imageBuffers.entries()) {
    const { text, engine } = await ocrImage(buffer);
    engineUsed = engineUsed || engine;
    if (text) {
      pages.push(`--- page ${i + 1} ---\n${text}`);
      console.log(`[ocr] page ${i + 1}: ${text.length} characters (${engine})`);
    } else {
      console.log(`[ocr] page ${i + 1}: no text recognised`);
    }
  }

  return { text: pages.join("\n\n").trim(), engine: engineUsed || "none" };
}

/**
 * Whether OCR can run at all.
 *
 * The WebAssembly core has to be on disk before the worker is started: a
 * missing core aborts inside the worker thread, and the abort is not a
 * catchable JavaScript error.
 */
export function ocrAvailable() {
  try {
    require.resolve("tesseract.js");
  } catch {
    return false;
  }
  for (const candidate of CORE_CANDIDATES) {
    try {
      if (fs.existsSync(require.resolve(candidate))) return true;
    } catch {
      /* not this build */
    }
  }
  return false;
}

/** Releases the worker. Used when the process is shutting down. */
export async function shutdownOcr() {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    /* the worker is going away anyway */
  }
}

/**
 * The WebAssembly core files, kept in the deployment.
 *
 * The specifiers below are written out one by one on purpose. The tracer
 * reads them from the source, so a loop over an array of names would leave it
 * with a variable it cannot resolve. The function itself is never called —
 * requiring a WebAssembly file would fail — but the tracer sees the literals
 * and packages the binaries.
 */
function keepCoreInTheBundle() {
  try { require("tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm"); } catch { /* not this build */ }
  try { require("tesseract.js-core/tesseract-core-relaxedsimd.wasm"); } catch { /* not this build */ }
  try { require("tesseract.js-core/tesseract-core-simd-lstm.wasm"); } catch { /* not this build */ }
  try { require("tesseract.js-core/tesseract-core-simd.wasm"); } catch { /* not this build */ }
  try { require("tesseract.js-core/tesseract-core-lstm.wasm"); } catch { /* not this build */ }
  try { require("tesseract.js-core/tesseract-core.wasm"); } catch { /* not this build */ }
}

/** Exported so the function is not tree-shaken away before the tracer sees it. */
export const KEEP_CORE_IN_BUNDLE = keepCoreInTheBundle;

export { OCR_CACHE_DIR };
