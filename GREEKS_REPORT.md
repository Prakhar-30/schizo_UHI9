# GreeksLPHook — Options-Greeks-Aware LP Risk Management
## Live Deployment & Validation Report

**Author:** Prakhar Srivastava
**Date:** April 3, 2026
**Networks:** Ethereum Sepolia + Reactive Network (Lasna Testnet)

---

## 1. Executive Summary

GreeksLPHook treats every concentrated liquidity position as what it mathematically is — a short options position — and applies TradFi options risk management (delta, gamma, theta, vega) to autonomously protect LPs from Impermanent Loss.

The system was deployed and validated end-to-end on Sepolia + Reactive Network. The Reactive Contract autonomously:
1. Triggered the hook to emit price and position data
2. Computed realized volatility and all four Greeks in the ReactVM
3. Determined that fees were not compensating for IL risk (theta/gamma ratio breach)
4. Executed full exits for both LP positions — without any human intervention

**18.05 ALPHA + 12.48 BETA** were returned to the LP's vault.

---

## 2. Architecture

### Two-Phase Computation Pipeline

```
Phase 1: Cron100 fires (~12 min)
  → RC react() → Callback to hook.prepareGreeksData()
  → Hook reads price history + positions + pool metrics
  → Hook emits GreeksDataBundle event (all data packed)

Phase 2: RC sees GreeksDataBundle
  → react() decodes price snapshots + position data
  → Computes realized volatility (Padé log-return approximation)
  → For each position: computes delta, gamma, theta, vega
  → Checks against LP's risk profile thresholds
  → Emits Callback(s): updateGreeks() + executeAction()
  → Hook executes: reposition, widen, shift, or exit
```

### Contract Architecture

```
Sepolia (Chain 11155111)                    Reactive Network (Lasna)
┌──────────────────────────────────┐       ┌────────────────────────────────┐
│  GreeksLPHook                    │       │  GreeksLPReactive              │
│  (V4 Hook + Callback Contract)   │       │  (Greeks Computation Engine)   │
│                                  │       │                                │
│  LAYER 1 (every swap):           │events │  Subscribes to:               │
│  ├─ beforeSwap: dynamic fees     │──────►│  ├─ PositionCreated           │
│  └─ afterSwap: store price snap  │       │  ├─ PositionExited            │
│                                  │       │  └─ GreeksDataBundle          │
│  DATA RELAY (on RC callback):    │       │                                │
│  └─ prepareGreeksData()          │       │  On Cron100:                   │
│     → pack prices + positions    │       │  └─ Callback: prepareGreeksData│
│     → emit GreeksDataBundle      │       │                                │
│                                  │cbacks │  On GreeksDataBundle:          │
│  EXECUTION (on RC callback):     │◄──────│  ├─ Compute vol from prices   │
│  ├─ updateGreeks()               │       │  ├─ Compute δ, γ, θ, ν        │
│  └─ executeAction()              │       │  ├─ Check risk thresholds     │
│     ├─ WIDEN (reduce gamma)      │       │  └─ Emit action callbacks     │
│     ├─ SHIFT (correct delta)     │       │                                │
│     ├─ PARTIAL_EXIT              │       │  Lifecycle:                    │
│     └─ FULL_EXIT                 │       │  ├─ Lazy cron subscribe       │
│                                  │       │  └─ Auto cron unsubscribe     │
│  VAULT:                          │       └────────────────────────────────┘
│  ├─ depositWithGreekProfile()    │
│  ├─ manualExit()                 │
│  └─ withdraw()                   │
└──────────────────────────────────┘
```

---

## 3. The Four Greeks

### Delta — Directional IL Risk
**What it measures:** How much does the LP's value change per unit price move?

For a concentrated LP position in range [pL, pU] at current price p:
- All token0 (p below range): delta = +10000 BPS
- All token1 (p above range): delta = -10000 BPS
- In range: delta = (value₀ - value₁) / totalValue × 10000

**Action:** If |delta| exceeds the LP's tolerance → SHIFT range to follow price.

### Gamma — IL Acceleration Risk
**What it measures:** How fast is IL growing? Gamma IS the mathematical expression of IL.

Computed by finite difference:
```
gamma = IL(price + 1%) - IL(price)
```
Using the standard IL formula: IL = 1 - 2√r / (1 + r)

**Action:** If gamma exceeds max → WIDEN range (reduces concentration = reduces gamma).
If gamma > 2× max → FULL EXIT.

### Theta — Fee Income as Time Decay
**What it measures:** How much fee income is the LP earning? This is the "premium" for selling the implicit option.

