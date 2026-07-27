// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IPolymarketCollateralToken,
    IPolymarketConditionalTokens,
    PolymarketStandardAdapter
} from "./PolymarketStandardAdapter.sol";

/// @notice Canonically named v1 adapter for standard binary Polymarket CTF positions.
contract PolymarketStandardCTFAdapter is PolymarketStandardAdapter {
    constructor(IPolymarketConditionalTokens conditionalTokens, IPolymarketCollateralToken collateral, IERC20 usdce)
        PolymarketStandardAdapter(conditionalTokens, collateral, usdce)
    {}
}
