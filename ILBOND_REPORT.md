# schizō / ILBondHook: Technical Report

**Splitting a Uniswap v4 LP position into a hedged yield leg (FEE-T) and a risk leg (IL-T), marked to market by the hook itself on every swap.**

Author: Prakhar Srivastava · UHI9 (Theme: Impermanent Loss)
Networks: Ethereum Sepolia (11155111) + Unichain Sepolia (1301)
Live app: https://schizo-il-bond.vercel.app

---

## 1. What this is

A normal LP position bundles two unrelated exposures: fee income (steady, volume-driven) and impermanent loss (price-driven). schizō unbundles them at deposit time into two transferable claims against the same position:

- **FEE-T**: the swap fees plus an upfront premium. No price risk. This is the hedged LP.
- **IL-T**: the LP principal and its impermanent-loss outcome. Collects the premium for warehousing the risk. This is the underwriter.

Every other IL hook tries to *reduce* IL. This one lets the LP *hedge* it: sell the risk leg, whole, to a counterparty who priced it and wanted it. The LP keeps yield with the risk gone; the underwriter earns a volatility-linked premium, the same trade insurers have run for centuries.

The IL mark is never computed on the swap path and never stored. The hook maintains an EWMA-smoothed marking price per pool (updated in `afterSwap`, two storage writes) and derives each position's IL from it at read time with a public pure function. No keeper, no cron, no oracle, no second network. The UHI9 judge called the result "a live, tradeable bond instead of a number you only learn at exit."

This is a working system: one self-contained contract, 45 live pools, a Supabase-backed indexer, a production frontend, and 72 passing Foundry tests (incl. fuzz + invariant).

---

## 2. Architecture

One contract. The hook is the settlement layer, the pricing engine, and the marking engine at once.

```
Sepolia 11155111 / Unichain Sepolia 1301
┌──────────────────────────────────────────────┐
│ ILBondHook  (the entire protocol)            │
│                                              │
│  depositILBond → mint FEE-T + IL-T           │
│  buyILBond     → premium → FEE-T holder      │
│  collectFees   → fees    → FEE-T holder      │
│  exitPosition  → fees→FEE-T · principal→IL-T │
│  withdraw      → per-token claims            │
│                                              │
│  beforeSwap → dynamic fee (vol EWMA)         │
│  afterSwap  → smoothed marking price (EWMA)  │
│              emits SwapOccurred(px, markPx)  │
│                                              │
│  ilMark(id)      → live IL, derived [view]   │
│  computeILMark   → 1 − 2√r/(1+r)     [pure]  │
│  quotePremium    → on-chain hedge price      │
└──────────────────────────────────────────────┘
```

The hot path stays dumb and cheap: `afterSwap` updates two EWMAs (the volatility fee and the smoothed mark) and emits one event. The expensive part, the square-root IL formula, runs at **read** time as a `view`, where it costs traders nothing and is fresh on every call.

---

## 3. The marking loop, step by step

1. **Deposit.** LP calls `depositILBond(key, tickLower, tickUpper, liquidity, max0, max1, askPremium)`. The hook pulls tokens, mints real v4 liquidity via `unlock`/`modifyLiquidity` (salt = positionId), refunds anything unused, and records the position with `feeHolder = ilHolder = lp` plus the pool's current sqrt price as the entry. An ask of 0 makes the protocol quote the premium itself via `quotePremium` (realized-vol EWMA × range width × token1 notional, clamped). Full range is enforced so the closed-form mark is exact. Emits `PositionCreated`.
2. **Transfer the risk.** A counterparty calls `buyILBond(positionId)`, paying the premium in the pool's `currency1`. IL-T moves to the buyer; the premium is credited to the current FEE-T holder's claimable balance. Emits `ILBondSold`. From this moment the LP is hedged.
3. **Swap.** Any swap on any pool triggers `afterSwap`, which updates the pool's volatility EWMA and nudges its smoothed marking tick a quarter of the way toward the new price, then emits `SwapOccurred(poolId, sqrtPrice, tick, liquidity, markSqrtPrice)`. The event carries the marking price, so indexers rebuild the full IL history from swap logs alone.
4. **Mark.** There is no step 4. `ilMark(positionId)` derives the live IL from the position's entry price and its own pool's smoothed mark whenever anyone asks: the app, an indexer, or another contract. Always fresh, never stale, nothing to run.
5. **Collect and exit.** `collectFees` harvests accrued swap fees to the FEE-T holder any time. A current leg holder can `exitPosition`: the hook splits `feesAccrued` from principal, credits fees to the FEE-T holder and the underlying to the IL-T holder (their composition *is* the IL outcome). Each party `withdraw`s per token.

