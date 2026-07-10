# schizō: Hedge impermanent loss. Keep the yield.

**Every LP position is two trades stapled together. We finally let you sell the one you never wanted.**

Live: https://schizo-il-bond.vercel.app · UHI9 (Theme: Impermanent Loss) · Uniswap v4

---

## Why this project was needed

Impermanent loss is the single biggest reason capital doesn't stay in AMMs. But look at what an LP position actually *is*: two opposite exposures forced into one token.

- **Fee income**: steady, grows with volume.
- **Impermanent loss**: the bill when price moves.

These belong to different owners. A DAO treasury or a stablecoin desk wants the yield and would happily pay to make the price risk go away. A market-making desk running a long-volatility options book wants exactly that risk, because a short-gamma leg at a discount offsets what their book bleeds in theta. Yet Uniswap forces both into the identical bundle, so the treasury sits out (too risky) and the desk sits out (wrong instrument). Liquidity that *should* exist never shows up.

The entire IL field so far has tried to **shrink** the bill: dynamic fees, rebalancing, insurance pools, LVR auctions. That treats a symptom. The real problem is that **the risk can't be moved to the party who wants to hold it.** Nobody had built the transfer market.

**schizō builds it.** At deposit, the position splits into two transferable claims:

| | holds | price risk | for |
|---|---|---|---|
| **FEE-T** | swap fees **+** upfront premium | **none** | the hedged LP: treasuries, desks, passive capital |
| **IL-T** | the LP principal and its IL outcome | **all of it** | underwriters: long-vol desks, funds earning risk premium |

Fixed income did this when it stripped bonds into principal and coupon. Pendle did it for yield. schizō does it for impermanent loss: **IL stops being a tax on LP capital and becomes a hedge one side buys and a premium the other side earns.**

## Who it's for

- **LPs who want yield, not exposure.** DAO treasuries, stablecoin desks, conservative LPs. Mint, sell IL-T, collect fees plus premium, and the price risk is genuinely gone, not softened.
- **Underwriters.** Desks with long-gamma options books buy IL-T because its short-gamma payoff offsets their theta bill. Funds that expect range-bound markets underwrite IL to earn the premium, the same trade insurance companies have run profitably for centuries.
- **Anyone with offsetting AMM exposure.** If your book is already exposed to divergence in the other direction, IL-T is a direct, capital-efficient hedge with no options wrapper in the way.
- **Uniswap itself.** Deeper liquidity, because capital that refused the bundle can now hold exactly the half it wants.

## What it does (the working)

1. **Deposit.** An LP calls `depositILBond` with a pool and a size. The hook pulls tokens, mints **real full-range v4 liquidity** through `unlock`/`modifyLiquidity` (salt = positionId), refunds the dust, and issues **FEE-T + IL-T** to the LP. Pass an ask of zero and the protocol quotes the premium itself, on-chain, from live realized volatility and the position's notional.
2. **Transfer the risk.** A counterparty calls `buyILBond`, paying the premium in the pool's quote token. IL-T transfers to them; the premium is credited to whoever currently holds FEE-T. Bilateral, no insurance pool, no protocol float.
3. **Mark, on every swap.** The hook keeps an EWMA-smoothed marking price per pool, nudged in `afterSwap` (two storage writes). Each position's IL derives from that mark at read time with one pure function: `IL = 1 − 2√r/(1+r)`. No keeper, no cron, no oracle, nothing off-chain at all. The risk leg trades like a live bond because it is re-priced like one, by the pool itself.
4. **Collect and exit.** The FEE-T holder can harvest accrued swap fees any time with `collectFees`. At exit, the hook splits the withdrawal exactly: fees to the FEE-T holder, principal to the IL-T holder. The composition the IL-T holder receives *is* the impermanent-loss outcome; nothing is synthetic.

Pools also charge a **genuinely dynamic fee**: `0.30% + f(realized volatility)`, capped at 3%, from an on-chain EWMA of tick movement. LPs get paid the most exactly when IL risk is highest.

## The mark can't be gamed

This was the one open question from the UHI9 judges, and it's now answered in-protocol, twice over:

- **The marking price is smoothed.** The hook keeps an EWMA of the tick per pool; one swap moves the marking price only a quarter of the way to its own price. A flash move inside a single transaction cannot place the mark.
- **The mark is never stored, only derived.** There is no per-position mark sitting in storage to poison and no settlement transaction to front-run. `ilMark` recomputes from the smoothed price on every read, so the only way to skew it is to hold a distorted price across many swaps while arbitrageurs eat you alive.

Continuous, per-swap marking was already harder to game than a single exit snapshot. With smoothing plus derivation, a same-transaction price move is structurally unable to touch the mark.

## The elegance of the architecture

The whole protocol is **one contract**. Not a stack of services with a contract at the bottom, one v4 hook that settles, prices, and marks by itself.

