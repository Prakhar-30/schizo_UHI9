import { sepoliaTx } from '../config/contracts'
import { fmtToken, fmtBpsPct, shortAddr, timeAgo } from '../lib/format'
import { Spinner } from './ui/Bits'

const META = {
  ILMarkUpdated: { color: 'text-mint border-mint/40', glyph: '◉', rsc: true },
  ILBondDataBundle: { color: 'text-volt border-volt/40', glyph: '⇄', rsc: true },
  CycleCompleted: { color: 'text-volt border-volt/40', glyph: '↻', rsc: true },
  SwapOccurred: { color: 'text-bone/70 border-white/15', glyph: '⇋' },
  PositionCreated: { color: 'text-yield border-yield/40', glyph: '+' },
  PositionExited: { color: 'text-bone/40 border-white/15', glyph: '−' },
  ILBondSold: { color: 'text-risk border-risk/40', glyph: '✦' },
  FeeTokenTransferred: { color: 'text-yield border-yield/30', glyph: '→' },
  ILTokenTransferred: { color: 'text-risk border-risk/30', glyph: '→' },
}

function describe(name, a, posById) {
  switch (name) {
    case 'ILMarkUpdated':
      return (
        <>
          RSC marked position <b className="text-bone">#{a.positionId?.toString()}</b> →{' '}
          <b className="text-mint">{fmtBpsPct(a.ilBps)}</b> IL
        </>
      )
    case 'ILBondDataBundle':
      return (
        <>
          Hook emitted data bundle <b className="text-bone">#{a.bundleId?.toString()}</b> for the RSC
        </>
      )
    case 'CycleCompleted':
      return <>RSC cycle completed · {a.positionsChecked?.toString()} positions</>
    case 'SwapOccurred':
      return (
        <>
          Swap on the pool · tick <b className="text-bone">{a.tick?.toString()}</b>
        </>
      )
    case 'PositionCreated':
      return (
        <>
          <b className="text-bone">{shortAddr(a.owner)}</b> opened position{' '}
          <b className="text-yield">#{a.positionId?.toString()}</b>
        </>
      )
    case 'PositionExited':
      return (
        <>
          Position <b className="text-bone">#{a.positionId?.toString()}</b> exited
        </>
      )
    case 'ILBondSold': {
      // Premium is denominated in the position's own pool quote token, with its
      // decimals. Resolve from the supplied position map; if unknown, omit the
      // symbol rather than mislabel it.
      const pos = posById?.[Number(a.positionId)]
      const premStr = pos
        ? `${fmtToken(a.premium, pos.premiumDec)} ${pos.premiumSym}`
        : `${fmtToken(a.premium, pos?.premiumDec ?? 18)}`
      return (
        <>
          <b className="text-bone">{shortAddr(a.buyer)}</b> bought IL-T{' '}
          <b className="text-risk">#{a.positionId?.toString()}</b> for {premStr}
        </>
      )
    }
    case 'FeeTokenTransferred':
      return (
        <>
          FEE-T <b className="text-bone">#{a.positionId?.toString()}</b> → {shortAddr(a.to)}
        </>
      )
    case 'ILTokenTransferred':
      return (
        <>
          IL-T <b className="text-bone">#{a.positionId?.toString()}</b> → {shortAddr(a.to)}
        </>
      )
    default:
      return name
  }
}

export default function ActivityFeed({ events, isLoading, emptyLabel = 'No activity yet.', positionsById }) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 font-mono text-sm text-bone/40">
        <Spinner /> reading chain logs…
      </div>
    )
  }
  if (!events?.length) {
    return <div className="py-10 text-center font-mono text-sm text-bone/30">{emptyLabel}</div>
  }
  return (
    <ul className="divide-y divide-white/8">
      {events.map((e) => {
        const m = META[e.name] || { color: 'text-bone/60 border-white/15', glyph: '•' }
        return (
          <li key={e.key} className="flex items-center gap-3 py-3">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-white/[0.02] font-mono text-sm ${m.color}`}>
              {m.glyph}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-bone/80">{describe(e.name, e.args, positionsById)}</p>
              <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-bone/30">
                <span>{timeAgo(e.ts)}</span>
                {m.rsc && <span className="rounded border border-volt/40 px-1 text-volt">reactive</span>}
              </div>
            </div>
            <a
              href={sepoliaTx(e.txHash)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] text-bone/30 hover:text-volt"
            >
              ↗
            </a>
          </li>
        )
      })}
    </ul>
  )
}
