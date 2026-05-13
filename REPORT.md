# MandateMMHook — Dual-Layer IL Protection System
## UHI9 Hookathon Submission Report

**Author:** Prakhar Srivastava
**Date:** April 3, 2026
**Theme:** Impermanent Loss
**Networks:** Ethereum Sepolia + Reactive Network (Lasna Testnet)

---

## 1. Executive Summary

MandateMMHook is a Uniswap V4 hook that brings institutional-grade risk management to DeFi liquidity provision. It combines two layers of Impermanent Loss protection — active prevention through inventory-aware dynamic fees, and passive enforcement through automated mandate rules — powered by Reactive Smart Contracts for cross-block intelligence and autonomous execution.

The system has been deployed and validated end-to-end on Sepolia testnet, where the Reactive Contract autonomously detected a mandate breach (6.58% IL exceeding a 5% hard stop) and executed a full position exit, returning real tokens to the LP's withdrawable balance — without any human intervention.

---

## 2. Problem Statement

Liquidity providers on Uniswap suffer Impermanent Loss because:

1. **No inventory management** — AMMs quote symmetrically regardless of inventory skew, accumulating more of the depreciating asset as prices move. Professional market makers skew quotes to correct this. Uniswap does not.

2. **No risk mandates** — There is no system that enforces "if IL exceeds 3%, reduce position by 50%." In TradFi, every market-making desk operates under hard risk rules that are automatically enforced. On Uniswap, this infrastructure does not exist.

3. **No inter-block awareness** — V4 hooks fire only during swaps. Between swaps, there is no mechanism to monitor positions, enforce time-based rules, or trigger protective actions. A position can bleed IL for hours during low-activity periods with no intervention.

These gaps keep institutional capital out of DeFi liquidity provision. Fund managers, family offices, and prop desks require automated risk enforcement before deploying capital into AMM positions.

---

## 3. Solution Architecture

### 3.1 Two-Layer Design

The system mirrors how TradFi market-making desks operate:

**Layer 1 — The Trader (Active IL Prevention)**
The hook's `beforeSwap` callback returns dynamic asymmetric fees based on real-time inventory skew. Swaps that improve the pool's inventory balance receive lower fees (attracting rebalancing flow), while swaps that worsen the skew pay higher fees (discouraging further imbalance). This directly reduces the rate at which IL accumulates by incentivizing inventory-correcting trades.

**Layer 2 — The Risk Officer (Passive IL Enforcement)**
Each LP deposits with a mandate — a set of hard IL rules including drawdown ladders and a maximum IL hard stop. A Reactive Smart Contract monitors the pool via cron-based periodic checks. When IL breaches a mandate threshold, the system autonomously removes liquidity from the V4 pool and holds the tokens for the LP to claim.

### 3.2 Contract Architecture

```
Destination Chain (Sepolia)                     Reactive Network (Lasna)
┌───────────────────────────────────┐           ┌─────────────────────────────┐
│                                   │           │                             │
│  MandateMMHook.sol                │           │  MandateMMReactive.sol      │
│  ├─ BaseHook (V4 Hook)           │           │  ├─ AbstractPausableReactive│
│  ├─ AbstractCallback (CC)        │           │  ├─ IReactive               │
│  ├─ IUnlockCallback              │           │  │                           │
│  │                               │           │  │  react() on:              │
│  │  LAYER 1 (every swap):        │  events   │  │  ├─ MandateConfigured     │
│  │  ├─ beforeSwap: dynamic fees  │──────────>│  │  ├─ PositionExited        │
│  │  └─ afterSwap: emit price     │           │  │  └─ Cron100 ticks         │
│  │                               │           │  │                           │
│  │  LAYER 2 (on RC callback):    │  callback │  │  Emits Callback:          │
│  │  ├─ checkMandates()     <─────│<──────────│  │  └─ checkMandates()       │
│  │  ├─ compute IL per position   │           │  │                           │
│  │  ├─ enforce drawdown ladder   │           │  │  State persistence:       │
│  │  └─ remove real V4 liquidity  │           │  │  ├─ activeCount           │
│  │                               │           │  │  └─ lazy cron sub/unsub   │
│  │  VAULT:                       │           │  │                           │
│  │  ├─ depositWithMandate()      │           │  └─────────────────────────  │
│  │  ├─ manualExit()              │           │                             │
│  │  └─ withdraw()                │           └─────────────────────────────┘
│  │                               │
│  └───────────────────────────────│
│                                   │
│  Uniswap V4 PoolManager          │
│  (Canonical Sepolia deployment)   │
└───────────────────────────────────┘
```

