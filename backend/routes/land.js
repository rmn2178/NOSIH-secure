/**
 * Land Deed Routes (registrar portal — JWT protected)
 *
 * POST /api/land/extract                    AI pre-fill from a deed PDF
 * POST /api/land/preview                    Land ID preview + existing chain head
 * POST /api/land/register                   Encrypt → IPFS → chain → Supabase
 * GET  /api/land                            List / search records
 * GET  /api/land/stats                      Dashboard counters
 * GET  /api/land/records/:recordId          Full record + parcel history
 * GET  /api/land/records/:recordId/document Decrypted original PDF
 * POST /api/land/records/:recordId/revoke   Revoke on-chain + mirror status
 *
 * Linking is resolved entirely from Supabase: same jurisdiction + survey +
 * subdivision ⇒ same Land ID ⇒ the new record points at the current head.
 * No chain reads, no extra gas.
 */

import "../env.js"; // loads the repository-root .env — must come first
import { Router } from "express";
import multer from "multer";
import { MAX_UPLOAD_BYTES } from "../config.js";
import fs from "fs";
import os from "os";
import path from "path";
import Joi from "joi";
import { protect } from "../middleware/auth.js";
import { supabase, isUniqueViolation, landRecordFromRow } from "../supabase.js";
import { extractDeedMetadata, isUsefulExtraction } from "../services/ai.js";
import { uploadToIPFS, fetchIPFSFile } from "../services/ipfs.js";
import { registerRecordOnChain, revokeRecordOnChain } from "../services/blockchain.js";
import { generateLandQr } from "../services/qr.js";
import {
  ZERO, idHash, norm,
  buildJurisdictionCode, jurisdictionBytes32, computeLandIdentity,
  computeLandDetailsHash, computeMetadataHash, computeDocumentHash,
  ownerMatchKey, govIdHash, newRecordId, newOwnerId, isLandId, isRecordId,
  encryptDocument, decryptDocument,
} from "../services/landIdentity.js";

const router = Router();

const OWNER_JOIN =
  "current_owner:owners!land_records_current_owner_id_fkey(owner_id, full_name), " +
  "previous_owner:owners!land_records_previous_owner_id_fkey(owner_id, full_name)";

// ── PDF-only upload ─────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(httpError(400, "Only PDF deeds are accepted"), false);
    cb(null, true);
  },
});

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

/** Mimetype is client-supplied — also check the %PDF magic bytes. */
function assertPdf(file) {
  if (!file) throw httpError(400, "A deed PDF is required");
  if (file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw httpError(400, "File is not a valid PDF");
  }
}

function sendError(res, err, fallback) {
  const status = Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error(`[land] ${fallback}:`, err);
  res.status(status).json({ error: err.message || fallback, ...(err.payload || {}) });
}

const text = (max = 300) => Joi.string().trim().max(max).allow("", null);

const locationSchema = {
  state: Joi.string().trim().max(60).required(),
  district: Joi.string().trim().max(60).required(),
  taluk: text(60),
  surveyNumber: Joi.string().trim().max(40).required(),
  subdivisionNumber: text(40),
  landIdOverride: text(20),
};

const previewSchema = Joi.object(locationSchema).options({ stripUnknown: true });

const registerSchema = Joi.object({
  ...locationSchema,
  village: text(80),
  sellerName: text(120),
  sellerGovId: text(40),
  buyerName: Joi.string().trim().max(120).required(),
  buyerGovId: text(40),
  area: Joi.alternatives(Joi.number().min(0), Joi.string().trim().allow("", null).pattern(/^\d+(\.\d+)?$/)),
  areaUnit: text(20),
  boundaryNorth: text(), boundarySouth: text(), boundaryEast: text(), boundaryWest: text(),
  documentType: text(40),
  registrationNumber: text(60),
  registrationDate: Joi.string().trim().pattern(/^\d{4}-\d{2}-\d{2}$/).allow("", null)
    .messages({ "string.pattern.base": "registrationDate must be YYYY-MM-DD" }),
  sroOffice: text(120),
}).options({ stripUnknown: true });

