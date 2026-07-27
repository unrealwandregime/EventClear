// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EventClearVault, IRedemptionAdapter} from "../../src/EventClearVault.sol";
import {EventClearClaims} from "../../src/EventClearClaims.sol";
import {EventClearFundingPool, IPrincipalVault} from "../../src/EventClearFundingPool.sol";
import {EventClearTreasury} from "../../src/EventClearTreasury.sol";
import {RelationshipRegistry} from "../../src/RelationshipRegistry.sol";
import {RiskPolicy} from "../../src/RiskPolicy.sol";
import {PolymarketStandardCTFAdapter} from "../../src/PolymarketStandardCTFAdapter.sol";
import {
    IPolymarketCollateralToken,
    IPolymarketConditionalTokens,
    IPolymarketOfficialCTFAdapter
} from "../../src/PolymarketStandardAdapter.sol";

contract EventClearPolygonLifecycleForkTest is Test {
    using stdJson for string;

    uint256 private constant UNIT = 1e6;
    uint256 private constant SIGNER_KEY = 0xA11CE;
    bytes32 private constant RELATIONSHIP_HASH = keccak256("polygon-standard-resolved-v1");

    address private borrower;
    IERC20 private pusd;
    IPolymarketConditionalTokens private ctf;
    PolymarketStandardCTFAdapter private adapter;
    RelationshipRegistry private registry;
    EventClearClaims private claims;
    EventClearFundingPool private pool;
    EventClearTreasury private treasury;
    RiskPolicy private riskPolicy;
    EventClearVault private vault;

    function addressAt(string memory manifest, string memory name) internal pure returns (address) {
        return manifest.readAddress(string.concat(".contracts.", name, ".address"));
    }

    function setUp() public {
        if (block.chainid != 137) return;
        borrower = vm.addr(SIGNER_KEY);

        string memory manifest = vm.readFile("../../config/contracts/polygon-mainnet.json");
        address ctfAddress = addressAt(manifest, "conditionalTokens");
        address pusdAddress = addressAt(manifest, "pUSD");
        address usdceAddress = addressAt(manifest, "usdce");
        address officialAdapterAddress = addressAt(manifest, "ctfCollateralAdapter");

        pusd = IERC20(pusdAddress);
        ctf = IPolymarketConditionalTokens(ctfAddress);
        adapter = new PolymarketStandardCTFAdapter(
            ctf,
            IPolymarketCollateralToken(pusdAddress),
            IERC20(usdceAddress),
            IPolymarketOfficialCTFAdapter(officialAdapterAddress)
        );
        registry = new RelationshipRegistry(address(this));
        claims = new EventClearClaims(address(this));
        treasury = new EventClearTreasury(address(this));
        pool = new EventClearFundingPool(pusd, address(this), address(treasury), 10_000 * UNIT, 1_000 * UNIT);
        riskPolicy = new RiskPolicy(address(this), vm.addr(SIGNER_KEY));
        riskPolicy.setAdapterAllowed(address(adapter), true);
        riskPolicy.setCollateralAllowed(address(pusd), true);
        vault = new EventClearVault(
            pusd, ctf, registry, claims, pool, IRedemptionAdapter(address(adapter)), riskPolicy, address(this)
        );

        claims.grantRole(claims.VAULT_ROLE(), address(vault));
        pool.grantRole(pool.VAULT_ROLE(), address(vault));
        treasury.grantRole(treasury.RECORDER_ROLE(), address(pool));
        riskPolicy.grantRole(riskPolicy.VAULT_ROLE(), address(vault));
        registry.register(
            RELATIONSHIP_HASH,
            1,
            uint64(block.timestamp),
            0,
            block.timestamp + 1 days,
            block.timestamp + 30 days,
            keccak256("fork-lifecycle-rules")
        );

        deal(address(pusd), address(this), 10 * UNIT);
        pusd.approve(address(pool), type(uint256).max);
        pool.deposit(10 * UNIT, address(this));
        vm.prank(borrower);
        ctf.setApprovalForAll(address(vault), true);
    }

    function testResolvedPolygonPositionCompletesVaultAndPoolLifecycle() public {
        if (block.chainid != 137) return;

        string memory fixtures = vm.readFile("../../config/contracts/polygon-fork-fixtures.json");
        bytes32 conditionId = fixtures.readBytes32(".standardResolvedMarket.conditionId");
        uint256 noTokenId = vm.parseUint(fixtures.readString(".standardResolvedMarket.noTokenId"));
        dealERC1155(address(ctf), borrower, noTokenId, UNIT);

        bytes32[] memory conditions = new bytes32[](1);
        uint256[] memory ids = new uint256[](1);
        uint8[] memory outcomes = new uint8[](1);
        uint256[] memory amounts = new uint256[](1);
        conditions[0] = conditionId;
        ids[0] = noTokenId;
        outcomes[0] = 0;
        amounts[0] = UNIT;

        bytes32 bundleHash = vault.hashBundle(conditions, ids, outcomes, amounts, 1, borrower, borrower);
        EventClearVault.FinancingQuote memory q = EventClearVault.FinancingQuote({
            borrower: borrower,
            positionWallet: borrower,
            bundleHash: bundleHash,
            walletAuthorizationHash: bytes32(0),
            relationshipDefinitionHash: RELATIONSHIP_HASH,
            solverArtifactHash: keccak256("fork-proof"),
            earliestResolutionTimestamp: block.timestamp + 1 days,
            latestResolutionTimestamp: block.timestamp + 30 days,
            guaranteedFloor: UNIT,
            principalAmount: UNIT,
            grossAdvance: 950_000,
            originationFee: 4_750,
            netAdvance: 945_250,
            expiry: block.timestamp + 5 minutes,
            nonce: 1,
            chainId: block.chainid,
            vault: address(vault),
            fundingPool: address(pool),
            collateralToken: address(pusd)
        });
        q.walletAuthorizationHash = vault.hashPositionWalletAuthorization(vault.positionWalletAuthorizationForQuote(q));

        bytes memory quoteSignature = signature(q);
        bytes memory authorizationSignature = walletAuthorizationSignature(q);
        vm.prank(borrower);
        uint256 bundleId =
            vault.openBundle(q, quoteSignature, authorizationSignature, conditions, ids, outcomes, amounts, 1);
        assertEq(pusd.balanceOf(borrower), 945_250);
        assertEq(ctf.balanceOf(address(vault), noTokenId), UNIT);
        assertEq(pool.outstandingAdvanceCostBasis(), 950_000);

        vault.settle(bundleId);
        EventClearVault.Bundle memory bundle = vault.getBundle(bundleId);
        assertEq(uint256(bundle.status), uint256(EventClearVault.BundleStatus.SETTLED));
        assertEq(bundle.settlementProceeds, UNIT);
        assertEq(bundle.principalAllocation, UNIT);
        assertEq(bundle.residualAllocation, 0);
        assertEq(ctf.balanceOf(address(vault), noTokenId), 0);
        assertEq(riskPolicy.globalExposure(), 0);

        pool.redeemPrincipal(IPrincipalVault(address(vault)), bundleId, UNIT);
        assertEq(pool.outstandingAdvanceCostBasis(), 0);
        assertEq(pool.realizedYield(), 40_725);
        assertEq(treasury.feesBySource(keccak256("ORIGINATION")), 4_750);
        assertEq(treasury.feesBySource(keccak256("REALIZED_FINANCING_RETURN")), 4_525);

        vm.prank(borrower);
        vault.redeemResidual(bundleId, 1e18);
        assertEq(claims.balanceOf(borrower, claims.claimId(bundleId, claims.RESIDUAL())), 0);
    }

    function signature(EventClearVault.FinancingQuote memory q) internal view returns (bytes memory) {
        bytes32 typehash = keccak256(
            "FinancingQuote(address borrower,address positionWallet,bytes32 bundleHash,bytes32 walletAuthorizationHash,bytes32 relationshipDefinitionHash,bytes32 solverArtifactHash,uint256 earliestResolutionTimestamp,uint256 latestResolutionTimestamp,uint256 guaranteedFloor,uint256 principalAmount,uint256 grossAdvance,uint256 originationFee,uint256 netAdvance,uint256 expiry,uint256 nonce,uint256 chainId,address vault,address fundingPool,address collateralToken)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash,
                q.borrower,
                q.positionWallet,
                q.bundleHash,
                q.walletAuthorizationHash,
                q.relationshipDefinitionHash,
                q.solverArtifactHash,
                q.earliestResolutionTimestamp,
                q.latestResolutionTimestamp,
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

    function walletAuthorizationSignature(EventClearVault.FinancingQuote memory q)
        internal
        view
        returns (bytes memory)
    {
        EventClearVault.PositionWalletAuthorization memory authorization = vault.positionWalletAuthorizationForQuote(q);
        bytes32 digest = vault.positionWalletAuthorizationDigest(authorization);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encode(authorization, abi.encodePacked(r, s, v));
    }
}
