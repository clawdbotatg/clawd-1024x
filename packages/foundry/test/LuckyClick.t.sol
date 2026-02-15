// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/LuckyClick.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockCLAWD is ERC20 {
    constructor() ERC20("CLAWD", "CLAWD") {
        _mint(msg.sender, 1_000_000_000 * 1e18);
    }
}

contract LuckyClickTest is Test {
    LuckyClick public game;
    MockCLAWD public token;
    address public player = address(0x1);
    address public house = address(0x2);

    function setUp() public {
        token = new MockCLAWD();
        game = new LuckyClick(address(token));

        // Fund the house
        token.transfer(address(game), 1_000_000 * 1e18);

        // Fund the player
        token.transfer(player, 100_000 * 1e18);
    }

    function testClick() public {
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        bytes32 secret = bytes32(uint256(42));
        bytes32 salt = bytes32(uint256(123));
        bytes32 hash = game.computeHash(secret, salt);

        game.click(hash);
        vm.stopPrank();

        assertEq(game.totalBets(), 1);
        assertEq(game.totalBetAmount(), 10_000 * 1e18);
    }

    function testCannotRevealSameBlock() public {
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        bytes32 secret = bytes32(uint256(42));
        bytes32 salt = bytes32(uint256(123));
        bytes32 hash = game.computeHash(secret, salt);

        game.click(hash);

        vm.expectRevert("Wait one block");
        game.reveal(secret, salt);
        vm.stopPrank();
    }

    function testRevealWinner() public {
        // Brute force a winning secret for the next block
        bytes32 salt = bytes32(uint256(1));
        bytes32 winningSecret;
        
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        // We need to find a secret that wins given the blockhash of the commit block
        // First commit with a placeholder, then we'll test the checkWin logic
        // For a deterministic test, let's just verify the mechanic works
        
        // Try many secrets to find a winner
        uint256 commitBlock = block.number;
        bytes32 futureBlockHash = blockhash(commitBlock); // will be 0 in same block
        
        // Roll forward to get a real blockhash
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);
        
        // Find a winning secret
        for (uint256 i = 0; i < 100; i++) {
            bytes32 candidate = bytes32(i);
            if (game.checkWin(candidate, realBlockHash)) {
                winningSecret = candidate;
                break;
            }
        }
        vm.stopPrank();

        // Now do the actual bet with the winning secret
        // Reset block
        vm.roll(commitBlock);
        
        vm.startPrank(player);
        bytes32 hash = game.computeHash(winningSecret, salt);
        game.click(hash);
        
        vm.roll(block.number + 1);

        uint256 balBefore = token.balanceOf(player);
        game.reveal(winningSecret, salt);
        uint256 balAfter = token.balanceOf(player);

        assertEq(balAfter - balBefore, 90_000 * 1e18);
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

        // Find a LOSING secret
        bytes32 losingSecret;
        for (uint256 i = 0; i < 100; i++) {
            bytes32 candidate = bytes32(i);
            if (!game.checkWin(candidate, realBlockHash)) {
                losingSecret = candidate;
                break;
            }
        }

        // Reset and bet
        vm.roll(commitBlock);
        bytes32 hash = game.computeHash(losingSecret, salt);
        game.click(hash);

        vm.roll(block.number + 1);

        vm.expectRevert("Not a winner");
        game.reveal(losingSecret, salt);
        vm.stopPrank();
    }

    function testHouseBalance() public {
        assertEq(game.houseBalance(), 1_000_000 * 1e18);
    }

    function testEmptyHashReverts() public {
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);
        vm.expectRevert("Empty hash");
        game.click(bytes32(0));
        vm.stopPrank();
    }

    function testExpiredBet() public {
        vm.startPrank(player);
        token.approve(address(game), 10_000 * 1e18);

        bytes32 secret = bytes32(uint256(42));
        bytes32 salt = bytes32(uint256(123));
        bytes32 hash = game.computeHash(secret, salt);
        game.click(hash);

        // Roll past 256 blocks
        vm.roll(block.number + 257);

        vm.expectRevert("Bet expired (>256 blocks)");
        game.reveal(secret, salt);
        vm.stopPrank();
    }

    function testCanBetAgainAfterExpiry() public {
        vm.startPrank(player);
        token.approve(address(game), 20_000 * 1e18);

        bytes32 secret = bytes32(uint256(42));
        bytes32 salt = bytes32(uint256(123));
        bytes32 hash = game.computeHash(secret, salt);
        game.click(hash);

        // Roll past 256 blocks
        vm.roll(block.number + 257);

        // Should be able to bet again
        bytes32 hash2 = game.computeHash(bytes32(uint256(99)), salt);
        game.click(hash2);
        vm.stopPrank();

        assertEq(game.totalBets(), 2);
    }
}