function validate(schema, body) {
  const { error, value } = schema.validate(body, { abortEarly: false });
  if (error) throw httpError(400, "Validation failed", { payload: { details: error.details.map((d) => d.message).join("; ") } });
  return value;
}

// ── Land resolution (off-chain only) ────────────────────

async function getHead(landId) {
  const { data, error } = await supabase
    .from("land_records")
    .select(`*, ${OWNER_JOIN}`)
    .eq("land_id", landId)
    .eq("is_latest", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Computes the parcel identity from the form. If the registrar supplies an
 * existing Land ID (spelling of the location differs from the earlier deed),
 * that parcel's stored identity is reused so the history doesn't split.
 */
async function resolveLand(v) {
  const override = String(v.landIdOverride || "").trim().toUpperCase();
  if (override) {
    if (!isLandId(override)) throw httpError(400, "Existing Land ID must look like LAND-XXXXXXXXXX");
    const head = await getHead(override);
    if (!head) throw httpError(404, `Land ID ${override} has no registered records`);
    return {
      landId: override,
      propertyId: head.property_id,
      surveyNumberHash: head.survey_number_hash,
      jurisdictionCode: head.jurisdiction_code,
      head,
      overridden: true,
    };
  }

  const jurisdictionCode = buildJurisdictionCode(v);
  const identity = computeLandIdentity({ jurisdictionCode, ...v });
  const head = await getHead(identity.landId);
  return { ...identity, jurisdictionCode, head, overridden: false };
}

async function findOrCreateOwner(fullName, govIdRef) {
  const matchKey = ownerMatchKey(fullName, govIdRef);
  const existing = await supabase.from("owners").select("*").eq("match_key", matchKey).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data;

  const ownerId = newOwnerId();
  const { data, error } = await supabase
    .from("owners")
    .insert({
      owner_id: ownerId,
      owner_hash: idHash(ownerId),
      full_name: String(fullName).trim().replace(/\s+/g, " "),
      match_key: matchKey,
      gov_id_hash: govIdHash(govIdRef),
    })
    .select()
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      const again = await supabase.from("owners").select("*").eq("match_key", matchKey).single();
      if (again.data) return again.data;
    }
    throw new Error(error.message);
  }
  return data;
}

async function getOwner(ownerId) {
  if (!ownerId) return null;
  const { data } = await supabase.from("owners").select("*").eq("owner_id", ownerId).maybeSingle();
  return data;
}

// ── EXTRACT ─────────────────────────────────────────────

