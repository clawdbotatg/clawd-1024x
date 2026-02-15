// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TenTwentyFourX
 * @notice Variable-odds, variable-bet CLAWD betting with multi-roll support.
 *
 * Players can roll multiple times without waiting. Each bet is tracked separately.
 * Winners must claim within 256 blocks (countdown shown in frontend).
 * Batch claims supported for efficiency.
 *
 * Economics:
 * - Bet tiers: 10K / 50K / 100K / 500K CLAWD
 * - Multipliers: 2x to 1024x (powers of 2)
 * - 1% of every bet burned forever
 * - 2% house edge on winnings
 *
 * Owner (clawdbotatg.eth) can trigger a withdrawal with 15-minute delay.
 * Triggering withdrawal immediately pauses new bets so no one gets rugged mid-roll.
 * Outstanding potential payouts are reserved and cannot be withdrawn.
 */
contract TenTwentyFourX is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public owner;

    uint256 public constant HOUSE_EDGE_PERCENT = 2;
    uint256 public constant BURN_PERCENT = 1;
    uint256 public constant REVEAL_WINDOW = 256;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant WITHDRAW_DELAY = 15 minutes;

    uint256[4] public VALID_BETS = [
        10_000 * 1e18,
        50_000 * 1e18,
        100_000 * 1e18,
        500_000 * 1e18
    ];

    uint256[10] public VALID_MULTIPLIERS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

    struct Bet {
        bytes32 dataHash;
        uint256 commitBlock;
        uint256 betAmount;
        uint256 multiplier;
        bool claimed;
    }

    // Each player has an array of bets
    mapping(address => Bet[]) public playerBets;

    // Withdrawal mechanism
    bool public paused;
    uint256 public withdrawRequestedAt;
    address public withdrawTo;

    // Outstanding potential payouts (reserved for pending bets)
    uint256 public totalOutstandingPotentialPayouts;

    // Stats
    uint256 public totalBets;
    uint256 public totalWins;
    uint256 public totalBetAmount;
    uint256 public totalPaidOut;
    uint256 public totalBurned;

    event BetPlaced(address indexed player, uint256 indexed betIndex, bytes32 dataHash, uint256 commitBlock, uint256 betAmount, uint256 multiplier, uint256 potentialPayout, uint256 burnAmount);
    event BetWon(address indexed player, uint256 indexed betIndex, bytes32 secret, uint256 betAmount, uint256 multiplier, uint256 payout);
    event BetForfeited(address indexed player, uint256 indexed betIndex);
    event TokensBurned(uint256 amount);
    event WithdrawRequested(address indexed by, address indexed to, uint256 executeAfter);
    event WithdrawCancelled(address indexed by);
    event WithdrawExecuted(address indexed to, uint256 amount);
    event Paused(bool isPaused);
    event OwnershipProposed(address indexed current, address indexed proposed);
    event OwnershipAccepted(address indexed oldOwner, address indexed newOwner);

    address public pendingOwner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _token, address _owner) {
        require(_token != address(0), "Invalid token");
        require(_owner != address(0), "Invalid owner");
        token = IERC20(_token);
        owner = _owner;
    }

    /// @notice Place a bet. Can place multiple without waiting.
    function click(bytes32 dataHash, uint256 betAmount, uint256 multiplier) external nonReentrant {
        require(!paused, "Game paused");
        require(dataHash != bytes32(0), "Empty hash");
        require(_isValidBet(betAmount), "Invalid bet amount");
        require(_isValidMultiplier(multiplier), "Invalid multiplier");

        uint256 payout = (betAmount * multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;
        uint256 netBet = betAmount - (betAmount * BURN_PERCENT) / 100;
        require(
            token.balanceOf(address(this)) + netBet >= totalOutstandingPotentialPayouts + payout,
            "House underfunded for this bet"
        );

        // Take the bet
        token.safeTransferFrom(msg.sender, address(this), betAmount);

        // Burn 1%
        uint256 burnAmount = (betAmount * BURN_PERCENT) / 100;
        token.safeTransfer(BURN_ADDRESS, burnAmount);
        totalBurned += burnAmount;

        // Push new bet to player's array
        uint256 betIndex = playerBets[msg.sender].length;
        playerBets[msg.sender].push(Bet({
            dataHash: dataHash,
            commitBlock: block.number,
            betAmount: betAmount,
            multiplier: multiplier,
            claimed: false
        }));

        totalOutstandingPotentialPayouts += payout;
        totalBets++;
        totalBetAmount += betAmount;

        emit BetPlaced(msg.sender, betIndex, dataHash, block.number, betAmount, multiplier, payout, burnAmount);
        emit TokensBurned(burnAmount);
    }

    /// @notice Reveal a single winning bet
    function reveal(uint256 betIndex, bytes32 secret, bytes32 salt) external nonReentrant {
        _reveal(msg.sender, betIndex, secret, salt);
    }

    /// @notice Batch reveal multiple winning bets
    function batchReveal(uint256[] calldata betIndices, bytes32[] calldata secrets, bytes32[] calldata salts) external nonReentrant {
        require(betIndices.length == secrets.length && secrets.length == salts.length, "Array length mismatch");
        require(betIndices.length <= 20, "Too many reveals");

        for (uint256 i = 0; i < betIndices.length; i++) {
            _reveal(msg.sender, betIndices[i], secrets[i], salts[i]);
        }
    }

    function _reveal(address player, uint256 betIndex, bytes32 secret, bytes32 salt) internal {
        require(betIndex < playerBets[player].length, "Invalid bet index");
        Bet storage b = playerBets[player][betIndex];

        require(b.commitBlock != 0, "No bet found");
        require(!b.claimed, "Already claimed");
        require(block.number > b.commitBlock, "Wait one block");

        bytes32 commitBlockHash = blockhash(b.commitBlock);
        require(commitBlockHash != bytes32(0), "Bet expired (>256 blocks)");

        // Verify commitment
        bytes32 computedHash = keccak256(abi.encodePacked(secret, salt));
        require(computedHash == b.dataHash, "Hash mismatch");

        // Check if winner
        bytes32 randomSeed = keccak256(abi.encodePacked(secret, commitBlockHash));
        require(uint256(randomSeed) % b.multiplier == 0, "Not a winner");

        uint256 payout = (b.betAmount * b.multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;

        b.claimed = true;
        totalOutstandingPotentialPayouts -= payout;
        totalWins++;
        totalPaidOut += payout;

        token.safeTransfer(player, payout);

        emit BetWon(player, betIndex, secret, b.betAmount, b.multiplier, payout);
    }

    /// @notice Forfeit a specific bet
    function forfeit(uint256 betIndex) external nonReentrant {
        require(betIndex < playerBets[msg.sender].length, "Invalid bet index");
        Bet storage b = playerBets[msg.sender][betIndex];
        require(b.commitBlock != 0, "No bet found");
        require(!b.claimed, "Already claimed");
        require(block.number > b.commitBlock, "Wait one block");

        uint256 payout = (b.betAmount * b.multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;
        b.claimed = true;
        totalOutstandingPotentialPayouts -= payout;
        emit BetForfeited(msg.sender, betIndex);
    }

    // ===== Owner withdrawal with 5-min delay =====

    /// @notice Owner requests withdrawal. Immediately pauses new bets.
    function requestWithdraw(address _to) external onlyOwner {
        require(_to != address(0), "Invalid address");
        require(withdrawRequestedAt == 0, "Withdrawal already pending");
        paused = true;
        withdrawRequestedAt = block.timestamp;
        withdrawTo = _to;

        emit WithdrawRequested(msg.sender, _to, block.timestamp + WITHDRAW_DELAY);
        emit Paused(true);
    }

    /// @notice Owner cancels withdrawal and unpauses.
    function cancelWithdraw() external onlyOwner {
        withdrawRequestedAt = 0;
        withdrawTo = address(0);
        paused = false;

        emit WithdrawCancelled(msg.sender);
        emit Paused(false);
    }

    /// @notice Execute withdrawal after delay has passed.
    function executeWithdraw() external onlyOwner {
        require(withdrawRequestedAt != 0, "No withdrawal requested");
        require(block.timestamp >= withdrawRequestedAt + WITHDRAW_DELAY, "Delay not met");

        address to = withdrawTo;
        uint256 balance = token.balanceOf(address(this));
        require(balance > totalOutstandingPotentialPayouts, "Nothing withdrawable");
        uint256 amount = balance - totalOutstandingPotentialPayouts;

        withdrawRequestedAt = 0;
        withdrawTo = address(0);
        // Game stays paused until owner explicitly unpauses

        token.safeTransfer(to, amount);

        emit WithdrawExecuted(to, amount);
    }

    /// @notice Owner can unpause (e.g. after refunding the house)
    function unpause() external onlyOwner {
        require(withdrawRequestedAt == 0, "Cancel withdrawal first");
        paused = false;
        emit Paused(false);
    }

    /// @notice Propose new owner (two-step transfer)
    function proposeOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        pendingOwner = newOwner;
        emit OwnershipProposed(owner, newOwner);
    }

    /// @notice Accept ownership (must be called by proposed owner)
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipAccepted(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ===== View functions =====

    function computeHash(bytes32 secret, bytes32 salt) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret, salt));
    }

    function checkWin(bytes32 secret, bytes32 blockHash, uint256 multiplier) external pure returns (bool) {
        bytes32 randomSeed = keccak256(abi.encodePacked(secret, blockHash));
        return uint256(randomSeed) % multiplier == 0;
    }

    function maxMultiplierForBet(uint256 betAmount) external view returns (uint256) {
        uint256 currentBalance = token.balanceOf(address(this));
        uint256 netBet = betAmount - (betAmount * BURN_PERCENT) / 100;

        for (int i = int(VALID_MULTIPLIERS.length) - 1; i >= 0; i--) {
            uint256 m = VALID_MULTIPLIERS[uint256(i)];
            uint256 payout = (betAmount * m * (100 - HOUSE_EDGE_PERCENT)) / 100;
            if (currentBalance + netBet >= totalOutstandingPotentialPayouts + payout) {
                return m;
            }
        }
        return 0;
    }

    function houseBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Get total number of bets for a player
    function getPlayerBetCount(address player) external view returns (uint256) {
        return playerBets[player].length;
    }

    /// @notice Get a specific bet
    function getBet(address player, uint256 betIndex) external view returns (
        bytes32 dataHash,
        uint256 commitBlock,
        uint256 betAmount,
        uint256 multiplier,
        bool claimed,
        uint256 blocksLeft
    ) {
        require(betIndex < playerBets[player].length, "Invalid index");
        Bet memory b = playerBets[player][betIndex];
        uint256 left = 0;
        if (b.commitBlock != 0 && !b.claimed) {
            uint256 expiry = b.commitBlock + REVEAL_WINDOW;
            if (block.number < expiry) {
                left = expiry - block.number;
            }
        }
        return (b.dataHash, b.commitBlock, b.betAmount, b.multiplier, b.claimed, left);
    }

    /// @notice Get recent active (unclaimed) bets for a player
    function getActiveBets(address player) external view returns (
        uint256[] memory indices,
        uint256[] memory commitBlocks,
        uint256[] memory betAmounts,
        uint256[] memory multipliers,
        uint256[] memory blocksLeftArr
    ) {
        Bet[] storage bets = playerBets[player];
        
        // Count active bets
        uint256 count = 0;
        for (uint256 i = bets.length; i > 0 && count < 50; i--) {
            Bet storage b = bets[i - 1];
            if (!b.claimed && b.commitBlock != 0) {
                count++;
            }
        }

        indices = new uint256[](count);
        commitBlocks = new uint256[](count);
        betAmounts = new uint256[](count);
        multipliers = new uint256[](count);
        blocksLeftArr = new uint256[](count);

        uint256 idx = 0;
        for (uint256 i = bets.length; i > 0 && idx < count; i--) {
            Bet storage b = bets[i - 1];
            if (!b.claimed && b.commitBlock != 0) {
                indices[idx] = i - 1;
                commitBlocks[idx] = b.commitBlock;
                betAmounts[idx] = b.betAmount;
                multipliers[idx] = b.multiplier;
                uint256 expiry = b.commitBlock + REVEAL_WINDOW;
                blocksLeftArr[idx] = block.number < expiry ? expiry - block.number : 0;
                idx++;
            }
        }
    }

    function getPayoutFor(uint256 betAmount, uint256 multiplier) external pure returns (uint256) {
        return (betAmount * multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;
    }

    function getValidBets() external view returns (uint256[4] memory) {
        return VALID_BETS;
    }

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
