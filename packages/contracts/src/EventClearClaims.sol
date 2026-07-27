// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Transferable pUSD-denominated principal and residual settlement claims.
contract EventClearClaims is ERC1155, AccessControl, Pausable {
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");
    uint8 public constant PRINCIPAL = 1;
    uint8 public constant RESIDUAL = 2;

    constructor(address admin) ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function claimId(uint256 bundleId, uint8 claimType) public pure returns (uint256) {
        return (bundleId << 8) | claimType;
    }

    function mint(address to, uint256 bundleId, uint8 claimType, uint256 amount) external onlyRole(VAULT_ROLE) {
        _mint(to, claimId(bundleId, claimType), amount, "");
    }

    function burn(address from, uint256 id, uint256 amount) external onlyRole(VAULT_ROLE) {
        _burn(from, id, amount);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override
        whenNotPaused
    {
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
