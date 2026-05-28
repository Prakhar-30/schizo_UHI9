import { ADDR, sepoliaAddr, reactscanAddr } from '../config/contracts'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Dot, Leg, Divider, Addr } from '../components/ui/Bits'
import Button from '../components/ui/Button'
import SplitDiagram from '../components/SplitDiagram'

const STEPS = [
  { t: 'Connect & switch to Sepolia', d: 'Connect any EVM wallet. The app runs on Ethereum Sepolia; transactions prompt a network switch if needed.', tag: 'setup' },
  { t: 'Mint test tokens', d: 'On the Create page, hit the faucet to mint ALPHA and BETA — the two assets in the demo pool. Free, unlimited, testnet only.', tag: 'faucet' },
  { t: 'Mint a bond', d: 'Choose a liquidity size and an ask premium, then approve & deposit. You mint one position and hold both legs: FEE-T and IL-T.', tag: 'create' },
  { t: 'Sell the risk', d: 'List sits on Markets automatically. A buyer pays your premium and takes IL-T. You keep FEE-T — yield with no price risk.', tag: 'trade' },
  { t: 'Move the price', d: 'Use the swap panel on Markets. Each swap makes the hook emit a price snapshot the Reactive Network listens for.', tag: 'swap' },
  { t: 'Watch the mark', d: 'Within a block or two the RSC posts each position\'s IL back on-chain. The gauge on every card updates live.', tag: 'reactive' },
  { t: 'Exit & withdraw', d: 'Any party to a position can exit it. The IL-T holder receives the underlying composition; claim it from your Dashboard.', tag: 'settle' },
]

const FAQ = [
  { q: 'What actually is FEE-T and IL-T?', a: 'They are two owner slots on a single position inside the hook. FEE-T owns the yield + premium; IL-T owns the underlying LP composition and therefore bears impermanent loss. Each is transferable, mirroring a fungible-token API without leaving the contract.' },
  { q: 'How is IL computed?', a: 'With the standard formula IL = 1 − 2√r/(1+r), where r is the current price over the entry price. It is computed inside the ReactVM on Reactive Network — not on the swap path — and posted back in basis points.' },
  { q: 'Why Reactive Network and not a keeper?', a: 'A keeper polls on a timer and pays gas whether or not anything changed. IL only changes when price changes, and price only changes on swaps. The RSC reacts to swap events exactly — no cron, no idle polling, no trust in an off-chain bot.' },
  { q: 'Is this real money?', a: 'No. Everything here is on Ethereum Sepolia and Reactive Lasna testnets with mintable mock tokens. It is a demonstration of the primitive, not a production market.' },
]

function Step({ i, t, d, tag }) {
  return (
    <div className="flex gap-5">
      <div className="flex flex-col items-center">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-white/15 bg-ink-card font-black text-lg">
          {String(i + 1).padStart(2, '0')}
        </div>
        {i < STEPS.length - 1 && <div className="mt-1 w-px flex-1 bg-white/10" />}
      </div>
      <div className="pb-8">
        <div className="flex items-center gap-2">
          <h4 className="font-bold text-lg">{t}</h4>
          <span className="font-mono text-[10px] uppercase tracking-wider text-volt">{tag}</span>
        </div>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-bone/55">{d}</p>
      </div>
    </div>
  )
}

const CONTRACTS = [
  { label: 'ILBondHook', net: 'Sepolia', addr: ADDR.hook, href: sepoliaAddr(ADDR.hook) },
  { label: 'ILBondReactive', net: 'Lasna', addr: ADDR.reactive, href: reactscanAddr(ADDR.reactive) },
  { label: 'ALPHA (token0)', net: 'Sepolia', addr: ADDR.token0, href: sepoliaAddr(ADDR.token0) },
  { label: 'BETA (token1)', net: 'Sepolia', addr: ADDR.token1, href: sepoliaAddr(ADDR.token1) },
  { label: 'PoolManager', net: 'Sepolia', addr: ADDR.poolManager, href: sepoliaAddr(ADDR.poolManager) },
]

