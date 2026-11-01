/**
 * Wallet credit report: balances, gas price, and how many registrations each
 * balance covers.
 *
 *   node scripts/check-gas.mjs
 *
 * The registerRecord cost comes from eth_estimateGas, which SIMULATES the
 * call against current state. It does not broadcast a transaction and writes
 * nothing to the chain.
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const BACKEND = path.join(ROOT, "backend");
const asUrl = (p) => pathToFileURL(p).href;

const { default: dotenv } = await import(asUrl(path.join(BACKEND, "node_modules", "dotenv/lib/main.js")));
dotenv.config({ path: path.join(ROOT, ".env") });
const ethers = await import(asUrl(path.join(BACKEND, "node_modules", "ethers/lib.esm/index.js")));

const normKey = (k) => (!k ? null : k.startsWith("0x") ? k : `0x${k.trim()}`);

const RECORD_TUPLE =
  "tuple(bytes32 propertyId, bytes32 surveyNumberHash, bytes32 jurisdictionCode, bytes32 landDetailsHash," +
  "bytes32 documentHash, bytes32 metadataHash, string ipfsCID, bytes32 recordId, bytes32 previousRecordId," +
  "bytes32 previousOwnerId, bytes32 currentOwnerId, uint256 registeredAt)";

const ABI = [`function registerRecord(${RECORD_TUPLE} r) external`];

const rpc =
  process.env.AMOY_RPC_URL ||
  process.env.ALCHEMY_AMOY_URL ||
  "https://rpc-amoy.polygon.technology";
const provider = new ethers.JsonRpcProvider(rpc);
const network = await provider.getNetwork();

const wallets = [
  ["DEPLOYER (contract owner)", process.env.DEPLOYER_PRIVATE_KEY],
  ["ISSUER   (backend signer) ", process.env.ISSUER_PRIVATE_KEY],
].filter(([, k]) => k);

console.log(`Amoy testnet — chain ${network.chainId}  via ${rpc}`);
console.log("");

const feeData = await provider.getFeeData();
const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
console.log(`Gas price: ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
console.log("");

// ── Simulate a registration to learn the gas cost (read-only) ──
let gasEstimate = null;
try {
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, provider);
  const issuer = new ethers.Wallet(normKey(process.env.ISSUER_PRIVATE_KEY), provider);

  const zero = ethers.ZeroHash;
  const record = {
    propertyId: ethers.keccak256(ethers.toUtf8Bytes("probe-property")),
    surveyNumberHash: ethers.keccak256(ethers.toUtf8Bytes("probe-survey")),
    jurisdictionCode: ethers.keccak256(ethers.toUtf8Bytes("probe-jurisdiction")),
    landDetailsHash: ethers.keccak256(ethers.toUtf8Bytes("probe-details")),
    documentHash: ethers.keccak256(ethers.toUtf8Bytes("probe-document")),
    metadataHash: ethers.keccak256(ethers.toUtf8Bytes("probe-metadata")),
    ipfsCID: "QmULKig5Fxrs2sC4qt9nNduucXfb92AFYQ6Hi3YRqDmrYC",
    recordId: ethers.keccak256(ethers.toUtf8Bytes("nosih-gas-estimate-probe")),
    previousRecordId: zero,
    previousOwnerId: zero,
    currentOwnerId: ethers.keccak256(ethers.toUtf8Bytes("probe-owner")),
    registeredAt: 0,
  };

  // Simulate only - nothing is broadcast, no state changes.
  gasEstimate = await contract.connect(issuer).registerRecord.estimateGas(record);
  console.log(`registerRecord gas (simulated): ${gasEstimate.toString()}`);
  console.log("");
} catch (e) {
  console.log(`registerRecord gas estimate unavailable: ${e.shortMessage || e.message}`);
  console.log("");
}

const perTx = gasEstimate ? gasEstimate * gasPrice : null;

for (const [label, key] of wallets) {
  const wallet = new ethers.Wallet(normKey(key));
  const bal = await provider.getBalance(wallet.address);
  const pol = Number(ethers.formatEther(bal));

  const cost = perTx ? Number(ethers.formatEther(perTx)) : null;

  console.log(`${label}  ${wallet.address}`);
  console.log(`  balance        ${pol.toFixed(6)} POL`);

  if (cost && cost > 0) {
    console.log(
      `  cost / tx      ${cost.toFixed(6)} POL  (${gasEstimate} gas @ ${ethers.formatUnits(gasPrice, "gwei")} gwei)`
    );
    console.log(`  registrations  ~${Math.floor(pol / cost).toLocaleString()}`);
  } else {
    console.log(`  registrations  (cannot estimate without a gas estimate)`);
  }
  console.log("");
}

console.log("Note: the issuer wallet is the one that signs on-chain writes at runtime.");
console.log("The deployer wallet only pays gas for deploys and addRegistrar calls.");
