// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import {EventClearClaims} from "./EventClearClaims.sol";
import {EventClearFundingPool} from "./EventClearFundingPool.sol";
import {RelationshipRegistry} from "./RelationshipRegistry.sol";

interface IRedemptionAdapter {
    function areResolved(bytes32[] calldata conditionIds) external view returns (bool);
    function redeem(bytes32[] calldata conditionIds, uint256[] calldata tokenIds, uint256[] calldata amounts) external;
}

/// @notice Escrows exact outcome-token bundles and distributes terminal pUSD by claim priority.
contract EventClearVault is AccessControl, Pausable, ReentrancyGuard, EIP712, ERC1155Holder {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");
    bytes32 private constant QUOTE_TYPEHASH = keccak256(
        "FinancingQuote(address accountWallet,bytes32 bundleHash,bytes32 relationshipDefinitionHash,bytes32 solverProofHash,uint256 guaranteedFloor,uint256 principalAmount,uint256 advanceAmount,uint256 originationFee,uint256 expiry,uint256 nonce,uint256 chainId,address vault)"
    );

    enum BundleStatus {
        NONE,
        ACTIVE,
        RESOLUTION_PENDING,
        SETTLED,
        SHORTFALL,
        CANCELLED
    }

    struct FinancingQuote {
        address accountWallet;
        bytes32 bundleHash;
        bytes32 relationshipDefinitionHash;
        bytes32 solverProofHash;
        uint256 guaranteedFloor;
        uint256 principalAmount;
        uint256 advanceAmount;
        uint256 originationFee;
        uint256 expiry;
        uint256 nonce;
        uint256 chainId;
        address vault;
    }

    struct Bundle {
        address accountWallet;
        bytes32 relationshipDefinitionHash;
        bytes32 solverProofHash;
        uint256 principalAmount;
        uint256 advanceAmount;
        uint256 settlementProceeds;
        uint256 principalAllocation;
        uint256 residualAllocation;
        uint256 principalClaimed;
        uint256 residualClaimed;
        BundleStatus status;
    }

    IERC20 public immutable collateral;
    IERC1155 public immutable positions;
    RelationshipRegistry public immutable registry;
    EventClearClaims public immutable claims;
    EventClearFundingPool public immutable fundingPool;
    IRedemptionAdapter public immutable adapter;
    address public riskSigner;
    bool public originationsPaused;
    uint256 public nextBundleId = 1;

    mapping(bytes32 quoteKey => bool) public quoteUsed;
    mapping(uint256 bundleId => Bundle) public bundles;
    mapping(uint256 bundleId => bytes32[]) private _conditionIds;
    mapping(uint256 bundleId => uint256[]) private _tokenIds;
    mapping(uint256 bundleId => uint256[]) private _amounts;

    error InvalidQuote();
    error QuoteExpired();
    error QuoteAlreadyUsed();
    error RelationshipInactive();
    error OriginationPaused();
    error InvalidBundleState();
    error ConditionsUnresolved();
    error NothingToClaim();

    event BundleOpened(uint256 indexed bundleId, address indexed accountWallet, bytes32 indexed relationshipHash);
    event PositionsEscrowed(uint256 indexed bundleId, uint256[] tokenIds, uint256[] amounts);
    event AdvanceFunded(uint256 indexed bundleId, uint256 amount);
    event ClaimsMinted(uint256 indexed bundleId, uint256 principalSupply, uint256 residualSupply);
    event SettlementStarted(uint256 indexed bundleId);
    event PositionsRedeemed(uint256 indexed bundleId, uint256 proceeds);
    event BundleSettled(uint256 indexed bundleId, uint256 principalAllocation, uint256 residualAllocation);
    event PrincipalClaimed(uint256 indexed bundleId, address indexed account, uint256 claimsBurned, uint256 payout);
    event ResidualClaimed(uint256 indexed bundleId, address indexed account, uint256 claimsBurned, uint256 payout);
    event BundleShortfall(uint256 indexed bundleId, uint256 principal, uint256 proceeds);

    constructor(
        IERC20 collateral_,
        IERC1155 positions_,
        RelationshipRegistry registry_,
        EventClearClaims claims_,
        EventClearFundingPool fundingPool_,
        IRedemptionAdapter adapter_,
        address signer,
        address admin
    ) EIP712("EventClear", "1") {
        collateral = collateral_;
        positions = positions_;
        registry = registry_;
        claims = claims_;
        fundingPool = fundingPool_;
        adapter = adapter_;
        riskSigner = signer;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(RISK_ADMIN_ROLE, admin);
    }

    function hashLegs(bytes32[] calldata conditionIds, uint256[] calldata tokenIds, uint256[] calldata amounts)
        public
        pure
        returns (bytes32)
    {
        if (conditionIds.length == 0 || conditionIds.length != tokenIds.length || tokenIds.length != amounts.length) {
            revert InvalidQuote();
        }
        return keccak256(abi.encode(conditionIds, tokenIds, amounts));
    }

    function openBundle(
        FinancingQuote calldata quote,
        bytes calldata signature,
        bytes32[] calldata conditionIds,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) external nonReentrant whenNotPaused returns (uint256 bundleId) {
        if (originationsPaused) revert OriginationPaused();
        if (quote.accountWallet != msg.sender || quote.vault != address(this) || quote.chainId != block.chainid) {
            revert InvalidQuote();
        }
        if (quote.expiry < block.timestamp) revert QuoteExpired();
        if (
            quote.principalAmount != quote.guaranteedFloor
                || quote.advanceAmount + quote.originationFee > quote.principalAmount
        ) {
            revert InvalidQuote();
        }
        if (quote.bundleHash != hashLegs(conditionIds, tokenIds, amounts)) revert InvalidQuote();
        if (!registry.isActive(quote.relationshipDefinitionHash)) revert RelationshipInactive();
        bytes32 quoteKey = keccak256(abi.encode(quote.accountWallet, quote.nonce));
        if (quoteUsed[quoteKey]) revert QuoteAlreadyUsed();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH,
                    quote.accountWallet,
                    quote.bundleHash,
                    quote.relationshipDefinitionHash,
                    quote.solverProofHash,
                    quote.guaranteedFloor,
                    quote.principalAmount,
                    quote.advanceAmount,
                    quote.originationFee,
                    quote.expiry,
                    quote.nonce,
                    quote.chainId,
                    quote.vault
                )
            )
        );
        if (ECDSA.recover(digest, signature) != riskSigner) revert InvalidQuote();
        quoteUsed[quoteKey] = true;

        bundleId = nextBundleId++;
        bundles[bundleId] = Bundle({
            accountWallet: msg.sender,
            relationshipDefinitionHash: quote.relationshipDefinitionHash,
            solverProofHash: quote.solverProofHash,
            principalAmount: quote.principalAmount,
            advanceAmount: quote.advanceAmount,
            settlementProceeds: 0,
            principalAllocation: 0,
            residualAllocation: 0,
            principalClaimed: 0,
            residualClaimed: 0,
            status: BundleStatus.ACTIVE
        });
        _conditionIds[bundleId] = conditionIds;
        _tokenIds[bundleId] = tokenIds;
        _amounts[bundleId] = amounts;

        positions.safeBatchTransferFrom(msg.sender, address(this), tokenIds, amounts, "");
        fundingPool.fundAdvance(bundleId, msg.sender, quote.advanceAmount, quote.originationFee);
        claims.mint(address(fundingPool), bundleId, claims.PRINCIPAL(), quote.principalAmount);
        claims.mint(msg.sender, bundleId, claims.RESIDUAL(), quote.principalAmount);
        emit BundleOpened(bundleId, msg.sender, quote.relationshipDefinitionHash);
        emit PositionsEscrowed(bundleId, tokenIds, amounts);
        emit AdvanceFunded(bundleId, quote.advanceAmount);
        emit ClaimsMinted(bundleId, quote.principalAmount, quote.principalAmount);
    }

    function settle(uint256 bundleId) external nonReentrant whenNotPaused {
        Bundle storage bundle = bundles[bundleId];
        if (bundle.status != BundleStatus.ACTIVE) revert InvalidBundleState();
        bytes32[] memory conditionIds = _conditionIds[bundleId];
        if (!adapter.areResolved(conditionIds)) revert ConditionsUnresolved();
        bundle.status = BundleStatus.RESOLUTION_PENDING;
        emit SettlementStarted(bundleId);
        uint256 beforeBalance = collateral.balanceOf(address(this));
        positions.setApprovalForAll(address(adapter), true);
        adapter.redeem(conditionIds, _tokenIds[bundleId], _amounts[bundleId]);
        positions.setApprovalForAll(address(adapter), false);
        uint256 proceeds = collateral.balanceOf(address(this)) - beforeBalance;
        bundle.settlementProceeds = proceeds;
        bundle.principalAllocation = proceeds < bundle.principalAmount ? proceeds : bundle.principalAmount;
        bundle.residualAllocation = proceeds > bundle.principalAmount ? proceeds - bundle.principalAmount : 0;
        emit PositionsRedeemed(bundleId, proceeds);
        if (proceeds < bundle.principalAmount) {
            bundle.status = BundleStatus.SHORTFALL;
            emit BundleShortfall(bundleId, bundle.principalAmount, proceeds);
        } else {
            bundle.status = BundleStatus.SETTLED;
        }
        emit BundleSettled(bundleId, bundle.principalAllocation, bundle.residualAllocation);
    }

    function redeemPrincipal(uint256 bundleId, uint256 amount) external nonReentrant {
        Bundle storage bundle = bundles[bundleId];
        if (bundle.status != BundleStatus.SETTLED && bundle.status != BundleStatus.SHORTFALL) {
            revert InvalidBundleState();
        }
        uint256 payout = amount * bundle.principalAllocation / bundle.principalAmount;
        if (amount == 0 || payout == 0) revert NothingToClaim();
        bundle.principalClaimed += payout;
        claims.burn(msg.sender, claims.claimId(bundleId, claims.PRINCIPAL()), amount);
        collateral.safeTransfer(msg.sender, payout);
        emit PrincipalClaimed(bundleId, msg.sender, amount, payout);
    }

    function redeemResidual(uint256 bundleId, uint256 amount) external nonReentrant {
        Bundle storage bundle = bundles[bundleId];
        if (bundle.status != BundleStatus.SETTLED && bundle.status != BundleStatus.SHORTFALL) {
            revert InvalidBundleState();
        }
        uint256 payout = amount * bundle.residualAllocation / bundle.principalAmount;
        if (amount == 0) revert NothingToClaim();
        bundle.residualClaimed += payout;
        claims.burn(msg.sender, claims.claimId(bundleId, claims.RESIDUAL()), amount);
        if (payout != 0) collateral.safeTransfer(msg.sender, payout);
        emit ResidualClaimed(bundleId, msg.sender, amount, payout);
    }

    function setOriginationsPaused(bool value) external onlyRole(PAUSER_ROLE) {
        originationsPaused = value;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function setRiskSigner(address signer) external onlyRole(RISK_ADMIN_ROLE) {
        if (signer == address(0)) revert InvalidQuote();
        riskSigner = signer;
    }

    function getBundleLegs(uint256 bundleId)
        external
        view
        returns (bytes32[] memory conditionIds, uint256[] memory tokenIds, uint256[] memory amounts)
    {
        return (_conditionIds[bundleId], _tokenIds[bundleId], _amounts[bundleId]);
    }

    function getBundle(uint256 bundleId) external view returns (Bundle memory) {
        return bundles[bundleId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, ERC1155Holder) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
