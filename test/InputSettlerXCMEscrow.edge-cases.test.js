const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    setupInputSettlerXCMEscrow,
    createOrderFactory,
    createOutput,
    toBytes32,
    DESTINATION_CHAIN_ID,
    INITIAL_TOKEN_BALANCE,
    STANDARD_AMOUNT,
    ZERO_BYTES32,
    MAX_TOKENS_TEST_COUNT,
    MOCK_XCM_MESSAGE_BYTES
} = require("./helpers/inputSettlerXCMEscrowHelper");

describe("InputSettlerXCMEscrow - Edge Cases", function () {
    let inputSettlerXCMEscrow;
    let token;
    let owner;
    let user;
    let mockXcm;
    let mockLibrary;
    let baseSettler;
    let chainId;
    let createOrder;

    beforeEach(async function () {
        const setup = await setupInputSettlerXCMEscrow();
        owner = setup.owner;
        user = setup.user;
        mockXcm = setup.mockXcm;
        mockLibrary = setup.mockLibrary;
        baseSettler = setup.baseSettler;
        inputSettlerXCMEscrow = setup.inputSettlerXCMEscrow;
        token = setup.token;
        chainId = setup.chainId;
        createOrder = createOrderFactory(user, token, chainId);
    });

    describe("Edge cases", function () {
        it("Should handle empty inputs array", async function () {
            const order = createOrder({
                inputs: [],
                outputs: [createOutput(await token.getAddress(), user.address)]
            });

            // Empty inputs causes fallback path
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.not.be.reverted;
        });

        it("Should handle empty outputs array", async function () {
            const order = createOrder({
                outputs: []
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));

            // Empty outputs - XCM executes with no teleports
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.not.be.reverted;
        });

        it("Should accept zero recipient address", async function () {
            // Note: Zero recipient is accepted - this is user's responsibility
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder({
                outputs: [createOutput(await token.getAddress(), user.address, {
                    recipient: toBytes32(ZERO_BYTES32)
                })]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.not.be.reverted;
        });

        it("Should handle maximum number of distinct tokens", async function () {
            const tokens = [];

            for (let i = 0; i < MAX_TOKENS_TEST_COUNT; i++) {
                const t = await ethers.deployContract("MockERC20", [`Test${i}`, `TST${i}`]);
                await t.waitForDeployment();
                await t.mint(user, ethers.parseEther(INITIAL_TOKEN_BALANCE));
                tokens.push(t);
                await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await t.getAddress());
            }

            const inputs = [];
            const outputs = [];
            for (let i = 0; i < MAX_TOKENS_TEST_COUNT; i++) {
                inputs.push([await tokens[i].getAddress(), ethers.parseEther(STANDARD_AMOUNT)]);
                outputs.push(createOutput(await tokens[i].getAddress(), user.address));
                await tokens[i].connect(user).approve(
                    await inputSettlerXCMEscrow.getAddress(),
                    ethers.parseEther(STANDARD_AMOUNT)
                );
            }

            const order = createOrder({ inputs, outputs });

            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed");
        });
    });

    describe("Amount overflow protection", function () {
        it("Should handle near-overflow amounts safely", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            // Large amounts that sum to near uint256.max
            const UINT255 = BigInt("2") ** BigInt("255");
            const totalAmount = UINT255 * BigInt("2") - BigInt("1");

            await token.mint(user, totalAmount - ethers.parseEther(INITIAL_TOKEN_BALANCE));

            const halfAmount = totalAmount / BigInt("2");

            const order = createOrder({
                inputs: [[await token.getAddress(), totalAmount]],
                outputs: [
                    createOutput(await token.getAddress(), user.address, { amount: halfAmount }),
                    createOutput(await token.getAddress(), user.address, { amount: halfAmount })
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), totalAmount);
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            // Should handle without overflow
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.not.be.reverted;
        });
    });
});
