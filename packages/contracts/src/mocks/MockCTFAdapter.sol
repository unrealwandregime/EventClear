// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {MockConditionalTokens} from "./MockConditionalTokens.sol";
import {MockPUSD} from "./MockPUSD.sol";

contract MockCTFAdapter is ERC1155Holder {
    MockConditionalTokens public immutable positions;
    MockPUSD public immutable collateral;

    constructor(MockConditionalTokens positions_, MockPUSD collateral_) {
        positions = positions_;
        collateral = collateral_;
    }

    function areResolved(bytes32[] calldata conditionIds) external view returns (bool) {
        for (uint256 i; i < conditionIds.length; ++i) {
            if (positions.payoutYes(conditionIds[i]) + positions.payoutNo(conditionIds[i]) != 1_000_000) return false;
        }
        return true;
    }

    function redeem(bytes32[] calldata, uint256[] calldata tokenIds, uint256[] calldata amounts) external {
        uint256 payout;
        for (uint256 i; i < tokenIds.length; ++i) {
            positions.safeTransferFrom(msg.sender, address(this), tokenIds[i], amounts[i], "");
            payout += positions.burnForRedemption(address(this), tokenIds[i], amounts[i]);
        }
        collateral.mint(msg.sender, payout);
    }
}
