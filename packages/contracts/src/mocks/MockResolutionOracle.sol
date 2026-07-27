// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockConditionalTokens} from "./MockConditionalTokens.sol";

contract MockResolutionOracle {
    MockConditionalTokens public immutable positions;
    constructor(MockConditionalTokens positions_) { positions = positions_; }
    function resolve(bytes32 conditionId, uint256 yesNumerator, uint256 noNumerator) external {
        positions.resolve(conditionId, yesNumerator, noNumerator);
    }
}
