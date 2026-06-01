import { useEffect, useRef, useState } from 'react'
import { fmtBpsPct } from '../lib/format'
import { ilSeverity } from '../lib/il'

function sevColor(sev) {
  if (sev < 0.18) return 'text-yield'
  if (sev < 0.5) return 'text-amber'
  return 'text-risk'
}

export default function ILGauge({ ilMarkBps, marked = true, compact = false }) {
  const bps = ilMarkBps === undefined || ilMarkBps === null ? 0n : ilMarkBps
  const mag = Math.abs(Number(bps)) / 100 // percent
  const sev = ilSeverity(bps)
  const pct = Math.max(2, sev * 100)
  const color = sevColor(sev)

  // Flash when the RSC posts a fresh mark — makes "reactive on every swap" visible.
  const prev = useRef(null)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    const key = String(bps)
    if (prev.current !== null && prev.current !== key) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 1100)
      prev.current = key
      return () => clearTimeout(t)
    }
    prev.current = key
  }, [bps])

  if (!marked) {
    return (
      <div className="font-mono text-xs text-bone/40">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-mint align-middle" /> awaiting first mark
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'space-y-2'}>
      <div className="flex items-baseline justify-between">
        <span className="kicker">
          Impermanent loss
          {flash && (
            <span className="ml-2 inline-block animate-pulse rounded-sm bg-mint/15 px-1 font-mono text-[9px] uppercase tracking-wider text-mint">
              new mark
            </span>
          )}
        </span>
        <span
          className={`font-mono font-bold tabular-nums transition-colors duration-300 ${
            flash ? 'text-mint' : color
          } ${compact ? 'text-base' : 'text-2xl'}`}
        >
          {bps === 0n ? '0.00%' : fmtBpsPct(bps)}
        </span>
      </div>
      <div
        className={`relative h-2.5 w-full overflow-hidden rounded-full border bg-ink-soft transition-shadow duration-300 ${
          flash ? 'border-mint/60 animate-pulseRing' : 'border-white/10'
        }`}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg,#c6ff2e,#ffb020 55%,#ff2e6d)',
          }}
        />
      </div>
      {!compact && (
        <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider text-bone/30">
          <span>hodl parity</span>
          <span>{mag > 0.01 ? `${mag.toFixed(2)}% below hodl` : 'at parity'}</span>
        </div>
      )}
    </div>
  )
}
