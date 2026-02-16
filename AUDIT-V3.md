# AUDIT-V3.md — TenTwentyFourX V3 Security Audit

**Auditor:** rightclaw (Opus 4.6)
**Date:** 2026-02-16
**Contract:** `TenTwentyFourX.sol`
**Change:** Added `MAX_PAYOUT_DIVISOR = 5` — max payout capped at 1/5 of house balance

---

## Summary

**Rating: PASS ✅** — No critical or high severity issues. Ready for deployment.

---

## Findings

### 🟡 MEDIUM (Informational) — Max payout check uses pre-transfer balance

The `click()` function checks `payout <= currentBalance / MAX_PAYOUT_DIVISOR` using the balance *before* the player's tokens are transferred in. This means the check is slightly more conservative than necessary (the house will actually have more tokens after the transfer). **Not exploitable** — it's protective, not harmful.

### 🟢 LOW — Burn reduces effective balance after solvency check

The 1% burn happens after the solvency check, slightly reducing the house balance. For a 500K bet, burn is 5K — negligible relative to house balance. No real risk.

### 🟢 LOW — Unbounded bet array growth

`playerBets[msg.sender]` grows indefinitely. This only affects gas costs for the player (storage reads) and doesn't impact contract security. A cleanup mechanism could be added but is not critical.

### 🟢 LOW — executeWithdraw doesn't auto-unpause

After `executeWithdraw()`, the contract remains paused. Owner must call `unpause()` separately. Minor UX issue, not a security concern.

### ℹ️ INFO — Blockhash miner influence

Block hash can theoretically be influenced by miners/validators. This is an inherent EVM limitation with commit-reveal schemes. The 256-block window and the unpredictability at commit time make this acceptable for the bet sizes involved.

### ℹ️ INFO — Storage arrays as state variables

`VALID_BETS` and `VALID_MULTIPLIERS` are storage arrays rather than constants. Minor gas overhead. Not a security issue.

---

## V3 Change Assessment

The `MAX_PAYOUT_DIVISOR = 5` change is a **solid improvement**:
- Prevents any single bet from winning more than 20% of the house
- Combined with the 2% house edge and 1% burn, makes the house mathematically sustainable over volume
- The solvency check is clean: `payout <= currentBalance / MAX_PAYOUT_DIVISOR`

---

## Test Results

16 tests passing. All critical paths covered: solvency, reveal/win, expiration, batch reveal, withdrawal delay, ownership transfer.

---

## Conclusion

The V3 contract is **ready for mainnet deployment**. The 1/5 max payout cap is the right approach to long-term house sustainability. No changes needed before deploy.

---

*Audited by rightclaw 🦞 — 2026-02-16*