```
theta = (swapVolume × feeRate × positionShare) / positionValue × annualization
```

**Action:** If theta/gamma ratio drops below minimum → fees aren't compensating for IL risk.
- Very low theta → FULL EXIT (not worth the risk)
- Moderate → WIDEN to reduce gamma (improve ratio)

### Vega — Volatility Regime Risk
**What it measures:** How exposed is the position to volatility changes?

```
vega = gamma × realizedVol
```

**Action:** If vega is significant + gamma is concerning → execute LP's configured vega action (WIDEN or EXIT).

### Realized Volatility Computation
Computed from price history using the Padé log-return approximation:
```
ln(p_t/p_{t-1}) ≈ 4 × (√p_t - √p_{t-1}) / (√p_t + √p_{t-1})
variance = Σ(logReturn²) / n  (zero-mean assumption for short periods)
annualVol = √(variance × secondsPerYear / avgObservationInterval)
```

---

## 4. Deployed Contracts

| Contract | Network | Chain ID | Address |
|----------|---------|----------|---------|
| Token ALPHA | Sepolia | 11155111 | `0x8A39Be90ca02ffb4F95044010786aabB1BE0138E` |
| Token BETA | Sepolia | 11155111 | `0x8bFD268b0Bf3bD661AEC714e73cB661A7De441a5` |
| GreeksLPHook | Sepolia | 11155111 | `0x6b1c7dba7afe88dd4c6017b6aa672ec0afa250c0` |
| GreeksLPReactive | Lasna | 5318007 | `0x35443CEEF6c3447018fa39a8E7bb350b4E84c777` |

Hook address flag verification:
- Bit 12 (afterInitialize): set
- Bit 7 (beforeSwap): set
- Bit 6 (afterSwap): set

---

## 5. Test Scenario Executed

### Step 1 — Pool Creation & Base Liquidity
- V4 pool initialized: ALPHA/BETA with DYNAMIC_FEE_FLAG, tick spacing 60, at 1:1 price
- Base liquidity seeded: 100e18 units via PositionManager

### Step 2 — Position 0 Deposited (pre-RC)
- Liquidity: 10e18, full range
- Greek profile: maxGamma=100bps, minTheta/Gamma=1.0, maxDelta=5000bps, vegaAction=WIDEN
- Entry price: tick 0 (1:1)

### Step 3 — Price Movement via Swaps
Three swaps to generate price history and IL:
1. 20e18 token0 → token1 (price down)
2. 10e18 token1 → token0 (partial recovery)
3. 15e18 token0 → token1 (price down further)
- Final tick: -3681
- Price snapshots recorded: 4

### Step 4 — RC Deployed on Reactive Network
- Subscribed to: PositionCreated, PositionExited, GreeksDataBundle from hook
- Funded with 1 REACT

### Step 5 — Position 1 Deposited (post-RC)
- Liquidity: 5e18, full range
- Greek profile: maxGamma=150bps, minTheta/Gamma=0.5, maxDelta=7000bps, vegaAction=NOTHING
- RC detected PositionCreated → self-callback → activeCount=1 → subscribed to Cron100

### Step 6 — Cron100 Cycle 1 (Autonomous)
1. Cron100 fired on Reactive Network
2. RC emitted Callback → hook.prepareGreeksData()
3. Hook packed 4 price snapshots + 2 positions → emitted GreeksDataBundle
4. RC react() decoded the bundle
5. RC computed: vol, delta, gamma, theta, vega for both positions
6. RC determined: theta ≈ 0 (very low swap volume in check period), gamma > 0 → theta/gamma ratio breached
7. RC emitted FULL_EXIT callbacks for both positions
8. Hook removed all liquidity, credited tokens to vault
9. Hook emitted PositionExited events
10. RC decremented activeCount → 0 → unsubscribed from Cron100

### Step 7 — Cron100 Cycle 2
- Confirmed: bundle counter = 2 (second cycle also ran)
- All positions exited, lazy cron unsubscribed

---

## 6. Enforcement Results

### Position 0 — Before enforcement:
```
active: true
liquidity: 10,000,000,000,000,000,000 (10e18)
tickLower: -887220, tickUpper: 887220
entrySqrtPrice: 79228162514264337593543950336 (1:1)
delta: 0, gamma: 0, theta: 0, vega: 0
```

### Position 0 — After autonomous enforcement:
```
active: false
liquidity: 0
gamma: 10 BPS (computed by RC)
Action: FULL_EXIT (theta/gamma ratio breach — fees not compensating for IL risk)
```

### Position 1 — Before enforcement:
```
active: true
liquidity: 5,000,000,000,000,000,000 (5e18)
entrySqrtPrice: 65912842002666754193143325232 (tick -3681)
```

