"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Address } from "@scaffold-ui/components";
import confetti from "canvas-confetti";
import type { NextPage } from "next";
import { encodePacked, formatEther, keccak256, parseEther } from "viem";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth/useScaffoldEventHistory";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth/useScaffoldWriteContract";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { notification } from "~~/utils/scaffold-eth";

// 🦞🎲💰 Win confetti!
function fireWinConfetti() {
  const lobsterEmojis = ["🦞", "🎲", "💰", "🎉", "💎", "🔥"];
  // Burst from both sides
  const defaults = { startVelocity: 30, spread: 360, ticks: 80, zIndex: 9999 };

  function fire(particleRatio: number, opts: confetti.Options) {
    confetti({ ...defaults, ...opts, particleCount: Math.floor(200 * particleRatio) });
  }

  fire(0.25, { spread: 26, startVelocity: 55, origin: { x: 0.2, y: 0.6 } });
  fire(0.2, { spread: 60, origin: { x: 0.5, y: 0.5 } });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8, origin: { x: 0.8, y: 0.6 } });
  fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2, origin: { x: 0.5, y: 0.3 } });

  // Emoji confetti — lobsters, dice, money
  const shapeDefaults = { startVelocity: 20, spread: 360, ticks: 90, zIndex: 10000, scalar: 2, gravity: 0.6 };
  lobsterEmojis.forEach((emoji, i) => {
    setTimeout(() => {
      confetti({
        ...shapeDefaults,
        particleCount: 8,
        shapes: ["circle"],
        colors: ["#FF6B35", "#FFD700", "#FF1744", "#00E676"],
        origin: { x: 0.2 + Math.random() * 0.6, y: 0.3 + Math.random() * 0.3 },
      });
    }, i * 150);
  });

  // Second wave
  setTimeout(() => {
    fire(0.3, { spread: 100, startVelocity: 45, origin: { x: 0.3, y: 0.7 } });
    fire(0.3, { spread: 100, startVelocity: 45, origin: { x: 0.7, y: 0.7 } });
  }, 400);
}

// Rolling animation component
function RollingAnimation({ multiplier }: { multiplier: number }) {
  const [digits, setDigits] = useState<string[]>(["0", "0", "0", "0", "0", "0"]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setDigits(prev =>
        prev.map(() => {
          const chars = "0123456789ABCDEF";
          return chars[Math.floor(Math.random() * chars.length)];
        }),
      );
    }, 50);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div className="font-mono text-3xl tracking-widest text-primary font-bold">
        {digits.map((d, i) => (
          <span key={i} className="inline-block w-8 text-center animate-pulse">
            {d}
          </span>
        ))}
      </div>
      <div className="text-lg font-bold animate-bounce">Rolling for {multiplier}x...</div>
    </div>
  );
}

const BET_TIERS = [
  { value: parseEther("10000"), label: "10K", display: "10,000" },
  { value: parseEther("50000"), label: "50K", display: "50,000" },
  { value: parseEther("100000"), label: "100K", display: "100,000" },
  { value: parseEther("500000"), label: "500K", display: "500,000" },
];

const MULTIPLIERS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

const STORAGE_KEY = "1024x-bets";

interface PendingBet {
  betIndex: number;
  secret: string;
  salt: string;
  commitBlock: number;
  betAmount: string;
  multiplier: number;
  status: "waiting" | "won" | "lost" | "expired" | "claimed";
}

