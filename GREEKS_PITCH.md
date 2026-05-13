# GreeksLPHook
### Every LP is an Options Seller Who Doesn't Know It
#### Powered by Reactive Smart Contracts

---

## The Insight

Providing concentrated liquidity on a Uniswap V4 pool is **mathematically equivalent to selling a short strangle** — a short put plus a short call. This is not an analogy. It is provably identical.

When you deposit liquidity in a concentrated range:
- If the price drops below your range, you hold 100% of the depreciating token — you've been assigned on your short put
- If the price rises above your range, you hold 100% of the other token — you've been assigned on your short call
- Within the range, your position's value curves exactly like a short strangle payoff

Impermanent Loss **IS** the loss on this implicit short options position.

---

## The Problem

Every options desk in TradFi monitors four numbers constantly:

| Greek | What It Measures | What the Desk Does |
|-------|-----------------|-------------------|
| **Delta** | Directional exposure | Hedge or shift position |
| **Gamma** | How fast delta changes (= how fast IL accelerates) | Widen position or reduce size |
| **Theta** | Time decay / fee income | Ensure premiums justify the risk |
| **Vega** | Volatility sensitivity | Adjust before vol spikes cause damage |

No professional options desk would EVER hold a short strangle without monitoring these four numbers and acting on them automatically.

**Yet every single LP on Uniswap is doing exactly that.**

There is no system that:
- Computes the Greeks for an LP position
- Monitors them continuously
- Acts when risk thresholds are breached
- Adjusts the position (widen, shift, exit) in response

LPs are flying blind with a position that professional options traders would never hold unmanaged.

---

## The Solution

GreeksLPHook gives every LP the same risk infrastructure that a TradFi options desk uses — automated, on-chain, and running 24/7.

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  LP deposits with a Greek Risk Profile:             │
│                                                     │
│    maxGamma:    100 BPS   (max IL per 1% move)      │
│    minθ/γ:      1.0       (fees must cover risk)    │
│    maxDelta:    5000 BPS  (max directional skew)    │
│    vegaAction:  WIDEN     (what to do on vol spike) │
│                                                     │
│  That's it. The system handles everything else.     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Every ~12 minutes, the system autonomously:
1. Computes realized volatility from price history
2. Calculates delta, gamma, theta, vega for every position
3. Checks each against the LP's risk profile
4. Executes the appropriate action:

```
Gamma too high?              → WIDEN the tick range
                               (reduces concentration = reduces IL sensitivity)

Delta exceeds tolerance?     → SHIFT the range to follow price
                               (corrects directional exposure)

Theta/Gamma ratio too low?   → Fees aren't justifying the risk
                               → WIDEN to reduce gamma, or EXIT entirely

Vega spike detected?         → Volatility regime change incoming
                               → WIDEN preemptively or EXIT before damage
```

---

## How the Greeks Are Computed

### Realized Volatility
From a rolling window of price snapshots stored after every swap:
```
logReturn[i] ≈ 4 × (√p[i] - √p[i-1]) / (√p[i] + √p[i-1])
variance = Σ(logReturn²) / n
annualVol = √(variance × secondsPerYear / avgObservationInterval)
```
Uses the Padé approximation for log returns — accurate for typical inter-swap price changes.

### Delta (Directional Risk)
```
When price is in range [pL, pU]:
  value₀ ∝ √p × (√pU - √p) / √pU    (token0 value)
  value₁ ∝ √p - √pL                    (token1 value)
  
  delta = (value₀ - value₁) / total × 10000 BPS
```
When price is below range: delta = +10000 (all token0)
When price is above range: delta = -10000 (all token1)

### Gamma (IL Acceleration)
Computed by finite difference using the exact IL formula:
```
IL(p) = 1 - 2√r / (1 + r)    where r = p/p₀

gamma = max(IL(p × 1.01) - IL(p),  IL(p × 0.99) - IL(p))
```
This gives the worst-case IL gained per 1% price move in either direction.

### Theta (Fee Income Rate)
```
totalFees ≈ swapVolume × baseFeeRate
positionFees = totalFees × (posLiquidity / totalLiquidity)
theta = positionFees / posValue × annualization × 10000 BPS
```

### Vega (Vol Sensitivity)
```
vega = gamma × realizedVol
```
High gamma + high volatility = maximum IL vulnerability.

---

## The Architecture That Makes This Possible

### The Problem with Hooks Alone

V4 hooks fire only during swaps. They cannot:
- Compute volatility (requires historical data + math across blocks)
- Monitor positions between swaps
- Execute time-based risk management

