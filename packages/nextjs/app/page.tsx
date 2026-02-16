"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { encodePacked, formatEther, keccak256, parseEther } from "viem";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth/useScaffoldEventHistory";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth/useScaffoldWriteContract";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { notification } from "~~/utils/scaffold-eth";

// Heartbeat monitor animation
function HeartbeatMonitor({ multiplier }: { multiplier: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    const draw = () => {
      ctx.fillStyle = "rgba(26, 10, 30, 0.15)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "#f43f5e";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "#f43f5e";
      ctx.shadowBlur = 8;
      ctx.beginPath();

      const w = canvas.width;
      const h = canvas.height;
      const mid = h / 2;

      for (let x = 0; x < w; x++) {
        const t = (x + frame * 3) / w;
        const cycle = t % 1;
        let y = mid;

        if (cycle > 0.3 && cycle < 0.35) {
          y = mid - 30 * Math.sin((cycle - 0.3) * Math.PI / 0.05);
        } else if (cycle > 0.35 && cycle < 0.4) {
          y = mid + 45 * Math.sin((cycle - 0.35) * Math.PI / 0.05);
        } else if (cycle > 0.4 && cycle < 0.45) {
          y = mid - 15 * Math.sin((cycle - 0.4) * Math.PI / 0.05);
        } else {
          y = mid + Math.sin(x * 0.02 + frame * 0.05) * 2;
        }

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      frame++;
      setPhase(frame);
      requestAnimationFrame(draw);
    };

    const animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <canvas ref={canvasRef} width={360} height={80} className="rounded-xl w-full max-w-[360px] bg-base-300/50" />
      <div className="flex items-center gap-2">
        <span className="text-2xl" style={{ animation: "heartbeat 1.2s ease-in-out infinite" }}>💗</span>
        <span className="text-lg font-bold text-primary animate-pulse">
          Feeling lucky at {multiplier}x...
        </span>
        <span className="text-2xl" style={{ animation: "heartbeat 1.2s ease-in-out infinite" }}>💗</span>
      </div>
    </div>
  );
}

// Floating hearts background
function FloatingHearts() {
  const hearts = ["💗", "💖", "💝", "❤️", "🦞", "💕", "✨"];
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {Array.from({ length: 15 }).map((_, i) => (
        <div
          key={i}
          className="absolute opacity-10 text-2xl"
          style={{
            left: `${(i * 7.3) % 100}%`,
            top: `${(i * 13.7) % 100}%`,
            animation: `heartbeat ${2 + (i % 3)}s ease-in-out infinite`,
            animationDelay: `${i * 0.3}s`,
          }}
        >
          {hearts[i % hearts.length]}
        </div>
      ))}
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

const LOVE_PHRASES = [
  "love is in the air 💕",
  "heart goes brrr 💗",
  "feeling the pulse ❤️‍🔥",
  "lobster love! 🦞",
  "beating strong 💖",
  "cupid's arrow 🏹",
];

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
  return ("0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

function parseError(e: unknown): string {
  const msg = (e as Error)?.message || String(e);
  if (msg.includes("user rejected") || msg.includes("User denied")) return "Transaction cancelled 💔";
  if (msg.includes("House underfunded")) return "House heart can't cover this. Try gentler odds 💗";
  if (msg.includes("Game paused")) return "Heart is resting... game paused 😴";
  if (msg.includes("Bet expired")) return "Love expired (>256 blocks) 💔";
  if (msg.includes("Not a winner")) return "Not a winning heartbeat";
  if (msg.includes("insufficient allowance") || msg.includes("ERC20InsufficientAllowance")) return "Need to approve CLAWD first 💝";
  return "Transaction failed 💔";
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
  const [lovePhrase, setLovePhrase] = useState(LOVE_PHRASES[0]);

  const openWallet = useCallback(() => {
    if (typeof window === "undefined") return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) return;
    if (window.ethereum && (window.ethereum as unknown as Record<string, boolean>).isMetaMask && window.innerWidth < 500) return;
    const currentUrl = window.location.href;
    window.location.href = `metamask://dapp/${currentUrl.replace(/^https?:\/\//, "")}`;
  }, []);

  const [isClaiming, setIsClaiming] = useState<number | null>(null);
  const [currentBlock, setCurrentBlock] = useState<number>(0);

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

  const { data: houseBalance } = useScaffoldReadContract({ contractName: "TenTwentyFourX", functionName: "houseBalance" });
  const { data: totalBets } = useScaffoldReadContract({ contractName: "TenTwentyFourX", functionName: "totalBets" });
  const { data: totalWins } = useScaffoldReadContract({ contractName: "TenTwentyFourX", functionName: "totalWins" });
  const { data: totalPaidOut } = useScaffoldReadContract({ contractName: "TenTwentyFourX", functionName: "totalPaidOut" });
  const { data: totalBurned } = useScaffoldReadContract({ contractName: "TenTwentyFourX", functionName: "totalBurned" });
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

  // Rotate love phrases
  useEffect(() => {
    const interval = setInterval(() => {
      setLovePhrase(LOVE_PHRASES[Math.floor(Math.random() * LOVE_PHRASES.length)]);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

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

  // Check bet results
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

  // Clean expired
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

  const handleApprove = useCallback(async () => {
    if (!connectedAddress) return;
    setIsApproving(true);
    setAwaitingWallet(true);
    openWallet();
    try {
      await approveWrite({ functionName: "approve", args: [contractAddress, selectedBet.value * 10n] });
      setAwaitingWallet(false);
      await refetchAllowance();
      notification.success("CLAWD approved! 💝");
    } catch (e) {
      notification.error(parseError(e));
    }
    setIsApproving(false);
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

      const betPlacedTopic = keccak256(encodePacked(["string"], ["BetPlaced(address,uint256,bytes32,uint256,uint256,uint256,uint256,uint256)"]));
      const log = receipt.logs.find(l => l.topics[0] === betPlacedTopic);
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

      notification.success(`💗 Heartbeat placed! ${selectedBet.label} @ ${selectedMultiplier}x`);
    } catch (e) {
      notification.error(parseError(e));
    }
    setIsClicking(false);
    setAwaitingWallet(false);
  }, [connectedAddress, gameWrite, publicClient, selectedBet, selectedMultiplier]);

  const handleClaim = useCallback(async (bet: PendingBet) => {
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

      notification.success(`💖 Love wins! Claimed ${formatClawd(payout)} CLAWD!`);
    } catch (e) {
      notification.error(parseError(e));
    }
    setIsClaiming(null);
  }, [connectedAddress, gameWrite]);

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

  const hasEnoughBalance = clawdBalance !== undefined && clawdBalance >= selectedBet.value;
  const houseCanPay = canAfford(selectedBet.value, selectedMultiplier);

  const activeBets = pendingBets.filter(b => b.status === "won" || b.status === "waiting");
  const claimableBets = pendingBets.filter(b => b.status === "won");
  const recentFinished = pendingBets.filter(b => b.status === "lost" || b.status === "expired" || b.status === "claimed").slice(-10);

  // Win chance as heart fill percentage
  const heartFill = Math.round((1 / selectedMultiplier) * 100);

  return (
    <div className="relative flex flex-col items-center gap-6 py-8 px-4 min-h-screen">
      <FloatingHearts />

      <div className="relative z-10 w-full max-w-lg flex flex-col items-center gap-6">
        {/* Hero */}
        <div className="text-center">
          <div className="text-6xl mb-2" style={{ animation: "heartbeat 1.2s ease-in-out infinite" }}>💗</div>
          <h1 className="text-5xl font-black text-primary tracking-tighter">1024x</h1>
          <p className="text-sm opacity-50 italic mt-1">{lovePhrase}</p>
        </div>

        {/* Vital Signs — Stats */}
        <div className="w-full ecg-bg rounded-2xl p-4 border border-primary/20">
          <div className="text-xs font-bold text-primary/60 uppercase tracking-widest mb-3 text-center">♡ vital signs ♡</div>
          <div className="grid grid-cols-5 gap-2 text-center">
            <div>
              <div className="text-xs opacity-50">House</div>
              <div className="font-black text-sm">{formatClawd(houseBalance)}</div>
            </div>
            <div>
              <div className="text-xs opacity-50">Beats</div>
              <div className="font-black text-sm">{totalBets?.toString() || "0"}</div>
            </div>
            <div>
              <div className="text-xs opacity-50">Wins</div>
              <div className="font-black text-sm text-success">{totalWins?.toString() || "0"}</div>
            </div>
            <div>
              <div className="text-xs opacity-50">Paid</div>
              <div className="font-black text-sm">{formatClawd(totalPaidOut)}</div>
            </div>
            <div>
              <div className="text-xs opacity-50">🔥 Burned</div>
              <div className="font-black text-sm text-warning">{formatClawd(totalBurned)}</div>
            </div>
          </div>
        </div>

        {isPaused && (
          <div className="alert alert-warning w-full">
            <span>💤 Heart is resting — game paused. Existing bets can still be claimed.</span>
          </div>
        )}

        {/* Main Betting Card */}
        <div className="card bg-base-100 shadow-xl w-full heart-glow border border-primary/10">
          <div className="card-body items-center text-center">
            {/* Bet Size as heart-shaped buttons */}
            <div className="w-full">
              <label className="text-xs font-bold text-primary/70 uppercase tracking-widest">💝 Bet Size</label>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {BET_TIERS.map(tier => (
                  <button
                    key={tier.label}
                    className={`btn btn-sm transition-all duration-300 ${
                      selectedBet.label === tier.label
                        ? "btn-primary scale-105 shadow-lg"
                        : "btn-outline border-primary/30 hover:border-primary"
                    }`}
                    onClick={() => setSelectedBet(tier)}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Multiplier Selection */}
            <div className="w-full mt-4">
              <label className="text-xs font-bold text-primary/70 uppercase tracking-widest">❤️‍🔥 Multiplier</label>
              <div className="grid grid-cols-5 gap-2 mt-2">
                {MULTIPLIERS.map(mult => {
                  const affordable = canAfford(selectedBet.value, mult);
                  return (
                    <button
                      key={mult}
                      className={`btn btn-sm transition-all duration-300 ${
                        selectedMultiplier === mult
                          ? "btn-secondary scale-105 shadow-lg"
                          : affordable
                            ? "btn-outline border-secondary/30 hover:border-secondary"
                            : "btn-disabled opacity-20"
                      }`}
                      disabled={!affordable}
                      onClick={() => affordable && setSelectedMultiplier(mult)}
                    >
                      {mult}x
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Payout Info — styled as a love letter */}
            <div className="bg-base-200 rounded-2xl p-4 w-full mt-4 text-sm border border-primary/10">
              <div className="flex justify-between items-center">
                <span className="opacity-50">Love Odds</span>
                <div className="flex items-center gap-2">
                  <span className="font-black text-primary">{heartFill}%</span>
                  <div className="w-16 h-2 bg-base-300 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-pink-400 to-rose-600 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(heartFill, 3)}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-between mt-1">
                <span className="opacity-50">Payout</span>
                <span className="font-black text-success">{formatClawd(currentPayout)} CLAWD 💰</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="opacity-50">Burn</span>
                <span className="font-bold text-warning">{formatClawd(currentBurn)} 🔥</span>
              </div>
            </div>

            {connectedAddress && (
              <div className="text-sm opacity-50 mt-1">
                Your CLAWD: <span className="font-mono font-black">{formatClawd(clawdBalance)}</span>
              </div>
            )}

            {/* The Big Heart Button */}
            <div className="w-full mt-4">
              {!connectedAddress ? (
                <div className="alert bg-primary/10 border border-primary/20">
                  <span className="text-primary">💗 Connect your wallet to feel the love</span>
                </div>
              ) : isWrongNetwork ? (
                <button className="btn btn-warning btn-lg w-full rounded-2xl" onClick={() => switchChain({ chainId: targetNetwork.id })}>
                  Switch to Base 💫
                </button>
              ) : isPaused ? (
                <button className="btn btn-disabled btn-lg w-full rounded-2xl">Heart Resting 💤</button>
              ) : !hasEnoughBalance ? (
                <div className="alert bg-warning/10 border border-warning/20">
                  <span>Need at least {selectedBet.display} CLAWD 💔</span>
                </div>
              ) : !houseCanPay ? (
                <div className="alert bg-warning/10 border border-warning/20">
                  <span>House heart can&apos;t cover this bet 💔</span>
                </div>
              ) : needsApproval ? (
                <button
                  className="btn btn-primary btn-lg w-full rounded-2xl text-lg"
                  disabled={isApproving}
                  onClick={handleApprove}
                >
                  {isApproving ? (<><span className="loading loading-spinner"></span> Approving...</>) : "💝 Approve CLAWD"}
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-lg w-full rounded-2xl text-xl font-black shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]"
                  disabled={isClicking}
                  onClick={handleClick}
                  style={!isClicking ? { animation: "heartbeat 2s ease-in-out infinite" } : {}}
                >
                  {isClicking ? (
                    <><span className="loading loading-spinner"></span> Heartbeating...</>
                  ) : (
                    <>💗 BEAT {selectedBet.label} @ {selectedMultiplier}x</>
                  )}
                </button>
              )}
              {awaitingWallet && (
                <div className="text-sm text-center mt-2 opacity-60 animate-pulse">
                  💕 Open your wallet to confirm the heartbeat...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Heartbeat Monitor — when waiting */}
        {activeBets.some(b => b.status === "waiting") && (
          <div className="card bg-base-100 shadow-xl w-full border border-primary/10">
            <div className="card-body items-center p-4">
              <HeartbeatMonitor multiplier={activeBets.find(b => b.status === "waiting")?.multiplier || 2} />
            </div>
          </div>
        )}

        {/* Active Bets */}
        {activeBets.length > 0 && (
          <div className="card bg-base-100 shadow-xl w-full border border-primary/10">
            <div className="card-body">
              <h2 className="card-title text-lg">
                💓 Active Heartbeats
                {claimableBets.length > 0 && (
                  <span className="badge badge-success animate-pulse">{claimableBets.length} won!</span>
                )}
              </h2>
              <div className="space-y-3">
                {activeBets.map((bet) => {
                  const blocksLeft = Math.max(0, bet.commitBlock + 256 - currentBlock);
                  const payout = (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n;
                  const betLabel = BET_TIERS.find(t => t.value.toString() === bet.betAmount)?.label || "?";
                  const urgency = blocksLeft < 50;

                  return (
                    <div
                      key={`${bet.betIndex}-${bet.commitBlock}`}
                      className={`p-3 rounded-xl transition-all duration-300 ${
                        bet.status === "won"
                          ? "bg-success/15 border-2 border-success/30 shadow-md"
                          : "bg-base-200 border border-base-300"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="font-bold">{betLabel} @ {bet.multiplier}x</span>
                          {bet.status === "won" && (
                            <span className="text-success font-black ml-2">→ {formatClawd(payout)} CLAWD 🎉</span>
                          )}
                        </div>
                        <div className="text-right">
                          {bet.status === "waiting" && (
                            <span className="text-xs opacity-50" style={{ animation: "heartbeat 1.2s ease-in-out infinite" }}>💗</span>
                          )}
                          {bet.status === "won" && (
                            <div>
                              <div className="text-xs opacity-50 mb-1">⏱️ {blocksLeft} blocks</div>
                              <button
                                className="btn btn-success btn-sm rounded-xl"
                                disabled={isClaiming === bet.betIndex}
                                onClick={() => handleClaim(bet)}
                              >
                                {isClaiming === bet.betIndex ? <span className="loading loading-spinner loading-xs"></span> : "💖 Claim"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {bet.status === "won" && urgency && (
                        <div className="text-xs text-warning mt-1 animate-pulse">⚠️ Claim fast! Only {blocksLeft} beats left 💔</div>
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
          <div className="card bg-base-100 shadow-xl w-full border border-primary/10">
            <div className="card-body">
              <div className="flex justify-between items-center">
                <h2 className="card-title text-lg">📜 Love Letters (Results)</h2>
                <button className="btn btn-ghost btn-xs" onClick={clearFinished}>Clear</button>
              </div>
              <div className="space-y-1">
                {recentFinished.reverse().map((bet, i) => {
                  const betLabel = BET_TIERS.find(t => t.value.toString() === bet.betAmount)?.label || "?";
                  return (
                    <div key={i} className="flex justify-between text-sm p-2 rounded-lg hover:bg-base-200 transition-colors">
                      <span>{betLabel} @ {bet.multiplier}x</span>
                      <span className={
                        bet.status === "claimed" ? "text-success font-bold" :
                        bet.status === "expired" ? "text-warning" : "opacity-40"
                      }>
                        {bet.status === "claimed" ? "💖 Claimed" : bet.status === "expired" ? "💔 Expired" : "💔 Lost"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* How It Works — Love Story */}
        <div className="card bg-base-100 shadow-xl w-full border border-primary/10">
          <div className="card-body">
            <h2 className="card-title text-lg">💌 How Love Works</h2>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3 items-start">
                <span className="text-xl">💗</span>
                <p className="m-0"><span className="font-bold">Feel the Beat</span> — Choose your bet & multiplier. Every click is a heartbeat.</p>
              </div>
              <div className="flex gap-3 items-start">
                <span className="text-xl">💓</span>
                <p className="m-0"><span className="font-bold">Wait for Fate</span> — After 1 block, destiny reveals itself. Winners glow green.</p>
              </div>
              <div className="flex gap-3 items-start">
                <span className="text-xl">💖</span>
                <p className="m-0"><span className="font-bold">Claim Your Love</span> — Hit claim within 256 blocks (~8 min). Don&apos;t leave love waiting.</p>
              </div>
            </div>
            <div className="divider my-1 before:bg-primary/10 after:bg-primary/10"></div>
            <p className="text-xs opacity-40 text-center">
              2% house edge • 1% burned every heartbeat 🔥 • commit-reveal fairness • love is concurrent
            </p>
          </div>
        </div>

        {/* Recent Winners */}
        {winEvents && winEvents.length > 0 && (
          <div className="card bg-base-100 shadow-xl w-full border border-primary/10">
            <div className="card-body">
              <h2 className="card-title text-lg">🏆 Loved & Won</h2>
              <div className="space-y-2">
                {winEvents.slice(0, 10).map((event, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-success/10 rounded-xl">
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
    </div>
  );
};

export default Home;
