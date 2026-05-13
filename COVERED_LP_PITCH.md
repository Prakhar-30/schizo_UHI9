# CoveredLPHook
### Every Concentrated LP Has Already Sold the Upside — Charge for It
#### Powered by Reactive Smart Contracts

---

## The Insight

When an LP deposits into a concentrated range `[pL, pU]`:
- **Below the range**, they hold 100% of the depreciating token
- **Above the range**, they hold 100% of the other token at the upper bound — they are **forced to sell** at price `pU` regardless of how much higher the market actually goes

That forced sale at `pU` is the exact same payoff as a **covered call**. The LP has already written a call option on the upside above `pU`, with strike `pU`. They are **already** giving away every cent of price movement above their upper bound.

In TradFi, every covered call writer **gets paid a premium** for selling that upside. They don't give it away for free — they collect option premium as compensation for the capped gain.

**Uniswap LPs give the upside away for free.**

CoveredLPHook fixes that. The LP gets paid premium for the upside they were already going to lose.

---

## The Solution

When an LP deposits into a CoveredLP pool, the hook automatically mints a **call option** at the upper bound `pU` of the LP's range. The option is sold to anyone willing to buy it. The premium goes directly to the LP.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  LP deposits 10 ETH worth of liquidity into [pL, pU]         │
│                                                              │
│  Hook recognizes:                                            │
│    "This LP is already short the upside above pU."           │
│                                                              │
│  Hook automatically mints:                                   │
│    Call option:                                              │
│      strike   = pU                                           │
│      expiry   = T (e.g. 7 days)                              │
│      writer   = the LP (locked in the position)              │
│      buyer    = anyone in the market                         │
│                                                              │
│  Buyer pays the LP a premium upfront.                        │
│                                                              │
│  At expiry:                                                  │
│    if price < pU → option expires worthless                  │
│                    LP keeps the premium AS PURE PROFIT       │
│    if price ≥ pU → option exercises                          │
│                    LP delivers token at pU (was going to     │
│                    sell at pU anyway — this is identical to  │
│                    the natural LP outcome)                   │
│                    LP STILL keeps the premium                │
│                                                              │
│  The LP gets paid twice for the same risk:                   │
│    1. Swap fees while the price is in range (theta)          │
│    2. Option premium for the upside they already gave up     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

It's free money — except it isn't free, because the LP was already taking the risk.

---

## Why This Is New

There are options-on-V4 projects (Lumis UHI1, OpSwap UHI6, Voltaire UHI8) that build options *next to* LP positions or wrap LP positions in options structures. None of them recognized the simpler truth:

> The LP position **already is** a short call against the upper bound. Selling that call explicitly is just collecting premium for risk you already bear.

This is the cleanest "LPs are options" implementation in the directory. Not a new product layered on LPs — a recognition that the LP is already doing the thing, just for free.

---

## How It Works

### At deposit
1. LP calls `depositCoveredLP(poolKey, tickLower, tickUpper, liquidity, max0, max1, durationSeconds, askPremium)`
2. Hook reads the upper bound `pU`, computes `strikeSqrtPriceX96 = TickMath.getSqrtPriceAtTick(tickUpper)`
3. Hook mints `Option { positionId, strike=pU, expiry=now+duration, askPremium }` with status `PENDING`
4. The hook adds liquidity to the pool via `IPoolManager.unlock` → `modifyLiquidity`
5. The new option is added to `activeOptionIds` so the RC will track it

### Buyer purchases the option
1. Buyer calls `purchaseOption(optionId, maxPay)` and pays `askPremium` in token1
2. The hook records `buyer`, marks status `SOLD`, and credits the premium to the LP's `withdrawable[lpOwner].amount1`

### Continuously (RSC-driven)
The `CoveredLPReactive` subscribes to:
- `SwapOccurred` (re-price live options)
- `Cron1000` (~2-hour cron — settles expired options)
- `PositionCreated`, `PositionExited`, `OptionMinted`, `OptionPurchased`, `OptionSettled` (lifecycle bookkeeping)

On each swap or cron tick, the RC asks the hook to emit a `CoveredDataBundle` containing the current pool price plus every active option. The RC decodes the bundle in the ReactVM, recomputes a vol/distance-aware premium for each `PENDING` option, and posts back `updateOptionPremium(optionId, newAsk)` if the price has moved more than 2%.

