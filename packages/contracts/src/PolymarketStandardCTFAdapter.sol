// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IPolymarketCollateralToken,
    IPolymarketConditionalTokens,
    IPolymarketOfficialCTFAdapter,
    PolymarketStandardAdapter
} from "./PolymarketStandardAdapter.sol";

/// @notice Canonically named v1 adapter for standard binary Polymarket CTF positions.
contract PolymarketStandardCTFAdapter is PolymarketStandardAdapter {
    constructor(
        IPolymarketConditionalTokens conditionalTokens_,
        IPolymarketCollateralToken collateral_,
        IERC20 usdce_,
        IPolymarketOfficialCTFAdapter officialAdapter_
    ) PolymarketStandardAdapter(conditionalTokens_, collateral_, usdce_, officialAdapter_) {}
}
