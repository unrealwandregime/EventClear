// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Central, fail-closed origination limits for the controlled v1 pilot.
/// @dev Existing bundle settlement never calls this contract and remains
/// available when new originations are paused.
contract RiskPolicy is AccessControl {
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant CRYPTO_THRESHOLD_V1 = keccak256("CRYPTO_THRESHOLD_V1");

    uint16 public maximumAdvanceRatioBps;
    uint64 public maximumBundleDuration;
    uint256 public maximumGrossAdvance;
    uint256 public perWalletExposureCap;
    uint256 public perMarketExposureCap;
    uint256 public perRelationshipExposureCap;
    uint256 public globalExposureCap;

    address public quoteSigner;
    bool public originationsPaused;

    mapping(address wallet => uint256) public walletExposure;
    mapping(bytes32 market => uint256) public marketExposure;
    mapping(bytes32 relationship => uint256) public relationshipExposure;
    uint256 public globalExposure;

    mapping(address adapter => bool) public allowedAdapters;
    mapping(address collateral => bool) public allowedCollaterals;
    mapping(bytes32 schema => bool) public allowedRelationshipSchemas;

    error RiskLimitExceeded();
    error UnsupportedConfiguration();
    error OriginationsPaused();
    error InvalidRiskInput();

    event LimitsUpdated(
        uint16 maximumAdvanceRatioBps,
        uint64 maximumBundleDuration,
        uint256 maximumGrossAdvance,
        uint256 perWalletExposureCap,
        uint256 perMarketExposureCap,
        uint256 perRelationshipExposureCap,
        uint256 globalExposureCap
    );
    event QuoteSignerUpdated(address indexed signer);
    event OriginationsPauseUpdated(bool paused);
    event AdapterAllowed(address indexed adapter, bool allowed);
    event CollateralAllowed(address indexed collateral, bool allowed);
    event RelationshipSchemaAllowed(bytes32 indexed schema, bool allowed);
    event ExposureConsumed(address indexed wallet, bytes32 indexed relationshipHash, uint256 grossAdvance);
    event ExposureReleased(address indexed wallet, bytes32 indexed relationshipHash, uint256 grossAdvance);

    constructor(address admin, address signer) {
        if (admin == address(0) || signer == address(0)) revert InvalidRiskInput();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RISK_ADMIN_ROLE, admin);
        quoteSigner = signer;
        maximumAdvanceRatioBps = 9_500;
        maximumBundleDuration = 366 days;
        maximumGrossAdvance = type(uint128).max;
        perWalletExposureCap = type(uint128).max;
        perMarketExposureCap = type(uint128).max;
        perRelationshipExposureCap = type(uint128).max;
        globalExposureCap = type(uint128).max;
        allowedRelationshipSchemas[CRYPTO_THRESHOLD_V1] = true;
    }

    function validateAndConsume(
        address wallet,
        bytes32 relationshipHash,
        bytes32[] calldata marketIds,
        bytes32 relationshipSchema,
        address adapter,
        address collateral,
        uint256 guaranteedFloor,
        uint256 grossAdvance,
        uint256 expiry,
        uint256 latestResolutionTimestamp
    ) external onlyRole(VAULT_ROLE) {
        if (originationsPaused) revert OriginationsPaused();
        if (
            wallet == address(0) || relationshipHash == bytes32(0) || marketIds.length == 0 || guaranteedFloor == 0
                || grossAdvance == 0 || expiry < block.timestamp || latestResolutionTimestamp <= block.timestamp
        ) revert InvalidRiskInput();
        if (
            !allowedRelationshipSchemas[relationshipSchema] || !allowedAdapters[adapter]
                || !allowedCollaterals[collateral]
        ) revert UnsupportedConfiguration();
        if (
            grossAdvance > maximumGrossAdvance || grossAdvance * 10_000 > guaranteedFloor * maximumAdvanceRatioBps
                || latestResolutionTimestamp - block.timestamp > maximumBundleDuration
                || walletExposure[wallet] + grossAdvance > perWalletExposureCap
                || relationshipExposure[relationshipHash] + grossAdvance > perRelationshipExposureCap
                || globalExposure + grossAdvance > globalExposureCap
        ) revert RiskLimitExceeded();

        for (uint256 i; i < marketIds.length; ++i) {
            if (marketIds[i] == bytes32(0)) revert InvalidRiskInput();
            bool alreadyCounted;
            for (uint256 j; j < i; ++j) {
                if (marketIds[j] == marketIds[i]) alreadyCounted = true;
            }
            if (alreadyCounted) continue;
            if (marketExposure[marketIds[i]] + grossAdvance > perMarketExposureCap) {
                revert RiskLimitExceeded();
            }
            marketExposure[marketIds[i]] += grossAdvance;
        }
        walletExposure[wallet] += grossAdvance;
        relationshipExposure[relationshipHash] += grossAdvance;
        globalExposure += grossAdvance;
        emit ExposureConsumed(wallet, relationshipHash, grossAdvance);
    }

    function releaseExposure(
        address wallet,
        bytes32 relationshipHash,
        bytes32[] calldata marketIds,
        uint256 grossAdvance
    ) external onlyRole(VAULT_ROLE) {
        walletExposure[wallet] -= grossAdvance;
        relationshipExposure[relationshipHash] -= grossAdvance;
        globalExposure -= grossAdvance;
        for (uint256 i; i < marketIds.length; ++i) {
            bool alreadyCounted;
            for (uint256 j; j < i; ++j) {
                if (marketIds[j] == marketIds[i]) alreadyCounted = true;
            }
            if (alreadyCounted) continue;
            marketExposure[marketIds[i]] -= grossAdvance;
        }
        emit ExposureReleased(wallet, relationshipHash, grossAdvance);
    }

    function setLimits(
        uint16 advanceRatioBps,
        uint64 bundleDuration,
        uint256 grossAdvanceCap,
        uint256 walletCap,
        uint256 marketCap,
        uint256 relationshipCap,
        uint256 totalCap
    ) external onlyRole(RISK_ADMIN_ROLE) {
        if (
            advanceRatioBps == 0 || advanceRatioBps > 10_000 || bundleDuration == 0 || grossAdvanceCap == 0
                || walletCap == 0 || marketCap == 0 || relationshipCap == 0 || totalCap == 0
        ) revert InvalidRiskInput();
        maximumAdvanceRatioBps = advanceRatioBps;
        maximumBundleDuration = bundleDuration;
        maximumGrossAdvance = grossAdvanceCap;
        perWalletExposureCap = walletCap;
        perMarketExposureCap = marketCap;
        perRelationshipExposureCap = relationshipCap;
        globalExposureCap = totalCap;
        emit LimitsUpdated(
            advanceRatioBps, bundleDuration, grossAdvanceCap, walletCap, marketCap, relationshipCap, totalCap
        );
    }

    function setQuoteSigner(address signer) external onlyRole(RISK_ADMIN_ROLE) {
        if (signer == address(0)) revert InvalidRiskInput();
        quoteSigner = signer;
        emit QuoteSignerUpdated(signer);
    }

    function setOriginationsPaused(bool paused) external onlyRole(RISK_ADMIN_ROLE) {
        originationsPaused = paused;
        emit OriginationsPauseUpdated(paused);
    }

    function setAdapterAllowed(address adapter, bool allowed) external onlyRole(RISK_ADMIN_ROLE) {
        if (adapter == address(0)) revert InvalidRiskInput();
        allowedAdapters[adapter] = allowed;
        emit AdapterAllowed(adapter, allowed);
    }

    function setCollateralAllowed(address collateral, bool allowed) external onlyRole(RISK_ADMIN_ROLE) {
        if (collateral == address(0)) revert InvalidRiskInput();
        allowedCollaterals[collateral] = allowed;
        emit CollateralAllowed(collateral, allowed);
    }

    function setRelationshipSchemaAllowed(bytes32 schema, bool allowed) external onlyRole(RISK_ADMIN_ROLE) {
        if (schema == bytes32(0)) revert InvalidRiskInput();
        allowedRelationshipSchemas[schema] = allowed;
        emit RelationshipSchemaAllowed(schema, allowed);
    }
}