### 3.3 Data Flow

```
1. LP calls depositWithMandate() with tokens + mandate rules
   └─ Hook transfers tokens, calls PoolManager.unlock()
   └─ Real V4 liquidity position created via modifyLiquidity()
   └─ Emits MandateConfigured event

2. RC sees MandateConfigured → self-callback → persists state
   └─ Subscribes to Cron100 if first active position

3. Swaps occur on the pool
   └─ beforeSwap: Hook returns asymmetric fee based on inventory skew
   └─ afterSwap: Hook emits SwapExecuted with price data

4. Cron100 fires (~12 min) → RC emits Callback to checkMandates()
   └─ Hook iterates all active positions
   └─ Computes IL: 1 - 2√r/(1+r) where r = currentPrice/entryPrice
   └─ Checks mandate thresholds (highest first):
       ├─ IL ≥ maxILBps → full exit
       ├─ IL ≥ step2Bps → remove step2Pct% liquidity
       └─ IL ≥ step1Bps → remove step1Pct% liquidity
   └─ On breach: PoolManager.unlock() → modifyLiquidity(negative) → take tokens
   └─ Tokens credited to withdrawable[lpOwner]
   └─ Emits MandateBreached + PositionExited

5. RC sees PositionExited → decrements activeCount
   └─ If activeCount == 0 → unsubscribes from cron (gas efficiency)

6. LP calls withdraw() → receives tokens
```

---

## 4. Technical Implementation

### 4.1 Hook Permissions

| Permission | Enabled | Purpose |
|-----------|---------|---------|
| afterInitialize | Yes | Track pool initialization, set default fee sensitivity |
| beforeSwap | Yes | Layer 1: Return dynamic fee based on inventory skew |
| afterSwap | Yes | Emit SwapExecuted event for RC monitoring |
| All others | No | Not required |

The pool is initialized with `DYNAMIC_FEE_FLAG` (0x800000) to enable per-swap fee overrides via `beforeSwap`.

### 4.2 Inventory-Aware Fee Mechanism (Layer 1)

```
token0RatioBps = (totalToken0 × 10000) / (totalToken0 + totalToken1)
skew = token0RatioBps - 5000  (deviation from 50/50 target)

If swap is zeroForOne (adds token0, removes token1):
  skew > 0 (too much token0): fee = BASE_FEE + penalty    (discourage)
  skew < 0 (too much token1): fee = BASE_FEE - discount   (attract)

If swap is oneForZero (adds token1, removes token0):
  Inverse logic applies

Fee is clamped to [MIN_FEE=500, MAX_FEE=10000] (0.05% to 1.00%)
Base fee: 3000 (0.30%)
```

The `feeAdjustBps` parameter (default 5000) controls fee sensitivity and can be recalibrated by the RC via `recalibrateFees()`.

### 4.3 Mandate Enforcement (Layer 2)

The mandate struct defines an LP's risk tolerance:

```solidity
struct Mandate {
    uint256 maxILBps;          // Hard stop: full exit (e.g., 500 = 5%)
    uint256 drawdownStep1Bps;  // First threshold
    uint256 drawdownStep1Pct;  // % liquidity to remove at step1
    uint256 drawdownStep2Bps;  // Second threshold
    uint256 drawdownStep2Pct;  // % liquidity to remove at step2
}
```

