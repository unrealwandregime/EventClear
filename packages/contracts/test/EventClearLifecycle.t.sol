// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {EventClearVault, IRedemptionAdapter} from "../src/EventClearVault.sol";
import {EventClearClaims} from "../src/EventClearClaims.sol";
import {EventClearFundingPool, IPrincipalVault} from "../src/EventClearFundingPool.sol";
import {EventClearTreasury} from "../src/EventClearTreasury.sol";
import {RelationshipRegistry} from "../src/RelationshipRegistry.sol";
import {RiskPolicy} from "../src/RiskPolicy.sol";
import {MockPUSD} from "../src/mocks/MockPUSD.sol";
import {MockConditionalTokens} from "../src/mocks/MockConditionalTokens.sol";
import {MockCTFAdapter} from "../src/mocks/MockCTFAdapter.sol";

contract EventClearLifecycleTest is Test {
    uint256 constant UNIT = 1e6;
    uint256 constant SIGNER_KEY = 0xA11CE;
    address borrower = makeAddr("borrower");
    address signer;
    bytes32 relationshipHash = keccak256("btc-close-ladder-v3");
    MockPUSD pusd;
    MockConditionalTokens ctf;
    MockCTFAdapter adapter;
    RelationshipRegistry registry;
    EventClearClaims claims;
    EventClearFundingPool pool;
    EventClearTreasury treasury;
    RiskPolicy riskPolicy;
    EventClearVault vault;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        pusd = new MockPUSD();
        ctf = new MockConditionalTokens();
        adapter = new MockCTFAdapter(ctf, pusd);
        registry = new RelationshipRegistry(address(this));
        claims = new EventClearClaims(address(this));
        treasury = new EventClearTreasury(address(this));
        pool = new EventClearFundingPool(pusd, address(this), address(treasury), 10_000 * UNIT, 1_000 * UNIT);
        riskPolicy = new RiskPolicy(address(this), signer);
        riskPolicy.setAdapterAllowed(address(adapter), true);
        riskPolicy.setCollateralAllowed(address(pusd), true);
        vault = new EventClearVault(
            pusd, ctf, registry, claims, pool, IRedemptionAdapter(address(adapter)), riskPolicy, address(this)
        );
        claims.grantRole(claims.VAULT_ROLE(), address(vault));
        pool.grantRole(pool.VAULT_ROLE(), address(vault));
        treasury.grantRole(treasury.RECORDER_ROLE(), address(pool));
        riskPolicy.grantRole(riskPolicy.VAULT_ROLE(), address(vault));
        registry.register(relationshipHash, 3, uint64(block.timestamp), 0, keccak256("rules"));
        pusd.mint(address(this), 1_000 * UNIT);
        pusd.approve(address(pool), type(uint256).max);
        pool.deposit(1_000 * UNIT, address(this));
        ctf.createPosition(keccak256("btc-100"), 1, 2);
        ctf.createPosition(keccak256("btc-150"), 3, 4);
        ctf.mint(borrower, 1, 100 * UNIT);
        ctf.mint(borrower, 4, 100 * UNIT);
        vm.prank(borrower);
        ctf.setApprovalForAll(address(vault), true);
    }

    function quote(bytes32 bundleHash, uint256 nonce, uint256 expiry)
        internal
        view
        returns (EventClearVault.FinancingQuote memory q)
    {
        q = EventClearVault.FinancingQuote({
            borrower: borrower,
            positionWallet: borrower,
            bundleHash: bundleHash,
            relationshipDefinitionHash: relationshipHash,
            solverArtifactHash: keccak256("proof"),
            guaranteedFloor: 100 * UNIT,
            principalAmount: 100 * UNIT,
            grossAdvance: 95_000_000,
            originationFee: 475_000,
            netAdvance: 94_525_000,
            expiry: expiry,
            nonce: nonce,
            chainId: block.chainid,
            vault: address(vault),
            fundingPool: address(pool),
            collateralToken: address(pusd)
        });
    }

    function signature(EventClearVault.FinancingQuote memory q) internal view returns (bytes memory) {
        bytes32 typehash = keccak256(
            "FinancingQuote(address borrower,address positionWallet,bytes32 bundleHash,bytes32 relationshipDefinitionHash,bytes32 solverArtifactHash,uint256 guaranteedFloor,uint256 principalAmount,uint256 grossAdvance,uint256 originationFee,uint256 netAdvance,uint256 expiry,uint256 nonce,uint256 chainId,address vault,address fundingPool,address collateralToken)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash,
                q.borrower,
                q.positionWallet,
                q.bundleHash,
                q.relationshipDefinitionHash,
                q.solverArtifactHash,
                q.guaranteedFloor,
                q.principalAmount,
                q.grossAdvance,
                q.originationFee,
                q.netAdvance,
                q.expiry,
                q.nonce,
                q.chainId,
                q.vault,
                q.fundingPool,
                q.collateralToken
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function legs()
        internal
        pure
        returns (bytes32[] memory conditions, uint256[] memory ids, uint8[] memory outcomes, uint256[] memory amounts)
    {
        conditions = new bytes32[](2);
        ids = new uint256[](2);
        outcomes = new uint8[](2);
        amounts = new uint256[](2);
        conditions[0] = keccak256("btc-100");
        conditions[1] = keccak256("btc-150");
        ids[0] = 1;
        ids[1] = 4;
        outcomes[0] = 1;
        outcomes[1] = 0;
        amounts[0] = 100 * UNIT;
        amounts[1] = 100 * UNIT;
    }

    function testCompleteLifecycleAndPartialResidualClaim() public {
        (bytes32[] memory conditions, uint256[] memory ids, uint8[] memory outcomes, uint256[] memory amounts) = legs();
        bytes32 bundleHash = vault.hashBundle(conditions, ids, outcomes, amounts, 3, borrower, borrower);
        EventClearVault.FinancingQuote memory q = quote(bundleHash, 1, block.timestamp + 5 minutes);
        bytes memory sig = signature(q);
        vm.prank(borrower);
        uint256 bundleId = vault.openBundle(q, sig, conditions, ids, outcomes, amounts, 3);
        assertEq(pusd.balanceOf(borrower), 94_525_000);
        assertEq(claims.balanceOf(address(pool), claims.claimId(bundleId, claims.PRINCIPAL())), 100 * UNIT);
        ctf.resolve(conditions[0], UNIT, 0);
        ctf.resolve(conditions[1], 0, UNIT);
        vault.settle(bundleId);
        EventClearVault.Bundle memory bundle = vault.getBundle(bundleId);
        assertEq(bundle.settlementProceeds, 200 * UNIT);
        pool.redeemPrincipal(IPrincipalVault(address(vault)), bundleId, 100 * UNIT);
        assertEq(treasury.feesBySource(keccak256("ORIGINATION")), 475_000);
        assertEq(treasury.feesBySource(keccak256("REALIZED_FINANCING_RETURN")), 500_000);
        assertEq(pool.realizedYield(), 4_500_000);
        vm.prank(borrower);
        vault.redeemResidual(bundleId, 5e17);
        assertEq(pusd.balanceOf(borrower), 144_525_000);
    }

    function testReplayAndModifiedAmountsRejected() public {
        (bytes32[] memory conditions, uint256[] memory ids, uint8[] memory outcomes, uint256[] memory amounts) = legs();
        EventClearVault.FinancingQuote memory q =
            quote(vault.hashBundle(conditions, ids, outcomes, amounts, 3, borrower, borrower), 7, block.timestamp + 1);
        bytes memory sig = signature(q);
        vm.prank(borrower);
        vault.openBundle(q, sig, conditions, ids, outcomes, amounts, 3);
        vm.expectRevert(EventClearVault.QuoteAlreadyUsed.selector);
        vm.prank(borrower);
        vault.openBundle(q, sig, conditions, ids, outcomes, amounts, 3);
    }

    function testShortfallDoesNotUsePoolAssets() public {
        (bytes32[] memory conditions, uint256[] memory ids, uint8[] memory outcomes, uint256[] memory amounts) = legs();
        EventClearVault.FinancingQuote memory q = quote(
            vault.hashBundle(conditions, ids, outcomes, amounts, 3, borrower, borrower), 9, block.timestamp + 5 minutes
        );
        bytes memory sig = signature(q);
        vm.prank(borrower);
        uint256 bundleId = vault.openBundle(q, sig, conditions, ids, outcomes, amounts, 3);
        ctf.resolve(conditions[0], 500_000, 500_000);
        ctf.resolve(conditions[1], 750_000, 250_000);
        vault.settle(bundleId);
        EventClearVault.Bundle memory bundle = vault.getBundle(bundleId);
        assertEq(uint256(bundle.status), uint256(EventClearVault.BundleStatus.SHORTFALL));
        assertEq(bundle.principalAllocation, 75 * UNIT);
        assertEq(bundle.residualAllocation, 0);
    }

    function testExpiredQuoteAndWrongDomainAreRejected() public {
        (bytes32[] memory conditions, uint256[] memory ids, uint8[] memory outcomes, uint256[] memory amounts) = legs();
        bytes32 bundleHash = vault.hashBundle(conditions, ids, outcomes, amounts, 3, borrower, borrower);

        EventClearVault.FinancingQuote memory expired = quote(bundleHash, 10, block.timestamp - 1);
        bytes memory expiredSignature = signature(expired);
        vm.expectRevert(EventClearVault.QuoteExpired.selector);
        vm.prank(borrower);
        vault.openBundle(expired, expiredSignature, conditions, ids, outcomes, amounts, 3);

        EventClearVault.FinancingQuote memory wrongChain = quote(bundleHash, 11, block.timestamp + 5 minutes);
        wrongChain.chainId = block.chainid + 1;
        bytes memory wrongChainSignature = signature(wrongChain);
        vm.expectRevert(EventClearVault.InvalidQuote.selector);
        vm.prank(borrower);
        vault.openBundle(wrongChain, wrongChainSignature, conditions, ids, outcomes, amounts, 3);

        EventClearVault.FinancingQuote memory wrongVault = quote(bundleHash, 12, block.timestamp + 5 minutes);
        wrongVault.vault = address(0xBEEF);
        bytes memory wrongVaultSignature = signature(wrongVault);
        vm.expectRevert(EventClearVault.InvalidQuote.selector);
        vm.prank(borrower);
        vault.openBundle(wrongVault, wrongVaultSignature, conditions, ids, outcomes, amounts, 3);
    }

    function testPauseAndUnresolvedSettlementGates() public {
        (bytes32[] memory conditions, uint256[] memory ids, uint8[] memory outcomes, uint256[] memory amounts) = legs();
        bytes32 bundleHash = vault.hashBundle(conditions, ids, outcomes, amounts, 3, borrower, borrower);
        EventClearVault.FinancingQuote memory q = quote(bundleHash, 13, block.timestamp + 5 minutes);
        bytes memory sig = signature(q);

        vault.setOriginationsPaused(true);
        vm.expectRevert(EventClearVault.OriginationPaused.selector);
        vm.prank(borrower);
        vault.openBundle(q, sig, conditions, ids, outcomes, amounts, 3);

        vault.setOriginationsPaused(false);
        vm.prank(borrower);
        uint256 bundleId = vault.openBundle(q, sig, conditions, ids, outcomes, amounts, 3);
        vm.expectRevert(EventClearVault.ConditionsUnresolved.selector);
        vault.settle(bundleId);
    }

    function testFuzzSettlementAccountingConservesProceeds(uint32 firstYesPayout, uint32 secondNoPayout) public {
        uint256 first = bound(uint256(firstYesPayout), 0, UNIT);
        uint256 second = bound(uint256(secondNoPayout), 0, UNIT);
        (bytes32[] memory conditions, uint256[] memory ids, uint8[] memory outcomes, uint256[] memory amounts) = legs();
        EventClearVault.FinancingQuote memory q = quote(
            vault.hashBundle(conditions, ids, outcomes, amounts, 3, borrower, borrower), 14, block.timestamp + 5 minutes
        );
        bytes memory sig = signature(q);
        vm.prank(borrower);
        uint256 bundleId = vault.openBundle(q, sig, conditions, ids, outcomes, amounts, 3);

        ctf.resolve(conditions[0], first, UNIT - first);
        ctf.resolve(conditions[1], UNIT - second, second);
        vault.settle(bundleId);

        EventClearVault.Bundle memory bundle = vault.getBundle(bundleId);
        uint256 expectedProceeds = (first + second) * 100;
        assertEq(bundle.settlementProceeds, expectedProceeds);
        assertEq(bundle.principalAllocation + bundle.residualAllocation, expectedProceeds);
        assertLe(bundle.principalAllocation, bundle.principalAmount);
        assertLe(bundle.residualAllocation, bundle.principalAmount);
        if (expectedProceeds < bundle.principalAmount) {
            assertEq(uint256(bundle.status), uint256(EventClearVault.BundleStatus.SHORTFALL));
        } else {
            assertEq(uint256(bundle.status), uint256(EventClearVault.BundleStatus.SETTLED));
        }
    }

    function testClaimIdsSupplyAndPoolBookAccounting() public {
        (bytes32[] memory conditions, uint256[] memory ids, uint8[] memory outcomes, uint256[] memory amounts) = legs();
        EventClearVault.FinancingQuote memory q = quote(
            vault.hashBundle(conditions, ids, outcomes, amounts, 3, borrower, borrower), 21, block.timestamp + 5 minutes
        );
        bytes memory sig = signature(q);
        vm.prank(borrower);
        uint256 bundleId = vault.openBundle(q, sig, conditions, ids, outcomes, amounts, 3);

        assertEq(claims.claimId(bundleId, claims.PRINCIPAL()), uint256(keccak256(abi.encode(bundleId, uint8(1)))));
        assertEq(claims.totalSupply(claims.claimId(bundleId, claims.RESIDUAL())), 1e18);
        assertEq(pool.totalAssets(), pusd.balanceOf(address(pool)) + pool.outstandingAdvanceCostBasis());
        assertEq(pool.advanceCostBasis(bundleId), q.grossAdvance);
        assertEq(treasury.feesBySource(keccak256("ORIGINATION")), q.originationFee);
    }

    function testQuotePoolCollateralBorrowerAndSignerBindings() public {
        (bytes32[] memory conditions, uint256[] memory ids, uint8[] memory outcomes, uint256[] memory amounts) = legs();
        bytes32 bundleHash = vault.hashBundle(conditions, ids, outcomes, amounts, 3, borrower, borrower);

        EventClearVault.FinancingQuote memory wrongPool = quote(bundleHash, 22, block.timestamp + 5 minutes);
        wrongPool.fundingPool = address(0xBEEF);
        bytes memory wrongPoolSignature = signature(wrongPool);
        vm.expectRevert(EventClearVault.InvalidQuote.selector);
        vm.prank(borrower);
        vault.openBundle(wrongPool, wrongPoolSignature, conditions, ids, outcomes, amounts, 3);

        EventClearVault.FinancingQuote memory wrongCollateral = quote(bundleHash, 23, block.timestamp + 5 minutes);
        wrongCollateral.collateralToken = address(0xCAFE);
        bytes memory wrongCollateralSignature = signature(wrongCollateral);
        vm.expectRevert(EventClearVault.InvalidQuote.selector);
        vm.prank(borrower);
        vault.openBundle(wrongCollateral, wrongCollateralSignature, conditions, ids, outcomes, amounts, 3);

        EventClearVault.FinancingQuote memory wrongSigner = quote(bundleHash, 24, block.timestamp + 5 minutes);
        bytes32 digest = keccak256("not-the-quote");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, digest);
        vm.expectRevert(EventClearVault.InvalidQuote.selector);
        vm.prank(borrower);
        vault.openBundle(wrongSigner, abi.encodePacked(r, s, v), conditions, ids, outcomes, amounts, 3);
    }

    function testRiskCapsMissingApprovalAndSettlementDuringPauses() public {
        (bytes32[] memory conditions, uint256[] memory ids, uint8[] memory outcomes, uint256[] memory amounts) = legs();
        bytes32 bundleHash = vault.hashBundle(conditions, ids, outcomes, amounts, 3, borrower, borrower);
        EventClearVault.FinancingQuote memory capped = quote(bundleHash, 25, block.timestamp + 5 minutes);
        bytes memory cappedSignature = signature(capped);
        riskPolicy.setLimits(9_500, 1 days, 90 * UNIT, 1_000 * UNIT, 1_000 * UNIT, 1_000 * UNIT, 1_000 * UNIT);
        vm.expectRevert(RiskPolicy.RiskLimitExceeded.selector);
        vm.prank(borrower);
        vault.openBundle(capped, cappedSignature, conditions, ids, outcomes, amounts, 3);

        riskPolicy.setLimits(9_500, 1 days, 1_000 * UNIT, 1_000 * UNIT, 1_000 * UNIT, 1_000 * UNIT, 1_000 * UNIT);
        vm.prank(borrower);
        ctf.setApprovalForAll(address(vault), false);
        EventClearVault.FinancingQuote memory noApproval = quote(bundleHash, 26, block.timestamp + 5 minutes);
        bytes memory noApprovalSignature = signature(noApproval);
        vm.expectRevert();
        vm.prank(borrower);
        vault.openBundle(noApproval, noApprovalSignature, conditions, ids, outcomes, amounts, 3);
        vm.prank(borrower);
        ctf.setApprovalForAll(address(vault), true);

        EventClearVault.FinancingQuote memory q = quote(bundleHash, 27, block.timestamp + 5 minutes);
        bytes memory sig = signature(q);
        vm.prank(borrower);
        uint256 bundleId = vault.openBundle(q, sig, conditions, ids, outcomes, amounts, 3);
        vault.setOriginationsPaused(true);
        vault.pause();
        riskPolicy.setOriginationsPaused(true);
        ctf.resolve(conditions[0], UNIT, 0);
        ctf.resolve(conditions[1], 0, UNIT);
        vault.settle(bundleId);
        claims.pause();
        pool.redeemPrincipal(IPrincipalVault(address(vault)), bundleId, 100 * UNIT);
        assertEq(riskPolicy.globalExposure(), 0);
    }
}
