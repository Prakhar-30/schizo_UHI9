import { Leg } from './ui/Bits'

function LegBox({ kind, title, points }) {
  const isFee = kind === 'fee'
  return (
    <div
      className={`card flex-1 p-5 ${isFee ? 'border-yield/40' : 'border-risk/40'}`}
      style={{ boxShadow: `6px 6px 0 0 ${isFee ? 'rgba(198,255,46,0.18)' : 'rgba(255,46,109,0.18)'}` }}
    >
      <div className="flex items-center justify-between">
        <Leg kind={kind} />
        <span className={`font-mono text-[11px] ${isFee ? 'text-yield' : 'text-risk'}`}>
          {isFee ? 'the yield leg' : 'the risk leg'}
        </span>
      </div>
      <h4 className="mt-3 font-black text-lg leading-tight">{title}</h4>
      <ul className="mt-3 space-y-1.5">
        {points.map((p) => (
          <li key={p} className="flex gap-2 text-sm text-bone/60">
            <span className={isFee ? 'text-yield' : 'text-risk'}>→</span>
            {p}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SplitDiagram() {
  return (
    <div className="relative">
      <div className="mx-auto max-w-sm">
        <div className="card glass-strong p-5 text-center">
          <span className="kicker">1 Uniswap v4 LP position</span>
          <p className="mt-2 font-black text-xl">yield + risk, bundled</p>
          <p className="mt-1 font-mono text-[11px] text-bone/45">fees you want · IL you don't</p>
        </div>
      </div>

      <div className="relative mx-auto my-1 h-12 w-px">
        <svg viewBox="0 0 200 60" className="absolute left-1/2 top-0 h-12 w-[260px] -translate-x-1/2 overflow-visible">
          <path d="M100 0 V20 M100 20 C100 40 40 30 30 58 M100 20 C100 40 160 30 170 58" stroke="#3a3a47" strokeWidth="2" fill="none" />
          <circle cx="100" cy="0" r="3" fill="#7c5cff" />
          <circle cx="30" cy="58" r="3" fill="#c6ff2e" />
          <circle cx="170" cy="58" r="3" fill="#ff2e6d" />
        </svg>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <LegBox
          kind="fee"
          title="Steady income, zero price risk"
          points={['Earns swap fees', 'Collects the upfront premium', 'Held by treasuries / yield seekers']}
        />
        <LegBox
          kind="il"
          title="The risk, warehoused for a premium"
          points={['Absorbs the impermanent loss', 'Marked to market every swap', 'Held by underwriters / hedging desks']}
        />
      </div>
    </div>
  )
}
