// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LuckyClick
 * @notice A simple 10-to-1 odds betting game using commit-reveal for fairness.
 *
 * How it works:
 * 1. CLICK: Pay 10,000 CLAWD and submit hash(secret, salt). Tokens go to the contract.
 * 2. CHECK: After 1 block, you can compute locally whether you won.
 *    - winning = (keccak256(secret, commitBlockHash) % 10 == 0)
 * 3. REVEAL (only if you won!): Submit secret + salt on-chain to claim 90,000 CLAWD.
 *    - If you lost, just walk away. No reveal needed.
 *
 * House edge: 10% (1/10 chance × 90K payout = 9K expected value on a 10K bet)
 *
 * The contract must be funded with CLAWD to pay out winners.
 * Anyone can fund the house by transferring CLAWD to the contract.
 */
contract LuckyClick is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public constant BET_AMOUNT = 10_000 * 1e18;    // 10K CLAWD (18 decimals)
    uint256 public constant WIN_AMOUNT = 90_000 * 1e18;    // 90K CLAWD payout
    uint256 public constant WIN_MODULO = 10;               // 1 in 10 chance
    uint256 public constant REVEAL_WINDOW = 256;            // blocks before commitment expires

    struct Commitment {
        bytes32 dataHash;
        uint256 commitBlock;
        bool claimed;
    }

    mapping(address => Commitment) public commitments;

    // Stats
    uint256 public totalBets;
    uint256 public totalWins;
    uint256 public totalBetAmount;
    uint256 public totalPaidOut;

    event Clicked(address indexed player, bytes32 dataHash, uint256 commitBlock);
    event Won(address indexed player, bytes32 secret, bytes32 salt, uint256 payout);
    event HouseFunded(address indexed funder, uint256 amount);

    constructor(address _token) {
        require(_token != address(0), "Invalid token");
        token = IERC20(_token);
    }

    /// @notice Place a bet by committing a hash and paying 10K CLAWD
    /// @param dataHash keccak256(abi.encodePacked(secret, salt))
    function click(bytes32 dataHash) external nonReentrant {
        require(dataHash != bytes32(0), "Empty hash");
        require(
            commitments[msg.sender].commitBlock == 0 || 
            commitments[msg.sender].claimed ||
            block.number > commitments[msg.sender].commitBlock + REVEAL_WINDOW,
            "Active bet exists"
        );

        // Must have enough house funds to pay a potential winner
        // (We check current balance minus the bet being placed)
        require(
            token.balanceOf(address(this)) + BET_AMOUNT >= WIN_AMOUNT,
            "House underfunded"
        );

        // Take the bet
        token.safeTransferFrom(msg.sender, address(this), BET_AMOUNT);

        commitments[msg.sender] = Commitment({
            dataHash: dataHash,
            commitBlock: block.number,
            claimed: false
        });

        totalBets++;
        totalBetAmount += BET_AMOUNT;

        emit Clicked(msg.sender, dataHash, block.number);
    }

    /// @notice Reveal your secret to claim winnings (only call this if you won!)
    /// @param secret The secret value you committed
    /// @param salt Random salt used when committing
    function reveal(bytes32 secret, bytes32 salt) external nonReentrant {
        Commitment storage c = commitments[msg.sender];

        require(c.commitBlock != 0, "No bet found");
        require(!c.claimed, "Already claimed");
        require(block.number > c.commitBlock, "Wait one block");

        bytes32 commitBlockHash = blockhash(c.commitBlock);
        require(commitBlockHash != bytes32(0), "Bet expired (>256 blocks)");

        // Verify commitment
        bytes32 computedHash = keccak256(abi.encodePacked(secret, salt));
        require(computedHash == c.dataHash, "Hash mismatch");

        // Check if winner
        bytes32 randomSeed = keccak256(abi.encodePacked(secret, commitBlockHash));
        require(uint256(randomSeed) % WIN_MODULO == 0, "Not a winner");

        // Mark claimed and pay out
        c.claimed = true;
        totalWins++;
        totalPaidOut += WIN_AMOUNT;

        token.safeTransfer(msg.sender, WIN_AMOUNT);

        emit Won(msg.sender, secret, salt, WIN_AMOUNT);
    }

    /// @notice Compute the commitment hash (use this to generate your hash off-chain too)
    function computeHash(bytes32 secret, bytes32 salt) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret, salt));
    }

    /// @notice Check if a secret would win given a specific blockhash
    /// @dev Use this client-side: pass your secret and the blockhash from your commit block
    function checkWin(bytes32 secret, bytes32 blockHash) external pure returns (bool) {
        bytes32 randomSeed = keccak256(abi.encodePacked(secret, blockHash));
        return uint256(randomSeed) % WIN_MODULO == 0;
    }

    /// @notice Get the house balance (available to pay winners)
    function houseBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Get a player's current bet info
    function getBet(address player) external view returns (
        bytes32 dataHash,
        uint256 commitBlock,
        bool claimed,
        uint256 blocksLeft
    ) {
        Commitment memory c = commitments[player];
        uint256 left = 0;
        if (c.commitBlock != 0 && !c.claimed) {
            uint256 expiry = c.commitBlock + REVEAL_WINDOW;
            if (block.number < expiry) {
                left = expiry - block.number;
            }
        }
        return (c.dataHash, c.commitBlock, c.claimed, left);
    }
}