```
ON-CHAIN (Uniswap v4)               PRODUCT (backend + app)
Sepolia / Unichain Sepolia          Vercel + Supabase + React
ILBondHook + PoolManager       ──▶  indexer → Supabase → frontend
  beforeSwap: dynamic fee EWMA        backend-first reads
  afterSwap: smoothed mark EWMA       per-chain registry
  ilMark(id): IL derived, pure        live OG share cards
```

The hard parts that make it more than a demo:

- **The expensive math never touches the swap path.** Doing square-root IL math in `afterSwap` would tax every trade; a keeper burns gas on a timer and must be trusted; an oracle adds a dependency. The trick: `afterSwap` only *smooths the price* (two storage writes), and the IL formula runs at **read time** as a `view`, where it costs traders nothing and is always fresh. The hook is its own oracle because every price change is, by definition, a swap through it.
- **Multi-pool correctness.** Every position derives its mark from **its own pool's** smoothed price, so a WBTC/WETH swap never mismarks a LINK/UNI position. Proven by a dedicated multi-pool isolation test.
- **An overflow that would have bricked it.** `sqrtR²` overflows uint256 at extreme divergence; without a guard the mark reverts exactly when it matters most. A saturation guard returns the correct −100% instead. Caught by the fuzz suite.
- **Real fee accounting.** `modifyLiquidity` returns principal and `feesAccrued` fused together; the hook splits them so the yield leg is a true claim on fees, at exit and on demand via `collectFees`, with a solvency guard so no deposit can ever dip into tokens held for other users' claims.
- **Decimal-correct across 2/6/8/18.** 45 pools across 10 tokens. Prices render as `raw · 10^(dec0−dec1)`; deposits are entered as real token amounts and `L` is derived. An 8-decimal pool never asks for a million tokens.
- **A backend that earns its keep.** Public RPCs cap `getLogs` to ~9,500 blocks. A multi-chain Supabase indexer ingests the full history (recovering each position's poolId from `PoolManager.ModifyLiquidity`, since `PositionCreated` doesn't carry it), so charts, feeds and leaderboards are complete and fast, with on-chain reads only as a fallback.
- **Deployed twice, independently.** The same system runs on Ethereum Sepolia *and* Unichain Sepolia: separate hooks, separate tokens, with the frontend switching every address by the connected wallet's chain. Deployment is one contract per chain, nothing else to stand up.

## What was used, why, and how it helped

| Used | Why | Benefit |
|------|-----|---------|
| **Uniswap v4 hooks** | `beforeSwap`/`afterSwap` are the only place to inject dynamic fees and observe price truth at the source | real liquidity + settlement for free; the split rides on actual v4 positions, not a synthetic wrapper |
| **In-hook smoothed marking** | the risk leg must be re-priced on *every* swap, per position, trustlessly and off the hot path | no keeper, no cron, no oracle, no funding; swaps stay cheap; the hedge prices itself with zero liveness assumptions |
| **Pure on-chain IL math** | `1 − 2√r/(1+r)` as a `public pure` function anyone can call | accurate, gas-free marks at read time; overflow-guarded over the full price range; externally verifiable with one call |
| **Supabase + serverless indexer** | RPC log windows are too short for full history; charts must not freeze | complete, fast, backend-first data; multi-chain, RLS-protected, deployment-isolated by `hook_address` |
| **React + wagmi/viem + RainbowKit** | a real product, not a script | chain-aware UX: connect a wallet and the whole app reconfigures to that chain |
| **Foundry (fuzz + invariant)** | a financial primitive must be provably safe | **72 passing tests**: lifecycle, fee routing, access control, the smoothed mark, multi-pool isolation, solvency, native-ETH pools, and the IL math fuzzed across the entire sqrt-price range |

## It's real, and it's running

Not a slide deck. Live on **two chains**, end to end:

- LPs mint FEE-T + IL-T from real v4 deposits, decimal-correct across every pool.
- A second wallet takes the IL-T leg; the premium is paid bilaterally and lands with the FEE-T holder.
- Every open position is marked to its own pool's smoothed price, live on every read; the mark moves one-for-one with swaps and anyone can verify it with a single `view` call.
- Dynamic fees verified climbing under load and decaying when calm.
- **72 passing Foundry tests**, including fuzz and invariant suites.

## Where it goes

- **Streaming premiums.** Today the premium is a lump sum at purchase, quoted on-chain from realized volatility. Next: a funding-style stream between the legs, so the hedge re-prices continuously. The `collectFees` plumbing this needs already exists.
- **Binding mark-to-market settlement.** Let the hook's live mark move margin between the legs before exit, so the hedge pays out continuously instead of at close.
- **Tranched risk.** A senior IL-T eating the first 5% of IL and a junior eating the rest: two risk-adjusted premiums from one position.
- **Cross-pool IL netting.** The hook already marks every pool it runs; one IL-T could hedge a book's *net* divergence exposure across correlated pools.
- **Dated hedges.** An IL-T with an expiry and a strike: term protection for LPs who only need cover through a catalyst.

---

*schizō, built for UHI9. One Uniswap v4 hook: settlement, pricing, and marking in a single contract. Testnet only. Not financial advice.*
