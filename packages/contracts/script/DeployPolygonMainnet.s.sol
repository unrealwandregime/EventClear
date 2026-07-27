// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {EventClearVault, IRedemptionAdapter} from "../src/EventClearVault.sol";
import {EventClearClaims} from "../src/EventClearClaims.sol";
import {EventClearFundingPool} from "../src/EventClearFundingPool.sol";
import {EventClearTreasury} from "../src/EventClearTreasury.sol";
import {RelationshipRegistry} from "../src/RelationshipRegistry.sol";
import {
    PolymarketStandardAdapter,
    IPolymarketConditionalTokens,
    IPolymarketCollateralToken
} from "../src/PolymarketStandardAdapter.sol";

/// @notice Production deployment with transient deployer privileges removed in the same broadcast.
/// @dev This script prepares a standard-market-only pilot. Negative-risk bundles remain disabled.
contract DeployPolygonMainnet is Script {
    error WrongChain();
    error InvalidConfiguration();
    error MissingBytecode(address target);

    function run() external {
        if (block.chainid != 137) revert WrongChain();
        string memory manifest =
            vm.readFile(string.concat(vm.projectRoot(), "/../../config/polygon-mainnet.contracts.json"));
        address pUSDAddress = vm.parseJsonAddress(manifest, ".contracts.pUSD.address");
        address usdceAddress = vm.parseJsonAddress(manifest, ".contracts.usdce.address");
        address ctfAddress = vm.parseJsonAddress(manifest, ".contracts.conditionalTokens.address");
        _requireCode(pUSDAddress);
        _requireCode(usdceAddress);
        _requireCode(ctfAddress);

        uint256 deployerKey = vm.envUint("MAINNET_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address governance = vm.envAddress("GOVERNANCE_MULTISIG");
        address treasuryAdmin = vm.envAddress("TREASURY_MULTISIG");
        address reviewer = vm.envAddress("RELATIONSHIP_REVIEWER_MULTISIG");
        address suspender = vm.envAddress("EMERGENCY_SUSPENDER_MULTISIG");
        address pauser = vm.envAddress("EMERGENCY_PAUSER_MULTISIG");
        address riskAdmin = vm.envAddress("RISK_ADMIN_MULTISIG");
        address lpAdmin = vm.envAddress("LP_ADMIN_MULTISIG");
        address riskSigner = vm.envAddress("RISK_SIGNER_ADDRESS");
        uint256 depositCap = vm.envUint("MAINNET_DEPOSIT_CAP_ATOMIC");
        uint256 perBundleCap = vm.envUint("MAINNET_PER_BUNDLE_CAP_ATOMIC");
        if (
            governance == address(0) || treasuryAdmin == address(0) || reviewer == address(0) || suspender == address(0)
                || pauser == address(0) || riskAdmin == address(0) || lpAdmin == address(0) || riskSigner == address(0)
                || depositCap == 0 || perBundleCap == 0 || perBundleCap > depositCap
        ) revert InvalidConfiguration();

        vm.startBroadcast(deployerKey);
        EventClearTreasury treasury = new EventClearTreasury(deployer);
        EventClearFundingPool pool =
            new EventClearFundingPool(IERC20(pUSDAddress), deployer, address(treasury), depositCap, perBundleCap);
        RelationshipRegistry registry = new RelationshipRegistry(deployer);
        EventClearClaims claims = new EventClearClaims(deployer);
        PolymarketStandardAdapter adapter = new PolymarketStandardAdapter(
            IPolymarketConditionalTokens(ctfAddress), IPolymarketCollateralToken(pUSDAddress), IERC20(usdceAddress)
        );
        EventClearVault vault = new EventClearVault(
            IERC20(pUSDAddress),
            IERC1155(ctfAddress),
            registry,
            claims,
            pool,
            IRedemptionAdapter(address(adapter)),
            riskSigner,
            deployer
        );

        claims.grantRole(claims.VAULT_ROLE(), address(vault));
        pool.grantRole(pool.VAULT_ROLE(), address(vault));
        treasury.grantRole(treasury.RECORDER_ROLE(), address(pool));
        vault.setOriginationsPaused(true);

        registry.grantRole(registry.DEFAULT_ADMIN_ROLE(), governance);
        registry.grantRole(registry.REVIEWER_ROLE(), reviewer);
        registry.grantRole(registry.SUSPENDER_ROLE(), suspender);
        claims.grantRole(claims.DEFAULT_ADMIN_ROLE(), governance);
        pool.grantRole(pool.DEFAULT_ADMIN_ROLE(), governance);
        pool.grantRole(pool.LP_ROLE(), lpAdmin);
        treasury.grantRole(treasury.DEFAULT_ADMIN_ROLE(), treasuryAdmin);
        vault.grantRole(vault.DEFAULT_ADMIN_ROLE(), governance);
        vault.grantRole(vault.PAUSER_ROLE(), pauser);
        vault.grantRole(vault.RISK_ADMIN_ROLE(), riskAdmin);

        registry.renounceRole(registry.REVIEWER_ROLE(), deployer);
        registry.renounceRole(registry.SUSPENDER_ROLE(), deployer);
        registry.renounceRole(registry.DEFAULT_ADMIN_ROLE(), deployer);
        claims.renounceRole(claims.DEFAULT_ADMIN_ROLE(), deployer);
        pool.renounceRole(pool.LP_ROLE(), deployer);
        pool.renounceRole(pool.DEFAULT_ADMIN_ROLE(), deployer);
        treasury.renounceRole(treasury.RECORDER_ROLE(), deployer);
        treasury.renounceRole(treasury.DEFAULT_ADMIN_ROLE(), deployer);
        vault.renounceRole(vault.PAUSER_ROLE(), deployer);
        vault.renounceRole(vault.RISK_ADMIN_ROLE(), deployer);
        vault.renounceRole(vault.DEFAULT_ADMIN_ROLE(), deployer);
        vm.stopBroadcast();

        string memory deployment = "eventclear";
        vm.serializeUint(deployment, "chainId", block.chainid);
        vm.serializeAddress(deployment, "deployer", deployer);
        vm.serializeAddress(deployment, "adapter", address(adapter));
        vm.serializeAddress(deployment, "registry", address(registry));
        vm.serializeAddress(deployment, "claims", address(claims));
        vm.serializeAddress(deployment, "pool", address(pool));
        vm.serializeAddress(deployment, "treasury", address(treasury));
        string memory output = vm.serializeAddress(deployment, "vault", address(vault));
        vm.writeJson(output, string.concat(vm.projectRoot(), "/../../config/polygon-mainnet.eventclear.json"));
    }

    function _requireCode(address target) private view {
        if (target == address(0)) revert InvalidConfiguration();
        if (target.code.length == 0) revert MissingBytecode(target);
    }
}
