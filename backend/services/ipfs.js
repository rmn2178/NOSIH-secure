import "../env.js"; // loads the repository-root .env — must come first
import axios from "axios";
import FormData from "form-data";

/**
 * IPFS Service using Pinata (free tier)
 * Free tier: 1GB storage, unlimited pins
 * Docs: https://docs.pinata.cloud
 */

class IPFSUploadError extends Error {
  constructor(message, { status = 500, code = "IPFS_UPLOAD_FAILED", details = "" } = {}) {
    super(message);
    this.name = "IPFSUploadError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeGatewayBase(base) {
  return String(base || "").replace(/\/+$/, "");
}

function getGatewayBases() {
  const preferred = normalizeGatewayBase(process.env.IPFS_GATEWAY_BASE_URL || "https://gateway.pinata.cloud/ipfs");
  return unique([
    preferred,
    "https://gateway.pinata.cloud/ipfs",
    "https://ipfs.io/ipfs",
    "https://dweb.link/ipfs",
    "https://w3s.link/ipfs",
  ]);
}

function getIPFSGatewayUrls(cid) {
  return getGatewayBases().map((base) => `${base}/${cid}`);
}

function pinataAuthHeaders() {
  if (process.env.PINATA_JWT) {
    return { Authorization: `Bearer ${process.env.PINATA_JWT}` };
  }

  if (process.env.PINATA_API_KEY && process.env.PINATA_API_SECRET) {
    return {
      pinata_api_key: process.env.PINATA_API_KEY,
      pinata_secret_api_key: process.env.PINATA_API_SECRET,
    };
  }

  throw new IPFSUploadError(
    "Missing Pinata credentials. Set PINATA_JWT or PINATA_API_KEY + PINATA_API_SECRET in the root .env",
    { status: 500, code: "PINATA_CONFIG_MISSING" }
  );
}

/**
 * Whether the v3 uploads endpoint can accept the configured credential.
 *
 * The v3 gateway resolves the caller from the key and parses it as a UUID
 * ("Cannot parse UUID parameter: ..."), so a scoped key — which is a short
 * hex string, not a UUID — is rejected before it ever reaches the upload.
 * Such a key can still upload through the legacy endpoint, so we skip the
 * doomed v3 attempt instead of paying for it on every deed.
 */
function canUseV3Uploads() {
  if (process.env.PINATA_JWT) return true;
  const key = String(process.env.PINATA_API_KEY || "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
}

function normalizePinataError(err) {
  const status = err.response?.status || 502;
  const reason = err.response?.data?.error?.reason;
  const details = err.response?.data?.error?.details || err.response?.data?.error?.message || "";

  if (reason === "NO_SCOPES_FOUND") {
    return new IPFSUploadError(
      "Pinata key has no upload scopes for this endpoint. Regenerate a JWT with upload scopes.",
      { status: 502, code: reason, details }
    );
  }

  if (status === 401 || status === 403) {
    return new IPFSUploadError("Pinata authentication/permission failed", {
      status: 502,
      code: reason || "PINATA_AUTH_FAILED",
      details,
    });
  }

  return new IPFSUploadError("IPFS upload failed", {
    status: 502,
    code: reason || "PINATA_UPLOAD_FAILED",
    details: details || err.message,
  });
}

async function uploadViaPinataV3(fileBuffer, filename, contentType) {
  const formData = new FormData();
  formData.append("file", fileBuffer, {
    filename,
    contentType,
  });
  formData.append("network", "public");

  const response = await axios.post("https://uploads.pinata.cloud/v3/files", formData, {
    headers: {
      ...pinataAuthHeaders(),
      ...formData.getHeaders(),
    },
    maxBodyLength: Infinity,
  });

  return response.data?.data?.cid || response.data?.cid;
}

async function uploadViaPinataLegacy(fileBuffer, filename, contentType) {
  const formData = new FormData();
  formData.append("file", fileBuffer, {
    filename,
    contentType,
  });

  const response = await axios.post(
    "https://api.pinata.cloud/pinning/pinFileToIPFS",
    formData,
    {
      headers: {
        ...pinataAuthHeaders(),
        ...formData.getHeaders(),
      },
      maxBodyLength: Infinity,
    }
  );

  return response.data?.IpfsHash;
}

/**
 * Uploads a file buffer to IPFS via Pinata
 * @param {Buffer} fileBuffer   Raw file bytes
 * @param {string} filename     Original filename
 * @returns {string}            IPFS CID
 */
export async function uploadToIPFS(fileBuffer, filename, contentType = "application/pdf") {
  try {
    if (canUseV3Uploads()) {
      const cid = await uploadViaPinataV3(fileBuffer, filename, contentType);
      if (!cid) throw new Error("Pinata v3 response missing CID");
      return cid;
    }
  } catch (primaryErr) {
    try {
      const cid = await uploadViaPinataLegacy(fileBuffer, filename, contentType);
      if (!cid) throw new Error("Pinata legacy response missing CID");
      return cid;
    } catch {
      throw normalizePinataError(primaryErr);
    }
  }

  // Scoped key: v3 cannot accept it, so go straight to the legacy endpoint.
  try {
    const cid = await uploadViaPinataLegacy(fileBuffer, filename, contentType);
    if (!cid) throw new Error("Pinata legacy response missing CID");
    return cid;
  } catch (err) {
    throw normalizePinataError(err);
  }
}

/**
 * Returns the public IPFS gateway URL for a CID
 */
export function getIPFSUrl(cid) {
  return getIPFSGatewayUrls(cid)[0];
}

export async function fetchIPFSFile(cid) {
  const urls = getIPFSGatewayUrls(cid);
  const timeout = Number(process.env.IPFS_FETCH_TIMEOUT_MS || 15000);
  const controller = new AbortController();

  const racePromises = urls.map((url) =>
    axios
      .get(url, {
        responseType: "arraybuffer",
        timeout,
        signal: controller.signal,
      })
      .then((response) => ({
        buffer: Buffer.from(response.data),
        contentType: response.headers["content-type"] || "application/octet-stream",
        sourceUrl: url,
      }))
  );

  try {
    const result = await Promise.any(racePromises);
    // Cancel remaining in-flight requests
    controller.abort();
    return result;
  } catch (aggregateError) {
    const details = aggregateError.errors
      .map((err, i) => `${urls[i]} -> ${err.response?.status || err.code || err.message}`)
      .join(" | ");
    throw new Error(`Unable to fetch CID ${cid} from IPFS gateways: ${details}`);
  }
}

export { IPFSUploadError, getIPFSGatewayUrls };