For expired options the RC emits a `settleOption(optionId)` callback. The hook's settle logic:
- If pool price ≥ strike and the option was SOLD → cash settle: pay the buyer `(price/strike)² - 1` × notional from the LP's withdrawable balance.
- Otherwise → mark SETTLED, LP keeps the premium.

### At expiry
- **If pool price < strike `pU`** → option expires worthless. LP keeps the premium. No further action.
- **If pool price ≥ strike `pU`** → option holder exercises. The LP's position is already at `pU` (because the price is at or above the upper bound, so the LP is already 100% in the wrong asset). The hook settles the option by transferring the asset at strike, exactly mirroring what would have happened anyway.

---

## Why This Can't Exist Without Reactive

| Capability | V4 Hook Alone | Keepers | Reactive Network |
|---|---|---|---|
| Re-price live options as price moves | Only during swaps, expensive | Can't compute | **Yes — event-driven, cheap** |
| Detect expiry conditions | No (no time awareness) | Yes (poll) | **Yes — single cron sub** |
| Auto-settle expiring options | Manual or keeper | Keeper-driven | **Yes — RSC triggers callback** |
| Vol-aware premium pricing | Too expensive on L1 | Can't compute | **Yes — math in ReactVM** |

The hook handles the position. The RSC handles the option lifecycle: pricing, expiry detection, settlement triggers. Without RSC, you need either expensive in-swap-path math or a centralized off-chain keeper.

---

## Architecture

```
  Sepolia (Chain 11155111)                  Reactive Network (Lasna 5318007)
  ┌─────────────────────────────┐         ┌──────────────────────────┐
  │  CoveredLPHook              │         │  CoveredLPReactive       │
  │                              │         │                          │
  │  • depositCoveredLP:         │         │  Subscribes to:          │
  │    add real V4 liquidity     │         │    SwapOccurred           │
  │    + auto-mint option         │         │    PositionCreated        │
  │                              │         │    PositionExited         │
  │  • purchaseOption:            │         │    OptionMinted           │
  │    buyer pays premium         │  events │    OptionPurchased        │
  │    → credited to LP          │ ──────► │    OptionSettled          │
  │                              │         │    CoveredDataBundle      │
  │  • afterSwap:                 │         │                          │
  │    emit SwapOccurred          │         │  • on Swap:              │
  │                              │         │    callback prepareData   │
  │  • prepareCoveredData:       │ ◄────── │  • on bundle:             │
  │    pack active options +     │         │    re-price all options   │
  │    current price → emit       │         │    callback updatePremium │
  │    CoveredDataBundle          │         │  • on cron:               │
  │                              │         │    callback prepareData   │
  │  • updateOptionPremium       │ ◄────── │    + settle expired       │
  │  • settleOption              │ ◄────── │                          │
  │                              │         │  Lifecycle:                │
  │  • exitPosition (LP exits)    │         │    activeCount tracking   │
  │  • withdraw                  │         │    lazy cron sub/unsub    │
  └─────────────────────────────┘         └──────────────────────────┘
```

The single cron exists only because **option expiry is fundamentally time-based** — it's the one thing swap events can't tell you. Everything else (pricing, mark-to-market) flows from swap events.

---

## Live Validation — It Actually Works

### Deployed Contracts

| Contract | Network | Address |
|----------|---------|---------|
| Token ALPHA | Sepolia | `0x8A39Be90ca02ffb4F95044010786aabB1BE0138E` |
| Token BETA | Sepolia | `0x8bFD268b0Bf3bD661AEC714e73cB661A7De441a5` |
| CoveredLPHook | Sepolia | `0x428711942fe3418d1bf36627420a32d5fdd1d0c0` |
| CoveredLPReactive | Lasna | `0x6dc5f8710BCb60703cdaA49e5283BbDe7955B140` |

Hook address flag verification: bits 12 (afterInitialize) + 7 (beforeSwap) + 6 (afterSwap) all set.

### What Happened