router.post("/extract", protect, upload.single("deed"), async (req, res) => {
  let tmp = null;
  try {
    assertPdf(req.file);
    tmp = path.join(os.tmpdir(), `nosih-deed-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, req.file.buffer);

    const data = await extractDeedMetadata(tmp, req.file.originalname);
    if (!isUsefulExtraction(data)) {
      return res.json({ success: false, data, error: "Could not read enough fields from this deed. Please complete the form manually." });
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err.status === 400) return sendError(res, err, "Extraction failed");
    console.error("[land/extract]", err.message);
    res.json({ success: false, data: null, error: `Extraction failed: ${err.message}. You can fill the form manually.` });
  } finally {
    if (tmp) fs.rm(tmp, { force: true }, () => {});
  }
});

// ── PREVIEW ─────────────────────────────────────────────

router.post("/preview", protect, async (req, res) => {
  try {
    const v = validate(previewSchema, req.body);
    const land = await resolveLand(v);
    let recordCount = 0;
    if (land.head) {
      const { count } = await supabase
        .from("land_records")
        .select("id", { count: "exact", head: true })
        .eq("land_id", land.landId);
      recordCount = count || 0;
    }
    res.json({
      landId: land.landId,
      jurisdictionCode: land.jurisdictionCode,
      exists: Boolean(land.head),
      overridden: land.overridden,
      recordCount,
      head: land.head
        ? {
            recordId: land.head.record_id,
            currentOwnerId: land.head.current_owner_id,
            currentOwnerName: land.head.current_owner?.full_name || null,
            documentType: land.head.document_type,
            registrationDate: land.head.registration_date,
            status: land.head.status,
          }
        : null,
    });
  } catch (err) {
    sendError(res, err, "Preview failed");
  }
});

// ── REGISTER ────────────────────────────────────────────

router.post("/register", protect, upload.single("deed"), async (req, res) => {
  try {
    assertPdf(req.file);
    const v = validate(registerSchema, req.body);
    const pdf = req.file.buffer;

    // 1. Duplicate PDF guard (off-chain — free)
    const documentHash = computeDocumentHash(pdf);
    const dup = await supabase
      .from("land_records")
      .select("record_id, land_id")
      .eq("document_hash", documentHash)
      .maybeSingle();
    if (dup.data) {
      throw httpError(409, "This exact deed PDF is already registered", {
        payload: { existingRecordId: dup.data.record_id, existingLandId: dup.data.land_id },
      });
    }

    // 2. Parcel identity + current head (linking resolved from Supabase)
    const land = await resolveLand(v);
    const head = land.head;

    // 3. Owners — registry IDs only go on-chain
    const currentOwner = await findOrCreateOwner(v.buyerName, v.buyerGovId);
    let previousOwner = null;
    if (head) {
      // A revoked head's transfer is void: the owner before it is the real seller.
      previousOwner = head.status === "revoked"
        ? await getOwner(head.previous_owner_id)
        : await getOwner(head.current_owner_id);
    } else if (v.sellerName) {
      previousOwner = await findOrCreateOwner(v.sellerName, v.sellerGovId);
    }

    // 4. Content hashes
    const landDetailsHash = computeLandDetailsHash(v);
    const metadataHash = computeMetadataHash(v);
    const recordId = newRecordId();
    const recordIdHash = idHash(recordId);

    // 5. Encrypt then pin — the CID never exposes the plaintext deed
    const { ciphertext, iv, tag } = encryptDocument(pdf);
    const ipfsCID = await uploadToIPFS(ciphertext, `${recordId}.pdf.enc`, "application/octet-stream");
    console.log(`IPFS (encrypted) ${recordId}: ${ipfsCID}`);

    // 6. One chain write
    const onChain = {
      propertyId: land.propertyId,
      surveyNumberHash: land.surveyNumberHash,
      jurisdictionCode: jurisdictionBytes32(land.jurisdictionCode),
      landDetailsHash,
      documentHash,
      metadataHash,
      ipfsCID,
      recordId: recordIdHash,
      previousRecordId: head ? head.record_id_hash : ZERO,
      previousOwnerId: previousOwner ? previousOwner.owner_hash : ZERO,
      currentOwnerId: currentOwner.owner_hash,
    };
    const { txHash, registeredAt } = await registerRecordOnChain(onChain);

    // 7. QR showing the Land ID
    const { verifyUrl, qrDataUrl } = await generateLandQr(land.landId, req);

    // 8. Move the head: unset old latest, insert new latest (restore on failure)
    if (head) {
      const { error } = await supabase.from("land_records").update({ is_latest: false }).eq("id", head.id);
      if (error) throw new Error(`Failed to update previous record: ${error.message}`);
    }

    const { data: inserted, error: insertError } = await supabase
      .from("land_records")
      .insert({
        land_id: land.landId,
        record_id: recordId,
        previous_record_id: head?.record_id || null,
        previous_owner_id: previousOwner?.owner_id || null,
        current_owner_id: currentOwner.owner_id,
        property_id: land.propertyId,
        survey_number_hash: land.surveyNumberHash,
        jurisdiction_code: land.jurisdictionCode,
        land_details_hash: landDetailsHash,
        document_hash: documentHash,
        metadata_hash: metadataHash,
        ipfs_cid: ipfsCID,
        record_id_hash: recordIdHash,
        previous_record_hash: onChain.previousRecordId,
        previous_owner_hash: onChain.previousOwnerId,
        current_owner_hash: onChain.currentOwnerId,
        registered_at: new Date(registeredAt * 1000).toISOString(),
        survey_number: norm(v.surveyNumber).replace(/\s+/g, ""),
        subdivision_number: v.subdivisionNumber ? norm(v.subdivisionNumber).replace(/\s+/g, "") : null,
        area: v.area === "" || v.area === null || v.area === undefined ? null : Number(v.area),
        area_unit: v.areaUnit || null,
        boundary_north: v.boundaryNorth || null,
        boundary_south: v.boundarySouth || null,
        boundary_east: v.boundaryEast || null,
        boundary_west: v.boundaryWest || null,
        village: v.village || null,
        taluk: v.taluk || null,
        district: v.district,
        state: v.state,
        document_type: v.documentType || null,
        registration_number: v.registrationNumber || null,
        registration_date: v.registrationDate || null,
        sro_office: v.sroOffice || null,
        enc_iv: iv,
        enc_tag: tag,
        original_filename: req.file.originalname,
        tx_hash: txHash,
        qr_code_data: qrDataUrl,
        verify_url: verifyUrl,
        is_latest: true,
        registered_by: req.userId || null,
      })
      .select()
      .single();

    if (insertError) {
      if (head) await supabase.from("land_records").update({ is_latest: true }).eq("id", head.id);
      console.error(`[land/register] CHAIN WRITTEN BUT DB INSERT FAILED — record ${recordId}, tx ${txHash}`);
      throw httpError(500, `Recorded on-chain but database save failed: ${insertError.message}`, {
        payload: { recordId, txHash },
      });
    }

    console.log(`Registered ${recordId} for ${land.landId}${head ? ` (linked to ${head.record_id})` : " (first record)"}`);

    res.status(201).json({
      success: true,
      landId: land.landId,
      recordId,
      linked: Boolean(head),
      previousRecordId: head?.record_id || null,
      previousOwnerId: previousOwner?.owner_id || null,
      currentOwnerId: currentOwner.owner_id,
      txHash,
      ipfsCID,
      documentHash,
      registeredAt: inserted.registered_at,
      verifyUrl,
      qrCode: qrDataUrl,
    });
  } catch (err) {
    sendError(res, err, "Registration failed");
  }
});

// ── LIST ────────────────────────────────────────────────

router.get("/", protect, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = String(req.query.search || "").replace(/[*(),.%:"\\]/g, " ").trim();

    let query = supabase
      .from("land_records")
      .select(
        "land_id, record_id, previous_record_id, current_owner_id, previous_owner_id, survey_number, " +
        "subdivision_number, village, taluk, district, state, document_type, registration_number, " +
        "registration_date, tx_hash, is_latest, status, created_at, " + OWNER_JOIN,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (req.query.latestOnly === "true") query = query.eq("is_latest", true);

    if (search) {
      const filters = [
        `land_id.ilike.*${search}*`, `record_id.ilike.*${search}*`, `survey_number.ilike.*${search}*`,
        `village.ilike.*${search}*`, `district.ilike.*${search}*`, `registration_number.ilike.*${search}*`,
      ];
      const { data: owners } = await supabase.from("owners").select("owner_id").ilike("full_name", `%${search}%`).limit(50);
      if (owners?.length) filters.push(`current_owner_id.in.(${owners.map((o) => o.owner_id).join(",")})`);
      query = query.or(filters.join(","));
    }

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);
    res.json({ records: (data || []).map(landRecordFromRow), total: count || 0, page, pages: Math.ceil((count || 0) / limit) });
  } catch (err) {
    sendError(res, err, "List failed");
  }
});

// ── STATS ───────────────────────────────────────────────

router.get("/stats", protect, async (_req, res) => {
  try {
    const countOf = async (table, apply = (q) => q) => {
      const { count, error } = await apply(supabase.from(table).select("id", { count: "exact", head: true }));
      if (error) throw new Error(error.message);
      return count || 0;
    };
    const [records, parcels, transfers, revoked, owners] = await Promise.all([
      countOf("land_records"),
      countOf("land_records", (q) => q.eq("is_latest", true)),
      countOf("land_records", (q) => q.not("previous_record_id", "is", null)),
      countOf("land_records", (q) => q.eq("status", "revoked")),
      countOf("owners"),
    ]);
    res.json({ records, parcels, transfers, revoked, owners });
  } catch (err) {
    sendError(res, err, "Stats failed");
  }
});

// ── SINGLE RECORD + HISTORY ─────────────────────────────

async function getRecordRow(recordId) {
  const id = String(recordId || "").trim().toUpperCase();
  if (!isRecordId(id)) throw httpError(400, "Record ID must look like REC-XXXXXXXX");
  const { data, error } = await supabase.from("land_records").select(`*, ${OWNER_JOIN}`).eq("record_id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw httpError(404, `Record ${id} not found`);
  return data;
}

router.get("/records/:recordId", protect, async (req, res) => {
  try {
    const row = await getRecordRow(req.params.recordId);
    const { data: history } = await supabase
      .from("land_records")
      .select(`land_id, record_id, previous_record_id, document_type, registration_date, status, is_latest, tx_hash, created_at, ${OWNER_JOIN}`)
      .eq("land_id", row.land_id)
      .order("created_at", { ascending: true });
    res.json({ record: landRecordFromRow(row), history: (history || []).map(landRecordFromRow) });
  } catch (err) {
    sendError(res, err, "Fetch failed");
  }
});

router.get("/records/:recordId/document", protect, async (req, res) => {
  try {
    const row = await getRecordRow(req.params.recordId);
    const file = await fetchIPFSFile(row.ipfs_cid);
    const pdf = decryptDocument(file.buffer, row.enc_iv, row.enc_tag);
    const intact = computeDocumentHash(pdf) === row.document_hash;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.record_id}.pdf"`);
    res.setHeader("X-Document-Hash-Match", String(intact));
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (err) {
    if (!err.status) err.status = 502;
    sendError(res, err, "Unable to retrieve the deed document");
  }
});

// ── REVOKE ──────────────────────────────────────────────

router.post("/records/:recordId/revoke", protect, async (req, res) => {
  try {
    const reason = String(req.body.reason || "").trim().slice(0, 300);
    if (!reason) throw httpError(400, "A revocation reason is required (it is recorded on-chain)");

    const row = await getRecordRow(req.params.recordId);
    if (row.status === "revoked") throw httpError(409, "Record is already revoked");

    const txHash = await revokeRecordOnChain(row.record_id_hash, reason);

    const { error } = await supabase
      .from("land_records")
      .update({ status: "revoked", revoked_tx_hash: txHash, revoked_at: new Date().toISOString(), revoke_reason: reason })
      .eq("id", row.id);
    if (error) throw new Error(`Revoked on-chain (tx ${txHash}) but database update failed: ${error.message}`);

    // If the head was revoked, the previous active record becomes the head again.
    if (row.is_latest && row.previous_record_id) {
      const { data: prev } = await supabase
        .from("land_records")
        .select("id, status")
        .eq("record_id", row.previous_record_id)
        .maybeSingle();
      if (prev && prev.status === "active") {
        await supabase.from("land_records").update({ is_latest: false }).eq("id", row.id);
        await supabase.from("land_records").update({ is_latest: true }).eq("id", prev.id);
      }
    }

    res.json({ success: true, recordId: row.record_id, txHash });
  } catch (err) {
    sendError(res, err, "Revocation failed");
  }
});

export default router;
