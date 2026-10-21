/**
 * Public Verification Routes — NO authentication by default
 *
 * GET  /api/verify/land/:landId           Ownership timeline (owner registry IDs only, no names)
 * GET  /api/verify/land/:landId/document  Decrypted deed of the current record (policy-gated)
 * POST /api/verify/land/:landId/document  Upload a deed PDF → hash match against registered versions
 * GET  /api/verify/land/:landId/qr        QR PNG with the Land ID label
 *
 * Every record is cross-checked against the LandRegistry contract (free reads).
 * A hash match confirms a registered version — it does not by itself prove
 * legal ownership or document authenticity.
 */

import { Router } from "express";
import multer from "multer";
import jwt from "jsonwebtoken";
import { MAX_UPLOAD_BYTES } from "../config.js";
import { supabase } from "../supabase.js";
import { getRecordFromChain } from "../services/blockchain.js";
import { generateLandQr } from "../services/qr.js";
import { fetchIPFSFile } from "../services/ipfs.js";
import { computeDocumentHash, decryptDocument, isLandId, isRecordId } from "../services/landIdentity.js";

const router = Router();

const DISCLAIMER =
  "A matching hash confirms that this data matches a version registered on the NOSIH ledger. " +
  "It does not independently prove legal ownership or the authenticity of the underlying transaction.";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_, file, cb) =>
    file.mimetype === "application/pdf"
      ? cb(null, true)
      : cb(Object.assign(new Error("Only PDF deeds are accepted"), { status: 400 }), false),
});

const PUBLIC_COLUMNS =
  "land_id, record_id, previous_record_id, previous_record_hash, previous_owner_id, current_owner_id, property_id, " +
  "jurisdiction_code, document_hash, ipfs_cid, record_id_hash, registered_at, village, taluk, district, state, " +
  "document_type, registration_date, sro_office, tx_hash, is_latest, status, revoked_tx_hash, revoked_at, " +
  "revoke_reason, created_at";

function parseLandId(raw) {
  const id = String(raw || "").trim().toUpperCase();
  return isLandId(id) ? id : null;
}

