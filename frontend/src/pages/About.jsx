import { useNetwork } from '../context/NetworkContext'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Dot, Leg, Divider, Addr } from '../components/ui/Bits'
import Button from '../components/ui/Button'
import SplitDiagram from '../components/SplitDiagram'

const STEPS = [
  { t: 'Connect & switch to Sepolia', d: 'Connect any EVM wallet. The app runs on Ethereum Sepolia; transactions prompt a network switch if needed.', tag: 'setup' },
  { t: 'Mint test tokens', d: "On the Markets page, hit the faucet to mint the test tokens for any pool. Free, testnet only. These aren't real assets.", tag: 'faucet' },
  { t: 'Mint a bond', d: 'Choose a liquidity size and an ask premium, then approve & deposit. You mint one position and hold both legs: FEE-T and IL-T.', tag: 'create' },
  { t: 'Hedge the risk', d: 'Your listing sits on Markets automatically. An underwriter pays your premium and takes IL-T. You keep FEE-T: yield with no price risk. You are hedged.', tag: 'trade' },
  { t: 'Move the price', d: 'Use the swap panel on Markets. Each swap nudges the smoothed marking price the hook keeps for that pool.', tag: 'swap' },
  { t: 'Watch the mark', d: 'Every position\'s IL derives live from its pool\'s mark, no waiting on anyone. The gauge on every card updates as you trade.', tag: 'mark' },
  { t: 'Exit & withdraw', d: 'Any party to a position can exit it. The IL-T holder receives the underlying composition; claim it from your Dashboard.', tag: 'settle' },
]

const FAQ = [
  { q: 'What actually is FEE-T and IL-T?', a: 'They are two owner slots on a single position inside the hook. FEE-T owns the yield + premium; IL-T owns the underlying LP composition and therefore absorbs the impermanent loss. Each is transferable, mirroring a fungible-token API without leaving the contract.' },
  { q: 'Who buys IL-T? Isn\'t that just gambling?', a: 'No more than insurance is. The IL-T buyer is an underwriter: they get paid a volatility-linked premium to warehouse a risk the LP needed gone. Desks with long-vol books buy it because the short-gamma payoff offsets what their options bleed; range-bound funds buy it for the premium. It is the oldest trade in finance, on-chain.' },
  { q: 'How is IL computed?', a: 'With the standard formula IL = 1 − 2√r/(1+r), where r is the marking price over the entry price. The hook computes it in a public pure function whenever a mark is read, so it is exact, always current, and verifiable by anyone with one call.' },
  { q: 'Can the mark be manipulated?', a: 'Not by any single transaction. The marking price is an EWMA-smoothed tick: one swap only moves it a fraction of the way toward its own price, so a same-tx flash move cannot set it. And since IL is derived at read time rather than stored, there is no stale stored value to poison. Skewing the mark means holding a distorted price across many swaps while arbitrage eats you.' },
  { q: 'Why no keeper, oracle, or off-chain marker?', a: 'Because nothing needs to run. The hook already sees every swap, so it maintains the smoothed marking price right there, two storage writes on the swap path. IL derives from that mark on demand. No cron, no callback to fund, no bot to trust, no liveness assumption at all.' },
  { q: 'Is this real money?', a: 'No. Everything here is on Ethereum Sepolia and Unichain Sepolia testnets with mintable mock tokens. It is a working beta of the primitive, not a production market.' },
]

function Step({ i, t, d, tag }) {
  return (
    <div className="flex gap-4 sm:gap-5">
      <div className="flex flex-col items-center">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border-2 border-white/15 bg-ink-card font-black text-base sm:h-11 sm:w-11 sm:text-lg">
          {String(i + 1).padStart(2, '0')}
        </div>
        {i < STEPS.length - 1 && <div className="mt-1 w-px flex-1 bg-white/10" />}
      </div>
      <div className="min-w-0 pb-8">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="font-bold text-base sm:text-lg">{t}</h4>
          <span className="font-mono text-[10px] uppercase tracking-wider text-volt">{tag}</span>
        </div>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-bone/55">{d}</p>
      </div>
    </div>
  )
}

