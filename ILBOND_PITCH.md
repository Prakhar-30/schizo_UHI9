# schizō — Impermanent loss, unbundled

**Every LP position is two trades stapled together. We finally let you sell one of them.**

Live: https://schizo-il-bond.vercel.app · UHI9 (Theme: Impermanent Loss) · Uniswap v4 + Reactive Network

---

## The one idea

When you provide liquidity, you're forced to hold two things at once:

- **Fee income** — boring, steady, grows with volume.
- **Impermanent loss** — the bill you pay when price moves.

Nobody asked for them bundled. The DAO treasury that wants yield doesn't want the price risk. The trader who wants to bet on volatility doesn't want to babysit a position. But Uniswap hands everyone the same package, take it or leave it.

Every IL hook built so far tries to *shrink* the IL bill — dynamic fees, rebalancing, insurance pools, LVR auctions. We do something nobody else has: we **cut the position in half and let the two halves trade separately.**

Deposit into schizō and your position splits into two claims:

- **FEE-T** — keeps the fees and an upfront premium. Zero price risk.
- **IL-T** — takes the impermanent loss, for or against. Pays the premium to get it.

Both are transferable. Hold both and you're a normal LP. Sell IL-T and you're earning yield with the risk handed off. Sell FEE-T and you've got a pure, leveraged bet on volatility. One deposit, two instruments, two audiences.

IL stops being a tax. It becomes something you can price, buy, and sell.

---

## Why it needs Reactive

The hard part isn't the split — it's keeping the IL leg *honest*. IL is a function of price, and price only moves on swaps. So the mark needs to update on every swap, against each position's entry price, without a keeper sitting on a timer burning gas for nothing.

That's exactly what a Reactive Smart Contract is for. Ours subscribes to the hook's swap events on Sepolia and runs the whole loop itself:

```
swap on any pool
  → hook emits SwapOccurred
     → RSC reacts, asks the hook for a data bundle
        → hook emits every active position + its pool's live price
           → RSC computes IL = 1 − 2√r/(1+r) inside the ReactVM
              → RSC calls back settleILMark(id, ilBps) on the hook
```

No cron. No off-chain bot. No trust. The mark moves exactly when reality moves — which is the only time it should. The swap path stays cheap because the math lives on Reactive, not in `beforeSwap`. This product simply does not exist without it.

---

## It's real, and it's running

This isn't a slide deck. The whole system is deployed and live — and it runs on **two chains independently**, with the frontend switching every address by the connected wallet's chain.

| | Ethereum Sepolia | Unichain Sepolia |
|---|---|---|
| ILBondHook | `0x58A3A816864F1E5f6F38F01f9f5AE1Cacc9210C0` | `0x56B99A42E41D5987b2F39E97F3EBe5f3d76e10C0` |
| ILBondReactive (Lasna) | `0x27eab090BF647e191A4FB121A780aA6ED89C53E2` | `0x4F193c807b4BD93054332bc67e64428725AA107D` |
| Pools | 45 pairs (10 tokens, 2/6/8/18 decimals) | 3 pairs (mWETH/mWBTC/mUSDC) |

Frontend: https://schizo-il-bond.vercel.app

What works today:
- LPs mint FEE-T + IL-T from a real full-range v4 deposit, decimal-correct across every pool.
- A second wallet buys the IL-T leg, premium paid bilaterally — no insurance pool, no protocol float.
- The RSC marks every open position to its **own pool's** price on every swap, and the dashboard shows it live.
- **Dynamic fees that actually move**: each pool charges `0.30% + f(realized volatility)`, capped at 3%, driven by an on-chain EWMA of tick movement — verified climbing under load and decaying when calm.

---

## The dynamic fee, briefly

The "dynamic" in most dynamic-fee demos is a constant in disguise. Ours isn't. `beforeSwap` reads a per-pool volatility EWMA and charges `BASE_FEE + volEwma / sensitivity`, clamped at the cap. Calm pool → 0.30%. Choppy pool → it ratchets up automatically and relaxes back down as things settle. Liquidity providers get paid more precisely when their IL risk is highest.

---

## Why this is a category, not a feature

- **vs IL-protection hooks** — they keep the LP holding the risk and try to soften it. We let the LP *get rid of it* to someone who wants it.
- **vs options-on-LP** — those write derivatives *next to* a position. IL-T isn't a derivative; it **is** a slice of the position itself.
- **vs insurance hooks** — those need a capital pool to pay claims. We need nothing but a willing counterparty and an upfront premium. Fully bilateral.

The closest prior art (UHI3's fixed/leverage yield) split the *upside*. We split the *downside* — the actual risk. That's the difference between tranching a bond and inventing the credit-default swap.

---

## Where it goes

- **Tranche IL-T** — a senior leg that eats the first 5% of IL, a junior leg that eats the rest. Two risk-adjusted yields from one position.
- **Cross-pool IL netting** — the RSC already sees every pool. Let one user mint a single IL-T against their *net* exposure across correlated pools.
- **Vol-priced premiums** — quote the premium off the live volatility EWMA the hook already tracks.
- **IL futures** — a dated IL-T: pure speculation on next-epoch IL versus a strike.

---

Built end-to-end: Solidity hook + Reactive contract, a Supabase event index for full history, and a production React app — backed by **74 passing Foundry tests** including fuzz and invariant suites.

*schizō — built for UHI9. Uniswap v4 for settlement, Reactive Network for the brains.*
