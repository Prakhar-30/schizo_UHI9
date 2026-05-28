import { useMemo } from 'react'
import { sqrtPriceToPrice } from '../lib/il'
import { Kicker } from './ui/Bits'

/**
 * Outcome calculator: for a set of price-move scenarios, compute what the
 * impermanent-loss mark would become — relative to the position's entry
 * price, not the current price. Lets a hunter eyeball the *shape* of the
 * risk they're buying.
 */
const SCENARIOS = [
  { delta: -0.2, label: '−20%' },
  { delta: -0.1, label: '−10%' },
  { delta: 0, label: 'flat' },
  { delta: 0.1, label: '+10%' },
  { delta: 0.2, label: '+20%' },
]

function ilFromRatio(r) {
  if (!r || !isFinite(r) || r <= 0) return 0
  return 1 - (2 * Math.sqrt(r)) / (1 + r) // positive number = loss to IL-T
}

export default function OutcomeStrip({ entrySqrtPriceX96, currentSqrtPriceX96, compact = false }) {
  const rows = useMemo(() => {
    const entry = sqrtPriceToPrice(entrySqrtPriceX96)
    const current = sqrtPriceToPrice(currentSqrtPriceX96)
    if (!entry || !current) return null
    return SCENARIOS.map((s) => {
      const newPrice = current * (1 + s.delta)
      const r = newPrice / entry
      const ilFrac = ilFromRatio(r) // positive
      return {
        label: s.label,
        delta: s.delta,
        ilPct: ilFrac * 100,
      }
    })
  }, [entrySqrtPriceX96, currentSqrtPriceX96])

  if (!rows) {
    return (
      <div className={`${compact ? '' : 'card p-4'} font-mono text-[11px] text-bone/40`}>
        outcome math unavailable
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'card p-5'}>
      {!compact && (
        <div className="mb-3 flex items-baseline justify-between">
          <Kicker>If price moves from here…</Kicker>
          <span className="font-mono text-[10px] uppercase tracking-wider text-bone/30">
            entry-anchored
          </span>
        </div>
      )}
      <div className="grid grid-cols-5 gap-1.5">
        {rows.map((r) => {
          const sev = Math.min(1, r.ilPct / 12)
          const fg = r.ilPct < 1 ? 'text-yield' : r.ilPct < 4 ? 'text-amber' : 'text-risk'
          return (
            <div
              key={r.label}
              className="rounded-md border border-white/10 bg-ink-soft/50 px-1.5 py-2 text-center"
            >
              <div className="font-mono text-[10px] uppercase tracking-wider text-bone/45">
                {r.label}
              </div>
              <div className={`mt-0.5 font-mono text-[12px] font-bold tabular-nums ${fg}`}>
                −{r.ilPct.toFixed(r.ilPct < 1 ? 2 : 1)}%
              </div>
              {!compact && (
                <div className="mt-1.5 h-1 overflow-hidden rounded bg-white/5">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${Math.max(4, sev * 100)}%`,
                      background: 'linear-gradient(90deg,#c6ff2e,#ffb020 55%,#ff2e6d)',
                    }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!compact && (
        <p className="mt-3 font-mono text-[10px] text-bone/35">
          IL is the loss vs holding the two tokens unchanged — your premium is your edge against it.
        </p>
      )}
    </div>
  )
}
