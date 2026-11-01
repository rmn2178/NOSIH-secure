/**
 * Supabase client — single access point for Postgres.
 * The backend talks to Supabase with the service-role key only (no RLS),
 * so the database is never exposed to the browser.
 *
 * Boot behavior: the app stays up even when the database is unreachable.
 * A missing variable is reported by envCheck.js and answered over HTTP; a
 * failed connectivity check is logged and surfaced through /api/health.
 * Exiting at import time would turn either problem into Vercel's opaque
 * FUNCTION_INVOCATION_FAILED on every route.
 */

import "./env.js"; // loads the repository-root .env — must come first
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Set when the Supabase variables are missing or unusable. */
export const supabaseConfigError = !SUPABASE_URL
  ? "SUPABASE_URL is not set"
  : !SUPABASE_SERVICE_ROLE_KEY
    ? "SUPABASE_SERVICE_ROLE_KEY is not set"
    : null;

/** Set when the database answered a boot-time query with an error. */
export let supabaseBootError = null;

/** A stand-in that refuses every call with a readable reason. */
function unusableClient(reason) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`Supabase client unavailable: ${reason}`);
      },
    }
  );
}

export const supabase = supabaseConfigError
  ? unusableClient(supabaseConfigError)
  : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

if (supabaseConfigError) {
  console.error("FATAL:", supabaseConfigError, "— set it in the backend environment.");
} else {
  // ── Boot-time connectivity check ─────────────────────────
  // Real GET (not HEAD) — PostgREST returns 200 on HEAD even for missing
  // tables, so only a full read proves the schema exists.
  const { error: bootError } = await supabase
    .from("users")
    .select("id")
    .limit(1);

  if (bootError) {
    supabaseBootError = bootError.message;
    console.error("FATAL: Supabase connection check failed:", bootError.message);
    console.error("Did you run backend/supabase/schema.sql in the Supabase SQL editor?");
  } else {
    console.log("✅ Supabase connected");
  }

  // Land tables are created by schema.sql — warn (not exit) so auth still works.
  const { error: landError } = await supabase.from("land_records").select("id").limit(1);
  if (landError) {
    console.warn("⚠️  land_records table not reachable:", landError.message);
    console.warn("   Run backend/supabase/schema.sql in the Supabase SQL editor.");
  }
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
