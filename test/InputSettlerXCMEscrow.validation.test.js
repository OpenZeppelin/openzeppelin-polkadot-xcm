const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    setupInputSettlerXCMEscrow,
    createOrderFactory,
    createOutput,
    DESTINATION_CHAIN_ID,
    DESTINATION_CHAIN_ID_2,
    INITIAL_TOKEN_BALANCE,
    STANDARD_AMOUNT,
    SMALL_AMOUNT,
    MEDIUM_AMOUNT,
    LARGE_AMOUNT,
    DOUBLE_AMOUNT,
    MOCK_XCM_MESSAGE_BYTES
} = require("./helpers/inputSettlerXCMEscrowHelper");

describe("InputSettlerXCMEscrow - Input/Output Validation", function () {
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

    describe("Input/output validation", function () {
        it("Should accept when input amount exactly matches output amount", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed");
        });

        it("Should accept when input amount exceeds output amount", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther(LARGE_AMOUNT)]],
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(LARGE_AMOUNT));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed");
        });

        it("Should fall back to baseSettler when output amount exceeds input amount", async function () {
            // Insufficient inputs for XCM - falls back to baseSettler
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther(SMALL_AMOUNT)]],
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(SMALL_AMOUNT));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });

        it("Should handle input token not present in outputs", async function () {
            const token2 = await ethers.deployContract("MockERC20", ["Test2", "TST2"]);
            await token2.waitForDeployment();
            await token2.mint(user, ethers.parseEther(INITIAL_TOKEN_BALANCE));

            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder({
                inputs: [
                    [await token.getAddress(), ethers.parseEther(STANDARD_AMOUNT)],
                    [await token2.getAddress(), ethers.parseEther(SMALL_AMOUNT)] // Extra input not in outputs
                ],
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));
            await token2.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(SMALL_AMOUNT));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            // Extra inputs are OK - XCM still executes
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed");
        });

        it("Should fall back when output tokens not covered by inputs", async function () {
            const token2 = await ethers.deployContract("MockERC20", ["Test2", "TST2"]);
            await token2.waitForDeployment();

            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token2.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther(STANDARD_AMOUNT)]],
                outputs: [
                    createOutput(await token.getAddress(), user.address, {
                        amount: ethers.parseEther(SMALL_AMOUNT)
                    }),
                    createOutput(await token2.getAddress(), user.address, {
                        amount: ethers.parseEther(SMALL_AMOUNT) // No input for this token
                    })
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });

        it("Should fall back when input token does not match output token", async function () {
            const token2 = await ethers.deployContract("MockERC20", ["Test2", "TST2"]);
            await token2.waitForDeployment();

            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token2.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther(STANDARD_AMOUNT)]],
                outputs: [createOutput(await token2.getAddress(), user.address)] // Different token
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });

        it("Should aggregate multiple outputs with same token correctly", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID_2, await token.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther(DOUBLE_AMOUNT)]],
                outputs: [
                    createOutput(await token.getAddress(), user.address, {
                        chainId: DESTINATION_CHAIN_ID,
                        amount: ethers.parseEther(MEDIUM_AMOUNT)
                    }),
                    createOutput(await token.getAddress(), user.address, {
                        chainId: DESTINATION_CHAIN_ID_2,
                        amount: ethers.parseEther(MEDIUM_AMOUNT)
                    })
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(DOUBLE_AMOUNT));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            // Total outputs = 160, input = 200, should pass
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed");
        });

        it("Should fall back if aggregated outputs exceed input", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID_2, await token.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther(LARGE_AMOUNT)]],
                outputs: [
                    createOutput(await token.getAddress(), user.address, {
                        chainId: DESTINATION_CHAIN_ID,
                        amount: ethers.parseEther(MEDIUM_AMOUNT)
                    }),
                    createOutput(await token.getAddress(), user.address, {
                        chainId: DESTINATION_CHAIN_ID_2,
                        amount: ethers.parseEther(MEDIUM_AMOUNT)
                    })
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(LARGE_AMOUNT));

            // Total outputs = 160, input = 150, should fall back
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });
    });

    describe("Multiple outputs", function () {
        it("Should handle multiple outputs to different destinations", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID_2, await token.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther(DOUBLE_AMOUNT)]],
                outputs: [
                    createOutput(await token.getAddress(), user.address, {
                        chainId: DESTINATION_CHAIN_ID,
                        amount: ethers.parseEther(STANDARD_AMOUNT)
                    }),
                    createOutput(await token.getAddress(), user.address, {
                        chainId: DESTINATION_CHAIN_ID_2,
                        amount: ethers.parseEther(STANDARD_AMOUNT)
                    })
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(DOUBLE_AMOUNT));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed")
                .withArgs(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
        });
    });
});
