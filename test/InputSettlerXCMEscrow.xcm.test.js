const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    setupInputSettlerXCMEscrow,
    createOrderFactory,
    createOutput,
    toBytes32,
    DESTINATION_CHAIN_ID,
    DISALLOWED_CHAIN_ID,
    UINT32_MAX_PLUS_ONE,
    UINT128_MAX,
    ONE_ETHER_WEI,
    INITIAL_TOKEN_BALANCE,
    STANDARD_AMOUNT,
    LARGE_AMOUNT,
    DOUBLE_AMOUNT,
    TRIPLE_AMOUNT,
    MOCK_XCM_MESSAGE_1,
    MOCK_XCM_MESSAGE_2,
    MOCK_XCM_MESSAGE_BYTES
} = require("./helpers/inputSettlerXCMEscrowHelper");

describe("InputSettlerXCMEscrow - XCM Logic", function () {
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

    describe("_checkXCMAvailable", function () {
        it("Should fall back to baseSettler for orders with chainId > uint32.max", async function () {
            const order = createOrder({
                outputs: [createOutput(await token.getAddress(), user.address, {
                    chainId: UINT32_MAX_PLUS_ONE
                })]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.be.emit(baseSettler, "Open");
        });

        it("Should fall back to baseSettler if teleport not allowed", async function () {
            // Don't allow teleport - should fall back to baseSettler
            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });

        it("Should use XCM path when teleport is allowed", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));
            await mockLibrary.setTeleportMessage(MOCK_XCM_MESSAGE_2);
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed")
                .withArgs(MOCK_XCM_MESSAGE_2);
        });

        it("Should fall back to baseSettler for amounts exceeding uint128.max", async function () {
            // Amounts > uint128.max cannot be handled by XCM (uint128 type limitation)
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const overflowAmount = UINT128_MAX + ONE_ETHER_WEI;

            await token.mint(user, overflowAmount);

            const order = createOrder({
                inputs: [[await token.getAddress(), overflowAmount]],
                outputs: [createOutput(await token.getAddress(), user.address, {
                    amount: overflowAmount
                })]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), overflowAmount);
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            // Falls back to baseSettler instead of silently truncating
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");

            // XCM contract should have no tokens
            const contractBalance = await token.balanceOf(await inputSettlerXCMEscrow.getAddress());
            expect(contractBalance).to.equal(0);
        });
    });

    describe("open", function () {
        it("Should execute XCM when available", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));
            await mockLibrary.setTeleportMessage(MOCK_XCM_MESSAGE_1);
            await mockXcm.setExecutionSuccess(true);

            const expectedAmount = ethers.parseEther(STANDARD_AMOUNT);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockLibrary, "TeleportCalled")
                .withArgs(DESTINATION_CHAIN_ID, toBytes32(user.address), expectedAmount)
                .and.to.emit(mockXcm, "Executed")
                .withArgs(MOCK_XCM_MESSAGE_1);
        });

        it("Should fall back to baseSettler when XCM not available", async function () {
            const order = createOrder({
                outputs: [createOutput(await token.getAddress(), user.address, {
                    chainId: DISALLOWED_CHAIN_ID
                })]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });

        it("Should revert if XCM precompile fails", async function () {
            // If XCM precompile reverts, entire transaction reverts - user funds safe
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(false); // Simulate failure

            const userBalanceBefore = await token.balanceOf(user.address);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.be.revertedWith("MockXcm: execution failed");

            // Verify tokens were not taken
            const userBalanceAfter = await token.balanceOf(user.address);
            expect(userBalanceAfter).to.equal(userBalanceBefore);
        });
    });

    // OpenFor flow is not implemented yet
    describe.skip("openFor", function () {
        it("Should execute XCM when available with signature", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));
            await mockLibrary.setTeleportMessage(MOCK_XCM_MESSAGE_1);
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).openFor(order, user.address, "0x"))
                .to.emit(mockXcm, "Executed");
        });
    });

    describe("Token collection", function () {
        it("Should collect only output amounts in XCM path (not full inputs)", async function () {
            // XCM path collects outputs, excess inputs remain with user
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const inputAmount = ethers.parseEther(LARGE_AMOUNT);
            const outputAmount = ethers.parseEther(STANDARD_AMOUNT);

            const order = createOrder({
                inputs: [[await token.getAddress(), inputAmount]],
                outputs: [createOutput(await token.getAddress(), user.address, {
                    amount: outputAmount
                })]
            });

            const userBalanceBefore = await token.balanceOf(user.address);

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), inputAmount);
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            await inputSettlerXCMEscrow.connect(user).open(order);

            const userBalanceAfter = await token.balanceOf(user.address);

            // User only loses output amount, not full input
            expect(userBalanceBefore - userBalanceAfter).to.equal(outputAmount);
        });

        it("Should collect full input amounts in baseSettler path", async function () {
            // BaseSettler path uses input amounts (standard escrow behavior)
            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther(STANDARD_AMOUNT)]],
                outputs: [createOutput(await token.getAddress(), user.address, {
                    chainId: DISALLOWED_CHAIN_ID,
                    amount: ethers.parseEther("80")
                })]
            });

            const userBalanceBefore = await token.balanceOf(user.address);

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));

            await inputSettlerXCMEscrow.connect(user).open(order);

            const userBalanceAfter = await token.balanceOf(user.address);

            // BaseSettler takes full input amount
            expect(userBalanceBefore - userBalanceAfter).to.equal(ethers.parseEther(STANDARD_AMOUNT));
        });

        it("Should collect multiple output tokens correctly", async function () {
            const token2 = await ethers.deployContract("MockERC20", ["Test2", "TST2"]);
            await token2.waitForDeployment();
            await token2.mint(user, ethers.parseEther(INITIAL_TOKEN_BALANCE));

            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token2.getAddress());

            const input1 = ethers.parseEther(DOUBLE_AMOUNT);
            const input2 = ethers.parseEther(TRIPLE_AMOUNT);
            const output1 = ethers.parseEther(LARGE_AMOUNT);
            const output2 = ethers.parseEther(DOUBLE_AMOUNT);

            const order = createOrder({
                inputs: [
                    [await token.getAddress(), input1],
                    [await token2.getAddress(), input2]
                ],
                outputs: [
                    createOutput(await token.getAddress(), user.address, { amount: output1 }),
                    createOutput(await token2.getAddress(), user.address, { amount: output2 })
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), input1);
            await token2.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), input2);
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            await inputSettlerXCMEscrow.connect(user).open(order);

            // Only output amounts are collected
            const token1InContract = await token.balanceOf(await inputSettlerXCMEscrow.getAddress());
            const token2InContract = await token2.balanceOf(await inputSettlerXCMEscrow.getAddress());

            expect(token1InContract).to.equal(output1);
            expect(token2InContract).to.equal(output2);
        });

        it("Should approve xcmPrecompile in XCM path (not baseSettler)", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes(MOCK_XCM_MESSAGE_BYTES));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order)).to.emit(inputSettlerXCMEscrow, "XCMTeleportExecuted");

            // XCM path approves xcmPrecompile, not baseSettler
            const baseSettlerAllowance = await token.allowance(
                await inputSettlerXCMEscrow.getAddress(),
                await baseSettler.getAddress()
            );
            const xcmAllowance = await token.allowance(
                await inputSettlerXCMEscrow.getAddress(),
                await mockXcm.getAddress()
            );

            expect(baseSettlerAllowance).to.equal(0);
            expect(xcmAllowance).to.equal(0);
        });
    });
});
