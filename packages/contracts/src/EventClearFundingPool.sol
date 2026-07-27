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

/// @notice Allowlisted ERC-4626 pilot pool accounting advances at cost until settlement.
contract EventClearFundingPool is ERC4626, AccessControl, ERC1155Holder {
    using SafeERC20 for IERC20;
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    bytes32 public constant LP_ROLE = keccak256("LP_ROLE");

    uint256 public outstandingAdvanceCostBasis;
    uint256 public realizedYield;
    uint256 public depositCap;
    uint256 public perBundleCap;
    uint16 public utilizationCapBps = 8_000;
    uint16 public minimumReserveBps = 1_000;
    mapping(uint256 bundleId => uint256) public advanceCostBasis;

    error CapExceeded();
    error InsufficientLiquidity();
    error BundleAlreadyFunded();

    event AdvanceFunded(uint256 indexed bundleId, address indexed borrower, uint256 amount);
    event PrincipalSettled(uint256 indexed bundleId, uint256 principalReceived, uint256 realizedGrossYield);

    constructor(IERC20 asset_, address admin, uint256 cap, uint256 bundleCap)
        ERC20("EventClear Pilot Pool", "ecPUSD")
        ERC4626(asset_)
    {
        depositCap = cap;
        perBundleCap = bundleCap;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(LP_ROLE, admin);
    }

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + outstandingAdvanceCostBasis;
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

    function fundAdvance(uint256 bundleId, address borrower, uint256 amount) external onlyRole(VAULT_ROLE) {
        if (advanceCostBasis[bundleId] != 0) revert BundleAlreadyFunded();
        if (amount > perBundleCap) revert CapExceeded();
        uint256 assets = totalAssets();
        if (assets == 0 || (outstandingAdvanceCostBasis + amount) * 10_000 > assets * utilizationCapBps) {
            revert CapExceeded();
        }
        uint256 liquid = IERC20(asset()).balanceOf(address(this));
        if (liquid < amount || liquid - amount < assets * minimumReserveBps / 10_000) revert InsufficientLiquidity();
        advanceCostBasis[bundleId] = amount;
        outstandingAdvanceCostBasis += amount;
        IERC20(asset()).safeTransfer(borrower, amount);
        emit AdvanceFunded(bundleId, borrower, amount);
    }

    function recordSettlement(uint256 bundleId, uint256 principalReceived) external onlyRole(VAULT_ROLE) {
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
        advanceCostBasis[bundleId] = 0;
        outstandingAdvanceCostBasis -= cost;
        uint256 grossYield = principalReceived > cost ? principalReceived - cost : 0;
        realizedYield += grossYield;
        emit PrincipalSettled(bundleId, principalReceived, grossYield);
    }

    function setRiskLimits(uint16 utilization, uint16 reserve) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (utilization > 10_000 || reserve > utilization) revert CapExceeded();
        utilizationCapBps = utilization;
        minimumReserveBps = reserve;
    }

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl, ERC1155Holder) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
