# MandateMMHook
### Institutional-Grade Impermanent Loss Protection for Uniswap V4
#### Powered by Reactive Smart Contracts

---

## The Problem

Every year, **billions of dollars** in value leak from DeFi liquidity providers through Impermanent Loss. Yet there is no automated system to stop it.

In Traditional Finance, no market-making desk operates without two things:

1. **A Trader** — who actively manages inventory and skews quotes to reduce adverse selection
2. **A Risk Officer** — who enforces hard mandates: *"If drawdown exceeds 3%, cut the position by half. At 5%, pull everything."*

These two roles are non-negotiable. Every institutional desk has them. Every fund mandate requires them.

**Uniswap has neither.**

- AMMs quote symmetrically regardless of inventory — they accumulate more of the losing asset as prices move
- There is no system to enforce "exit at X% IL" — positions bleed indefinitely
- V4 hooks only fire during swaps — between swaps, there is zero monitoring, zero protection

This is why institutional capital stays out of DeFi liquidity provision. Not because of yield — because of risk infrastructure.

---

## The Solution: Two Layers of Protection

MandateMMHook mirrors how professional desks actually work — with two independent layers that complement each other.

```
                    ┌─────────────────────────────────────┐
                    │          MandateMMHook               │
                    │                                      │
                    │   LAYER 1: The Trader                │
                    │   ┌──────────────────────────────┐   │
                    │   │  Inventory-aware dynamic fees │   │
                    │   │  Reduces IL accumulation rate │   │
                    │   │  Active on every swap         │   │
                    │   └──────────────────────────────┘   │
                    │                                      │
                    │   LAYER 2: The Risk Officer          │
                    │   ┌──────────────────────────────┐   │
                    │   │  Automated mandate enforcement│   │
                    │   │  Graduated drawdown ladder    │   │
                    │   │  Runs autonomously via RC     │   │
                    │   └──────────────────────────────┘   │
                    │                                      │
                    └─────────────────────────────────────┘
```

---

## Layer 1 — Active IL Prevention (The Trader)

**How it works:** The hook intercepts every swap via `beforeSwap` and returns a dynamic fee based on the pool's real-time inventory balance.

```
Pool has too much Token A?
  → Swaps adding more Token A pay HIGHER fees    (discourage imbalance)
  → Swaps removing Token A pay LOWER fees        (attract rebalancing)

Pool has too much Token B?
  → Inverse logic applies
```

**The math:**
```
skew = (token0 share) - 50%

If swap worsens skew → fee = 0.30% + penalty (up to 1.00%)
If swap corrects skew → fee = 0.30% - discount (down to 0.05%)
```

**Why this matters:** Traditional market makers skew their bid-ask spread based on inventory. If they're long, they lower the ask to attract sellers. If they're short, they raise the bid. This is the exact same principle — encoded into an AMM for the first time.

**Result:** The rate at which IL accumulates is actively reduced because the pool incentivizes trades that restore inventory balance.

---

## Layer 2 — Passive IL Enforcement (The Risk Officer)

**How it works:** Each LP deposits with a **mandate** — a set of hard IL rules that are automatically enforced.

```solidity
Mandate {
    maxILBps:         500    // 5% IL → full exit (hard stop)
    drawdownStep1Bps: 100    // 1% IL → remove 50% liquidity
    drawdownStep1Pct:  50
    drawdownStep2Bps: 300    // 3% IL → remove 75% liquidity
    drawdownStep2Pct:  75
}
```

**The drawdown ladder:**

```
IL accumulates over time...

    0%  ░░░░░░░░░░░░░░░░░░░░  All good. Layer 1 slowing it down.
        
    1%  ████░░░░░░░░░░░░░░░░  Step 1 triggered → 50% liquidity removed
                                LP's exposure is halved automatically
        
    3%  ████████████░░░░░░░░  Step 2 triggered → 75% of remaining removed
                                Only 12.5% of original position at risk
        
    5%  ████████████████████  Hard stop → FULL EXIT
                                All liquidity removed, tokens safe in vault
                                LP withdraws at their convenience
```

**Why graduated?** A single hard stop is too binary — it either triggers too early (missing recovery) or too late (absorbing too much loss). A drawdown ladder reduces exposure progressively, exactly like how TradFi risk systems work.

---

## The Critical Gap: What Happens Between Swaps?

Here's the architectural problem that makes this system impossible without Reactive Network:

**V4 hooks only execute during swaps.** Between swaps, there is no mechanism to:
- Check if IL has breached a threshold
- Enforce a mandate
- Remove liquidity
- Protect an LP

A pool can go hours without a swap. During that time, IL can silently breach every threshold in an LP's mandate — and nothing happens.

```
                    Swap        Swap        Swap
Time:    ─────────|──────────|──────────|──────────►

Hook:             ▲          ▲          ▲
                fires      fires      fires

Between swaps:    ???????????  ← NO MONITORING
                  IL could be at 10% and nobody knows
```

