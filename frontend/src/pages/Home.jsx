import { Link } from 'react-router-dom'
import { useHookCounters, useMarkCount } from '../hooks/reads'
import { useNetwork } from '../context/NetworkContext'
import Button from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Dot } from '../components/ui/Bits'
import Marquee from '../components/layout/Marquee'
import SplitDiagram from '../components/SplitDiagram'
import SwapPanel from '../components/SwapPanel'

function HeroStat({ label, value, accent }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className={`font-mono text-xl font-bold tabular-nums sm:text-2xl ${accent}`}>{value}</div>
      <div className="kicker mt-0.5 truncate">{label}</div>
    </div>
  )
}

export default function Home() {
  const net = useNetwork()
  const { nextId, activeCount } = useHookCounters()
  const { count: markCount } = useMarkCount()

  return (
    <div>
      <section className="relative mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 sm:pb-10 sm:pt-[4.8rem]">
        <div className="grid items-center gap-8 sm:gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2">
              <Chip color="volt">
                <Dot color="volt" pulse /> Live on {net.name}
              </Chip>
            </div>

            <h1 className="font-black leading-[0.95] tracking-tight text-balance text-4xl sm:text-6xl lg:text-7xl">
              LP fees.
              <br />
              Without the{' '}
              <span className="relative inline-block">
                <span className="text-risk">loss</span>
                <svg className="absolute -bottom-2 left-0 w-full" height="10" viewBox="0 0 200 10" preserveAspectRatio="none">
                  <path d="M2 6 Q 50 2 100 6 T 198 5" stroke="#ff2e6d" strokeWidth="3" fill="none" />
                </svg>
              </span>
              .
            </h1>

            <p className="mt-6 max-w-md text-base leading-relaxed text-bone/65 sm:mt-7 sm:text-lg">
              Hedge your impermanent loss for a premium. Keep the yield. The risk goes to someone who priced it and wanted it.
            </p>

            <div className="mt-7 flex flex-wrap gap-3 sm:mt-9">
              <Button to="/create" variant="bone" size="lg">
                Hedge my position →
              </Button>
              <Button to="/hunt" variant="risk" size="lg">
                Underwrite IL bonds
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-volt/20 via-transparent to-risk/20 blur-2xl" />
            <div className="relative">
              <SwapPanel />
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 divide-x divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 sm:mt-10 sm:grid-cols-4 sm:divide-y-0 [&>*]:bg-white/[0.02]">
          <HeroStat label="Positions minted" value={nextId !== undefined ? nextId.toString() : '–'} accent="text-bone" />
          <HeroStat label="Active bonds" value={activeCount !== undefined ? activeCount.toString() : '–'} accent="text-yield" />
          <HeroStat label="Marks posted" value={markCount !== undefined ? markCount.toString() : '–'} accent="text-volt" />
          <HeroStat label="Live markets" value={net.pools?.length ?? '–'} accent="text-mint" />
        </div>
      </section>

      <div className="my-10 border-y-2 border-white/10 bg-ink-soft/40 py-3">
        <Marquee
          items={[
            'YIELD ≠ RISK',
            'FEE-T = INCOME',
            'IL-T = EXPOSURE',
            'MARKED EVERY SWAP',
            'IL = 1 − 2√r∕(1+r)',
            'NO KEEPER · NO CRON',
            'HEDGE THE DOWNSIDE',
          ]}
        />
      </div>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-12">
          <Kicker>The primitive</Kicker>
          <h2 className="mt-3 font-black text-3xl tracking-tight sm:text-5xl">One position, two markets</h2>
          <p className="mt-4 text-bone/55">
            Deposit liquidity once. Walk away with two independent claims that anyone can hold, price, and trade.
          </p>
        </div>
        <SplitDiagram />
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <Kicker>How it flows</Kicker>
        <h2 className="mt-3 font-black text-3xl tracking-tight sm:text-4xl">Four moves</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {[
            { n: '01', t: 'Deposit', d: 'Add your tokens and set a premium. You get both pieces, FEE-T and IL-T, to start.', c: 'volt' },
            { n: '02', t: 'Hedge the risk', d: 'An underwriter pays your premium and takes IL-T. From that moment you are hedged: you keep the earnings, they hold the price risk.', c: 'risk' },
            { n: '03', t: 'Prices move', d: 'Every trade nudges the smoothed marking price the hook keeps for its pool. No single swap can yank it.', c: 'mint' },
            { n: '04', t: 'Stay priced', d: 'The hook derives each position\'s live loss straight from that mark. One view call, always current, verifiable by anyone.', c: 'yield' },
          ].map((s) => (
            <Card key={s.n} hover className="p-6">
              <div className={`font-black text-3xl text-${s.c}`}>{s.n}</div>
              <h3 className="mt-3 font-bold text-lg">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-bone/55">{s.d}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <Card className="overflow-hidden p-0">
          <div className="grid lg:grid-cols-2">
            <div className="p-6 sm:p-10">
              <Chip color="volt">
                <Dot color="volt" pulse /> The unfair advantage
              </Chip>
              <h2 className="mt-5 font-black text-balance text-2xl tracking-tight sm:text-4xl">
                The mark lives inside the hook
              </h2>
              <p className="mt-4 text-bone/60 leading-relaxed">
                No oracle, no keeper, no second network. Each swap nudges an EWMA-smoothed marking price the hook keeps
                per pool, two storage writes, nothing more on the swap path. IL itself is never stored: it derives from
                that mark on demand, closed-form, so there is nothing off-chain to trust and nothing stored to poison.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  'Marks derive from pool state, fresh on every read',
                  'Smoothed price: a same-tx flash move cannot set it',
                  'One pure function, auditable and callable by anyone',
                ].map((x) => (
                  <li key={x} className="flex items-center gap-3 text-sm text-bone/70">
                    <span className="text-mint">◉</span>
                    {x}
                  </li>
                ))}
              </ul>
              <Button to="/about" variant="outline" size="md" className="mt-8">
                Read the architecture
              </Button>
            </div>
            <div className="relative grid place-items-center overflow-x-auto border-t-2 border-white/10 bg-ink-soft/40 p-6 sm:p-10 lg:border-l-2 lg:border-t-0">
              <div className="absolute inset-0 grid-bg opacity-40" />
              <pre className="relative font-mono text-[10px] leading-relaxed text-bone/70 sm:text-xs">
{`${net.short} · one contract
┌──────────────────────────────┐
│          ILBondHook          │
│                              │
│ swap ─▶ mark ⟵ EWMA(tick)   │
│                              │
│ read ─▶ IL = 1−2√r/(1+r)     │
│         from entry vs mark   │
└──────────────────────────────┘`}
              </pre>
            </div>
          </div>
        </Card>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="card glow-risk relative overflow-hidden p-6 text-center sm:p-16">
          <div className="absolute inset-0 grid-bg opacity-30" />
          <h2 className="relative font-black text-balance text-3xl tracking-tight sm:text-5xl">Stop holding risk you never wanted.</h2>
          <p className="relative mx-auto mt-4 max-w-lg text-bone/55">
            Mint your first bond on {net.name} in under a minute. Test tokens are one click away.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Button to="/create" variant="bone" size="lg">
              I'm hedging →
            </Button>
            <Button to="/hunt" variant="risk" size="lg">
              I'm underwriting →
            </Button>
            <Button to="/about" variant="ghost" size="lg">
              How it works
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
