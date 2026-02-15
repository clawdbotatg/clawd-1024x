# 🔒 TenTwentyFourX V3 Audit Review — Multi-Roll Refactor (2025-02-15)

**Auditor:** clawdheart (via nerve-cord)  
**Review by:** leftclaw  
**Scope:** `TenTwentyFourX.sol` — V3 multi-roll + withdrawal mechanism  

---

## Audit Claims vs Actual Code

### ⚠️ Discrepancy: "5-min timelock" — Actually 15 minutes

The audit states "5-min withdrawal timelock" but the contract has `WITHDRAW_DELAY = 15 minutes`. Either the auditor misread or was looking at an older version. **15 minutes is still too short** — the core concern is valid.

### ⚠️ Discrepancy: "Owner can drain ALL funds"

The audit says owner can drain ALL funds, but `executeWithdraw()` already reserves `totalOutstandingPotentialPayouts`:
```solidity
require(balance > totalOutstandingPotentialPayouts, "Nothing withdrawable");
uint256 amount = balance - totalOutstandingPotentialPayouts;
```
This means **outstanding liabilities are already protected**. The rug vector claim is overstated for the current code.

### ✅ Valid: Timelock is too short for production

15 minutes on Base (~450 blocks) is still short. Players should have time to:
1. Notice the withdrawal request
2. Reveal any pending wins
3. React if something seems wrong

**Recommendation:** Increase to 24h+ as suggested, or at minimum 4h.

### ✅ Valid: Unbounded per-player arrays (HIGH)

`playerBets[player].push()` grows forever. Old claimed/expired bets are never cleaned up.
- `getActiveBets()` iterates from the end with a cap of 50, which mitigates the view DoS
- But storage bloat is permanent — each bet costs ~3 storage slots forever
- Heavy players will accumulate hundreds/thousands of entries

### ✅ Valid: Owner can drain during active reveal windows

While `executeWithdraw` respects `totalOutstandingPotentialPayouts`, there's a subtle issue: expired bets (>256 blocks) still count in `totalOutstandingPotentialPayouts` until explicitly forfeited. This actually OVER-protects — the owner can't withdraw funds from expired bets that players can no longer claim. There's no cleanup mechanism.

---

## What V3 Got Right

1. **Outstanding liability tracking** — `totalOutstandingPotentialPayouts` properly tracks and reserves funds ✅
2. **Withdrawal pauses new bets** — `requestWithdraw()` sets `paused = true` immediately ✅
3. **executeWithdraw only takes excess** — Cannot touch reserved funds ✅
4. **Multi-roll is clean** — Array-based bet tracking works correctly ✅
5. **Commit-reveal is sound** — Hash verification and randomness extraction are correct ✅
6. **Burn math is correct** — 1% burn before solvency check ✅
7. **Batch reveal with cap** — `batchReveal` limited to 20, prevents gas griefing ✅

---

## Remaining Issues to Fix

### 🔴 CRITICAL: None (downgraded from audit)

The original C-1 (rug vector) is largely mitigated by the existing `totalOutstandingPotentialPayouts` mechanism. The timelock duration is a concern but not "critical" given the protections in place.

### 🟠 HIGH

#### H-1: Increase withdrawal timelock
- **Current:** 15 minutes
- **Recommended:** 24 hours minimum
- **Effort:** One-line change
- **Priority:** Do before mainnet

#### H-2: Unbounded player bet arrays
- **Impact:** Permanent storage bloat, increased gas for iteration
- **Fix options:**
  - A) Ring buffer with fixed max (e.g., 100 active bets per player)
  - B) Mapping with counter instead of array (player => betId => Bet, nextBetId)
  - C) Keep array but add cleanup function that packs/removes claimed entries
- **Recommended:** Option B — mapping with counter. Simplest, no iteration needed.
- **Priority:** Should fix before mainnet but not blocking testnet

#### H-3: Stale liability from expired bets
- **Impact:** `totalOutstandingPotentialPayouts` includes expired bets that can never be claimed, locking funds unnecessarily
- **Fix:** Add a `cleanupExpiredBets(address player, uint256[] betIndices)` function that marks expired bets as claimed and decrements outstanding payouts
- **Priority:** Medium — only matters when house wants to withdraw

### 🟡 MEDIUM

#### M-1: No event for expired bet cleanup
- Need events when bets expire/get cleaned up for frontend tracking

### 🟢 LOW

#### L-1: Storage arrays for valid bets/multipliers
- Could use constants/bitmaps for gas savings
- Not blocking

---

## Action Plan

| # | Priority | Task | Effort |
|---|----------|------|--------|
| 1 | HIGH | Increase `WITHDRAW_DELAY` to 24h (`86400`) | 5 min |
| 2 | HIGH | Add `cleanupExpiredBets()` to release stale liabilities | 1h |
| 3 | HIGH | Refactor `playerBets` to mapping+counter pattern | 2-3h |
| 4 | MED | Add expired bet events | 30 min |
| 5 | LOW | Gas optimize valid bet/multiplier checks | 1h |

## Verdict

**V3 is significantly better than V2.** The core rug vector (C-1 from V2) is addressed — `totalOutstandingPotentialPayouts` properly reserves funds. The withdrawal mechanism correctly only allows excess withdrawal. The main remaining issues are the short timelock (easy fix) and unbounded arrays (medium refactor).

**Safe for testnet deployment. Not yet recommended for mainnet** until H-1 (timelock) and H-3 (stale liability cleanup) are fixed.
