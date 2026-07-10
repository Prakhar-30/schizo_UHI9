# ILBondHook: Implementation Status

> Living status doc for the FEE-T / IL-T split in `src/ILBondHook.sol`.
> Originally written 2026-06-26 as a list of deferred work; updated 2026-07-08
> after the audit/hardening pass (v4) and 2026-07-09 after the self-marking
> rewrite (contract v5: the external marking engine is gone, marks derive
> in-hook).

The headline promise: each LP position is unbundled into
- **FEE-T** = claim on **swap fees + upfront premium** (the hedged yield leg)
- **IL-T**  = claim on the **underlying principal** (the risk leg an underwriter takes on)

---

## Status today (contract v5, this repo)

| Piece | State | Where |
|---|---|---|
| Role split (feeHolder / ilHolder addresses) | done | `Position` struct |
| Counterparty buys the IL leg, pays premium | done | `buyILBond` |
| Premium credited to the current FEE-T holder | done | `buyILBond` |
| **Swap fees routed to the FEE-T holder at exit** | **done (v4)** | `exitPosition` splits `feesAccrued` from principal |
| **On-demand fee harvest without closing** | **done (v4)** | `collectFees` (zero-delta poke) |
| Principal (the IL outcome) to the IL-T holder at exit | done | `exitPosition` |
| **Protocol-quoted premium (ask = 0 auto-quotes)** | **done (v4)** | `quotePremium`: vol EWMA × range × notional, clamped |
| **Manipulation-resistant mark** | **done (v4)** | EWMA-smoothed marking tick; nothing stored to poison |
| **Self-marking: IL derived in-hook, no external engine** | **done (v5)** | `ilMark` / `computeILMark` / `markSqrtPriceX96`; `SwapOccurred` carries the mark |
| Full-range enforcement (keeps the closed-form mark exact) | done (v4) | `depositILBond` reverts `FullRangeOnly` |
| Native-ETH pools (deposit / refund / withdraw) | done (v4) | payable deposit, `_pay` native path |
| Solvency guard on deposit | done (v4) | reverts if a mint would spend other users' custody |
| Return-data-checked ERC20 transfers | done (v4) | `_safeTransfer` / `_safeTransferFrom` |
| Exit rights restricted to current leg holders | done (v4) | LP loses control after transferring both legs |
| Dynamic volatility fee | done | `_beforeSwap` / `_dynamicFee` |
| **Mark-to-market drives settlement** | **open (next protocol version)** | see Change 2 below |

Test suite: 72 passing (`forge test`), including fee routing, the smoothed mark,
the derived mark (multi-pool isolation, inactive reads zero), auto-quote
monotonicity, native pools, and the fuzz + invariant suites (now including a
derived-mark boundedness invariant).

Deployment is one contract per chain: `script/25_FreshDeploy.s.sol` (Sepolia) /
`script/30_UnichainDeploy.s.sol` (Unichain Sepolia). Nothing else to deploy,
fund, or register.

---

## Change 2 (open): make the IL mark economically binding

### Problem
`ilMark` derives a live `ilBps` + `markValue` for every position, but no
settlement logic reads them. Exit settles from the real underlying, which is
honest ground truth, so nothing is wrong today; the mark is a live price, not a
margin engine. Making it binding is what turns the hedge from "settled at close"
into "settled continuously."

### What "binding" means
Two coherent designs; pick one before writing code:

**Option 2a: cash-settled IL protection (recommended).**
The premium is the protection fee. At exit, if realized IL exceeds a strike, the
protected side is topped up from posted collateral. Requires:
- A collateral/escrow buffer posted at `depositILBond` or by the IL-T buyer.
- Settlement math at exit using entry vs exit `sqrtPriceX96` (recompute on-chain
  via `computeILMark`, which is already pure and exact for full range).
- Bounds so neither side can be drained beyond posted collateral.

**Option 2b: streaming premium (funding-style).**
Instead of margin transfers, stream the premium continuously between the legs at
a rate set by the live mark. Pairs naturally with the `collectFees` plumbing that
already exists. Cheaper to build than 2a and gives continuous price discovery.

### Notes
- Realized IL is deterministic from `entrySqrtPriceX96` vs exit price for
  full-range positions (`lib/il.js` mirrors the exact formula frontend-side).
- Whatever design wins, exit must recompute from on-chain state rather than
  trust a stale mark.

---

## Premium model v2 (open, after Change 2)

`quotePremium` v1 is a deliberately conservative first-order model:
`clamp(volEwma × K × TICK_NORM / rangeTicks) × notional1`. Improvements, in order:

1. Annualize the vol EWMA and price the leg as a short straddle over an assumed
   horizon: `premium ≈ notional × σ × sqrt(horizon) × c`.
2. Re-quote at purchase time (`buyILBond` charges the current fair quote, not the
   deposit-time one) so stale asks can't be sniped.
3. Streaming premium (see Change 2b) for perpetual positions, so price discovery
   is continuous instead of a lump sum.

Calibration data: the `test/ILMarkMath.t.sol` realized-IL numbers and the pools'
observed volEwma under the swap scripts.

---

## Positioning note (non-code)

The product is an **IL hedging market**: LPs hedge out impermanent loss and keep
the yield; underwriters (long-vol desks, range-bound funds, books with opposite
AMM exposure) earn a volatility-linked premium for warehousing it. Say
"hedge" and "underwrite," not "bet" and "speculate." The make-or-break for a real
two-sided market is premium price discovery, which is why Change 2b / premium v2
are the priority once redeployment lands.
