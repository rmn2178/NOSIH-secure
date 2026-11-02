/**
 * AI Service — Land Deed Field Extraction (Gemini)
 *
 * PDF only. Four strategies, tried in the order listed in
 * EXTRACTION_STRATEGIES below, each falling through to the next on failure:
 *
 *   1. Text layer     → Gemini structures the extracted text.
 *                       Exact, cheap, and no rendering at all.
 *   2. Local OCR      → the pages are recognised here and the resulting text
 *      → text dump      dump is what goes to Gemini, against a fixed JSON
 *                       schema. The model never sees an image, so the payload
 *                       stays small and the pixels stay on the server.
 *   3. Whole PDF      → Gemini reads the original file itself, untouched.
 *   4. Rendered pages → Gemini reads the page images. The last resort.
 *
 * The strategy that answered is logged as `[ai] strategy: <id>`, and the ids
 * come from that one exported list — the checks read the same list, so a
 * reworded log line cannot silently stop matching them.
 *
 * Extraction only pre-fills the form — the registrar reviews every field
 * before anything is hashed or written on-chain.
 */

import "../env.js"; // loads the repository-root .env — must come first
import fs from "fs";
import { createRequire } from "module";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { ocrImages, ocrAvailable, shutdownOcr } from "./ocr.js";
import { canvasTextAvailable } from "./canvasIcu.js";

const require = createRequire(import.meta.url);

/**
 * The chain, in the order it is tried.
 *
 * This is the single description of the strategies. The service logs the id
 * that answered and the check scripts read this same list, so neither a
 * reordered chain nor a reworded log line can leave the checks reporting the
 * wrong strategy.
 *
 * `leaves` is what actually goes over the wire to the model — it is the
 * privacy story of each path, and it is worth stating plainly.
 */
export const EXTRACTION_STRATEGIES = [
  { id: "text-layer", name: "The text layer", leaves: "the PDF's own text layer" },
  { id: "local-ocr", name: "Local OCR → text dump", leaves: "an OCR text dump — no pixels leave the server" },
  { id: "whole-pdf", name: "The whole PDF", leaves: "the original PDF, base64" },
  { id: "rendered-vision", name: "Rendered pages", leaves: "rendered page images, base64" },
];

/**
 * Logs the strategy that answered.
 *
 * The prefix is machine-readable and stable; the detail after it is free to
 * change without breaking anything that parses the log.
 */
function reportStrategy(id, detail = "") {
  console.log(`[ai] strategy: ${id}${detail ? ` — ${detail}` : ""}`);
}

// pdf-to-png-converter and sharp are native modules. They are loaded on first
// use so a platform-level binary problem cannot kill the whole function at
// import time — only the scanned-PDF extraction path would be affected.
let pdfToPngPromise = null;
function getPdfToPng() {
  if (!pdfToPngPromise) {
    pdfToPngPromise = import("pdf-to-png-converter").then((m) => m.pdfToPng);
  }
  return pdfToPngPromise;
}

let sharpPromise = null;
function getSharp() {
  if (!sharpPromise) sharpPromise = import("sharp").then((m) => m.default ?? m);
  return sharpPromise;
}

/**
 * PDF.js needs its worker module before it can read a PDF.
 *
 * PDF.js imports the worker itself with a bundler-ignore hint, so the file
 * is left out of a serverless deployment — the failure reads "Setting up
 * fake worker failed" and a scanned deed cannot be extracted. Importing it
 * here gives the file tracer a literal specifier to follow, so the worker is
 * packaged next to the PDF.js module that looks for it.
 *
 * The import is the whole point: the worker must not be handed to PDF.js by
 * hand. pdf-parse bundles its own copy of PDF.js, and a worker from a
 * different version is refused with "The API version does not match the
 * Worker version".
 */
let pdfWorkerPromise = null;
function primePdfWorker() {
  if (!pdfWorkerPromise) {
    pdfWorkerPromise = import("pdfjs-dist/legacy/build/pdf.worker.mjs").catch((err) => {
      // PDF.js falls back to resolving the worker next to its own module,
      // which works whenever that file was packaged.
      console.warn("[ai] PDF.js worker could not be preloaded:", err.message);
    });
  }
  return pdfWorkerPromise;
}

