# Polkadot OIF Escrow Settler

> [!Warning]
> This is experimental software and is provided on an "as is" and "as available"
> basis. We do not give any warranties and will not be liable for any losses
> incurred through any use of this code base.

This repository contains the Polkadot implementation of the Order Intent Flow (OIF) Escrow Settler. It is a smart contract system designed to facilitate secure, cross-chain order settlement using Polkadot's Cross-Consensus Messaging (XCM) capabilities.

## Overview

The `InputSettlerXCMEscrow` contract serves as a bridge between the standardized OIF protocol and the Polkadot ecosystem. It enables users to create orders that can be settled across different parachains.

Key features include:
-   **Cross-Chain Settlement**: Leverages XCM to execute asset transfers and settlements across Polkadot parachains.
-   **Asset Teleportation**: Supports "teleporting" assets between chains where trusted relationships exist.
-   **Hybrid Settlement Logic**: Automatically detects if an order requires cross-chain execution via XCM or if it should fall back to a standard local settlement.
-   **Escrow Management**: Holds assets in escrow during the order lifecycle to ensure atomic settlement.

## Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or later recommended)
-   [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
-   Git

## Installation

1.  **Clone the repository:**
    ```bash
    git clone --recurse-submodules https://github.com/your-username/polkadot-oif.git
    cd polkadot-oif
    ```
    *Note: The `--recurse-submodules` flag is important as this project relies on the `oif-contracts` library.*

2.  **Install dependencies:**
    ```bash
    npm install
    ```

## Configuration

To run the local development network, you need to obtain the necessary binaries from the Polkadot SDK releases.

1.  **Download Binaries**:
    -   Download `revive-dev-node` and `eth-rpc` from the [Polkadot SDK releases](https://github.com/paritytech/polkadot-sdk/releases).

2.  **Setup Binaries**:
    -   Place both files in the `bin/` directory of this repository.
    -   Rename `revive-dev-node` to `dev-node`.
    -   Ensure both files are executable:
        ```bash
        chmod +x bin/dev-node bin/eth-rpc
        ```

## Usage

### Compile Contracts

Compile the Solidity contracts to generate artifacts:

```bash
npx hardhat compile
```

## Deployment

This project uses [Hardhat Ignition](https://hardhat.org/ignition) for deployment.

### Contract Architecture

The core contract `InputSettlerXCMEscrow` requires three dependencies to be initialized in its constructor:
1.  **`inkLibrary`**: Helper library for constructing XCM messages (deployed in PolkaVM).
2.  **`xcmPrecompile`**: Address of the chain's XCM precompile.
3.  **`baseSettler`**: An instance of the standard `InputSettlerEscrow` contract, which handles non-cross-chain logic.

The main deployment module is located at `ignition/modules/InputSettlerXCMEscrow.ts`. This module orchestrates the deployment by:
1.  Deploying a new instance of `InputSettlerEscrow` (Base Settler).
2.  Deploying `InputSettlerXCMEscrow` (XCM Settler), passing the newly deployed Base Settler address as the third constructor argument.

### Parameters

The deployment module accepts the following parameters to configure the first two dependencies:

-   `xcmPrecompile`: The address of the XCM precompile contract (default: `0x00000000000000000000000000000000000A0000`).
-   `inkLibrary`: The address of the Ink! library helper contract (default: `0x0000000000000000000000000000000000000000`).
  -   The implementation of this library can be found in the [xcm-in-smart-contracts-workshop](https://github.com/franciscoaguirre/xcm-in-smart-contracts-workshop/) repository (specifically the `ink_library` directory). This library is responsible for constructing XCM messages (e.g., for teleporting assets) and must be deployed to the PolkaVM environment on the target chain.

### Deploying to Local Node

To deploy to the local development node, you must provide valid addresses for `inkLibrary` and `xcmPrecompile`. If you don't have these on your local node, you may need to deploy mocks first.

1.  Ensure the local node is running (using the binary setup in **Configuration**).
2.  Run the deployment command with parameters:

    ```bash
    npx hardhat ignition deploy ignition/modules/InputSettlerXCMEscrow.ts --network localNode --parameters '{"InputSettlerXCMEscrowModule": {"inkLibrary": "0xYourInkLibraryAddress", "xcmPrecompile": "0xYourXcmPrecompileAddress"}}'
    ```

    *Note: The default `inkLibrary` address is `0x00...00`, which will cause the deployment to revert if not overridden.*

### Deploying to a Live Network

To deploy to a live network (e.g., a parachain testnet or mainnet), you should provide the specific addresses for the XCM precompile and Ink library if they differ from the defaults.

```bash
npx hardhat ignition deploy ignition/modules/InputSettlerXCMEscrow.ts --network <network_name> --parameters '{"InputSettlerXCMEscrowModule": {"xcmPrecompile": "0xYourXcmPrecompileAddress", "inkLibrary": "0xYourInkLibraryAddress"}}'
```
