const { expect } = require("chai");
const { ethers } = require("hardhat");

const id = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

function record(overrides = {}) {
  return {
    propertyId: id("LAND-1"),
    surveyNumberHash: id("survey"),
    jurisdictionCode: ethers.encodeBytes32String("TN-CHENGALPATTU"),
    landDetailsHash: id("land"),
    documentHash: id("doc"),
    metadataHash: id("meta"),
    ipfsCID: "bafyTestCid",
    recordId: id("REC-1"),
    previousRecordId: ethers.ZeroHash,
    previousOwnerId: id("OWN-SELLER"),
    currentOwnerId: id("OWN-BUYER"),
    registeredAt: 0,
    ...overrides,
  };
}

describe("LandRegistry", () => {
  let registry, owner, registrar, stranger;

  beforeEach(async () => {
    [owner, registrar, stranger] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory("LandRegistry")).deploy();
    await registry.addRegistrar(registrar.address);
  });

  it("registers a record with all 12 fields and sets timestamp", async () => {
    const r = record();
    await expect(registry.connect(registrar).registerRecord(r)).to.emit(registry, "RecordRegistered");
    const [stored, isRevoked] = await registry.getRecord(r.recordId);
    expect(stored.propertyId).to.equal(r.propertyId);
    expect(stored.ipfsCID).to.equal(r.ipfsCID);
    expect(stored.currentOwnerId).to.equal(r.currentOwnerId);
    expect(stored.registeredAt).to.be.gt(0);
    expect(isRevoked).to.equal(false);
  });

  it("links a follow-up record without on-chain lookups", async () => {
    const first = record();
    await registry.connect(registrar).registerRecord(first);
    const second = record({
      recordId: id("REC-2"),
      documentHash: id("doc2"),
      previousRecordId: first.recordId,
      previousOwnerId: first.currentOwnerId,
      currentOwnerId: id("OWN-NEXT"),
    });
    await registry.connect(registrar).registerRecord(second);
    const [stored] = await registry.getRecord(second.recordId);
    expect(stored.previousRecordId).to.equal(first.recordId);
    expect(stored.previousOwnerId).to.equal(first.currentOwnerId);
  });

  it("rejects duplicates and unauthorized callers", async () => {
    const r = record();
    await expect(registry.connect(stranger).registerRecord(r)).to.be.revertedWith("LandReg: not an authorized registrar");
    await registry.connect(registrar).registerRecord(r);
    await expect(registry.connect(registrar).registerRecord(r)).to.be.revertedWith("LandReg: record exists");
  });

  it("revokes once", async () => {
    const r = record();
    await registry.connect(registrar).registerRecord(r);
    await expect(registry.connect(registrar).revokeRecord(r.recordId, "court order")).to.emit(registry, "RecordRevoked");
    expect(await registry.revoked(r.recordId)).to.equal(true);
    await expect(registry.connect(registrar).revokeRecord(r.recordId, "x")).to.be.revertedWith("LandReg: already revoked");
  });
});
