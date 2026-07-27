// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

interface IPrincipalVault {
    function redeemPrincipal(uint256 bundleId, uint256 amount) external;
}

interface IFeeTreasury {
    function recordFee(bytes32 source, uint256 amount) external;
}

/// @notice Allowlisted ERC-4626 pilot pool accounting advances at cost until settlement.
contract EventClearFundingPool is ERC4626, AccessControl, ERC1155Holder {
    using SafeERC20 for IERC20;
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant LP_ROLE = keccak256("LP_ROLE");

    uint256 public outstandingAdvanceCostBasis;
    uint256 public outstandingQuotedFees;
    uint256 public realizedYield;
    uint256 public realizedLoss;
    uint256 public realizedOriginationFees;
    uint256 public depositCap;
    uint256 public perBundleCap;
    uint16 public utilizationCapBps = 8_000;
    uint16 public minimumReserveBps = 1_000;
    uint16 public protocolYieldFeeBps = 1_000;
    mapping(uint256 bundleId => uint256) public advanceCostBasis;
    mapping(uint256 bundleId => uint256) public quotedOriginationFee;
    mapping(uint256 bundleId => address) public advanceBorrower;
    address public immutable feeTreasury;

    error CapExceeded();
    error InsufficientLiquidity();
    error BundleAlreadyFunded();
    error InvalidTreasury();
    error InvalidAdvance();

    event AdvanceFunded(
        uint256 indexed bundleId,
        address indexed borrower,
        uint256 grossAdvance,
        uint256 originationFee,
        uint256 netAdvance
    );
    event PrincipalSettled(
        uint256 indexed bundleId, uint256 principalReceived, uint256 realizedNetYield, uint256 protocolFee
    );
    event OriginationFeeSettled(uint256 indexed bundleId, uint256 quotedFee, uint256 realizedFee, uint256 refundedFee);

    constructor(IERC20 asset_, address admin, address feeTreasury_, uint256 cap, uint256 bundleCap)
        ERC20("EventClear Pilot Pool", "ecPUSD")
        ERC4626(asset_)
    {
        if (feeTreasury_ == address(0)) revert InvalidTreasury();
        feeTreasury = feeTreasury_;
        depositCap = cap;
        perBundleCap = bundleCap;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(LP_ROLE, admin);
    }

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + outstandingAdvanceCostBasis - outstandingQuotedFees;
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        if (!hasRole(LP_ROLE, receiver) || totalAssets() >= depositCap) return 0;
        return depositCap - totalAssets();
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 entitled = convertToAssets(balanceOf(owner));
        uint256 liquid = IERC20(asset()).balanceOf(address(this));
        uint256 reserve = totalAssets() * minimumReserveBps / 10_000;
        uint256 available = liquid > reserve ? liquid - reserve : 0;
        return entitled < available ? entitled : available;
    }

    function fundAdvance(uint256 bundleId, address borrower, uint256 amount, uint256 fee)
        external
        onlyRole(VAULT_ROLE)
    {
        if (advanceCostBasis[bundleId] != 0) revert BundleAlreadyFunded();
        if (borrower == address(0) || amount == 0 || fee >= amount) revert InvalidAdvance();
        if (amount > perBundleCap) revert CapExceeded();
        uint256 assets = totalAssets();
        if (assets == 0 || (outstandingAdvanceCostBasis + amount) * 10_000 > assets * utilizationCapBps) {
            revert CapExceeded();
        }
        uint256 netAdvance = amount - fee;
        uint256 liquid = IERC20(asset()).balanceOf(address(this));
        if (liquid < netAdvance || liquid - netAdvance < assets * minimumReserveBps / 10_000) {
            revert InsufficientLiquidity();
        }
        advanceCostBasis[bundleId] = amount;
        quotedOriginationFee[bundleId] = fee;
        advanceBorrower[bundleId] = borrower;
        outstandingAdvanceCostBasis += amount;
        outstandingQuotedFees += fee;
        IERC20(asset()).safeTransfer(borrower, netAdvance);
        emit AdvanceFunded(bundleId, borrower, amount, fee, netAdvance);
    }

    function recordSettlement(uint256 bundleId, uint256 principalReceived) external onlyRole(VAULT_ROLE) {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), principalReceived);
        _recordSettlement(bundleId, principalReceived);
    }

    /// @notice Permissionless realization of principal owned by this pool; proceeds cannot be redirected.
    function redeemPrincipal(IPrincipalVault vault, uint256 bundleId, uint256 claimAmount) external {
        uint256 beforeBalance = IERC20(asset()).balanceOf(address(this));
        vault.redeemPrincipal(bundleId, claimAmount);
        _recordSettlement(bundleId, IERC20(asset()).balanceOf(address(this)) - beforeBalance);
    }

    function _recordSettlement(uint256 bundleId, uint256 principalReceived) internal {
        uint256 cost = advanceCostBasis[bundleId];
        if (cost == 0) revert InsufficientLiquidity();
        uint256 quotedFee = quotedOriginationFee[bundleId];
        address borrower = advanceBorrower[bundleId];
        advanceCostBasis[bundleId] = 0;
        quotedOriginationFee[bundleId] = 0;
        advanceBorrower[bundleId] = address(0);
        outstandingAdvanceCostBasis -= cost;
        outstandingQuotedFees -= quotedFee;
        uint256 grossYield = principalReceived > cost ? principalReceived - cost : 0;
        uint256 loss = principalReceived < cost ? cost - principalReceived : 0;
        uint256 realizedOriginationFee = grossYield < quotedFee ? grossYield : quotedFee;
        uint256 refundedFee = quotedFee - realizedOriginationFee;
        uint256 remainingYield = grossYield - realizedOriginationFee;
        uint256 protocolFee = remainingYield * protocolYieldFeeBps / 10_000;
        uint256 netYield = remainingYield - protocolFee;
        realizedYield += netYield;
        realizedLoss += loss;
        realizedOriginationFees += realizedOriginationFee;
        if (realizedOriginationFee != 0) {
            IERC20(asset()).safeTransfer(feeTreasury, realizedOriginationFee);
            IFeeTreasury(feeTreasury).recordFee(keccak256("ORIGINATION"), realizedOriginationFee);
        }
        if (protocolFee != 0) {
            IERC20(asset()).safeTransfer(feeTreasury, protocolFee);
            IFeeTreasury(feeTreasury).recordFee(keccak256("REALIZED_FINANCING_RETURN"), protocolFee);
        }
        if (refundedFee != 0) IERC20(asset()).safeTransfer(borrower, refundedFee);
        emit OriginationFeeSettled(bundleId, quotedFee, realizedOriginationFee, refundedFee);
        emit PrincipalSettled(bundleId, principalReceived, netYield, protocolFee);
    }

    function setRiskLimits(uint16 utilization, uint16 reserve) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (utilization > 10_000 || reserve > utilization) revert CapExceeded();
        utilizationCapBps = utilization;
        minimumReserveBps = reserve;
    }

    function setProtocolYieldFee(uint16 feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeBps > 10_000) revert CapExceeded();
        protocolYieldFeeBps = feeBps;
    }

    function liquidAssets() external view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function accruedUnearnedDiscount() external pure returns (uint256) {
        // Principal entitlements are held as ERC-1155 claims and are not counted
        // as earned until redemption, so no discount is accrued into book assets.
        return 0;
    }

    function utilizationBps() external view returns (uint256) {
        uint256 assets = totalAssets();
        return assets == 0 ? 0 : outstandingAdvanceCostBasis * 10_000 / assets;
    }

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, ERC1155Holder) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
