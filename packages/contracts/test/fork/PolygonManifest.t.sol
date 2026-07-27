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

contract PolygonManifestForkTest is Test {
    using stdJson for string;
    function addressAt(string memory manifest, string memory name) internal pure returns (address) {
        return manifest.readAddress(string.concat(".contracts.", name, ".address"));
    }

    function testOfficialContractBytecodeAndInterfaces() public view {
        if (block.chainid != 137) return;
        string memory manifest = vm.readFile("../../config/polygon-mainnet.contracts.json");
        string[9] memory names = [
            "conditionalTokens",
            "pUSD",
            "ctfCollateralAdapter",
            "negativeRiskCollateralAdapter",
            "ctfExchange",
            "negativeRiskCtfExchange",
            "umaAdapter",
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
        assertTrue(IERC165View(addressAt(manifest, "conditionalTokens")).supportsInterface(0xd9b67a26));
    }
}
