// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IPolymarketCollateralToken, IPolymarketConditionalTokens} from "../PolymarketStandardAdapter.sol";

contract MockOfficialCTFAdapter is ERC1155Holder {
    using SafeERC20 for IERC20;

    IPolymarketConditionalTokens public immutable conditionalTokens;
    IPolymarketCollateralToken public immutable pUSD;
    IERC20 public immutable usdce;

    constructor(IPolymarketConditionalTokens conditionalTokens_, IPolymarketCollateralToken pUSD_, IERC20 usdce_) {
        conditionalTokens = conditionalTokens_;
        pUSD = pUSD_;
        usdce = usdce_;
    }

    function redeemPositions(address, bytes32, bytes32 conditionId, uint256[] calldata indexSets) external {
        bytes32 yesCollection = conditionalTokens.getCollectionId(bytes32(0), conditionId, 1);
        bytes32 noCollection = conditionalTokens.getCollectionId(bytes32(0), conditionId, 2);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        ids[0] = conditionalTokens.getPositionId(usdce, yesCollection);
        ids[1] = conditionalTokens.getPositionId(usdce, noCollection);
        amounts[0] = conditionalTokens.balanceOf(msg.sender, ids[0]);
        amounts[1] = conditionalTokens.balanceOf(msg.sender, ids[1]);
        conditionalTokens.safeBatchTransferFrom(msg.sender, address(this), ids, amounts, "");
        uint256 beforeBalance = usdce.balanceOf(address(this));
        conditionalTokens.redeemPositions(usdce, bytes32(0), conditionId, indexSets);
        uint256 proceeds = usdce.balanceOf(address(this)) - beforeBalance;
        if (proceeds != 0) {
            usdce.safeTransfer(address(pUSD), proceeds);
            pUSD.wrap(address(usdce), msg.sender, proceeds, address(0), "");
        }
    }
}
