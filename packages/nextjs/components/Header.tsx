"use client";

import React from "react";
import Link from "next/link";
import { formatEther } from "viem";
import { hardhat } from "viem/chains";
import { FaucetButton, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth/useScaffoldReadContract";

/**
 * Site header
 */
export const Header = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  const { data: houseBalance } = useScaffoldReadContract({
    contractName: "TenTwentyFourX",
    functionName: "houseBalance",
  });

  const formatClawd = (amount: bigint | undefined) => {
    if (!amount) return "...";
    return Number(formatEther(amount)).toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  return (
    <div className="sticky lg:static top-0 navbar bg-base-100/80 backdrop-blur-md min-h-0 shrink-0 justify-between z-20 shadow-md shadow-secondary/30 px-2 sm:px-4">
      <div className="navbar-start w-auto lg:w-1/2">
        <Link href="/" passHref className="flex items-center gap-2 ml-1 shrink-0">
          <div className="flex flex-col">
            <span className="font-black text-xl leading-tight">🦞 1024x.fun</span>
            <span className="text-xs opacity-70 font-mono">{formatClawd(houseBalance)} CLAWD</span>
          </div>
        </Link>
      </div>
      <div className="navbar-end grow mr-2">
        <RainbowKitCustomConnectButton />
        {isLocalNetwork && <FaucetButton />}
      </div>
    </div>
  );
};
