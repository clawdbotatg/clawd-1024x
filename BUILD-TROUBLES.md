# Lucky Click — Build Troubles Log
*Running doc of issues hit during development. Feed back into ethskills improvements.*

## 1. `usePublicClient()` returns wrong chain (hardhat instead of Base)
- **Symptom:** Win/loss check silently fails — app stuck on "Checking your luck..." forever
- **Root cause:** `usePublicClient()` without args returns the default chain client (hardhat/31337), not the target network (Base/8453)
- **Fix:** `usePublicClient({ chainId: targetNetwork.id })`
- **Ethskills gap:** Frontend skills should warn about this. When using `usePublicClient` outside of scaffold hooks, you MUST pass `chainId`. The scaffold hooks handle this internally but raw viem calls don't.

## 2. localStorage SSR crash on Node 25
- **Symptom:** `TypeError: localStorage.getItem is not a function` → server returns 500
- **Root cause:** Node 25 has `localStorage` as an object but `getItem` is NOT a function. Code that uses `localStorage.getItem()` crashes on SSR.
- **Fix:** Need polyfill in next.config.ts (known issue, documented in MEMORY.md)
- **Ethskills gap:** Should be in the frontend-playbook as a "Node 25 gotcha" — check `typeof globalThis.localStorage?.getItem === 'function'` before using

## 3. Stale localStorage causes wrong game state on reload
- **Symptom:** Page loads, reads old pending bet from localStorage, immediately shows "Bet Expired" even for fresh bets
- **Root cause:** `loadPending` from localStorage blindly trusted stored data without validating against on-chain state
- **Fix:** Cross-reference localStorage commitBlock with contract's `getBet()` data before restoring state
- **Ethskills gap:** Commit-reveal pattern skill should warn: "Always validate localStorage state against contract state on page load. Stale browser data WILL happen."

## 4. `react-remove-scroll-bar` missing from SE2 deps
- **Symptom:** Console errors about missing module, imported by rainbowkit
- **Fix:** `yarn add react-remove-scroll-bar` in nextjs package
- **Ethskills gap:** Might be an SE2 upstream issue — dependency not properly declared

## 5. Hardhat RPC polling spam in production
- **Symptom:** Hundreds of `ERR_CONNECTION_REFUSED` errors to `127.0.0.1:8545` every few seconds
- **Root cause:** SE2 wagmi config still includes hardhat/localhost chain even when `targetNetworks` is only Base. Components like Faucet.tsx poll the local RPC.
- **Ethskills gap:** Production checklist should include "remove hardhat chain from wagmi config" or "disable Faucet component when not targeting localhost"

## 6. Contract has "Active bet exists" guard — can't re-bet until expired
- **Symptom:** After losing localStorage data for a bet, you're locked out for 256 blocks (~8.5 min on Base)
- **Root cause:** Contract requires previous bet to be claimed or expired before placing new one. If frontend loses the secret, you just have to wait.
- **Not a bug** — correct behavior. But UX could show "You have an active bet expiring in X blocks" instead of silently failing.

## 7. `savePending` runs AFTER readContract — silent failure loses secret
- **Symptom:** Bet #3 tx confirmed on-chain (10K CLAWD deducted, house increased), but frontend shows "Bet Expired" immediately. localStorage has no pending data.
- **Root cause:** `handleClick` called `publicClient.readContract(getBet)` AFTER `clickWrite` but BEFORE `savePending`. The readContract call failed silently (viem CCIP chunk loading error + dev server instability), falling into the catch block which set `gameState="idle"` without saving the secret.
- **Fix:** Get commitBlock from `waitForTransactionReceipt` (already confirmed by SE2's useTransactor), then call `savePending` immediately — no readContract needed.
- **Ethskills gap:** Commit-reveal skill MUST warn: "Save the secret to localStorage IMMEDIATELY after the tx is confirmed, before any other async operation. The secret is the single most important piece of client state — losing it means losing the bet."

## 8. `loadPending` useEffect races with `betData` scaffold hook
- **Symptom:** Even when `savePending` works correctly, the `loadPending` useEffect fires with stale `betData` (from previous bet) and incorrectly clears the fresh localStorage data.
- **Root cause:** Effect depended on `[connectedAddress, betData]`. When handleClick saved new data and triggered re-render, betData hadn't refreshed yet (still showed old bet). The validation `pending.commitBlock !== contractBlock` was true (new vs old), so it cleared localStorage.
- **Fix:** Remove `betData` from the dependency array. Only restore from localStorage on `[connectedAddress]` change. Let `checkResult` handle expired/stale detection.
- **Ethskills gap:** React effect ordering with scaffold read hooks is a footgun. Scaffold hooks re-poll asynchronously — you CANNOT depend on them being up-to-date in the same render cycle as a write. This should be in the frontend-playbook.

---
*Last updated: 2026-02-15*
