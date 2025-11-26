const { ethers } = require("hardhat");

// =============================================================================
// Test Constants
// =============================================================================

// Chain IDs for testing
const DESTINATION_CHAIN_ID = 1000;
const DESTINATION_CHAIN_ID_2 = 2000;
const DISALLOWED_CHAIN_ID = 1001;

// Numeric limits
const UINT32_MAX_PLUS_ONE = BigInt("0x100000000"); // 2^32, exceeds uint32.max
const UINT128_MAX = BigInt("340282366920938463463374607431768211455"); // 2^128 - 1
const ONE_ETHER_WEI = BigInt("1000000000000000000"); // 10^18

// Token amounts (in ether)
const INITIAL_TOKEN_BALANCE = "1000";
const STANDARD_AMOUNT = "100";
const SMALL_AMOUNT = "50";
const MEDIUM_AMOUNT = "80";
const LARGE_AMOUNT = "150";
const DOUBLE_AMOUNT = "200";
const TRIPLE_AMOUNT = "300";

// Time constants (in seconds)
const ONE_HOUR = 3600;

// Mock XCM message payloads
const MOCK_XCM_MESSAGE_1 = "0xabcdef";
const MOCK_XCM_MESSAGE_2 = "0x123456";
const MOCK_XCM_MESSAGE_BYTES = "0xmsg";

// Bytes32 placeholder values
const SETTLER_PLACEHOLDER = "0x01";
const ORACLE_PLACEHOLDER = "0x02";
const ZERO_BYTES32 = "0x00";
const BYTES32_LENGTH = 32;

// Test configuration
const MAX_TOKENS_TEST_COUNT = 10;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates a bytes32 value from a hex string
 */
function toBytes32(value) {
    return ethers.zeroPadValue(value, BYTES32_LENGTH);
}

/**
 * Sets up the test environment for InputSettlerXCMEscrow tests.
 * Returns all deployed contracts and signers.
 */
async function setupInputSettlerXCMEscrow() {
    const [owner, user, solver] = await ethers.getSigners();

    // Deploy mock contracts
    const mockXcm = await ethers.deployContract('MockXcm');
    await mockXcm.waitForDeployment();

    const mockLibrary = await ethers.deployContract('MockLibrary');
    await mockLibrary.waitForDeployment();

    const baseSettler = await ethers.deployContract('InputSettlerEscrow');
    await baseSettler.waitForDeployment();

    // Deploy InputSettlerXCMEscrow
    const inputSettlerXCMEscrow = await ethers.deployContract("InputSettlerXCMEscrow",
        [
            await mockLibrary.getAddress(),
            await mockXcm.getAddress(),
            await baseSettler.getAddress()
        ]
    );
    await inputSettlerXCMEscrow.waitForDeployment();

    const token = await ethers.deployContract("MockERC20", ["Test", "TST"]);
    await token.waitForDeployment();
    await token.mint(user, ethers.parseEther(INITIAL_TOKEN_BALANCE));

    const network = await ethers.provider.getNetwork();
    const chainId = network.chainId;

    return {
        owner,
        user,
        solver,
        mockXcm,
        mockLibrary,
        baseSettler,
        inputSettlerXCMEscrow,
        token,
        chainId
    };
}

/**
 * Creates a standard order structure with optional overrides.
 */
function createOrderFactory(user, token, chainId) {
    return function createOrder(overrides = {}) {
        const now = Math.floor(Date.now() / 1000);
        return {
            user: user.address,
            nonce: 0,
            originChainId: chainId,
            expires: now + ONE_HOUR,
            fillDeadline: now + ONE_HOUR,
            inputOracle: ethers.ZeroAddress,
            inputs: [[token.target, ethers.parseEther(STANDARD_AMOUNT)]],
            outputs: [{
                settler: toBytes32(SETTLER_PLACEHOLDER),
                oracle: toBytes32(ORACLE_PLACEHOLDER),
                chainId: DESTINATION_CHAIN_ID,
                token: toBytes32(token.target),
                amount: ethers.parseEther(STANDARD_AMOUNT),
                recipient: toBytes32(user.address),
                call: "0x",
                context: "0x"
            }],
            ...overrides
        };
    };
}

/**
 * Creates a standard output object for use in tests
 */
function createOutput(token, user, overrides = {}) {
    return {
        settler: toBytes32(SETTLER_PLACEHOLDER),
        oracle: toBytes32(ORACLE_PLACEHOLDER),
        chainId: DESTINATION_CHAIN_ID,
        token: toBytes32(token),
        amount: ethers.parseEther(STANDARD_AMOUNT),
        recipient: toBytes32(user),
        call: "0x",
        context: "0x",
        ...overrides
    };
}

module.exports = {
    // Constants
    DESTINATION_CHAIN_ID,
    DESTINATION_CHAIN_ID_2,
    DISALLOWED_CHAIN_ID,
    UINT32_MAX_PLUS_ONE,
    UINT128_MAX,
    ONE_ETHER_WEI,
    INITIAL_TOKEN_BALANCE,
    STANDARD_AMOUNT,
    SMALL_AMOUNT,
    MEDIUM_AMOUNT,
    LARGE_AMOUNT,
    DOUBLE_AMOUNT,
    TRIPLE_AMOUNT,
    ONE_HOUR,
    MOCK_XCM_MESSAGE_1,
    MOCK_XCM_MESSAGE_2,
    MOCK_XCM_MESSAGE_BYTES,
    SETTLER_PLACEHOLDER,
    ORACLE_PLACEHOLDER,
    ZERO_BYTES32,
    BYTES32_LENGTH,
    MAX_TOKENS_TEST_COUNT,
    // Functions
    toBytes32,
    setupInputSettlerXCMEscrow,
    createOrderFactory,
    createOutput
};