async function getLandRows(landId) {
  const { data, error } = await supabase
    .from("land_records")
    .select(PUBLIC_COLUMNS)
    .eq("land_id", landId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function chainCheck(row) {
  try {
    const chain = await getRecordFromChain(row.record_id_hash);
    if (!chain) return { onChain: false, documentHashMatch: false, propertyIdMatch: false, statusMatch: false, chain: null };
    return {
      onChain: true,
      documentHashMatch: chain.documentHash.toLowerCase() === row.document_hash.toLowerCase(),
      propertyIdMatch: chain.propertyId.toLowerCase() === row.property_id.toLowerCase(),
      statusMatch: chain.revoked === (row.status === "revoked"),
      chain: {
        documentHash: chain.documentHash,
        propertyId: chain.propertyId,
        ipfsCID: chain.ipfsCID,
        previousRecordId: chain.previousRecordId,
        previousOwnerId: chain.previousOwnerId,
        currentOwnerId: chain.currentOwnerId,
        registeredAt: chain.registeredAt,
        revoked: chain.revoked,
      },
    };
  } catch (err) {
    return { onChain: null, error: `Chain read failed: ${err.message}` };
  }
}

function publicRecord(row, integrity) {
  return {
    recordId: row.record_id,
    previousRecordId: row.previous_record_id,
    previousRecordHash: row.previous_record_hash,
    previousOwnerId: row.previous_owner_id,
    currentOwnerId: row.current_owner_id,
    documentType: row.document_type,
    registrationDate: row.registration_date,
    sroOffice: row.sro_office,
    registeredAt: row.registered_at,
    txHash: row.tx_hash,
    ipfsCID: row.ipfs_cid,
    documentHash: row.document_hash,
    isLatest: row.is_latest,
    status: row.status,
    revokedAt: row.revoked_at,
    revokedTxHash: row.revoked_tx_hash,
    revokeReason: row.revoke_reason,
    integrity,
  };
}

// ── Timeline ────────────────────────────────────────────

router.get("/land/:landId", async (req, res) => {
  try {
    const landId = parseLandId(req.params.landId);
    if (!landId) return res.status(400).json({ error: "Land ID must look like LAND-XXXXXXXXXX" });

    const rows = await getLandRows(landId);
    if (!rows.length) return res.status(404).json({ found: false, landId, error: "No registered records for this Land ID" });

    const checks = await Promise.all(rows.map(chainCheck));
    const records = rows.map((row, i) => publicRecord(row, checks[i]));
    const head = records.find((r) => r.isLatest) || records[records.length - 1];
    const headRow = rows.find((r) => r.record_id === head.recordId);

    res.json({
      found: true,
      landId,
      jurisdictionCode: headRow.jurisdiction_code,
      location: { village: headRow.village, taluk: headRow.taluk, district: headRow.district, state: headRow.state },
      currentOwnerId: head.currentOwnerId,
      currentRecordId: head.recordId,
      status: head.status,
      recordCount: records.length,
      allOnChain: checks.every((c) => c.onChain && c.documentHashMatch && c.propertyIdMatch && c.statusMatch),
      contractAddress: process.env.CONTRACT_ADDRESS,
      records,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    console.error("[verify/land]", err);
    res.status(500).json({ error: err.message || "Verification failed" });
  }
});

// ── View the registered deed (decrypted) ────────────────
// The file on IPFS is ciphertext. Only serve plaintext after the record is
// confirmed on-chain, and only to registrars unless the deployment explicitly
// opts into public viewing with VIEW_DOCUMENT_POLICY=public.
const VIEW_DOCUMENT_POLICY = (process.env.VIEW_DOCUMENT_POLICY || "registrar").toLowerCase();

function optionalUser(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

router.get("/land/:landId/document", async (req, res) => {
  try {
    const landId = parseLandId(req.params.landId);
    if (!landId) return res.status(400).json({ error: "Invalid Land ID" });

    const requestedRecord = String(req.query.record || "").trim().toUpperCase();
    if (requestedRecord && !isRecordId(requestedRecord)) {
      return res.status(400).json({ error: "Record ID must look like REC-XXXXXXXX" });
    }

    const viewer = optionalUser(req);
    if (VIEW_DOCUMENT_POLICY !== "public" && !viewer) {
      return res.status(401).json({
        error: "Sign in as a registrar to view the registered deed",
        policy: VIEW_DOCUMENT_POLICY,
      });
    }

    let query = supabase
      .from("land_records")
      .select(
        "record_id, record_id_hash, land_id, ipfs_cid, enc_iv, enc_tag, document_hash, " +
        "property_id, status, is_latest, original_filename"
      )
      .eq("land_id", landId);

    query = requestedRecord ? query.eq("record_id", requestedRecord) : query.eq("is_latest", true);

    const { data: row, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) {
      return res.status(404).json({
        error: requestedRecord
          ? `Record ${requestedRecord} does not belong to ${landId}`
          : `No current record for ${landId}`,
      });
    }

    const integrity = await chainCheck(row);
    if (!integrity.onChain || !integrity.documentHashMatch) {
      return res.status(409).json({
        error: "This record could not be confirmed on-chain, so the deed is not served",
      });
    }

    const file = await fetchIPFSFile(row.ipfs_cid);
    const pdf = decryptDocument(file.buffer, row.enc_iv, row.enc_tag);
    const intact = computeDocumentHash(pdf) === row.document_hash;

    console.log(
      `[verify/document:view] ${row.record_id} fetched ${file.buffer.length} encrypted bytes ` +
      `from ${file.sourceUrl} (hash match: ${intact})`
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${row.record_id}.pdf"`);
    res.setHeader("X-Record-Id", row.record_id);
    res.setHeader("X-IPFS-CID", row.ipfs_cid);
    res.setHeader("X-IPFS-Source", file.sourceUrl);
    res.setHeader("X-Document-Hash-Match", String(intact));
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (err) {
    console.error("[verify/document:view]", err);
    res.status(err.status || 502).json({ error: err.message || "Unable to load the registered deed" });
  }
});

// ── Document hash check ─────────────────────────────────

router.post("/land/:landId/document", upload.single("deed"), async (req, res) => {
  try {
    const landId = parseLandId(req.params.landId);
    if (!landId) return res.status(400).json({ error: "Land ID must look like LAND-XXXXXXXXXX" });
    if (!req.file || req.file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return res.status(400).json({ error: "Upload a valid PDF deed" });
    }

    const uploadedHash = computeDocumentHash(req.file.buffer);
    const { data: row, error } = await supabase
      .from("land_records")
      .select(PUBLIC_COLUMNS)
      .eq("document_hash", uploadedHash)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (!row) {
      return res.json({ match: false, uploadedHash, landId, verdict: "No registered version matches this PDF.", disclaimer: DISCLAIMER });
    }
    if (row.land_id !== landId) {
      return res.json({
        match: false, uploadedHash, landId,
        verdict: "This PDF is registered, but under a different Land ID.",
        disclaimer: DISCLAIMER,
      });
    }

    const integrity = await chainCheck(row);
    let verdict;
    if (!integrity.onChain || !integrity.documentHashMatch) verdict = "Database match, but the on-chain hash could not be confirmed.";
    else if (row.status === "revoked") verdict = "Matches a registered version that has been REVOKED.";
    else if (!row.is_latest) verdict = "Matches a registered version, but it is not the current record for this land.";
    else verdict = "Matches the current registered version for this land.";

    res.json({
      match: true,
      uploadedHash,
      landId,
      isLatest: row.is_latest,
      record: publicRecord(row, integrity),
      verdict,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    console.error("[verify/document]", err);
    res.status(500).json({ error: err.message || "Document check failed" });
  }
});

// ── QR ──────────────────────────────────────────────────

router.get("/land/:landId/qr", async (req, res) => {
  try {
    const landId = parseLandId(req.params.landId);
    if (!landId) return res.status(400).json({ error: "Invalid Land ID" });
    const { count } = await supabase
      .from("land_records")
      .select("id", { count: "exact", head: true })
      .eq("land_id", landId);
    if (!count) return res.status(404).json({ error: "Unknown Land ID" });

    const { png } = await generateLandQr(landId, req);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename="${landId}-QR.png"`);
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: err.message || "QR generation failed" });
  }
});

export default router;
