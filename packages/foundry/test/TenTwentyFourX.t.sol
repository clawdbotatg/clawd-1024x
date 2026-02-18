// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/TenTwentyFourX.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockCLAWD is ERC20 {
    constructor() ERC20("CLAWD", "CLAWD") {
        _mint(msg.sender, 1_000_000_000 * 1e18);
    }
}

contract TenTwentyFourXTest is Test {
    TenTwentyFourX public game;
    MockCLAWD public token;
    address public player = address(0x1);
    address public gameOwner = address(0x99);

    uint256 constant BET_2K = 2_000 * 1e18;
    uint256 constant BET_10K = 10_000 * 1e18;
    uint256 constant BET_50K = 50_000 * 1e18;

    function setUp() public {
        token = new MockCLAWD();
        game = new TenTwentyFourX(address(token), gameOwner);
        token.transfer(address(game), 600_000_000 * 1e18);
        token.transfer(player, 10_000_000 * 1e18);
    }

    // ===== Legacy Single Roll =====

    function testLegacySingleRoll() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K * 3);
        for (uint256 i = 0; i < 3; i++) {
            bytes32 hash = game.computeHash(bytes32(i + 1), bytes32(uint256(100 + i)));
            game.click(hash, BET_10K, 2);
        }
        vm.stopPrank();
        assertEq(game.totalBets(), 3);
        assertEq(game.getPlayerBetCount(player), 3);
    }

    function testRevealWinSingleRoll() public {
        bytes32 salt = bytes32(uint256(1));
        vm.startPrank(player);
        token.approve(address(game), BET_50K);

        uint256 commitBlock = block.number;
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);

        // Find a winning secret (multi-roll uses index, single-roll uses index 0)
        bytes32 winningSecret;
        bool found;
        for (uint256 i = 0; i < 200; i++) {
            bytes32 candidate = bytes32(i);
            if (game.checkWinAtIndex(candidate, realBlockHash, 2, 0)) {
                winningSecret = candidate;
                found = true;
                break;
            }
        }
        require(found, "Need a winner");
        vm.stopPrank();

        vm.roll(commitBlock);
        vm.startPrank(player);
        bytes32 hash = game.computeHash(winningSecret, salt);
        game.click(hash, BET_50K, 2, 1);
        vm.roll(block.number + 1);

        uint256 balBefore = token.balanceOf(player);
        game.reveal(0, winningSecret, salt);
        uint256 balAfter = token.balanceOf(player);
        // 50K * 2 * 0.98 = 98K gross, - 1% = 97,020
        assertEq(balAfter - balBefore, 97_020 * 1e18);
        vm.stopPrank();
    }

    // ===== Multi-Roll =====

    function testMultiRollPlace() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K * 5);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_10K, 2, 5);
        vm.stopPrank();

        assertEq(game.totalBets(), 5);
        assertEq(game.getPlayerBetCount(player), 1);
        assertEq(game.totalBetAmount(), BET_10K * 5);

        (,, uint256 betAmount, uint256 mult, uint8 numRolls, bool claimed) = game.getBet(player, 0);
        assertEq(betAmount, BET_10K);
        assertEq(mult, 2);
        assertEq(numRolls, 5);
        assertFalse(claimed);
    }

    function testMultiRollBurn() public {
        address burnAddr = 0x000000000000000000000000000000000000dEaD;
        uint256 burnBefore = token.balanceOf(burnAddr);
        vm.startPrank(player);
        token.approve(address(game), BET_10K * 5);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_10K, 2, 5);
        vm.stopPrank();
        // 1% of 50K = 500
        assertEq(token.balanceOf(burnAddr) - burnBefore, 500 * 1e18);
    }

    function testMultiRollRevealWithWins() public {
        bytes32 salt = bytes32(uint256(1));
        vm.startPrank(player);
        token.approve(address(game), BET_10K * 10);

        uint256 commitBlock = block.number;
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);

        bytes32 winningSecret;
        uint8 expectedWins;
        bool found;
        for (uint256 i = 0; i < 500; i++) {
            bytes32 candidate = bytes32(i);
            uint8 wins = game.countWins(candidate, realBlockHash, 2, 10);
            if (wins > 0) {
                winningSecret = candidate;
                expectedWins = wins;
                found = true;
                break;
            }
        }
        require(found, "Need a winner");
        vm.stopPrank();

        vm.roll(commitBlock);
        vm.startPrank(player);
        bytes32 hash = game.computeHash(winningSecret, salt);
        game.click(hash, BET_10K, 2, 10);
        vm.roll(block.number + 1);

        uint256 balBefore = token.balanceOf(player);
        game.reveal(0, winningSecret, salt);
        uint256 balAfter = token.balanceOf(player);

        // Each win: 10K * 2 * 0.98 = 19,600 gross, - 1% = 19,404
        uint256 expectedPayout = 19_404 * 1e18 * expectedWins;
        assertEq(balAfter - balBefore, expectedPayout);
        assertEq(game.totalWins(), expectedWins);
        vm.stopPrank();
    }

    function testMultiRollNoWinsReverts() public {
        bytes32 salt = bytes32(uint256(1));
        vm.startPrank(player);
        token.approve(address(game), BET_10K * 5);

        uint256 commitBlock = block.number;
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);

        bytes32 losingSecret;
        bool found;
        for (uint256 i = 0; i < 500; i++) {
            bytes32 candidate = bytes32(i);
            uint8 wins = game.countWins(candidate, realBlockHash, 2, 5);
            if (wins == 0) {
                losingSecret = candidate;
                found = true;
                break;
            }
        }
        require(found, "Need 0 winners");
        vm.stopPrank();

        vm.roll(commitBlock);
        vm.startPrank(player);
        bytes32 hash = game.computeHash(losingSecret, salt);
        game.click(hash, BET_10K, 2, 5);
        vm.roll(block.number + 1);

        vm.expectRevert("No winning rolls");
        game.reveal(0, losingSecret, salt);
        vm.stopPrank();
    }

    function testMultiRoll20Max() public {
        vm.startPrank(player);
        token.approve(address(game), BET_2K * 20);
        bytes32 hash = game.computeHash(bytes32(uint256(1)), bytes32(uint256(2)));
        game.click(hash, BET_2K, 2, 20);
        vm.stopPrank();
        assertEq(game.totalBets(), 20);
    }

    function testMultiRoll21Reverts() public {
        vm.startPrank(player);
        token.approve(address(game), BET_2K * 21);
        bytes32 hash = game.computeHash(bytes32(uint256(1)), bytes32(uint256(2)));
        vm.expectRevert("1-20 rolls");
        game.click(hash, BET_2K, 2, 21);
        vm.stopPrank();
    }

    function testMultiRollZeroReverts() public {
        vm.startPrank(player);
        token.approve(address(game), BET_2K);
        bytes32 hash = game.computeHash(bytes32(uint256(1)), bytes32(uint256(2)));
        vm.expectRevert("1-20 rolls");
        game.click(hash, BET_2K, 2, 0);
        vm.stopPrank();
    }

    function testMultiRollSolvencyCheck() public {
        TenTwentyFourX poorGame = new TenTwentyFourX(address(token), gameOwner);
        token.transfer(address(poorGame), 1_000_000 * 1e18);
        vm.startPrank(player);
        token.approve(address(poorGame), BET_10K * 5);
        bytes32 hash = poorGame.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        vm.expectRevert("Payout exceeds max (1/5 of house)");
        poorGame.click(hash, BET_10K, 1024, 5);
        vm.stopPrank();
    }

    // ===== View Functions =====

    function testCountWins() public view {
        bytes32 secret = bytes32(uint256(42));
        bytes32 blockHash = bytes32(uint256(100));
        uint8 wins = game.countWins(secret, blockHash, 2, 10);
        assertTrue(wins <= 10);
    }

    function testGetMultiRollPayout() public view {
        // 10K * 2x * 0.98 * 3 = 58,800 gross, - 1% = 58,212
        uint256 payout = game.getMultiRollPayout(BET_10K, 2, 3);
        assertEq(payout, 58_212 * 1e18);
    }

    // ===== Existing Tests =====

    function testBatchReveal() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K * 2);

        uint256 commitBlock = block.number;
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);

        bytes32 win1;
        bytes32 win2;
        uint256 found = 0;
        for (uint256 i = 0; i < 200 && found < 2; i++) {
            bytes32 candidate = bytes32(i);
            if (game.checkWinAtIndex(candidate, realBlockHash, 2, 0)) {
                if (found == 0) win1 = candidate;
                else win2 = candidate;
                found++;
            }
        }
        require(found == 2, "Need 2 winners");
        vm.stopPrank();

        vm.roll(commitBlock);
        vm.startPrank(player);
        bytes32 salt1 = bytes32(uint256(1));
        bytes32 salt2 = bytes32(uint256(2));
        game.click(game.computeHash(win1, salt1), BET_10K, 2, 1);
        game.click(game.computeHash(win2, salt2), BET_10K, 2, 1);
        vm.roll(block.number + 1);

        uint256[] memory indices = new uint256[](2);
        bytes32[] memory secrets = new bytes32[](2);
        bytes32[] memory salts = new bytes32[](2);
        indices[0] = 0; indices[1] = 1;
        secrets[0] = win1; secrets[1] = win2;
        salts[0] = salt1; salts[1] = salt2;

        uint256 balBefore = token.balanceOf(player);
        game.batchReveal(indices, secrets, salts);
        uint256 balAfter = token.balanceOf(player);
        assertEq(balAfter - balBefore, 38_808 * 1e18);
        assertEq(game.totalWins(), 2);
        vm.stopPrank();
    }

    function testBetExpiration() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_10K, 2);
        vm.roll(block.number + 257);
        vm.expectRevert("Bet expired (>256 blocks)");
        game.reveal(0, bytes32(uint256(42)), bytes32(uint256(1)));
        vm.stopPrank();
    }

    function testBurnMechanism() public {
        address burnAddr = 0x000000000000000000000000000000000000dEaD;
        uint256 burnBefore = token.balanceOf(burnAddr);
        vm.startPrank(player);
        token.approve(address(game), BET_50K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_50K, 2);
        vm.stopPrank();
        assertEq(token.balanceOf(burnAddr) - burnBefore, 500 * 1e18);
    }

    function testInvalidBet() public {
        vm.startPrank(player);
        token.approve(address(game), 25_000 * 1e18);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        vm.expectRevert("Invalid bet amount");
        game.click(hash, 25_000 * 1e18, 2);
        vm.stopPrank();
    }

    function testInvalidMultiplier() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        vm.expectRevert("Invalid multiplier");
        game.click(hash, BET_10K, 3);
        vm.stopPrank();
    }

    function testSolvencyCheck() public {
        TenTwentyFourX poorGame = new TenTwentyFourX(address(token), gameOwner);
        token.transfer(address(poorGame), 1000 * 1e18);
        vm.startPrank(player);
        token.approve(address(poorGame), BET_10K);
        bytes32 hash = poorGame.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        vm.expectRevert("Payout exceeds max (1/5 of house)");
        poorGame.click(hash, BET_10K, 2);
        vm.stopPrank();
    }

    function testWithdrawDelay() public {
        vm.startPrank(gameOwner);
        game.requestWithdraw(gameOwner);
        assertTrue(game.paused());
        vm.expectRevert("Delay not met");
        game.executeWithdraw();
        vm.warp(block.timestamp + 15 minutes);
        uint256 bal = token.balanceOf(address(game));
        game.executeWithdraw();
        vm.stopPrank();
        assertEq(token.balanceOf(gameOwner), bal);
    }

    function testWithdrawPausesBets() public {
        vm.prank(gameOwner);
        game.requestWithdraw(gameOwner);
        vm.startPrank(player);
        token.approve(address(game), BET_10K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        vm.expectRevert("Game paused");
        game.click(hash, BET_10K, 2);
        vm.stopPrank();
    }

    function testCancelWithdraw() public {
        vm.prank(gameOwner);
        game.requestWithdraw(gameOwner);
        vm.prank(gameOwner);
        game.cancelWithdraw();
        assertFalse(game.paused());
        vm.startPrank(player);
        token.approve(address(game), BET_10K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_10K, 2);
        vm.stopPrank();
    }

    function testOnlyOwner() public {
        vm.prank(player);
        vm.expectRevert("Not owner");
        game.requestWithdraw(player);
    }

    function testPayoutCalculation() public view {
        assertEq(game.getPayoutFor(BET_10K, 2), 19_404 * 1e18);
        assertEq(game.getPayoutFor(BET_2K, 1024), 1986969600000000000000000);
    }

    function testTwoStepOwnership() public {
        address newOwner = address(0x42);
        vm.prank(gameOwner);
        game.proposeOwner(newOwner);
        vm.prank(player);
        vm.expectRevert("Not pending owner");
        game.acceptOwnership();
        vm.prank(newOwner);
        game.acceptOwnership();
        assertEq(game.owner(), newOwner);
    }

    function testRequestWithdrawCannotResetTimer() public {
        vm.startPrank(gameOwner);
        game.requestWithdraw(gameOwner);
        vm.expectRevert("Withdrawal already pending");
        game.requestWithdraw(gameOwner);
        vm.stopPrank();
    }

    function testWithdrawTimeRemaining() public {
        assertEq(game.withdrawTimeRemaining(), 0);
        vm.prank(gameOwner);
        game.requestWithdraw(gameOwner);
        assertEq(game.withdrawTimeRemaining(), 15 minutes);
        vm.warp(block.timestamp + 10 minutes);
        assertEq(game.withdrawTimeRemaining(), 5 minutes);
        vm.warp(block.timestamp + 5 minutes);
        assertEq(game.withdrawTimeRemaining(), 0);
    }

    function testRenounceOwnership() public {
        vm.prank(gameOwner);
        game.renounceOwnership();
        assertEq(game.owner(), address(0));
        vm.prank(gameOwner);
        vm.expectRevert("Not owner");
        game.requestWithdraw(gameOwner);
    }
}
