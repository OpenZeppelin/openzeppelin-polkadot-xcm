// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../interfaces/IXcm.sol";

contract MockXcm is IXcm {
    event Executed(bytes message);
    event Sent(bytes destination, bytes message);
    event WeighMessageCalled(bytes message);

    bool private executionSuccess = true;
    Weight private mockWeight = Weight({refTime: 1000000, proofSize: 1000});

    function setExecutionSuccess(bool success) external {
        executionSuccess = success;
    }

    function setMockWeight(uint64 refTime, uint64 proofSize) external {
        mockWeight = Weight({refTime: refTime, proofSize: proofSize});
    }

    function execute(
        bytes calldata message,
        Weight calldata weight
    ) external override {
        require(executionSuccess, "MockXcm: execution failed");
        emit Executed(message);
    }

    function send(
        bytes calldata destination,
        bytes calldata message
    ) external override {
        emit Sent(destination, message);
    }

    function weighMessage(
        bytes calldata message
    ) external view override returns (Weight memory weight) {
        return mockWeight;
    }
}
