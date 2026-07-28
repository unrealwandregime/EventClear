// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {EventClearVault, IRedemptionAdapter} from "../src/EventClearVault.sol";
import {EventClearClaims} from "../src/EventClearClaims.sol";
import {EventClearFundingPool} from "../src/EventClearFundingPool.sol";
import {EventClearTreasury} from "../src/EventClearTreasury.sol";
import {RelationshipRegistry} from "../src/RelationshipRegistry.sol";
import {RiskPolicy} from "../src/RiskPolicy.sol";
import {MockPUSD} from "../src/mocks/MockPUSD.sol";
import {MockConditionalTokens} from "../src/mocks/MockConditionalTokens.sol";
import {MockCTFAdapter} from "../src/mocks/MockCTFAdapter.sol";
import {MockResolutionOracle} from "../src/mocks/MockResolutionOracle.sol";

/// @notice Controlled test-asset deployment for an explicit non-137 staging network.
contract DeployStaging is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("STAGING_DEPLOYER_PRIVATE_KEY");
        uint256 expectedChainId = vm.envUint("STAGING_CHAIN_ID");
        address admin = vm.envAddress("STAGING_ADMIN_ADDRESS");
        address riskSigner = vm.envAddress("RISK_SIGNER_ADDRESS");
        address lp = vm.envAddress("STAGING_LP_ADDRESS");
        address tester = vm.envAddress("STAGING_TEST_EOA");
        bytes32 relationshipHash = vm.envBytes32("STAGING_RELATIONSHIP_HASH");
        bytes32 rulesHash = vm.envBytes32("STAGING_RULES_HASH");
        uint256 earliest = vm.envUint("STAGING_EARLIEST_RESOLUTION");
        uint256 latest = vm.envUint("STAGING_LATEST_RESOLUTION");
        uint256 depositCap = vm.envUint("STAGING_DEPOSIT_CAP");
        uint256 perBundleCap = vm.envUint("STAGING_PER_BUNDLE_CAP");
        uint256 utilizationCapBps = vm.envUint("STAGING_UTILIZATION_CAP_BPS");
        uint256 minimumReserveBps = vm.envUint("STAGING_MINIMUM_RESERVE_BPS");
        uint256 maximumDuration = vm.envUint("STAGING_MAXIMUM_DURATION");
        uint256 maximumAdvance = vm.envUint("STAGING_MAXIMUM_ADVANCE");
        uint256 perWalletExposure = vm.envUint("STAGING_PER_WALLET_EXPOSURE");
        uint256 perMarketExposure = vm.envUint("STAGING_PER_MARKET_EXPOSURE");
        uint256 perRelationshipExposure = vm.envUint("STAGING_PER_RELATIONSHIP_EXPOSURE");
        uint256 globalExposure = vm.envUint("STAGING_GLOBAL_EXPOSURE");
        address deployer = vm.addr(deployerKey);
        require(block.chainid == expectedChainId, "unexpected staging chain");
        require(block.chainid != 137, "polygon mainnet prohibited");
        require(admin != address(0) && admin != deployer, "separate staging admin required");
        require(riskSigner != address(0) && lp != address(0) && tester != address(0), "staging address missing");
        require(relationshipHash != bytes32(0) && rulesHash != bytes32(0), "staging hash missing");
        require(earliest > block.timestamp && latest >= earliest, "staging resolution window invalid");
        require(utilizationCapBps <= 10_000 && minimumReserveBps <= utilizationCapBps, "staging pool limits invalid");
        require(maximumDuration <= type(uint64).max, "staging duration invalid");

        vm.startBroadcast(deployerKey);
        MockPUSD collateral = new MockPUSD();
        MockConditionalTokens conditionalTokens = new MockConditionalTokens();
        new MockResolutionOracle(conditionalTokens);
        MockCTFAdapter adapter = new MockCTFAdapter(conditionalTokens, collateral);
        RelationshipRegistry registry = new RelationshipRegistry(deployer);
        EventClearClaims claims = new EventClearClaims(deployer);
        EventClearTreasury treasury = new EventClearTreasury(deployer);
        EventClearFundingPool pool =
            new EventClearFundingPool(collateral, deployer, address(treasury), depositCap, perBundleCap);
        RiskPolicy risk = new RiskPolicy(deployer, riskSigner);
        EventClearVault vault = new EventClearVault(
            collateral, conditionalTokens, registry, claims, pool, IRedemptionAdapter(address(adapter)), risk, deployer
        );

        claims.grantRole(claims.VAULT_ROLE(), address(vault));
        pool.grantRole(pool.VAULT_ROLE(), address(vault));
        pool.grantRole(pool.LP_ROLE(), lp);
        treasury.grantRole(treasury.RECORDER_ROLE(), address(pool));
        risk.grantRole(risk.VAULT_ROLE(), address(vault));
        risk.setAdapterAllowed(address(adapter), true);
        risk.setCollateralAllowed(address(collateral), true);
        risk.setLimits(
            9_000,
            uint64(maximumDuration),
            maximumAdvance,
            perWalletExposure,
            perMarketExposure,
            perRelationshipExposure,
            globalExposure
        );
        pool.setRiskLimits(uint16(utilizationCapBps), uint16(minimumReserveBps));
        registry.register(relationshipHash, 1, uint64(block.timestamp), 0, earliest, latest, rulesHash);
        collateral.mint(lp, 25_000e6);
        conditionalTokens.createPosition(keccak256("staging-lower"), 1, 2);
        conditionalTokens.createPosition(keccak256("staging-upper"), 3, 4);
        conditionalTokens.mint(tester, 1, 1_000e6);
        conditionalTokens.mint(tester, 4, 1_000e6);

        registry.grantRole(registry.DEFAULT_ADMIN_ROLE(), admin);
        registry.grantRole(registry.REVIEWER_ROLE(), admin);
        registry.grantRole(registry.SUSPENDER_ROLE(), admin);
        claims.grantRole(claims.DEFAULT_ADMIN_ROLE(), admin);
        treasury.grantRole(treasury.DEFAULT_ADMIN_ROLE(), admin);
        pool.grantRole(pool.DEFAULT_ADMIN_ROLE(), admin);
        risk.grantRole(risk.DEFAULT_ADMIN_ROLE(), admin);
        risk.grantRole(risk.RISK_ADMIN_ROLE(), admin);
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), admin);
        vault.grantRole(vault.PAUSER_ROLE(), admin);

        registry.renounceRole(registry.REVIEWER_ROLE(), deployer);
        registry.renounceRole(registry.SUSPENDER_ROLE(), deployer);
        registry.renounceRole(registry.DEFAULT_ADMIN_ROLE(), deployer);
        claims.renounceRole(claims.DEFAULT_ADMIN_ROLE(), deployer);
        treasury.renounceRole(treasury.RECORDER_ROLE(), deployer);
        treasury.renounceRole(treasury.DEFAULT_ADMIN_ROLE(), deployer);
        pool.renounceRole(pool.LP_ROLE(), deployer);
        pool.renounceRole(pool.DEFAULT_ADMIN_ROLE(), deployer);
        risk.renounceRole(risk.RISK_ADMIN_ROLE(), deployer);
        risk.renounceRole(risk.DEFAULT_ADMIN_ROLE(), deployer);
        vault.renounceRole(vault.PAUSER_ROLE(), deployer);
        vault.renounceRole(vault.DEFAULT_ADMIN_ROLE(), deployer);
        vm.stopBroadcast();
    }
}
