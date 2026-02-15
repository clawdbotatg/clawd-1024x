// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TenTwentyFourX
 * @notice A variable-odds betting game with multipliers from 2x to 1024x using commit-reveal for fairness.
 *
 * How it works:
 * 1. CLICK: Pay 10,000 CLAWD, pick a multiplier (2-1024), and submit hash(secret, salt). Tokens go to the contract.
 * 2. CHECK: After 1 block, you can compute locally whether you won.
 *    - winning = (keccak256(secret, commitBlockHash) % multiplier == 0)
 * 3. REVEAL (only if you won!): Submit secret + salt on-chain to claim payout.
 *    - Payout = 10,000 * multiplier * 98 / 100 (2% house edge)
 *
 * Economics:
 * - 1% of every bet is burned forever (100 CLAWD per roll)
 * - 2% house edge on winnings
 * - Example: 2x pays 19,600 CLAWD. 1024x pays 10,035,200 CLAWD.
 *
 * The contract must be funded with CLAWD to pay out winners.
 * Anyone can fund the house by transferring CLAWD to the contract.
 */
contract TenTwentyFourX is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public constant BET_AMOUNT = 10_000 * 1e18;    // 10K CLAWD (18 decimals)
    uint256 public constant HOUSE_EDGE_PERCENT = 2;        // 2% house edge
    uint256 public constant BURN_PERCENT = 1;              // 1% burn on every bet
    uint256 public constant REVEAL_WINDOW = 256;           // blocks before commitment expires
    
    // Burn address - 0x000000000000000000000000000000000000dEaD
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Valid multipliers: powers of 2 from 2 to 1024
    uint256[10] public VALID_MULTIPLIERS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

    struct Commitment {
        bytes32 dataHash;
        uint256 commitBlock;
        uint256 multiplier;
        bool claimed;
    }

    mapping(address => Commitment) public commitments;

    // Stats
    uint256 public totalBets;
    uint256 public totalWins;
    uint256 public totalBetAmount;
    uint256 public totalPaidOut;
    uint256 public totalBurned;

    event Clicked(address indexed player, bytes32 dataHash, uint256 commitBlock, uint256 multiplier, uint256 payout, uint256 burnAmount);
    event Won(address indexed player, bytes32 secret, bytes32 salt, uint256 multiplier, uint256 payout);
    event Forfeited(address indexed player, uint256 commitBlock);
    event HouseFunded(address indexed funder, uint256 amount);
    event TokensBurned(uint256 amount);

    constructor(address _token) {
        require(_token != address(0), "Invalid token");
        token = IERC20(_token);
    }

    /// @notice Place a bet by committing a hash, selecting a multiplier, and paying 10K CLAWD
    /// @param dataHash keccak256(abi.encodePacked(secret, salt))
    /// @param multiplier The multiplier to bet on (must be a valid power of 2: 2, 4, 8, ..., 1024)
    function click(bytes32 dataHash, uint256 multiplier) external nonReentrant {
        require(dataHash != bytes32(0), "Empty hash");
        require(_isValidMultiplier(multiplier), "Invalid multiplier");
        
        // Allow re-betting if: no previous bet, previous was claimed/forfeited,
        // previous expired (>256 blocks), OR previous is at least 1 block old
        // (player forfeits any unclaimed win by placing a new bet)
        Commitment memory prev = commitments[msg.sender];
        require(
            prev.commitBlock == 0 || 
            prev.claimed ||
            block.number > prev.commitBlock,
            "Wait one block before re-betting"
        );

        // Calculate potential payout (with 2% house edge)
        uint256 payout = (BET_AMOUNT * multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;

        // Must have enough house funds to pay a potential winner
        // House keeps 99% of bet (1% burned), so check with net amount
        uint256 netBet = BET_AMOUNT - (BET_AMOUNT * BURN_PERCENT) / 100;
        require(
            token.balanceOf(address(this)) + netBet >= payout,
            "House underfunded for this multiplier"
        );

        // Take the bet
        token.safeTransferFrom(msg.sender, address(this), BET_AMOUNT);

        // Burn 1% of bet
        uint256 burnAmount = (BET_AMOUNT * BURN_PERCENT) / 100;
        token.safeTransfer(BURN_ADDRESS, burnAmount);
        totalBurned += burnAmount;

        commitments[msg.sender] = Commitment({
            dataHash: dataHash,
            commitBlock: block.number,
            multiplier: multiplier,
            claimed: false
        });

        totalBets++;
        totalBetAmount += BET_AMOUNT;

        emit Clicked(msg.sender, dataHash, block.number, multiplier, payout, burnAmount);
        emit TokensBurned(burnAmount);
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
        require(uint256(randomSeed) % c.multiplier == 0, "Not a winner");

        // Calculate payout (with house edge)
        uint256 payout = (BET_AMOUNT * c.multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;

        // Mark claimed and pay out
        c.claimed = true;
        totalWins++;
        totalPaidOut += payout;

        token.safeTransfer(msg.sender, payout);

        emit Won(msg.sender, secret, salt, c.multiplier, payout);
    }

    /// @notice Forfeit your current bet so you can play again immediately.
    /// @dev The player voluntarily abandons any potential winnings. Their 10K bet stays in the house.
    function forfeit() external nonReentrant {
        Commitment storage c = commitments[msg.sender];
        require(c.commitBlock != 0, "No bet found");
        require(!c.claimed, "Already claimed");
        require(block.number > c.commitBlock, "Wait one block");

        c.claimed = true;
        emit Forfeited(msg.sender, c.commitBlock);
    }

    /// @notice Compute the commitment hash (use this to generate your hash off-chain too)
    function computeHash(bytes32 secret, bytes32 salt) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret, salt));
    }

    /// @notice Check if a secret would win given a specific blockhash and multiplier
    /// @dev Use this client-side: pass your secret, the blockhash from your commit block, and multiplier
    function checkWin(bytes32 secret, bytes32 blockHash, uint256 multiplier) external pure returns (bool) {
        bytes32 randomSeed = keccak256(abi.encodePacked(secret, blockHash));
        return uint256(randomSeed) % multiplier == 0;
    }

    /// @notice Get the highest multiplier the house can currently afford to cover
    /// @return The maximum multiplier available for betting
    function maxMultiplier() external view returns (uint256) {
        uint256 currentBalance = token.balanceOf(address(this));
        
        // Check each multiplier from highest to lowest
        for (int i = int(VALID_MULTIPLIERS.length) - 1; i >= 0; i--) {
            uint256 multiplier = VALID_MULTIPLIERS[uint256(i)];
            uint256 payout = (BET_AMOUNT * multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;
            
            // If house can cover this payout (including the incoming bet)
            if (currentBalance + BET_AMOUNT - (BET_AMOUNT * BURN_PERCENT) / 100 >= payout) {
                return multiplier;
            }
        }
        
        return 0; // House can't cover any multiplier
    }

    /// @notice Get the house balance (available to pay winners)
    function houseBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Get a player's current bet info
    function getBet(address player) external view returns (
        bytes32 dataHash,
        uint256 commitBlock,
        uint256 multiplier,
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
        return (c.dataHash, c.commitBlock, c.multiplier, c.claimed, left);
    }

    /// @notice Get the expected payout for a given multiplier (after house edge)
    function getPayoutForMultiplier(uint256 multiplier) external view returns (uint256) {
        require(_isValidMultiplier(multiplier), "Invalid multiplier");
        return (BET_AMOUNT * multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;
    }

    /// @notice Get all valid multipliers
    function getValidMultipliers() external view returns (uint256[10] memory) {
        return VALID_MULTIPLIERS;
    }

    /// @notice Check if a multiplier is valid (internal function)
    function _isValidMultiplier(uint256 multiplier) internal view returns (bool) {
        for (uint256 i = 0; i < VALID_MULTIPLIERS.length; i++) {
            if (VALID_MULTIPLIERS[i] == multiplier) {
                return true;
            }
        }
        return false;
    }
}