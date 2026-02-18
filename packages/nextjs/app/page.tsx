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

// 🦞🎲💰 Win confetti!
function fireWinConfetti() {
  const lobsterEmojis = ["🦞", "🎲", "💰", "🎉", "💎", "🔥"];
  const defaults = { startVelocity: 30, spread: 360, ticks: 80, zIndex: 9999 };

  function fire(particleRatio: number, opts: confetti.Options) {
    confetti({ ...defaults, ...opts, particleCount: Math.floor(200 * particleRatio) });
  }

  fire(0.25, { spread: 26, startVelocity: 55, origin: { x: 0.2, y: 0.6 } });
  fire(0.2, { spread: 60, origin: { x: 0.5, y: 0.5 } });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8, origin: { x: 0.8, y: 0.6 } });
  fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2, origin: { x: 0.5, y: 0.3 } });

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

  setTimeout(() => {
    fire(0.3, { spread: 100, startVelocity: 45, origin: { x: 0.3, y: 0.7 } });
    fire(0.3, { spread: 100, startVelocity: 45, origin: { x: 0.7, y: 0.7 } });
  }, 400);
}

// Rolling animation component
function RollingAnimation({ multiplier, numRolls }: { multiplier: number; numRolls: number }) {
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
      <div className="text-lg font-bold animate-bounce">
        Rolling {numRolls > 1 ? `${numRolls}x ` : ""}for {multiplier}x...
      </div>
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
const ROLL_OPTIONS = [1, 2, 3, 5, 10, 15, 20];

const STORAGE_KEY = "1024x-bets";

interface RollResult {
  index: number;
  won: boolean;
}

interface PendingBet {
  betIndex: number;
  secret: string;
  salt: string;
  commitBlock: number;
  betAmount: string;
  multiplier: number;
  numRolls: number;
  status: "waiting" | "resolved" | "expired" | "claimed";
  wins: number;
  rollResults: RollResult[];
  timestamp?: number;
}

// Live time-ago component
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
  if (msg.includes("No winning rolls")) return "No winning rolls";
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
  const [selectedRolls, setSelectedRolls] = useState(1);
  const [pendingBets, setPendingBets] = useState<PendingBet[]>([]);
  const [isApproving, setIsApproving] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [lastResult, setLastResult] = useState<{
    type: "won" | "lost";
    multiplier: number;
    betLabel: string;
    wins: number;
    numRolls: number;
  } | null>(null);

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

  const openWallet = useCallback(() => {
    if (typeof window === "undefined") return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile || window.ethereum) return;

    const allIds = [connector?.id, connector?.name, localStorage.getItem("wagmi.recentConnectorId")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

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

  const writeAndOpen = useCallback(
    <T,>(writeFn: () => Promise<T>): Promise<T> => {
      const promise = writeFn();
      setTimeout(openWallet, 2000);
      return promise;
    },
    [openWallet],
  );

  const [isClaiming, setIsClaiming] = useState<number | null>(null);
  const [currentBlock, setCurrentBlock] = useState<number>(0);
  const [clawdPriceUsd, setClawdPriceUsd] = useState<number>(0);

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

  const totalBetAmount = selectedBet.value * BigInt(selectedRolls);
  const needsApproval = !allowance || allowance < totalBetAmount;

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
    eventName: "BetResolved",
    fromBlock: BigInt(Math.max(0, currentBlock - 50000)),
    watch: true,
  });

  const singlePayout = (selectedBet.value * BigInt(selectedMultiplier) * 98n) / 100n;
  const currentTotalPayout = singlePayout * BigInt(selectedRolls);
  const currentBurn = (selectedBet.value * BigInt(selectedRolls)) / 100n;

  const canAfford = (betValue: bigint, mult: number, rolls: number): boolean => {
    if (!houseBalance) return false;
    const maxPayout = (betValue * BigInt(mult) * 98n) / 100n * BigInt(rolls);
    return maxPayout <= houseBalance / 5n;
  };

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

  useEffect(() => {
    if (!connectedAddress) return;
    setPendingBets(loadBets(connectedAddress));
  }, [connectedAddress]);

  // Verify resolved bets against on-chain claimed status
  useEffect(() => {
    if (!connectedAddress || !publicClient || !contractAddress) return;

    const verifyBets = async () => {
      const bets = loadBets(connectedAddress);
      const resolvedBets = bets.filter(b => b.status === "resolved" && b.wins > 0);
      if (resolvedBets.length === 0) return;

      let changed = false;
      for (const bet of resolvedBets) {
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
                  { name: "numRolls", type: "uint8" },
                  { name: "claimed", type: "bool" },
                ],
                stateMutability: "view",
              },
            ],
            functionName: "getBet",
            args: [connectedAddress, BigInt(bet.betIndex)],
          });
          if (result[5]) {
            bet.status = "claimed";
            changed = true;
          }
        } catch {}
      }

      if (changed) {
        saveBets(connectedAddress, bets);
        setPendingBets([...bets]);
      }
    };

    verifyBets();
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
          bet.wins = 0;
          bet.rollResults = [];
          changed = true;
          continue;
        }

        try {
          const block = await publicClient.getBlock({ blockNumber: BigInt(bet.commitBlock) });
          if (!block.hash) continue;

          // Check each roll
          const rollResults: RollResult[] = [];
          let wins = 0;
          for (let i = 0; i < bet.numRolls; i++) {
            const randomSeed = keccak256(
              encodePacked(["bytes32", "bytes32", "uint8"], [bet.secret as `0x${string}`, block.hash, i]),
            );
            const won = BigInt(randomSeed) % BigInt(bet.multiplier) === 0n;
            rollResults.push({ index: i, won });
            if (won) wins++;
          }

          bet.status = "resolved";
          bet.wins = wins;
          bet.rollResults = rollResults;

          const betLabel = BET_TIERS.find(t => t.value.toString() === bet.betAmount)?.label || "?";
          setLastResult({
            type: wins > 0 ? "won" : "lost",
            multiplier: bet.multiplier,
            betLabel,
            wins,
            numRolls: bet.numRolls,
          });
          if (wins > 0) fireWinConfetti();
          setTimeout(() => setLastResult(null), 4000);
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

  // Clean up expired bets
  useEffect(() => {
    if (!connectedAddress) return;
    const bets = loadBets(connectedAddress);
    const expired = bets.filter(b => b.status === "expired");
    if (expired.length === 0) return;
    // Mark expired as resolved with 0 wins (lost)
    let changed = false;
    for (const bet of bets) {
      if (bet.status === "expired") {
        // Keep as expired for display
      }
    }
    if (changed) {
      saveBets(connectedAddress, bets);
      setPendingBets([...bets]);
    }
  }, [connectedAddress, pendingBets]);

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
        approveWrite({ functionName: "approve", args: [contractAddress, totalBetAmount * 100n] }),
      );
      setAwaitingWallet(false);
      await refetchAllowance();
      notification.success("CLAWD approved!");
    } catch (e) {
      notification.error(parseError(e));
      setIsApproving(false);
    }
    setAwaitingWallet(false);
  }, [connectedAddress, approveWrite, contractAddress, refetchAllowance, totalBetAmount]);

  const handleClick = useCallback(async () => {
    if (!connectedAddress || !publicClient) return;
    setIsClicking(true);
    setAwaitingWallet(true);
    try {
      const secret = randomBytes32();
      const salt = randomBytes32();
      const dataHash = keccak256(encodePacked(["bytes32", "bytes32"], [secret, salt]));

      const args =
        selectedRolls === 1
          ? { functionName: "click" as const, args: [dataHash, selectedBet.value, BigInt(selectedMultiplier)] as const }
          : {
              functionName: "click" as const,
              args: [dataHash, selectedBet.value, BigInt(selectedMultiplier), selectedRolls] as const,
            };

      const txHash = await writeAndOpen(() => gameWrite(args));

      setAwaitingWallet(false);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      const commitBlock = Number(receipt.blockNumber);

      // Get bet index from BetPlaced event
      const betPlacedTopic = keccak256(
        encodePacked(
          ["string"],
          ["BetPlaced(address,uint256,bytes32,uint256,uint256,uint256,uint8,uint256,uint256)"],
        ),
      );
      const log = receipt.logs.find(l => l.topics[0] === betPlacedTopic);
      const betIndex = log ? Number(BigInt(log.topics[2] || "0")) : 0;

      const newBet: PendingBet = {
        betIndex,
        secret,
        salt,
        commitBlock,
        betAmount: selectedBet.value.toString(),
        multiplier: selectedMultiplier,
        numRolls: selectedRolls,
        status: "waiting",
        wins: 0,
        rollResults: [],
        timestamp: Date.now(),
      };

      const bets = loadBets(connectedAddress);
      bets.push(newBet);
      saveBets(connectedAddress, bets);
      setPendingBets([...bets]);

      notification.success(
        `Bet placed! ${selectedBet.label} @ ${selectedMultiplier}x${selectedRolls > 1 ? ` × ${selectedRolls} rolls` : ""} 🎲`,
      );
    } catch (e) {
      notification.error(parseError(e));
    }
    setIsClicking(false);
    setAwaitingWallet(false);
  }, [connectedAddress, gameWrite, publicClient, selectedBet, selectedMultiplier, selectedRolls]);

  const markBetClaimed = useCallback(
    (bet: PendingBet) => {
      if (!connectedAddress) return;
      const bets = loadBets(connectedAddress);
      const idx = bets.findIndex(b => b.betIndex === bet.betIndex && b.commitBlock === bet.commitBlock);
      if (idx >= 0) bets[idx].status = "claimed";
      saveBets(connectedAddress, bets);
      setPendingBets([...bets]);
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

        const grossPayout =
          (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n * BigInt(bet.wins);
        const netPayout = grossPayout - grossPayout / 100n;
        markBetClaimed(bet);
        notification.success(`🎉 Claimed ${formatClawd(netPayout)} CLAWD! (${bet.wins}/${bet.numRolls} wins)`);
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        if (msg.includes("Already claimed")) {
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
          const gross = (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n * BigInt(bet.wins);
          totalPayout += gross - gross / 100n;
        }
        saveBets(connectedAddress, allBets);
        setPendingBets([...allBets]);

        notification.success(`🎉 Claimed ${bets.length} bets — ${formatClawd(totalPayout)} CLAWD!`);
      } catch (e) {
        const msg = (e as Error)?.message || String(e);
        if (msg.includes("Already claimed")) {
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
    const bets = loadBets(connectedAddress).filter(
      b => b.status === "waiting" || (b.status === "resolved" && b.wins > 0),
    );
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

  const hasEnoughBalance = clawdBalance !== undefined && clawdBalance >= totalBetAmount;
  const houseCanPay = canAfford(selectedBet.value, selectedMultiplier, selectedRolls);

  // Active bets
  const activeBets = pendingBets.filter(
    b => (b.status === "resolved" && b.wins > 0) || b.status === "waiting",
  );
  const isRolling = activeBets.some(b => b.status === "waiting");
  const claimableBets = pendingBets.filter(b => b.status === "resolved" && b.wins > 0);
  const recentFinished = pendingBets
    .filter(
      b =>
        (b.status === "resolved" && b.wins === 0) ||
        b.status === "expired" ||
        b.status === "claimed" ||
        (b.status === "resolved" && b.wins > 0),
    )
    .slice(-10);

  if (!disclaimerAccepted) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="card bg-base-100 shadow-xl w-full max-w-md">
          <div className="card-body text-center">
            <h2 className="card-title text-2xl font-black justify-center">⚠️ Disclaimer</h2>
            <p className="text-sm opacity-80 mt-2 leading-relaxed">
              This is unaudited, experimental software written by AI. The smart contract has not been reviewed by any
              human. Do not put money in this. Do not connect your wallet. Solvency is best-effort — multiple
              simultaneous large wins could exceed house balance. This is all slop-lobster claw-dogged.
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

      {/* Main Game Card */}
      <div className="card bg-base-100 shadow-xl w-full max-w-md">
        <div className="card-body items-center text-center">
          <p className="text-sm opacity-70 mb-2">Pick your bet, pick your odds, pick your rolls</p>

          {/* Bet Size */}
          <div className="w-full">
            <label className="label">
              <span className="label-text font-bold">
                Bet Size{" "}
                {clawdPriceUsd > 0 && (
                  <span className="font-normal opacity-60">
                    (${(Number(formatEther(selectedBet.value)) * clawdPriceUsd).toFixed(2)} each)
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
                const affordable = canAfford(selectedBet.value, mult, selectedRolls);
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

          {/* Number of Rolls */}
          <div className="w-full mt-2">
            <label className="label">
              <span className="label-text font-bold">
                Rolls{" "}
                <span className="font-normal opacity-60">
                  ({selectedRolls} × {selectedBet.label} ={" "}
                  {formatClawd(selectedBet.value * BigInt(selectedRolls))} CLAWD)
                </span>
              </span>
            </label>
            <div className="grid grid-cols-7 gap-1">
              {ROLL_OPTIONS.map(n => {
                const affordable = canAfford(selectedBet.value, selectedMultiplier, n);
                const hasBalance = clawdBalance !== undefined && clawdBalance >= selectedBet.value * BigInt(n);
                const enabled = affordable && hasBalance;
                return (
                  <button
                    key={n}
                    className={`btn btn-sm ${selectedRolls === n ? "btn-accent" : enabled ? "btn-outline" : "btn-disabled opacity-30"}`}
                    disabled={!enabled}
                    onClick={() => enabled && setSelectedRolls(n)}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Payout Info */}
          <div className="bg-base-200 rounded-lg p-3 w-full mt-3 text-sm">
            <div className="flex justify-between">
              <span className="opacity-70">Win chance per roll</span>
              <span className="font-bold">1 in {selectedMultiplier}</span>
            </div>
            {selectedRolls > 1 && (
              <div className="flex justify-between">
                <span className="opacity-70">Expected wins</span>
                <span className="font-bold">{(selectedRolls / selectedMultiplier).toFixed(1)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="opacity-70">Payout per win</span>
              <span className="font-bold text-success">
                {formatClawd(singlePayout)} CLAWD{" "}
                <span className="font-normal opacity-60">{formatUsd(singlePayout)}</span>
              </span>
            </div>
            {selectedRolls > 1 && (
              <div className="flex justify-between">
                <span className="opacity-70">Max payout (all win)</span>
                <span className="font-bold text-success">
                  {formatClawd(currentTotalPayout)} CLAWD{" "}
                  <span className="font-normal opacity-60">{formatUsd(currentTotalPayout)}</span>
                </span>
              </div>
            )}
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
                <span>
                  Need {formatClawd(totalBetAmount)} CLAWD ({selectedRolls} × {selectedBet.display})
                </span>
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
                  `ROLL ${selectedBet.label} @ ${selectedMultiplier}x${selectedRolls > 1 ? ` × ${selectedRolls}` : ""}`
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

      {/* Rolling Animation */}
      {activeBets.some(b => b.status === "waiting") && (
        <div
          ref={el => {
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          className="card bg-base-100 shadow-xl w-full max-w-md"
        >
          <div className="card-body items-center">
            <RollingAnimation
              multiplier={activeBets.find(b => b.status === "waiting")?.multiplier || 2}
              numRolls={activeBets.find(b => b.status === "waiting")?.numRolls || 1}
            />
          </div>
        </div>
      )}

      {/* Result Flash */}
      {lastResult && !activeBets.some(b => b.status === "waiting") && (
        <div
          className={`card shadow-xl w-full max-w-md border-2 ${
            lastResult.type === "won" ? "border-success bg-success/20" : "border-error/50 bg-error/10"
          }`}
        >
          <div className="card-body items-center text-center py-6">
            <div className="text-5xl mb-2">{lastResult.type === "won" ? "🎉" : "💀"}</div>
            <div className="text-2xl font-black">
              {lastResult.type === "won"
                ? lastResult.numRolls > 1
                  ? `${lastResult.wins}/${lastResult.numRolls} WINS!`
                  : "YOU WON!"
                : "REKT"}
            </div>
            <div className="text-sm opacity-70">
              {lastResult.betLabel} @ {lastResult.multiplier}x
              {lastResult.numRolls > 1 ? ` × ${lastResult.numRolls} rolls` : ""}
            </div>
          </div>
        </div>
      )}

      {/* Active Bets */}
      {activeBets.length > 0 && (
        <div className="card bg-base-100 shadow-xl w-full max-w-md">
          <div className="card-body">
            <div className="flex justify-between items-center">
              <h2 className="card-title text-lg">
                🎲 Your Active Bets
                {claimableBets.length > 0 && (
                  <span className="badge badge-success">{claimableBets.length} to claim</span>
                )}
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
                const grossPayout =
                  (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n * BigInt(bet.wins);
                const netPayout = grossPayout - grossPayout / 100n;
                const betLabel = BET_TIERS.find(t => t.value.toString() === bet.betAmount)?.label || "?";

                return (
                  <div
                    key={`${bet.betIndex}-${bet.commitBlock}`}
                    className={`p-3 rounded-lg ${bet.status === "resolved" && bet.wins > 0 ? "bg-success/15 border border-success/30" : "bg-base-200"}`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-bold">
                          {betLabel} @ {bet.multiplier}x
                          {bet.numRolls > 1 && <span className="opacity-60"> × {bet.numRolls}</span>}
                        </span>
                        {bet.status === "resolved" && bet.wins > 0 && (
                          <span className="text-success font-bold ml-2">
                            → {bet.wins}/{bet.numRolls} won → {formatClawd(netPayout)} CLAWD{" "}
                            <span className="font-normal opacity-60">{formatUsd(netPayout)}</span>
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        {bet.status === "waiting" && <span className="text-xs opacity-60">waiting for block...</span>}
                        {bet.status === "resolved" && bet.wins > 0 && (
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
                    {/* Roll results visualization */}
                    {bet.rollResults.length > 1 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {bet.rollResults.map((r, i) => (
                          <div
                            key={i}
                            className={`w-6 h-6 rounded text-xs flex items-center justify-center font-bold ${
                              r.won ? "bg-success text-success-content" : "bg-error/30 text-error"
                            }`}
                          >
                            {r.won ? "✓" : "✗"}
                          </div>
                        ))}
                      </div>
                    )}
                    {bet.status === "resolved" && bet.wins > 0 && blocksLeft < 50 && (
                      <div className="text-xs text-warning mt-1">
                        ⚠️ Claim soon! Only {blocksLeft} blocks remaining
                      </div>
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
                const grossPayout =
                  (BigInt(bet.betAmount) * BigInt(bet.multiplier) * 98n) / 100n * BigInt(bet.wins);
                const netPayout = grossPayout - grossPayout / 100n;
                return (
                  <div key={i} className="flex justify-between items-center text-sm p-1">
                    <span className="flex items-center gap-2">
                      {betLabel} @ {bet.multiplier}x
                      {bet.numRolls > 1 && <span className="opacity-50">×{bet.numRolls}</span>}
                      <TimeAgo timestamp={bet.timestamp} />
                    </span>
                    <span
                      className={
                        bet.status === "resolved" && bet.wins > 0
                          ? "text-success font-bold"
                          : bet.status === "claimed"
                            ? "text-success"
                            : bet.status === "expired"
                              ? "text-warning"
                              : "opacity-50"
                      }
                    >
                      {bet.status === "resolved" && bet.wins > 0
                        ? `🎉 ${bet.wins}/${bet.numRolls} Won ${formatClawd(netPayout)}`
                        : bet.status === "claimed"
                          ? `✅ Claimed ${formatClawd(netPayout)}`
                          : bet.status === "expired"
                            ? "⏰ Expired"
                            : `❌ ${bet.numRolls > 1 ? `0/${bet.numRolls}` : "Lost"}`}
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
                    {event.args.wins?.toString()}/{event.args.numRolls?.toString()} →{" "}
                    +{formatClawd(event.args.totalPayout)} 🦞{" "}
                    <span className="font-normal opacity-60">{formatUsd(event.args.totalPayout)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      <div className="flex flex-wrap justify-center gap-4 text-sm opacity-70 w-full max-w-md mt-4 bg-base-300/70 backdrop-blur-sm rounded-lg px-4 py-2">
        <span>Rolls {totalBets?.toString() || "0"}</span>
        <span>Wins {totalWins?.toString() || "0"}</span>
        <span>Paid {formatClawd(totalPaidOut)}</span>
        <span>🔥 Burned {formatClawd(totalBurned)}</span>
      </div>
    </div>
  );
};

export default Home;
