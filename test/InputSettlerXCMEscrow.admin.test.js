const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    setupInputSettlerXCMEscrow,
    createOrderFactory,
    DESTINATION_CHAIN_ID,
    STANDARD_AMOUNT,
    DOUBLE_AMOUNT,
    MOCK_XCM_MESSAGE_1
} = require("./helpers/inputSettlerXCMEscrowHelper");

describe("InputSettlerXCMEscrow - Admin Functions", function () {
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

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await inputSettlerXCMEscrow.owner()).to.equal(owner.address);
        });
    });

    describe("allowTeleport", function () {
        it("Should allow teleport for a destination and token", async function () {
            const tokenAddress = await token.getAddress();

            await expect(inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, tokenAddress))
                .to.emit(inputSettlerXCMEscrow, "TeleportAllowed")
                .withArgs(DESTINATION_CHAIN_ID, tokenAddress);
        });

        it("Should revert if not called by owner", async function () {
            const tokenAddress = await token.getAddress();

            await expect(
                inputSettlerXCMEscrow.connect(user).allowTeleport(DESTINATION_CHAIN_ID, tokenAddress)
            ).to.be.revertedWithCustomError(inputSettlerXCMEscrow, "OwnableUnauthorizedAccount")
                .withArgs(user.address);
        });
    });

    describe("forbidTeleport", function () {
        it("Should forbid teleport for a destination and token", async function () {
            const tokenAddress = await token.getAddress();

            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, tokenAddress);

            await expect(inputSettlerXCMEscrow.forbidTeleport(DESTINATION_CHAIN_ID, tokenAddress))
                .to.emit(inputSettlerXCMEscrow, "TeleportForbidden")
                .withArgs(DESTINATION_CHAIN_ID, tokenAddress);
        });
    });

    describe("setXCMEnabled", function () {
        it("Should fall back to baseSettler when XCM is disabled for valid XCM order", async function () {
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder();

            // Verify XCM path would work normally
            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(DOUBLE_AMOUNT));
            await mockLibrary.setTeleportMessage(MOCK_XCM_MESSAGE_1);
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
            await inputSettlerXCMEscrow.allowTeleport(DESTINATION_CHAIN_ID, await token.getAddress());

            const order = createOrder();

            await token.connect(user).approve(await inputSettlerXCMEscrow.getAddress(), ethers.parseEther(STANDARD_AMOUNT));
            await mockLibrary.setTeleportMessage(MOCK_XCM_MESSAGE_1);
            await mockXcm.setExecutionSuccess(true);

            // Disable then re-enable XCM
            await inputSettlerXCMEscrow.setXCMEnabled(false);
            await inputSettlerXCMEscrow.setXCMEnabled(true);

            // Should use XCM path again
            await expect(inputSettlerXCMEscrow.connect(user).open(order))
                .to.emit(mockXcm, "Executed")
                .withArgs(MOCK_XCM_MESSAGE_1);
        });

        it("Should revert if not called by owner", async function () {
            await expect(
                inputSettlerXCMEscrow.connect(user).setXCMEnabled(false)
            ).to.be.revertedWithCustomError(inputSettlerXCMEscrow, "OwnableUnauthorizedAccount")
                .withArgs(user.address);
        });
    });
});