### Position 1 — After autonomous enforcement:
```
active: false
liquidity: 0
gamma: 1 BPS (computed by RC)
Action: FULL_EXIT (theta/gamma ratio breach)
```

### Vault — Withdrawable tokens:
```
ALPHA: 18,047,710,830,021,301,818 (18.05 ALPHA)
BETA:  12,479,509,955,353,719,293 (12.48 BETA)
```

### RC Final State:
```
activeCount: 0 (both positions exited)
cronSubscribed: false (auto-unsubscribed — no positions to monitor)
balance: 0.848 REACT (started with 1.0 — spent 0.152 on computation + callbacks)
debt: 0
```

---

## 7. Why Reactive Network is Architecturally Essential

### For Greeks Computation
Computing realized volatility, delta, gamma, theta, and vega requires:
- Historical price data (multiple snapshots)
- Mathematical operations (log returns, variance, square roots)
- Per-position evaluation against risk profiles

This is too gas-expensive to run on Sepolia every 12 minutes. The RC computes it in the ReactVM at a fraction of the cost.

### For the Two-Phase Data Relay
The hook CAN'T compute its own Greeks because:
1. It only fires during swaps (not between them)
2. Even during swaps, doing vol computation + Greeks for N positions is prohibitively expensive

The RC CAN'T read Sepolia state directly. So the two-phase relay:
1. RC triggers hook to pack and emit its own data
2. RC receives the data and computes

This architecture is unique to Reactive Network — no other system supports this event-driven computation pipeline.

### For Lifecycle Management
- Auto-subscribe to cron when first position created
- Auto-unsubscribe when last position exits
- No gas wasted monitoring empty pools

---

## 8. Test Suite

19 tests, all passing:

| Category | Tests | What's Validated |
|----------|-------|-----------------|
| Dynamic Fees | 3 | Fee override, inventory tracking, event emission |
| Price History | 2 | Snapshot recording, circular buffer overflow |
| Deposits | 3 | Greek profile validation, multiple positions |
| Data Bundle | 2 | Bundle emission, empty position handling |
| Reposition | 2 | WIDEN range, SHIFT range |
| Exit Actions | 2 | Full exit, partial exit (50%) |
| Greeks Update | 1 | RC callback stores computed Greeks |
| Access Control | 2 | Owner-only exit, callback-only actions |
| Inventory | 1 | Inventory updates on deposit |
| Pipeline | 1 | Full multi-position bundle pipeline |

---

## 9. Key Innovation: Computation Offloading

Traditional reactive contracts just orchestrate — they detect events and trigger actions. GreeksLPReactive **computes** — it performs real mathematical analysis in the ReactVM:

```
react() receives GreeksDataBundle (packed data from hook)
  │
  ├─ Decode price history → compute realized volatility
  │   └─ Padé log-return approximation + annualization
  │
  ├─ For each position:
  │   ├─ Delta: value-weighted directional exposure
  │   ├─ Gamma: finite-difference IL sensitivity
  │   ├─ Theta: fee yield estimation
  │   └─ Vega: gamma × vol sensitivity
  │
  ├─ Check against risk profile thresholds
  │   ├─ gamma > maxGamma → WIDEN or EXIT
  │   ├─ |delta| > maxDelta → SHIFT
  │   ├─ theta/gamma < min → EXIT or WIDEN
  │   └─ vega high + gamma concerning → vegaAction
  │
  └─ Emit Callbacks with computed Greeks + actions
```

The computation cost: **0.152 REACT for 2 complete cycles** (including data relay, Greeks computation, and action execution for 2 positions).

---

## 10. Conclusion

GreeksLPHook proves that Reactive Smart Contracts can perform non-trivial mathematical computation — not just event routing — to deliver institutional-grade risk management for DeFi liquidity providers.

Every LP in DeFi is an options seller who doesn't know they're selling options. This system gives them the same risk infrastructure that professional options desks use — automated, on-chain, and powered by cross-chain intelligence.

**Key results:**
- Two-phase data relay pipeline: validated end-to-end
- Greeks computation in ReactVM: vol, delta, gamma, theta, vega — all computed correctly
- Autonomous enforcement: positions exited based on theta/gamma ratio analysis
- Lazy cron lifecycle: subscribe → monitor → exit → unsubscribe
- Real tokens recovered: 18.05 ALPHA + 12.48 BETA safe in vault

---

*Built for UHI9 (Uniswap Hooks Incubator 9) — Theme: Impermanent Loss*
*Powered by Uniswap V4 + Reactive Network*
