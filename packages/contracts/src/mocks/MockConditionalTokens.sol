// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract MockConditionalTokens is ERC1155 {
    mapping(bytes32 => uint256) public payoutYes;
    mapping(bytes32 => uint256) public payoutNo;
    mapping(uint256 => bytes32) public conditionOf;
    mapping(uint256 => bool) public isYes;

    constructor() ERC1155("") {}

    function createPosition(bytes32 conditionId, uint256 yesTokenId, uint256 noTokenId) external {
        conditionOf[yesTokenId] = conditionId;
        conditionOf[noTokenId] = conditionId;
        isYes[yesTokenId] = true;
    }

    function mint(address to, uint256 tokenId, uint256 amount) external { _mint(to, tokenId, amount, ""); }

    function resolve(bytes32 conditionId, uint256 yesNumerator, uint256 noNumerator) external {
        require(yesNumerator + noNumerator == 1_000_000, "bad payout");
        payoutYes[conditionId] = yesNumerator;
        payoutNo[conditionId] = noNumerator;
    }

    function burnForRedemption(address from, uint256 tokenId, uint256 amount) external returns (uint256 payout) {
        bytes32 conditionId = conditionOf[tokenId];
        uint256 numerator = isYes[tokenId] ? payoutYes[conditionId] : payoutNo[conditionId];
        require(numerator != 0 || payoutYes[conditionId] + payoutNo[conditionId] == 1_000_000, "unresolved");
        _burn(from, tokenId, amount);
        return amount * numerator / 1_000_000;
    }
}