No timer anywhere. The mark moves exactly when price does, because the hook *is* where price moves.

---

## 4. The parts that were hard

### 4.1 Getting the marking engine out of the architecture entirely
The hackathon build marked positions with an external event-driven contract on a second network, subscribed to the hook's swap events. It worked, but it carried three liveness assumptions: a callback relay, a funded gas balance on both chains, and a subscription that had to propagate. The v5 insight is that a v4 hook already *is* the event listener: `afterSwap` fires on exactly the events the external engine subscribed to, so the smoothing EWMA belongs in the hook, and the IL number itself doesn't need to be written anywhere, it can be **derived** at read time. That deletion removed every liveness assumption, an entire contract, a funding requirement, and a cross-chain relay, and made the marks strictly fresher (as-of the last swap, not as-of the last callback).

### 4.2 Multi-pool correctness
An early version read one marking price and applied it to every position, which silently corrupts marks once positions live in different pools. Now each position derives its mark from **its own pool's** `poolFeeState`, keyed by the position's stored `poolKey`, so a swap in WBTC/WETH never mismarks a LINK/UNI position. Proven by a dedicated multi-pool isolation test.

### 4.3 The IL math, and an overflow that would have bricked it
IL uses the standard constant-product formula, in fixed point, as a `public pure` function (`computeILMark`) anyone can call to verify a mark:

```solidity
sqrtR = currentSqrt * 1e18 / entrySqrt;
// sqrtR can reach ~3.4e56 across the valid sqrtPrice range; sqrtR*sqrtR overflows uint256.
if (sqrtR >= (1 << 128)) return (-int256(BPS), 0);   // IL saturates to -100% here anyway
r        = sqrtR * sqrtR / 1e18;
ratio    = 2 * sqrtR * BPS / (1e18 + r);
ilMag    = ratio >= BPS ? 0 : BPS - ratio;
ilBps    = -int256(ilMag);                            // signed: negative = loss borne by IL-T holder
markValue = liquidity * (BPS - ilMag) / BPS;
```

Without the guard, an extreme divergence reverts the mark exactly when it matters most. The guard returns the correct saturated value (−100% IL) instead. Caught by the fuzz suite sweeping the full sqrt-price range. The hook enforces full-range deposits, so this closed-form formula is exact for every position it prices.

### 4.4 A mark that can't be placed by one transaction
The judges' one open question was whether a same-transaction price move could skew the mark. It can't, for two independent, structural reasons:

- The hook marks against a **smoothed tick**, an EWMA with window 4 updated in `afterSwap`. One swap moves the marking price a quarter of the way to its own price, no further.
- The mark is **derived, not stored**. There is no per-position mark in storage to poison, and no settlement transaction to front-run or starve. `ilMark` recomputes from the smoothed price on every read.

Together: to bias a mark, an attacker must move the pool and hold it there across many swaps, paying arbitrageurs for every block the price stays wrong, to shift an EWMA fractionally.