/**
 * PDF.js reads DOMMatrix, ImageData and Path2D at module scope.
 *
 * Those are browser globals. In Node they do not exist, and PDF.js's own
 * fallback reaches for @napi-rs/canvas through a runtime `require` that a
 * serverless file tracer cannot follow. The module is therefore missing in
 * production, the polyfill never happens, and the extraction dies with
 *
 *     DOMMatrix is not defined
 *
 * Importing @napi-rs/canvas by name here gives the tracer a literal specifier
 * to follow, so the module is packaged with the function. Setting the globals
 * before PDF.js loads also means PDF.js never attempts its own require.
 *
 * Like the native modules above, this is loaded on first use rather than at
 * import time, so a platform problem cannot take the whole function down.
 */
let canvasPromise = null;
async function primeBrowserGlobals() {
  if (globalThis.DOMMatrix && globalThis.ImageData && globalThis.Path2D) return;
  if (!canvasPromise) {
    canvasPromise = import("@napi-rs/canvas")
      .then((canvas) => {
        globalThis.DOMMatrix ??= canvas.DOMMatrix;
        globalThis.ImageData ??= canvas.ImageData;
        globalThis.Path2D ??= canvas.Path2D;
        console.log("[ai] browser globals primed for PDF.js");
      })
      .catch((err) => {
        console.warn("[ai] @napi-rs/canvas is unavailable:", err.message);
      });
  }
  return canvasPromise;
}

// pdf-parse v2+ exports a class. Loaded on first use for the same reason as
// the native modules above.
let pdfParsePromise = null;
function getPDFParse() {
  if (!pdfParsePromise) {
    pdfParsePromise = Promise.resolve(require("pdf-parse").PDFParse);
  }
  return pdfParsePromise;
}

// gemini-3.6-flash is the fastest model answering reliably (3.8 hangs).
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 45000);
// Reading a whole PDF takes longer than reading a page image.
const GEMINI_PDF_TIMEOUT_MS = Number(process.env.GEMINI_PDF_TIMEOUT_MS || 60000);
const MAX_VISION_PAGES = 3;

// A busy model answers 503. Retrying once or twice is the difference between
// a deed that reads and a deed that does not.
const GEMINI_MAX_ATTEMPTS = Number(process.env.GEMINI_MAX_ATTEMPTS || 3);
const GEMINI_BACKOFF_MS = Number(process.env.GEMINI_BACKOFF_MS || 750);

// The whole extraction, start to finish. Once it is spent the chain stops
// trying more strategies rather than running past the platform's limit.
const EXTRACTION_BUDGET_MS = Number(process.env.EXTRACTION_BUDGET_MS || 120000);

let genAI = null;
function getGenAI() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set in the root .env");
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

