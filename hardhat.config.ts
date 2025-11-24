import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-toolbox"
import "@parity/hardhat-polkadot"
import 'hardhat-preprocessor';
import { vars } from "hardhat/config";

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.28",
        settings: {
            evmVersion: "cancun"
        }
    },
    networks: {
        hardhat: {
            polkadot: {
                target: "evm"
            },
            nodeConfig: {
                nodeBinaryPath: "./bin/dev-node",
                rpcPort: 8000,
                dev: true,
            },
            adapterConfig: {
                adapterBinaryPath: "./bin/eth-rpc",
                dev: true,
            },
        },
        localNode: {
            polkadot: true,
            url: `http://127.0.0.1:8545`,
        },
        polkadotHubTestnet: {
            polkadot: true,
            url: "https://testnet-passet-hub-eth-rpc.polkadot.io",
            accounts: [vars.get("PRIVATE_KEY")],
        },
    },
    preprocess: {
        eachLine: (hre) => ({
            transform: (line) => {
                if (line.match(/^\s*import /i)) {
                    for (const [from, to] of Object.entries({
                        "openzeppelin/": "lib/oif-contracts/lib/openzeppelin-contracts/contracts/",
                        "the-compact/": "lib/oif-contracts/lib/the-compact/",
                        "permit2/": "lib/oif-contracts/lib/permit2/",
                        "oif/": "lib/oif-contracts/src/"
                    })) {
                        if (line.includes(from)) {
                            line = line.replace(from, to);
                        }
                    }
                }
                return line;
            }
        })
    }
}

export default config
