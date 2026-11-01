import "../env.js"; // loads the repository-root .env — must come first
import { ethers } from "ethers";

// LandRegistry ABI — only what the backend calls
const RECORD_TUPLE =
  "tuple(bytes32 propertyId, bytes32 surveyNumberHash, bytes32 jurisdictionCode, bytes32 landDetailsHash, " +
  "bytes32 documentHash, bytes32 metadataHash, string ipfsCID, bytes32 recordId, bytes32 previousRecordId, " +
  "bytes32 previousOwnerId, bytes32 currentOwnerId, uint256 registeredAt)";

const ABI = [
  `function registerRecord(${RECORD_TUPLE} r) external`,
  "function revokeRecord(bytes32 recordId, string reason) external",
  `function getRecord(bytes32 recordId) external view returns (${RECORD_TUPLE} record, bool isRevoked)`,
  "function recordExists(bytes32 recordId) external view returns (bool)",
  "function authorizedRegistrars(address) external view returns (bool)",
];

const DEFAULT_AMOY_RPC = "https://rpc-amoy.polygon.technology";
let provider, signer, readContract;

function getRpcUrl() {
  return process.env.ALCHEMY_AMOY_URL || process.env.AMOY_RPC_URL || DEFAULT_AMOY_RPC;
}

const normalizePrivateKey = (key) => (key?.startsWith("0x") ? key : `0x${key}`);

export function getProvider() {
  if (!provider) provider = new ethers.JsonRpcProvider(getRpcUrl());
  return provider;
}

function getSigner() {
  if (!signer) {
    const key = process.env.ISSUER_PRIVATE_KEY;
    if (!key) throw new Error("ISSUER_PRIVATE_KEY is required to register land records");
    signer = new ethers.Wallet(normalizePrivateKey(key), getProvider());
  }
  return signer;
}

function getReadContract() {
  if (!readContract) readContract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, getProvider());
  return readContract;
}

const getWriteContract = () => new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, getSigner());

// ── Write ────────────────────────────────────────────────

/**
 * Registers the 12-field record. Linking fields are pre-resolved off-chain.
 * @returns {{ txHash: string, registeredAt: number }}
 */
export async function registerRecordOnChain(record) {
  const c = getWriteContract();
  console.log("⛓️  Submitting registerRecord...");
  const tx = await c.registerRecord({ ...record, registeredAt: 0 });
  const receipt = await tx.wait();
  const block = await getProvider().getBlock(receipt.blockNumber);
  console.log("✅ Record confirmed:", receipt.hash);
  return { txHash: receipt.hash, registeredAt: Number(block.timestamp) };
}

export async function revokeRecordOnChain(recordIdHash, reason) {
  const tx = await getWriteContract().revokeRecord(recordIdHash, reason || "");
  const receipt = await tx.wait();
  return receipt.hash;
}

// ── Read (free — no gas) ─────────────────────────────────

export async function getRecordFromChain(recordIdHash) {
  const c = getReadContract();
  if (!(await c.recordExists(recordIdHash))) return null;
  const [r, isRevoked] = await c.getRecord(recordIdHash);
  return {
    propertyId: r.propertyId,
    surveyNumberHash: r.surveyNumberHash,
    jurisdictionCode: r.jurisdictionCode,
    landDetailsHash: r.landDetailsHash,
    documentHash: r.documentHash,
    metadataHash: r.metadataHash,
    ipfsCID: r.ipfsCID,
    recordId: r.recordId,
    previousRecordId: r.previousRecordId,
    previousOwnerId: r.previousOwnerId,
    currentOwnerId: r.currentOwnerId,
    registeredAt: Number(r.registeredAt),
    revoked: isRevoked,
  };
}
