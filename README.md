# schizō — Impermanent loss, unbundled

**A Uniswap v4 hook that splits every LP position into a yield leg (FEE-T) and a risk leg (IL-T), with the impermanent-loss mark recomputed on every swap by a Reactive Smart Contract.**

Live app → https://schizo-il-bond.vercel.app · Built for UHI9 (Theme: Impermanent Loss)

---

## What it is

An LP position bundles two things you can't separate: **fee income** (steady, grows with volume) and **impermanent loss** (the bill you pay when price moves). schizō unbundles them at deposit time into two transferable claims on the same position:

- **FEE-T** — keeps the fees + an upfront premium. No price risk.
- **IL-T** — takes the impermanent loss. Pays the premium to get it.

Every other IL hook tries to *reduce* IL. schizō *separates* it, so an LP can sell the risk to someone who wants it. IL stops being a tax and becomes a tradable instrument.

The IL mark isn't computed on the swap path. A **Reactive Smart Contract** on Reactive Lasna subscribes to the hook's swap events, recomputes IL per position against its entry price inside the ReactVM, and posts it back on-chain — no keeper, no cron, exactly when price moves.

## Live deployments

The same system runs independently on two chains; the frontend switches everything by the connected wallet's chain.

| | Ethereum Sepolia (11155111) | Unichain Sepolia (1301) |
|---|---|---|
| ILBondHook | `0x58A3A816864F1E5f6F38F01f9f5AE1Cacc9210C0` | `0x56B99A42E41D5987b2F39E97F3EBe5f3d76e10C0` |
| ILBondReactive (Lasna) | `0x27eab090BF647e191A4FB121A780aA6ED89C53E2` | `0x4F193c807b4BD93054332bc67e64428725AA107D` |
| Pools | 45 pairs (10 tokens) | 3 pairs (mWETH/mWBTC/mUSDC) |

## How it works

```
swap on any pool
  → hook emits SwapOccurred                         [destination chain]
     → RSC reacts, calls back prepareILBondData
        → hook emits ILBondDataBundle (every active position + its pool price)
           → RSC computes IL = 1 − 2√r/(1+r)         [ReactVM, Lasna]
              → RSC calls back settleILMark(id, ilBps) on the hook
```

The hook stays cheap on the hot path (`afterSwap` just emits a price snapshot); the math lives on Reactive. Pools also charge a **genuinely dynamic fee** — `0.30% + f(realized volatility)`, capped at 3%, driven by an on-chain EWMA of tick movement.

## Repository layout

```
src/
  ILBondHook.sol        # the v4 hook + reactive callback contract (Sepolia / Unichain)
  ILBondReactive.sol    # the Reactive Smart Contract (Lasna)
  MockERC20.sol         # mintable test token
script/
  25_FreshDeploy.s.sol      # Sepolia: hook + 45 pools
  30_UnichainDeploy.s.sol   # Unichain: hook + 3 mock tokens + pools + 2 positions
  31_UnichainSwaps.s.sol    # Unichain: price-moving swaps
test/                    # 74 Foundry tests — unit, fuzz, invariant
frontend/                # React + Vite app (wagmi · viem · RainbowKit)
  src/config/networks.js    # per-chain deployment registry (switches by wallet chain)
  api/index-events.js       # Supabase event indexer (full history past the RPC log cap)
ILBOND_PITCH.md          # one-page pitch
ILBOND_REPORT.md         # technical report
```

The Solidity hook was developed on top of the [Uniswap **v4-template**](https://github.com/uniswapfoundation/v4-template) — the template's scaffolding (PoolManager/PositionManager wiring, `HookMiner` salt-mining, test utilities) was used as the starting point and then built out into the ILBondHook system.

## Build & test

```bash
forge install
forge test           # 74 passing: unit + fuzz + invariant
```

Frontend:

```bash
cd frontend
npm install
npm run dev          # local dev (reads on-chain; Supabase + OG need `vercel dev` / deploy)
```

## Deploying your own

```bash
# Sepolia (45 pools)
forge script script/25_FreshDeploy.s.sol --rpc-url <SEPOLIA_RPC> --private-key $KEY --broadcast

# Unichain Sepolia (small: 3 pools + 2 positions)
forge script script/30_UnichainDeploy.s.sol --rpc-url https://sepolia.unichain.org \
  --private-key $KEY --broadcast --slow

# Reactive contract (Lasna) — point it at the hook + destination chain id
forge create src/ILBondReactive.sol:ILBondReactive --rpc-url https://lasna-rpc.rnk.dev/ \
  --private-key $KEY --broadcast --value 10ether \
  --constructor-args <owner> <hook> <destChainId> <swapTopic> <createdTopic> <exitedTopic> <bundleTopic>
```

Fund the hook with native gas on its chain (it pays for reactive callbacks) and the RSC with REACT on Lasna.

---

*Uniswap v4 for settlement. Reactive Network for the brains. Testnet only — not financial advice.*