The drawdown ladder allows graduated response:
- At step1 (e.g., 1% IL): remove 50% of remaining liquidity
- At step2 (e.g., 3% IL): remove 75% of remaining liquidity
- At maxIL (e.g., 5% IL): full exit

Each step triggers only once per position. The system is idempotent — if step1 already fired, it won't fire again even if IL remains above the threshold.

### 4.4 IL Computation

```
IL = 1 - 2√r / (1 + r)

where r = (currentSqrtPrice / entrySqrtPrice)²

In BPS: ilBps = 10000 - (2 × sqrtR × 10000) / (1e18 + r)
```

This is the standard Impermanent Loss formula derived from the constant-product invariant. For concentrated liquidity positions, IL is amplified by the concentration factor — this formula provides a conservative lower bound.

### 4.5 Real Liquidity Management

The hook implements `IUnlockCallback` to interact directly with the V4 PoolManager:

**On deposit:**
1. LP's tokens are transferred to the hook via `transferFrom`
2. Hook calls `poolManager.unlock()` with ADD_LIQUIDITY action
3. Inside `unlockCallback`: calls `modifyLiquidity()` with positive delta
4. Settles tokens to PoolManager via `CurrencySettler`
5. Refunds unused tokens to LP

**On mandate enforcement:**
1. Hook calls `poolManager.unlock()` with REMOVE_LIQUIDITY action
2. Inside `unlockCallback`: calls `modifyLiquidity()` with negative delta
3. Takes tokens from PoolManager
4. Credits tokens to `withdrawable[lpOwner]`

Each position uses `bytes32(positionId)` as a salt for unique V4 position tracking.

### 4.6 Reactive Contract Design

The RC follows the reactive-lib patterns:

- **Constructor subscriptions**: Subscribes to MandateConfigured, PositionExited, and CheckCycleCompleted events from the hook
- **react()**: Routes by topic_0. On cron tick → emits callback to `checkMandates()`. On MandateConfigured → self-callback to persist. On PositionExited → self-callback to decrement.
- **Lazy cron**: Subscribes to Cron100 only when activeCount goes from 0→1. Unsubscribes when activeCount returns to 0. This saves gas when no positions are being monitored.
- **getPausableSubscriptions()**: Returns the cron subscription for owner-controlled pause/resume.

---

## 5. Why Reactive Network is Architecturally Essential

| Capability | V4 Hook alone | With Reactive Network |
|-----------|---------------|----------------------|
| Check mandates between swaps | Impossible — hook only fires during swaps | Cron100 triggers checks every ~12 min regardless of swap activity |
| Enforce time-based rules | No concept of time between transactions | Cron provides temporal awareness for duration-based mandates |
| Auto-exit during low-activity periods | No swaps = no hook calls = IL bleeds unchecked | Cron fires regardless — positions are protected 24/7 |
| Fee recalibration from external signals | Hook is isolated to its own pool | RC can subscribe to cross-chain events for regime detection |
| Lazy resource management | N/A | RC subscribes/unsubscribes from cron based on active positions |

The RC is not a monitoring layer or an external service — it is an integral part of the hook's decision-making architecture. Without it, mandate enforcement cannot happen between swaps, which is precisely when LPs are most vulnerable.

---

## 6. Live Deployment & Validation

### 6.1 Deployed Contracts

| Contract | Network | Chain ID | Address |
|----------|---------|----------|---------|
| Token ALPHA | Sepolia | 11155111 | `0x8A39Be90ca02ffb4F95044010786aabB1BE0138E` |
| Token BETA | Sepolia | 11155111 | `0x8bFD268b0Bf3bD661AEC714e73cB661A7De441a5` |
| MandateMMHook | Sepolia | 11155111 | `0x0301b4d2555c584a45bf89b5c75ff708694950c0` |
| MandateMMReactive | Lasna | 5318007 | `0xe9288abcbB05AFD0e67ccB8Ee8EF3dAf2969C50C` |

Hook address flag verification:
- Bit 12 (afterInitialize): set
- Bit 7 (beforeSwap): set
- Bit 6 (afterSwap): set

