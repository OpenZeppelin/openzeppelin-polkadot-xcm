# Polkadot OIF Escrow Settler

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