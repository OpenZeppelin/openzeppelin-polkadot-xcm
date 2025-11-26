const { expect } = require("chai");
const { ethers, config } = require("hardhat");

describe("InputSettlerXCMEscrow", function () {
    let InputSettlerXCMEscrow;
    let inputSettlerXCMEscrow;
    let token;
    let owner;
    let user;
    let solver;
    let mockXcm;
    let mockLibrary;
    let baseSettler;
    let chainId;

    beforeEach(async function () {
        [owner, user, solver] = await ethers.getSigners();

        // Deploy mock contracts
        mockXcm = await ethers.deployContract('MockXcm');
        await mockXcm.waitForDeployment();

        mockLibrary = await ethers.deployContract('MockLibrary');
        await mockLibrary.waitForDeployment();

        baseSettler = await ethers.deployContract('InputSettlerEscrow');
        await baseSettler.waitForDeployment();

        // Deploy InputSettlerXCMEscrow
        inputSettlerXCMEscrow = await ethers.deployContract("InputSettlerXCMEscrow",
            [
                await mockLibrary.getAddress(),
                await mockXcm.getAddress(),
                await baseSettler.getAddress()
            ]
        );
        await inputSettlerXCMEscrow.waitForDeployment();

        token = await ethers.deployContract("MockERC20", ["Test", "TST"]);
        await token.waitForDeployment();
        await token.mint(user, ethers.parseEther("1000.0"));

        const network = await ethers.provider.getNetwork();
        chainId = network.chainId;
    });

    // Helper to create a standard order structure
    function createOrder(overrides = {}) {
        return {
            user: user.address,
            nonce: 0,
            originChainId: chainId,
            expires: Math.floor(Date.now() / 1000) + 3600,
            fillDeadline: Math.floor(Date.now() / 1000) + 3600,
            inputOracle: ethers.ZeroAddress,
            inputs: [[token.target, ethers.parseEther("100")]],
            outputs: [{
                settler: ethers.zeroPadValue("0x01", 32),
                oracle: ethers.zeroPadValue("0x02", 32),
                chainId: 1000,
                token: ethers.zeroPadValue(token.target, 32),
                amount: ethers.parseEther("100"),
                recipient: ethers.zeroPadValue(user.address, 32),
                call: "0x",
                context: "0x"
            }],
            ...overrides
        };
    }

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await inputSettlerXCMEscrow.owner()).to.equal(owner.address);
        });
    });

    describe("allowTeleport", function () {
        it("Should allow teleport for a destination and token", async function () {
            const destination = 1000;
            const tokenAddress = await token.getAddress();

            await expect(inputSettlerXCMEscrow.allowTeleport(destination, tokenAddress))
                .to.emit(inputSettlerXCMEscrow, "TeleportAllowed")
                .withArgs(destination, tokenAddress);
        });

        it("Should revert if not called by owner", async function () {
            const destination = 1000;
            const tokenAddress = await token.getAddress();

            await expect(
                inputSettlerXCMEscrow.connect(user).allowTeleport(destination, tokenAddress)
            ).to.be.revertedWithCustomError(inputSettlerXCMEscrow, "OwnableUnauthorizedAccount")
                .withArgs(user.address);
        });
    });

    describe("forbidTeleport", function () {
        it("Should forbid teleport for a destination and token", async function () {
            const destination = 1000;
            const tokenAddress = await token.getAddress();

            await inputSettlerXCMEscrow.allowTeleport(destination, tokenAddress);

            await expect(inputSettlerXCMEscrow.forbidTeleport(destination, tokenAddress))
                .to.emit(inputSettlerXCMEscrow, "TeleportForbidden")
                .withArgs(destination, tokenAddress);
        });
    });

    describe("setXCMEnabled", function () {
        it("Should fall back to baseSettler when XCM is disabled for valid XCM order", async function () {
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder();

            // Verify XCM path would work normally
            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("200"));
            await mockLibrary.setTeleportMessage("0xabcdef");
            await mockXcm.setExecutionSuccess(true);

            // Disable XCM globally
            await inputSettlerXCMEscrow.setXCMEnabled(false);

            // Should fall back to baseSettler despite valid XCM configuration
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");

            // Verify XCM was not called
            const xcmAllowance = await token.allowance(
                await inputSettlerXCMEscrow.getAddress(),
                await mockXcm.getAddress()
            );
            expect(xcmAllowance).to.equal(0);
        });

        it("Should resume XCM path when re-enabled", async function () {
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));
            await mockLibrary.setTeleportMessage("0xabcdef");
            await mockXcm.setExecutionSuccess(true);

            // Disable then re-enable XCM
            await inputSettlerXCMEscrow.setXCMEnabled(false);
            await inputSettlerXCMEscrow.setXCMEnabled(true);

            // Should use XCM path again
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed")
                .withArgs("0xabcdef");
        });

        it("Should revert if not called by owner", async function () {
            await expect(
                inputSettlerXCMEscrow.connect(user).setXCMEnabled(false)
            ).to.be.revertedWithCustomError(inputSettlerXCMEscrow, "OwnableUnauthorizedAccount")
                .withArgs(user.address);
        });
    });

    describe("_checkXCMAvailable", function () {
        it("Should fall back to baseSettler for orders with chainId > uint32.max", async function () {
            const largeChainId = BigInt("0x100000000"); // > 2^32 - 1
            const order = createOrder({
                outputs: [{
                    settler: ethers.zeroPadValue("0x01", 32),
                    oracle: ethers.zeroPadValue("0x02", 32),
                    chainId: largeChainId,
                    token: ethers.zeroPadValue(await token.getAddress(), 32),
                    amount: ethers.parseEther("100"),
                    recipient: ethers.zeroPadValue(user.address, 32),
                    call: "0x",
                    context: "0x"
                }]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.be.emit(baseSettler, "Open");
        });

        it("Should fall back to baseSettler if teleport not allowed", async function () {
            // Don't allow teleport - should fall back to baseSettler
            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });

        it("Should use XCM path when teleport is allowed", async function () {
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));
            await mockLibrary.setTeleportMessage("0x123456");
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed")
                .withArgs("0x123456");
        });

        it("Should fall back to baseSettler for amounts exceeding uint128.max", async function () {
        // Amounts > uint128.max cannot be handled by XCM (uint128 type limitation)
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const uint128Max = BigInt("340282366920938463463374607431768211455");
            const overflowAmount = uint128Max + BigInt("1000000000000000000");

            await token.mint(user, overflowAmount);

            const order = createOrder({
                inputs: [[await token.getAddress(), overflowAmount]],
                outputs: [{
                    settler: ethers.zeroPadValue("0x01", 32),
                    oracle: ethers.zeroPadValue("0x02", 32),
                    chainId: destination,
                    token: ethers.zeroPadValue(await token.getAddress(), 32),
                    amount: overflowAmount,
                    recipient: ethers.zeroPadValue(user.address, 32),
                    call: "0x",
                    context: "0x"
                }]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), overflowAmount);
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
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
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));
            await mockLibrary.setTeleportMessage("0xabcdef");
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockLibrary, "TeleportCalled")
                .withArgs(destination, ethers.zeroPadValue(user.address, 32), 100000000000000000000n)
                .and.to.emit(mockXcm, "Executed")
                .withArgs("0xabcdef");
        });

        it("Should fall back to baseSettler when XCM not available", async function () {
            const order = createOrder({
                outputs: [{
                    settler: ethers.zeroPadValue("0x01", 32),
                    oracle: ethers.zeroPadValue("0x02", 32),
                    chainId: 1001, // Not allowed
                    token: ethers.zeroPadValue(await token.getAddress(), 32),
                    amount: ethers.parseEther("100"),
                    recipient: ethers.zeroPadValue(user.address, 32),
                    call: "0x",
                    context: "0x"
                }]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));

            await expect(await inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });

        it("Should revert if XCM precompile fails", async function () {
            // If XCM precompile reverts, entire transaction reverts - user funds safe
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
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
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));
            await mockLibrary.setTeleportMessage("0xabcdef");
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).openFor(order, user.address, "0x"))
                .to.emit(mockXcm, "Executed");
        });
    });

    describe("Token collection", function () {
        it("Should collect only output amounts in XCM path (not full inputs)", async function () {
            // XCM path collects outputs, excess inputs remain with user
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const inputAmount = ethers.parseEther("150");
            const outputAmount = ethers.parseEther("100");

            const order = createOrder({
                inputs: [[await token.getAddress(), inputAmount]],
                outputs: [{
                    settler: ethers.zeroPadValue("0x01", 32),
                    oracle: ethers.zeroPadValue("0x02", 32),
                    chainId: destination,
                    token: ethers.zeroPadValue(await token.getAddress(), 32),
                    amount: outputAmount,
                    recipient: ethers.zeroPadValue(user.address, 32),
                    call: "0x",
                    context: "0x"
                }]
            });

            const userBalanceBefore = await token.balanceOf(user.address);

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), inputAmount);
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
            await mockXcm.setExecutionSuccess(true);

            await inputSettlerXCMEscrow.connect(user).open(order);

            const userBalanceAfter = await token.balanceOf(user.address);

            // User only loses output amount, not full input
            expect(userBalanceBefore - userBalanceAfter).to.equal(outputAmount);
        });

        it("Should collect full input amounts in baseSettler path", async function () {
            // BaseSettler path uses input amounts (standard escrow behavior)
            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther("100")]],
                outputs: [{
                    settler: ethers.zeroPadValue("0x01", 32),
                    oracle: ethers.zeroPadValue("0x02", 32),
                    chainId: 1001, // Not allowed - will use baseSettler
                    token: ethers.zeroPadValue(await token.getAddress(), 32),
                    amount: ethers.parseEther("80"),
                    recipient: ethers.zeroPadValue(user.address, 32),
                    call: "0x",
                    context: "0x"
                }]
            });

            const userBalanceBefore = await token.balanceOf(user.address);

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));

            await inputSettlerXCMEscrow.connect(user).open(order);

            const userBalanceAfter = await token.balanceOf(user.address);

            // BaseSettler takes full input amount
            expect(userBalanceBefore - userBalanceAfter).to.equal(ethers.parseEther("100"));
        });

        it("Should collect multiple output tokens correctly", async function () {
            const destination = 1000;
            const token2 = await ethers.deployContract("MockERC20", ["Test2", "TST2"]);
            await token2.waitForDeployment();
            await token2.mint(user, ethers.parseEther("1000"));

            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());
            await inputSettlerXCMEscrow.allowTeleport(destination, await token2.getAddress());

            const input1 = ethers.parseEther("200");
            const input2 = ethers.parseEther("300");
            const output1 = ethers.parseEther("150");
            const output2 = ethers.parseEther("200");

            const order = createOrder({
                inputs: [
                    [await token.getAddress(), input1],
                    [await token2.getAddress(), input2]
                ],
                outputs: [
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination,
                        token: ethers.zeroPadValue(await token.getAddress(), 32),
                        amount: output1,
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    },
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination,
                        token: ethers.zeroPadValue(await token2.getAddress(), 32),
                        amount: output2,
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    }
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), input1);
            await token2.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), input2);
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
            await mockXcm.setExecutionSuccess(true);

            await inputSettlerXCMEscrow.connect(user).open(order);

            // Only output amounts are collected
            const token1InContract = await token.balanceOf(await inputSettlerXCMEscrow.getAddress());
            const token2InContract = await token2.balanceOf(await inputSettlerXCMEscrow.getAddress());

            expect(token1InContract).to.equal(output1);
            expect(token2InContract).to.equal(output2);
        });

        it("Should approve xcmPrecompile in XCM path (not baseSettler)", async function () {
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
            await mockXcm.setExecutionSuccess(true);

            await inputSettlerXCMEscrow.connect(user).open(order);

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
            expect(xcmAllowance).to.equal(ethers.parseEther("100"));
        });
    });

    describe("Input/output validation", function () {
        it("Should accept when input amount exactly matches output amount", async function () {
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed");
        });

        it("Should accept when input amount exceeds output amount", async function () {
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther("150")]],
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("150"));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed");
        });

        it("Should fall back to baseSettler when output amount exceeds input amount", async function () {
        // Insufficient inputs for XCM - falls back to baseSettler
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther("50")]],
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("50"));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });

        it("Should handle input token not present in outputs", async function () {
            const destination = 1000;
            const token2 = await ethers.deployContract("MockERC20", ["Test2", "TST2"]);
            await token2.waitForDeployment();
            await token2.mint(user, ethers.parseEther("1000"));

            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder({
                inputs: [
                    [await token.getAddress(), ethers.parseEther("100")],
                    [await token2.getAddress(), ethers.parseEther("50")] // Extra input not in outputs
                ],
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));
            await token2.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("50"));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
            await mockXcm.setExecutionSuccess(true);

            // Extra inputs are OK - XCM still executes
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed");
        });

        it("Should fall back when output tokens not covered by inputs", async function () {
            const destination = 1000;
            const token2 = await ethers.deployContract("MockERC20", ["Test2", "TST2"]);
            await token2.waitForDeployment();

            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());
            await inputSettlerXCMEscrow.allowTeleport(destination, await token2.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther("100")]],
                outputs: [
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination,
                        token: ethers.zeroPadValue(await token.getAddress(), 32),
                        amount: ethers.parseEther("50"),
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    },
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination,
                        token: ethers.zeroPadValue(await token2.getAddress(), 32),
                        amount: ethers.parseEther("50"), // No input for this token
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    }
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });

        it("Should fall back when input token does not match output token", async function () {
            const destination = 1000;
            const token2 = await ethers.deployContract("MockERC20", ["Test2", "TST2"]);
            await token2.waitForDeployment();

            await inputSettlerXCMEscrow.allowTeleport(destination, await token2.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther("100")]],
                outputs: [{
                    settler: ethers.zeroPadValue("0x01", 32),
                    oracle: ethers.zeroPadValue("0x02", 32),
                    chainId: destination,
                    token: ethers.zeroPadValue(await token2.getAddress(), 32), // Different token
                    amount: ethers.parseEther("100"),
                    recipient: ethers.zeroPadValue(user.address, 32),
                    call: "0x",
                    context: "0x"
                }]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });

        it("Should aggregate multiple outputs with same token correctly", async function () {
            const destination1 = 1000;
            const destination2 = 2000;

            await inputSettlerXCMEscrow.allowTeleport(destination1, await token.getAddress());
            await inputSettlerXCMEscrow.allowTeleport(destination2, await token.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther("200")]],
                outputs: [
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination1,
                        token: ethers.zeroPadValue(await token.getAddress(), 32),
                        amount: ethers.parseEther("80"),
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    },
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination2,
                        token: ethers.zeroPadValue(await token.getAddress(), 32),
                        amount: ethers.parseEther("80"),
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    }
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("200"));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
            await mockXcm.setExecutionSuccess(true);

            // Total outputs = 160, input = 200, should pass
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed");
        });

        it("Should fall back if aggregated outputs exceed input", async function () {
            const destination1 = 1000;
            const destination2 = 2000;

            await inputSettlerXCMEscrow.allowTeleport(destination1, await token.getAddress());
            await inputSettlerXCMEscrow.allowTeleport(destination2, await token.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther("150")]],
                outputs: [
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination1,
                        token: ethers.zeroPadValue(await token.getAddress(), 32),
                        amount: ethers.parseEther("80"),
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    },
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination2,
                        token: ethers.zeroPadValue(await token.getAddress(), 32),
                        amount: ethers.parseEther("80"),
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    }
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("150"));

            // Total outputs = 160, input = 150, should fall back
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(baseSettler, "Open");
        });
    });

    describe("Multiple outputs", function () {
        it("Should handle multiple outputs to different destinations", async function () {
            const destination1 = 1000;
            const destination2 = 2000;

            await inputSettlerXCMEscrow.allowTeleport(destination1, await token.getAddress());
            await inputSettlerXCMEscrow.allowTeleport(destination2, await token.getAddress());

            const order = createOrder({
                inputs: [[await token.getAddress(), ethers.parseEther("200")]],
                outputs: [
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination1,
                        token: ethers.zeroPadValue(await token.getAddress(), 32),
                        amount: ethers.parseEther("100"),
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    },
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination2,
                        token: ethers.zeroPadValue(await token.getAddress(), 32),
                        amount: ethers.parseEther("100"),
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    }
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("200"));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg1"));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed")
                .withArgs(ethers.toUtf8Bytes("0xmsg1"));
        });
    });

    describe("Edge cases", function () {
        it("Should handle empty inputs array", async function () {
            const order = createOrder({
                inputs: [],
                outputs: [{
                    settler: ethers.zeroPadValue("0x01", 32),
                    oracle: ethers.zeroPadValue("0x02", 32),
                    chainId: 1000,
                    token: ethers.zeroPadValue(await token.getAddress(), 32),
                    amount: ethers.parseEther("100"),
                    recipient: ethers.zeroPadValue(user.address, 32),
                    call: "0x",
                    context: "0x"
                }]
            });

            // Empty inputs causes fallback path
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.not.be.reverted;
        });

        it("Should handle empty outputs array", async function () {
            const order = createOrder({
                outputs: []
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));

            // Empty outputs - XCM executes with no teleports
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.not.be.reverted;
        });

        it("Should accept zero recipient address", async function () {
            // Note: Zero recipient is accepted - this is user's responsibility
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            const order = createOrder({
                outputs: [{
                    settler: ethers.zeroPadValue("0x01", 32),
                    oracle: ethers.zeroPadValue("0x02", 32),
                    chainId: destination,
                    token: ethers.zeroPadValue(await token.getAddress(), 32),
                    amount: ethers.parseEther("100"),
                    recipient: ethers.zeroPadValue("0x00", 32), // Zero recipient
                    call: "0x",
                    context: "0x"
                }]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther("100"));
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.not.be.reverted;
        });

        it("Should handle maximum number of distinct tokens", async function () {
            const numTokens = 10;
            const tokens = [];
            const destination = 1000;

            for (let i = 0; i < numTokens; i++) {
                const t = await ethers.deployContract("MockERC20", [`Test${i}`, `TST${i}`]);
                await t.waitForDeployment();
                await t.mint(user, ethers.parseEther("1000"));
                tokens.push(t);
                await inputSettlerXCMEscrow.allowTeleport(destination, await t.getAddress());
            }

            const inputs = [];
            const outputs = [];
            for (let i = 0; i < numTokens; i++) {
                inputs.push([await tokens[i].getAddress(), ethers.parseEther("100")]);
                outputs.push({
                    settler: ethers.zeroPadValue("0x01", 32),
                    oracle: ethers.zeroPadValue("0x02", 32),
                    chainId: destination,
                    token: ethers.zeroPadValue(await tokens[i].getAddress(), 32),
                    amount: ethers.parseEther("100"),
                    recipient: ethers.zeroPadValue(user.address, 32),
                    call: "0x",
                    context: "0x"
                });
                await tokens[i].connect(user).approve(
                    await inputSettlerXCMEscrow.getAddress(),
                    ethers.parseEther("100")
                );
            }

            const order = createOrder({ inputs, outputs });

            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
            await mockXcm.setExecutionSuccess(true);

            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed");
        });
    });

    describe("Amount overflow protection", function () {
        it("Should handle near-overflow amounts safely", async function () {
            const destination = 1000;
            await inputSettlerXCMEscrow.allowTeleport(destination, await token.getAddress());

            // Large amounts that sum to near uint256.max
            const largeAmount = BigInt("2") ** BigInt("255");
            const totalAmount = largeAmount * BigInt("2") - BigInt("1");

            await token.mint(user, totalAmount - ethers.parseEther("1000"));

            const order = createOrder({
                inputs: [[await token.getAddress(), totalAmount]],
                outputs: [
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination,
                        token: ethers.zeroPadValue(await token.getAddress(), 32),
                        amount: totalAmount / BigInt("2"),
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    },
                    {
                        settler: ethers.zeroPadValue("0x01", 32),
                        oracle: ethers.zeroPadValue("0x02", 32),
                        chainId: destination,
                        token: ethers.zeroPadValue(await token.getAddress(), 32),
                        amount: totalAmount / BigInt("2"),
                        recipient: ethers.zeroPadValue(user.address, 32),
                        call: "0x",
                        context: "0x"
                    }
                ]
            });

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), totalAmount);
            await mockLibrary.setTeleportMessage(ethers.toUtf8Bytes("0xmsg"));
            await mockXcm.setExecutionSuccess(true);

            // Should handle without overflow
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.not.be.reverted;
        });
    });
});
