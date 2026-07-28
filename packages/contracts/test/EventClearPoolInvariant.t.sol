// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {EventClearFundingPool} from "../src/EventClearFundingPool.sol";
import {EventClearTreasury} from "../src/EventClearTreasury.sol";
import {MockPUSD} from "../src/mocks/MockPUSD.sol";

contract PoolHandler is Test {
    MockPUSD public immutable asset;
    EventClearFundingPool public immutable pool;
    uint256 public nextBundleId = 1;

    constructor(MockPUSD asset_, EventClearFundingPool pool_) {
        asset = asset_;
        pool = pool_;
        asset_.approve(address(pool_), type(uint256).max);
    }

    function fund(uint96 rawGross, uint16 rawFeeBps) external {
        uint256 gross = bound(uint256(rawGross), 1e6, 25e6);
        uint256 fee = gross * bound(uint256(rawFeeBps), 0, 100) / 10_000;
        try pool.fundAdvance(nextBundleId, address(this), gross, fee) {
            ++nextBundleId;
        } catch {}
    }

    function settle(uint256 bundleSeed, uint96 rawProceeds) external {
        if (nextBundleId <= 1) return;
        uint256 bundleId = bound(bundleSeed, 1, nextBundleId - 1);
        uint256 cost = pool.advanceCostBasis(bundleId);
        if (cost == 0) return;
        uint256 proceeds = bound(uint256(rawProceeds), 0, cost * 2);
        asset.mint(address(this), proceeds);
        pool.recordSettlement(bundleId, proceeds);
    }
}

contract EventClearPoolInvariantTest is StdInvariant, Test {
    MockPUSD internal asset;
    EventClearTreasury internal treasury;
    EventClearFundingPool internal pool;
    PoolHandler internal handler;

    function setUp() public {
        asset = new MockPUSD();
        treasury = new EventClearTreasury(address(this));
        pool = new EventClearFundingPool(asset, address(this), address(treasury), 10_000e6, 25e6);
        handler = new PoolHandler(asset, pool);
        pool.grantRole(pool.VAULT_ROLE(), address(handler));
        treasury.grantRole(treasury.RECORDER_ROLE(), address(pool));
        asset.mint(address(this), 1_000e6);
        asset.approve(address(pool), type(uint256).max);
        pool.deposit(1_000e6, address(this));
        targetContract(address(handler));
    }

    function invariantBookAssetsExcludeUnearnedQuotedFees() public view {
        assertEq(
            pool.totalAssets(),
            asset.balanceOf(address(pool)) + pool.outstandingAdvanceCostBasis() - pool.outstandingQuotedFees()
        );
        assertLe(pool.outstandingQuotedFees(), pool.outstandingAdvanceCostBasis());
    }

    function invariantUtilizationNeverExceedsConfiguredCap() public view {
        assertLe(pool.utilizationBps(), pool.utilizationCapBps());
    }

    function invariantRealizedReturnComponentsReconcile() public view {
        assertEq(pool.realizedGrossFinancingReturn(), pool.realizedLpYield() + pool.realizedProtocolYieldFees());
        assertTrue(pool.realizedReturnIdentityHolds());
        assertTrue(pool.bookAssetsIdentityHolds());
    }
}

