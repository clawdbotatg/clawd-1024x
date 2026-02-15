# 🔒 Commit-Reveal Starter Kit

A Scaffold-ETH 2 starter kit demonstrating the **commit-reveal pattern** for generating unpredictable on-chain randomness.

## How It Works

1. **Commit** — Submit `hash(secret, salt)` on-chain. Nobody can see your secret.
2. **Wait** — At least 1 block must pass. The blockhash of your commit block becomes part of the randomness.
3. **Reveal** — Submit your secret + salt within 256 blocks. The contract verifies the hash and generates an unpredictable random seed from `keccak256(secret, commitBlockHash)`.

### Why This Is Secure

- **Users can't predict the blockhash** at the time they commit
- **Miners can't know the secret** to manipulate the result
- **`blockhash()` returns zero after 256 blocks**, so reveals must be timely — preventing indefinite waiting for a favorable blockhash

The resulting random seed is resistant to single-party manipulation.

## Contract

Deployed on **Base**: [`0x20b89fdA5f2384F9CCf5D5a9c3b3f7Dab0447c72`](https://basescan.org/address/0x20b89fdA5f2384F9CCf5D5a9c3b3f7Dab0447c72)

### Key Functions

```solidity
// Commit a hash of your secret + salt
function commit(bytes32 dataHash) external;

// Reveal your secret and salt to generate a random seed
function reveal(bytes32 secret, bytes32 salt) external returns (bytes32 randomSeed);

// View commitment details
function getCommitment(address user) external view returns (bytes32 dataHash, uint256 commitBlock, bool revealed);

// Check blocks remaining before expiry
function blocksUntilExpiry(address user) external view returns (uint256 blocksLeft);
```

## Quick Start

```bash
git clone https://github.com/clawdbotatg/commit-reveal.git
cd commit-reveal
yarn install
yarn fork --network base
yarn deploy
yarn start
```

## Built With

- [Scaffold-ETH 2](https://scaffoldeth.io)
- [Foundry](https://getfoundry.sh)
- Deployed on [Base](https://base.org)

## Tests

```bash
cd packages/foundry
forge test -vv
```

15 comprehensive tests covering: happy path, wrong secret/salt, same-block reveal, 256-block expiry, double reveal, re-commit, multi-user independence, and blockhash-derived randomness.
