# schizō — Impermanent loss, unbundled

**Every LP position is two trades stapled together. We finally let you sell one of them.**

Live: https://schizo-il-bond.vercel.app · UHI9 (Theme: Impermanent Loss) · Uniswap v4 + Reactive Network

---

## Why this project was needed

Impermanent loss is the single biggest reason capital doesn't stay in AMMs. But look at what an LP position actually *is*: two opposite exposures forced into one token.

- **Fee income** — steady, grows with volume, vol-positive.
- **Impermanent loss** — the bill when price moves, vol-negative.

These attract completely different people. A DAO treasury or a stablecoin desk wants the yield and would happily pay to never touch the price risk. A volatility trader wants exactly that price risk and has no interest in babysitting an LP. Yet Uniswap forces both into the identical bundle — so the treasury sits out (too risky) and the trader sits out (too much overhead). Liquidity that *should* exist never shows up.

The entire IL field so far has tried to **shrink** the bill — dynamic fees, rebalancing, insurance pools, LVR auctions. That's treating a symptom. The real problem is that **the risk can't be moved to the person who wants it.** Nobody had built the market.

**schizō builds it.** At deposit, the position splits into two transferable claims:

| | holds | price risk | for |
|---|---|---|---|
| **FEE-T** | swap fees **+** upfront premium | **none** | yield seekers, treasuries, passive LPs |
| **IL-T** | the impermanent-loss P&L (for or against) | **all of it** | volatility traders, hedgers, speculators |

IL stops being a uniform tax on LP capital and becomes a **priced, tradable instrument**. That's the difference between tranching a bond and inventing the credit-default swap.

## Who it's for

- **LPs who want yield, not exposure** — DAO treasuries, stablecoin desks, conservative LPs. Mint, sell IL-T, collect fees + premium with the price risk gone.
- **Volatility traders** — buy IL-T for a cheap, capital-efficient, *leveraged* bet on divergence. Sell FEE-T too and it's a pure vol position with no fee drag.
- **Hedgers** — anyone with offsetting AMM exposure who wants to lay off (or take on) IL directly instead of through a clunky options wrapper.
- **Uniswap itself** — deeper liquidity, because capital that previously refused the bundle can now hold exactly the half it wants.

## What it does (the working)

1. **Deposit.** An LP calls `depositILBond` with a pool, range, and an asking premium. The hook pulls tokens, mints **real full-range v4 liquidity** through `unlock`/`modifyLiquidity` (salt = positionId), refunds the dust, and issues **FEE-T + IL-T** to the LP.
2. **Sell the risk.** A buyer calls `buyILBond`, paying the premium in the pool's quote token. IL-T transfers to them; the premium is credited to whoever currently holds FEE-T. Bilateral — no insurance pool, no protocol float.
3. **Mark, on every swap.** Any swap emits `SwapOccurred`. A Reactive Smart Contract reacts, pulls a bundle of every open position at *its own pool's* live price, computes `IL = 1 − 2√r/(1+r)` in the ReactVM, and writes the mark back on-chain. No keeper, no cron — the mark moves exactly when price moves.
4. **Exit & settle.** Any party can exit. Liquidity is removed and the underlying is credited to the IL-T holder (they bear the composition — that *is* the IL); everyone withdraws their own balance per token.

Pools also charge a **genuinely dynamic fee**: `0.30% + f(realized volatility)`, capped at 3%, from an on-chain EWMA of tick movement — LPs get paid more precisely when IL risk is highest.

## The complexity of the architecture

This is a three-layer, cross-chain system held together by one event loop — not a single contract.

```
SETTLEMENT (Uniswap v4)        BRAINS (Reactive Network)        PRODUCT (backend + app)
Sepolia / Unichain Sepolia     Reactive Lasna · ReactVM         Vercel + Supabase + React
ILBondHook + PoolManager  ──▶  ILBondReactive (1 per chain) ──▶ indexer → Supabase → frontend
  afterSwap: SwapOccurred         on swap → ask for bundle         backend-first reads
  prepareILBondData (callback)    compute IL per position          per-chain registry
  settleILMark (callback)         settleILMark back                live OG share cards
```

The hard parts that make it more than a demo:

