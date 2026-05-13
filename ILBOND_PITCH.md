# ILBondHook
### Split Every LP Position Into a Yield Token and a Risk Token
#### Powered by Reactive Smart Contracts

---

## The Insight

Every concentrated LP position on Uniswap V4 bundles two things together:

1. **Fee income** — the LP earns swap fees as long as the price stays in range
2. **Impermanent loss exposure** — the LP loses against HODL whenever the price moves

These two are **always** sold together. You can't be an LP without taking both. There's no way to say "I'll take the fees but not the IL," and no way to say "I'll take the IL bet but not the boring fee-collecting."

This forced bundle is the reason most LPs are unhappy. Conservative users want yield without IL. Speculators want directional IL exposure without the hassle of providing liquidity. Today they both have to take the whole package.

**ILBondHook unbundles the position.**

---

## The Solution

When an LP deposits into an ILBondHook pool, the position is split at deposit time into two transferable tokens:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  LP deposits 10 ETH worth of liquidity                  │
│              │                                          │
│              ▼                                          │
│       ┌─────────────┐                                   │
│       │  ILBond     │                                   │
│       │  Hook       │                                   │
│       └─────────────┘                                   │
│              │                                          │
│      ┌───────┴────────┐                                 │
│      ▼                ▼                                 │
│  ┌─────────┐     ┌──────────┐                           │
│  │ FEE-T   │     │ IL-T     │                           │
│  │ token   │     │ token    │                           │
│  └─────────┘     └──────────┘                           │
│                                                         │
│  • FEE-T holder gets all swap fees + the upfront        │
│    IL-T premium.                                        │
│  • IL-T holder absorbs all IL — losses AND gains.       │
│  • IL-T holder pays a premium upfront to take the risk. │
│  • Premium flows to FEE-T holder as guaranteed income.  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

The two tokens are independent and transferable. Anyone can buy/sell either side at any time. The original LP can hold both, sell one, or sell both.

---

## Why This Is New

Every existing IL hook tries to *reduce* impermanent loss — through dynamic fees, insurance pools, range adjustments, or LVR auctions. **ILBondHook does not reduce IL. It separates it.**

This is the difference between:
- "How do I make this car safer to drive?" (existing IL hooks)
- "How do I let one person own the car and another person own the insurance liability?" (ILBondHook)

The closest precedent is the Fixed/Leverage Yield Hook (UHI3), which split LP returns into "guaranteed" and "leveraged" classes. But that splits **returns** — the upside. ILBondHook splits **risk** — the downside exposure to price movement. That has never been done in V4.

---

## How It Works

### At deposit
1. LP calls `depositILBond(poolKey, tickLower, tickUpper, liquidity, max0, max1, askPremium)`
2. Hook records entry price `p₀`, range `[pL, pU]`, the LP's underlying token amounts
3. Hook mints two transferable claims against the position, both initially held by the LP:
   - **FEE-T**: claim on swap fees + upfront premium when IL-T is sold
   - **IL-T**: claim on the position's IL P&L (positive or negative)
4. IL-T can be sold to a buyer via `buyILBond(positionId)` — the buyer pays the FEE-T holder a premium for taking the IL leg
5. Both tokens are immediately transferable via `transferFeeToken(positionId, to)` / `transferILToken(positionId, to)`

### Continuously (RSC-driven)
The Reactive Smart Contract subscribes to swap events on the pool. After each swap:
1. The hook emits the new pool price
2. The RSC reacts by sending a callback `prepareILBondData(address)` to the hook
3. The hook emits an `ILBondDataBundle` containing the current price + every active position
4. The RSC decodes the bundle in the ReactVM, computes IL for each position via the standard `1 - 2√r/(1+r)` formula, and sends a callback `settleILMark(positionId, ilBps, markValue)` back to the hook for each position

No cron is required. The IL mark only needs to update when the price actually changes — and price changes only happen on swaps. Pure event-driven.

### At withdrawal / exit
- FEE-T holder has already received the upfront premium during `buyILBond` (and would receive accumulated swap fees in a full implementation).
- IL-T holder receives the underlying tokens at current pool composition (so they bear the IL outcome).
- The two claims sum to exactly what a single LP would have received — but split across two holders.

---

## Why This Can't Exist Without Reactive

| Capability | V4 Hook Alone | Keepers | Reactive Network |
|---|---|---|---|
| Update IL mark continuously | Only during swaps | Periodic, dumb | **Yes — event-driven, exact** |
| Compute IL math against entry price | Expensive on L1 | Can't compute | **Yes — cheap in ReactVM** |
| Cross-pool IL aggregation (future) | No | No | **Yes — multi-subscription** |
| React to swap events without keeper polling | Limited | Manual | **Yes — native** |

The hook by itself can only update IL during swaps, which is fine for settlement but expensive if you do the IL math in the swap path. Pushing the math to the RSC keeps the swap path cheap and the IL accounting precise.

---

## The User Experience

```
Conservative user (FEE-T buyer):
  "I want stable yield from LP fees. I don't want to lose 30% in
   a downturn. Buy FEE-T, hold, collect fees + premium, ignore price."

Speculator (IL-T buyer):
  "I think ETH is going to be range-bound for the next month.
   IL only happens with big moves, so IL-T payout will be small.
   I'll buy IL-T, pay the premium, and pocket the difference."

Original LP (deposits, then chooses):
  "I want full LP exposure → mint both, hold both."
  "I want fees only → mint both, sell IL-T into the market."
  "I want a directional bet only → mint both, sell FEE-T."
```

---

## Architecture

