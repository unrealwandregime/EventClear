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

/// @notice Controlled test-asset deployment for a remote chain-id 31337 staging network.
contract DeployStaging is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("STAGING_DEPLOYER_PRIVATE_KEY");
        address admin = vm.envAddress("STAGING_ADMIN_ADDRESS");
        address riskSigner = vm.envAddress("RISK_SIGNER_ADDRESS");
        address lp = vm.envAddress("STAGING_LP_ADDRESS");
        address tester = vm.envAddress("STAGING_TEST_EOA");
        bytes32 relationshipHash = vm.envBytes32("STAGING_RELATIONSHIP_HASH");
        bytes32 rulesHash = vm.envBytes32("STAGING_RULES_HASH");
        uint256 earliest = vm.envUint("STAGING_EARLIEST_RESOLUTION");
        uint256 latest = vm.envUint("STAGING_LATEST_RESOLUTION");
        address deployer = vm.addr(deployerKey);
        require(admin != address(0) && admin != deployer, "separate staging admin required");
        require(riskSigner != address(0) && lp != address(0) && tester != address(0), "staging address missing");
        require(relationshipHash != bytes32(0) && rulesHash != bytes32(0), "staging hash missing");
        require(earliest > block.timestamp && latest >= earliest, "staging resolution window invalid");

        vm.startBroadcast(deployerKey);
        MockPUSD collateral = new MockPUSD();
        MockConditionalTokens conditionalTokens = new MockConditionalTokens();
        MockCTFAdapter adapter = new MockCTFAdapter(conditionalTokens, collateral);
        RelationshipRegistry registry = new RelationshipRegistry(deployer);
        EventClearClaims claims = new EventClearClaims(deployer);
        EventClearTreasury treasury = new EventClearTreasury(deployer);
        EventClearFundingPool pool =
            new EventClearFundingPool(collateral, deployer, address(treasury), 100_000e6, 10_000e6);
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
        risk.setLimits(9_000, 90 days, 10_000e6, 20_000e6, 20_000e6, 20_000e6, 50_000e6);
        pool.setRiskLimits(7_500, 2_000);
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
