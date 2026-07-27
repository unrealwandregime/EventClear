// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract EventClearTreasury is AccessControl {
    using SafeERC20 for IERC20;
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");
    mapping(bytes32 source => uint256 amount) public feesBySource;

    event FeeRecorded(bytes32 indexed source, uint256 amount);
    event TreasuryWithdrawal(address indexed token, address indexed to, uint256 amount);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RECORDER_ROLE, admin);
    }

    function recordFee(bytes32 source, uint256 amount) external onlyRole(RECORDER_ROLE) {
        feesBySource[source] += amount;
        emit FeeRecorded(source, amount);
    }

    function withdraw(IERC20 token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        token.safeTransfer(to, amount);
        emit TreasuryWithdrawal(address(token), to, amount);
    }
}
