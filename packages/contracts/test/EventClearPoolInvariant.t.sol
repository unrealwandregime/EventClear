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
        asset.mint(address(pool), proceeds);
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

    function invariantBookAssetsEqualLiquidPlusOutstandingCost() public view {
        assertEq(pool.totalAssets(), asset.balanceOf(address(pool)) + pool.outstandingAdvanceCostBasis());
    }

    function invariantUtilizationNeverExceedsConfiguredCap() public view {
        assertLe(pool.utilizationBps(), pool.utilizationCapBps());
    }
}
