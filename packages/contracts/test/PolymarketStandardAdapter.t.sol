// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {
    PolymarketStandardAdapter,
    IPolymarketConditionalTokens,
    IPolymarketCollateralToken,
    IPolymarketOfficialCTFAdapter
} from "../src/PolymarketStandardAdapter.sol";
import {MockConditionalTokens} from "../src/mocks/MockConditionalTokens.sol";
import {MockPUSD} from "../src/mocks/MockPUSD.sol";
import {MockOfficialCTFAdapter} from "../src/mocks/MockOfficialCTFAdapter.sol";

contract PolymarketStandardAdapterTest is Test {
    uint256 constant UNIT = 1e6;
    address holder = makeAddr("holder");
    address unrelatedHolder = makeAddr("unrelated-holder");
    MockConditionalTokens ctf;
    MockPUSD pUSD;
    MockPUSD usdce;
    MockOfficialCTFAdapter officialAdapter;
    PolymarketStandardAdapter adapter;
    bytes32 firstCondition = keccak256("standard-one");
    bytes32 secondCondition = keccak256("standard-two");
    uint256 firstYes;
    uint256 secondNo;

    function setUp() public {
        ctf = new MockConditionalTokens();
        pUSD = new MockPUSD();
        usdce = new MockPUSD();
        officialAdapter = new MockOfficialCTFAdapter(
            IPolymarketConditionalTokens(address(ctf)), IPolymarketCollateralToken(address(pUSD)), usdce
        );
        adapter = new PolymarketStandardAdapter(
            IPolymarketConditionalTokens(address(ctf)),
            IPolymarketCollateralToken(address(pUSD)),
            usdce,
            IPolymarketOfficialCTFAdapter(address(officialAdapter))
        );
        (firstYes,) = ctf.createStandardPositions(firstCondition, usdce);
        (, secondNo) = ctf.createStandardPositions(secondCondition, usdce);
        ctf.mint(holder, firstYes, 100 * UNIT);
        ctf.mint(holder, secondNo, 100 * UNIT);
        ctf.mint(unrelatedHolder, firstYes, 77 * UNIT);
        vm.prank(holder);
        ctf.setApprovalForAll(address(adapter), true);
    }

    function testRedeemsOnlyExactEscrowedStandardPositionsIntoPUSD() public {
        ctf.resolve(firstCondition, UNIT, 0);
        ctf.resolve(secondCondition, 0, UNIT);
        bytes32[] memory conditions = new bytes32[](2);
        uint256[] memory tokenIds = new uint256[](2);
        uint256[] memory amounts = new uint256[](2);
        conditions[0] = firstCondition;
        conditions[1] = secondCondition;
        tokenIds[0] = firstYes;
        tokenIds[1] = secondNo;
        amounts[0] = 100 * UNIT;
        amounts[1] = 100 * UNIT;

        assertTrue(adapter.areResolved(conditions));
        vm.prank(holder);
        adapter.redeem(conditions, tokenIds, amounts);

        assertEq(pUSD.balanceOf(holder), 200 * UNIT);
        assertEq(usdce.balanceOf(address(pUSD)), 200 * UNIT);
        assertEq(ctf.balanceOf(unrelatedHolder, firstYes), 77 * UNIT);
        assertEq(ctf.balanceOf(address(adapter), firstYes), 0);
        assertEq(ctf.balanceOf(address(adapter), secondNo), 0);
    }

    function testRejectsUnresolvedDuplicateAndUnrelatedTokens() public {
        bytes32[] memory conditions = new bytes32[](1);
        conditions[0] = firstCondition;
        assertFalse(adapter.areResolved(conditions));

        ctf.resolve(firstCondition, UNIT, 0);
        uint256[] memory tokenIds = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        tokenIds[0] = 123;
        amounts[0] = UNIT;
        vm.expectRevert(PolymarketStandardAdapter.InvalidToken.selector);
        vm.prank(holder);
        adapter.redeem(conditions, tokenIds, amounts);

        bytes32[] memory duplicates = new bytes32[](2);
        uint256[] memory duplicateIds = new uint256[](2);
        uint256[] memory duplicateAmounts = new uint256[](2);
        duplicates[0] = firstCondition;
        duplicates[1] = firstCondition;
        duplicateIds[0] = firstYes;
        duplicateIds[1] = firstYes;
        duplicateAmounts[0] = UNIT;
        duplicateAmounts[1] = UNIT;
        vm.expectRevert(PolymarketStandardAdapter.DuplicateCondition.selector);
        vm.prank(holder);
        adapter.redeem(duplicates, duplicateIds, duplicateAmounts);
    }
}