function getGeminiModel(timeoutMs = GEMINI_TIMEOUT_MS) {
  return getGenAI().getGenerativeModel(
    {
      model: GEMINI_MODEL,
      generationConfig: {
        thinkingConfig: { thinkingBudget: 0 },
        // The returnable schema. The answer is JSON in this shape by contract.
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    },
    {
      timeout: timeoutMs,
      // An optional gateway or regional endpoint. It is also the seam the
      // resilience check uses: pointed at a local stand-in server, the retry
      // and budget behaviour can be proved without calling the real API.
      ...(process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : {}),
    }
  );
}

/**
 * Whether a failure is worth retrying.
 *
 * A busy model, a rate limit and a dropped connection are all transient. A
 * bad key or a malformed request is not, and retrying those only wastes the
 * budget.
 *
 * The HTTP status is read from the error object first. Matching the message
 * alone is not safe: the SDK puts the request URL in it, and a bare substring
 * test would read the "500" inside a port number as a server error.
 */
function isTransient(err) {
  const status = Number(err?.status ?? err?.response?.status);
  if (Number.isFinite(status) && status > 0) return status === 429 || status >= 500;

  const message = String(err?.message || err || "");
  return /\b(?:429|500|502|503|504)\b|unavailable|resource[_ ]exhausted|rate limit|too many requests|fetch failed|etimedout|econnreset|econnrefused|enotfound|socket hang up|network|timeout|abort/i.test(
    message
  );
}

/**
 * Calls the model, retrying the transient failures with a backoff.
 *
 * The deadline is passed in rather than kept in module state: one Express
 * process serves several extractions at once, and a shared deadline would let
 * one request spend another request's budget.
 *
 * @param {any[]} parts the content parts
 * @param {number} timeoutMs the per-attempt timeout
 * @param {number} deadline absolute ms after which no further attempt is made
 */
async function generateContent(parts, timeoutMs = GEMINI_TIMEOUT_MS, deadline = Infinity) {
  let lastError = null;

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw lastError || new Error("the extraction budget is spent");
    }

    try {
      // An attempt never outlives the budget, even on the first try.
      return await getGeminiModel(Math.min(timeoutMs, remaining)).generateContent(parts);
    } catch (err) {
      lastError = err;

      const wait = GEMINI_BACKOFF_MS * 2 ** (attempt - 1);
      const exhausted = attempt === GEMINI_MAX_ATTEMPTS || Date.now() + wait >= deadline;
      if (!isTransient(err) || exhausted) throw err;

      const reason = String(err.message || err).split("\n")[0].slice(0, 120);
      console.warn(`[ai] the model call failed (${reason}) — retry ${attempt + 1}/${GEMINI_MAX_ATTEMPTS} in ${wait} ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw lastError;
}

/**
 * Whether a failure no other strategy can recover from.
 *
 * A missing key, a rejected key, a disabled API or a malformed request will
 * fail identically on all four paths. Trying the remaining three only spends
 * the budget and, on the scanned path, renders and recognises pages for
 * nothing. The chain stops at once and says why in the log.
 */
function isFatalModelError(err) {
  const status = Number(err?.status);
  if ([400, 401, 403, 404].includes(status)) return true;
  return /api[ _-]?key|permission|unauthenticated|billing|not set in the root \.env|invalid argument/i.test(
    String(err?.message || err || "")
  );
}

export const DEED_FIELDS = [
  "sellerName", "buyerName",
  "surveyNumber", "subdivisionNumber", "area", "areaUnit",
  "boundaryNorth", "boundarySouth", "boundaryEast", "boundaryWest",
  "village", "taluk", "district", "state",
  "documentType", "registrationNumber", "registrationDate", "sroOffice",
];

/**
 * What each field means.
 *
 * One description per field, and both the prompt text and the API's
 * responseSchema are derived from it. Writing the contract twice is how the
 * two drift apart; deriving them means a field cannot be described one way to
 * the model and enforced another.
 */
const FIELD_DESCRIPTIONS = {
  sellerName: "Executant / vendor / previous owner full name",
  buyerName: "Claimant / purchaser / new owner full name",
  surveyNumber: "Survey number exactly as written, including any fraction, e.g. 123 or 45/2 or 1963/3000",
  subdivisionNumber: "Subdivision, e.g. 4A (empty if none)",
  area: "Numeric area only, e.g. 2.45",
  areaUnit: "acres | hectares | sq.ft | sq.m | cents | guntha",
  boundaryNorth: "North boundary description",
  boundarySouth: "South boundary description",
  boundaryEast: "East boundary description",
  boundaryWest: "West boundary description",
  village: "Village / town",
  taluk: "Taluk / tehsil / mandal",
  district: "District",
  state: "State",
  documentType: "Sale Deed | Gift Deed | Settlement Deed | Partition Deed | Release Deed | Will | Other",
  registrationNumber: "Document registration number",
  registrationDate: "YYYY-MM-DD",
  sroOffice: "Sub-Registrar Office name",
};

/** The schema as the prompt shows it. */
const FIELD_SPEC = `{\n${DEED_FIELDS.map(
  (key) => `  "${key}": ${JSON.stringify(FIELD_DESCRIPTIONS[key] ?? "")}`
).join(",\n")}\n}`;

/**
 * The schema as the API enforces it.
 *
 * responseMimeType + responseSchema make the model return JSON in this exact
 * shape, so a well-formed answer is a property of the call rather than a hope
 * about the prompt. parseGeminiJsonResponse still coerces and validates, because
 * a schema constrains the shape of an answer, not the truth of its values.
 *
 * Every field is a string, including "area": the model is not asked to do
 * arithmetic, and the numeric conversion happens here where it can be checked.
 */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    DEED_FIELDS.map((key) => [key, { type: "string", description: FIELD_DESCRIPTIONS[key] ?? "" }])
  ),
  required: [...DEED_FIELDS],
  propertyOrdering: [...DEED_FIELDS],
};

/**
 * The returnable schema's rules.
 *
 * One block, shared by all three model calls, so a digital deed, an OCR text
 * dump and a page image are all held to the same contract. The fraction rule
 * is here because a survey number like 1963/3000 is one identifier, not a
 * number plus a subdivision, and splitting it silently corrupts the record.
 */
const SCHEMA_RULES = `The values must satisfy these rules:
- Every key is present. A field that is not stated is an empty string "".
- Do not guess, infer or complete a field from context. If it is not stated, it is "".
- If several properties are listed, use the FIRST scheduled property.
- "area" is a number with no unit and no thousands separator. "areaUnit" is one of acres, hectares, sq.ft, sq.m, cents, guntha.
- "registrationDate" is YYYY-MM-DD.
- "surveyNumber" is the survey number exactly as written, including any fraction: "1963/3000" stays "1963/3000" and "45/2" stays "45/2". Do not move a fraction into "subdivisionNumber".
- "documentType" is one of: Sale Deed, Gift Deed, Settlement Deed, Partition Deed, Release Deed, Will, Other.

Return ONLY the JSON object. No markdown, no explanation.`;

/** What the registrar is told when no strategy could read the deed. */
const MANUAL_ENTRY =
  "This deed could not be read automatically. You can fill the form manually.";

/**
 * Quick PDF analysis (< 100ms)
 * Detects document type to optimize strategy selection
 */
async function analyzePDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  
  // Check for text layer
  let hasTextLayer = false;
  try {
    const PDFParse = await getPDFParse();
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    hasTextLayer = (parsed.text || "").trim().length > 200;
    await parser?.destroy();
  } catch {
    hasTextLayer = false;
  }
  
  // Get page count
  let pageCount = 1;
  try {
    const PDFParse = await getPDFParse();
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    pageCount = parsed.numpages || 1;
    await parser?.destroy();
  } catch {
    pageCount = 1;
  }
  
  // Detect if scanned (heuristic: PDF size vs page count)
  const sizeKB = buffer.length / 1024;
  const isScanned = (sizeKB / pageCount) > 200; // >200KB per page suggests images
  
  return {
    hasTextLayer,
    isScanned,
    pageCount,
    sizeKB: Math.round(sizeKB)
  };
}

/**
 * Runs multiple extraction strategies in parallel.
 * Returns as soon as the first successful one completes.
 */
export async function extractDeedMetadataParallel(filePath, originalname = "deed.pdf") {
  console.log(`\n[extractDeedMetadata:parallel] ${originalname}`);
  const startedAt = Date.now();
  const deadline = startedAt + EXTRACTION_BUDGET_MS;
  
  // Quick analysis
  const profile = await timed("analyze", () => analyzePDF(filePath));
  console.log(`[ai] profile: ${profile.pageCount}pg, text=${profile.hasTextLayer}, scanned=${profile.isScanned}, ${profile.sizeKB}KB`);
  
  // Prime engines
  await primeBrowserGlobals();
  await primePdfWorker();
  
  // Build strategy list based on PDF profile
  const strategies = [];
  
  if (profile.hasTextLayer) {
    strategies.push({
      id: "text-layer",
      priority: 1,
      delayMs: 0,
      fn: async () => {
        const text = await tryPdfTextLayer(filePath);
        if (!text) throw new Error("no text layer");
        return await structureWithGemini(text, "the deed's own text layer", deadline);
      }
    });
    
    // Backup: whole PDF
    strategies.push({
      id: "whole-pdf",
      priority: 3,
      delayMs: 3000,
      fn: () => extractWithGeminiPdf(filePath, deadline)
    });
  }
  
  if (profile.isScanned && ocrAvailable() && canvasTextAvailable()) {
    strategies.push({
      id: "local-ocr",
      priority: 2,
      delayMs: profile.hasTextLayer ? 2000 : 0,
      fn: async () => {
        const buffers = await renderPdfPageBuffers(filePath);
        const { text: ocrText } = await ocrImages(buffers);
        if (!ocrText || ocrText.length < 40) throw new Error("OCR produced too little text");
        return await structureWithGemini(ocrText, "a scanned image", deadline);
      }
    });
  }
  
  if (!profile.hasTextLayer || profile.isScanned) {
    if (!strategies.some(s => s.id === "whole-pdf")) {
      strategies.push({
        id: "whole-pdf",
        priority: 3,
        delayMs: 4000,
        fn: () => extractWithGeminiPdf(filePath, deadline)
      });
    }
    
    strategies.push({
      id: "rendered-vision",
      priority: 4,
      delayMs: 6000,
      fn: async () => {
        const pageImages = await renderPdfPages(filePath);
        return await extractWithGeminiVision(pageImages, deadline);
      }
    });
  }
  
  // Sort by priority
  strategies.sort((a, b) => a.priority - b.priority);
  
  // Race all strategies with delays
  const promises = strategies.map(strategy => {
    return new Promise(async (resolve, reject) => {
      try {
        // Wait for delay
        if (strategy.delayMs > 0) {
          await new Promise(r => setTimeout(r, strategy.delayMs));
        }
        
        // Check if budget exhausted
        if (Date.now() >= deadline) {
          return reject(new Error("budget exhausted"));
        }
        
        console.log(`[ai] trying ${strategy.id}...`);
        const result = await strategy.fn();
        
        if (isUsefulExtraction(result)) {
          reportStrategy(strategy.id, "success");
          resolve({ strategy: strategy.id, data: result });
        } else {
          reject(new Error(`${strategy.id}: insufficient fields`));
        }
      } catch (err) {
        console.warn(`[ai] ${strategy.id} failed: ${err.message}`);
        reject(err);
      }
    });
  });
  
  // Return first successful result
  try {
    const result = await Promise.race(promises);
    console.log(`[ai] ✓ ${result.strategy} succeeded in ${Date.now() - startedAt}ms`);
    return result.data;
  } catch (err) {
    // All failed
    const elapsed = Date.now() - startedAt;
    console.error(`[ai] ✗ all strategies failed after ${elapsed}ms`);
    throw new Error(MANUAL_ENTRY);
  }
}

/** Public entry point. */
export async function extractDeedMetadata(filePath, originalname = "deed.pdf") {
  console.log(`\n[extractDeedMetadata] ${originalname}`);
  const startedAt = Date.now();
  const deadline = startedAt + EXTRACTION_BUDGET_MS;

  /** True while there is still time left for another strategy. */
  const withinBudget = () => {
    if (Date.now() >= deadline) {
      console.warn(`[ai] the extraction budget of ${EXTRACTION_BUDGET_MS} ms is spent`);
      return false;
    }
    return true;
  };

  /**
   * Handles a strategy failure.
   *
   * A recoverable one is logged and the chain moves on. A permanent one ends
   * the chain here: the cause goes to the log, and the registrar is told to
   * fill the form in rather than being shown a server configuration detail.
   */
  const strategyFailed = (label, err) => {
    if (isFatalModelError(err)) {
      console.error(`[ai] ${label} failed permanently — no other strategy can recover: ${err.message}`);
      throw new Error(MANUAL_ENTRY);
    }
    console.warn(`[ai] ${label} failed: ${err.message}`);
  };

  // PDF.js cannot read anything until its globals and its worker are in place.
  await primeBrowserGlobals();
  await primePdfWorker();

  // ── 1. The text layer ─────────────────────────────────
  const text = await timed("text layer", () => tryPdfTextLayer(filePath));
  if (text) {
    reportStrategy("text-layer", `${text.length} characters read without rendering`);
    try {
      return await timed("gemini text", () =>
        structureWithGemini(text, "the deed's own text layer", deadline)
      );
    } catch (err) {
      strategyFailed("text-layer structuring", err);
    }
  } else {
    console.log("No text layer");
  }

  // ── 2. OCR locally, then send the text dump ──────────
  // The pages are recognised here and only the resulting text is sent to the
  // model, which returns the fields against the schema. The model never sees
  // an image: the payload stays small, the call stays fast, and the pixels
  // never leave the server.
  //
  // The availability check comes first: a missing WebAssembly core aborts
  // inside the worker thread, and that abort is not a catchable error.
  if (!ocrAvailable()) {
    console.warn("[ai] no OCR engine is available, so the local OCR path is skipped");
  } else if (!canvasTextAvailable()) {
    console.warn("[ai] the canvas cannot render pages, so the local OCR path is skipped");
  } else if (withinBudget()) {
    try {
      const buffers = await timed("render pages", () => renderPdfPageBuffers(filePath));
      const { text: ocrText, engine } = await timed("local OCR", () => ocrImages(buffers));

      if (!ocrText || ocrText.length < 40) {
        throw new Error("the OCR pass produced too little text to read");
      }
      reportStrategy("local-ocr", `${engine}, ${ocrText.length} characters of text dump`);
      return await timed("gemini ocr text", () =>
        structureWithGemini(ocrText, "a scanned image of the deed", deadline)
      );
    } catch (err) {
      strategyFailed("local OCR extraction", err);
    }
  }

  // ── 3. The whole PDF ──────────────────────────────────
  // The fallback for a scan this server could not read: no OCR engine, no
  // usable canvas, or a recognition pass that produced nothing. Gemini reads
  // the original file directly, so no rendering is needed on this path.
  if (withinBudget()) {
    try {
      const result = await timed("gemini whole-pdf", () => extractWithGeminiPdf(filePath, deadline));
      reportStrategy("whole-pdf", "the original file read by the model");
      return result;
    } catch (err) {
      strategyFailed("whole-PDF extraction", err);
    }
  }

  // ── 4. Rendered pages, read as images ────────────────
  if (withinBudget()) {
    try {
      const pageImages = await timed("render pages", () => renderPdfPages(filePath));
      const result = await timed("gemini vision", () => extractWithGeminiVision(pageImages, deadline));
      reportStrategy("rendered-vision", `${pageImages.length} page image(s)`);
      return result;
    } catch (err) {
      strategyFailed("vision extraction", err);
    }
  }

  throw new Error(MANUAL_ENTRY);
}

/**
 * Runs a step and logs how long it took.
 *
 * The extraction chain has four strategies and only the log says which one
 * answered. The timings are what make a slow deployment diagnosable.
 */
async function timed(label, fn) {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - started;
    if (ms >= 200) console.log(`[ai] ${label}: ${ms} ms`);
  }
}

async function tryPdfTextLayer(filePath) {
  let parser;
  try {
    const PDFParse = await getPDFParse();
    parser = new PDFParse({ data: fs.readFileSync(filePath) });
    const parsed = await parser.getText();
    const t = (parsed.text || "").trim();
    return t.length >= 200 ? t.slice(0, 60000) : null;
  } catch (err) {
    console.warn("pdf-parse failed:", err.message);
    return null;
  } finally {
    try { await parser?.destroy(); } catch { /* ignore */ }
  }
}

/**
 * Renders the first pages to JPEG buffers.
 *
 * JPEG rather than PNG because it encodes several times faster and both
 * consumers — the OCR engine and the vision model — read it happily. The
 * render happens once and the result is shared.
 */
async function renderPdfPageBuffers(filePath) {
  const pdfToPng = await getPdfToPng();
  const sharp = await getSharp();
  const pages = await pdfToPng(filePath, {
    viewportScale: 2.0,
    pagesToProcess: Array.from({ length: MAX_VISION_PAGES }, (_, i) => i + 1),
  });
  const out = [];
  for (const page of pages.slice(0, MAX_VISION_PAGES)) {
    const jpeg = await sharp(page.content)
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    out.push(jpeg);
  }
  return out;
}

/** Renders the first pages to Gemini image parts. */
async function renderPdfPages(filePath) {
  const buffers = await renderPdfPageBuffers(filePath);
  return buffers.map((jpeg) => ({
    inlineData: { data: jpeg.toString("base64"), mimeType: "image/jpeg" },
  }));
}

async function extractWithGeminiVision(imageParts, deadline = Infinity) {
  const prompt = `You are a precise land-deed data extractor. These are pages of a registered property deed. Read them and return a single JSON object with exactly these keys, and no others:

${FIELD_SPEC}

${SCHEMA_RULES}`;
  const result = await generateContent([prompt, ...imageParts], GEMINI_TIMEOUT_MS, deadline);
  return parseGeminiJsonResponse(result.response.text());
}

/**
 * Sends the whole PDF to Gemini.
 *
 * The document's SHA-256 travels with it, so the model can refer to the exact
 * file it was given and the server can tie the answer back to the bytes that
 * will be hashed and registered.
 */
async function extractWithGeminiPdf(filePath, deadline = Infinity) {
  const crypto = await import("node:crypto");
  const pdf = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(pdf).digest("hex");

  const prompt = `You are a precise land-deed data extractor. The attached document is a registered property deed. It may be a scan with no text layer — read it from the images. Return a single JSON object with exactly these keys, and no others:

${FIELD_SPEC}

${SCHEMA_RULES}

The SHA-256 of this exact file is ${hash}.`;

  const result = await generateContent(
    [
      prompt,
      { inlineData: { mimeType: "application/pdf", data: pdf.toString("base64") } },
    ],
    GEMINI_PDF_TIMEOUT_MS,
    deadline
  );
  return parseGeminiJsonResponse(result.response.text());
}

/**
 * Structures a text dump against the returnable schema.
 *
 * This is the path both the text layer and the local OCR engine use. The model
 * receives plain text and a fixed JSON contract — never an image — which keeps
 * the payload small, the call fast, and the pixels on the server.
 */
async function structureWithGemini(rawText, source = "the deed", deadline = Infinity) {
  const prompt = `You are a precise land-deed data extractor. Below is the text of a registered property deed, taken from ${source}.

Return a single JSON object with exactly these keys, and no others:

${FIELD_SPEC}

${SCHEMA_RULES}

Deed text:
"""
${rawText}
"""`;
  const result = await generateContent([prompt], GEMINI_TIMEOUT_MS, deadline);
  return parseGeminiJsonResponse(result.response.text());
}

function parseGeminiJsonResponse(text) {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  let parsed;
  try {
    parsed = JSON.parse(match ? match[0] : cleaned);
  } catch {
    throw new Error("AI returned invalid JSON");
  }

  const out = {};
  for (const key of DEED_FIELDS) out[key] = String(parsed[key] ?? "").trim();

  if (out.area) {
    const n = out.area.replace(/,/g, "").match(/\d+(\.\d+)?/);
    out.area = n ? n[0] : "";
  }
  if (out.registrationDate && !/^\d{4}-\d{2}-\d{2}$/.test(out.registrationDate)) {
    out.registrationDate = "";
  }
  return out;
}

/** Enough to be useful: survey + location + at least one party. */
export function isUsefulExtraction(r) {
  return Boolean(r?.surveyNumber && (r.district || r.state) && (r.buyerName || r.sellerName));
}

/**
 * Releases what the extraction chain holds open.
 *
 * The OCR worker is a live thread. Exiting the process with it still running
 * trips a libuv assertion on Windows and can leave a serverless instance
 * unable to freeze, so a caller that is about to exit — a check script, a
 * signal handler — releases it here first.
 */
export async function shutdownExtraction() {
  await shutdownOcr();
}
