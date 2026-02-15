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

    uint256 constant BET_10K = 10_000 * 1e18;
    uint256 constant BET_50K = 50_000 * 1e18;
    uint256 constant BET_100K = 100_000 * 1e18;
    uint256 constant BET_500K = 500_000 * 1e18;

    function setUp() public {
        token = new MockCLAWD();
        game = new TenTwentyFourX(address(token));
        // Fund house with 600M (enough for 500K * 1024x)
        token.transfer(address(game), 600_000_000 * 1e18);
        // Fund player generously
        token.transfer(player, 10_000_000 * 1e18);
    }

    function testValidMultipliers() public view {
        uint256[10] memory m = game.getValidMultipliers();
        assertEq(m[0], 2);
        assertEq(m[9], 1024);
    }

    function testValidBets() public view {
        uint256[4] memory b = game.getValidBets();
        assertEq(b[0], BET_10K);
        assertEq(b[1], BET_50K);
        assertEq(b[2], BET_100K);
        assertEq(b[3], BET_500K);
    }

    function testClick10K() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_10K, 2);
        vm.stopPrank();

        assertEq(game.totalBets(), 1);
        assertEq(game.totalBetAmount(), BET_10K);
        assertEq(game.totalBurned(), 100 * 1e18); // 1% of 10K
    }

    function testClick500K() public {
        vm.startPrank(player);
        token.approve(address(game), BET_500K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_500K, 4);
        vm.stopPrank();

        assertEq(game.totalBetAmount(), BET_500K);
        assertEq(game.totalBurned(), 5_000 * 1e18); // 1% of 500K
    }

    function testInvalidBetAmount() public {
        vm.startPrank(player);
        token.approve(address(game), 25_000 * 1e18);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        vm.expectRevert("Invalid bet amount");
        game.click(hash, 25_000 * 1e18, 2); // 25K not a valid tier
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

    function testPayoutCalculation() public view {
        // 10K * 2 * 98/100 = 19,600
        assertEq(game.getPayoutFor(BET_10K, 2), 19_600 * 1e18);
        // 500K * 1024 * 98/100 = 501,760,000
        assertEq(game.getPayoutFor(BET_500K, 1024), 501_760_000 * 1e18);
        // 50K * 8 * 98/100 = 392,000
        assertEq(game.getPayoutFor(BET_50K, 8), 392_000 * 1e18);
    }

    function testSolvencyCheck() public {
        TenTwentyFourX poorGame = new TenTwentyFourX(address(token));
        token.transfer(address(poorGame), 1000 * 1e18);

        vm.startPrank(player);
        token.approve(address(poorGame), BET_10K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        vm.expectRevert("House underfunded for this bet");
        poorGame.click(hash, BET_10K, 2);
        vm.stopPrank();
    }

    function testMaxMultiplierForBet() public {
        // With 600M, should handle all multipliers for all bet sizes
        assertEq(game.maxMultiplierForBet(BET_10K), 1024);
        assertEq(game.maxMultiplierForBet(BET_500K), 1024);

        // Small game: 25K house
        TenTwentyFourX smallGame = new TenTwentyFourX(address(token));
        token.transfer(address(smallGame), 25_000 * 1e18);
        // 10K bet at 2x needs 19.6K payout, house has 25K + 9.9K net = 34.9K → ok
        // 10K bet at 4x needs 39.2K payout → too much
        assertEq(smallGame.maxMultiplierForBet(BET_10K), 2);
        // 50K bet can't even do 2x (needs 98K payout)
        assertEq(smallGame.maxMultiplierForBet(BET_50K), 0);
    }

    function testRevealWinner() public {
        bytes32 salt = bytes32(uint256(1));
        bytes32 winningSecret;

        vm.startPrank(player);
        token.approve(address(game), BET_50K);

        uint256 commitBlock = block.number;
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);

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
        game.reveal(winningSecret, salt);
        uint256 balAfter = token.balanceOf(player);

        // 50K * 2 * 98/100 = 98,000 CLAWD
        assertEq(balAfter - balBefore, 98_000 * 1e18);
        assertEq(game.totalWins(), 1);
        vm.stopPrank();
    }

    function testLoserCannotReveal() public {
        bytes32 salt = bytes32(uint256(1));

        vm.startPrank(player);
        token.approve(address(game), BET_10K);

        uint256 commitBlock = block.number;
        vm.roll(block.number + 1);
        bytes32 realBlockHash = blockhash(commitBlock);

        bytes32 losingSecret;
        for (uint256 i = 0; i < 100; i++) {
            bytes32 candidate = bytes32(i);
            if (!game.checkWin(candidate, realBlockHash, 2)) {
                losingSecret = candidate;
                break;
            }
        }

        vm.roll(commitBlock);
        bytes32 hash = game.computeHash(losingSecret, salt);
        game.click(hash, BET_10K, 2);
        vm.roll(block.number + 1);

        vm.expectRevert("Not a winner");
        game.reveal(losingSecret, salt);
        vm.stopPrank();
    }

    function testGetBetInfo() public {
        vm.startPrank(player);
        token.approve(address(game), BET_100K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_100K, 16);

        (bytes32 dataHash, , uint256 betAmount, uint256 multiplier, bool claimed, uint256 blocksLeft) = game.getBet(player);
        assertEq(dataHash, hash);
        assertEq(betAmount, BET_100K);
        assertEq(multiplier, 16);
        assertEq(claimed, false);
        assertGt(blocksLeft, 0);
        vm.stopPrank();
    }

    function testForfeit() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_10K, 4);
        vm.roll(block.number + 1);
        game.forfeit();

        (, , , , bool claimed, ) = game.getBet(player);
        assertTrue(claimed);
        vm.stopPrank();
    }

    function testBurnMechanism() public {
        address burnAddr = 0x000000000000000000000000000000000000dEaD;
        uint256 burnBefore = token.balanceOf(burnAddr);

        vm.startPrank(player);
        token.approve(address(game), BET_100K);
        bytes32 hash = game.computeHash(bytes32(uint256(42)), bytes32(uint256(1)));
        game.click(hash, BET_100K, 2);
        vm.stopPrank();

        // 1% of 100K = 1000 CLAWD burned
        assertEq(token.balanceOf(burnAddr) - burnBefore, 1_000 * 1e18);
        assertEq(game.totalBurned(), 1_000 * 1e18);
    }

    function testEmptyHashReverts() public {
        vm.startPrank(player);
        token.approve(address(game), BET_10K);
        vm.expectRevert("Empty hash");
        game.click(bytes32(0), BET_10K, 2);
        vm.stopPrank();
    }

    function testHouseBalance() public view {
        assertEq(game.houseBalance(), 600_000_000 * 1e18);
    }
}
