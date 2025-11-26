// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {InputSettlerPurchase} from "oif/input/InputSettlerPurchase.sol";
import {InputSettlerEscrow} from "oif/input/escrow/InputSettlerEscrow.sol";
import {IInputSettlerEscrow} from "oif/interfaces/IInputSettlerEscrow.sol";
import {InputSettlerBase} from "oif/input/InputSettlerBase.sol";
import {EIP712} from "openzeppelin/utils/cryptography/EIP712.sol";
import {Ownable} from "openzeppelin/access/Ownable.sol";
import {SafeERC20} from "openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "openzeppelin/token/ERC20/IERC20.sol";
import {StandardOrder, StandardOrderType} from "oif/input/types/StandardOrderType.sol";
import {MandateOutput} from "oif/input/types/MandateOutputType.sol";
import {OrderPurchase} from "oif/input/types/OrderPurchaseType.sol";
import {LibAddress} from "oif/libs/LibAddress.sol";
import {IXcm} from "./interfaces/IXcm.sol";
import {ILibrary} from "./interfaces/ILibrary.sol";
import {ReentrancyGuard} from "openzeppelin/utils/ReentrancyGuard.sol";
import {SafeCast} from "openzeppelin/utils/math/SafeCast.sol";

contract InputSettlerXCMEscrow is
    InputSettlerPurchase,
    IInputSettlerEscrow,
    Ownable,
    ReentrancyGuard
{
    using StandardOrderType for StandardOrder;
    using LibAddress for uint256;
    using SafeCast for uint256;
    using LibAddress for bytes32;

    /// @dev XCM destination chain IDs are limited to uint32
    uint256 private constant MAX_XCM_CHAIN_ID = type(uint32).max;

    /// @dev XCM teleport amounts are limited to uint128
    uint256 private constant MAX_XCM_AMOUNT = type(uint128).max;

    address public immutable inkLibrary;
    address public immutable xcmPrecompile;
    address public immutable baseSettler;

    bool public xcmEnabled = true;

    mapping(bytes32 => bool) private teleportAllowed;

    struct TransferAmount {
        uint256 amount;
        address token;
    }

    event TeleportAllowed(uint32 destination, address token);
    event TeleportForbidden(uint32 destination, address token);
    event XCMEnabledChanged(bool enabled);
    event XCMTeleportExecuted(uint256 indexed destination, address token, uint256 amount, bytes32 recipient);

    constructor(
        address _inkLibrary,
        address _xcmPrecompile,
        address _baseSettler
    ) EIP712(_domainName(), _domainVersion()) Ownable(msg.sender) {
        inkLibrary = _inkLibrary;
        xcmPrecompile = _xcmPrecompile;
        baseSettler = _baseSettler;
    }

    /**
     * @notice Returns the domain name of the EIP712 signature.
     * @dev This function is only called in the constructor and the returned value is cached
     * by the EIP712 base contract.
     * @return name The domain name.
     */
    function _domainName() internal view virtual returns (string memory) {
        return "PolkadotOIFEscrow";
    }

    /**
     * @notice Returns the domain version of the EIP712 signature.
     * @dev This function is only called in the constructor and the returned value is cached
     * by the EIP712 base contract.
     * @return version The domain version.
     */
    function _domainVersion() internal view virtual returns (string memory) {
        return "1";
    }

    function openFor(
        StandardOrder calldata order,
        address sponsor,
        bytes calldata signature
    ) external nonReentrant {
        // TODO: right now we are not bringing the sponsored intents
        InputSettlerEscrow(baseSettler).openFor(order, sponsor, signature);
    }

    function open(StandardOrder calldata order) external nonReentrant {
        if (_checkXCMAvailable(order)) {
            _validateInputChain(order.originChainId);
            _validateTimestampHasNotPassed(order.fillDeadline);
            _validateTimestampHasNotPassed(order.expires);
            TransferAmount[] memory transferAmounts = calculateTransferAmountsFromOutputs(order);
            _collectAndApproveTokens(transferAmounts, xcmPrecompile);
            _executeXCM(order);
            _disableApprovals(transferAmounts, xcmPrecompile);
        } else {
            TransferAmount[] memory transferAmounts = calculateTransferAmountsFromInputs(order);
            _collectAndApproveTokens(transferAmounts, baseSettler);
            InputSettlerEscrow(baseSettler).open(order);
        }
    }

    function _collectAndApproveTokens(TransferAmount[] memory transferAmounts, address recipient) private {
        uint256 numTransfers = transferAmounts.length;
        for (uint256 i = 0; i < numTransfers; ++i) {
            TransferAmount memory transfer = transferAmounts[i];
            uint256 amount = transfer.amount;
            IERC20 token = IERC20(transfer.token);
            SafeERC20.safeTransferFrom(token, msg.sender, address(this), amount);
            SafeERC20.safeIncreaseAllowance(token, recipient, amount);
        }
    }

    function _disableApprovals(TransferAmount[] memory transferAmounts, address recipient) private {
        uint256 numTransfers = transferAmounts.length;
        for (uint256 i = 0; i < numTransfers; ++i) {
            TransferAmount memory transfer = transferAmounts[i];
            IERC20 token = IERC20(transfer.token);
            SafeERC20.forceApprove(token, recipient, 0);
        }
    }

    function calculateTransferAmountsFromOutputs(StandardOrder calldata order) private pure returns (TransferAmount[] memory) {
        uint256 numOutputs = order.outputs.length;
        TransferAmount[] memory transferAmounts = new TransferAmount[](numOutputs);
        for (uint256 i = 0; i < numOutputs; ++i) {
            MandateOutput calldata output = order.outputs[i];
            transferAmounts[i] = TransferAmount({ amount: output.amount, token: output.token.fromIdentifier() });
        }
        return transferAmounts;
    }

    function calculateTransferAmountsFromInputs(StandardOrder calldata order) private pure returns (TransferAmount[] memory) {
        uint256 numInputs = order.inputs.length;
        TransferAmount[] memory transferAmounts = new TransferAmount[](numInputs);
        for (uint256 i = 0; i < numInputs; ++i) {
            uint256[2] calldata input = order.inputs[i];
            transferAmounts[i] = TransferAmount({ amount: input[1], token: input[0].validatedCleanAddress() });
        }
        return transferAmounts;
    }

    function _checkXCMAvailable(
        StandardOrder calldata order
    ) private view returns (bool) {
        if (!xcmEnabled) return false;
        if (order.inputs.length == 0 || order.outputs.length == 0) {
            return false;
        }
        if (!_validateOutputsForXCM(order.outputs)) return false;
        if (!_validateInputsForXCM(order.inputs)) return false;
        return _verifyInputsCoverOutputs(order.inputs, order.outputs);
    }
     
    function _validateOutputsForXCM(MandateOutput[] calldata outputs) private view returns (bool) {
        uint256 numOutputs = outputs.length;
        for (uint256 i = 0; i < numOutputs; ++i) {
            MandateOutput calldata output = outputs[i];
            if (output.recipient == bytes32(0)) return false;
            uint256 destination = output.chainId;
            if (destination > MAX_XCM_CHAIN_ID) {
                return false;
            }
            uint32 destCasted = uint32(destination);
            address token = output.token.fromIdentifier();
            bytes32 destKey = keccak256(abi.encode(destCasted, token));
            if (!teleportAllowed[destKey]) {
                return false;
            }
            uint256 amount = output.amount;
            if (amount > MAX_XCM_AMOUNT) {
                return false;
            }
        }
        return true;
    }

    function _validateInputsForXCM(uint256[2][] calldata inputs) private pure returns (bool) {
        uint256 numInputs = inputs.length;
        for (uint256 i = 0; i < numInputs; ++i) {
            uint256[2] calldata input = inputs[i];
            uint256 amount = input[1];
            if (amount > MAX_XCM_AMOUNT) {
                return false;
            }
        }
        return true;
    }

    function _verifyInputsCoverOutputs(uint256[2][] calldata inputs, MandateOutput[] calldata outputs) private pure returns (bool) {
        // Aggregation and coverage logic
        uint256 numInputs = inputs.length;
        uint256 numOutputs = outputs.length;

        // We track required output amounts per token
        uint256[] memory tempOutputAmounts = new uint256[](numOutputs);
        address[] memory tempKeys = new address[](numOutputs);
        uint256 emptyIdx = 0;

        // 1. Aggregate required outputs
        for (uint256 i = 0; i < numOutputs; ++i) {
            MandateOutput calldata output = outputs[i];
            uint256 amount = output.amount;
            address token = output.token.fromIdentifier();
            uint256 idx = _findInArray(token, tempKeys, emptyIdx);
            if (idx == emptyIdx) {
                emptyIdx++;
                tempKeys[idx] = token;
            }
            uint256 newAmount = tempOutputAmounts[idx] + amount;
            require(newAmount >= tempOutputAmounts[idx], "Output amount overflow");
            tempOutputAmounts[idx] = newAmount;
        }

        // 2. Subtract available inputs
        for (uint256 i = 0; i < numInputs; ++i) {
            uint256[2] calldata input = inputs[i];
            address token = input[0].validatedCleanAddress();
            uint256 amount = input[1];
            uint256 idx = _findInArray(token, tempKeys, emptyIdx);
            if (idx != emptyIdx) {
                if (amount >= tempOutputAmounts[idx]) {
                    tempOutputAmounts[idx] = 0;
                } else {
                    tempOutputAmounts[idx] -= amount;
                }
            }
        }

        // 3. Verify all output requirements are met
        for (uint256 i = 0; i < emptyIdx; ++i) {
            if (tempOutputAmounts[i] > 0) {
                return false;
            }
        }
        return true;
    }

    /// @notice Executes XCM teleport for each output
    /// @dev IMPORTANT: If execution fails partway through the loop, the entire
    /// transaction reverts. However, any XCM messages already dispatched may have
    /// irrevocable off-chain effects depending on precompile implementation.
    /// That's why it is important for administrators to carefully consider 
    /// the chains where teleport is allowed.
    /// @param order The standard order to execute XCM teleport for
    function _executeXCM(StandardOrder calldata order) private {
        uint256 numOutputs = order.outputs.length;
        bytes[] memory messages = new bytes[](numOutputs);
        for (uint256 i = 0; i < numOutputs; ++i) {
            MandateOutput calldata output = order.outputs[i];
            uint32 destination = output.chainId.toUint32();
            uint128 amount = output.amount.toUint128();
            bytes memory message = ILibrary(inkLibrary).teleport(
                destination,
                output.recipient,
                amount
            );

            messages[i] = message;
        }

        for (uint256 i = 0; i < numOutputs; ++i) {
            bytes memory message = messages[i];
            IXcm xcm = IXcm(xcmPrecompile);
            IXcm.Weight memory weight = xcm.weighMessage(message);
            xcm.execute(message, weight);
            MandateOutput calldata output = order.outputs[i];
            emit XCMTeleportExecuted(output.chainId, output.token.fromIdentifier(), output.amount, output.recipient);
        }
    }

    

    function finalise(
        StandardOrder calldata order,
        InputSettlerBase.SolveParams[] calldata solveParams,
        bytes32 destination,
        bytes calldata call
    ) external nonReentrant {
        InputSettlerEscrow(baseSettler).finalise(
            order,
            solveParams,
            destination,
            call
        );
    }

    function finaliseWithSignature(
        StandardOrder calldata order,
        InputSettlerBase.SolveParams[] calldata solveParams,
        bytes32 destination,
        bytes calldata call,
        bytes calldata orderOwnerSignature
    ) external nonReentrant {
        InputSettlerEscrow(baseSettler).finaliseWithSignature(
            order,
            solveParams,
            destination,
            call,
            orderOwnerSignature
        );
    }

    function orderIdentifier(
        StandardOrder memory order
    ) external view returns (bytes32) {
        return InputSettlerEscrow(baseSettler).orderIdentifier(order);
    }

    function purchaseOrder(
        OrderPurchase memory orderPurchase,
        StandardOrder memory order,
        bytes32 orderSolvedByIdentifier,
        bytes32 purchaser,
        uint256 expiryTimestamp,
        bytes memory solverSignature
    ) external nonReentrant {
        InputSettlerEscrow(baseSettler).purchaseOrder(
            orderPurchase,
            order,
            orderSolvedByIdentifier,
            purchaser,
            expiryTimestamp,
            solverSignature
        );
    }

    function allowTeleport(
        uint32 destination,
        address token
    ) external onlyOwner {
        bytes32 key = keccak256(abi.encode(destination, token));
        teleportAllowed[key] = true;
        emit TeleportAllowed(destination, token);
    }

    function forbidTeleport(
        uint32 destination,
        address token
    ) external onlyOwner {
        bytes32 key = keccak256(abi.encode(destination, token));
        teleportAllowed[key] = false;
        emit TeleportForbidden(destination, token);
    }

    function setXCMEnabled(bool enabled) external onlyOwner {
        xcmEnabled = enabled;
        emit XCMEnabledChanged(enabled);
    }

    function _findInArray(
        address needle,
        address[] memory haystack,
        uint256 len
    ) private pure returns (uint256) {
        for (uint256 i = 0; i < len; i++) {
            if (needle == haystack[i]) {
                return i;
            }
        }
        return len;
    }
}