### 4.5 Real fee routing (the split is now literal)
`modifyLiquidity` returns principal and `feesAccrued` fused in one delta. The hook captures both return values, so at exit the two claims split exactly: fees to the FEE-T holder, principal to the IL-T holder. `collectFees` pokes the position with a zero delta to harvest fees on demand without closing it. A solvency guard in deposit reverts if a mint would consume more than the deposit brought in, so one user's deposit can never dip into tokens the hook holds for other users' claims.

### 4.6 Real dynamic fees
`beforeSwap` is `view` and returns `OVERRIDE_FEE_FLAG | _dynamicFee(poolId)`, where the fee is `BASE_FEE(0.30%) + volEwma / VOL_SENSITIVITY`, clamped at `MAX_FEE(3%)`. `afterSwap` updates a per-pool EWMA of `|Δtick|` (window 8). Calm pools sit at base; volatile pools ratchet up and decay back. `currentFee(poolId)` exposes it to the UI. Verified on-chain rising under load and decaying when quiet.

### 4.7 Per-token claimable accounting
Proceeds are tracked as `claimable[user][token]`, not a single struct paying both amounts in one token. This matters once pools have different token pairs and decimals: `withdraw(currency)` pays exactly that token's balance and nothing leaks across pools. Withdrawals are return-data-checked for ERC20s and use a native call for ETH, so a claim can never be burned without the tokens actually moving.

---

## 5. The platform (and a backend that earns its keep)

The frontend is a production React/Vite app (wagmi + viem + RainbowKit). Beyond the obvious pages it does a few things worth calling out:

- **Decimal-correct everywhere.** Pools span 2-, 6-, 8- and 18-decimal tokens. Prices are shown as `raw · 10^(dec0−dec1)`; deposits are entered as a real token amount and the liquidity `L` is derived from it (so an 8-decimal pool never asks for a million tokens).
- **Live IL from two independent paths.** Cards derive IL client-side from the live pool price, and `getPosition`/`ilMark` return the hook's smoothed mark. The two agree within smoothing lag, each verifiable against the other, and the chart never freezes.
- **Backend-first data.** A Supabase indexer (`api/index-events.js`, service-role, RLS-protected) ingests the full hook-event history past the ~9500-block public-RPC log cap. Activity feeds, leaderboards, position history and pool trends all read Supabase first and fall back to on-chain only if it's unavailable.
- **IL history from swap events alone.** `SwapOccurred` carries the smoothed marking price, so a position's full mark history is `computeIL(entry, markSqrtPrice)` over its pool's swap log. Trustless, reproducible, no privileged data source.
- **Position to pool, resolved backend-first.** `PositionCreated` doesn't carry a poolId, so the indexer recovers it from `PoolManager.ModifyLiquidity` (salt = positionId) and folds it into the event's args. The app reads the pool straight from the backend, no per-load RPC scan, which is what keeps each position's price chart pinned to the *right* pool's swaps.

---

## 6. Deployment (live)

Deployment is **one contract per chain**. No registration, no funding, no companion services.

| Contract | Network | Address |
|---|---|---|
| ILBondHook | Sepolia | `0x57696AB5077Aa634c13682C3d3E84287935290c0` |
| PoolManager | Sepolia | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |

**45 pools**: every pair across 10 tokens (WETH, WBTC, LINK, UNI, AAVE, GHO, DAI, EURS, USDC, USDT), each a dynamic-fee pool initialized at a decimal-adjusted 1:1 and seeded with liquidity. Demo pair (in-app faucet): WBTC/WETH.

### Second deployment: Unichain Sepolia (1301)

The exact same system was deployed, independently, on Unichain Sepolia to prove portability: a separate hook, fresh mock tokens, and its own pools. The frontend carries a per-chain network registry (`frontend/src/config/networks.js`) and resolves every address / token / pool / explorer from the connected wallet's chain, so the two deployments never touch each other.

| Contract | Network | Address |
|---|---|---|
| ILBondHook | Unichain Sepolia | `0x20487A756FececfF800d15EC76C78e0487A2D0c0` |
| PoolManager | Unichain Sepolia | `0x00B036B58a818B1BC34d502D3fE730Db729e62AC` |

