# TenTwentyFourX v3 — Security Audit Report

**Auditor:** rightclaw (Opus 4.6)  
**Date:** 2026-02-16  
**Contract:** `packages/foundry/contracts/TenTwentyFourX.sol`  
**Solidity:** ^0.8.20  
**Dependencies:** OpenZeppelin (IERC20, SafeERC20, ReentrancyGuard)

---

## Summary

TenTwentyFourX is a commit-reveal betting game using CLAWD tokens. Players commit a hash, place a bet with a chosen multiplier (2x–1024x), and reveal after 1 block to check if they won. The v3 change caps max payout at 1/5 of house balance.

**Overall Assessment: LOW-MEDIUM RISK** — Well-structured contract with good safety patterns. A few informational and low-severity findings below.

---

## Findings

### [MEDIUM] M-1: Max payout check uses pre-transfer balance

**Location:** `click()`, lines checking `token.balanceOf(address(this))`

The max payout check reads the house balance *before* the player's bet is transferred in. This means the check is slightly more restrictive than intended (by the bet amount). However, this is **conservative** and not exploitable — it's actually safer. Just note that the effective cap is `(balance_before) / 5`, not `(balance_before + betAmount) / 5`.

**Severity:** Medium (design intent mismatch, but safe direction)  
**Recommendation:** Document this behavior or move the check after the transfer if you want the bet to count toward the house balance for the cap.

---

### [LOW] L-1: Burn reduces house balance but payout check was already passed

After the payout check passes, 1% of the bet is burned (sent to dead address), reducing the contract's balance. If many bets are placed in the same block, each successive bet sees a slightly lower house balance. This is negligible in practice but worth noting.

**Severity:** Low  
**Recommendation:** Acceptable as-is.

---

### [LOW] L-2: No expiry/cleanup for unclaimed bets

Lost bets (those past 256 blocks or non-winners) remain in the `playerBets` array forever. The array grows unboundedly per player. This increases gas costs for `playerBets` length lookups over time but is not a vulnerability.

**Severity:** Low (gas inefficiency, not exploitable)  
**Recommendation:** Consider adding a cleanup function or off-chain indexing note.

---

### [LOW] L-3: `executeWithdraw` doesn't unpause

After `executeWithdraw`, the contract remains paused and `paused = true` persists. The owner must call `unpause()` separately, but `unpause()` requires `withdrawRequestedAt == 0` which is satisfied. This is fine but could confuse operators.

**Severity:** Low  
**Recommendation:** Document the two-step process, or auto-unpause after withdrawal if desired.

---

### [INFO] I-1: Block hash randomness is miner-influenceable

The win condition uses `blockhash(commitBlock)` combined with the player's secret. A block proposer (on PoS) could theoretically influence the blockhash, but:
- The player commits their secret *before* the block is mined
- The secret is unknown to the proposer
- Economically infeasible for the bet sizes involved

**Severity:** Informational (known limitation, acceptable for this use case)

---

### [INFO] I-2: `VALID_BETS` and `VALID_MULTIPLIERS` are not truly constant

These are declared as state variables (storage arrays), not `constant`. They're initialized in-place and never modified (no setter exists), so they're effectively immutable. However, they cost SLOAD gas on each access.

**Severity:** Informational (gas optimization opportunity)  
**Recommendation:** Could use an internal pure function returning the values, but gas difference is minimal.

---

### [INFO] I-3: No event emitted on `unpause()`

`unpause()` emits `Paused(false)` — this is correct. No issue here. ✅

---

## Positive Findings (What's Done Well)

| Pattern | Status |
|---------|--------|
| ReentrancyGuard on all state-changing externals | ✅ |
| SafeERC20 for all token transfers | ✅ |
| Two-step ownership transfer (propose/accept) | ✅ |
| 15-minute withdrawal delay with pause | ✅ |
| Commit-reveal with blockhash entropy | ✅ |
| 1% burn is deflationary and correctly implemented | ✅ |
| Batch reveal capped at 20 to prevent gas griefing | ✅ |
| No selfdestruct, no delegatecall | ✅ |
| MAX_PAYOUT_DIVISOR = 5 limits house risk per bet | ✅ |

---

## v3 Change Assessment: MAX_PAYOUT_DIVISOR

The key v3 change (`payout <= currentBalance / MAX_PAYOUT_DIVISOR`) is a **significant improvement**. Previously, the house only needed enough to cover a single payout; now it must have 5x the payout, meaning:

- At 1024x multiplier with 500K bet: payout = ~502M CLAWD, requires ~2.5B CLAWD in house
- This dramatically reduces insolvency risk from concurrent wins
- The divisor is a constant (not owner-adjustable), which is both safer and less flexible

**Verdict:** Good change. Conservative and appropriate for the risk profile.

---

## Conclusion

The contract is well-written and follows Solidity best practices. No critical or high-severity issues found. The v3 max payout cap is a solid improvement. The medium finding (M-1) is a design consideration rather than a vulnerability. **Recommend proceeding with deployment** after reviewing M-1 design intent.

---

*Audit by rightclaw | 16 tests passing confirmed by leftclaw*
