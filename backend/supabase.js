/**
 * Supabase client — single access point for Postgres.
 * The backend talks to Supabase with the service-role key only (no RLS),
 * so the database is never exposed to the browser.
 *
 * Boot behavior: exits the process if the env vars are missing or the
 * database is unreachable.
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Server cannot start.");
  process.exit(1);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Boot-time connectivity check ─────────────────────────
// Real GET (not HEAD) — PostgREST returns 200 on HEAD even for missing
// tables, so only a full read proves the schema exists.
const { error: bootError } = await supabase
  .from("users")
  .select("id")
  .limit(1);

if (bootError) {
  console.error("FATAL: Supabase connection check failed:", bootError.message);
  console.error("Did you run backend/supabase/schema.sql in the Supabase SQL editor?");
  process.exit(1);
}
console.log("✅ Supabase connected");

// Land tables are created by schema.sql — warn (not exit) so auth still works.
const { error: landError } = await supabase.from("land_records").select("id").limit(1);
if (landError) {
  console.warn("⚠️  land_records table not reachable:", landError.message);
  console.warn("   Run backend/supabase/schema.sql in the Supabase SQL editor.");
}

// ── Helpers ──────────────────────────────────────────────

/** True when a Supabase error is a Postgres unique-constraint violation. */
export function isUniqueViolation(error) {
  return error?.code === "23505";
}

/** Maps a users table row to the API shape the frontend expects. */
export function userFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    walletAddress: row.wallet_address,
    organizationName: row.organization_name,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Maps an owners row. */
export function ownerFromRow(row) {
  if (!row) return null;
  return { ownerId: row.owner_id, ownerHash: row.owner_hash, fullName: row.full_name, createdAt: row.created_at };
}

/** Maps a land_records row (optionally with joined owners) to the API shape. */
export function landRecordFromRow(row) {
  if (!row) return null;
  return {
    landId: row.land_id,
    recordId: row.record_id,
    previousRecordId: row.previous_record_id,
    previousOwnerId: row.previous_owner_id,
    currentOwnerId: row.current_owner_id,
    previousOwnerName: row.previous_owner?.full_name ?? null,
    currentOwnerName: row.current_owner?.full_name ?? null,
    chain: {
      propertyId: row.property_id,
      surveyNumberHash: row.survey_number_hash,
      jurisdictionCode: row.jurisdiction_code,
      landDetailsHash: row.land_details_hash,
      documentHash: row.document_hash,
      metadataHash: row.metadata_hash,
      ipfsCID: row.ipfs_cid,
      recordIdHash: row.record_id_hash,
      previousRecordHash: row.previous_record_hash,
      previousOwnerHash: row.previous_owner_hash,
      currentOwnerHash: row.current_owner_hash,
      registeredAt: row.registered_at,
    },
    surveyNumber: row.survey_number,
    subdivisionNumber: row.subdivision_number,
    area: row.area,
    areaUnit: row.area_unit,
    boundaryNorth: row.boundary_north,
    boundarySouth: row.boundary_south,
    boundaryEast: row.boundary_east,
    boundaryWest: row.boundary_west,
    village: row.village,
    taluk: row.taluk,
    district: row.district,
    state: row.state,
    documentType: row.document_type,
    registrationNumber: row.registration_number,
    registrationDate: row.registration_date,
    sroOffice: row.sro_office,
    originalFilename: row.original_filename,
    txHash: row.tx_hash,
    qrCodeData: row.qr_code_data,
    verifyUrl: row.verify_url,
    isLatest: row.is_latest,
    status: row.status,
    revokedTxHash: row.revoked_tx_hash,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