3 fresh mintable tokens (mWETH 18 / mWBTC 8 / mUSDC 6), 3 pools (mWETH/mWBTC, mWETH/mUSDC, mWBTC/mUSDC), each seeded; 2 IL-bond positions opened (mWETH/mUSDC, mWBTC/mUSDC). Dynamic fees verified moving on-chain. Deployed via `script/30_UnichainDeploy.s.sol` + `31_UnichainSwaps.s.sol`.

---

## 7. Testing

`forge test` → **72 passing, 0 failing**, across unit, fuzz, and invariant suites.

- **`ILBondHook.t.sol`**: lifecycle (deposit / buy / transfer / exit / withdraw), fee routing (fees to FEE-T, principal to IL-T, `collectFees` harvest and its idempotence), the smoothed mark (one swap can never set it to spot), the derived mark (each position marks off its own pool; `getPosition` and `ilMark` agree; inactive positions read zero), the premium auto-quote (never zero, rises with volatility), full-range enforcement, native-ETH pool deposit/exit/withdraw, access control on every holder-only entrypoint, the dynamic fee (starts at base, rises with volatility, capped, per-pool isolation, decay), and fuzz over liquidity / premium / swap size.
- **`ILBondHookEdge.t.sol`**: token-refund (no tokens stranded in the hook, incl. fuzz), premium *and* exit fees routed to the *current* fee holder after a transfer, the LP losing exit rights after transferring both legs, exit authorized for the IL-T buyer, active-set swap-and-pop when removing a middle element, claim accumulation across exits, exited positions dropping out of marking, event emissions, and `currentFee` on an uninitialized pool.
- **`ILMarkMath.t.sol`**: the IL formula (`computeILMark`) fuzzed over the full sqrt-price range: sign (never a gain), ≤100% bound, mark = L·(1−IL) consistency, parity zero, zero-input safety, symmetry IL(r)=IL(1/r), monotonicity in divergence (point + fuzz), and extreme saturation without revert.
- **`ILBondHookInvariant.t.sol`**: handler-driven random sequences with assertions that hold over every run: active count matches the active flags, the active set is clean and unique, exited positions never reactivate and hold zero liquidity, the fee stays in `[BASE, MAX]`, every active position's derived mark stays bounded (0 ≥ IL ≥ −100%, markValue ≤ liquidity), and the hook is always solvent for outstanding claims.

Because `computeILMark` is `public pure`, the math suite deploys the hook with a placeholder PoolManager and calls the formula directly, the same function production marks flow through, with no harness or subclassing needed.

---

## 8. Why in-hook marking is load-bearing

IL only changes when price changes, and price only changes on a swap through the hook. So the hook is, by construction, the first and only witness to every marking event. Anything else, a keeper, an oracle, an external event-driven network, re-derives that same information later, with an added liveness assumption and something to fund or trust. Moving the mark into the hook is not a simplification of the product; it *is* the product insight: the venue that creates the risk re-prices it, atomically with the trade that moved it, and exposes it as a pure function of its own state.

The cost side holds up too: the swap path gained nothing (the smoothing EWMA replaced event-payload bookkeeping of the old design), and reads are free. There is no scenario where the mark is stale, unfunded, or waiting on a relay, because there is no relay.

---

## 9. Bottom line

schizō turns impermanent loss from a uniform tax on LP capital into a two-sided risk-transfer market: LPs hedge out the loss and keep the yield, underwriters earn a volatility-linked premium for warehousing the risk, and the price of that transfer is quoted by the protocol itself from live pool state. One Uniswap v4 hook handles settlement, pricing, and marking, autonomously and trustlessly. The split has never been done in v4, and doing it in a single self-contained contract is what makes it credible.

---

*Built for UHI9. One Uniswap v4 hook, zero dependencies.*
