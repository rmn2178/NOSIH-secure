// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LandRegistry
 * @dev NOSIH – blockchain-anchored land deed records.
 *
 * Design notes
 * - Only hashes and registry identifiers live on-chain. Owner names, survey
 *   details and boundaries stay in access-controlled off-chain storage.
 * - The ownership chain (previousRecordId / previousOwnerId) is resolved
 *   off-chain by the registrar backend and passed in. The contract does not
 *   walk or re-validate history, keeping each registration a single write.
 * - A matching hash proves a document matches a registered version; it does
 *   not by itself prove legal ownership.
 */
contract LandRegistry is Ownable {

    constructor() Ownable(msg.sender) {}

    // ─────────────────────────────────────────────
    //  RECORD (12 fields)
    // ─────────────────────────────────────────────

    struct PropertyRecord {
        bytes32 propertyId;        // Land parcel identifier
        bytes32 surveyNumberHash;  // Keyed fingerprint of survey number
        bytes32 jurisdictionCode;  // State / district / SRO code
        bytes32 landDetailsHash;   // Canonical land details fingerprint
        bytes32 documentHash;      // SHA-256 of the exact deed PDF
        bytes32 metadataHash;      // Canonical extracted-metadata fingerprint
        string  ipfsCID;           // CID of the ENCRYPTED deed on IPFS
        bytes32 recordId;          // This registration record
        bytes32 previousRecordId;  // Preceding record for this parcel (0 if first)
        bytes32 previousOwnerId;   // Previous owner registry identity
        bytes32 currentOwnerId;    // Current owner registry identity
        uint256 registeredAt;      // Block timestamp
    }

    // ─────────────────────────────────────────────
    //  STATE
    // ─────────────────────────────────────────────

    mapping(bytes32 => PropertyRecord) private records;
    mapping(bytes32 => bool) public revoked;
    mapping(address => bool) public authorizedRegistrars;

    // ─────────────────────────────────────────────
    //  EVENTS (audit trail)
    // ─────────────────────────────────────────────

    event RegistrarAdded(address indexed registrar);
    event RegistrarRemoved(address indexed registrar);
    event RecordRegistered(
        bytes32 indexed recordId,
        bytes32 indexed propertyId,
        bytes32 indexed currentOwnerId,
        bytes32 previousRecordId,
        bytes32 documentHash,
        address registrar,
        uint256 registeredAt
    );
    event RecordRevoked(bytes32 indexed recordId, address indexed revokedBy, string reason);

    // ─────────────────────────────────────────────
    //  ACCESS
    // ─────────────────────────────────────────────

    modifier onlyRegistrar() {
        require(authorizedRegistrars[msg.sender], "LandReg: not an authorized registrar");
        _;
    }

    function addRegistrar(address registrar) external onlyOwner {
        require(registrar != address(0), "LandReg: zero address");
        require(!authorizedRegistrars[registrar], "LandReg: already authorized");
        authorizedRegistrars[registrar] = true;
        emit RegistrarAdded(registrar);
    }

    function removeRegistrar(address registrar) external onlyOwner {
        require(authorizedRegistrars[registrar], "LandReg: not authorized");
        authorizedRegistrars[registrar] = false;
        emit RegistrarRemoved(registrar);
    }

    // ─────────────────────────────────────────────
    //  WRITE
    // ─────────────────────────────────────────────

    /**
     * @notice Registers a deed record. `registeredAt` is set from the block.
     * @dev Linking fields are trusted from the registrar; no history lookups.
     */
    function registerRecord(PropertyRecord calldata r) external onlyRegistrar {
        require(r.recordId != bytes32(0), "LandReg: empty recordId");
        require(r.propertyId != bytes32(0), "LandReg: empty propertyId");
        require(r.documentHash != bytes32(0), "LandReg: empty documentHash");
        require(bytes(r.ipfsCID).length > 0, "LandReg: empty CID");
        require(records[r.recordId].registeredAt == 0, "LandReg: record exists");

        PropertyRecord storage s = records[r.recordId];
        s.propertyId       = r.propertyId;
        s.surveyNumberHash = r.surveyNumberHash;
        s.jurisdictionCode = r.jurisdictionCode;
        s.landDetailsHash  = r.landDetailsHash;
        s.documentHash     = r.documentHash;
        s.metadataHash     = r.metadataHash;
        s.ipfsCID          = r.ipfsCID;
        s.recordId         = r.recordId;
        s.previousRecordId = r.previousRecordId;
        s.previousOwnerId  = r.previousOwnerId;
        s.currentOwnerId   = r.currentOwnerId;
        s.registeredAt     = block.timestamp;

        emit RecordRegistered(
            r.recordId, r.propertyId, r.currentOwnerId,
            r.previousRecordId, r.documentHash, msg.sender, block.timestamp
        );
    }

    function revokeRecord(bytes32 recordId, string calldata reason) external onlyRegistrar {
        require(records[recordId].registeredAt != 0, "LandReg: record not found");
        require(!revoked[recordId], "LandReg: already revoked");
        revoked[recordId] = true;
        emit RecordRevoked(recordId, msg.sender, reason);
    }

    // ─────────────────────────────────────────────
    //  READ
    // ─────────────────────────────────────────────

    function getRecord(bytes32 recordId)
        external
        view
        returns (PropertyRecord memory record, bool isRevoked)
    {
        require(records[recordId].registeredAt != 0, "LandReg: record not found");
        return (records[recordId], revoked[recordId]);
    }

    function recordExists(bytes32 recordId) external view returns (bool) {
        return records[recordId].registeredAt != 0;
    }
}
