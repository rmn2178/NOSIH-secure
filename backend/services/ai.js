/**
 * AI Service — Land Deed Field Extraction (Gemini)
 *
 * PDF only.
 *   1. Digital PDF  → text layer → Gemini text call (fast, cheap).
 *   2. Scanned PDF  → first pages rendered to 1600px JPEG → Gemini vision.
 *
 * Extraction only pre-fills the form — the registrar reviews every field
 * before anything is hashed or written on-chain.
 */

import "../env.js"; // loads the repository-root .env — must come first
import fs from "fs";
import { createRequire } from "module";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

const require = createRequire(import.meta.url);

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
const GEMINI_TIMEOUT_MS = 60000;
const MAX_VISION_PAGES = 3;

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
    { model: GEMINI_MODEL, generationConfig: { thinkingConfig: { thinkingBudget: 0 } } },
    { timeout: timeoutMs }
  );
}

export const DEED_FIELDS = [
  "sellerName", "buyerName",
  "surveyNumber", "subdivisionNumber", "area", "areaUnit",
  "boundaryNorth", "boundarySouth", "boundaryEast", "boundaryWest",
  "village", "taluk", "district", "state",
  "documentType", "registrationNumber", "registrationDate", "sroOffice",
];

const FIELD_SPEC = `{
  "sellerName": "Executant / vendor / previous owner full name",
  "buyerName": "Claimant / purchaser / new owner full name",
  "surveyNumber": "Survey number only, e.g. 123 or 45/2",
  "subdivisionNumber": "Subdivision, e.g. 4A (empty if none)",
  "area": "Numeric area only, e.g. 2.45",
  "areaUnit": "acres | hectares | sq.ft | sq.m | cents | guntha",
  "boundaryNorth": "North boundary description",
  "boundarySouth": "South boundary description",
  "boundaryEast": "East boundary description",
  "boundaryWest": "West boundary description",
  "village": "Village / town",
  "taluk": "Taluk / tehsil / mandal",
  "district": "District",
  "state": "State",
  "documentType": "Sale Deed | Gift Deed | Settlement Deed | Partition Deed | Release Deed | Will | Other",
  "registrationNumber": "Document registration number",
  "registrationDate": "YYYY-MM-DD",
  "sroOffice": "Sub-Registrar Office name"
}`;

const RULES = `Rules:
- DO NOT guess. If a field is not clearly present, use an empty string "".
- If several properties are listed, use the FIRST scheduled property.
- Dates must be YYYY-MM-DD.
- Return ONLY valid JSON, no markdown.`;

/** Public entry point. */
export async function extractDeedMetadata(filePath, originalname = "deed.pdf") {
  console.log(`\n[extractDeedMetadata] ${originalname}`);

  const text = await tryPdfTextLayer(filePath);
  if (text) {
    console.log("Text layer found — Gemini text structuring");
    return structureWithGemini(text);
  }

  console.log("No text layer — Gemini vision");
  const images = await renderPdfPages(filePath);
  return extractWithGeminiVision(images);
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

async function renderPdfPages(filePath) {
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
      .jpeg({ quality: 85 })
      .toBuffer();
    out.push({ inlineData: { data: jpeg.toString("base64"), mimeType: "image/jpeg" } });
  }
  return out;
}

async function extractWithGeminiVision(imageParts) {
  const prompt = `You are a precise land-deed data extractor. These are pages of a registered property deed. Extract the fields and return ONLY this JSON:\n${FIELD_SPEC}\n\n${RULES}`;
  const result = await getGeminiModel().generateContent([prompt, ...imageParts]);
  return parseGeminiJsonResponse(result.response.text());
}

async function structureWithGemini(rawText) {
  const prompt = `You are a precise land-deed data extractor. Extract the fields from this deed text and return ONLY this JSON:\n${FIELD_SPEC}\n\n${RULES}\n\nDeed text:\n"""\n${rawText}\n"""`;
  const result = await getGeminiModel().generateContent([prompt]);
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
