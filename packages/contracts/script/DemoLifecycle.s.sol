// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {EventClearVault, IRedemptionAdapter} from "../src/EventClearVault.sol";
import {EventClearClaims} from "../src/EventClearClaims.sol";
import {EventClearFundingPool, IPrincipalVault} from "../src/EventClearFundingPool.sol";
import {EventClearTreasury} from "../src/EventClearTreasury.sol";
import {RelationshipRegistry} from "../src/RelationshipRegistry.sol";
import {RiskPolicy} from "../src/RiskPolicy.sol";
import {MockPUSD} from "../src/mocks/MockPUSD.sol";
import {MockConditionalTokens} from "../src/mocks/MockConditionalTokens.sol";
import {MockCTFAdapter} from "../src/mocks/MockCTFAdapter.sol";

/// @notice Broadcasts the complete EventClear happy path against a disposable Anvil chain.
contract DemoLifecycle is Script {
    uint256 internal constant UNIT = 1e6;
    uint256 internal constant DEPLOYER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant BORROWER_AND_SIGNER_KEY =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    function run() external {
        uint256 deployerKey = vm.envOr("LOCAL_DEPLOYER_PRIVATE_KEY", DEPLOYER_KEY);
        uint256 signerKey = vm.envOr("LOCAL_DEMO_BORROWER_PRIVATE_KEY", BORROWER_AND_SIGNER_KEY);
        address deployer = vm.addr(deployerKey);
        address borrower = vm.addr(signerKey);
        bytes32 relationshipHash = keccak256("btc-close-ladder-v3");

        vm.startBroadcast(deployerKey);
        MockPUSD pusd = new MockPUSD();
        MockConditionalTokens ctf = new MockConditionalTokens();
        MockCTFAdapter adapter = new MockCTFAdapter(ctf, pusd);
        RelationshipRegistry registry = new RelationshipRegistry(deployer);
        EventClearClaims claims = new EventClearClaims(deployer);
        EventClearTreasury treasury = new EventClearTreasury(deployer);
        EventClearFundingPool pool =
            new EventClearFundingPool(pusd, deployer, address(treasury), 10_000 * UNIT, 1_000 * UNIT);
        RiskPolicy riskPolicy = new RiskPolicy(deployer, borrower);
        riskPolicy.setAdapterAllowed(address(adapter), true);
        riskPolicy.setCollateralAllowed(address(pusd), true);
        EventClearVault vault = new EventClearVault(
            pusd, ctf, registry, claims, pool, IRedemptionAdapter(address(adapter)), riskPolicy, deployer
        );
        claims.grantRole(claims.VAULT_ROLE(), address(vault));
        pool.grantRole(pool.VAULT_ROLE(), address(vault));
        treasury.grantRole(treasury.RECORDER_ROLE(), address(pool));
        riskPolicy.grantRole(riskPolicy.VAULT_ROLE(), address(vault));
        registry.register(relationshipHash, 3, uint64(block.timestamp), 0, keccak256("reviewed-rules"));
        pusd.mint(deployer, 1_000 * UNIT);
        pusd.approve(address(pool), type(uint256).max);
        pool.deposit(1_000 * UNIT, deployer);
        bytes32 firstCondition = keccak256("btc-100");
        bytes32 secondCondition = keccak256("btc-150");
        ctf.createPosition(firstCondition, 1, 2);
        ctf.createPosition(secondCondition, 3, 4);
        ctf.mint(borrower, 1, 100 * UNIT);
        ctf.mint(borrower, 4, 100 * UNIT);
        vm.stopBroadcast();

        bytes32[] memory conditions = new bytes32[](2);
        uint256[] memory ids = new uint256[](2);
        uint8[] memory outcomes = new uint8[](2);
        uint256[] memory amounts = new uint256[](2);
        conditions[0] = firstCondition;
        conditions[1] = secondCondition;
        ids[0] = 1;
        ids[1] = 4;
        outcomes[0] = 1;
        outcomes[1] = 0;
        amounts[0] = 100 * UNIT;
        amounts[1] = 100 * UNIT;

        EventClearVault.FinancingQuote memory quote = EventClearVault.FinancingQuote({
            borrower: borrower,
            positionWallet: borrower,
            bundleHash: vault.hashBundle(conditions, ids, outcomes, amounts, 3, borrower, borrower),
            walletAuthorizationHash: bytes32(0),
            relationshipDefinitionHash: relationshipHash,
            solverArtifactHash: keccak256("demo-proof-artifact"),
            guaranteedFloor: 100 * UNIT,
            principalAmount: 100 * UNIT,
            grossAdvance: 95_000_000,
            originationFee: 475_000,
            netAdvance: 94_525_000,
            expiry: block.timestamp + 30 minutes,
            nonce: 1,
            chainId: block.chainid,
            vault: address(vault),
            fundingPool: address(pool),
            collateralToken: address(pusd)
        });
        quote.walletAuthorizationHash =
            vault.hashPositionWalletAuthorization(vault.positionWalletAuthorizationForQuote(quote));
        bytes memory signature = _sign(vault, quote, signerKey);
        bytes memory authorizationSignature = _signWalletAuthorization(vault, quote, signerKey);

        vm.startBroadcast(signerKey);
        ctf.setApprovalForAll(address(vault), true);
        uint256 bundleId =
            vault.openBundle(quote, signature, authorizationSignature, conditions, ids, outcomes, amounts, 3);
        vm.stopBroadcast();

        vm.startBroadcast(deployerKey);
        ctf.resolve(firstCondition, UNIT, 0);
        ctf.resolve(secondCondition, 0, UNIT);
        vault.settle(bundleId);
        pool.redeemPrincipal(IPrincipalVault(address(vault)), bundleId, 100 * UNIT);
        vm.stopBroadcast();

        vm.startBroadcast(signerKey);
        vault.redeemResidual(bundleId, 1e18);
        vm.stopBroadcast();

        EventClearVault.Bundle memory settled = vault.getBundle(bundleId);
        require(uint256(settled.status) == uint256(EventClearVault.BundleStatus.SETTLED), "bundle not settled");
        require(settled.settlementProceeds == 200 * UNIT, "wrong proceeds");
        require(pool.outstandingAdvanceCostBasis() == 0, "cost basis not cleared");
        require(pusd.balanceOf(borrower) == 194_525_000, "borrower payout mismatch");
        console2.log("EVENTCLEAR_DEMO_COMPLETE");
        console2.log("vault", address(vault));
        console2.log("bundleId", bundleId);
        console2.log("borrowerFinalPUSD", pusd.balanceOf(borrower));
        console2.log("poolRealizedYield", pool.realizedYield());
    }

    function _sign(EventClearVault vault, EventClearVault.FinancingQuote memory quote, uint256 signerKey)
        internal
        view
        returns (bytes memory)
    {
        bytes32 typehash = keccak256(
            "FinancingQuote(address borrower,address positionWallet,bytes32 bundleHash,bytes32 walletAuthorizationHash,bytes32 relationshipDefinitionHash,bytes32 solverArtifactHash,uint256 guaranteedFloor,uint256 principalAmount,uint256 grossAdvance,uint256 originationFee,uint256 netAdvance,uint256 expiry,uint256 nonce,uint256 chainId,address vault,address fundingPool,address collateralToken)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typehash,
                quote.borrower,
                quote.positionWallet,
                quote.bundleHash,
                quote.walletAuthorizationHash,
                quote.relationshipDefinitionHash,
                quote.solverArtifactHash,
                quote.guaranteedFloor,
                quote.principalAmount,
                quote.grossAdvance,
                quote.originationFee,
                quote.netAdvance,
                quote.expiry,
                quote.nonce,
                quote.chainId,
                quote.vault,
                quote.fundingPool,
                quote.collateralToken
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signWalletAuthorization(
        EventClearVault vault,
        EventClearVault.FinancingQuote memory quote,
        uint256 signerKey
    ) internal view returns (bytes memory) {
        bytes32 digest = vault.positionWalletAuthorizationDigest(vault.positionWalletAuthorizationForQuote(quote));
        EventClearVault.PositionWalletAuthorization memory authorization =
            vault.positionWalletAuthorizationForQuote(quote);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encode(authorization, abi.encodePacked(r, s, v));
    }
}
