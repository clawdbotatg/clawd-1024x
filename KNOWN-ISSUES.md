# Known Issues — TenTwentyFourX

Pre-production security review against [ethskills.com/security](https://ethskills.com/security/SKILL.md) checklist.

**Contract:** `0xaA7466fa805e59f06c83BEfB2B4e256A9B246b04` (Base)

## Passed Checks

- ✅ Access control — all admin functions are `onlyOwner`
- ✅ Reentrancy — `nonReentrant` + CEI pattern
- ✅ Token decimals — single token (CLAWD, 18 decimals), hardcoded correctly
- ✅ No oracles — commit-reveal + blockhash (safe on L2)
- ✅ Integer math — multiply before divide everywhere
- ✅ SafeERC20 — all token operations
- ✅ Input validation — zero hash, valid bets/multipliers, payout cap, reveal checks
- ✅ Events — emitted on all state changes
- ✅ No infinite approvals — frontend approves 10x bet size, not max uint
- ✅ Immutable — no proxy, no upgradeability
- ✅ MEV safe — L2 sequencer + commit-reveal prevents frontrunning

## Issues

### 1. Withdrawal drains pending winners (MEDIUM)

`executeWithdraw()` transfers `token.balanceOf(address(this))` — the entire balance, including tokens owed to pending winners who haven't claimed yet. There's no accounting for outstanding liabilities.

**Scenario:** User wins → owner starts withdrawal → owner executes after 15min → user tries to claim → reverts (insufficient balance).

**Mitigation:** Game pauses immediately on `requestWithdraw`, winners can still claim during the 15-min delay. Owner is a trusted party (us). Disclaimer covers insolvency risk.

### 2. Withdrawal timelock is short (LOW-MEDIUM)

`WITHDRAW_DELAY = 15 minutes`. This is enough for attentive users but many won't notice. Active bets have a 256-block (~8.5 min on Base) reveal window, so a bet placed just before a withdrawal request could still be within its claim window when the withdrawal executes.

**Mitigation:** Same as above — pause is immediate and visible in the UI. Owner is trusted.

### 3. Unbounded playerBets array (LOW)

`playerBets[msg.sender]` grows forever. Old bets (claimed/expired) are never cleaned up. After thousands of bets from one address, the array grows but no functions iterate it on-chain, so gas impact is minimal. `getBet()` is O(1) by index.

**Mitigation:** No on-chain iteration over the array. Frontend manages its own state via localStorage. Not exploitable, just storage bloat over time.

### 4. batchReveal allows duplicate indices (LOW)

A user could pass the same `betIndex` twice in `batchReveal`. The second attempt reverts with "Already claimed", which reverts the entire batch. No funds at risk.

**Mitigation:** Frontend prevents this. On-chain, the revert is a safe failure mode.

## Simultaneous Win Risk

The max payout check (`payout <= houseBalance / 5`) is enforced at bet time, not reveal time. If 5 players all win max payouts simultaneously, total claims could equal 100% of the house. The house balance could also decrease between bet placement and reveal from other claims.

**Mitigation:** Disclaimer covers this. At current volume, the probability is negligible.

---

*Reviewed 2026-02-21 by ClawdHeart against ethskills.com security checklist.*
*Contract is unaudited by humans. Use at your own risk.*
