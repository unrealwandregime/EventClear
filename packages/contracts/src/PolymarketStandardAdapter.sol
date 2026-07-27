// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/// @dev Minimal interface implemented by Polymarket's legacy Conditional Tokens contract.
interface IPolymarketConditionalTokens is IERC1155 {
    function payoutDenominator(bytes32 conditionId) external view returns (uint256);
    function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet)
        external
        view
        returns (bytes32);
    function getPositionId(IERC20 collateralToken, bytes32 collectionId) external pure returns (uint256);
    function redeemPositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external;
}

/// @dev Current pUSD wrapper interface used by Polymarket's CTF collateral adapter.
interface IPolymarketCollateralToken is IERC20 {
    function wrap(address asset, address to, uint256 amount, address callbackReceiver, bytes calldata data) external;
}

interface IPolymarketOfficialCTFAdapter {
    function redeemPositions(
        address collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external;
}

/// @dev Per-redemption isolation prevents the official adapter's whole-balance
/// redemption semantics from crossing EventClear bundles that share a condition.
contract ExactRedemptionEscrow is ERC1155Holder {
    using SafeERC20 for IERC20;

    IPolymarketConditionalTokens public immutable conditionalTokens;
    IERC20 public immutable pUSD;
    IPolymarketOfficialCTFAdapter public immutable officialAdapter;
    address public immutable owner;
    address public immutable beneficiary;

    error Unauthorized();

    constructor(
        IPolymarketConditionalTokens conditionalTokens_,
        IERC20 pUSD_,
        IPolymarketOfficialCTFAdapter officialAdapter_,
        address beneficiary_
    ) {
        conditionalTokens = conditionalTokens_;
        pUSD = pUSD_;
        officialAdapter = officialAdapter_;
        owner = msg.sender;
        beneficiary = beneficiary_;
    }

    function redeem(bytes32[] calldata conditionIds) external {
        if (msg.sender != owner) revert Unauthorized();
        uint256[] memory indexSets = new uint256[](2);
        indexSets[0] = 1;
        indexSets[1] = 2;
        conditionalTokens.setApprovalForAll(address(officialAdapter), true);
        for (uint256 i; i < conditionIds.length; ++i) {
            officialAdapter.redeemPositions(address(pUSD), bytes32(0), conditionIds[i], indexSets);
        }
        conditionalTokens.setApprovalForAll(address(officialAdapter), false);
        pUSD.safeTransfer(beneficiary, pUSD.balanceOf(address(this)));
    }
}

/// @notice Isolates each EventClear standard-market redemption before wrapping USDC.e proceeds into pUSD.
/// @dev Mainnet pilot scope deliberately excludes negative-risk markets, whose position IDs and redemption path differ.
contract PolymarketStandardAdapter {
    IPolymarketConditionalTokens public immutable conditionalTokens;
    IPolymarketCollateralToken public immutable pUSD;
    IERC20 public immutable usdce;
    IPolymarketOfficialCTFAdapter public immutable officialAdapter;

    error InvalidConfiguration();
    error InvalidLegs();
    error InvalidToken();
    error DuplicateCondition();
    error UnexpectedAdapterBalance();

    constructor(
        IPolymarketConditionalTokens conditionalTokens_,
        IPolymarketCollateralToken pUSD_,
        IERC20 usdce_,
        IPolymarketOfficialCTFAdapter officialAdapter_
    ) {
        if (
            address(conditionalTokens_) == address(0) || address(pUSD_) == address(0) || address(usdce_) == address(0)
                || address(officialAdapter_) == address(0)
        ) {
            revert InvalidConfiguration();
        }
        conditionalTokens = conditionalTokens_;
        pUSD = pUSD_;
        usdce = usdce_;
        officialAdapter = officialAdapter_;
    }

    function areResolved(bytes32[] calldata conditionIds) external view returns (bool) {
        if (conditionIds.length == 0) return false;
        for (uint256 i; i < conditionIds.length; ++i) {
            if (conditionalTokens.payoutDenominator(conditionIds[i]) == 0) return false;
        }
        return true;
    }

    function redeem(bytes32[] calldata conditionIds, uint256[] calldata tokenIds, uint256[] calldata amounts) external {
        uint256 length = conditionIds.length;
        if (length == 0 || length != tokenIds.length || length != amounts.length) revert InvalidLegs();

        for (uint256 i; i < length; ++i) {
            if (amounts[i] == 0) revert InvalidLegs();
            for (uint256 j; j < i; ++j) {
                if (conditionIds[i] == conditionIds[j]) revert DuplicateCondition();
            }
            (uint256 yesTokenId, uint256 noTokenId) = positionIds(conditionIds[i]);
            if (tokenIds[i] != yesTokenId && tokenIds[i] != noTokenId) revert InvalidToken();
        }

        ExactRedemptionEscrow escrow = new ExactRedemptionEscrow(conditionalTokens, pUSD, officialAdapter, msg.sender);
        conditionalTokens.safeBatchTransferFrom(msg.sender, address(escrow), tokenIds, amounts, "");
        escrow.redeem(conditionIds);
        for (uint256 i; i < length; ++i) {
            if (conditionalTokens.balanceOf(address(escrow), tokenIds[i]) != 0) revert UnexpectedAdapterBalance();
        }
    }

    function positionIds(bytes32 conditionId) public view returns (uint256 yesTokenId, uint256 noTokenId) {
        bytes32 yesCollection = conditionalTokens.getCollectionId(bytes32(0), conditionId, 1);
        bytes32 noCollection = conditionalTokens.getCollectionId(bytes32(0), conditionId, 2);
        yesTokenId = conditionalTokens.getPositionId(usdce, yesCollection);
        noTokenId = conditionalTokens.getPositionId(usdce, noCollection);
    }
}
