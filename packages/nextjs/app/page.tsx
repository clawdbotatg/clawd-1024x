"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
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

// 🦞🎲💰 Win confetti — scales with multiplier!
function fireWinConfetti(multiplier: number = 2) {
  const colors = ["#FF6B35", "#FFD700", "#FF1744", "#00E676", "#FF9100", "#FFEB3B", "#76FF03"];
  const defaults = { zIndex: 9999, colors, disableForReducedMotion: true };

  // Intensity tiers: 2-4x = mild, 8-16x = medium, 32-128x = heavy, 256-1024x = insane
  const intensity = multiplier <= 4 ? 1 : multiplier <= 16 ? 2 : multiplier <= 128 ? 3 : 4;
  const baseCount = [80, 200, 400, 600][intensity - 1];
  const flashOpacity = [0.15, 0.25, 0.4, 0.6][intensity - 1];
  const flashDuration = [0.8, 1.2, 1.5, 2.5][intensity - 1];

  function fire(particleRatio: number, opts: confetti.Options) {
    confetti({ ...defaults, ...opts, particleCount: Math.floor(baseCount * particleRatio) });
  }

  // Wave 1 — initial burst (always)
  fire(0.3, { spread: 30, startVelocity: 45 + intensity * 10, origin: { x: 0.1, y: 0.6 }, ticks: 60 + intensity * 30 });
  fire(0.3, { spread: 30, startVelocity: 45 + intensity * 10, origin: { x: 0.9, y: 0.6 }, ticks: 60 + intensity * 30 });
  fire(0.25, {
    spread: 80 + intensity * 20,
    startVelocity: 40 + intensity * 10,
    origin: { x: 0.5, y: 0.4 },
    ticks: 80 + intensity * 20,
  });

  // Wave 2 — gold rain (medium+)
  if (intensity >= 2) {
    setTimeout(() => {
      fire(0.4, {
        spread: 180,
        startVelocity: 55,
        origin: { x: 0.5, y: -0.1 },
        gravity: 0.8,
        ticks: 150,
        colors: ["#FFD700", "#FFC107", "#FFAB00", "#FF9100"],
      });
    }, 300);
  }

  // Wave 3 — corner cannons (medium+)
  if (intensity >= 2) {
    setTimeout(() => {
      fire(0.35, { angle: 60, spread: 50, startVelocity: 50 + intensity * 10, origin: { x: 0, y: 1 }, ticks: 120 });
      fire(0.35, { angle: 120, spread: 50, startVelocity: 50 + intensity * 10, origin: { x: 1, y: 1 }, ticks: 120 });
    }, 600);
  }

  // Wave 4 — center explosion (heavy+)
  if (intensity >= 3) {
    setTimeout(() => {
      fire(0.5, { spread: 360, startVelocity: 40, origin: { x: 0.5, y: 0.5 }, ticks: 100, scalar: 1.5 });
    }, 900);
  }

  // Wave 5+ — sparkle shower, repeated for higher tiers
  if (intensity >= 3) {
    const showerCount = intensity === 3 ? 5 : 12;
    setTimeout(() => {
      for (let i = 0; i < showerCount; i++) {
        setTimeout(() => {
          confetti({
            ...defaults,
            particleCount: 20 + intensity * 15,
            spread: 180,
            startVelocity: 15,
            gravity: 0.4,
            scalar: 0.8,
            ticks: 200,
            origin: { x: Math.random(), y: -0.1 },
            colors: ["#FFD700", "#FFEB3B", "#FFF176"],
          });
        }, i * 300);
      }
    }, 1200);
  }

  // Insane tier (256x+) — continuous side cannons for 4 seconds
  if (intensity >= 4) {
    for (let i = 0; i < 8; i++) {
      setTimeout(
        () => {
          fire(0.3, {
            angle: 60 + Math.random() * 20,
            spread: 40,
            startVelocity: 70 + Math.random() * 20,
            origin: { x: 0, y: 0.7 + Math.random() * 0.3 },
            ticks: 150,
          });
          fire(0.3, {
            angle: 100 + Math.random() * 20,
            spread: 40,
            startVelocity: 70 + Math.random() * 20,
            origin: { x: 1, y: 0.7 + Math.random() * 0.3 },
            ticks: 150,
          });
        },
        500 + i * 500,
      );
    }
  }

  // Screen flash — scales with intensity
  if (typeof document !== "undefined") {
    const flash = document.createElement("div");
    flash.style.cssText = `position:fixed;inset:0;background:radial-gradient(circle,rgba(255,215,0,${flashOpacity}),rgba(0,230,118,${flashOpacity * 0.5}),transparent 70%);z-index:9998;pointer-events:none;animation:winFlash ${flashDuration}s ease-out forwards`;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), flashDuration * 1000);
  }
}

