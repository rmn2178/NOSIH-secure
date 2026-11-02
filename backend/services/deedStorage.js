/**
 * Dual Storage Engine for Encrypted Deeds
 *
 * Primary: Supabase secure storage bucket ('deeds') for instant retrieval.
 * Permanent & On-Chain: IPFS (Pinata) referenced by on-chain IPFS CID.
 *
 * When registering, documents are encrypted, pinned to IPFS, and mirrored to secure storage.
 * When retrieving, secure storage serves the document in milliseconds; if missed, it falls
 * back to IPFS gateways and backfills the cache.
 */

import { supabase } from "../supabase.js";
import { fetchIPFSFile } from "./ipfs.js";

const BUCKET = "deeds";

/**
 * Ensures the private storage bucket exists.
 */
export async function ensureDeedsBucket() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b) => b.name === BUCKET)) {
      await supabase.storage.createBucket(BUCKET, { public: false });
    }
  } catch (err) {
    // Non-fatal if already exists or handled by admin
    console.warn("[deedStorage] Bucket ensure check:", err.message);
  }
}

/**
 * Stores the encrypted ciphertext buffer in secure storage.
 * @param {string} recordId
 * @param {Buffer} ciphertext
 */
export async function storeEncryptedDeed(recordId, ciphertext) {
  try {
    const { error } = await supabase.storage.from(BUCKET).upload(`${recordId}.enc`, ciphertext, {
      contentType: "application/octet-stream",
      upsert: true,
    });
    if (error) console.warn(`[deedStorage] Storage upload warning for ${recordId}:`, error.message);
  } catch (err) {
    console.warn(`[deedStorage] Storage upload exception for ${recordId}:`, err.message);
  }
}

/**
 * Retrieves the encrypted deed buffer either from secure storage or IPFS.
 * @param {{ record_id: string, ipfs_cid: string }} row
 * @returns {Promise<{ buffer: Buffer, sourceUrl: string }>}
 */
export async function getEncryptedDeed(row) {
  // 1. Try instant secure storage (fast, no rate limits, no propagation delay)
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(`${row.record_id}.enc`);
    if (data && !error) {
      const arrayBuffer = await data.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        sourceUrl: `supabase://storage/${BUCKET}/${row.record_id}.enc`,
      };
    }
  } catch (err) {
    console.warn(`[deedStorage] Storage cache miss for ${row.record_id}:`, err.message);
  }

  // 2. Fall back to decentralized IPFS gateways
  const file = await fetchIPFSFile(row.ipfs_cid);

  // Backfill secure storage in background so subsequent requests are instant
  storeEncryptedDeed(row.record_id, file.buffer).catch(() => {});

  return {
    buffer: file.buffer,
    sourceUrl: file.sourceUrl,
  };
}