export default function About() {
  const nw = useNetwork()
  const CONTRACTS = [
    { label: 'ILBondHook', net: nw.short, addr: nw.addr.hook, href: nw.addrUrl(nw.addr.hook) },
    { label: `${nw.getToken(nw.demoPool.token0).symbol} (demo token0)`, net: nw.short, addr: nw.demoPool.token0, href: nw.addrUrl(nw.demoPool.token0) },
    { label: `${nw.getToken(nw.demoPool.token1).symbol} (demo token1)`, net: nw.short, addr: nw.demoPool.token1, href: nw.addrUrl(nw.demoPool.token1) },
    { label: 'PoolManager', net: nw.short, addr: nw.addr.poolManager, href: nw.addrUrl(nw.addr.poolManager) },
  ]
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
      <div className="max-w-3xl">
        <Chip color="volt">
          <Dot color="volt" pulse /> UHI9 · Theme: Impermanent Loss
        </Chip>
        <h1 className="mt-5 font-black text-balance text-3xl leading-[1] tracking-tight sm:text-5xl lg:text-6xl">
          LP yield, without impermanent loss.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-bone/60">
          Every IL hook before this one tried to <i>reduce</i> impermanent loss. schizō does something different: it lets
          you <b className="text-bone">hedge it</b>. One LP position becomes two claims: a yield leg you keep, and a risk
          leg an underwriter takes off your hands for a premium.
        </p>
      </div>

      <div className="mt-14 grid gap-5 md:grid-cols-2">
        <Card className="p-6">
          <Kicker>The problem</Kicker>
          <p className="mt-3 leading-relaxed text-bone/70">
            An LP position is always a bundle: <span className="text-yield">fee income</span> (steady, volume-driven) glued
            to <span className="text-risk">impermanent loss</span> (price-driven). You can't own one without the other. A
            treasury that wants yield is forced to hold price risk; a desk that would underwrite that risk for a premium
            is forced to market-make.
          </p>
        </Card>
        <Card className="p-6">
          <Kicker>The fix</Kicker>
          <p className="mt-3 leading-relaxed text-bone/70">
            Unbundle them. <Leg kind="fee" className="mx-0.5" /> takes the fees and an upfront premium with zero price
            risk: that's the hedged LP. <Leg kind="il" className="mx-0.5" /> absorbs the impermanent loss in exchange for
            that premium: that's the underwriter. Two audiences, two instruments, one position.
          </p>
        </Card>
      </div>

      <div className="mt-16">
        <Kicker>The split</Kicker>
        <h2 className="mb-8 mt-2 font-black text-2xl tracking-tight sm:text-3xl">Anatomy of a bond</h2>
        <SplitDiagram />
      </div>

      <div className="mt-16">
        <Kicker>Architecture</Kicker>
        <h2 className="mt-2 font-black text-2xl tracking-tight sm:text-3xl">One contract, zero dependencies</h2>
        <Card className="mt-6 overflow-hidden p-0">
          <div className="grid md:grid-cols-2">
            <div className="border-b-2 border-white/10 p-7 md:border-b-0 md:border-r-2">
              <div className="flex items-center gap-2">
                <Dot color="mint" />
                <h3 className="font-bold">ILBondHook · {nw.short}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-bone/55">
                The whole system is one v4 hook. It holds positions, mints the two legs, takes the premium on a sale,
                routes swap fees to FEE-T, and keeps an EWMA-smoothed marking price per pool that it updates on every
                swap.
              </p>
            </div>
            <div className="p-7">
              <div className="flex items-center gap-2">
                <Dot color="volt" />
                <h3 className="font-bold">Marks are derived, never stored</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-bone/55">
                IL is computed at read time from a position's entry price and its pool's smoothed mark, one public pure
                function. No oracle to trust, no keeper to fund, no stored value that can rot or be poisoned.
              </p>
            </div>
          </div>
          <Divider />
          <div className="bg-ink-soft/40 p-7">
            <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-bone/65">
{`swap on pool
   └─▶ hook smooths the mark: markTick += (tick − markTick) / 4
        └─▶ emits SwapOccurred(price, markPrice)   [2 storage writes, that's it]

any read (app, indexer, another contract)
   └─▶ ilMark(positionId)
        └─▶ IL = 1 − 2√r/(1+r),  r = markPrice / entryPrice   [pure, live, exact]`}
            </pre>
          </div>
        </Card>
      </div>

      <div className="mt-16">
        <Kicker>Step by step</Kicker>
        <h2 className="mt-2 font-black text-2xl tracking-tight sm:text-3xl">How to use schizō</h2>
        <div className="mt-8">
          {STEPS.map((s, i) => (
            <Step key={s.t} i={i} {...s} />
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button to="/create" variant="bone" size="lg">Start on the Create page →</Button>
          <Button to="/markets" variant="outline" size="lg">See live markets</Button>
        </div>
      </div>

      <div className="mt-16">
        <Kicker>FAQ</Kicker>
        <h2 className="mt-2 font-black text-2xl tracking-tight sm:text-3xl">Good questions</h2>
        <div className="mt-6 space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="card group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between font-bold">
                {f.q}
                <span className="text-bone/40 transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-bone/55">{f.a}</p>
            </details>
          ))}
        </div>
      </div>

      <div className="mt-16">
        <Kicker>Deployed contracts</Kicker>
        <h2 className="mt-2 font-black text-2xl tracking-tight sm:text-3xl">On-chain, verifiable</h2>
        <Card className="mt-6 divide-y divide-white/8 p-2">
          {CONTRACTS.map((c) => (
            <div key={c.label} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold">{c.label}</span>
                <Chip color="mint">{c.net}</Chip>
              </div>
              <Addr value={c.addr} href={c.href} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