export default function About() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      {/* intro */}
      <div className="max-w-3xl">
        <Chip color="volt">
          <Dot color="volt" pulse /> UHI9 · Theme: Impermanent Loss
        </Chip>
        <h1 className="mt-5 font-black text-4xl leading-[0.95] tracking-tight sm:text-6xl">
          LP yield, without impermanent loss.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-bone/60">
          Every IL hook before this one tried to <i>reduce</i> impermanent loss. schizō does something different — it{' '}
          <b className="text-bone">sells it</b>. One LP position becomes two claims: a yield leg you keep, and a risk leg
          a buyer takes off your hands for a premium.
        </p>
      </div>

      {/* problem */}
      <div className="mt-14 grid gap-5 md:grid-cols-2">
        <Card className="p-6">
          <Kicker>The problem</Kicker>
          <p className="mt-3 leading-relaxed text-bone/70">
            An LP position is always a bundle: <span className="text-yield">fee income</span> (steady, vol-positive) glued
            to <span className="text-risk">impermanent loss</span> (vol-negative). You can't own one without the other. A
            treasury that wants yield is forced to take price risk; a trader who wants vol exposure is forced to market-make.
          </p>
        </Card>
        <Card className="p-6">
          <Kicker>The fix</Kicker>
          <p className="mt-3 leading-relaxed text-bone/70">
            Unbundle them. <Leg kind="fee" className="mx-0.5" /> takes the fees and an upfront premium with zero price
            risk. <Leg kind="il" className="mx-0.5" /> takes the impermanent loss in exchange for that premium. Two
            audiences, two instruments, one position.
          </p>
        </Card>
      </div>

      {/* split */}
      <div className="mt-16">
        <Kicker>The split</Kicker>
        <h2 className="mb-8 mt-2 font-black text-3xl tracking-tight">Anatomy of a bond</h2>
        <SplitDiagram />
      </div>

      {/* architecture */}
      <div className="mt-16">
        <Kicker>Architecture</Kicker>
        <h2 className="mt-2 font-black text-3xl tracking-tight">Two contracts, two chains</h2>
        <Card className="mt-6 overflow-hidden p-0">
          <div className="grid md:grid-cols-2">
            <div className="border-b-2 border-white/10 p-7 md:border-b-0 md:border-r-2">
              <div className="flex items-center gap-2">
                <Dot color="mint" />
                <h3 className="font-bold">ILBondHook · Sepolia</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-bone/55">
                The v4 hook + callback contract. Holds positions, mints the two legs, takes the premium on a sale, and
                emits a price snapshot after every swap. Receives the IL mark back from the RSC and stores it on-chain.
              </p>
            </div>
            <div className="p-7">
              <div className="flex items-center gap-2">
                <Dot color="volt" />
                <h3 className="font-bold">ILBondReactive · Lasna</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-bone/55">
                The Reactive Smart Contract. Subscribes to the hook's events, computes IL in the ReactVM on each swap, and
                calls back to settle the mark. Purely event-driven — no cron, no keeper.
              </p>
            </div>
          </div>
          <Divider />
          <div className="bg-ink-soft/40 p-7">
            <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-bone/65">
{`swap on pool
   └─▶ Hook emits SwapOccurred(price)               [Sepolia]
        └─▶ RSC reacts ─▶ asks hook for a data bundle
             └─▶ Hook emits ILBondDataBundle(positions, price)
                  └─▶ RSC computes IL = 1 − 2√r/(1+r)  [ReactVM, Lasna]
                       └─▶ RSC callback settleILMark(id, ilBps, value)
                            └─▶ Hook stores mark, emits ILMarkUpdated  [Sepolia]`}
            </pre>
          </div>
        </Card>
      </div>

      {/* guide */}
      <div className="mt-16">
        <Kicker>Step by step</Kicker>
        <h2 className="mt-2 font-black text-3xl tracking-tight">How to use schizō</h2>
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

      {/* faq */}
      <div className="mt-16">
        <Kicker>FAQ</Kicker>
        <h2 className="mt-2 font-black text-3xl tracking-tight">Good questions</h2>
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

      {/* contracts */}
      <div className="mt-16">
        <Kicker>Deployed contracts</Kicker>
        <h2 className="mt-2 font-black text-3xl tracking-tight">On-chain, verifiable</h2>
        <Card className="mt-6 divide-y divide-white/8 p-2">
          {CONTRACTS.map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold">{c.label}</span>
                <Chip color={c.net === 'Lasna' ? 'volt' : 'mint'}>{c.net}</Chip>
              </div>
              <Addr value={c.addr} href={c.href} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
