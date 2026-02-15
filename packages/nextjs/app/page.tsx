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
const WIN_AMOUNT = parseEther("90000");

// localStorage helpers
const STORAGE_KEY = "lucky-click-pending";

function savePending(address: string, secret: string, salt: string, commitBlock: number) {
  try {
    localStorage.setItem(`${STORAGE_KEY}-${address}`, JSON.stringify({ secret, salt, commitBlock }));
  } catch {}
}

function loadPending(address: string): { secret: string; salt: string; commitBlock: number } | null {
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
  if (msg.includes("House underfunded")) return "House doesn't have enough CLAWD to pay out. Try again later.";
  if (msg.includes("Active bet exists") || msg.includes("Wait one block before re-betting"))
    return "You have a pending bet. Please wait a moment and try again.";
  if (msg.includes("Bet expired")) return "Your bet expired. Place a new one!";
  if (msg.includes("Not a winner")) return "Not a winning reveal";
  if (msg.includes("insufficient allowance") || msg.includes("ERC20InsufficientAllowance"))
    return "Need to approve CLAWD first";
  return "Transaction failed";
}

type GameState =
  | "idle"
  | "approving"
  | "clicking"
  | "waiting"
  | "won"
  | "lost"
  | "claiming"
  | "expired"
  | "orphaned"
  | "forfeiting";