- **The mark can't live on the swap path.** Doing IL math in `beforeSwap`/`afterSwap` taxes every trade; a keeper burns gas on a timer and must be trusted. The RSC fires on the swap event itself — the exact, and only, moment IL changes — and computes it cheaply off the hot path. The two-phase relay (`prepareILBondData → ILBondDataBundle → settleILMark`) is native to Reactive and awkward-to-impossible anywhere else.
- **Multi-pool correctness.** The bundle carries a **per-position** `currentSqrtPriceX96` read from each position's own pool, so a WBTC/WETH swap never mismarks a LINK/UNI position. The RSC struct, the hook struct, and the frontend decoder mirror the layout exactly.
- **An overflow that would have bricked it.** `sqrtR²` overflows uint256 at extreme divergence; without a guard the whole bundle reverts and *no* position gets marked. A saturation guard returns the correct −100% instead. Caught by the fuzz suite.
- **Decimal-correct across 2/6/8/18.** 45 pools across 10 tokens. Prices render as `raw · 10^(dec0−dec1)`; deposits are entered as real token amounts and `L` is derived — an 8-decimal pool never asks for a million tokens.
- **A backend that earns its keep.** Public RPCs cap `getLogs` to ~9,500 blocks. A multi-chain Supabase indexer ingests the full history (recovering each position's poolId from `PoolManager.ModifyLiquidity`, since `PositionCreated` doesn't carry it), so charts/feeds/leaderboards are complete and fast, with on-chain reads only as a fallback.
- **Deployed twice, independently.** The same system runs on Ethereum Sepolia *and* Unichain Sepolia — separate hooks, separate RSCs, separate tokens — with the frontend switching every address by the connected wallet's chain.

## What was used, why, and how it helped

| Used | Why | Benefit |
|------|-----|---------|
| **Uniswap v4 hooks** | `beforeSwap`/`afterSwap` are the only place to inject dynamic fees and emit price truth at the source | real liquidity + settlement for free; the split rides on actual v4 positions, not a synthetic wrapper |
| **Reactive Network (RSC on Lasna)** | IL must be re-marked on *every* swap, per position, trustlessly and off the hot path | no keeper, no cron, no trust; swaps stay cheap; the IL leg stays honest automatically — the product can't exist without it |
| **ReactVM fixed-point IL math** | run `1 − 2√r/(1+r)` where it's nearly free and externally auditable | accurate, gas-light marks; overflow-guarded over the full price range |
| **Supabase + serverless indexer** | RPC log windows are too short for full history; charts must not freeze | complete, fast, backend-first data; multi-chain, RLS-protected, deployment-isolated by `hook_address` |
| **React + wagmi/viem + RainbowKit** | a real product, not a script | chain-aware UX: connect a wallet and the whole app reconfigures to that chain |
| **Foundry (fuzz + invariant)** | a financial primitive must be provably safe | **74 passing tests** — lifecycle, access control, dynamic fee, multi-pool, solvency, and the IL math fuzzed across the entire sqrt-price range |

## It's real, and it's running

Not a slide deck. Live on **two chains**, end to end:

- LPs mint FEE-T + IL-T from real v4 deposits, decimal-correct across every pool.
- A second wallet buys the IL-T leg; the premium is paid bilaterally.
- The RSC marks every open position to its own pool's price on every swap — observable live (the on-chain bundle counter ticks up one-for-one with swaps).
- Dynamic fees verified climbing under load and decaying when calm.
- **74 passing Foundry tests**, including fuzz and invariant suites.

## Where it goes

- **Tranche IL-T** — a senior leg eating the first 5% of IL, a junior leg eating the rest: two risk-adjusted yields from one position.
- **Vol-priced premiums** — quote the premium straight off the volatility EWMA the hook already tracks, turning the manual ask into a self-pricing market.
- **Cross-pool IL netting** — the RSC already sees every pool; let one IL-T cover a user's *net* exposure across correlated pools.
- **IL futures** — a dated IL-T: pure speculation on next-epoch IL versus a strike.

---

*schizō — built for UHI9. Uniswap v4 for settlement, Reactive Network for the brains. Testnet only — not financial advice.*