### The Problem with Keepers

Chainlink Automation or Gelato could trigger checks, but they cannot:
- Perform computation (they just call a function)
- Process event data and make decisions
- Self-manage their lifecycle based on state changes

### The Reactive Network Solution

A Reactive Smart Contract does what neither hooks nor keepers can — **it computes**.

```
  Sepolia                                    Reactive Network
  ┌─────────────┐                           ┌──────────────────────┐
  │  GreeksLP   │    GreeksDataBundle        │  GreeksLP            │
  │  Hook       │  ─────────────────────►    │  Reactive            │
  │             │    (prices, positions,      │                      │
  │  Packs and  │     metrics)               │  Decodes data        │
  │  emits all  │                            │  Computes vol        │
  │  position   │    updateGreeks() +        │  Computes δ,γ,θ,ν    │
  │  data       │    executeAction()         │  Checks thresholds   │
  │             │  ◄─────────────────────    │  Decides actions     │
  │  Executes   │    (computed results)      │                      │
  │  actions    │                            │  All in react()      │
  └─────────────┘                           └──────────────────────┘
       ▲                                           │
       │              Cron100 (~12 min)            │
       └───────────────────────────────────────────┘
```

**Two-phase data relay:**
1. Cron fires → RC tells hook "give me your data"
2. Hook packs price history + positions → emits everything in one event
3. RC decodes, computes Greeks, decides actions → sends callbacks back

The computation happens in the ReactVM — cheap, fast, and fully on-chain.

---

## Why This Can't Exist Without Reactive Network