**This is where Reactive Network changes everything.**

---

## Reactive Network: The Missing Piece

A Reactive Smart Contract (RC) deployed on Reactive Network provides **cross-block intelligence** — the ability to monitor and act between swaps.

```
Sepolia (Destination Chain)              Reactive Network (Lasna)
┌──────────────────────────┐            ┌──────────────────────────┐
│                          │            │                          │
│  MandateMMHook           │   events   │  MandateMMReactive       │
│  (V4 Hook + Callback)    │ ─────────► │  (Reactive Contract)     │
│                          │            │                          │
│  • Dynamic fees          │  callback  │  • Subscribes to events  │
│  • Mandate enforcement   │ ◄───────── │  • Cron100 (~12 min)     │
│  • Vault management      │            │  • Lazy cron lifecycle   │
│                          │            │                          │
└──────────────────────────┘            └──────────────────────────┘
```

### What the RC Does

**1. Monitors position lifecycle**
- Subscribes to `MandateConfigured` events (new LP deposits)
- Subscribes to `PositionExited` events (positions that have been fully exited)
- Tracks how many positions are active

**2. Triggers periodic mandate checks**
- Subscribed to **Cron100** — fires every ~100 blocks (~12 minutes)
- On each tick: emits a callback to `checkMandates()` on the hook
- The hook then iterates all positions, computes IL, and enforces mandates

**3. Manages its own lifecycle**
- **First position deposited** → subscribes to Cron100 (start monitoring)
- **Last position exited** → unsubscribes from Cron100 (stop burning gas)
- Fully autonomous — no human intervention required

```
With Reactive Network:

                    Swap     Cron    Swap     Cron    Swap     Cron
Time:    ─────────|────────|────────|────────|────────|────────|───►

Hook:             ▲                 ▲                 ▲
                fires             fires             fires

RC:                        ▲                 ▲                 ▲
                      checkMandates    checkMandates    checkMandates

Coverage: ████████████████████████████████████████████████████████
          24/7 protection — no gaps
```

---

## Why Not Keepers?

A common question: *"Can't Chainlink Automation or Gelato do the same thing?"*

| | Reactive Network | External Keepers |
|---|---|---|
| **On-chain** | Fully on-chain, trustless | Off-chain infrastructure |
| **Event-driven** | Native event subscriptions | Polling / simulation |
| **Self-managing** | Lazy subscribe/unsubscribe | Manual configuration |
| **Composable** | Can subscribe cross-chain | Limited to one chain |
| **Cost** | Pay per execution | Pay for upkeep + premium |
| **Centralization** | Decentralized protocol | Operator dependency |

The RC is not an external service — it's an **integral part of the hook's architecture**. It's as trustless as the hook itself.

---

## Live Validation — It Actually Works

Deployed and validated end-to-end on Sepolia + Reactive Network (Lasna):

### Deployed Contracts

| Contract | Network | Address |
|----------|---------|---------|
| Token ALPHA | Sepolia | `0x8A39Be90ca02ffb4F95044010786aabB1BE0138E` |
| Token BETA | Sepolia | `0x8bFD268b0Bf3bD661AEC714e73cB661A7De441a5` |
| MandateMMHook | Sepolia | `0x0301b4d2555c584a45bf89b5c75ff708694950c0` |
| MandateMMReactive | Lasna | `0xe9288abcbB05AFD0e67ccB8Ee8EF3dAf2969C50C` |

### What We Demonstrated

```
1. Created V4 pool ──── ALPHA/BETA with dynamic fees at 1:1 price
       │
2. LP deposited ────── 10e18 liquidity with mandate:
       │                 "Exit at 5% IL. Cut 50% at 1%. Cut 75% at 3%."
       │
3. Large swap ──────── 50e18 token0 → token1
       │                 Price moved from tick 0 → tick -7460
       │                 IL jumped to 658 bps (6.58%)
       │
4. RC detected ────── MandateConfigured event → subscribed to Cron100
       │
5. Cron100 fired ──── RC emitted callback → checkMandates()
       │
6. AUTONOMOUS EXIT ── Hook computed: 658 bps > 500 bps max
       │                 → Full exit executed
       │                 → 14.55 ALPHA + 6.89 BETA returned to vault
       │                 → Zero human intervention
       │
7. LP withdraws ──── Tokens safe, ready to claim
```

**The system detected a mandate breach and executed a full position exit autonomously — exactly as designed.**

---

## Technical Architecture

### IL Computation

```
IL = 1 - 2√r / (1 + r)

where r = (currentPrice / entryPrice)
```

Standard constant-product IL formula. Computed on-chain in the hook for each position when `checkMandates()` is called.

### Real Liquidity Management

