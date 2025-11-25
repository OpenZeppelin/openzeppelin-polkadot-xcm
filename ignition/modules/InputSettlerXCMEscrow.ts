import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const InputSettlerXCMEscrowModule = buildModule("InputSettlerXCMEscrowModule", (m) => {
    // Parameters with defaults
    // Default XCM precompile address on many Polkadot parachains is 0xA0000 or similar precompiles
    const xcmPrecompile = m.getParameter("xcmPrecompile", "0x00000000000000000000000000000000000A0000");

    // For inkLibrary, we might need a real address. Defaulting to zero address for now if not provided.
    // User should provide this when deploying to a real network.
    const inkLibrary = m.getParameter("inkLibrary", "0x0000000000000000000000000000000000000000");

    // Deploy the base settler contract
    // Note: InputSettlerEscrow is imported from oif-contracts
    const baseSettler = m.contract("InputSettlerEscrow", []);

    // Deploy the XCM settler
    const inputSettlerXCMEscrow = m.contract("InputSettlerXCMEscrow", [
        inkLibrary,
        xcmPrecompile,
        baseSettler
    ]);

    return { baseSettler, inputSettlerXCMEscrow };
});

export default InputSettlerXCMEscrowModule;

