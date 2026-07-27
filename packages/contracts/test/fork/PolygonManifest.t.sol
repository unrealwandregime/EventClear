// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {PolymarketStandardCTFAdapter} from "../../src/PolymarketStandardCTFAdapter.sol";
import {
    IPolymarketCollateralToken,
    IPolymarketConditionalTokens,
    IPolymarketOfficialCTFAdapter
} from "../../src/PolymarketStandardAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC165View {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IERC20MetadataView {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

interface ICollateralAdapterView {
    function CONDITIONAL_TOKENS() external view returns (address);
    function COLLATERAL_TOKEN() external view returns (address);
    function USDCE() external view returns (address);
}

interface INegRiskCollateralAdapterView is ICollateralAdapterView {
    function NEG_RISK_ADAPTER() external view returns (address);
}

contract PolygonManifestForkTest is Test {
    using stdJson for string;

    function addressAt(string memory manifest, string memory name) internal pure returns (address) {
        return manifest.readAddress(string.concat(".contracts.", name, ".address"));
    }

    function testOfficialContractBytecodeAndInterfaces() public view {
        if (block.chainid != 137) return;
        string memory manifest = vm.readFile("../../config/contracts/polygon-mainnet.json");
        string[13] memory names = [
            "conditionalTokens",
            "pUSD",
            "pUSDImplementation",
            "usdce",
            "ctfCollateralAdapter",
            "negativeRiskCollateralAdapter",
            "negativeRiskAdapter",
            "ctfExchange",
            "negativeRiskCtfExchange",
            "umaAdapter",
            "umaAdapterV3",
            "umaOptimisticOracle",
            "positionManager"
        ];
        for (uint256 i; i < names.length; ++i) {
            address target = addressAt(manifest, names[i]);
            assertTrue(target != address(0));
            assertGt(target.code.length, 0);
        }
        address pusd = addressAt(manifest, "pUSD");
        assertEq(IERC20MetadataView(pusd).symbol(), "pUSD");
        assertEq(IERC20MetadataView(pusd).decimals(), 6);
        address ctf = addressAt(manifest, "conditionalTokens");
        address usdce = addressAt(manifest, "usdce");
        assertEq(IERC20MetadataView(usdce).decimals(), 6);
        assertTrue(IERC165View(ctf).supportsInterface(0xd9b67a26));
        ICollateralAdapterView standard = ICollateralAdapterView(addressAt(manifest, "ctfCollateralAdapter"));
        assertEq(standard.CONDITIONAL_TOKENS(), ctf);
        assertEq(standard.COLLATERAL_TOKEN(), pusd);
        assertEq(standard.USDCE(), usdce);
        INegRiskCollateralAdapterView negative =
            INegRiskCollateralAdapterView(addressAt(manifest, "negativeRiskCollateralAdapter"));
        assertEq(negative.CONDITIONAL_TOKENS(), ctf);
        assertEq(negative.COLLATERAL_TOKEN(), pusd);
        assertEq(negative.USDCE(), usdce);
        assertEq(negative.NEG_RISK_ADAPTER(), addressAt(manifest, "negativeRiskAdapter"));
    }

    function testRealResolvedStandardPositionTransferAndRedemption() public {
        if (block.chainid != 137) return;
        string memory manifest = vm.readFile("../../config/contracts/polygon-mainnet.json");
        string memory fixtures = vm.readFile("../../config/contracts/polygon-fork-fixtures.json");
        address ctfAddress = addressAt(manifest, "conditionalTokens");
        address pusdAddress = addressAt(manifest, "pUSD");
        address usdceAddress = addressAt(manifest, "usdce");
        address officialAdapterAddress = addressAt(manifest, "ctfCollateralAdapter");
        bytes32 conditionId = fixtures.readBytes32(".standardResolvedMarket.conditionId");
        uint256 yesTokenId = vm.parseUint(fixtures.readString(".standardResolvedMarket.yesTokenId"));
        uint256 noTokenId = vm.parseUint(fixtures.readString(".standardResolvedMarket.noTokenId"));
        uint256 amount = 1e6;

        PolymarketStandardCTFAdapter adapter = new PolymarketStandardCTFAdapter(
            IPolymarketConditionalTokens(ctfAddress),
            IPolymarketCollateralToken(pusdAddress),
            IERC20(usdceAddress),
            IPolymarketOfficialCTFAdapter(officialAdapterAddress)
        );
        (uint256 derivedYes, uint256 derivedNo) = adapter.positionIds(conditionId);
        assertEq(derivedYes, yesTokenId, "Gamma yes token differs from CTF derivation");
        assertEq(derivedNo, noTokenId, "Gamma no token differs from CTF derivation");
        assertEq(IPolymarketConditionalTokens(ctfAddress).payoutDenominator(conditionId), 1);

        // The fixture balance is injected on the fork; transfer, burn, underlying
        // redemption and pUSD wrapping all execute against deployed Polygon code.
        dealERC1155(ctfAddress, address(this), noTokenId, amount);
        IPolymarketConditionalTokens(ctfAddress).setApprovalForAll(address(adapter), true);
        bytes32[] memory conditions = new bytes32[](1);
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        conditions[0] = conditionId;
        ids[0] = noTokenId;
        amounts[0] = amount;

        uint256 beforeBalance = IERC20(pusdAddress).balanceOf(address(this));
        adapter.redeem(conditions, ids, amounts);
        assertEq(IERC20(pusdAddress).balanceOf(address(this)) - beforeBalance, amount);
        assertEq(IPolymarketConditionalTokens(ctfAddress).balanceOf(address(adapter), noTokenId), 0);
    }
}
