// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
/**
 * @title ILibrary
 * @notice Interface for libraries that build XCM messages.
 *         Implemented in ink! and deployed in PolkaVM, this library currently supports constructing Teleport messages only.
 *         XCM messages are returned as SCALE-encoded bytes for use with XCM precompiles.
 *
 * @dev Example:
 *   bytes memory xcmMsg = ILibrary(inkLibrary).teleport(paraId, beneficiary, amount);
 */
interface ILibrary {
    function teleport(
        uint32 paraId,
        bytes32 beneficiary,
        uint128 amount
    ) external returns (bytes memory);
}