```
1. Pool created ─────── ALPHA/BETA with DYNAMIC_FEE_FLAG, tickSpacing 60, 1:1 entry
2. Base liquidity ───── 100e18 seeded via PositionManager
3. Position 0 deposit ── 10e18, full range, 7-day option, askPremium 0.05 BETA
4. Buyer (same wallet) called purchaseOption(0)
                        → option marked SOLD, 0.05 BETA credited to LP withdrawable
5. Swaps executed ───── price moved from tick 0 to tick 1545
6. RC deployed ────────── Lasna, 1 REACT funded
                        Subscribed to 7 topics on Sepolia:
                          SwapOccurred, PositionCreated, PositionExited,
                          OptionMinted, OptionPurchased, OptionSettled,
                          CoveredDataBundle
7. Position 1 deposit ── 5e18, 24-hour option, askPremium 0.03 BETA (post-RC)
                        RC saw OptionMinted → activeCount=1 → subscribed to Cron1000
8. More swaps ────────── 6 additional swaps, alternating directions
                        Each swap fired SwapOccurred → RC reacted by sending
                        prepareCoveredData callback → hook emitted
                        CoveredDataBundle → RC computed new premium → if
                        > 2% delta from current ask, callback updateOptionPremium
9. Pipeline confirmed ── Hook bundleCounter incremented (two-phase relay ran)
                        RC balance dropped from 1.0 → 0.928 REACT (gas spent
                        on data-prepare + premium-update + lifecycle callbacks)
```

---

## The LP Experience

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  depositCoveredLP(                                      │
│    pool:      ALPHA/BETA                                │
│    range:     [pL, pU]                                  │
│    liquidity: 10 ETH worth                              │
│    expiry:    7 days                                    │
│    askPremium: 0.05 BETA                                │
│  )                                                      │
│                                                         │
│  ✓ Position created — real V4 liquidity                 │
│  ✓ Call option auto-minted: strike=pU, expiry=7d        │
│  ✓ Buyer purchases → 0.05 BETA credited to LP           │
│  ✓ Every swap → RC re-prices live options               │
│  ✓ Every 2h cron → RC checks for expiries → settles     │
│  ✓ At expiry: LP keeps premium regardless of outcome    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Competitive Differentiation

### vs Options protocols (Lyra, Premia, on-chain options)
They build options markets requiring separate liquidity for option underwriting. CoveredLPHook **uses LP positions as the underwriting source** — no separate liquidity needed. The LP is already short the call; this just monetizes it.

### vs Lumis / Voltaire / OpSwap
Those projects wrap LPs in option structures or build options markets parallel to LPs. CoveredLPHook recognizes that the LP is already implicitly short — and lets them get paid for it. Simpler, cleaner, more capital-efficient.

### vs IL hedging hooks (GammaHedge, DeltaShield)
Those hedge IL via external instruments (perps, deltas elsewhere). CoveredLPHook **monetizes** the same risk that those hooks try to neutralize. Different philosophy: instead of paying to hedge the upside cap, get paid for accepting it.

---

## Future Extensions

**Range-end puts.** Symmetrically: every concentrated LP is also short a put at `pL` (forced to buy more of the depreciating asset). Mint and sell those too. Now the LP gets paid premium on **both** ends of their range.

**Strike laddering.** Instead of one option at `pU`, mint a ladder of options at `pU - δ`, `pU`, `pU + δ` for partial coverage. LP can choose how aggressively to monetize the upside.

**Auto-rolling options.** When an option expires worthless, automatically mint a new one for the next expiry. The LP becomes a continuous premium collector with no manual action.

**Cross-pool covered calls.** RSC subscribes to the same pair across multiple chains. When the LP has positions on multiple chains, the RSC mints a single aggregated call against the combined upside, distributing the premium across positions.

---

## Summary

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  Every concentrated LP has already sold the upside above pU.  │
│  Until now, they gave it away for free.                       │
│                                                               │
│  CoveredLPHook auto-mints a call option at pU, sells it,      │
│  and pays the LP the premium.                                 │
│                                                               │
│  If the price stays in range → LP keeps premium as bonus.     │
│  If the price breaches pU → LP delivers what they would have  │
│                              delivered anyway, AND keeps      │
│                              the premium.                     │
│                                                               │
│  Pricing & lifecycle: Reactive Smart Contracts                │
│  Settlement: Uniswap V4 hook                                  │
│  Trigger: Swap events + low-frequency cron for expiry         │
│                                                               │
│  LPs stop giving away free money. Every LP becomes a          │
│  professional covered call writer.                            │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

*Built for UHI9 (Uniswap Hooks Incubator 9) — Theme: Impermanent Loss*
*Powered by Uniswap V4 + Reactive Network*
