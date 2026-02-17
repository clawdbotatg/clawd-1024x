// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TenTwentyFourX
 * @notice Simple variable-odds CLAWD betting game.
 *
 * Pick a bet size, pick a multiplier, roll. If you win, claim within 256 blocks.
 * Multiple bets at once are fine. No funds are "locked" — house just needs enough
 * to cover any single winning bet. Disclaimer covers simultaneous wins.
 *
 * Economics:
 * - Bet tiers: 2K / 10K / 50K / 100K CLAWD
 * - Multipliers: 2x to 1024x (powers of 2)
 * - 1% of every bet burned forever
 * - 1% of every winning claim burned forever
 * - 2% house edge on winnings
 */
contract TenTwentyFourX is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public owner;
    address public pendingOwner;

    uint256 public constant HOUSE_EDGE_PERCENT = 2;
    uint256 public constant BURN_PERCENT = 1;
    uint256 public constant REVEAL_WINDOW = 256;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant WITHDRAW_DELAY = 15 minutes;
    uint256 public constant MAX_PAYOUT_DIVISOR = 5; // Max payout = house balance / 5

    uint256[4] public VALID_BETS = [
        2_000 * 1e18,
        10_000 * 1e18,
        50_000 * 1e18,
        100_000 * 1e18
    ];

    uint256[10] public VALID_MULTIPLIERS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

    struct Bet {
        bytes32 dataHash;
        uint256 commitBlock;
        uint256 betAmount;
        uint256 multiplier;
        bool claimed;
    }

    mapping(address => Bet[]) public playerBets;

    // Withdrawal
    bool public paused;
    uint256 public withdrawRequestedAt;
    address public withdrawTo;

    // Stats
    uint256 public totalBets;
    uint256 public totalWins;
    uint256 public totalBetAmount;
    uint256 public totalPaidOut;
    uint256 public totalBurned;

    event BetPlaced(address indexed player, uint256 indexed betIndex, bytes32 dataHash, uint256 commitBlock, uint256 betAmount, uint256 multiplier, uint256 potentialPayout, uint256 burnAmount);
    event BetWon(address indexed player, uint256 indexed betIndex, bytes32 secret, uint256 betAmount, uint256 multiplier, uint256 payout);
    event TokensBurned(uint256 amount);
    event WithdrawRequested(address indexed by, address indexed to, uint256 executeAfter);
    event WithdrawCancelled(address indexed by);
    event WithdrawExecuted(address indexed to, uint256 amount);
    event Paused(bool isPaused);
    event OwnershipProposed(address indexed current, address indexed proposed);
    event OwnershipAccepted(address indexed oldOwner, address indexed newOwner);

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

    /// @notice Place a bet
    function click(bytes32 dataHash, uint256 betAmount, uint256 multiplier) external nonReentrant {
        require(!paused, "Game paused");
        require(dataHash != bytes32(0), "Empty hash");
        require(_isValidBet(betAmount), "Invalid bet amount");
        require(_isValidMultiplier(multiplier), "Invalid multiplier");

        uint256 payout = (betAmount * multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;
        uint256 currentBalance = token.balanceOf(address(this));
        // Max payout is 1/5 of current house balance
        require(payout <= currentBalance / MAX_PAYOUT_DIVISOR, "Payout exceeds max (1/5 of house)");

        // Take the bet
        token.safeTransferFrom(msg.sender, address(this), betAmount);

        // Burn 1%
        uint256 burnAmount = (betAmount * BURN_PERCENT) / 100;
        token.safeTransfer(BURN_ADDRESS, burnAmount);
        totalBurned += burnAmount;

        // Record bet
        uint256 betIndex = playerBets[msg.sender].length;
        playerBets[msg.sender].push(Bet({
            dataHash: dataHash,
            commitBlock: block.number,
            betAmount: betAmount,
            multiplier: multiplier,
            claimed: false
        }));

        totalBets++;
        totalBetAmount += betAmount;

        emit BetPlaced(msg.sender, betIndex, dataHash, block.number, betAmount, multiplier, payout, burnAmount);
        emit TokensBurned(burnAmount);
    }

    /// @notice Reveal a winning bet and claim payout
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
        require(keccak256(abi.encodePacked(secret, salt)) == b.dataHash, "Hash mismatch");

        // Check if winner
        bytes32 randomSeed = keccak256(abi.encodePacked(secret, commitBlockHash));
        require(uint256(randomSeed) % b.multiplier == 0, "Not a winner");

        uint256 payout = (b.betAmount * b.multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;
        b.claimed = true;
        totalWins++;
        totalPaidOut += payout;

        // Burn 1% of winnings on claim
        uint256 claimBurn = (payout * BURN_PERCENT) / 100;
        token.safeTransfer(BURN_ADDRESS, claimBurn);
        totalBurned += claimBurn;

        token.safeTransfer(player, payout - claimBurn);
        emit TokensBurned(claimBurn);
        emit BetWon(player, betIndex, secret, b.betAmount, b.multiplier, payout - claimBurn);
    }

    // ===== Owner withdrawal with 15-min delay =====

    function requestWithdraw(address _to) external onlyOwner {
        require(_to != address(0), "Invalid address");
        require(withdrawRequestedAt == 0, "Withdrawal already pending");
        paused = true;
        withdrawRequestedAt = block.timestamp;
        withdrawTo = _to;
        emit WithdrawRequested(msg.sender, _to, block.timestamp + WITHDRAW_DELAY);
        emit Paused(true);
    }

    function cancelWithdraw() external onlyOwner {
        withdrawRequestedAt = 0;
        withdrawTo = address(0);
        paused = false;
        emit WithdrawCancelled(msg.sender);
        emit Paused(false);
    }

    function executeWithdraw() external onlyOwner {
        require(withdrawRequestedAt != 0, "No withdrawal requested");
        require(block.timestamp >= withdrawRequestedAt + WITHDRAW_DELAY, "Delay not met");
        address to = withdrawTo;
        uint256 amount = token.balanceOf(address(this));
        withdrawRequestedAt = 0;
        withdrawTo = address(0);
        token.safeTransfer(to, amount);
        emit WithdrawExecuted(to, amount);
    }

    function unpause() external onlyOwner {
        require(withdrawRequestedAt == 0, "Cancel withdrawal first");
        paused = false;
        emit Paused(false);
    }

    function proposeOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        pendingOwner = newOwner;
        emit OwnershipProposed(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        emit OwnershipAccepted(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice Permanently renounce ownership — contract becomes immutable
    function renounceOwnership() external onlyOwner {
        emit OwnershipAccepted(owner, address(0));
        owner = address(0);
        pendingOwner = address(0);
    }

    // ===== View functions =====

    /// @notice Returns seconds remaining until withdrawal can be executed (0 if ready or no request)
    function withdrawTimeRemaining() external view returns (uint256) {
        if (withdrawRequestedAt == 0) return 0;
        uint256 readyAt = withdrawRequestedAt + WITHDRAW_DELAY;
        if (block.timestamp >= readyAt) return 0;
        return readyAt - block.timestamp;
    }

    function houseBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function getPlayerBetCount(address player) external view returns (uint256) {
        return playerBets[player].length;
    }

    function getBet(address player, uint256 betIndex) external view returns (
        bytes32 dataHash, uint256 commitBlock, uint256 betAmount, uint256 multiplier, bool claimed
    ) {
        require(betIndex < playerBets[player].length, "Invalid index");
        Bet memory b = playerBets[player][betIndex];
        return (b.dataHash, b.commitBlock, b.betAmount, b.multiplier, b.claimed);
    }

    function computeHash(bytes32 secret, bytes32 salt) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret, salt));
    }

    function checkWin(bytes32 secret, bytes32 blockHash, uint256 multiplier) external pure returns (bool) {
        return uint256(keccak256(abi.encodePacked(secret, blockHash))) % multiplier == 0;
    }

    function getPayoutFor(uint256 betAmount, uint256 multiplier) external pure returns (uint256) {
        uint256 grossPayout = (betAmount * multiplier * (100 - HOUSE_EDGE_PERCENT)) / 100;
        uint256 claimBurn = (grossPayout * BURN_PERCENT) / 100;
        return grossPayout - claimBurn;
    }

    function getValidBets() external view returns (uint256[4] memory) { return VALID_BETS; }
    function getValidMultipliers() external view returns (uint256[10] memory) { return VALID_MULTIPLIERS; }

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
