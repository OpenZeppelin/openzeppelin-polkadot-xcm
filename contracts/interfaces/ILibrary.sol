// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILibrary {
    function teleport(
        uint32 paraId,
        bytes32 beneficiary,
        uint128 amount
    ) external returns (bytes memory);
}
