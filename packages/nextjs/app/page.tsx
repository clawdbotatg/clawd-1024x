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

const BET_AMOUNT = parseEther("10000");
const VALID_MULTIPLIERS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

// localStorage helpers
const STORAGE_KEY = "1024x-pending";

function savePending(address: string, secret: string, salt: string, commitBlock: number, multiplier: number) {
  try {
    localStorage.setItem(`${STORAGE_KEY}-${address}`, JSON.stringify({ secret, salt, commitBlock, multiplier }));
  } catch {}
}

function loadPending(address: string): { secret: string; salt: string; commitBlock: number; multiplier: number } | null {
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
  return ("0x" +
    Array.from(bytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")) as `0x${string}`;
}

function parseError(e: unknown): string {
  const msg = (e as Error)?.message || String(e);
  if (msg.includes("user rejected") || msg.includes("User denied")) return "Transaction cancelled";
  if (msg.includes("House underfunded")) return "House doesn't have enough CLAWD for this multiplier. Try a lower multiplier.";
  if (msg.includes("Invalid multiplier")) return "Invalid multiplier selected";
  if (msg.includes("Active bet exists") || msg.includes("Wait one block before re-betting"))
    return "You have a pending bet. Please wait a moment and try again.";
  if (msg.includes("Bet expired")) return "Your bet expired. Place a new one!";
  if (msg.includes("Not a winner")) return "Not a winning reveal";
  if (msg.includes("insufficient allowance") || msg.includes("ERC20InsufficientAllowance"))
    return "Need to approve CLAWD first";
  return "Transaction failed";
}

type GameState = "idle" | "approving" | "clicking" | "waiting" | "won" | "lost" | "claiming" | "expired";

const Home: NextPage = () => {
  const { address: connectedAddress, chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const isWrongNetwork = chain?.id !== targetNetwork.id;

  const [gameState, setGameState] = useState<GameState>("idle");
  const [selectedMultiplier, setSelectedMultiplier] = useState<number>(2);
  const [pendingSecret, setPendingSecret] = useState<string | null>(null);
  const [pendingSalt, setPendingSalt] = useState<string | null>(null);
  const [pendingCommitBlock, setPendingCommitBlock] = useState<number | null>(null);
  const [pendingMultiplier, setPendingMultiplier] = useState<number | null>(null);

  // Contract write hooks
  const { writeContractAsync: approveWrite } = useScaffoldWriteContract("CLAWD");
  const { writeContractAsync: clickWrite } = useScaffoldWriteContract("TenTwentyFourX");
  const { writeContractAsync: revealWrite } = useScaffoldWriteContract("TenTwentyFourX");

  // Read user's CLAWD balance
  const { data: clawdBalance } = useScaffoldReadContract({
    contractName: "CLAWD",
    functionName: "balanceOf",
    args: [connectedAddress],
  });

  // Get the TenTwentyFourX contract address
  const { data: contractData } = useDeployedContractInfo("TenTwentyFourX");
  const contractAddress = contractData?.address;

  // Read allowance
  const { data: allowance, refetch: refetchAllowance } = useScaffoldReadContract({
    contractName: "CLAWD",
    functionName: "allowance",
    args: [connectedAddress, contractAddress],
    query: { enabled: !!connectedAddress && !!contractAddress },
  });

  const needsApproval = !allowance || allowance < BET_AMOUNT;

  // House balance and max multiplier
  const { data: houseBalance } = useScaffoldReadContract({
    contractName: "TenTwentyFourX",
    functionName: "houseBalance",
  });

  const { data: maxMultiplier } = useScaffoldReadContract({
    contractName: "TenTwentyFourX",
    functionName: "maxMultiplier",
  });

  // Get payout for selected multiplier
  const { data: selectedPayout } = useScaffoldReadContract({
    contractName: "TenTwentyFourX",
    functionName: "getPayoutForMultiplier",
    args: [BigInt(selectedMultiplier)],
  });

  // Stats
  const { data: totalBets } = useScaffoldReadContract({
    contractName: "TenTwentyFourX",
    functionName: "totalBets",
  });
  const { data: totalWins } = useScaffoldReadContract({
    contractName: "TenTwentyFourX",
    functionName: "totalWins",
  });
  const { data: totalPaidOut } = useScaffoldReadContract({
    contractName: "TenTwentyFourX",
    functionName: "totalPaidOut",
  });

  // Recent wins
  const { data: winEvents } = useScaffoldEventHistory({
    contractName: "TenTwentyFourX",
    eventName: "Won",
    fromBlock: 0n,
    watch: true,
  });

  // Restore pending bet from localStorage on mount/connect
  useEffect(() => {
    if (!connectedAddress) return;
    const pending = loadPending(connectedAddress);
    if (pending) {
      setPendingSecret(pending.secret);
      setPendingSalt(pending.salt);
      setPendingCommitBlock(pending.commitBlock);
      setPendingMultiplier(pending.multiplier);
      setGameState("waiting");
    }
  }, [connectedAddress]);

  // Check win/loss when we have a pending bet and block has advanced
  useEffect(() => {
    if (gameState !== "waiting" || !pendingSecret || !pendingCommitBlock || !pendingMultiplier || !publicClient) return;

    const checkResult = async () => {
      try {
        const currentBlock = await publicClient.getBlockNumber();
        if (Number(currentBlock) <= pendingCommitBlock) return; // not ready yet

        // Check if expired
        if (Number(currentBlock) > pendingCommitBlock + 256) {
          setGameState("expired");
          if (connectedAddress) clearPending(connectedAddress);
          return;
        }

        const block = await publicClient.getBlock({ blockNumber: BigInt(pendingCommitBlock) });
        if (!block.hash) return;

        const randomSeed = keccak256(
          encodePacked(["bytes32", "bytes32"], [pendingSecret as `0x${string}`, block.hash]),
        );
        const isWinner = BigInt(randomSeed) % BigInt(pendingMultiplier) === 0n;

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
  }, [gameState, pendingSecret, pendingCommitBlock, pendingMultiplier, publicClient, connectedAddress]);

  const handleApprove = useCallback(async () => {
    if (!connectedAddress) return;
    setGameState("approving");
    try {
      // Approve 5 bets worth at a time (not infinite!)
      await approveWrite({
        functionName: "approve",
        args: [contractAddress, BET_AMOUNT * 5n],
      });
      // Refetch allowance so UI immediately shows the action button
      await refetchAllowance();
      notification.success("CLAWD approved!");
      setGameState("idle");
    } catch (e) {
      console.error("Approve failed:", e);
      notification.error(parseError(e));
      setGameState("idle");
    }
  }, [connectedAddress, approveWrite, contractAddress, refetchAllowance]);

  const handleClick = useCallback(async () => {
    if (!connectedAddress || !publicClient) return;

    setGameState("clicking");
    try {
      const secret = randomBytes32();
      const salt = randomBytes32();

      // Compute hash locally
      const dataHash = keccak256(encodePacked(["bytes32", "bytes32"], [secret, salt]));

      const txHash = await clickWrite({
        functionName: "click",
        args: [dataHash, BigInt(selectedMultiplier)],
      });

      // Get commit block from tx receipt
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      const commitBlock = Number(receipt.blockNumber);

      // Save to localStorage
      savePending(connectedAddress, secret, salt, commitBlock, selectedMultiplier);
      setPendingSecret(secret);
      setPendingSalt(salt);
      setPendingCommitBlock(commitBlock);
      setPendingMultiplier(selectedMultiplier);
      setGameState("waiting");
      notification.success(`${selectedMultiplier}x bet placed! Rolling the dice...`);
    } catch (e) {
      console.error("Click failed:", e);
      notification.error(parseError(e));
      setGameState("idle");
    }
  }, [connectedAddress, clickWrite, publicClient, selectedMultiplier]);

  const handleClaim = useCallback(async () => {
    if (!connectedAddress || !pendingSecret || !pendingSalt) return;
    setGameState("claiming");
    try {
      await revealWrite({
        functionName: "reveal",
        args: [pendingSecret as `0x${string}`, pendingSalt as `0x${string}`],
      });
      clearPending(connectedAddress);
      setPendingSecret(null);
      setPendingSalt(null);
      setPendingCommitBlock(null);
      setPendingMultiplier(null);
      setGameState("idle");
      notification.success("🎉 CLAWD claimed!");
    } catch (e) {
      console.error("Claim failed:", e);
      notification.error(parseError(e));
      setGameState("won"); // still won, just claim failed
    }
  }, [connectedAddress, pendingSecret, pendingSalt, revealWrite]);

  const handlePlayAgain = useCallback(() => {
    setGameState("idle");
    setPendingSecret(null);
    setPendingSalt(null);
    setPendingCommitBlock(null);
    setPendingMultiplier(null);
    if (connectedAddress) clearPending(connectedAddress);
  }, [connectedAddress]);

  const formatClawd = (amount: bigint | undefined) => {
    if (!amount) return "0";
    return Number(formatEther(amount)).toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const hasEnoughBalance = clawdBalance !== undefined && clawdBalance >= BET_AMOUNT;
  const isMultiplierAffordable = !maxMultiplier || selectedMultiplier <= maxMultiplier;

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4 min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      {/* Stats Bar */}
      <div className="stats stats-vertical sm:stats-horizontal shadow bg-base-100 w-full max-w-2xl">
        <div className="stat">
          <div className="stat-title">House Balance</div>
          <div className="stat-value text-lg">{formatClawd(houseBalance)}</div>
          <div className="stat-desc">CLAWD</div>
        </div>
        <div className="stat">
          <div className="stat-title">Total Bets</div>
          <div className="stat-value text-lg">{totalBets?.toString() || "0"}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Total Wins</div>
          <div className="stat-value text-lg">{totalWins?.toString() || "0"}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Total Paid Out</div>
          <div className="stat-value text-lg">{formatClawd(totalPaidOut)}</div>
          <div className="stat-desc">CLAWD</div>
        </div>
      </div>

      {/* Main Game Card */}
      <div className="card bg-base-100 shadow-xl w-full max-w-lg border-2 border-purple-300">
        <div className="card-body items-center text-center">
          {/* Idle State */}
          {(gameState === "idle" || gameState === "approving" || gameState === "clicking") && (
            <>
              <div className="text-6xl mb-2">🎰</div>
              <h1 className="card-title text-4xl font-black bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                1024x
              </h1>
              <p className="text-sm opacity-70 mb-4">
                Pay <span className="font-bold">10,000 CLAWD</span> • Variable odds from 2x to 1024x
              </p>

              {/* Multiplier Selector */}
              {gameState === "idle" && (
                <div className="w-full max-w-xs mb-4">
                  <label className="label">
                    <span className="label-text font-semibold">Choose Your Multiplier</span>
                  </label>
                  <select 
                    className="select select-bordered w-full font-mono"
                    value={selectedMultiplier}
                    onChange={(e) => setSelectedMultiplier(Number(e.target.value))}
                  >
                    {VALID_MULTIPLIERS.map(mult => {
                      const payout = (10000 * mult * 98) / 100;
                      const winChance = `1 in ${mult}`;
                      const isAffordable = !maxMultiplier || mult <= maxMultiplier;
                      return (
                        <option 
                          key={mult} 
                          value={mult}
                          disabled={!isAffordable}
                        >
                          {mult}x • {winChance} • {payout.toLocaleString()} CLAWD{!isAffordable ? " (House can&apos;t cover)" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <div className="label">
                    <span className="label-text-alt">
                      {selectedPayout && (
                        <>
                          Win: <span className="font-bold text-success">{formatClawd(selectedPayout)} CLAWD</span> • 
                          Chance: <span className="font-bold">1 in {selectedMultiplier}</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              )}

              {connectedAddress && (
                <div className="text-sm opacity-60 mb-2">
                  Your balance: <span className="font-mono font-bold">{formatClawd(clawdBalance)}</span> CLAWD
                </div>
              )}

              {!connectedAddress ? (
                <div className="alert alert-info">
                  <span>Connect your wallet to play</span>
                </div>
              ) : isWrongNetwork ? (
                <button className="btn btn-warning btn-lg w-full" disabled>
                  Switch Network
                </button>
              ) : !hasEnoughBalance ? (
                <div className="alert alert-warning">
                  <span>You need at least 10,000 CLAWD to play</span>
                </div>
              ) : !isMultiplierAffordable ? (
                <div className="alert alert-warning">
                  <span>House can&apos;t cover this multiplier. Choose a lower one.</span>
                </div>
              ) : needsApproval ? (
                <button
                  className="btn btn-primary btn-lg w-full"
                  disabled={gameState === "approving"}
                  onClick={handleApprove}
                >
                  {gameState === "approving" ? (
                    <>
                      <span className="loading loading-spinner"></span>
                      Approving...
                    </>
                  ) : (
                    "Approve CLAWD"
                  )}
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-lg w-full text-xl bg-gradient-to-r from-purple-600 to-pink-600 border-none"
                  disabled={gameState === "clicking"}
                  onClick={handleClick}
                >
                  {gameState === "clicking" ? (
                    <>
                      <span className="loading loading-spinner"></span>
                      Rolling Dice...
                    </>
                  ) : (
                    `🎲 ROLL ${selectedMultiplier}x`
                  )}
                </button>
              )}
            </>
          )}

          {/* Waiting State */}
          {gameState === "waiting" && (
            <>
              <div className="text-6xl mb-4 animate-bounce">🎲</div>
              <h2 className="card-title text-2xl">Rolling the dice...</h2>
              <p className="text-sm opacity-70">
                {pendingMultiplier}x bet • Waiting for block confirmation
              </p>
              <span className="loading loading-dots loading-lg text-primary mt-4"></span>
            </>
          )}

          {/* Won State */}
          {(gameState === "won" || gameState === "claiming") && (
            <>
              <div className="text-6xl mb-4 animate-pulse">🎉</div>
              <h2 className="card-title text-3xl text-success font-black">JACKPOT!</h2>
              <p className="text-lg font-bold">
                {pendingMultiplier}x multiplier hit! Claim{" "}
                <span className="text-success">{formatClawd(selectedPayout)} CLAWD</span>
              </p>
              <p className="text-xs opacity-60 mt-1">
                Reveal your secret on-chain to collect your prize.
                <br />
                You have ~256 blocks (~12 min) to claim.
              </p>
              <button
                className="btn btn-success btn-lg w-full mt-4 text-xl"
                disabled={gameState === "claiming"}
                onClick={handleClaim}
              >
                {gameState === "claiming" ? (
                  <>
                    <span className="loading loading-spinner"></span>
                    Claiming...
                  </>
                ) : (
                  "🏆 CLAIM REWARD"
                )}
              </button>
            </>
          )}

          {/* Lost State */}
          {gameState === "lost" && (
            <>
              <div className="text-6xl mb-4">😤</div>
              <h2 className="card-title text-2xl">Better luck next time!</h2>
              <p className="text-sm opacity-70">
                Your {pendingMultiplier}x bet didn&apos;t hit. Lost 10,000 CLAWD.
              </p>
              <button className="btn btn-primary btn-lg w-full mt-4" onClick={handlePlayAgain}>
                🔄 Try Again
              </button>
            </>
          )}

          {/* Expired State */}
          {gameState === "expired" && (
            <>
              <div className="text-6xl mb-4">⏰</div>
              <h2 className="card-title text-2xl">Bet Expired</h2>
              <p className="text-sm opacity-70">Your bet expired before you could check. Place a new one!</p>
              <button className="btn btn-primary btn-lg w-full mt-4" onClick={handlePlayAgain}>
                🔄 Play Again
              </button>
            </>
          )}
        </div>
      </div>

      {/* How It Works */}
      <div className="card bg-base-100 shadow-xl w-full max-w-lg">
        <div className="card-body">
          <h2 className="card-title text-lg">🎰 How It Works</h2>
          <div className="space-y-2 text-sm">
            <div className="flex gap-3 items-start">
              <span className="badge badge-primary badge-sm mt-1">1</span>
              <p>
                <span className="font-bold">Choose</span> — Pick your multiplier from 2x to 1024x. Higher multipliers = lower chance but bigger payouts!
              </p>
            </div>
            <div className="flex gap-3 items-start">
              <span className="badge badge-primary badge-sm mt-1">2</span>
              <p>
                <span className="font-bold">Roll</span> — Pay 10,000 CLAWD. Your secret is committed on-chain.
              </p>
            </div>
            <div className="flex gap-3 items-start">
              <span className="badge badge-primary badge-sm mt-1">3</span>
              <p>
                <span className="font-bold">Check</span> — After 1 block, we mix your secret with the blockhash. 1-in-N chance for Nx payout!
              </p>
            </div>
            <div className="flex gap-3 items-start">
              <span className="badge badge-primary badge-sm mt-1">4</span>
              <p>
                <span className="font-bold">Claim</span> — If you hit the multiplier, reveal on-chain to collect your winnings!
              </p>
            </div>
          </div>
          <div className="divider my-1"></div>
          <p className="text-xs opacity-50">
            House edge: 2% • Examples: 2x pays 19,600 CLAWD, 1024x pays 10,035,200 CLAWD • Commit-reveal ensures provable fairness.
          </p>
        </div>
      </div>

      {/* Recent Wins */}
      {winEvents && winEvents.length > 0 && (
        <div className="card bg-base-100 shadow-xl w-full max-w-lg">
          <div className="card-body">
            <h2 className="card-title text-lg">🏆 Recent Winners</h2>
            <div className="space-y-2">
              {winEvents.slice(0, 10).map((event, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-success/10 rounded-lg">
                  <Address address={event.args.player} />
                  <div className="text-right">
                    <div className="font-bold text-success">+{formatClawd(event.args.payout)} 🦞</div>
                    <div className="text-xs opacity-60">{event.args.multiplier}x hit!</div>
                  </div>
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