contract EventClearFundingPoolFeeTest is Test {
    MockPUSD internal asset;
    EventClearTreasury internal treasury;
    EventClearFundingPool internal pool;
    address internal borrower;

    function setUp() public {
        asset = new MockPUSD();
        treasury = new EventClearTreasury(address(this));
        pool = new EventClearFundingPool(asset, address(this), address(treasury), 10_000e6, 100e6);
        borrower = makeAddr("borrower");
        pool.grantRole(pool.VAULT_ROLE(), address(this));
        treasury.grantRole(treasury.RECORDER_ROLE(), address(pool));
        asset.mint(address(this), 1_000e6);
        asset.approve(address(pool), type(uint256).max);
        pool.deposit(1_000e6, address(this));
    }

    function _fundAndSettle(uint256 bundleId, uint256 gross, uint256 quotedFee, uint256 proceeds) internal {
        pool.fundAdvance(bundleId, borrower, gross, quotedFee);
        asset.mint(address(this), proceeds);
        pool.recordSettlement(bundleId, proceeds);
    }

    function testSuccessfulReturnRealizesQuotedFeeThenYieldFee() public {
        pool.fundAdvance(1, borrower, 95e6, 475_000);
        assertEq(asset.balanceOf(borrower), 94_525_000);
        assertEq(asset.balanceOf(address(treasury)), 0);
        assertEq(pool.outstandingQuotedFees(), 475_000);

        asset.mint(address(this), 100e6);
        pool.recordSettlement(1, 100e6);

        assertEq(treasury.feesBySource(keccak256("ORIGINATION")), 475_000);
        assertEq(treasury.feesBySource(keccak256("REALIZED_FINANCING_RETURN")), 452_500);
        assertEq(asset.balanceOf(address(treasury)), 927_500);
        assertEq(treasury.totalFeesRecorded(), 927_500);
        assertEq(pool.realizedOriginationFees(), 475_000);
        assertEq(pool.realizedGrossFinancingReturn(), 5_000_000);
        assertEq(pool.realizedLpYield(), 4_547_500);
        assertEq(pool.realizedProtocolYieldFees(), 452_500);
        assertEq(pool.refundedQuotedFees(), 0);
        assertEq(pool.realizedLoss(), 0);
        assertEq(pool.outstandingQuotedFees(), 0);
    }

    function testReturnSmallerThanQuotedFeeCapsFeeAndRefundsRemainder() public {
        _fundAndSettle(2, 95e6, 475_000, 95_100_000);
        assertEq(treasury.feesBySource(keccak256("ORIGINATION")), 100_000);
        assertEq(treasury.feesBySource(keccak256("REALIZED_FINANCING_RETURN")), 0);
        assertEq(asset.balanceOf(borrower), 94_900_000);
        assertEq(pool.realizedGrossFinancingReturn(), 100_000);
        assertEq(pool.realizedLpYield(), 100_000);
        assertEq(pool.refundedQuotedFees(), 375_000);
        assertEq(pool.realizedLoss(), 0);
    }

    function testReturnExactlyQuotedFeeRealizesFeeWithoutProtocolCut() public {
        _fundAndSettle(20, 95e6, 475_000, 95_475_000);
        assertEq(pool.realizedOriginationFees(), 475_000);
        assertEq(pool.realizedProtocolYieldFees(), 0);
        assertEq(pool.realizedLpYield(), 475_000);
        assertEq(pool.refundedQuotedFees(), 0);
        assertTrue(pool.bookAssetsIdentityHolds());
    }

    function testBreakEvenPaysNoFeesAndRefundsQuotedFee() public {
        _fundAndSettle(3, 95e6, 475_000, 95e6);
        assertEq(asset.balanceOf(address(treasury)), 0);
        assertEq(asset.balanceOf(borrower), 95e6);
        assertEq(pool.realizedLpYield(), 0);
        assertEq(pool.refundedQuotedFees(), 475_000);
        assertEq(pool.realizedLoss(), 0);
    }

    function testShortfallPaysNoFeesAndRecordsGrossCostLoss() public {
        _fundAndSettle(4, 95e6, 475_000, 75e6);
        assertEq(asset.balanceOf(address(treasury)), 0);
        assertEq(asset.balanceOf(borrower), 95e6);
        assertEq(pool.realizedLpYield(), 0);
        assertEq(pool.realizedLoss(), 20e6);
    }

    function testTotalShortfallRefundsFeeAndCannotChargeTreasury() public {
        _fundAndSettle(21, 95e6, 475_000, 0);
        assertEq(pool.realizedLoss(), 95e6);
        assertEq(pool.realizedOriginationFees(), 0);
        assertEq(pool.realizedProtocolYieldFees(), 0);
        assertEq(pool.refundedQuotedFees(), 475_000);
        assertEq(treasury.totalFeesRecorded(), 0);
        assertTrue(pool.bookAssetsIdentityHolds());
    }

    function testMultipleBundlesReconcileWhenSettledOutOfOrder() public {
        pool.fundAdvance(30, borrower, 40e6, 200_000);
        pool.fundAdvance(31, borrower, 50e6, 250_000);
        assertEq(pool.outstandingAdvanceCostBasis(), 90e6);
        asset.mint(address(this), 55e6);
        pool.recordSettlement(31, 55e6);
        assertEq(pool.outstandingAdvanceCostBasis(), 40e6);
        asset.mint(address(this), 35e6);
        pool.recordSettlement(30, 35e6);
        assertEq(pool.outstandingAdvanceCostBasis(), 0);
        assertEq(pool.realizedLoss(), 5e6);
        assertTrue(pool.realizedReturnIdentityHolds());
        assertTrue(pool.bookAssetsIdentityHolds());
    }

    function testDepositAndWithdrawalDuringOutstandingAdvanceReconcile() public {
        pool.fundAdvance(40, borrower, 50e6, 250_000);
        asset.mint(address(this), 100e6);
        pool.deposit(100e6, address(this));
        uint256 withdrawal = pool.maxWithdraw(address(this)) / 4;
        pool.withdraw(withdrawal, address(this), address(this));
        assertEq(pool.cumulativeNetDeposits(), 1_100e6);
        assertEq(pool.cumulativeWithdrawals(), withdrawal);
        assertTrue(pool.bookAssetsIdentityHolds());
    }

    function testFeeRoundingUsesOnlyAdditionalReturn() public {
        _fundAndSettle(5, 1e6, 100, 1_000_111);
        assertEq(treasury.feesBySource(keccak256("ORIGINATION")), 100);
        assertEq(treasury.feesBySource(keccak256("REALIZED_FINANCING_RETURN")), 1);
        assertEq(pool.realizedGrossFinancingReturn(), 111);
        assertEq(pool.realizedLpYield(), 110);
    }
}
