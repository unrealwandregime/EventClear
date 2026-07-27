// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";

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
        string memory manifest = vm.readFile("../../config/polygon-mainnet.contracts.json");
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
}
