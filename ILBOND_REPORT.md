# schizō / ILBondHook — Technical Report

**Splitting a Uniswap v4 LP position into a yield leg (FEE-T) and a risk leg (IL-T), marked to market by a Reactive Smart Contract.**

Author: Prakhar Srivastava · UHI9 (Theme: Impermanent Loss)
Networks: Ethereum Sepolia (11155111) + Reactive Lasna (5318007)
Live app: https://schizo-il-bond.vercel.app

---

## 1. What this is

A normal LP position bundles two unrelated exposures: fee income (vol-positive, steady) and impermanent loss (vol-negative, price-driven). schizō unbundles them at deposit time into two transferable claims against the same position:

- **FEE-T** — the swap fees plus an upfront premium. No price risk.
- **IL-T** — the impermanent-loss P&L. Pays a premium to take it.

Every other IL hook tries to *reduce* IL. This one *separates* it, so the LP can sell the risk to someone who actually wants it. The original LP can hold both legs (a normal LP), sell IL-T (yield, no risk), or sell FEE-T (a pure volatility bet).

The IL mark is not computed on the swap path. A Reactive Smart Contract on Lasna recomputes it on every swap, against each position's own entry price, and posts it back on-chain. No keeper, no cron.

This is a working system: 45 live pools, a deployed RSC, a Supabase-backed indexer, a production frontend, and 74 passing Foundry tests (incl. fuzz + invariant).

---

## 2. Architecture

Two contracts, two chains, one event loop.

```
Sepolia · 11155111                          Reactive Lasna · 5318007
┌────────────────────────────────┐        ┌──────────────────────────────┐
│ ILBondHook                      │        │ ILBondReactive               │
│  (v4 hook + callback contract)  │ events │  (IL mark-to-market engine)  │
│                                 │───────▶│  subscribes:                 │
│  depositILBond  → mint FEE-T/IL-T│       │   SwapOccurred               │
│  buyILBond      → premium→FEE-T  │       │   PositionCreated / Exited   │
│  transferFee/ILToken            │        │   ILBondDataBundle           │
│  exitPosition / withdraw        │        │                              │
│  beforeSwap  → dynamic fee      │        │  on swap → prepareILBondData │
│  afterSwap   → SwapOccurred     │        │  on bundle → IL math, then   │
│  prepareILBondData → bundle     │◀───────│   settleILMark per position  │
│  settleILMark  ← from RSC       │ callbk │  tracks activeCount          │
└────────────────────────────────┘        └──────────────────────────────┘
```

The hook stays dumb and cheap on the hot path: `afterSwap` just emits a price snapshot. Everything expensive — decoding every position, running the IL formula — happens in the ReactVM, where it's nearly free and externally auditable.

---

## 3. The reactive loop, step by step

1. **Deposit.** LP calls `depositILBond(key, tickLower, tickUpper, liquidity, max0, max1, askPremium)`. The hook pulls tokens, mints real v4 liquidity via `unlock`/`modifyLiquidity` (salt = positionId), refunds anything unused, and records the position with `feeHolder = ilHolder = lp`. Emits `PositionCreated`.
2. **Sell the risk.** A buyer calls `buyILBond(positionId)`, paying the premium in the pool's `currency1`. IL-T moves to the buyer; the premium is credited to the current FEE-T holder's claimable balance. Emits `ILBondSold`.
3. **Swap.** Any swap on any pool triggers `afterSwap` → `SwapOccurred(poolId, sqrtPrice, tick, liquidity)`.
4. **React.** The RSC sees the swap and emits a callback `prepareILBondData`. The hook walks its active set, reads **each position's own pool price**, and emits one `ILBondDataBundle` carrying every open position.
5. **Mark.** The RSC decodes the bundle in the ReactVM, computes IL per position, and emits one `settleILMark(id, ilBps, markValue)` callback each. The hook stores the mark and emits `ILMarkUpdated`.
6. **Exit.** Any party (LP / FEE-T / IL-T holder) can `exitPosition`. Liquidity is removed and the underlying tokens are credited to the IL-T holder (they bear the composition, hence the IL). Each party `withdraw`s per token.

No timer anywhere. The mark updates exactly when price does.

---

## 4. The parts that were hard

