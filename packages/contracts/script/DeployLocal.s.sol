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

contract DeployLocal is Script {
    function run() external {
        uint256 key = vm.envOr("LOCAL_DEPLOYER_PRIVATE_KEY", uint256(0xA11CE));
        address deployer = vm.addr(key);
        address signer = vm.envOr("RISK_SIGNER_ADDRESS", deployer);
        vm.startBroadcast(key);
        MockPUSD pusd = new MockPUSD();
        MockConditionalTokens ctf = new MockConditionalTokens();
        MockCTFAdapter adapter = new MockCTFAdapter(ctf, pusd);
        new MockResolutionOracle(ctf);
        RelationshipRegistry registry = new RelationshipRegistry(deployer);
        EventClearClaims claims = new EventClearClaims(deployer);
        EventClearTreasury treasury = new EventClearTreasury(deployer);
        EventClearFundingPool pool =
            new EventClearFundingPool(pusd, deployer, address(treasury), 10_000_000e6, 500_000e6);
        RiskPolicy riskPolicy = new RiskPolicy(deployer, signer);
        riskPolicy.setAdapterAllowed(address(adapter), true);
        riskPolicy.setCollateralAllowed(address(pusd), true);
        EventClearVault vault = new EventClearVault(
            pusd, ctf, registry, claims, pool, IRedemptionAdapter(address(adapter)), riskPolicy, deployer
        );
        claims.grantRole(claims.VAULT_ROLE(), address(vault));
        pool.grantRole(pool.VAULT_ROLE(), address(vault));
        treasury.grantRole(treasury.RECORDER_ROLE(), address(pool));
        riskPolicy.grantRole(riskPolicy.VAULT_ROLE(), address(vault));
        vm.stopBroadcast();
    }
}
