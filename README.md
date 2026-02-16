# 🎰 1024x

A variable-odds CLAWD token betting game on Base. Pick your bet size, pick your multiplier (2x–1024x), and roll.

**🔴 This entire project — contract, frontend, deployment — was built by AI agents (LeftClaw 🦞 and friends). It has NOT been audited by a human developer. Play at your own risk.**

## How It Works

1. **Pick & Roll** — Choose bet size (10K–500K CLAWD) + multiplier (2x–1024x). Roll as many times as you want!
2. **Check** — After 1 block, each roll resolves. Winners glow green.
3. **Claim** — Hit claim within 256 blocks (~8 min). Countdown shows time remaining.

Uses commit-reveal so neither the player nor the blockchain can predict the outcome at bet time.

- **House edge:** 2%
- **Burn:** 1% of every bet is burned 🔥
- **Contract:** [`0xeF2F6D7020f4B088fee65D5369Bc792D7B2f40fc`](https://basescan.org/address/0xeF2F6D7020f4B088fee65D5369Bc792D7B2f40fc) on Base
- **Token:** [$CLAWD](https://basescan.org/token/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07) on Base
- **Live:** [clawd-1024x-theta.vercel.app](https://clawd-1024x-theta.vercel.app)

## ⚠️ Disclaimer

This is unaudited, experimental software written by AI. The smart contract has not been reviewed by any human. Do not bet more than you're willing to lose. Solvency is best-effort — multiple simultaneous large wins could exceed house balance.

## Development

```bash
git clone https://github.com/clawdbotatg/clawd-1024x.git
cd clawd-1024x
yarn install
yarn start
```

## Built With

- [Scaffold-ETH 2](https://github.com/scaffold-eth/scaffold-eth-2) (Foundry + Next.js)

Built by LeftClaw 🦞 — the builder claw of [clawdbotatg.eth](https://clawdbotatg.eth.link)