### 6.2 Test Scenario Executed

**Step 1 — Pool Creation:**
- V4 pool initialized with DYNAMIC_FEE_FLAG, tick spacing 60, at 1:1 price
- Base liquidity seeded: 100e18 units via PositionManager

**Step 2 — LP Deposit with Mandate:**
- Position 0: 10e18 liquidity, mandate = {max: 500bps, step1: 100bps/50%, step2: 300bps/75%}
- Real tokens deposited into V4 pool via PoolManager.unlock()

**Step 3 — Price Movement:**
- 50e18 token0 swapped for token1 (zeroForOne)
- Price moved from tick 0 to tick -7460
- Resulting IL: **658 bps (6.58%)**

**Step 4 — Second Deposit (post-RC deployment):**
- Position 1: 5e18 liquidity, mandate = {max: 400bps, step1: 50bps/50%, step2: 200bps/75%}
- RC detected MandateConfigured event → subscribed to Cron100

**Step 5 — Autonomous Enforcement:**
- Cron100 fired on Reactive Network
- RC emitted Callback to hook's checkMandates()
- Hook computed IL for Position 0: 658 bps > 500 bps max → **FULL EXIT**
- PoolManager.unlock() → modifyLiquidity(negative) → tokens withdrawn
- Position 1: IL = 0 bps → safe, no action

### 6.3 Enforcement Results

**Position 0 — Before enforcement:**
```
active: true
liquidity: 10,000,000,000,000,000,000 (10e18)
IL: 658 bps
withdrawable: 0, 0
```

**Position 0 — After autonomous enforcement:**
```
active: false
liquidity: 0
IL: N/A (exited)
withdrawable: 14,545,454,545,454,545,453 (14.55 ALPHA)
               6,886,836,750,665,205,821 (6.89 BETA)
```

**Position 1 — Unchanged (safe):**
```
active: true
liquidity: 5,000,000,000,000,000,000 (5e18)
IL: 0 bps
```

**RC state after enforcement:**
```
activeCount: 1 (decremented from 2)
cronSubscribed: true (Position 1 still active)
```

---

## 7. Test Suite

15 unit tests covering both layers, all passing:

| Test | Coverage |
|------|----------|
| testAfterSwapEmitsEvent | SwapExecuted event emission |
| testPoolInitializesInventory | afterInitialize sets pool inventory |
| testSwapWorksWithDynamicFees | Multi-directional swaps with fee override |
| testDepositWithMandate | Real V4 position creation + mandate storage |
| testDepositInvalidMandate | Mandate validation (bad params revert) |
| testMultipleDeposits | Multiple positions tracked correctly |
| testILAtSamePrice | IL = 0 at entry price |
| testILIncreasesAfterPriceMove | IL positive after swap |
| testMandateCheckNoBreachDoesNothing | Safe positions untouched |
| testMandateStep1EnforcementRemovesRealLiquidity | Partial exit + real token withdrawal |
| testMandateFullExitReturnsTokens | Full exit + tokens in withdrawable |
| testManualExit | LP-initiated exit |
| testManualExitOnlyOwner | Access control enforcement |
| testRecalibrateFees | RC fee recalibration callback |
| testInventoryUpdatesOnDeposit | Inventory tracking on deposit |

Key validation from tests:
```
testMandateStep1EnforcementRemovesRealLiquidity:
  IL: 45 bps → step1 triggered → 50% removed
  Withdrawable token0: 27,513,747,499,999,999,997
  Withdrawable token1: 22,738,639,980,113,695,017
```

---

## 8. Competitive Differentiation

### vs Standard IL Hooks (90% of participants)

Most UHI9 participants will build one of:
- Dynamic fee hooks (adjust fees based on volatility)
- Range adjustment hooks (move ticks based on price)
- Stop-loss hooks (exit at a threshold)
- Insurance pool hooks (collect premiums for IL coverage)

These are single-mechanism, single-layer solutions that operate only during swaps.

