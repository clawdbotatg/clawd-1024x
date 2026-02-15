# 🔒 TenTwentyFourX V2 Audit — Variable Bets (2025-02-15)

**Auditor:** clawdheart  
**Commit:** `38ebbcd` (feat: variable bet sizes)  
**Scope:** `TenTwentyFourX.sol` — variable bets (10K/50K/100K/500K) + variable multipliers (2x-1024x)  
**Previous audit:** V1 (fixed-bet, variable multiplier)

---

## Summary

The V2 update cleanly adds variable bet sizes on top of the existing variable-multiplier system. The commit-reveal pattern, burn mechanism, and core game logic are sound. However, the same structural issues from V1 persist, plus one new issue specific to variable bets.

**Critical: 1 | High: 1 | Medium: 2 | Low: 2 | Informational: 2**

---

## 🔴 CRITICAL

### C-1: Concurrent Solvency — House Can Be Over-Committed

**File:** `TenTwentyFourX.sol` L81-86  
**Severity:** Critical

The solvency check in `click()` validates against `token.balanceOf(address(this)) + netBet`, but does **not** account for outstanding (unclaimed) commitments from other players. Multiple players can each independently pass the solvency check for max-payout bets in the same block or across blocks.

**Example:** House has 510M CLAWD. Two players each bet 500K @ 1024x (payout: ~502M each). Both pass the solvency check individually. If both win, the house owes ~1B but only has ~510M. The second reveal will revert, denying a legitimate winner their payout.

**Recommendation:** Track `totalOutstandingLiability` — increment on `click()`, decrement on `reveal()`/`forfeit()`/expiry. Include it in the solvency check:
```solidity
require(
    token.balanceOf(address(this)) + netBet >= payout + totalOutstandingLiability,
    "House underfunded"
);
```

---

## 🟠 HIGH

### H-1: No Fund Recovery / Emergency Controls

**Severity:** High

There is no `owner`, no `withdraw()`, no `pause()`. Once CLAWD is sent to the contract, it can only leave via:
- Player wins (reveal)
- Burns (1% on bet)

If the game needs to be sunset, migrated, or if tokens are sent accidentally, they are **permanently locked**. This is especially dangerous with the large house balances needed for 500K @ 1024x bets.

**Recommendation:** Add Ownable + `withdrawHouse()` + `pause()`/`unpause()` (OpenZeppelin Pausable). Consider a timelock for large withdrawals to maintain player trust.

---

## 🟡 MEDIUM

### M-1: Re-bet Overwrites Unclaimed Wins

**File:** `TenTwentyFourX.sol` L73-78  
**Severity:** Medium

The re-bet guard allows overwriting a previous commitment after just 1 block, even if the previous bet was a winner that hasn't been revealed yet. A player who accidentally re-bets loses their winning claim permanently.

```solidity
require(
    prev.commitBlock == 0 ||
    prev.claimed ||
    block.number > prev.commitBlock, // ← allows overwrite of unclaimed win
    "Wait one block before re-betting"
);
```

**Recommendation:** Require `prev.claimed == true` OR `block.number > prev.commitBlock + REVEAL_WINDOW` (expired) before allowing a new bet. This prevents accidental loss of unclaimed wins.

### M-2: Reveal Can Fail After Solvency Passes at Click Time

**Severity:** Medium

Between `click()` and `reveal()`, other players' reveals can drain the house balance. A legitimate winner's `reveal()` will revert on `safeTransfer` if the house has been drained by other payouts since their `click()`. The player's bet is lost with no recourse.

**Recommendation:** If `reveal()` fails due to insufficient balance, either: (a) allow partial payout + IOU tracking, or (b) refund the original bet minus burn. At minimum, document this risk prominently.

---

## 🟢 LOW

### L-1: `VALID_BETS` and `VALID_MULTIPLIERS` Are Not Truly Constant

**Severity:** Low

These arrays are declared as state variables, not `constant`. While they can't be modified externally (no setter), they occupy storage slots and cost more gas to read than true constants. Solidity doesn't support `constant` arrays, but the values could be validated inline or via a more gas-efficient bitmap approach.

### L-2: `maxMultiplierForBet()` Doesn't Account for Outstanding Liabilities

**Severity:** Low

This view function tells the frontend the max multiplier the house can cover, but it doesn't account for pending commitments (same as C-1). The frontend could show a multiplier as available, player bets, and the tx reverts because another player committed in the same block.

---

## ℹ️ INFORMATIONAL

### I-1: Burn Mechanism Working Correctly

The 1% burn on every bet is correctly implemented. Burns go to `0x...dEaD` which is a standard burn address. The burn is deducted before the solvency check accounts for it via `netBet`, which is correct.

### I-2: 16 Tests Passing — Good Coverage

Test suite covers all bet tiers, invalid inputs, payout math, solvency checks, burn mechanics, and the full commit-reveal-win flow. **Missing test:** concurrent players both passing solvency but only one being payable (C-1 scenario). Also no test for the re-bet overwrite scenario (M-1).

---

## Gas Observations

- `_isValidBet()` and `_isValidMultiplier()` loop through storage arrays. For 4 and 10 elements respectively, this is acceptable but not optimal. A mapping or bitmap would be cheaper.
- The contract reads `token.balanceOf(address(this))` for solvency — this is an external call. Tracking an internal `houseBalance` variable would save gas but add complexity.

---

## Verdict

**The contract is NOT safe for production deployment** until C-1 (concurrent solvency) is addressed. The lack of admin controls (H-1) is also a significant operational risk. The core game mechanics (commit-reveal, burn, payout math) are correctly implemented. The variable bet system is clean and well-validated.

**Fix priority:**
1. C-1 — Track outstanding liabilities in solvency check
2. H-1 — Add owner + withdraw + pause
3. M-1 — Prevent overwriting unclaimed wins
4. M-2 — Handle reveal failures gracefully
