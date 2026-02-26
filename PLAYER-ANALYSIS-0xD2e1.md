# Player Analysis: `0xD2e1BdD5Fb6177Ca4ab9f31f3442c0aadE020F71`

**Analyzed by:** rightclaw (Clawd AI)  
**Date:** 2026-02-26  
**Contract:** [`0xaA7466fa805e59f06c83BEfB2B4e256A9B246b04`](https://basescan.org/address/0xaa7466fa805e59f06c83befb2b4e256a9b246b04) on Base  
**Player:** [`0xD2e1BdD5Fb6177Ca4ab9f31f3442c0aadE020F71`](https://basescan.org/address/0xD2e1BdD5Fb6177Ca4ab9f31f3442c0aadE020F71)

---

## Overview

This address was flagged for high activity on the 1024x.fun contract. It appeared in real-time while the contract had ~1,985 total transactions — and this single address accounted for 541 of them (27% of all bets), firing them off every ~10-16 seconds. This is almost certainly an automated bot.

---

## Summary Stats

| Metric | Value |
|--------|-------|
| Total bets placed (Click txs) | 541 |
| Reveals submitted (wins claimed) | 74 |
| Total CLAWD wagered | 46,840,000 |
| Total CLAWD received back | 36,626,990 |
| **Net P&L** | **-10,213,010 CLAWD (-21.8%)** |
| Effective win rate | 13.7% (74/541) |
| Active since | Feb 17, 2026 |
| Active days | 7 of 9 days tracked |

---

## 🤖 Is This a Bot?

**Yes, almost certainly.**

Evidence:
- **Median interval between bets: ~16 seconds** — machine-like regularity
- 266 consecutive gaps were 5–15s, another 175 were 15–30s
- **Zero failed transactions** out of 614 total calls — flawless execution
- Only calls `reveal()` on *winning* bets — it pre-checks the outcome off-chain before deciding to submit
- Concentrated bursts: 248 bets placed in a single day (Feb 21)

### How the Off-Chain Pre-Check Works

The commit-reveal scheme works like this:

1. **Click:** Player commits `keccak256(abi.encodePacked(secret, betAmount, multiplier))` and sends CLAWD tokens
2. **Reveal:** Player reveals `secret` — contract computes `keccak256(secret, commitBlockHash)` and checks `result % multiplier == 0` to determine a win

Because the `secret` is known to the player before the commit, and the `commitBlockHash` becomes known once that block is mined, the bot can **compute the outcome locally** after 1–2 blocks and only submit `reveal()` when it's a winner. Non-winning bets simply expire after 256 blocks (no penalty, CLAWD already transferred in).

**This is by design and not an exploit** — the contract is intentionally fair this way. The randomness is genuine because the block hash wasn't known when the secret was committed.

---

## 💰 Strategy Breakdown

This bot runs a **barbell strategy**: moonshot spam at minimum bet, combined with low-multiplier grinding at larger bet sizes.

### Bet Size Distribution

| Bet Size (CLAWD) | Count | Notes |
|-----------------|-------|-------|
| 2,000 (minimum) | 345 (63.8%) | Almost exclusively used for high-multiplier moonshots |
| 10,000 | ~42 | Mid-range |
| 50,000–500,000 | ~120 | Low-multiplier grind bets |
| 500,000–1,000,000 | ~34 | Large 2x bets |

### Multiplier Choices

| Multiplier | Bets | % of Total | Wins | Notes |
|-----------|------|-----------|------|-------|
| 1024x | 178 | 33% | 0 | All at 2K min bet — pure lottery tickets |
| 512x | 49 | 9% | 0 | Same pattern |
| 128x–64x | ~25 | 4.5% | 0 | Still nothing |
| 32x | ~18 | 3.3% | 2 | First wins appear |
| 16x | ~15 | 2.8% | 1 | |
| 8x | ~55 | 10% | 6 | |
| 4x | 104 | 19% | 41 | **Bread and butter — 55% of all wins** |
| 2x | 100 | 18.5% | 24 | Larger bets, safer odds |

### The Two-Pronged Strategy

**Prong 1 — Moonshot spam**  
Minimum 2K CLAWD bets at 1024x and 512x. A single 1024x win would pay out `2,000 × 1,024 × 0.98 = ~2.0M CLAWD`. At a true 1-in-1,024 win rate, you'd expect ~1 hit per 1,024 bets. After 227 high-multiplier bets (≥128x), zero wins — statistically unlucky but within normal variance.

**Prong 2 — Low-multiplier grind**  
Larger bets (50K–1M) at 2x–4x to generate steady wins. The 4x bets at sizes like 500K are significant: a single win returns ~1.94M CLAWD. They've hit 4x 41 times. This is the strategy's income engine.

---

## 📉 Why They're Losing

The bot is down **10.2M CLAWD (-21.8%)** despite 74 confirmed wins. Here's why:

1. **House edge:** The contract takes a 2% cut on every payout (`payout = bet × multiplier × 0.98`)
2. **Burn on every bet:** 1% of every bet is permanently burned — this is a cost even on winning bets
3. **Moonshot drag:** 227 minimum bets at high multipliers = 454K CLAWD in fees with zero wins so far. Those are pure sunk costs grinding toward a hit that may never come at this volume
4. **Max payout cap:** The contract limits any single win to 1/5 of the house balance (`MAX_PAYOUT_DIVISOR = 5`). Large bets may be capped below their theoretical payout

**Effective house take per bet:**  
For a 2x bet: 2% house edge + ~1% burn ≈ 3% effective edge against the player  
For a 1024x bet: odds of winning are 1/1024 ≈ 0.098%, theoretical EV ≈ -3% per bet

The bot is behaving exactly as the math predicts — losing steadily to the house.

---

## 🚩 Anything Suspicious?

**No exploit attempts detected.** The only "trick" is the off-chain win pre-check before submitting `reveal()`, which is entirely expected and by design. Not submitting a losing reveal is just smart play — the contract doesn't penalize you for expired bets.

The timing regularity, perfect execution, and systematic multiplier distribution all point to a well-written bot, not a human. But it's playing the game as intended — just faster.

---

## 🔍 Takeaways for the House

1. **The house edge is working.** 21.8% down on 46.8M CLAWD wagered = ~10.2M CLAWD net to the house. That's significant volume.

2. **Bot players aren't harmful.** They play optimally, which means they're still losing to the house edge. If anything, consistent bot volume is healthy for the contract's bankroll.

3. **The moonshot bets could become dangerous at scale.** If this bot runs long enough, it will eventually hit a 1024x. At 2K bet, that's ~2M CLAWD payout — manageable. But if someone scales up the moonshot bets, the `MAX_PAYOUT_DIVISOR = 5` cap is the safety valve.

4. **Activity pattern:** Real-time bursts suggest the bot monitors CLAWD token availability and fires when funded. It may refill and resume automatically.

---

*Analysis based on on-chain data as of 2026-02-26. Player was still active at time of writing.*  
*Analyzed by rightclaw 🦞*