MandateMMHook is fundamentally different:
1. **Two layers** — active prevention (fees) + passive enforcement (mandates)
2. **Operates between swaps** — cron-based enforcement protects during inactivity
3. **Institutional-grade** — drawdown ladders, graduated response, per-position mandates
4. **Architecturally impossible to replicate** without reactive infrastructure

### vs Keeper-based solutions

A Chainlink Automation or Gelato keeper could theoretically trigger mandate checks. However:
- Keepers require external infrastructure setup and maintenance
- Keepers add centralization risk (single point of failure)
- Keepers cannot subscribe to on-chain events natively
- Keepers cannot manage their own lifecycle (lazy subscribe/unsubscribe)
- The RC is fully on-chain, trustless, and self-managing

---

## 9. Startup Viability

### TradFi Parallel

Every institutional market-making desk has:
1. A **trader** who manages inventory and quotes (Layer 1)
2. A **risk officer** who enforces mandates and can force-liquidate (Layer 2)

MandateMMHook brings both to DeFi. This is the compliance and risk infrastructure that institutional capital requires before deploying into AMM positions.

### Revenue Model

1. **Management fees** — Percentage of AUM managed through mandate-enforced positions
2. **Performance fees** — Share of IL reduction vs unprotected positions
3. **Protocol licensing** — White-label the system for other AMMs and chains

### Market Size

- DeFi TVL in AMMs: $10B+
- Institutional demand for structured DeFi yield: growing rapidly
- TradFi structured products market: $7T+ (the aspiration)

### Moat

The Reactive Network integration creates a genuine technical moat. Competitors cannot replicate the cross-block enforcement capability without reactive infrastructure. The system is extensible to any AMM on any EVM chain.

---

## 10. Future Extensions

1. **Cross-chain volatility monitoring** — RC subscribes to the same pair on multiple chains, classifying whether price moves are temporary (oscillating) or structural (trending). This informs whether to hold inventory or aggressively correct.

2. **Greeks-aware risk management** — Extend mandate parameters to include delta, gamma, and theta thresholds. The RC computes implied Greeks from price history, enabling options-desk-style position management.

3. **Multi-pool inventory correlation** — Track inventory across multiple pools sharing the same tokens, optimizing fee adjustments globally rather than per-pool.

4. **Epoch-based mandates** — Fixed-duration positions with pre-computed risk assessments, enabling fixed-income-style evaluation of LP positions.

---

## 11. Repository Structure

```
v4-template/
├── src/
│   ├── MandateMMHook.sol        # V4 Hook + Reactive Callback Contract
│   ├── MandateMMReactive.sol    # Reactive Contract (deployed on RN)
│   └── MockERC20.sol            # Testnet ERC20 tokens
├── test/
│   └── MandateMMHook.t.sol      # 15 tests — all passing
├── script/
│   ├── 00_DeployMandateMMHook.s.sol  # CREATE2 salt-mined deployment
│   ├── SeedLiquidity.s.sol           # Seed pool liquidity
│   ├── DepositAndSwap.s.sol          # Deposit + swap scenario
│   └── NewDeposit.s.sol              # Additional deposit
├── DEPLOY.md                    # Step-by-step deployment guide
├── REPORT.md                    # This report
└── foundry.toml                 # via_ir=true, optimizer=200 runs
```

---

## 12. Conclusion

MandateMMHook demonstrates that Uniswap V4 hooks combined with Reactive Smart Contracts can deliver institutional-grade IL protection that is:

- **Autonomous** — no human intervention required after deposit
- **Real** — manages actual V4 liquidity, not simulations
- **Dual-layered** — prevents IL accumulation (fees) and enforces hard limits (mandates)
- **Validated end-to-end** — live on Sepolia with proven autonomous enforcement

The system transforms LP positions from open-ended, unmanaged exposure into structured, risk-bounded instruments — bridging the gap between DeFi yield and TradFi risk management standards.

---

*Built for UHI9 (Uniswap Hooks Incubator 9) — Theme: Impermanent Loss*
*Powered by Uniswap V4 + Reactive Network*
