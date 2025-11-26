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
    ) EIP712("PolkadotOIFEscrow", "1") Ownable(msg.sender) {
        inkLibrary = _inkLibrary;
        xcmPrecompile = _xcmPrecompile;
        baseSettler = _baseSettler;
    }

    /**
     * @notice Opens an intent for `order.user`. Intent is always executed via the base settler.
     * @param order StandardOrder representing the intent.
     * @param sponsor Address to collect tokens from.
     * @param signature Allowance signature from sponsor with supported signature type encoding.
     */
    function openFor(
        StandardOrder calldata order,
        address sponsor,
        bytes calldata signature
    ) external nonReentrant {
        // TODO: right now we are not bringing the sponsored intents
        InputSettlerEscrow(baseSettler).openFor(order, sponsor, signature);
    }

    /**
     * @notice Opens an intent for `order.user`. If XCM is available, the intent is executed via XCM.
     *         Otherwise, the intent is executed via the base settler.
     * @param order StandardOrder representing the intent.
     */
    function open(StandardOrder calldata order) external nonReentrant {
        if (_checkXCMAvailable(order)) {
            _validateInputChain(order.originChainId);
            _validateTimestampHasNotPassed(order.fillDeadline);
            _validateTimestampHasNotPassed(order.expires);
            TransferAmount[] memory transferAmounts = _calculateTransferAmounts(order, true);
            _collectAndApproveTokens(transferAmounts, xcmPrecompile);
            _executeXCM(order);
            _disableApprovals(transferAmounts, xcmPrecompile);
        } else {
            TransferAmount[] memory transferAmounts = _calculateTransferAmounts(order, false);
            _collectAndApproveTokens(transferAmounts, baseSettler);
            InputSettlerEscrow(baseSettler).open(order);
        }
    }

    /**
     * @notice Collects tokens from the sender and approves them for the recipient.
     * @param transferAmounts Array of TransferAmount structs containing the amount and token.
     * @param recipient Address to collect tokens from.
     */
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
    /**
     * @notice Disables approvals for the tokens for the recipient after the order was processed.
     * @param transferAmounts Array of TransferAmount structs containing the amount and token.
     * @param recipient Address to disable approvals for.
     */
    function _disableApprovals(TransferAmount[] memory transferAmounts, address recipient) private {
        uint256 numTransfers = transferAmounts.length;
        for (uint256 i = 0; i < numTransfers; ++i) {
            TransferAmount memory transfer = transferAmounts[i];
            IERC20 token = IERC20(transfer.token);
            SafeERC20.forceApprove(token, recipient, 0);
        }
    }

    /**
     * @dev Returns an array of TransferAmount structs for order inputs or outputs.
     * @param order The StandardOrder containing inputs/outputs.
     * @param fromOutputs If true, use outputs; if false, use inputs.
     */
    function _calculateTransferAmounts(StandardOrder calldata order, bool fromOutputs) private pure returns (TransferAmount[] memory) {
        uint256 length = fromOutputs ? order.outputs.length : order.inputs.length;
        TransferAmount[] memory transferAmounts = new TransferAmount[](length);
        for (uint256 i = 0; i < length; ++i) {
            if (fromOutputs) {
                MandateOutput calldata output = order.outputs[i];
                transferAmounts[i] = TransferAmount({ amount: output.amount, token: output.token.fromIdentifier() });
            } else {
                uint256[2] calldata input = order.inputs[i];
                transferAmounts[i] = TransferAmount({ amount: input[1], token: input[0].validatedCleanAddress() });
            }
        }
        return transferAmounts;
    }

    /**
     * @dev Checks whether XCM (Cross-Consensus Messaging) settlement is available for the given order.
     * Validates feature flag, presence and validity of order inputs/outputs, and ensures teleport and amount constraints.
     * @param order The StandardOrder struct containing input and output requirements.
     * @return available True if XCM settlement is available for the order, false otherwise.
     */
    function _checkXCMAvailable(
        StandardOrder calldata order
    ) private view returns (bool) {
        return xcmEnabled 
            && order.inputs.length > 0 
            && order.outputs.length > 0 
            && _validateOutputsForXCM(order.outputs) 
            && _validateInputsForXCM(order.inputs) 
            && _verifyInputsCoverOutputs(order.inputs, order.outputs);
    }
     
    /**
     * @dev Validates that all outputs are suitable for XCM (Cross-Consensus Messaging) settlement.
     * Checks that each output has:
     * - A non-zero recipient.
     * - No embedded contract call or context.
     * - A valid chainId below the XCM maximum.
     * - The token and chain combination is approved for teleport.
     * - The output amount does not exceed the max allowed.
     * @param outputs Array of MandateOutput to validate.
     * @return True if all outputs are XCM-compatible, false otherwise.
     */
    function _validateOutputsForXCM(MandateOutput[] calldata outputs) private view returns (bool) {
        uint256 numOutputs = outputs.length;
        for (uint256 i = 0; i < numOutputs; ++i) {
            MandateOutput calldata output = outputs[i];
            if (output.recipient == bytes32(0)) return false;
            if (output.call.length != 0 || output.context.length != 0) return false;
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

    /**
     * @dev Validates that each XCM input does not exceed the maximum allowed amount.
     * @param inputs Array of input token and amount pairs for XCM settlement.
     * @return True if all input amounts are within the allowed XCM maximum, false otherwise.
     */
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

    /**
     * @dev Checks whether the provided input tokens can fully cover the required output amounts per token.
     *
     * For each output, aggregates the required amounts by token address.
     * Then subtracts any provided input amounts for those tokens.
     * Returns true if all required outputs are fully covered by the corresponding inputs, false otherwise.
     *
     * @param inputs Array of [token, amount] pairs representing available input tokens.
     * @param outputs Array of MandateOutput specifying required output tokens and amounts.
     * @return True if all outputs are covered by the inputs per token, false otherwise.
     */
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

    /**
     * @notice Calls InputSettlerEscrow.finalise with the given parameters.
     * @dev This is a passthrough to the base settler's finalise method.
     */
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

    /**
     * @notice Calls InputSettlerEscrow.finaliseWithSignature with the given parameters.
     * @dev This is a passthrough to the base settler's finaliseWithSignature method.
     */
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

    /**
     * @notice Calls InputSettlerEscrow.orderIdentifier with the given parameters.
     * @dev This is a passthrough to the base settler's orderIdentifier method.
     */
    function orderIdentifier(
        StandardOrder memory order
    ) external view returns (bytes32) {
        return InputSettlerEscrow(baseSettler).orderIdentifier(order);
    }

    /**
     * @notice Calls InputSettlerEscrow.purchaseOrder with the given parameters.
     * @dev This is a passthrough to the base settler's purchaseOrder method.
     */
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

    /**
     * @notice Allows teleportation of a specific ERC20 token to a given destination parachain.
     * @dev Sets the teleport permission for the (destination, token) pair to true.
     * Only callable by the contract owner.
     * @param destination The parachain ID to allow teleporting to.
     * @param token The address of the ERC20 token to permit for teleportation.
     */
    function allowTeleport(
        uint32 destination,
        address token
    ) external onlyOwner {
        bytes32 key = keccak256(abi.encode(destination, token));
        teleportAllowed[key] = true;
        emit TeleportAllowed(destination, token);
    }

    /**
     * @notice Forbids teleportation of a specific ERC20 token to a given destination parachain.
     * @dev Removes teleport permission for the (destination, token) pair.
     * Only callable by the contract owner.
     * @param destination The parachain ID to disallow teleporting to.
     * @param token The address of the ERC20 token to forbid for teleportation.
     */
    function forbidTeleport(
        uint32 destination,
        address token
    ) external onlyOwner {
        bytes32 key = keccak256(abi.encode(destination, token));
        teleportAllowed[key] = false;
        emit TeleportForbidden(destination, token);
    }

    /**
     * @notice Enables or disables XCM (Cross-Consensus Messaging) functionality.
     * @dev Only callable by the contract owner.
     * @param enabled Boolean flag to set XCM enabled (true) or disabled (false).
     * Emits a {XCMEnabledChanged} event.
     */
    function setXCMEnabled(bool enabled) external onlyOwner {
        xcmEnabled = enabled;
        emit XCMEnabledChanged(enabled);
    }

    /**
     * @dev Searches for an address (`needle`) in the first `len` elements of the `haystack` array.
     * @param needle The address to search for.
     * @param haystack The array of addresses to search within.
     * @param len The number of elements in `haystack` to consider during the search.
     * @return The index of `needle` if found; otherwise, returns `len`.
     */
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
