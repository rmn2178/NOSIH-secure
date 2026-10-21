const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

function normalizePrivateKey(key) {
  if (!key) return null;
  return key.startsWith("0x") ? key : `0x${key}`;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "POL");

  const LandRegistry = await ethers.getContractFactory("LandRegistry");
  const registry = await LandRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("\n✅ LandRegistry deployed to:", address);

  // Authorize the backend signer as registrar
  let registrar = process.env.ISSUER_ADDRESS;
  if (!registrar && process.env.ISSUER_PRIVATE_KEY) {
    registrar = new ethers.Wallet(normalizePrivateKey(process.env.ISSUER_PRIVATE_KEY)).address;
  }
  if (registrar) {
    const tx = await registry.addRegistrar(registrar);
    await tx.wait();
    console.log("✅ Registrar authorized:", registrar);
  }

  console.log("📋 Save these to your .env files:");
  console.log(`CONTRACT_ADDRESS=${address}`);
  console.log(`CHAIN_ID=${(await ethers.provider.getNetwork()).chainId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
