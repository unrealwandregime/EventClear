// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockPUSD} from "./MockPUSD.sol";

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

    function createStandardPositions(bytes32 conditionId, IERC20 collateral)
        external
        returns (uint256 yesTokenId, uint256 noTokenId)
    {
        yesTokenId = getPositionId(collateral, getCollectionId(bytes32(0), conditionId, 1));
        noTokenId = getPositionId(collateral, getCollectionId(bytes32(0), conditionId, 2));
        conditionOf[yesTokenId] = conditionId;
        conditionOf[noTokenId] = conditionId;
        isYes[yesTokenId] = true;
    }

    function mint(address to, uint256 tokenId, uint256 amount) external {
        _mint(to, tokenId, amount, "");
    }

    function resolve(bytes32 conditionId, uint256 yesNumerator, uint256 noNumerator) external {
        require(yesNumerator + noNumerator == 1_000_000, "bad payout");
        payoutYes[conditionId] = yesNumerator;
        payoutNo[conditionId] = noNumerator;
    }

    function payoutDenominator(bytes32 conditionId) external view returns (uint256) {
        return payoutYes[conditionId] + payoutNo[conditionId];
    }

    function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(parentCollectionId, conditionId, indexSet));
    }

    function getPositionId(IERC20 collateralToken, bytes32 collectionId) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(collateralToken, collectionId)));
    }

    function redeemPositions(IERC20 collateralToken, bytes32, bytes32 conditionId, uint256[] calldata indexSets)
        external
    {
        uint256 payout;
        for (uint256 i; i < indexSets.length; ++i) {
            uint256 tokenId = getPositionId(collateralToken, getCollectionId(bytes32(0), conditionId, indexSets[i]));
            uint256 amount = balanceOf(msg.sender, tokenId);
            if (amount != 0) payout += burnForRedemption(msg.sender, tokenId, amount);
        }
        MockPUSD(address(collateralToken)).mint(msg.sender, payout);
    }

    function burnForRedemption(address from, uint256 tokenId, uint256 amount) public returns (uint256 payout) {
        bytes32 conditionId = conditionOf[tokenId];
        uint256 numerator = isYes[tokenId] ? payoutYes[conditionId] : payoutNo[conditionId];
        require(numerator != 0 || payoutYes[conditionId] + payoutNo[conditionId] == 1_000_000, "unresolved");
        _burn(from, tokenId, amount);
        return amount * numerator / 1_000_000;
    }
}
