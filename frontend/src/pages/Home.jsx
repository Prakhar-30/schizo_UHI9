import { Link } from 'react-router-dom'
import { useHookCounters, useReactiveStatus } from '../hooks/reads'
import Button from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Dot } from '../components/ui/Bits'
import Marquee from '../components/layout/Marquee'
import SplitDiagram from '../components/SplitDiagram'

function HeroStat({ label, value, accent }) {
  return (
    <div className="px-5 py-3">
      <div className={`font-mono text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="kicker mt-0.5">{label}</div>
    </div>
  )
}

export default function Home() {
  const { nextId, activeCount, bundles } = useHookCounters()
  const rsc = useReactiveStatus()

  return (
    <div>
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-7xl px-4 pb-10 pt-16 sm:px-6 sm:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2">
              <Chip color="volt">
                <Dot color="volt" pulse /> Live on Sepolia
              </Chip>
            </div>

            <h1 className="font-black leading-[0.92] tracking-tight text-5xl sm:text-6xl lg:text-7xl">
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

            <p className="mt-7 max-w-md text-lg leading-relaxed text-bone/65">
              Pay someone else to take your impermanent loss. Keep the yield.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <Button to="/create" variant="bone" size="lg">
                Sell your risk →
              </Button>
              <Button to="/hunt" variant="risk" size="lg">
                Hunt IL-T bonds
              </Button>
            </div>
          </div>

          {/* hero panel */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-volt/20 via-transparent to-risk/20 blur-2xl" />
            <Card glow="volt" className="relative overflow-hidden p-7">
              <div className="flex items-center justify-between">
                <Kicker>Live on Sepolia + Lasna</Kicker>
                <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-bone/50">
                  <Dot color={rsc.online ? 'mint' : 'amber'} pulse={rsc.online} />
                  {rsc.online ? 'RSC online' : 'RSC syncing'}
                </span>
              </div>

              <div className="mt-6 grid grid-cols-2 divide-x divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 [&>*]:bg-white/[0.02]">
                <HeroStat label="Positions minted" value={nextId !== undefined ? nextId.toString() : '—'} accent="text-bone" />
                <HeroStat label="Active bonds" value={activeCount !== undefined ? activeCount.toString() : '—'} accent="text-yield" />
                <HeroStat label="RSC data bundles" value={bundles !== undefined ? bundles.toString() : '—'} accent="text-volt" />
                <HeroStat
                  label="RSC fuel"
                  value={rsc.balance !== undefined ? `${Number(rsc.balance) / 1e18 < 0.001 ? '0' : (Number(rsc.balance) / 1e18).toFixed(2)}` : '—'}
                  accent="text-mint"
                />
              </div>

              <div className="mt-6 rounded-xl border border-white/10 bg-ink-soft/60 p-4">
                <p className="font-mono text-[11px] leading-relaxed text-bone/50">
                  <span className="text-mint">{'// '}</span>on every swap, the RSC recomputes
                  <span className="text-bone"> IL = 1 − 2√r/(1+r)</span> and posts the mark back on-chain. No keeper. No cron.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* ── MARQUEE ──────────────────────────────────────────── */}
      <div className="my-10 border-y-2 border-white/10 bg-ink-soft/40 py-3">
        <Marquee
          items={[
            'YIELD ≠ RISK',
            'FEE-T = INCOME',
            'IL-T = EXPOSURE',
            'MARKED EVERY SWAP',
            'IL = 1 − 2√r∕(1+r)',
            'NO KEEPER · NO CRON',
            'TRADE THE DOWNSIDE',
          ]}
        />
      </div>

      {/* ── THE SPLIT ────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <Kicker>The primitive</Kicker>
          <h2 className="mt-3 font-black text-4xl tracking-tight sm:text-5xl">One position, two markets</h2>
          <p className="mt-4 text-bone/55">
            Deposit liquidity once. Walk away with two independent claims that anyone can hold, price, and trade.
          </p>
        </div>
        <SplitDiagram />
      </section>

      {/* ── HOW ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <Kicker>How it flows</Kicker>
        <h2 className="mt-3 font-black text-4xl tracking-tight">Four moves</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {[
            { n: '01', t: 'Deposit', d: 'Add your tokens and set a premium. You get both pieces — FEE-T and IL-T — to start.', c: 'volt' },
            { n: '02', t: 'Sell the risk', d: 'A buyer pays your premium and takes IL-T. You keep the earnings; they take the price risk.', c: 'risk' },
            { n: '03', t: 'Prices move', d: 'Every trade moves the price, and that change is reported to the Reactive Network.', c: 'mint' },
            { n: '04', t: 'Stay priced', d: 'The Reactive Network works out the new loss and writes it back on-chain — readable live by anyone.', c: 'yield' },
          ].map((s) => (
            <Card key={s.n} hover className="p-6">
              <div className={`font-black text-3xl text-${s.c}`}>{s.n}</div>
              <h3 className="mt-3 font-bold text-lg">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-bone/55">{s.d}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ── REACTIVE ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <Card className="overflow-hidden p-0">
          <div className="grid lg:grid-cols-2">
            <div className="p-8 sm:p-10">
              <Chip color="volt">
                <Dot color="volt" pulse /> The unfair advantage
              </Chip>
              <h2 className="mt-5 font-black text-3xl tracking-tight sm:text-4xl">
                IL math doesn't belong on the swap path
              </h2>
              <p className="mt-4 text-bone/60 leading-relaxed">
                A plain hook could only update IL during a swap — and doing the square-root math inline would tax every
                trade. schizō pushes the computation to a Reactive Smart Contract on Lasna. The hook just emits a price
                snapshot; the RSC reacts, computes, and calls back with the mark.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  'Event-driven — reacts to swaps, never polls',
                  'IL computed cheaply inside the ReactVM',
                  'Mark posted back on-chain, auditable by anyone',
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
            <div className="relative grid place-items-center border-t-2 border-white/10 bg-ink-soft/40 p-10 lg:border-l-2 lg:border-t-0">
              <div className="absolute inset-0 grid-bg opacity-40" />
              <pre className="relative font-mono text-[11px] leading-relaxed text-bone/70 sm:text-xs">
{`Sepolia                  Lasna
┌────────────┐  swap   ┌────────────┐
│ ILBondHook │ ──────▶ │ ILBond     │
│            │ events  │ Reactive   │
│ emit price │         │            │
│ snapshot   │ ◀────── │ compute IL │
│ settleMark │ callback│ 1−2√r/(1+r)│
└────────────┘         └────────────┘`}
              </pre>
            </div>
          </div>
        </Card>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="card glow-risk relative overflow-hidden p-10 text-center sm:p-16">
          <div className="absolute inset-0 grid-bg opacity-30" />
          <h2 className="relative font-black text-4xl tracking-tight sm:text-5xl">Stop owning risk you didn't want.</h2>
          <p className="relative mx-auto mt-4 max-w-lg text-bone/55">
            Mint your first bond on Sepolia in under a minute. Test tokens are one click away.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Button to="/create" variant="bone" size="lg">
              I'm an LP →
            </Button>
            <Button to="/hunt" variant="risk" size="lg">
              I'm a hunter →
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
