// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/ILibrary.sol";
import {SafeERC20} from "openzeppelin/token/ERC20/utils/SafeERC20.sol"; 
import {IERC20} from "openzeppelin/token/ERC20/IERC20.sol";

contract MockLibrary is ILibrary {
    event TeleportCalled(uint32 paraId, bytes32 beneficiary, uint128 amount);

    bytes private teleportMessage = "0x";
    address private tokenAddress;

    function setTeleportMessage(bytes memory message) external {
        teleportMessage = message;
    }

    function setToken(address _token) external {
        tokenAddress = _token;
    }

    function teleport(
        uint32 paraId,
        bytes32 beneficiary,
        uint128 amount
    ) external returns (bytes memory) {
        // Simulate burning tokens by transferring from caller to this contract
        if (tokenAddress != address(0)) {
            SafeERC20.safeTransferFrom(IERC20(tokenAddress), msg.sender, address(this), amount);
        }
        emit TeleportCalled(paraId, beneficiary, amount);
        return teleportMessage;
    }
}
