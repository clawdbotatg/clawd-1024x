"use client";

import React, { useEffect, useState } from "react";
import { Address } from "@scaffold-ui/components";

const CONTRACT_ADDRESS = "0xaA7466fa805e59f06c83BEfB2B4e256A9B246b04";

/**
 * Site footer
 */
export const Footer = () => {
  const [clawdPrice, setClawdPrice] = useState<number>(0);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch(
          "https://api.dexscreener.com/latest/dex/tokens/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07",
        );
        const data = await res.json();
        const pair = data?.pairs?.[0];
        if (pair?.priceUsd) setClawdPrice(parseFloat(pair.priceUsd));
      } catch {}
    };
    fetchPrice();
    const interval = setInterval(fetchPrice, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-0 py-5 px-1 mb-11 lg:mb-0">
      <div className="fixed flex justify-between items-center w-full z-10 p-4 bottom-0 left-0 pointer-events-none">
        <div className="pointer-events-auto">
          {clawdPrice > 0 && (
            <div className="btn btn-primary btn-sm font-normal gap-1 cursor-auto">
              <span>🦞</span>
              <span>${clawdPrice.toFixed(6)}</span>
            </div>
          )}
        </div>
      </div>
      <div className="w-full">
        <div className="flex flex-col items-center gap-2 text-sm py-4 bg-base-300/70 backdrop-blur-sm rounded-lg px-4 mx-auto max-w-md">
          <div className="flex items-center gap-2">
            <span className="opacity-50">Contract:</span>
            <Address address={CONTRACT_ADDRESS} />
          </div>
          <a
            href="https://github.com/clawdbotatg/clawd-1024x"
            target="_blank"
            rel="noreferrer"
            className="link opacity-50 hover:opacity-100"
          >
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
};