function loadBets(address: string): PendingBet[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${address}`);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveBets(address: string, bets: PendingBet[]) {
  try {
    localStorage.setItem(`${STORAGE_KEY}-${address}`, JSON.stringify(bets));
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
  if (msg.includes("House underfunded")) return "House can't cover this bet. Try lower odds or smaller bet.";
  if (msg.includes("Game paused")) return "Game is paused — withdrawal in progress.";
  if (msg.includes("Bet expired")) return "Bet expired (>256 blocks)";
  if (msg.includes("Not a winner")) return "Not a winning reveal";
  if (msg.includes("insufficient allowance") || msg.includes("ERC20InsufficientAllowance"))
    return "Need to approve CLAWD first";
  return "Transaction failed";
}

const Home: NextPage = () => {
  const { address: connectedAddress, chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const isWrongNetwork = chain?.id !== targetNetwork.id;

  const [selectedBet, setSelectedBet] = useState(BET_TIERS[0]);
  const [selectedMultiplier, setSelectedMultiplier] = useState(2);
  const [pendingBets, setPendingBets] = useState<PendingBet[]>([]);
  const [isApproving, setIsApproving] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const [awaitingWallet, setAwaitingWallet] = useState(false);

  // Try to open mobile wallet app
  const openWallet = useCallback(() => {
    // Only on mobile — detect via user agent
    if (typeof window === "undefined") return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) return;
    // Don't open if already inside wallet browser
    if (
      window.ethereum &&
      (window.ethereum as unknown as Record<string, boolean>).isMetaMask &&
      window.innerWidth < 500
    )
      return;
    // Try MetaMask deep link
    const currentUrl = window.location.href;
    window.location.href = `metamask://dapp/${currentUrl.replace(/^https?:\/\//, "")}`;
  }, []);
  const [isClaiming, setIsClaiming] = useState<number | null>(null);
  const [currentBlock, setCurrentBlock] = useState<number>(0);
  const [clawdPriceUsd, setClawdPriceUsd] = useState<number>(0);

  // Fetch CLAWD price from DexScreener
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch(
          "https://api.dexscreener.com/latest/dex/tokens/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07",
        );
        const data = await res.json();
        const pair = data?.pairs?.[0];
        if (pair?.priceUsd) setClawdPriceUsd(parseFloat(pair.priceUsd));
      } catch {}
    };
    fetchPrice();
    const interval = setInterval(fetchPrice, 60000);
    return () => clearInterval(interval);
  }, []);

  const { writeContractAsync: approveWrite } = useScaffoldWriteContract("CLAWD");
  const { writeContractAsync: gameWrite } = useScaffoldWriteContract("TenTwentyFourX");

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
  const { data: totalPaidOut } = useScaffoldReadContract({
    contractName: "TenTwentyFourX",
    functionName: "totalPaidOut",
  });
  const { data: totalBurned } = useScaffoldReadContract({
    contractName: "TenTwentyFourX",
    functionName: "totalBurned",
  });
  const { data: isPaused } = useScaffoldReadContract({ contractName: "TenTwentyFourX", functionName: "paused" });

  const { data: winEvents } = useScaffoldEventHistory({
    contractName: "TenTwentyFourX",
    eventName: "BetWon",
    fromBlock: BigInt(Math.max(0, currentBlock - 50000)),
    watch: true,
  });

  const currentPayout = (selectedBet.value * BigInt(selectedMultiplier) * 98n) / 100n;
  const currentBurn = selectedBet.value / 100n;

  const canAfford = (betValue: bigint, mult: number): boolean => {
    if (!houseBalance) return false;
    const payout = (betValue * BigInt(mult) * 98n) / 100n;
    const netBet = betValue - betValue / 100n;
    return houseBalance + netBet >= payout;
  };

  // Poll current block
  useEffect(() => {
    if (!publicClient) return;
    const poll = async () => {
      try {
        const bn = await publicClient.getBlockNumber();
        setCurrentBlock(Number(bn));
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [publicClient]);

  // Load bets from localStorage
  useEffect(() => {
    if (!connectedAddress) return;
    setPendingBets(loadBets(connectedAddress));
  }, [connectedAddress]);

  // Check bet results when block advances
  useEffect(() => {
    if (!publicClient || !connectedAddress || currentBlock === 0) return;

    const checkBets = async () => {
      const bets = loadBets(connectedAddress);
      let changed = false;

      for (const bet of bets) {
        if (bet.status !== "waiting") continue;

        if (currentBlock <= bet.commitBlock) continue;

        if (currentBlock > bet.commitBlock + 256) {
          bet.status = "expired";
          changed = true;
          continue;
        }

        try {
          const block = await publicClient.getBlock({ blockNumber: BigInt(bet.commitBlock) });
          if (!block.hash) continue;

          const randomSeed = keccak256(encodePacked(["bytes32", "bytes32"], [bet.secret as `0x${string}`, block.hash]));
          const isWinner = BigInt(randomSeed) % BigInt(bet.multiplier) === 0n;

          bet.status = isWinner ? "won" : "lost";
          if (isWinner) fireWinConfetti();
          changed = true;
        } catch {}
      }

      if (changed) {
        saveBets(connectedAddress, bets);
        setPendingBets([...bets]);
      }
    };

    checkBets();
  }, [currentBlock, publicClient, connectedAddress]);

  // Clean up expired bets from local storage (no contract call needed)
  useEffect(() => {
    if (!connectedAddress) return;
    const bets = loadBets(connectedAddress);
    const expired = bets.filter(b => b.status === "expired");
    if (expired.length === 0) return;
    for (const bet of expired) {
      const idx = bets.findIndex(b => b.betIndex === bet.betIndex && b.commitBlock === bet.commitBlock);
      if (idx >= 0) bets[idx].status = "lost";
    }
    saveBets(connectedAddress, bets);
    setPendingBets([...bets]);
  }, [connectedAddress, pendingBets]);

  // Reset isApproving when allowance actually updates
  useEffect(() => {
    if (isApproving && !needsApproval) {
      setIsApproving(false);
    }
  }, [isApproving, needsApproval]);

  const handleApprove = useCallback(async () => {
    if (!connectedAddress) return;
    setIsApproving(true);
    setAwaitingWallet(true);
    openWallet();
    try {
      await approveWrite({ functionName: "approve", args: [contractAddress, selectedBet.value * 10n] });
      setAwaitingWallet(false);
      await refetchAllowance();
      notification.success("CLAWD approved!");
      // Don't set isApproving=false here — wait for needsApproval to flip via the useEffect above
    } catch (e) {
      notification.error(parseError(e));
      setIsApproving(false);
    }
    setAwaitingWallet(false);
  }, [connectedAddress, approveWrite, contractAddress, refetchAllowance, selectedBet]);

  const handleClick = useCallback(async () => {
    if (!connectedAddress || !publicClient) return;
    setIsClicking(true);
    setAwaitingWallet(true);
    openWallet();
    try {
      const secret = randomBytes32();
      const salt = randomBytes32();
      const dataHash = keccak256(encodePacked(["bytes32", "bytes32"], [secret, salt]));

      const txHash = await gameWrite({
        functionName: "click",
        args: [dataHash, selectedBet.value, BigInt(selectedMultiplier)],
      });

      setAwaitingWallet(false);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      const commitBlock = Number(receipt.blockNumber);

      // Get bet index from player's bet count (it's length - 1 after the tx)
      // We read logs to find the betIndex from the BetPlaced event
      const betPlacedTopic = keccak256(
        encodePacked(["string"], ["BetPlaced(address,uint256,bytes32,uint256,uint256,uint256,uint256,uint256)"]),
      );
      const log = receipt.logs.find(l => l.topics[0] === betPlacedTopic);
      // betIndex is the second indexed param (topics[2])
      const betIndex = log ? Number(BigInt(log.topics[2] || "0")) : 0;

      const newBet: PendingBet = {
        betIndex,
        secret,
        salt,
        commitBlock,
        betAmount: selectedBet.value.toString(),
        multiplier: selectedMultiplier,
        status: "waiting",
      };

      const bets = loadBets(connectedAddress);
      bets.push(newBet);
      saveBets(connectedAddress, bets);
      setPendingBets([...bets]);

      notification.success(`Bet placed! ${selectedBet.label} @ ${selectedMultiplier}x 🎲`);
    } catch (e) {
      notification.error(parseError(e));
    }
    setIsClicking(false);
    setAwaitingWallet(false);
  }, [connectedAddress, gameWrite, publicClient, selectedBet, selectedMultiplier]);

  const handleClaim = useCallback(
    async (bet: PendingBet) => {
      if (!connectedAddress) return;
      setIsClaiming(bet.betIndex);
      try {
        await gameWrite({
          functionName: "reveal",
          args: [BigInt(bet.betIndex), bet.secret as `0x${string}`, bet.salt as `0x${string}`],
        });

        const payout = (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n;

        const bets = loadBets(connectedAddress);
        const idx = bets.findIndex(b => b.betIndex === bet.betIndex && b.commitBlock === bet.commitBlock);
        if (idx >= 0) bets[idx].status = "claimed";
        saveBets(connectedAddress, bets);
        setPendingBets([...bets]);

        notification.success(`🎉 Claimed ${formatClawd(payout)} CLAWD!`);
      } catch (e) {
        notification.error(parseError(e));
      }
      setIsClaiming(null);
    },
    [connectedAddress, gameWrite],
  );

  const clearFinished = useCallback(() => {
    if (!connectedAddress) return;
    const bets = loadBets(connectedAddress).filter(b => b.status === "waiting" || b.status === "won");
    saveBets(connectedAddress, bets);
    setPendingBets([...bets]);
  }, [connectedAddress]);

  const formatClawd = (amount: bigint | undefined) => {
    if (!amount) return "0";
    return Number(formatEther(amount)).toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const formatUsd = (amount: bigint | undefined) => {
    if (!amount || !clawdPriceUsd) return "";
    const usd = Number(formatEther(amount)) * clawdPriceUsd;
    if (usd < 0.01) return "<$0.01";
    if (usd < 1) return `$${usd.toFixed(2)}`;
    return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  const hasEnoughBalance = clawdBalance !== undefined && clawdBalance >= selectedBet.value;
  const houseCanPay = canAfford(selectedBet.value, selectedMultiplier);

  // Active bets (won, waiting)
  const activeBets = pendingBets.filter(b => b.status === "won" || b.status === "waiting");
  const claimableBets = pendingBets.filter(b => b.status === "won");
  const recentFinished = pendingBets
    .filter(b => b.status === "lost" || b.status === "expired" || b.status === "claimed")
    .slice(-10);

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4 min-h-screen">
      {/* Stats Bar */}
      <div className="stats stats-vertical sm:stats-horizontal shadow bg-base-100 w-full max-w-2xl text-center">
        <div className="stat">
          <div className="stat-title">House</div>
          <div className="stat-value text-lg">{formatClawd(houseBalance)}</div>
          <div className="stat-desc">{formatUsd(houseBalance) || "CLAWD"}</div>
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
          <div className="stat-title">Paid</div>
          <div className="stat-value text-lg">{formatClawd(totalPaidOut)}</div>
          <div className="stat-desc">{formatUsd(totalPaidOut)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">🔥 Burned</div>
          <div className="stat-value text-lg">{formatClawd(totalBurned)}</div>
          <div className="stat-desc">{formatUsd(totalBurned)}</div>
        </div>
      </div>

      {isPaused && (
        <div className="alert alert-warning w-full max-w-md">
          <span>⚠️ Game is paused — withdrawal in progress. Existing bets can still be claimed.</span>
        </div>
      )}

      {/* Main Game Card — Betting */}
      <div className="card bg-base-100 shadow-xl w-full max-w-md">
        <div className="card-body items-center text-center">
          <h2 className="card-title text-3xl font-black">1024x</h2>
          <p className="text-sm opacity-70 mb-2">Pick your bet, pick your odds, roll as many times as you want</p>

          {/* Bet Size */}
          <div className="w-full">
            <label className="label">
              <span className="label-text font-bold">Bet Size</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {BET_TIERS.map(tier => (
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

          {/* Multiplier */}
          <div className="w-full mt-2">
            <label className="label">
              <span className="label-text font-bold">Multiplier</span>
            </label>
            <div className="grid grid-cols-5 gap-2">
              {MULTIPLIERS.map(mult => {
                const affordable = canAfford(selectedBet.value, mult);
                return (
                  <button
                    key={mult}
                    className={`btn btn-sm ${selectedMultiplier === mult ? "btn-secondary" : affordable ? "btn-outline" : "btn-disabled opacity-30"}`}
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
              <span className="font-bold text-success">
                {formatClawd(currentPayout)} CLAWD{" "}
                <span className="font-normal opacity-60">{formatUsd(currentPayout)}</span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="opacity-70">🔥 Burn</span>
              <span className="font-bold text-warning">
                {formatClawd(currentBurn)} CLAWD{" "}
                <span className="font-normal opacity-60">{formatUsd(currentBurn)}</span>
              </span>
            </div>
          </div>

          {connectedAddress && (
            <div className="text-sm opacity-60 mt-1">
              Balance: <span className="font-mono font-bold">{formatClawd(clawdBalance)}</span> CLAWD{" "}
              {formatUsd(clawdBalance) && <span className="opacity-70">({formatUsd(clawdBalance)})</span>}
            </div>
          )}

          {/* Action Button */}
          <div className="w-full mt-3">
            {!connectedAddress ? (
              <div className="alert alert-info">
                <span>Connect your wallet to play</span>
              </div>
            ) : isWrongNetwork ? (
              <button
                className="btn btn-warning btn-lg w-full"
                onClick={() => switchChain({ chainId: targetNetwork.id })}
              >
                Switch Network
              </button>
            ) : isPaused ? (
              <button className="btn btn-disabled btn-lg w-full">Game Paused</button>
            ) : !hasEnoughBalance ? (
              <div className="alert alert-warning">
                <span>Need at least {selectedBet.display} CLAWD</span>
              </div>
            ) : !houseCanPay ? (
              <div className="alert alert-warning">
                <span>House can&apos;t cover this bet</span>
              </div>
            ) : needsApproval ? (
              <button className="btn btn-primary btn-lg w-full" disabled={isApproving} onClick={handleApprove}>
                {isApproving ? (
                  <>
                    <span className="loading loading-spinner"></span>Approving...
                  </>
                ) : (
                  `Approve CLAWD`
                )}
              </button>
            ) : (
              <button className="btn btn-primary btn-lg w-full text-xl" disabled={isClicking} onClick={handleClick}>
                {isClicking ? (
                  <>
                    <span className="loading loading-spinner"></span>Rolling...
                  </>
                ) : (
                  `ROLL ${selectedBet.label} @ ${selectedMultiplier}x`
                )}
              </button>
            )}
            {awaitingWallet && (
              <div className="text-sm text-center mt-2 opacity-70 animate-pulse">
                👆 Open your wallet to confirm the transaction
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rolling Animation — shown when any bet is waiting */}
      {activeBets.some(b => b.status === "waiting") && (
        <div
          ref={el => {
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          className="card bg-base-100 shadow-xl w-full max-w-md"
        >
          <div className="card-body items-center">
            <RollingAnimation multiplier={activeBets.find(b => b.status === "waiting")?.multiplier || 2} />
          </div>
        </div>
      )}

      {/* Active Bets */}
      {activeBets.length > 0 && (
        <div className="card bg-base-100 shadow-xl w-full max-w-md">
          <div className="card-body">
            <h2 className="card-title text-lg">
              🎲 Your Active Bets
              {claimableBets.length > 0 && <span className="badge badge-success">{claimableBets.length} won!</span>}
            </h2>
            <div className="space-y-3">
              {activeBets.map(bet => {
                const blocksLeft = Math.max(0, bet.commitBlock + 256 - currentBlock);
                const payout = (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n;
                const betLabel = BET_TIERS.find(t => t.value.toString() === bet.betAmount)?.label || "?";

                return (
                  <div
                    key={`${bet.betIndex}-${bet.commitBlock}`}
                    className={`p-3 rounded-lg ${bet.status === "won" ? "bg-success/15 border border-success/30" : "bg-base-200"}`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-bold">
                          {betLabel} @ {bet.multiplier}x
                        </span>
                        {bet.status === "won" && (
                          <span className="text-success font-bold ml-2">
                            → {formatClawd(payout)} CLAWD{" "}
                            <span className="font-normal opacity-60">{formatUsd(payout)}</span>
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        {bet.status === "waiting" && <span className="text-xs opacity-60">waiting for block...</span>}
                        {bet.status === "won" && (
                          <div>
                            <div className="text-xs opacity-60 mb-1">⏱️ {blocksLeft} blocks left</div>
                            <button
                              className="btn btn-success btn-sm"
                              disabled={isClaiming === bet.betIndex}
                              onClick={() => handleClaim(bet)}
                            >
                              {isClaiming === bet.betIndex ? (
                                <span className="loading loading-spinner loading-xs"></span>
                              ) : (
                                "🏆 Claim"
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {bet.status === "won" && blocksLeft < 50 && (
                      <div className="text-xs text-warning mt-1">⚠️ Claim soon! Only {blocksLeft} blocks remaining</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Recent Results */}
      {recentFinished.length > 0 && (
        <div className="card bg-base-100 shadow-xl w-full max-w-md">
          <div className="card-body">
            <div className="flex justify-between items-center">
              <h2 className="card-title text-lg">📜 Recent Results</h2>
              <button className="btn btn-ghost btn-xs" onClick={clearFinished}>
                Clear
              </button>
            </div>
            <div className="space-y-1">
              {recentFinished.reverse().map((bet, i) => {
                const betLabel = BET_TIERS.find(t => t.value.toString() === bet.betAmount)?.label || "?";
                return (
                  <div key={i} className="flex justify-between text-sm p-1">
                    <span>
                      {betLabel} @ {bet.multiplier}x
                    </span>
                    <span
                      className={
                        bet.status === "claimed"
                          ? "text-success"
                          : bet.status === "expired"
                            ? "text-warning"
                            : "opacity-50"
                      }
                    >
                      {bet.status === "claimed" ? "✅ Claimed" : bet.status === "expired" ? "⏰ Expired" : "❌ Lost"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Recent Winners (global) */}
      {winEvents && winEvents.length > 0 && (
        <div className="card bg-base-100 shadow-xl w-full max-w-md">
          <div className="card-body">
            <h2 className="card-title text-lg">🏆 Recent Winners</h2>
            <div className="space-y-2">
              {winEvents.slice(0, 10).map((event, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-success/10 rounded-lg">
                  <Address address={event.args.player} />
                  <span className="font-bold text-success">
                    {event.args.multiplier?.toString()}x → +{formatClawd(event.args.payout)} 🦞{" "}
                    <span className="font-normal opacity-60">{formatUsd(event.args.payout)}</span>
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
