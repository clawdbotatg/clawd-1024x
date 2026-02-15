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

    uint256 constant BET_10K = 10_000 * 1e18;
    uint256 constant BET_50K = 50_000 * 1e18;
    uint256 constant BET_500K = 500_000 * 1e18;

    function setUp() public {
        token = new MockCLAWD();
        game = new TenTwentyFourX(address(token), gameOwner);
        token.transfer(address(game), 600_000_000 * 1e18);
        token.transfer(player, 10_000_000 * 1e18);
    }

    function testMultipleRolls() public {
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

    function testRevealByIndex() public {
        bytes32 salt = bytes32(uint256(1));

        vm.startPrank(player);
        token.approve(address(game), BET_50K);

        uint256 commitBlock = block.number;
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);

        bytes32 winningSecret;
        for (uint256 i = 0; i < 100; i++) {
            bytes32 candidate = bytes32(i);
            if (game.checkWin(candidate, realBlockHash, 2)) {
                winningSecret = candidate;
                break;
            }
        }
        vm.stopPrank();

        vm.roll(commitBlock);
        vm.startPrank(player);
        bytes32 hash = game.computeHash(winningSecret, salt);
        game.click(hash, BET_50K, 2);
        vm.roll(block.number + 1);

        uint256 balBefore = token.balanceOf(player);
        game.reveal(0, winningSecret, salt); // betIndex 0
        uint256 balAfter = token.balanceOf(player);

        assertEq(balAfter - balBefore, 98_000 * 1e18); // 50K * 2 * 98/100
        vm.stopPrank();
    }

    function testBatchReveal() public {
        // Place 2 bets in same block
        vm.startPrank(player);
        token.approve(address(game), BET_10K * 2);

        uint256 commitBlock = block.number;

        bytes32 salt1 = bytes32(uint256(1));
        bytes32 salt2 = bytes32(uint256(2));

        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);

        // Find 2 winning secrets for 2x
        bytes32 win1;
        bytes32 win2;
        uint256 found = 0;
        for (uint256 i = 0; i < 200 && found < 2; i++) {
            bytes32 candidate = bytes32(i);
            if (game.checkWin(candidate, realBlockHash, 2)) {
                if (found == 0) win1 = candidate;
                else win2 = candidate;
                found++;
            }
        }
        require(found == 2, "Need 2 winners for test");
        vm.stopPrank();

        vm.roll(commitBlock);
        vm.startPrank(player);
        game.click(game.computeHash(win1, salt1), BET_10K, 2);
        game.click(game.computeHash(win2, salt2), BET_10K, 2);
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

        // 2 wins at 2x: 2 * 19,600 = 39,200
        assertEq(balAfter - balBefore, 39_200 * 1e18);
        assertEq(game.totalWins(), 2);
        vm.stopPrank();
    }

    function testBetExpiration() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_10K, 2);

        // Advance past 256 blocks
        vm.roll(block.number + 257);

        vm.expectRevert("Bet expired (>256 blocks)");
        game.reveal(0, bytes32(uint256(42)), bytes32(uint256(1)));
        vm.stopPrank();
    }

    function testGetActiveBets() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K * 3);

        for (uint256 i = 0; i < 3; i++) {
            bytes32 hash = game.computeHash(bytes32(i + 1), bytes32(uint256(100)));
            game.click(hash, BET_10K, 4);
        }
        vm.stopPrank();

        (uint256[] memory indices, , , uint256[] memory multipliers, ) = game.getActiveBets(player);
        assertEq(indices.length, 3);
        assertEq(multipliers[0], 4);
    }

    function testBurnMechanism() public {
        address burnAddr = 0x000000000000000000000000000000000000dEaD;
        uint256 burnBefore = token.balanceOf(burnAddr);

        vm.startPrank(player);
        token.approve(address(game), BET_500K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_500K, 2);
        vm.stopPrank();

        assertEq(token.balanceOf(burnAddr) - burnBefore, 5_000 * 1e18); // 1% of 500K
        assertEq(game.totalBurned(), 5_000 * 1e18);
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
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        vm.expectRevert("House underfunded for this bet");
        poorGame.click(hash, BET_10K, 2);
        vm.stopPrank();
    }

    // ===== Owner withdrawal tests =====

    function testWithdrawDelay() public {
        vm.startPrank(gameOwner);
        game.requestWithdraw(gameOwner);

        assertTrue(game.paused());

        // Can't execute yet
        vm.expectRevert("Delay not met");
        game.executeWithdraw();

        // Advance 5 minutes
        vm.warp(block.timestamp + 5 minutes);

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
        assertTrue(game.paused());

        vm.prank(gameOwner);
        game.cancelWithdraw();
        assertFalse(game.paused());

        // Can bet again
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

    function testForfeit() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_10K, 4);
        vm.roll(block.number + 1);
        game.forfeit(0);

        (, , , , bool claimed, ) = game.getBet(player, 0);
        assertTrue(claimed);
        vm.stopPrank();
    }

    function testPayoutCalculation() public view {
        assertEq(game.getPayoutFor(BET_10K, 2), 19_600 * 1e18);
        assertEq(game.getPayoutFor(BET_500K, 1024), 501_760_000 * 1e18);
    }
}
