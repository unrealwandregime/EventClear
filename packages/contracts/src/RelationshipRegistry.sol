// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Immutable-version registry for reviewed relationship definitions.
contract RelationshipRegistry is AccessControl {
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");
    bytes32 public constant SUSPENDER_ROLE = keccak256("SUSPENDER_ROLE");

    enum Status {
        NONE,
        APPROVED,
        SUSPENDED,
        RETIRED
    }

    struct Definition {
        uint32 version;
        Status status;
        uint64 validFrom;
        uint64 validUntil;
        bytes32 ruleDocumentHash;
    }

    mapping(bytes32 definitionHash => Definition) public definitions;

    error AlreadyRegistered();
    error InvalidInterval();
    error InvalidStatus();

    event RelationshipRegistered(bytes32 indexed definitionHash, uint32 version, bytes32 ruleDocumentHash);
    event RelationshipStatusChanged(bytes32 indexed definitionHash, Status status);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REVIEWER_ROLE, admin);
        _grantRole(SUSPENDER_ROLE, admin);
    }

    function register(
        bytes32 definitionHash,
        uint32 version,
        uint64 validFrom,
        uint64 validUntil,
        bytes32 ruleDocumentHash
    ) external onlyRole(REVIEWER_ROLE) {
        if (definitionHash == bytes32(0) || version == 0) revert InvalidStatus();
        if (definitions[definitionHash].status != Status.NONE) revert AlreadyRegistered();
        if (validUntil != 0 && validUntil <= validFrom) revert InvalidInterval();
        definitions[definitionHash] = Definition(version, Status.APPROVED, validFrom, validUntil, ruleDocumentHash);
        emit RelationshipRegistered(definitionHash, version, ruleDocumentHash);
    }

    function suspend(bytes32 definitionHash) external onlyRole(SUSPENDER_ROLE) {
        if (definitions[definitionHash].status != Status.APPROVED) revert InvalidStatus();
        definitions[definitionHash].status = Status.SUSPENDED;
        emit RelationshipStatusChanged(definitionHash, Status.SUSPENDED);
    }

    function retire(bytes32 definitionHash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Status current = definitions[definitionHash].status;
        if (current != Status.APPROVED && current != Status.SUSPENDED) revert InvalidStatus();
        definitions[definitionHash].status = Status.RETIRED;
        emit RelationshipStatusChanged(definitionHash, Status.RETIRED);
    }

    function isActive(bytes32 definitionHash) external view returns (bool) {
        Definition memory item = definitions[definitionHash];
        return item.status == Status.APPROVED && block.timestamp >= item.validFrom
            && (item.validUntil == 0 || block.timestamp <= item.validUntil);
    }

    function versionOf(bytes32 definitionHash) external view returns (uint32) {
        return definitions[definitionHash].version;
    }
}