This is not a simulation. The hook:
- Implements `IUnlockCallback` to interact with V4 PoolManager directly
- Calls `modifyLiquidity()` with positive delta on deposit
- Calls `modifyLiquidity()` with negative delta on enforcement
- Settles/takes real tokens via `CurrencySettler`
- Credits withdrawn tokens to a per-LP vault

### Event Flow

```
LP deposits with mandate
  └─► Hook emits MandateConfigured
        └─► RC react() → self-callback → persistMandateConfigured()
              └─► activeCount++ → subscribe Cron100 (if first)

Cron100 fires every ~12 minutes
  └─► RC react() → emit Callback to Hook
        └─► Hook.checkMandates() iterates all positions
              ├─► Position safe → no action
              └─► IL > threshold → remove liquidity → credit vault
                    └─► Hook emits PositionExited (if full exit)
                          └─► RC react() → self-callback → persistPositionExited()
                                └─► activeCount-- → unsubscribe Cron100 (if zero)
```

### Smart Cron Lifecycle

```
No positions    1st deposit     2nd deposit     1st exits       2nd exits
activeCount=0   activeCount=1   activeCount=2   activeCount=1   activeCount=0
cron=OFF        cron=ON ✓       cron=ON         cron=ON         cron=OFF ✓
                (subscribe)                                     (unsubscribe)

     Gas: $0         Gas: $X/tick        Gas: $X/tick          Gas: $0
```

The system only pays for cron when there's something to monitor.

---

## The LP Experience

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  depositWithMandate(                                        │
│    pool:      ALPHA/BETA,                                   │
│    liquidity: 10 ETH worth,                                 │
│    mandate: {                                               │
│      maxIL:  5%    → full exit                              │
│      step1:  1%    → remove 50%                             │
│      step2:  3%    → remove 75%                             │
│    }                                                        │
│  )                                                          │
│                                                             │
│  That's it. Everything else is automatic.                   │
│                                                             │
│  ✓ Fees adjust dynamically to slow IL                       │
│  ✓ Mandates checked every ~12 minutes                       │
│  ✓ Liquidity removed automatically on breach                │
│  ✓ Tokens held safely in vault                              │
│  ✓ Withdraw whenever you want                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Why This Matters

### For LPs
- **Set it and forget it** — deposit once, mandates enforce themselves
- **Graduated protection** — not a binary on/off, but a drawdown ladder
- **Real token recovery** — actual liquidity removed, not paper accounting

### For DeFi
- **Institutional on-ramp** — fund managers can now deploy into AMMs with compliance-grade risk rules
- **New primitive** — per-position mandates don't exist anywhere in DeFi today
- **Composable** — any V4 pool can use this hook

### For Reactive Network
- **Architectural necessity** — this system literally cannot exist without cross-block intelligence
- **Showcase** — demonstrates event subscriptions, cron, callbacks, and lazy lifecycle management
- **Real value** — not a demo or proof-of-concept, but a working protection system

---

## Test Suite

15 tests, all passing:

| Category | Tests | What's Validated |
|----------|-------|-----------------|
| Layer 1 (Fees) | 3 | Dynamic fee override, inventory tracking, event emission |
| Deposits | 4 | Real V4 position creation, mandate validation, multiple positions |
| IL Computation | 2 | Zero IL at entry, increasing IL after price move |
| Layer 2 (Enforcement) | 4 | No-breach passthrough, partial exit, full exit, fee recalibration |
| Access Control | 2 | Owner-only manual exit, callback-only enforcement |

---

## Future Extensions

**Cross-chain volatility detection**
RC subscribes to the same pair across multiple chains. Classifies price moves as temporary (oscillating) vs structural (trending). Adjusts fee sensitivity accordingly.

**Greeks-aware mandates**
Extend mandate parameters to include delta, gamma, theta thresholds. RC computes implied Greeks from price history — enabling options-desk-style position management.

**Multi-pool correlation**
Track inventory across multiple pools sharing the same tokens. Optimize fees globally rather than per-pool.

**Epoch-based positions**
Fixed-duration mandates with pre-computed risk budgets — enabling fixed-income-style evaluation of LP positions.

---

## Summary

```
┌───────────────────────────────────────────────────────────────────┐
│                                                                   │
│  MandateMMHook = The Trader + The Risk Officer                    │
│                                                                   │
│  Layer 1:  Dynamic fees that slow IL accumulation (every swap)    │
│  Layer 2:  Automated mandates that enforce hard limits (cron)     │
│  RC:       Cross-block intelligence that makes it all possible    │
│                                                                   │
│  Result:   LP positions become structured, risk-bounded           │
│            instruments — not open-ended, unmanaged exposure.      │
│                                                                   │
│  Status:   Deployed. Validated. Autonomously enforced.            │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

*Built for UHI9 (Uniswap Hooks Incubator 9) — Theme: Impermanent Loss*
*Powered by Uniswap V4 + Reactive Network*
