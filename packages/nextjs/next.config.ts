import type { NextConfig } from "next";

// Polyfill localStorage for Node 25+ SSR
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.getItem !== "function") {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      Object.keys(store).forEach(k => delete store[k]);
    },
    get length() {
      return Object.keys(store).length;
    },
    key(i: number) {
      return Object.keys(store)[i] ?? null;
    },
  } as Storage;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  webpack: (config, { isServer }) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // Fix @noble/hashes version conflict — @wagmi/connectors bundles @noble/curves
    // that expects 'anumber' from @noble/hashes >=1.5, but webpack may resolve an older version
    if (!isServer) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("path");

      const nobleHashesPath = path.dirname(require.resolve("@noble/hashes/utils"));
      config.resolve.alias = {
        ...config.resolve.alias,
        "@noble/hashes": nobleHashesPath,
      };
    }
    return config;
  },
};

const isIpfs = process.env.NEXT_PUBLIC_IPFS_BUILD === "true";

if (isIpfs) {
  nextConfig.output = "export";
  nextConfig.trailingSlash = true;
  nextConfig.assetPrefix = "./";
  nextConfig.images = {
    unoptimized: true,
  };
}

module.exports = nextConfig;
