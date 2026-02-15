"use client";

import { useCallback, useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { encodePacked, formatEther, keccak256, parseEther } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth/useScaffoldEventHistory";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth/useScaffoldWriteContract";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { notification } from "~~/utils/scaffold-eth";

const BET_TIERS = [
  { value: parseEther("10000"), label: "10K", display: "10,000" },
  { value: parseEther("50000"), label: "50K", display: "50,000" },
  { value: parseEther("100000"), label: "100K", display: "100,000" },
  { value: parseEther("500000"), label: "500K", display: "500,000" },
];

const MULTIPLIERS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

const STORAGE_KEY = "1024x-pending";

function savePending(address: string, secret: string, salt: string, commitBlock: number, betAmount: string, multiplier: number) {
  try {
    localStorage.setItem(`${STORAGE_KEY}-${address}`, JSON.stringify({ secret, salt, commitBlock, betAmount, multiplier }));
  } catch {}
}

function loadPending(address: string): { secret: string; salt: string; commitBlock: number; betAmount: string; multiplier: number } | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${address}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearPending(address: string) {
  try {
    localStorage.removeItem(`${STORAGE_KEY}-${address}`);
  } catch {}
}

function randomBytes32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return ("0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

function parseError(e: unknown): string {
  const msg = (e as Error)?.message || String(e);
  if (msg.includes("user rejected") || msg.includes("User denied")) return "Transaction cancelled";
  if (msg.includes("House underfunded")) return "House can't cover this bet. Try lower odds or smaller bet.";
  if (msg.includes("Wait one block")) return "You have a pending bet. Wait a moment and try again.";
  if (msg.includes("Bet expired")) return "Your bet expired. Place a new one!";
  if (msg.includes("Not a winner")) return "Not a winning reveal";
  if (msg.includes("insufficient allowance") || msg.includes("ERC20InsufficientAllowance")) return "Need to approve CLAWD first";
  if (msg.includes("Invalid bet")) return "Invalid bet amount";
  if (msg.includes("Invalid multiplier")) return "Invalid multiplier";
  return "Transaction failed";
}

type GameState = "idle" | "approving" | "clicking" | "waiting" | "won" | "lost" | "claiming" | "expired";

const Home: NextPage = () => {
  const { address: connectedAddress, chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const isWrongNetwork = chain?.id !== targetNetwork.id;

  const [gameState, setGameState] = useState<GameState>("idle");
  const [selectedBet, setSelectedBet] = useState(BET_TIERS[0]);
  const [selectedMultiplier, setSelectedMultiplier] = useState(2);
  const [pendingSecret, setPendingSecret] = useState<string | null>(null);
  const [pendingSalt, setPendingSalt] = useState<string | null>(null);
  const [pendingCommitBlock, setPendingCommitBlock] = useState<number | null>(null);
  const [pendingBetAmount, setPendingBetAmount] = useState<bigint | null>(null);
  const [pendingMultiplier, setPendingMultiplier] = useState<number | null>(null);

  const { writeContractAsync: approveWrite } = useScaffoldWriteContract("CLAWD");
  const { writeContractAsync: clickWrite } = useScaffoldWriteContract("TenTwentyFourX");
  const { writeContractAsync: revealWrite } = useScaffoldWriteContract("TenTwentyFourX");

  const { data: clawdBalance } = useScaffoldReadContract({
    contractName: "CLAWD",
    functionName: "balanceOf",
    args: [connectedAddress],
  });

  const { data: contractData } = useDeployedContractInfo("TenTwentyFourX");
  const contractAddress = contractData?.address;

  const { data: allowance, refetch: refetchAllowance } = useScaffoldReadContract({
    contractName: "CLAWD",
    functionName: "allowance",
    args: [connectedAddress, contractAddress],
    query: { enabled: !!connectedAddress && !!contractAddress },
  });

  const needsApproval = !allowance || allowance < selectedBet.value;

  const { data: houseBalance } = useScaffoldReadContract({
    contractName: "TenTwentyFourX",
    functionName: "houseBalance",
  });

  const { data: totalBets } = useScaffoldReadContract({ contractName: "TenTwentyFourX", functionName: "totalBets" });
  const { data: totalWins } = useScaffoldReadContract({ contractName: "TenTwentyFourX", functionName: "totalWins" });
  const { data: totalPaidOut } = useScaffoldReadContract({ contractName: "TenTwentyFourX", functionName: "totalPaidOut" });
  const { data: totalBurned } = useScaffoldReadContract({ contractName: "TenTwentyFourX", functionName: "totalBurned" });

  const { data: winEvents } = useScaffoldEventHistory({
    contractName: "TenTwentyFourX",
    eventName: "Won",
    fromBlock: 0n,
    watch: true,
  });

  // Calculate payout for current selection
  const currentPayout = (selectedBet.value * BigInt(selectedMultiplier) * 98n) / 100n;
  const currentBurn = selectedBet.value / 100n;

  // Check if house can cover this bet
  const canAfford = (betValue: bigint, mult: number): boolean => {
    if (!houseBalance) return false;
    const payout = (betValue * BigInt(mult) * 98n) / 100n;
    const netBet = betValue - betValue / 100n;
    return houseBalance + netBet >= payout;
  };

  // Restore pending bet from localStorage
  useEffect(() => {
    if (!connectedAddress) return;
    const pending = loadPending(connectedAddress);
    if (pending) {
      setPendingSecret(pending.secret);
      setPendingSalt(pending.salt);
      setPendingCommitBlock(pending.commitBlock);
      setPendingBetAmount(BigInt(pending.betAmount));
      setPendingMultiplier(pending.multiplier);
      setGameState("waiting");
    }
  }, [connectedAddress]);

  // Check win/loss
  useEffect(() => {
    if (gameState !== "waiting" || !pendingSecret || !pendingCommitBlock || !publicClient) return;

    const checkResult = async () => {
      try {
        const currentBlock = await publicClient.getBlockNumber();
        if (Number(currentBlock) <= pendingCommitBlock) return;

        if (Number(currentBlock) > pendingCommitBlock + 256) {
          setGameState("expired");
          if (connectedAddress) clearPending(connectedAddress);
          return;
        }

        const block = await publicClient.getBlock({ blockNumber: BigInt(pendingCommitBlock) });
        if (!block.hash) return;

        const mult = pendingMultiplier || selectedMultiplier;
        const randomSeed = keccak256(encodePacked(["bytes32", "bytes32"], [pendingSecret as `0x${string}`, block.hash]));
        const isWinner = BigInt(randomSeed) % BigInt(mult) === 0n;

        if (isWinner) {
          setGameState("won");
        } else {
          setGameState("lost");
          if (connectedAddress) clearPending(connectedAddress);
        }
      } catch (e) {
        console.error("Error checking result:", e);
      }
    };

    checkResult();
    const interval = setInterval(checkResult, 2000);
    return () => clearInterval(interval);
  }, [gameState, pendingSecret, pendingCommitBlock, publicClient, connectedAddress, pendingMultiplier, selectedMultiplier]);

  const handleApprove = useCallback(async () => {
    if (!connectedAddress) return;
    setGameState("approving");
    try {
      await approveWrite({
        functionName: "approve",
        args: [contractAddress, selectedBet.value * 5n],
      });
      await refetchAllowance();
      notification.success("CLAWD approved!");
      setGameState("idle");
    } catch (e) {
      notification.error(parseError(e));
      setGameState("idle");
    }
  }, [connectedAddress, approveWrite, contractAddress, refetchAllowance, selectedBet]);

  const handleClick = useCallback(async () => {
    if (!connectedAddress || !publicClient) return;
    setGameState("clicking");
    try {
      const secret = randomBytes32();
      const salt = randomBytes32();
      const dataHash = keccak256(encodePacked(["bytes32", "bytes32"], [secret, salt]));

      const txHash = await clickWrite({
        functionName: "click",
        args: [dataHash, selectedBet.value, BigInt(selectedMultiplier)],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      const commitBlock = Number(receipt.blockNumber);

      savePending(connectedAddress, secret, salt, commitBlock, selectedBet.value.toString(), selectedMultiplier);
      setPendingSecret(secret);
      setPendingSalt(salt);
      setPendingCommitBlock(commitBlock);
      setPendingBetAmount(selectedBet.value);
      setPendingMultiplier(selectedMultiplier);
      setGameState("waiting");
      notification.success("Bet placed! Checking your luck...");
    } catch (e) {
      notification.error(parseError(e));
      setGameState("idle");
    }
  }, [connectedAddress, clickWrite, publicClient, selectedBet, selectedMultiplier]);

  const handleClaim = useCallback(async () => {
    if (!connectedAddress || !pendingSecret || !pendingSalt) return;
    setGameState("claiming");
    try {
      await revealWrite({
        functionName: "reveal",
        args: [pendingSecret as `0x${string}`, pendingSalt as `0x${string}`],
      });
      clearPending(connectedAddress);
      const payout = pendingBetAmount && pendingMultiplier
        ? (pendingBetAmount * BigInt(pendingMultiplier) * 98n) / 100n
        : 0n;
      setPendingSecret(null);
      setPendingSalt(null);
      setPendingCommitBlock(null);
      setPendingBetAmount(null);
      setPendingMultiplier(null);
      setGameState("idle");
      notification.success(`🎉 ${formatClawd(payout)} CLAWD claimed!`);
    } catch (e) {
      notification.error(parseError(e));
      setGameState("won");
    }
  }, [connectedAddress, pendingSecret, pendingSalt, revealWrite, pendingBetAmount, pendingMultiplier]);

  const handlePlayAgain = useCallback(() => {
    setGameState("idle");
    setPendingSecret(null);
    setPendingSalt(null);
    setPendingCommitBlock(null);
    setPendingBetAmount(null);
    setPendingMultiplier(null);
    if (connectedAddress) clearPending(connectedAddress);
  }, [connectedAddress]);

  const formatClawd = (amount: bigint | undefined) => {
    if (!amount) return "0";
    return Number(formatEther(amount)).toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const hasEnoughBalance = clawdBalance !== undefined && clawdBalance >= selectedBet.value;
  const houseCanPay = canAfford(selectedBet.value, selectedMultiplier);

  const winPayout = pendingBetAmount && pendingMultiplier
    ? (pendingBetAmount * BigInt(pendingMultiplier) * 98n) / 100n
    : currentPayout;

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4 min-h-screen">
      {/* Stats Bar */}
      <div className="stats stats-vertical sm:stats-horizontal shadow bg-base-100 w-full max-w-2xl">
        <div className="stat">
          <div className="stat-title">House</div>
          <div className="stat-value text-lg">{formatClawd(houseBalance)}</div>
          <div className="stat-desc">CLAWD</div>
        </div>
        <div className="stat">
          <div className="stat-title">Bets</div>
          <div className="stat-value text-lg">{totalBets?.toString() || "0"}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Wins</div>
          <div className="stat-value text-lg">{totalWins?.toString() || "0"}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Paid Out</div>
          <div className="stat-value text-lg">{formatClawd(totalPaidOut)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">🔥 Burned</div>
          <div className="stat-value text-lg">{formatClawd(totalBurned)}</div>
        </div>
      </div>

      {/* Main Game Card */}
      <div className="card bg-base-100 shadow-xl w-full max-w-md">
        <div className="card-body items-center text-center">
          {/* Idle / Approving / Clicking States */}
          {(gameState === "idle" || gameState === "approving" || gameState === "clicking") && (
            <>
              <div className="text-5xl mb-1">🎰</div>
              <h2 className="card-title text-3xl font-black">1024x</h2>
              <p className="text-sm opacity-70 mb-2">Pick your bet, pick your odds</p>

              {/* Bet Size Selector */}
              <div className="w-full">
                <label className="label"><span className="label-text font-bold">Bet Size</span></label>
                <div className="grid grid-cols-4 gap-2">
                  {BET_TIERS.map((tier) => (
                    <button
                      key={tier.label}
                      className={`btn btn-sm ${selectedBet.label === tier.label ? "btn-primary" : "btn-outline"}`}
                      onClick={() => setSelectedBet(tier)}
                    >
                      {tier.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Multiplier Selector */}
              <div className="w-full mt-2">
                <label className="label"><span className="label-text font-bold">Multiplier</span></label>
                <div className="grid grid-cols-5 gap-2">
                  {MULTIPLIERS.map((mult) => {
                    const affordable = canAfford(selectedBet.value, mult);
                    const isSelected = selectedMultiplier === mult;
                    return (
                      <button
                        key={mult}
                        className={`btn btn-sm ${isSelected ? "btn-secondary" : affordable ? "btn-outline" : "btn-disabled opacity-30"}`}
                        disabled={!affordable}
                        onClick={() => affordable && setSelectedMultiplier(mult)}
                      >
                        {mult}x
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Payout Info */}
              <div className="bg-base-200 rounded-lg p-3 w-full mt-3 text-sm">
                <div className="flex justify-between">
                  <span className="opacity-70">Win chance</span>
                  <span className="font-bold">1 in {selectedMultiplier}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">Payout</span>
                  <span className="font-bold text-success">{formatClawd(currentPayout)} CLAWD</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-70">🔥 Burn</span>
                  <span className="font-bold text-warning">{formatClawd(currentBurn)} CLAWD</span>
                </div>
              </div>

              {connectedAddress && (
                <div className="text-sm opacity-60 mt-1">
                  Balance: <span className="font-mono font-bold">{formatClawd(clawdBalance)}</span> CLAWD
                </div>
              )}

              {/* Action Button */}
              {!connectedAddress ? (
                <div className="alert alert-info mt-3"><span>Connect your wallet to play</span></div>
              ) : isWrongNetwork ? (
                <button className="btn btn-warning btn-lg w-full mt-3" disabled>Switch Network</button>
              ) : !hasEnoughBalance ? (
                <div className="alert alert-warning mt-3"><span>You need at least {selectedBet.display} CLAWD</span></div>
              ) : !houseCanPay ? (
                <div className="alert alert-warning mt-3"><span>House can&apos;t cover this bet. Try lower odds.</span></div>
              ) : needsApproval ? (
                <button className="btn btn-primary btn-lg w-full mt-3" disabled={gameState === "approving"} onClick={handleApprove}>
                  {gameState === "approving" ? (<><span className="loading loading-spinner"></span>Approving...</>) : `Approve ${selectedBet.display} CLAWD`}
                </button>
              ) : (
                <button className="btn btn-primary btn-lg w-full mt-3 text-xl" disabled={gameState === "clicking"} onClick={handleClick}>
                  {gameState === "clicking" ? (<><span className="loading loading-spinner"></span>Placing Bet...</>) : `🎰 BET ${selectedBet.label} @ ${selectedMultiplier}x`}
                </button>
              )}
            </>
          )}

          {/* Waiting State */}
          {gameState === "waiting" && (
            <>
              <div className="text-6xl mb-4 animate-bounce">🎲</div>
              <h2 className="card-title text-2xl">Rolling...</h2>
              <p className="text-sm opacity-70">
                {pendingBetAmount ? formatClawd(pendingBetAmount) : "?"} CLAWD @ {pendingMultiplier || "?"}x
              </p>
              <span className="loading loading-dots loading-lg text-primary mt-4"></span>
            </>
          )}

          {/* Won State */}
          {(gameState === "won" || gameState === "claiming") && (
            <>
              <div className="text-6xl mb-4 animate-pulse">🎉</div>
              <h2 className="card-title text-3xl text-success font-black">YOU HIT {pendingMultiplier}x!</h2>
              <p className="text-lg font-bold">Claim <span className="text-success">{formatClawd(winPayout)} CLAWD</span></p>
              <p className="text-xs opacity-60 mt-1">Reveal on-chain to collect. ~256 blocks to claim.</p>
              <button className="btn btn-success btn-lg w-full mt-4 text-xl" disabled={gameState === "claiming"} onClick={handleClaim}>
                {gameState === "claiming" ? (<><span className="loading loading-spinner"></span>Claiming...</>) : `🏆 CLAIM ${formatClawd(winPayout)} CLAWD`}
              </button>
            </>
          )}

          {/* Lost State */}
          {gameState === "lost" && (
            <>
              <div className="text-6xl mb-4">😤</div>
              <h2 className="card-title text-2xl">Not this time!</h2>
              <p className="text-sm opacity-70">
                Lost {pendingBetAmount ? formatClawd(pendingBetAmount) : "?"} CLAWD on a {pendingMultiplier}x bet.
              </p>
              <button className="btn btn-primary btn-lg w-full mt-4" onClick={handlePlayAgain}>🔄 Try Again</button>
            </>
          )}

          {/* Expired State */}
          {gameState === "expired" && (
            <>
              <div className="text-6xl mb-4">⏰</div>
              <h2 className="card-title text-2xl">Bet Expired</h2>
              <p className="text-sm opacity-70">Your bet expired. Place a new one!</p>
              <button className="btn btn-primary btn-lg w-full mt-4" onClick={handlePlayAgain}>🔄 Play Again</button>
            </>
          )}
        </div>
      </div>

      {/* How It Works */}
      <div className="card bg-base-100 shadow-xl w-full max-w-md">
        <div className="card-body">
          <h2 className="card-title text-lg">How It Works</h2>
          <div className="space-y-2 text-sm">
            <div className="flex gap-3 items-start">
              <span className="badge badge-primary badge-sm mt-1">1</span>
              <p><span className="font-bold">Pick</span> — Choose your bet (10K–500K CLAWD) and multiplier (2x–1024x)</p>
            </div>
            <div className="flex gap-3 items-start">
              <span className="badge badge-primary badge-sm mt-1">2</span>
              <p><span className="font-bold">Roll</span> — Your secret is committed on-chain. After 1 block, we mix it with the blockhash.</p>
            </div>
            <div className="flex gap-3 items-start">
              <span className="badge badge-primary badge-sm mt-1">3</span>
              <p><span className="font-bold">Claim</span> — Hit your odds? Reveal on-chain to collect. Miss? No action needed.</p>
            </div>
          </div>
          <div className="divider my-1"></div>
          <p className="text-xs opacity-50">
            2% house edge • 1% burned every roll 🔥 • Commit-reveal ensures provably fair results
          </p>
        </div>
      </div>

      {/* Recent Wins */}
      {winEvents && winEvents.length > 0 && (
        <div className="card bg-base-100 shadow-xl w-full max-w-md">
          <div className="card-body">
            <h2 className="card-title text-lg">🏆 Recent Winners</h2>
            <div className="space-y-2">
              {winEvents.slice(0, 10).map((event, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-success/10 rounded-lg">
                  <Address address={event.args.player} />
                  <span className="font-bold text-success">
                    {event.args.multiplier?.toString()}x → +{formatClawd(event.args.payout)} 🦞
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