### 4.1 Multi-pool correctness
The first version read one price (from `activePositionIds[0]`'s pool) and applied it to every position — which silently corrupts marks once positions live in different pools. The bundle now carries a per-position `currentSqrtPriceX96`, read from each position's own `poolKey`, so a swap in WBTC/WETH never mismarks a LINK/UNI position. The RSC struct, the hook struct, and the frontend decoder all mirror this layout exactly.

### 4.2 The IL math, and an overflow that would have bricked it
IL uses the standard constant-product formula, in fixed point:

```solidity
sqrtR = currentSqrt * 1e18 / entrySqrt;
// sqrtR can reach ~3.4e56 across the valid sqrtPrice range; sqrtR*sqrtR overflows uint256.
if (sqrtR >= (1 << 128)) return (-int256(BPS), 0);   // IL saturates to -100% here anyway
r        = sqrtR * sqrtR / 1e18;
ratio    = 2 * sqrtR * BPS / (1e18 + r);
ilMag    = ratio >= BPS ? 0 : BPS - ratio;
ilBps    = -int256(ilMag);                            // signed: negative = loss to IL-T holder
markValue = liquidity * (BPS - ilMag) / BPS;
```

Without the guard, an extreme divergence reverts the whole bundle and *no* position gets marked. The guard returns the correct saturated value (−100% IL) instead. Caught by the fuzz suite sweeping the full sqrt-price range.

### 4.3 Real dynamic fees
`beforeSwap` is `view` and returns `OVERRIDE_FEE_FLAG | _dynamicFee(poolId)`, where the fee is `BASE_FEE(0.30%) + volEwma / VOL_SENSITIVITY`, clamped at `MAX_FEE(3%)`. `afterSwap` updates a per-pool EWMA of `|Δtick|` (window 8). Calm pools sit at base; volatile pools ratchet up and decay back. `currentFee(poolId)` exposes it to the UI. Verified on-chain rising under load and decaying when quiet.

### 4.4 Per-token claimable accounting
Proceeds are tracked as `claimable[user][token]`, not a single struct paying both amounts in one token. This matters once pools have different token pairs and decimals — `withdraw(currency)` pays exactly that token's balance and nothing leaks across pools.

---

## 5. The platform (and a backend that earns its keep)

The frontend is a production React/Vite app (wagmi + viem + RainbowKit). Beyond the obvious pages it does a few things worth calling out:

- **Decimal-correct everywhere.** Pools span 2-, 6-, 8- and 18-decimal tokens. Prices are shown as `raw · 10^(dec0−dec1)`; deposits are entered as a real token amount and the liquidity `L` is derived from it (so an 8-decimal pool never asks for a million tokens).
- **Live IL off pool price.** The dashboard derives IL client-side from the bundle/price so it stays correct even if the RSC's settlement leg lags — the chart never freezes.
- **Backend-first data.** A Supabase indexer (`api/index-events.js`, service-role, RLS-protected) ingests the full hook-event history past the ~9500-block public-RPC log cap. Activity feeds, leaderboards, position history and pool trends all read Supabase first and fall back to on-chain only if it's unavailable.
- **Position → pool, resolved backend-first.** `PositionCreated` doesn't carry a poolId, so the indexer recovers it from `PoolManager.ModifyLiquidity` (salt = positionId) and folds it into the event's args. The app reads the pool straight from the backend — no per-load RPC scan — which is what keeps each position's price chart pinned to the *right* pool's swaps.

---

## 6. Deployment (v3, live)

| Contract | Network | Address |
|---|---|---|
| ILBondHook | Sepolia | `0x58A3A816864F1E5f6F38F01f9f5AE1Cacc9210C0` |
| ILBondReactive | Lasna | `0x27eab090BF647e191A4FB121A780aA6ED89C53E2` |
| PoolManager | Sepolia | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| Callback proxy | Sepolia | `0xc9f36411C9897e7F959D99ffca2a0Ba7ee0D7bDA` |

**45 pools** — every pair across 10 tokens (WETH, WBTC, LINK, UNI, AAVE, GHO, DAI, EURS, USDC, USDT), each a dynamic-fee pool initialized at a decimal-adjusted 1:1 and seeded with liquidity. Demo pair (in-app faucet): WBTC/WETH.

**Live positions** (LP = wallet A1, IL-T sold to A2):

| # | Pool | Notes |
|---|---|---|
| 0 | WBTC/WETH | demo pair, 8/18 decimals, IL-T sold |
| 1 | LINK/UNI | 18/18 |
| 2 | AAVE/GHO | 18/18 |

All three are marked live by the RSC and resolve their pool backend-first from Supabase.

### Second deployment — Unichain Sepolia (1301)

The exact same system was deployed, independently, on Unichain Sepolia to prove portability — a separate hook, a separate Reactive contract, fresh mock tokens, and its own pools. The frontend carries a per-chain network registry (`frontend/src/config/networks.js`) and resolves every address / token / pool / explorer from the connected wallet's chain, so the two deployments never touch each other.

| Contract | Network | Address |
|---|---|---|
| ILBondHook | Unichain Sepolia | `0x56B99A42E41D5987b2F39E97F3EBe5f3d76e10C0` |
| ILBondReactive | Lasna | `0x4F193c807b4BD93054332bc67e64428725AA107D` |
| PoolManager | Unichain Sepolia | `0x00B036B58a818B1BC34d502D3fE730Db729e62AC` |
| Callback proxy | Unichain Sepolia | `0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4` |

3 fresh mintable tokens (mWETH 18 / mWBTC 8 / mUSDC 6) → 3 pools (mWETH/mWBTC, mWETH/mUSDC, mWBTC/mUSDC), each seeded; 2 IL-bond positions opened (mWETH/mUSDC, mWBTC/mUSDC); 6+ mixed-direction swaps. Dynamic fees verified moving on-chain (e.g. mWETH/mUSDC `currentFee` 3154 pips after swaps). The hook is funded for callbacks and the RSC funded with 10 REACT. Deployed via `script/30_UnichainDeploy.s.sol` + `31_UnichainSwaps.s.sol`; the RSC via `forge create` with `destChainId = 1301`. (As with any fresh reactive deployment, the on-chain mark loop activates once the Reactive Network's origin subscription for the new chain propagates; the UI derives live IL from pool price meanwhile, so nothing reads blank.)

---

## 7. Testing

`forge test` → **74 passing, 0 failing**, across unit, fuzz, and invariant suites.

- **`ILBondHook.t.sol` (27)** — lifecycle (deposit / buy / transfer / exit / withdraw), access control on every RC-only and holder-only entrypoint, the dynamic fee (starts at base, rises with volatility, capped, per-pool isolation, decay), multi-pool bundle correctness, and fuzz over liquidity / premium / swap size.
- **`ILBondHookEdge.t.sol` (14)** — token-refund (no tokens stranded in the hook, incl. fuzz), premium routed to the *current* fee holder after a transfer, exit authorized for the IL-T buyer, active-set swap-and-pop when removing a middle element, claim accumulation across exits, bundle excludes exited positions, event emissions (PositionCreated / PoolRegistered / ILMarkUpdated), and `currentFee` on an uninitialized pool.
- **`ILReactiveMath.t.sol` (10)** — IL math fuzzed over the full sqrt-price range (sign, ≤100% bound, mark = L·(1−IL), parity, symmetry IL(r)=IL(1/r), monotonicity, extreme saturation without revert) plus the end-to-end `react()` bundle path asserting exact `settleILMark` payloads.
- **`ILReactiveLifecycle.t.sol` (11)** — `react()` routing for created/exited/unknown topics, empty-bundle handling, `persist*` callback-only access control, and `activeCount` increment/decrement with no underflow (incl. fuzz).
- **`ILBondHookInvariant.t.sol`** — handler-driven random sequences with assertions that hold over every run: active count matches the active flags, the active set is clean and unique, exited positions never reactivate and hold zero liquidity, the fee stays in `[BASE, MAX]`, and the hook is always solvent for outstanding claims.

A test-only harness subclasses the RSC to expose its internal IL math; it works because Foundry leaves the system-contract address codeless, so the reactive base detects `vm = true` and skips `service.subscribe` in the constructor.

---

## 8. Why Reactive is load-bearing

The hook alone can only act during a swap, and doing the IL math inside `beforeSwap`/`afterSwap` would tax every trade. A keeper could poll, but it burns gas on a timer whether or not price moved, and you have to trust it. The RSC fires on the swap event itself — the exact, and only, moment IL changes — computes the mark cheaply in the ReactVM, and writes it back. The two-phase relay (`prepareILBondData` → `ILBondDataBundle` → `settleILMark`) is a native pattern here and awkward-to-impossible anywhere else.

One operational lesson worth recording: the callback contract is an `AbstractPayer` and **must hold gas on the destination chain**. An unfunded hook goes into debt after the first callback and the proxy stops delivering — the mark silently stops updating. Funding the hook (and `coverDebt`) clears it. A reactive CC needs ETH on Sepolia exactly like the RSC needs REACT on Lasna.

---

## 9. Bottom line

schizō turns impermanent loss from a uniform tax on LP capital into a tradable instrument with two sides: yield seekers buy FEE-T, volatility takers buy IL-T, and the price of risk is discovered bilaterally at mint. Uniswap v4 handles settlement; Reactive Network keeps the risk leg honest on every swap, autonomously. The split has never been done in v4 — and it can't be done well without Reactive.

---

*Built for UHI9. Uniswap v4 + Reactive Network.*