const Home: NextPage = () => {
  const { address: connectedAddress, chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const isWrongNetwork = chain?.id !== targetNetwork.id;

  const [gameState, setGameState] = useState<GameState>("idle");
  const [pendingSecret, setPendingSecret] = useState<string | null>(null);
  const [pendingSalt, setPendingSalt] = useState<string | null>(null);
  const [pendingCommitBlock, setPendingCommitBlock] = useState<number | null>(null);

  // Contract write hooks
  const { writeContractAsync: approveWrite } = useScaffoldWriteContract("CLAWD");
  const { writeContractAsync: clickWrite } = useScaffoldWriteContract("LuckyClick");
  const { writeContractAsync: revealWrite } = useScaffoldWriteContract("LuckyClick");
  const { writeContractAsync: forfeitWrite } = useScaffoldWriteContract("LuckyClick");

  // Read user's CLAWD balance
  const { data: clawdBalance } = useScaffoldReadContract({
    contractName: "CLAWD",
    functionName: "balanceOf",
    args: [connectedAddress],
  });

  // Get the LuckyClick contract address
  const { data: luckyClickContractData } = useDeployedContractInfo("LuckyClick");
  const luckyClickAddress = luckyClickContractData?.address;

  // Read allowance
  const { data: allowance } = useScaffoldReadContract({
    contractName: "CLAWD",
    functionName: "allowance",
    args: [connectedAddress, luckyClickAddress],
    query: { enabled: !!connectedAddress && !!luckyClickAddress },
  });

  const needsApproval = !allowance || allowance < BET_AMOUNT;

  // House balance
  const { data: houseBalance } = useScaffoldReadContract({
    contractName: "LuckyClick",
    functionName: "houseBalance",
  });

  // Stats
  const { data: totalBets } = useScaffoldReadContract({
    contractName: "LuckyClick",
    functionName: "totalBets",
  });
  const { data: totalWins } = useScaffoldReadContract({
    contractName: "LuckyClick",
    functionName: "totalWins",
  });
  const { data: totalPaidOut } = useScaffoldReadContract({
    contractName: "LuckyClick",
    functionName: "totalPaidOut",
  });

  // Recent wins
  const { data: winEvents } = useScaffoldEventHistory({
    contractName: "LuckyClick",
    eventName: "Won",
    fromBlock: 0n,
    watch: true,
  });

  // Read on-chain bet state
  const { data: onChainBet, refetch: refetchBet } = useScaffoldReadContract({
    contractName: "LuckyClick",
    functionName: "getBet",
    args: [connectedAddress],
    query: { enabled: !!connectedAddress },
  });

  // Restore pending bet from localStorage on mount/connect, AND check on-chain state
  useEffect(() => {
    if (!connectedAddress || !onChainBet) return;
    const [, onChainCommitBlock, onChainClaimed, blocksLeft] = onChainBet;
    const hasOnChainBet = Number(onChainCommitBlock) > 0 && !onChainClaimed;

    const pending = loadPending(connectedAddress);
    if (pending) {
      // We have localStorage data — use it
      setPendingSecret(pending.secret);
      setPendingSalt(pending.salt);
      setPendingCommitBlock(pending.commitBlock);
      setGameState("waiting");
    } else if (hasOnChainBet) {
      // On-chain bet exists but no localStorage — orphaned bet!
      // Player lost their secret (different device, cleared storage, etc.)
      // They can't reveal even if they won, so show forfeit option
      setPendingCommitBlock(Number(onChainCommitBlock));
      if (Number(blocksLeft) === 0) {
        // Expired — can just click again (contract allows it)
        setGameState("idle");
      } else {
        setGameState("orphaned" as GameState);
      }
    }
  }, [connectedAddress, onChainBet]);

  // Check win/loss when we have a pending bet and block has advanced
  useEffect(() => {
    if (gameState !== "waiting" || !pendingSecret || !pendingCommitBlock || !publicClient) return;

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
        const isWinner = BigInt(randomSeed) % 10n === 0n;

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
  }, [gameState, pendingSecret, pendingCommitBlock, publicClient, connectedAddress]);

  const handleApprove = useCallback(async () => {
    if (!connectedAddress) return;
    setGameState("approving");
    try {
      // Approve 5 bets worth at a time (not infinite!)
      await approveWrite({
        functionName: "approve",
        args: [luckyClickAddress, BET_AMOUNT * 5n],
      });
      notification.success("CLAWD approved!");
      setGameState("idle");
    } catch (e) {
      console.error("Approve failed:", e);
      notification.error(parseError(e));
      setGameState("idle");
    }
  }, [connectedAddress, approveWrite, luckyClickAddress]);

  const handleClick = useCallback(async () => {
    if (!connectedAddress || !publicClient) return;

    // Pre-flight: check if there's an active on-chain bet we need to forfeit first
    if (onChainBet) {
      const [, onChainCommitBlock, onChainClaimed] = onChainBet;
      if (Number(onChainCommitBlock) > 0 && !onChainClaimed) {
        // There's an active bet — show the orphaned state instead of hitting the contract
        setPendingCommitBlock(Number(onChainCommitBlock));
        setGameState("orphaned" as GameState);
        notification.error("You have a pending bet. Forfeit it first to play again.");
        return;
      }
    }

    setGameState("clicking");
    try {
      const secret = randomBytes32();
      const salt = randomBytes32();

      // Compute hash locally
      const dataHash = keccak256(encodePacked(["bytes32", "bytes32"], [secret, salt]));

      const txHash = await clickWrite({
        functionName: "click",
        args: [dataHash],
      });

      // Get commit block from tx receipt — saves IMMEDIATELY, no extra RPC call
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      const commitBlock = Number(receipt.blockNumber);

      // Save to localStorage FIRST before any state that could trigger re-renders
      savePending(connectedAddress, secret, salt, commitBlock);
      setPendingSecret(secret);
      setPendingSalt(salt);
      setPendingCommitBlock(commitBlock);
      setGameState("waiting");
      notification.success("Bet placed! Checking your luck...");
    } catch (e) {
      console.error("Click failed:", e);
      notification.error(parseError(e));
      setGameState("idle");
    }
  }, [connectedAddress, clickWrite, publicClient, onChainBet]);

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
      setGameState("idle");
      notification.success("🎉 90,000 CLAWD claimed!");
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
    if (connectedAddress) clearPending(connectedAddress);
  }, [connectedAddress]);

  const handleForfeit = useCallback(async () => {
    if (!connectedAddress) return;
    setGameState("forfeiting");
    try {
      await forfeitWrite({ functionName: "forfeit" });
      clearPending(connectedAddress);
      setPendingSecret(null);
      setPendingSalt(null);
      setPendingCommitBlock(null);
      await refetchBet();
      setGameState("idle");
      notification.success("Bet forfeited. You can play again!");
    } catch (e) {
      console.error("Forfeit failed:", e);
      notification.error(parseError(e));
      setGameState("orphaned");
    }
  }, [connectedAddress, forfeitWrite, refetchBet]);

  const formatClawd = (amount: bigint | undefined) => {
    if (!amount) return "0";
    return Number(formatEther(amount)).toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const hasEnoughBalance = clawdBalance !== undefined && clawdBalance >= BET_AMOUNT;
  const houseCanPay = houseBalance !== undefined && houseBalance >= WIN_AMOUNT;

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4 min-h-screen">
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
      <div className="card bg-base-100 shadow-xl w-full max-w-md">
        <div className="card-body items-center text-center">
          {/* Idle State */}
          {(gameState === "idle" || gameState === "approving" || gameState === "clicking") && (
            <>
              <div className="text-6xl mb-2">🦞</div>
              <h2 className="card-title text-3xl font-black">LUCKY CLICK</h2>
              <p className="text-sm opacity-70 mb-4">
                Pay <span className="font-bold">10,000 CLAWD</span> • 1 in 10 chance to win{" "}
                <span className="font-bold text-success">90,000 CLAWD</span>
              </p>

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
              ) : !houseCanPay ? (
                <div className="alert alert-warning">
                  <span>House is low on funds. Try again later.</span>
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
                  className="btn btn-primary btn-lg w-full text-xl"
                  disabled={gameState === "clicking"}
                  onClick={handleClick}
                >
                  {gameState === "clicking" ? (
                    <>
                      <span className="loading loading-spinner"></span>
                      Placing Bet...
                    </>
                  ) : (
                    "🎰 CLICK FOR 10K"
                  )}
                </button>
              )}
            </>
          )}

          {/* Waiting State */}
          {gameState === "waiting" && (
            <>
              <div className="text-6xl mb-4 animate-bounce">🎲</div>
              <h2 className="card-title text-2xl">Checking your luck...</h2>
              <p className="text-sm opacity-70">Waiting for the next block to determine your fate</p>
              <span className="loading loading-dots loading-lg text-primary mt-4"></span>
            </>
          )}

          {/* Won State */}
          {(gameState === "won" || gameState === "claiming") && (
            <>
              <div className="text-6xl mb-4 animate-pulse">🎉</div>
              <h2 className="card-title text-3xl text-success font-black">YOU WON!</h2>
              <p className="text-lg font-bold">
                Claim <span className="text-success">90,000 CLAWD</span>
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
                  "🏆 CLAIM 90,000 CLAWD"
                )}
              </button>
            </>
          )}

          {/* Lost State */}
          {gameState === "lost" && (
            <>
              <div className="text-6xl mb-4">😤</div>
              <h2 className="card-title text-2xl">Not this time!</h2>
              <p className="text-sm opacity-70">You lost 10,000 CLAWD. The house wins this round.</p>
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

          {/* Orphaned Bet State — on-chain bet exists but localStorage lost */}
          {(gameState === "orphaned" || gameState === "forfeiting") && (
            <>
              <div className="text-6xl mb-4">🔒</div>
              <h2 className="card-title text-2xl">Active Bet Found</h2>
              <p className="text-sm opacity-70">
                You have a pending bet on-chain, but your session data was lost (different device or cleared browser
                data). You{"'"}ll need to forfeit this bet to play again.
              </p>
              <p className="text-xs opacity-50 mt-1">
                Your 10K CLAWD bet stays in the house. This is a one-time clear.
              </p>
              <button
                className="btn btn-warning btn-lg w-full mt-4"
                disabled={gameState === "forfeiting"}
                onClick={handleForfeit}
              >
                {gameState === "forfeiting" ? (
                  <>
                    <span className="loading loading-spinner"></span>
                    Forfeiting...
                  </>
                ) : (
                  "🗑️ Forfeit & Play Again"
                )}
              </button>
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
              <p>
                <span className="font-bold">Click</span> — Pay 10,000 CLAWD. Your secret is committed on-chain.
              </p>
            </div>
            <div className="flex gap-3 items-start">
              <span className="badge badge-primary badge-sm mt-1">2</span>
              <p>
                <span className="font-bold">Check</span> — After 1 block, we mix your secret with the blockhash. 1 in 10
                chance to win!
              </p>
            </div>
            <div className="flex gap-3 items-start">
              <span className="badge badge-primary badge-sm mt-1">3</span>
              <p>
                <span className="font-bold">Claim</span> — If you won, reveal on-chain to collect 90,000 CLAWD. If you
                lost, no action needed.
              </p>
            </div>
          </div>
          <div className="divider my-1"></div>
          <p className="text-xs opacity-50">
            House edge: 10% • Commit-reveal ensures fairness — neither you nor the blockchain can predict the result at
            commit time.
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
                  <span className="font-bold text-success">+90,000 🦞</span>
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
