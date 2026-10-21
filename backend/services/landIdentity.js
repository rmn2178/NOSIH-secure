/**
 * Land identity, hashing and document encryption.
 *
 * - propertyId / surveyNumberHash are KEYED hashes (HMAC with HASH_PEPPER):
 *   survey numbers are small and enumerable, so a plain hash on a public
 *   chain could be brute-forced back to the survey number.
 * - landDetailsHash / metadataHash / documentHash are SHA-256 over canonical
 *   input so anyone holding the same data can recompute them.
 * - Deed PDFs are encrypted with AES-256-GCM before IPFS upload.
 */

import crypto from "crypto";
import { ethers } from "ethers";
import { v4 as uuidv4 } from "uuid";

const ZERO = ethers.ZeroHash;

function requireHexKey(name) {
  const value = process.env[name];
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be set in backend/.env as 64 hex characters (32 bytes)`);
  }
  return Buffer.from(value, "hex");
}

// ── Normalization ───────────────────────────────────────

/** Uppercase, collapse whitespace, strip punctuation noise. */
export function norm(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}/\-.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Survey numbers: drop spaces so "123 / 4A" == "123/4A". */
export function normSurvey(value) {
  return norm(value).replace(/\s+/g, "");
}

/** Deterministic JSON: sorted keys, normalized string values. */
export function canonicalJson(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    sorted[key] = v === null || v === undefined ? "" : typeof v === "number" ? v : norm(v);
  }
  return JSON.stringify(sorted);
}

// ── Hash primitives ─────────────────────────────────────

const sha256Hex = (data) => "0x" + crypto.createHash("sha256").update(data).digest("hex");

function keyedHash(label, value) {
  return "0x" + crypto.createHmac("sha256", requireHexKey("HASH_PEPPER")).update(`${label}|${value}`).digest("hex");
}

export const idHash = (humanId) => ethers.keccak256(ethers.toUtf8Bytes(humanId));

// ── Jurisdiction ────────────────────────────────────────

/**
 * STATE-DISTRICT-TALUK, alphanumeric, ≤31 bytes so it fits bytes32.
 */
export function buildJurisdictionCode({ state, district, taluk }) {
  const part = (v) => norm(v).replace(/[^A-Z0-9]/g, "");
  const code = [part(state), part(district), part(taluk)].filter(Boolean).join("-");
  if (!code) throw new Error("State and district are required to build the jurisdiction code");
  return code.slice(0, 31);
}

export const jurisdictionBytes32 = (code) => ethers.encodeBytes32String(code.slice(0, 31));

// ── Land identity ───────────────────────────────────────

/**
 * Same jurisdiction + survey + subdivision ⇒ same propertyId ⇒ same Land ID.
 * This is what links a new deed to the parcel's existing history.
 */
export function computeLandIdentity({ jurisdictionCode, surveyNumber, subdivisionNumber }) {
  const survey = normSurvey(surveyNumber);
  if (!survey) throw new Error("Survey number is required");
  const subdiv = normSurvey(subdivisionNumber);

  const propertyId = keyedHash("property", `${jurisdictionCode}|${survey}|${subdiv}`);
  const landId = `LAND-${propertyId.slice(2, 12).toUpperCase()}`;
  const surveyNumberHash = keyedHash("survey", `${jurisdictionCode}|${survey}`);
  return { propertyId, landId, surveyNumberHash };
}

export function computeLandDetailsHash(d) {
  return sha256Hex(
    canonicalJson({
      surveyNumber: normSurvey(d.surveyNumber),
      subdivisionNumber: normSurvey(d.subdivisionNumber),
      area: d.area === "" || d.area === undefined || d.area === null ? "" : Number(d.area),
      areaUnit: d.areaUnit,
      boundaryNorth: d.boundaryNorth,
      boundarySouth: d.boundarySouth,
      boundaryEast: d.boundaryEast,
      boundaryWest: d.boundaryWest,
    })
  );
}

export function computeMetadataHash(d) {
  return sha256Hex(
    canonicalJson({
      documentType: d.documentType,
      registrationNumber: d.registrationNumber,
      registrationDate: d.registrationDate,
      sroOffice: d.sroOffice,
    })
  );
}

export const computeDocumentHash = (pdfBuffer) => sha256Hex(pdfBuffer);

// ── Owner identity ──────────────────────────────────────

export function ownerMatchKey(fullName, govIdRef) {
  return keyedHash("owner", `${norm(fullName)}|${norm(govIdRef).replace(/\s+/g, "")}`).slice(2);
}

export function govIdHash(govIdRef) {
  const v = norm(govIdRef).replace(/\s+/g, "");
  return v ? keyedHash("govid", v).slice(2) : null;
}

// ── Human IDs ───────────────────────────────────────────

const shortId = () => uuidv4().replace(/-/g, "").slice(0, 8).toUpperCase();
export const newRecordId = () => `REC-${shortId()}`;
export const newOwnerId = () => `OWN-${shortId()}`;

export const isLandId = (v) => /^LAND-[0-9A-F]{10}$/.test(v);
export const isRecordId = (v) => /^REC-[0-9A-F]{8}$/.test(v);

// ── Document encryption (AES-256-GCM) ───────────────────

export function encryptDocument(plainBuffer) {
  const key = requireHexKey("DOCUMENT_ENC_KEY");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  return { ciphertext, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}

export function decryptDocument(ciphertext, ivHex, tagHex) {
  const key = requireHexKey("DOCUMENT_ENC_KEY");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Fails fast at boot if secrets are missing/malformed. */
export function assertLandSecrets() {
  requireHexKey("DOCUMENT_ENC_KEY");
  requireHexKey("HASH_PEPPER");
}

export { ZERO };
