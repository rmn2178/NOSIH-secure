const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

function normalizePrivateKey(key) {
  if (!key) return null;
  return key.startsWith("0x") ? key : `0x${key}`;
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) throw new Error("CONTRACT_ADDRESS is missing in .env");

  let registrar = process.env.ISSUER_ADDRESS;
  if (!registrar) {
    const pk = normalizePrivateKey(process.env.ISSUER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY);
    if (!pk) throw new Error("Set ISSUER_ADDRESS or ISSUER_PRIVATE_KEY/DEPLOYER_PRIVATE_KEY in .env");
    registrar = new ethers.Wallet(pk).address;
  }

  const registry = await ethers.getContractAt("LandRegistry", contractAddress);
  if (await registry.authorizedRegistrars(registrar)) {
    console.log(`Registrar already authorized: ${registrar}`);
    return;
  }

  const tx = await registry.addRegistrar(registrar);
  const receipt = await tx.wait();
  console.log(`Authorized registrar: ${registrar}`);
  console.log(`Tx hash: ${receipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