```
  Sepolia (Chain 11155111)                  Reactive Network (Lasna 5318007)
  ┌─────────────────────────────┐         ┌──────────────────────────┐
  │  ILBondHook                  │         │  ILBondReactive          │
  │                              │         │                          │
  │  • depositILBond             │         │  Subscribes to:          │
  │    (mint FEE-T + IL-T)       │         │    SwapOccurred           │
  │                              │  events │    PositionCreated        │
  │  • buyILBond                 │ ──────► │    PositionExited         │
  │    (premium → FEE-T holder)  │         │    ILBondDataBundle       │
  │                              │         │                          │
  │  • transferFeeToken          │         │  On every swap:           │
  │  • transferILToken           │         │    Callback prepareData   │
  │                              │         │                          │
  │  • afterSwap → SwapOccurred  │         │  On bundle:               │
  │                              │         │    decode positions       │
  │  • prepareILBondData         │         │    compute IL(p, p₀)      │
  │    (pack positions + price → │ ◄────── │    callback settleILMark  │
  │     emit ILBondDataBundle)   │         │                          │
  │                              │         │  Lifecycle:                │
  │  • settleILMark ◄────────────┼─────────┤    activeCount tracking   │
  │  • exitPosition / withdraw   │         │                          │
  └─────────────────────────────┘         └──────────────────────────┘
```

Pure event-driven. **No cron. No keepers.** The RSC fires only when something actually changed (a swap moved the price), which is the natural cadence of IL itself.

---

## Live Validation — It Actually Works

### Deployed Contracts

| Contract | Network | Address |
|----------|---------|---------|
| Token ALPHA | Sepolia | `0x8A39Be90ca02ffb4F95044010786aabB1BE0138E` |
| Token BETA | Sepolia | `0x8bFD268b0Bf3bD661AEC714e73cB661A7De441a5` |
| ILBondHook | Sepolia | `0x5188ccd3560d19fab804cc49cafc6463157090c0` |
| ILBondReactive | Lasna | `0x75C012f18C1e79561a9327acD897DAb2EB3ce319` |

### What Happened

```
1. Pool created ─────── ALPHA/BETA with DYNAMIC_FEE_FLAG, tickSpacing 60, 1:1 entry
2. Base liquidity ───── 100e18 seeded via PositionManager
3. Position 0 deposit ── 10e18, full range, askPremium 0.1 BETA
                        Hook minted FEE-T and IL-T to the LP, position tracked
4. IL-T buyer ─────────  buyILBond(0)
                        IL-T transferred to buyer; 0.1 BETA premium credited
                        to FEE-T holder's withdrawable balance
5. Swaps executed ───── 3 swaps moved price from tick 0 to tick -3697
                        (price dropped ~31%, classic IL territory)
6. RC deployed ────────── Lasna, 1 REACT funded
                        Subscribed to 4 topics on Sepolia:
                          SwapOccurred, PositionCreated, PositionExited,
                          ILBondDataBundle
7. Position 1 deposit ── 5e18, full range, askPremium 0.05 BETA (post-RC)
                        RC saw PositionCreated → activeCount=1
8. Continuous swaps ─── Each swap fired SwapOccurred → RC reacted by emitting
                        Callback prepareILBondData → hook emitted ILBondDataBundle
                        → RC decoded the bundle → computed IL via 1-2√r/(1+r)
                        → emitted settleILMark callback per position
9. Pipeline confirmed ── Hook bundleCounter incremented (two-phase relay ran)
                        RC balance dropped from 1.0 → 0.945 REACT (gas spent on
                        prepare + settle callbacks)
```

---

## Competitive Differentiation

### vs IL protection hooks
They reduce IL via fees, insurance, or rebalancing. They keep the LP holding the IL risk. ILBondHook lets the LP **transfer** the IL risk to someone who wants it.

### vs Options-on-LP hooks (Lumis, Voltaire, OpSwap)
They wrap LP positions or create options markets parallel to LPs. ILBondHook **decomposes** the LP position itself. The IL-T token is not an options contract written against the position — it **is** a slice of the position.

### vs Insurance hooks (Confidential IL Insurance, Bastion)
Insurance pays out after a loss, funded by a pool. ILBondHook doesn't need a pool — the IL-T holder is the counterparty, paid premium upfront. Fully bilateral, fully on-chain, no pool capital required.

---

## Future Extensions

**Tranching the IL leg.** Split IL-T into a senior tranche (absorbs first 5% of IL) and a junior tranche (absorbs everything beyond). Different risk-adjusted yields for different buyers.

**Cross-pool IL netting.** A single user provides liquidity across multiple correlated pools. The RSC subscribes to all of them, computes net IL across the portfolio, and lets the user mint a single IL-T token against the netted exposure.

**IL futures.** A timed version of IL-T with fixed expiry — pure speculation on whether IL over the next epoch will exceed a strike.

**Programmable premium curves.** Premium for IL-T scales with realized vol — vol-aware pricing of the IL bond at mint time.

---

## Summary

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  Every LP position is two assets glued together:              │
│  fee income + IL exposure.                                    │
│                                                               │
│  Until now, there was no way to own one without the other.    │
│                                                               │
│  ILBondHook splits them into FEE-T and IL-T.                  │
│  Conservative users hold FEE-T for yield without volatility.  │
│  Speculators hold IL-T to bet on (or against) price moves.    │
│  The original LP can hold both, neither, or one.              │
│                                                               │
│  Continuous IL mark-to-market: Reactive Smart Contracts       │
│  Settlement: Uniswap V4 hook                                  │
│  Trigger: Swap events (no cron, no keepers)                   │
│                                                               │
│  IL stops being a tax. It becomes an asset class.             │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

*Built for UHI9 (Uniswap Hooks Incubator 9) — Theme: Impermanent Loss*
*Powered by Uniswap V4 + Reactive Network*