// Inject win animation keyframes
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes winFlash {
      0% { opacity: 0; }
      15% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes winPulse {
      0%, 100% { transform: scale(1); filter: brightness(1); }
      50% { transform: scale(1.03); filter: brightness(1.3); }
    }
    @keyframes winGlow {
      0%, 100% { box-shadow: 0 0 20px rgba(0,230,118,0.3), 0 0 60px rgba(255,215,0,0.1); }
      50% { box-shadow: 0 0 40px rgba(0,230,118,0.6), 0 0 100px rgba(255,215,0,0.3), 0 0 150px rgba(255,107,53,0.1); }
    }
    @keyframes winTextPop {
      0% { transform: scale(0.5); opacity: 0; }
      50% { transform: scale(1.15); }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes winEmoji {
      0% { transform: scale(0) rotate(-30deg); }
      50% { transform: scale(1.3) rotate(10deg); }
      100% { transform: scale(1) rotate(0deg); }
    }
  `;
  document.body.appendChild(style);
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
  { value: parseEther("2000"), label: "2K", display: "2,000" },
  { value: parseEther("10000"), label: "10K", display: "10,000" },
  { value: parseEther("50000"), label: "50K", display: "50,000" },
  { value: parseEther("100000"), label: "100K", display: "100,000" },
  { value: parseEther("500000"), label: "500K", display: "500,000" },
  { value: parseEther("1000000"), label: "1M", display: "1,000,000" },
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
  timestamp?: number; // ms since epoch
}

// Live time-ago component that re-renders every 5s
function TimeAgo({ timestamp }: { timestamp?: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);
  if (!timestamp) return null;
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return <span className="opacity-40">just now</span>;
  if (seconds < 60) return <span className="opacity-40">{seconds}s ago</span>;
  if (seconds < 3600) return <span className="opacity-40">{Math.floor(seconds / 60)}m ago</span>;
  return <span className="opacity-40">{Math.floor(seconds / 3600)}h ago</span>;
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
  if (msg.includes("House underfunded") || msg.includes("Payout exceeds max"))
    return "Payout exceeds 1/5 of house. Try lower odds or smaller bet.";
  if (msg.includes("Game paused")) return "Game is paused — withdrawal in progress.";
  if (msg.includes("Bet expired")) return "Bet expired (>256 blocks)";
  if (msg.includes("Not a winner")) return "Not a winning reveal";
  if (msg.includes("insufficient allowance") || msg.includes("ERC20InsufficientAllowance"))
    return "Need to approve CLAWD first";
  return "Transaction failed";
}

const Home: NextPage = () => {
  const { address: connectedAddress, chain, connector } = useAccount();
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
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [lastResult, setLastResult] = useState<{
    type: "won" | "lost";
    multiplier: number;
    betLabel: string;
    payout?: bigint;
    bet?: PendingBet;
  } | null>(null);

  // Check disclaimer acceptance
  useEffect(() => {
    try {
      if (localStorage.getItem("1024x-disclaimer") === "accepted") setDisclaimerAccepted(true);
    } catch {}
  }, []);

  const acceptDisclaimer = useCallback(() => {
    try {
      localStorage.setItem("1024x-disclaimer", "accepted");
    } catch {}
    setDisclaimerAccepted(true);
  }, []);

  // Deep link to wallet app AFTER tx request is sent (not before — tx must fire first)
  const openWallet = useCallback(() => {
    if (typeof window === "undefined") return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile || window.ethereum) return;

    // Check all possible sources for wallet name
    const allIds = [connector?.id, connector?.name, localStorage.getItem("wagmi.recentConnectorId")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // Also check WalletConnect session data for wallet name
    let wcWallet = "";
    try {
      const wcKey = Object.keys(localStorage).find(k => k.startsWith("wc@2:client"));
      if (wcKey) wcWallet = (localStorage.getItem(wcKey) || "").toLowerCase();
    } catch {}
    const search = `${allIds} ${wcWallet}`;

    const schemes: [string[], string][] = [
      [["rainbow"], "rainbow://"],
      [["metamask"], "metamask://"],
      [["coinbase", "cbwallet"], "cbwallet://"],
      [["trust"], "trust://"],
      [["phantom"], "phantom://"],
      [["zerion"], "zerion://"],
      [["uniswap"], "uniswap://"],
    ];

    for (const [keywords, scheme] of schemes) {
      if (keywords.some(k => search.includes(k))) {
        window.location.href = scheme;
        return;
      }
    }
  }, [connector]);

  // Helper: fire a write call, then deep link to wallet once the request has been relayed
  const writeAndOpen = useCallback(
    <T,>(writeFn: () => Promise<T>): Promise<T> => {
      const promise = writeFn(); // Fire TX request — this does gas estimation + WC relay
      // WalletConnect needs time to estimate gas, encode, and relay to the wallet.
      // Too fast = wallet hasn't received the request yet. 2s is safe for WC relay.
      setTimeout(openWallet, 2000);
      return promise;
    },
    [openWallet],
  );
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

  // Gross payout (after 2% house edge), used for contract-level checks
  const grossPayout = (selectedBet.value * BigInt(selectedMultiplier) * 98n) / 100n;
  // Net payout after 1% claim burn — what the player actually receives
  const currentPayout = grossPayout - (grossPayout * 1n) / 100n;
  const currentBurn = selectedBet.value / 100n + (grossPayout * 1n) / 100n;

  const canAfford = (betValue: bigint, mult: number): boolean => {
    if (!houseBalance) return false;
    const payout = (betValue * BigInt(mult) * 98n) / 100n;
    return payout <= houseBalance / 5n;
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

  // Verify "won" bets against on-chain claimed status (catches stale localStorage)
  useEffect(() => {
    if (!connectedAddress || !publicClient || !contractAddress) return;

    const verifyWonBets = async () => {
      const bets = loadBets(connectedAddress);
      const wonBets = bets.filter(b => b.status === "won");
      if (wonBets.length === 0) return;

      let changed = false;
      for (const bet of wonBets) {
        try {
          const result = await publicClient.readContract({
            address: contractAddress,
            abi: [
              {
                type: "function",
                name: "getBet",
                inputs: [
                  { name: "player", type: "address" },
                  { name: "betIndex", type: "uint256" },
                ],
                outputs: [
                  { name: "dataHash", type: "bytes32" },
                  { name: "commitBlock", type: "uint256" },
                  { name: "betAmount", type: "uint256" },
                  { name: "multiplier", type: "uint256" },
                  { name: "claimed", type: "bool" },
                ],
                stateMutability: "view",
              },
            ],
            functionName: "getBet",
            args: [connectedAddress, BigInt(bet.betIndex)],
          });
          if (result[4]) {
            // Already claimed on-chain
            bet.status = "claimed";
            changed = true;
          }
        } catch {
          // Bet index doesn't exist or other error — skip
        }
      }

      if (changed) {
        saveBets(connectedAddress, bets);
        setPendingBets([...bets]);
      }
    };

    verifyWonBets();
  }, [connectedAddress, publicClient, contractAddress]);

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
          const betLabel = BET_TIERS.find(t => t.value.toString() === bet.betAmount)?.label || "?";
          const grossWin = (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n;
          const winPayout = grossWin - (grossWin * 1n) / 100n;
          setLastResult({
            type: isWinner ? "won" : "lost",
            multiplier: bet.multiplier,
            betLabel,
            payout: isWinner ? winPayout : undefined,
            bet: isWinner ? { ...bet } : undefined,
          });
          if (isWinner) fireWinConfetti(bet.multiplier);
          // Losses auto-clear; wins persist until manually dismissed or claimed
          // Results stay visible until user dismisses them
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
  const lastCleanupBlock = useRef(0);
  useEffect(() => {
    if (!connectedAddress || currentBlock === 0) return;
    if (currentBlock === lastCleanupBlock.current) return;
    const bets = loadBets(connectedAddress);
    // Mark both "expired" status and won bets past 256 blocks as lost
    const stale = bets.filter(
      b => b.status === "expired" || (b.status === "won" && currentBlock > b.commitBlock + 256),
    );
    if (stale.length === 0) return;
    lastCleanupBlock.current = currentBlock;
    for (const bet of stale) {
      const idx = bets.findIndex(b => b.betIndex === bet.betIndex && b.commitBlock === bet.commitBlock);
      if (idx >= 0) bets[idx].status = "lost";
    }
    saveBets(connectedAddress, bets);
    setPendingBets([...bets]);
  }, [connectedAddress, currentBlock]);

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
    try {
      await writeAndOpen(() =>
        approveWrite({ functionName: "approve", args: [contractAddress, selectedBet.value * 10n] }),
      );
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
    try {
      const secret = randomBytes32();
      const salt = randomBytes32();
      const dataHash = keccak256(encodePacked(["bytes32", "bytes32"], [secret, salt]));

      const txHash = await writeAndOpen(() =>
        gameWrite({
          functionName: "click",
          args: [dataHash, selectedBet.value, BigInt(selectedMultiplier)],
        }),
      );

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
        timestamp: Date.now(),
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

  const markBetClaimed = useCallback(
    (bet: PendingBet) => {
      if (!connectedAddress) return;
      const bets = loadBets(connectedAddress);
      const idx = bets.findIndex(b => b.betIndex === bet.betIndex && b.commitBlock === bet.commitBlock);
      if (idx >= 0) bets[idx].status = "claimed";
      saveBets(connectedAddress, bets);
      setPendingBets([...bets]);
      // Clear win card if this bet was the one displayed
      setLastResult(prev => {
        if (prev?.bet?.betIndex === bet.betIndex && prev?.bet?.commitBlock === bet.commitBlock) return null;
        return prev;
      });
    },
    [connectedAddress],
  );

  const handleClaim = useCallback(
    async (bet: PendingBet) => {
      if (!connectedAddress) return;
      setIsClaiming(bet.betIndex);
      try {
        await writeAndOpen(() =>
          gameWrite({
            functionName: "reveal",
            args: [BigInt(bet.betIndex), bet.secret as `0x${string}`, bet.salt as `0x${string}`],
          }),
        );

        const grossP = (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n;
        const payout = grossP - (grossP * 1n) / 100n;
        markBetClaimed(bet);
        setLastResult(null);
        notification.success(`🎉 Claimed ${formatClawd(payout)} CLAWD!`);
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        if (msg.includes("Already claimed")) {
          // Bet was already claimed (e.g. page reload race) — just update UI
          markBetClaimed(bet);
          notification.info("Already claimed — updated status.");
        } else {
          notification.error(parseError(e));
        }
      }
      setIsClaiming(null);
    },
    [connectedAddress, gameWrite, markBetClaimed],
  );

  const [isBatchClaiming, setIsBatchClaiming] = useState(false);

  const handleBatchClaim = useCallback(
    async (bets: PendingBet[]) => {
      if (!connectedAddress || bets.length === 0) return;
      setIsBatchClaiming(true);
      try {
        const indices = bets.map(b => BigInt(b.betIndex));
        const secrets = bets.map(b => b.secret as `0x${string}`);
        const salts = bets.map(b => b.salt as `0x${string}`);

        await writeAndOpen(() =>
          gameWrite({
            functionName: "batchReveal",
            args: [indices, secrets, salts],
          }),
        );

        let totalPayout = 0n;
        const allBets = loadBets(connectedAddress);
        for (const bet of bets) {
          const idx = allBets.findIndex(b => b.betIndex === bet.betIndex && b.commitBlock === bet.commitBlock);
          if (idx >= 0) allBets[idx].status = "claimed";
          const gp = (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n;
          totalPayout += gp - (gp * 1n) / 100n;
        }
        saveBets(connectedAddress, allBets);
        setPendingBets([...allBets]);

        setLastResult(null);
        notification.success(`🎉 Claimed ${bets.length} wins — ${formatClawd(totalPayout)} CLAWD!`);
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        if (msg.includes("Already claimed")) {
          // Some/all already claimed — mark them all
          const allBets = loadBets(connectedAddress);
          for (const bet of bets) {
            const idx = allBets.findIndex(b => b.betIndex === bet.betIndex && b.commitBlock === bet.commitBlock);
            if (idx >= 0) allBets[idx].status = "claimed";
          }
          saveBets(connectedAddress, allBets);
          setPendingBets([...allBets]);
          notification.info("Some bets already claimed — updated status.");
        } else {
          notification.error(parseError(e));
        }
      }
      setIsBatchClaiming(false);
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
  const isRolling = activeBets.some(b => b.status === "waiting");
  const claimableBets = pendingBets.filter(
    b => b.status === "won" && currentBlock > 0 && b.commitBlock + 256 > currentBlock,
  );
  const recentFinished = pendingBets
    .filter(b => b.status === "lost" || b.status === "expired" || b.status === "claimed" || b.status === "won")
    .slice(-10);

  if (!disclaimerAccepted) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="card bg-base-100 shadow-xl w-full max-w-md">
          <div className="card-body text-center">
            <h2 className="card-title text-2xl font-black justify-center">⚠️ Disclaimer</h2>
            <p className="text-sm opacity-80 mt-2 leading-relaxed">
              This is unaudited, experimental software written entirely by AI. The smart contract has not been reviewed
              by any human. Do not put money in this. Do not connect your wallet. Solvency is best-effort — multiple
              simultaneous large wins could exceed house balance. You should only use this experimental software if you
              are legally permitted to do so in your jurisdiction. By proceeding, you accept all risk. This is all
              slop-lobster claw-dogged.
            </p>
            <button className="btn btn-primary btn-lg w-full mt-4 text-lg" onClick={acceptDisclaimer}>
              I Understand
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-8 px-4 min-h-screen">
      {isPaused && (
        <div className="alert alert-warning w-full max-w-md">
          <span>⚠️ Game is paused — withdrawal in progress. Existing bets can still be claimed.</span>
        </div>
      )}

      {/* Main Game Card — Betting */}
      <div className="card bg-base-100 shadow-xl w-full max-w-md">
        <div className="card-body items-center text-center">
          <p className="text-sm opacity-70 mb-2">Pick your bet, pick your odds, roll as many times as you want</p>

          {/* Bet Size */}
          <div className="w-full">
            <label className="label">
              <span className="label-text font-bold">
                Bet Size{" "}
                {clawdPriceUsd > 0 && (
                  <span className="font-normal opacity-60">
                    (${(Number(formatEther(selectedBet.value)) * clawdPriceUsd).toFixed(2)})
                  </span>
                )}
              </span>
            </label>
            <div className="grid grid-cols-3 gap-2">
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
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button className="btn btn-primary btn-lg w-full text-xl" onClick={openConnectModal}>
                    🔗 Connect Wallet
                  </button>
                )}
              </ConnectButton.Custom>
            ) : isWrongNetwork ? (
              <button
                className="btn btn-warning btn-lg w-full text-xl"
                onClick={() => switchChain({ chainId: targetNetwork.id })}
              >
                ⛓️ Switch to Base
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
              <button
                className="btn btn-primary btn-lg w-full text-xl"
                disabled={isClicking || isRolling}
                onClick={handleClick}
              >
                {isClicking ? (
                  <>
                    <span className="loading loading-spinner"></span>Rolling...
                  </>
                ) : isRolling ? (
                  <>
                    <span className="loading loading-spinner"></span>Waiting for result...
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

      {/* Result Flash — shows after a roll resolves */}
      {lastResult &&
        !activeBets.some(b => b.status === "waiting") &&
        (lastResult.type === "won" ? (
          <div
            className="card w-full max-w-md border-4 border-success relative overflow-hidden cursor-pointer"
            onClick={() => !lastResult.bet && setLastResult(null)}
            style={{
              background:
                "linear-gradient(135deg, rgba(0,230,118,0.25) 0%, rgba(255,215,0,0.15) 50%, rgba(0,230,118,0.25) 100%)",
              animation: "winGlow 1.5s ease-in-out infinite, winPulse 2s ease-in-out infinite",
            }}
          >
            <div className="card-body items-center text-center py-8">
              <div
                className="flex gap-3 mb-3"
                style={{ animation: "winEmoji 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" }}
              >
                <span className="text-6xl">🦞</span>
                <span className="text-6xl">💰</span>
                <span className="text-6xl">🎉</span>
              </div>
              <div
                className="text-5xl font-black text-transparent bg-clip-text"
                style={{
                  backgroundImage: "linear-gradient(to right, #00E676, #FFD700, #FF6B35)",
                  animation: "winTextPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                  WebkitBackgroundClip: "text",
                }}
              >
                YOU WON!
              </div>
              {lastResult.payout && (
                <div className="text-3xl font-black text-success mt-2">
                  +{formatClawd(lastResult.payout)} CLAWD
                  {formatUsd(lastResult.payout) && (
                    <span className="text-xl font-bold opacity-70 ml-2">{formatUsd(lastResult.payout)}</span>
                  )}
                </div>
              )}
              <div className="text-lg opacity-80 mt-1">
                {lastResult.betLabel} @ {lastResult.multiplier}x 🔥
              </div>
              {lastResult.bet && (
                <button
                  className="btn btn-success btn-lg mt-4 text-xl"
                  disabled={isClaiming === lastResult.bet.betIndex}
                  onClick={() => lastResult.bet && handleClaim(lastResult.bet)}
                >
                  {isClaiming === lastResult.bet.betIndex ? (
                    <>
                      <span className="loading loading-spinner"></span>Claiming...
                    </>
                  ) : (
                    "🏆 Claim Winnings"
                  )}
                </button>
              )}
              {!lastResult.bet && <div className="text-xs opacity-40 mt-2">tap to dismiss</div>}
            </div>
          </div>
        ) : (
          <div
            className="card shadow-xl w-full max-w-md border-2 border-error/50 bg-error/10 cursor-pointer"
            onClick={() => setLastResult(null)}
          >
            <div className="card-body items-center text-center py-6">
              <div className="text-5xl mb-2">💀</div>
              <div className="text-2xl font-black">REKT</div>
              <div className="text-sm opacity-70">
                {lastResult.betLabel} @ {lastResult.multiplier}x
              </div>
              <div className="text-xs opacity-40 mt-2">tap to dismiss</div>
            </div>
          </div>
        ))}

      {/* Active Bets */}
      {activeBets.length > 0 && (
        <div className="card bg-base-100 shadow-xl w-full max-w-md">
          <div className="card-body">
            <div className="flex justify-between items-center">
              <h2 className="card-title text-lg">
                🎲 Your Active Bets
                {claimableBets.length > 0 && <span className="badge badge-success">{claimableBets.length} won!</span>}
              </h2>
              {claimableBets.length > 1 && (
                <button
                  className="btn btn-success btn-sm"
                  disabled={isBatchClaiming}
                  onClick={() => handleBatchClaim(claimableBets)}
                >
                  {isBatchClaiming ? (
                    <span className="loading loading-spinner loading-xs"></span>
                  ) : (
                    `🏆 Claim All (${claimableBets.length})`
                  )}
                </button>
              )}
            </div>
            <div className="space-y-3">
              {activeBets.map(bet => {
                const blocksLeft = Math.max(0, bet.commitBlock + 256 - currentBlock);
                const gPayout = (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n;
                const payout = gPayout - (gPayout * 1n) / 100n;
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
                        {bet.status === "won" && blocksLeft > 0 && (
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
                        {bet.status === "won" && blocksLeft === 0 && (
                          <span className="text-warning text-xs">⏰ Expired</span>
                        )}
                      </div>
                    </div>
                    {bet.status === "won" && blocksLeft < 50 && blocksLeft > 0 && (
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
                const gP = (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n;
                const payout = gP - (gP * 1n) / 100n;
                return (
                  <div key={i} className="flex justify-between items-center text-sm p-1">
                    <span className="flex items-center gap-2">
                      {betLabel} @ {bet.multiplier}x
                      <TimeAgo timestamp={bet.timestamp} />
                    </span>
                    <span
                      className={
                        bet.status === "won"
                          ? "text-success font-bold"
                          : bet.status === "claimed"
                            ? "text-success"
                            : bet.status === "expired"
                              ? "text-warning"
                              : "opacity-50"
                      }
                    >
                      {bet.status === "won"
                        ? `🎉 Won ${formatClawd(payout)}`
                        : bet.status === "claimed"
                          ? `✅ Claimed ${formatClawd(payout)}`
                          : bet.status === "expired"
                            ? "⏰ Expired"
                            : "❌ Lost"}
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

      {/* Stats Bar — bottom */}
      <div className="flex flex-wrap justify-center gap-4 text-sm opacity-70 w-full max-w-md mt-4 bg-base-300/70 backdrop-blur-sm rounded-lg px-4 py-2">
        <span>Bets {totalBets?.toString() || "0"}</span>
        <span>Wins {totalWins?.toString() || "0"}</span>
        <span>Paid {formatClawd(totalPaidOut)}</span>
        <span>🔥 Burned {formatClawd(totalBurned)}</span>
      </div>
    </div>
  );
};

export default Home;