| Capability | V4 Hook | Keepers | Reactive Network |
|-----------|---------|---------|-----------------|
| Compute volatility from price history | No (too expensive on L1) | No (can't compute) | **Yes** (cheap in ReactVM) |
| Compute Greeks for N positions | No (gas prohibitive) | No | **Yes** |
| Make risk decisions based on computation | No | No (just trigger) | **Yes** (react() can decide) |
| Auto-subscribe/unsubscribe from monitoring | No | Manual config | **Yes** (lazy cron lifecycle) |
| Operate between swaps | No (only fires during swaps) | Yes (but can't compute) | **Yes** (cron + computation) |
| Two-phase data relay | Impossible | Impossible | **Native pattern** |

The RC is not a monitoring layer. It is **the brain** of the system — doing real mathematical analysis that no other on-chain component can perform cost-effectively.

---

## Live Validation — It Actually Works

### Deployed Contracts

| Contract | Network | Address |
|----------|---------|---------|
| GreeksLPHook | Sepolia | `0x6b1c7dba7afe88dd4c6017b6aa672ec0afa250c0` |
| GreeksLPReactive | Lasna | `0x35443CEEF6c3447018fa39a8E7bb350b4E84c777` |

### What Happened

```
1. Pool created ──────── ALPHA/BETA with dynamic fees at 1:1

2. Position 0 deposited ── 10e18 liquidity
   Greek profile: maxGamma=100bps, minθ/γ=1.0, maxDelta=50%, vegaAction=WIDEN

3. 3 swaps executed ──── Price moved to tick -3681
   Price snapshots: 4 recorded in circular buffer

4. RC deployed ────────── Subscribed to PositionCreated, PositionExited, GreeksDataBundle

5. Position 1 deposited ── 5e18 liquidity (post-RC)
   RC detected → activeCount=1 → subscribed to Cron100

6. Cron100 Cycle 1 ────── AUTONOMOUS TWO-PHASE PIPELINE:
   Phase 1: RC → prepareGreeksData() → Hook emitted GreeksDataBundle
   Phase 2: RC decoded → computed vol + Greeks:
     Position 0: gamma = 10 BPS
     Position 1: gamma = 1 BPS
     Both: theta ≈ 0 (no swap volume in check period)
     θ/γ ratio: below minimum → FULL EXIT for both

7. Enforcement ──────── Hook removed all liquidity
   18.05 ALPHA + 12.48 BETA → withdrawable vault

8. Lifecycle cleanup ── RC: activeCount 1→0, cron unsubscribed
   System self-terminated — no gas wasted monitoring empty pools
```

**Total cost: 0.152 REACT** for the entire computation + enforcement cycle.

---

## The LP Experience

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  depositWithGreekProfile(                               │
│    pool:      ALPHA/BETA                                │
│    liquidity: 10 ETH worth                              │
│    profile: {                                           │
│      maxGamma:  100    "Exit if IL accelerating"        │
│      minθ/γ:    1.0    "Fees must cover my risk"        │
│      maxDelta:  5000   "Don't let me drift too far"     │
│      vegaAction: WIDEN "Spread out on vol spikes"       │
│    }                                                    │
│  )                                                      │
│                                                         │
│  ✓ Position created — real V4 liquidity                 │
│  ✓ Every 12 min: vol computed, Greeks calculated        │
│  ✓ Range auto-adjusted when risk thresholds breached    │
│  ✓ Position exited if fees don't justify the risk       │
│  ✓ Tokens safe in vault — withdraw anytime              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## The TradFi Parallel

```
TradFi Options Desk                 GreeksLPHook
─────────────────                   ────────────

Trader sells strangle          →    LP deposits concentrated liquidity
Risk system computes Greeks    →    RC computes δ, γ, θ, ν in ReactVM
Delta hedge fires              →    Range SHIFT executes
Gamma limit breached           →    Range WIDEN executes
P&L not covering theta         →    θ/γ check triggers EXIT
Vol spike detected             →    Vega action triggers preemptive WIDEN
End of day risk report         →    Greeks stored on-chain, queryable

Everything that happens on a professional options desk
now happens autonomously for every Uniswap LP.
```

---

## Competitive Differentiation

### vs IL Protection Hooks
Most IL hooks do one thing: dynamic fees, stop-losses, or insurance pools. They operate only during swaps and can't compute anything between blocks.

GreeksLPHook does **four things simultaneously** (delta + gamma + theta + vega management) and operates **between swaps** via cron-triggered computation.

### vs Academic LP-Options Equivalence Papers
The academic insight that "LPs are short options" has been known since 2021. Multiple papers describe it. None have built automated risk management around it.

GreeksLPHook is the **first implementation** that converts this theoretical insight into a working, autonomous risk management system.

### vs Off-chain Risk Management
Projects like Charm, Arrakis, and Gamma Strategies use off-chain algorithms to rebalance LP positions. These are centralized, opaque, and require trust.

GreeksLPHook is **fully on-chain**: the computation happens in the ReactVM, the decisions are deterministic, and every action is verifiable.

---

## Test Suite

19 tests, all passing:

| Category | Tests | Coverage |
|----------|-------|---------|
| Dynamic Fees | 3 | Fee override, inventory tracking |
| Price History | 2 | Snapshot storage, circular buffer |
| Deposits | 3 | Profile validation, multiple positions |
| Data Bundle | 2 | Bundle emission, empty handling |
| Reposition | 2 | WIDEN + SHIFT range operations |
| Exit Actions | 2 | Full exit, partial exit |
| Greeks Update | 1 | RC callback stores computed values |
| Access Control | 2 | Owner-only, callback-only guards |
| Full Pipeline | 2 | Multi-position bundle + inventory |

---

## Future Extensions

**Cross-chain implied volatility surface**
The RC subscribes to the same pair across Ethereum, Base, Arbitrum, Optimism. Computes a cross-venue implied vol surface. Uses the forward-looking vol estimate for vega, not just historical realized vol.

**Greeks-based position sizing**
Instead of fixed liquidity amounts, the hook computes the optimal liquidity for a given Greek budget. "I want max 50 BPS gamma and 2000 BPS delta" → the system computes the widest range that fits within those constraints.

**Portfolio-level Greeks**
Aggregate delta, gamma, theta, vega across multiple positions and pools. Net the Greeks at the portfolio level. Take action only on the residual exposure.

**Structured LP products**
Package positions with specific Greek profiles as tokenized products. "Conservative LP" = wide range, strict gamma limit. "Aggressive LP" = narrow range, high theta target. Each product is a pre-configured Greek profile.

---

## Summary

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  Every LP is an options seller.                               │
│  No options seller operates without Greeks.                   │
│  Until now, no LP had Greeks.                                 │
│                                                               │
│  GreeksLPHook changes that.                                   │
│                                                               │
│  Delta — directional risk managed by range shifting           │
│  Gamma — IL acceleration managed by range widening            │
│  Theta — fee adequacy enforced by θ/γ ratio monitoring        │
│  Vega  — vol regime changes trigger preemptive protection     │
│                                                               │
│  Computation: Reactive Network ReactVM (cheap, on-chain)      │
│  Execution: Uniswap V4 hook (real liquidity operations)       │
│  Lifecycle: Fully autonomous (lazy cron, self-terminating)    │
│                                                               │
│  Status: Deployed. Computed. Enforced. Validated.             │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

*Built for UHI9 (Uniswap Hooks Incubator 9) — Theme: Impermanent Loss*
*Powered by Uniswap V4 + Reactive Network*
