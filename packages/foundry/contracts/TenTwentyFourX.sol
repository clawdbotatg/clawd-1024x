// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TenTwentyFourX
 * @notice A variable-odds, variable-bet betting game with multipliers from 2x to 1024x using commit-reveal.
 *
 * How it works:
 * 1. CLICK: Pick a bet size (10K/50K/100K/500K CLAWD) and multiplier (2x-1024x), submit hash(secret, salt).
 * 2. CHECK: After 1 block, compute locally whether you won.
 *    - winning = (keccak256(secret, commitBlockHash) % multiplier == 0)
 * 3. REVEAL (only if you won!): Submit secret + salt on-chain to claim payout.
 *    - Payout = betAmount * multiplier * 98 / 100 (2% house edge)
 *
 * Economics:
 * - 1% of every bet is burned forever
 * - 2% house edge on winnings
 * - Solvency guard: can't pick a bet/multiplier combo the house can't cover
 *
 * The contract must be funded with CLAWD to pay out winners.
 */
contract TenTwentyFourX is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public constant HOUSE_EDGE_PERCENT = 2;        // 2% house edge on winnings
    uint256 public constant BURN_PERCENT = 1;              // 1% burn on every bet
    uint256 public constant REVEAL_WINDOW = 256;           // blocks before commitment expires
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Valid bet amounts (in tokens with 18 decimals)
    uint256[4] public VALID_BETS = [
        10_000 * 1e18,
        50_000 * 1e18,
        100_000 * 1e18,
        500_000 * 1e18
    ];

    // Valid multipliers: powers of 2 from 2 to 1024
    uint256[10] public VALID_MULTIPLIERS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

    struct Commitment {
        bytes32 dataHash;
        uint256 commitBlock;
        uint256 betAmount;
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

    event Clicked(address indexed player, bytes32 dataHash, uint256 commitBlock, uint256 betAmount, uint256 multiplier, uint256 payout, uint256 burnAmount);
    event Won(address indexed player, bytes32 secret, bytes32 salt, uint256 betAmount, uint256 multiplier, uint256 payout);
    event Forfeited(address indexed player, uint256 commitBlock);
    event HouseFunded(address indexed funder, uint256 amount);
    event TokensBurned(uint256 amount);

    constructor(address _token) {
        require(_token != address(0), "Invalid token");
        token = IERC20(_token);
    }

    /// @notice Place a bet by committing a hash, selecting bet size + multiplier
    /// @param dataHash keccak256(abi.encodePacked(secret, salt))
    /// @param betAmount The bet size (must be 10K, 50K, 100K, or 500K CLAWD)
    /// @param multiplier The multiplier (must be a power of 2: 2, 4, 8, ..., 1024)
    function click(bytes32 dataHash, uint256 betAmount, uint256 multiplier) external nonReentrant {
        require(dataHash != bytes32(0), "Empty hash");
        require(_isValidBet(betAmount), "Invalid bet amount");
        require(_isValidMultiplier(multiplier), "Invalid multiplier");

        // Allow re-betting after 1 block
        Commitment memory prev = commitments[msg.sender];
        require(
            prev.commitBlock == 0 ||
            prev.claimed ||
            block.number > prev.commitBlock,
            "Wait one block before re-betting"
        );

        // Calculate potential payout (with 2% house edge)
        uint256 payout = (betAmount * multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;

        // Solvency: house keeps 99% of bet (1% burned)
        uint256 netBet = betAmount - (betAmount * BURN_PERCENT) / 100;
        require(
            token.balanceOf(address(this)) + netBet >= payout,
            "House underfunded for this bet"
        );

        // Take the bet
        token.safeTransferFrom(msg.sender, address(this), betAmount);

        // Burn 1%
        uint256 burnAmount = (betAmount * BURN_PERCENT) / 100;
        token.safeTransfer(BURN_ADDRESS, burnAmount);
        totalBurned += burnAmount;

        commitments[msg.sender] = Commitment({
            dataHash: dataHash,
            commitBlock: block.number,
            betAmount: betAmount,
            multiplier: multiplier,
            claimed: false
        });

        totalBets++;
        totalBetAmount += betAmount;

        emit Clicked(msg.sender, dataHash, block.number, betAmount, multiplier, payout, burnAmount);
        emit TokensBurned(burnAmount);
    }

    /// @notice Reveal your secret to claim winnings (only call if you won!)
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

        // Payout uses stored bet amount
        uint256 payout = (c.betAmount * c.multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;

        c.claimed = true;
        totalWins++;
        totalPaidOut += payout;

        token.safeTransfer(msg.sender, payout);

        emit Won(msg.sender, secret, salt, c.betAmount, c.multiplier, payout);
    }

    /// @notice Forfeit your current bet
    function forfeit() external nonReentrant {
        Commitment storage c = commitments[msg.sender];
        require(c.commitBlock != 0, "No bet found");
        require(!c.claimed, "Already claimed");
        require(block.number > c.commitBlock, "Wait one block");

        c.claimed = true;
        emit Forfeited(msg.sender, c.commitBlock);
    }

    /// @notice Compute the commitment hash
    function computeHash(bytes32 secret, bytes32 salt) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret, salt));
    }

    /// @notice Check if a secret would win given a specific blockhash and multiplier
    function checkWin(bytes32 secret, bytes32 blockHash, uint256 multiplier) external pure returns (bool) {
        bytes32 randomSeed = keccak256(abi.encodePacked(secret, blockHash));
        return uint256(randomSeed) % multiplier == 0;
    }

    /// @notice Get the highest multiplier the house can cover for a given bet size
    function maxMultiplierForBet(uint256 betAmount) external view returns (uint256) {
        uint256 currentBalance = token.balanceOf(address(this));
        uint256 netBet = betAmount - (betAmount * BURN_PERCENT) / 100;

        for (int i = int(VALID_MULTIPLIERS.length) - 1; i >= 0; i--) {
            uint256 m = VALID_MULTIPLIERS[uint256(i)];
            uint256 payout = (betAmount * m * (100 - HOUSE_EDGE_PERCENT)) / 100;
            if (currentBalance + netBet >= payout) {
                return m;
            }
        }
        return 0;
    }

    /// @notice Get the house balance
    function houseBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Get a player's current bet info
    function getBet(address player) external view returns (
        bytes32 dataHash,
        uint256 commitBlock,
        uint256 betAmount,
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
        return (c.dataHash, c.commitBlock, c.betAmount, c.multiplier, c.claimed, left);
    }

    /// @notice Get expected payout for a bet + multiplier combo
    function getPayoutFor(uint256 betAmount, uint256 multiplier) external pure returns (uint256) {
        return (betAmount * multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;
    }

    /// @notice Get all valid bet amounts
    function getValidBets() external view returns (uint256[4] memory) {
        return VALID_BETS;
    }

    /// @notice Get all valid multipliers
    function getValidMultipliers() external view returns (uint256[10] memory) {
        return VALID_MULTIPLIERS;
    }

    function _isValidBet(uint256 betAmount) internal view returns (bool) {
        for (uint256 i = 0; i < VALID_BETS.length; i++) {
            if (VALID_BETS[i] == betAmount) return true;
        }
        return false;
    }

    function _isValidMultiplier(uint256 multiplier) internal view returns (bool) {
        for (uint256 i = 0; i < VALID_MULTIPLIERS.length; i++) {
            if (VALID_MULTIPLIERS[i] == multiplier) return true;
        }
        return false;
    }
}
