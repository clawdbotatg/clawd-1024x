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
    address public house = address(0x2);

    function setUp() public {
        token = new MockCLAWD();
        game = new TenTwentyFourX(address(token));

        // Fund the house - need enough for highest multiplier
        token.transfer(address(game), 100_000_000 * 1e18); // 100M CLAWD

        // Fund the player
        token.transfer(player, 100_000 * 1e18);
    }

    function testValidMultipliers() public view {
        uint256[10] memory multipliers = game.getValidMultipliers();
        assertEq(multipliers[0], 2);
        assertEq(multipliers[1], 4);
        assertEq(multipliers[2], 8);
        assertEq(multipliers[9], 1024);
    }

    function testClickWithMultiplier() public {
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        bytes32 secret = bytes32(uint256(42));
        bytes32 salt = bytes32(uint256(123));
        bytes32 hash = game.computeHash(secret, salt);

        game.click(hash, 2); // 2x multiplier
        vm.stopPrank();

        assertEq(game.totalBets(), 1);
        assertEq(game.totalBetAmount(), 10_000 * 1e18);
    }

    function testInvalidMultiplier() public {
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(123)));

        vm.expectRevert("Invalid multiplier");
        game.click(hash, 3); // 3 is not a valid multiplier
        vm.stopPrank();
    }

    function testPayoutCalculation() public view {
        // 2x multiplier: 10,000 * 2 * 98/100 = 19,600 CLAWD
        assertEq(game.getPayoutForMultiplier(2), 19_600 * 1e18);
        
        // 1024x multiplier: 10,000 * 1024 * 98/100 = 10,035,200 CLAWD
        assertEq(game.getPayoutForMultiplier(1024), 10_035_200 * 1e18);
    }

    function testSolvencyCheck() public {
        // Create a game with insufficient funds
        TenTwentyFourX poorGame = new TenTwentyFourX(address(token));
        
        // Only fund with 1000 CLAWD (not enough for even 2x)
        token.transfer(address(poorGame), 1000 * 1e18);

        vm.startPrank(player);
        token.approve(address(poorGame), 10_000 * 1e18);

        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(123)));

        vm.expectRevert("House underfunded for this multiplier");
        poorGame.click(hash, 2);
        vm.stopPrank();
    }

    function testMaxMultiplier() public {
        // With 100M CLAWD, house should support up to 1024x
        assertEq(game.maxMultiplier(), 1024);

        // Create game with smaller balance
        TenTwentyFourX smallGame = new TenTwentyFourX(address(token));
        // Fund with 25K CLAWD + 10K bet = 35K total, should support 2x (needs 19.6K payout)
        // but not 4x (needs 39.2K payout)
        token.transfer(address(smallGame), 25_000 * 1e18);
        
        assertEq(smallGame.maxMultiplier(), 2);
    }

    function testRevealWinner() public {
        // Find a winning secret for 2x multiplier
        bytes32 salt = bytes32(uint256(1));
        bytes32 winningSecret;
        
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        uint256 commitBlock = block.number;
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);
        
        // Find a winning secret (1 in 2 chance)
        for (uint256 i = 0; i < 100; i++) {
            bytes32 candidate = bytes32(i);
            if (game.checkWin(candidate, realBlockHash, 2)) {
                winningSecret = candidate;
                break;
            }
        }
        vm.stopPrank();

        // Reset and do actual bet
        vm.roll(commitBlock);
        
        vm.startPrank(player);
        bytes32 hash = game.computeHash(winningSecret, salt);
        game.click(hash, 2);
        
        vm.roll(block.number + 1);

        uint256 balBefore = token.balanceOf(player);
        game.reveal(winningSecret, salt);
        uint256 balAfter = token.balanceOf(player);

        // Should get 19,600 CLAWD (2x multiplier with 2% house edge)
        assertEq(balAfter - balBefore, 19_600 * 1e18);
        assertEq(game.totalWins(), 1);
        vm.stopPrank();
    }

    function testLoserCannotReveal() public {
        bytes32 salt = bytes32(uint256(1));
        
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        uint256 commitBlock = block.number;
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);

        // Find a LOSING secret for 2x
        bytes32 losingSecret;
        for (uint256 i = 0; i < 100; i++) {
            bytes32 candidate = bytes32(i);
            if (!game.checkWin(candidate, realBlockHash, 2)) {
                losingSecret = candidate;
                break;
            }
        }

        // Reset and bet
        vm.roll(commitBlock);
        bytes32 hash = game.computeHash(losingSecret, salt);
        game.click(hash, 2);

        vm.roll(block.number + 1);

        vm.expectRevert("Not a winner");
        game.reveal(losingSecret, salt);
        vm.stopPrank();
    }

    function testGetBetInfo() public {
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        bytes32 secret = bytes32(uint256(42));
        bytes32 salt = bytes32(uint256(123));
        bytes32 hash = game.computeHash(secret, salt);

        game.click(hash, 16); // 16x multiplier

        (bytes32 dataHash, , uint256 multiplier, bool claimed, uint256 blocksLeft) = game.getBet(player);
        
        assertEq(dataHash, hash);
        assertEq(multiplier, 16);
        assertEq(claimed, false);
        assertGt(blocksLeft, 0);
        vm.stopPrank();
    }

    function testForfeit() public {
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(123)));
        game.click(hash, 4);

        vm.roll(block.number + 1);

        game.forfeit();

        (, , , bool claimed, ) = game.getBet(player);
        assertTrue(claimed);
        vm.stopPrank();
    }

    function testHouseFunding() public view {
        assertEq(game.houseBalance(), 100_000_000 * 1e18);
    }

    function testEmptyHashReverts() public {
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);
        vm.expectRevert("Empty hash");
        game.click(bytes32(0), 2);
        vm.stopPrank();
    }

    function testHighMultiplierWin() public {
        // Test 1024x multiplier win
        bytes32 salt = bytes32(uint256(1));
        bytes32 winningSecret;
        
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        uint256 commitBlock = block.number;
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);
        
        // Find a winning secret for 1024x (very rare!)
        for (uint256 i = 0; i < 10000; i++) {
            bytes32 candidate = bytes32(i);
            if (game.checkWin(candidate, realBlockHash, 1024)) {
                winningSecret = candidate;
                break;
            }
        }

        // If we found a winner, test it
        if (winningSecret != bytes32(0)) {
            vm.roll(commitBlock);
            
            bytes32 hash = game.computeHash(winningSecret, salt);
            game.click(hash, 1024);
            
            vm.roll(block.number + 1);

            uint256 balBefore = token.balanceOf(player);
            game.reveal(winningSecret, salt);
            uint256 balAfter = token.balanceOf(player);

            // Should get 10,035,200 CLAWD (1024x multiplier with 2% house edge)
            assertEq(balAfter - balBefore, 10_035_200 * 1e18);
        }
        vm.stopPrank();
    }
}