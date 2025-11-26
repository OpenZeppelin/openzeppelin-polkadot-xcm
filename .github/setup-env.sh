#!/bin/bash
set -e

# Add environment setup commands here

mkdir bin
# this is a dirty node release, we should use the anvil one with they are available
# Download eth-rpc binary
curl -L https://github.com/paritytech/hardhat-polkadot/releases/download/nodes-19631614896/eth-rpc-linux-x64 -o bin/eth-rpc
chmod +x bin/eth-rpc
# Download revive-dev-node binary
curl -L https://github.com/paritytech/hardhat-polkadot/releases/download/nodes-19631614896/revive-dev-node-linux-x64 -o bin/dev-node
chmod +x bin/dev-node