import { useMemo } from 'react'
import { Kicker } from './ui/Bits'
import { fmtBpsPct, fmtNum, timeAgo } from '../lib/format'
import { sqrtPriceToPrice } from '../lib/il'

/**
 * Inline-SVG mini chart for position history.
 *  - Top line: IL mark over time (magenta / risk)
 *  - Bottom line: pool price over time (cyan / mint)
 * Both share an x-axis = block timestamp.
 */
export default function PositionChart({ ilMarks, swaps, entryPrice }) {
  const ilSeries = useMemo(
    () =>
      ilMarks.map((m) => ({
        ts: m.ts,
        bps: Number(m.args.ilBps),
      })),
    [ilMarks],
  )

  // Pre-pend an "entry" point at 0 IL based on the earliest swap timestamp
  // so the line starts at 0 instead of mid-air.
  const ilPlot = useMemo(() => {
    if (!ilSeries.length) return []
    const t0 = swaps[0]?.ts || ilSeries[0].ts - 60
    return [{ ts: t0, bps: 0 }, ...ilSeries]
  }, [ilSeries, swaps])

  const priceSeries = useMemo(
    () =>
      swaps.map((s) => ({
        ts: s.ts,
        price: sqrtPriceToPrice(s.args.sqrtPriceX96),
      })),
    [swaps],
  )

  if (!ilSeries.length && !priceSeries.length) {
    return (
      <div className="card p-6">
        <Kicker>History</Kicker>
        <p className="mt-3 font-mono text-sm text-bone/40">
          No on-chain activity recorded for this position yet.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <MiniChart
        title="Impermanent loss"
        sub={ilSeries.length ? `${ilSeries.length} marks posted by the RSC` : 'no marks yet'}
        data={ilPlot}
        getY={(d) => d.bps}
        formatY={(v) => fmtBpsPct(v)}
        color="#ff2e6d"
        baseline={0}
        accent="risk"
      />
      <MiniChart
        title="Pool price"
        sub={priceSeries.length ? `${priceSeries.length} swaps recorded` : 'no swaps yet'}
        data={priceSeries}
        getY={(d) => d.price}
        formatY={(v) => fmtNum(v, 4)}
        color="#2ef8d8"
        baseline={entryPrice}
        accent="mint"
      />
    </div>
  )
}

function MiniChart({ title, sub, data, getY, formatY, color, baseline, accent }) {
  const W = 360
  const H = 140
  const PAD = { l: 8, r: 8, t: 10, b: 18 }

  const points = useMemo(() => {
    if (data.length === 0) return null
    const ys = data.map(getY)
    const ts = data.map((d) => d.ts)
    let yMin = Math.min(...ys, baseline ?? Infinity)
    let yMax = Math.max(...ys, baseline ?? -Infinity)
    if (yMin === yMax) {
      const pad = Math.abs(yMin) * 0.1 + 1
      yMin -= pad
      yMax += pad
    } else {
      const range = yMax - yMin
      yMin -= range * 0.1
      yMax += range * 0.1
    }
    const tMin = Math.min(...ts)
    const tMax = Math.max(...ts) || tMin + 1
    const sx = (t) =>
      PAD.l + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - PAD.l - PAD.r)
    const sy = (v) =>
      PAD.t + (1 - (v - yMin) / Math.max(1e-9, yMax - yMin)) * (H - PAD.t - PAD.b)
    return {
      d: data.map((p) => ({ x: sx(p.ts), y: sy(getY(p)), raw: p })),
      sx,
      sy,
      yMin,
      yMax,
      tMin,
      tMax,
      baselineY: baseline !== undefined && baseline !== null && !isNaN(baseline) ? sy(baseline) : null,
    }
  }, [data, baseline, getY])

  const last = data.at(-1)
  const lastY = last !== undefined ? getY(last) : null

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <Kicker>{title}</Kicker>
          {sub && <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-bone/30">{sub}</p>}
        </div>
        {lastY !== null && (
          <div className={`font-mono text-xl font-bold tabular-nums text-${accent}`}>{formatY(lastY)}</div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-white/8 bg-ink-soft/40">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-32 w-full" preserveAspectRatio="none">
          {/* gridlines */}
          {[0.25, 0.5, 0.75].map((p) => (
            <line
              key={p}
              x1={PAD.l}
              x2={W - PAD.r}
              y1={PAD.t + p * (H - PAD.t - PAD.b)}
              y2={PAD.t + p * (H - PAD.t - PAD.b)}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="1"
            />
          ))}

          {points && points.baselineY !== null && (
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={points.baselineY}
              y2={points.baselineY}
              stroke="rgba(255,255,255,0.25)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
          )}

          {points && points.d.length > 1 && (
            <>
              {/* fill under line */}
              <path
                d={`M ${points.d[0].x} ${H - PAD.b} ${points.d
                  .map((p) => `L ${p.x} ${p.y}`)
                  .join(' ')} L ${points.d.at(-1).x} ${H - PAD.b} Z`}
                fill={color}
                opacity="0.12"
              />
              {/* line */}
              <path
                d={`M ${points.d.map((p) => `${p.x} ${p.y}`).join(' L ')}`}
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              {/* last point */}
              <circle cx={points.d.at(-1).x} cy={points.d.at(-1).y} r="3" fill={color} />
            </>
          )}

          {points && points.d.length === 1 && (
            <circle cx={points.d[0].x} cy={points.d[0].y} r="3" fill={color} />
          )}
        </svg>
      </div>

      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-bone/30">
        <span>{points ? timeAgo(points.tMin) : ''}</span>
        <span>{last ? timeAgo(last.ts) : ''}</span>
      </div>
    </div>
  )
}
