import { useMemo, useState, useEffect } from 'react'
import { Kicker } from './ui/Bits'
import { fmtBpsPct, fmtNum, timeAgo } from '../lib/format'
import { sqrtPriceToPrice } from '../lib/il'

// Trading-style colours: green = price up over the candle (net buying),
// red = price down (net selling).
const UP = '#26d07c'
const DOWN = '#ff3b6b'
const LIVE = '#2ef8d8' // mint — the forming/live candle, awaiting the next swap
const MAX_CANDLES = 32

/**
 * Position history charts (stacked, full-width):
 *  1. Pool price as a candlestick chart — green candle = price rose during the
 *     window (buy pressure), red = fell (sell pressure). Built from SwapOccurred
 *     prices: each candle opens at the previous close and closes at the latest
 *     price in its bucket, with wicks from the bucket's high/low.
 *  2. Impermanent-loss mark over time (line, magenta / risk).
 */
export default function PositionChart({ ilMarks, swaps, entryPrice }) {
  const priceSeries = useMemo(
    () =>
      swaps.map((s) => ({
        ts: s.ts,
        price: sqrtPriceToPrice(s.args.sqrtPriceX96),
      })),
    [swaps],
  )

  const ilSeries = useMemo(
    () => ilMarks.map((m) => ({ ts: m.ts, bps: Number(m.args.ilBps) })),
    [ilMarks],
  )

  // Pre-pend an "entry" point at 0 IL so the line starts at 0 instead of mid-air.
  const ilPlot = useMemo(() => {
    if (!ilSeries.length) return []
    const t0 = swaps[0]?.ts || ilSeries[0].ts - 60
    return [{ ts: t0, bps: 0 }, ...ilSeries]
  }, [ilSeries, swaps])

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
    <div className="space-y-4">
      <CandleChart data={priceSeries} entryPrice={entryPrice} />
      <MiniChart
        title="Impermanent loss"
        sub={ilSeries.length ? `${ilSeries.length} marks · one per RSC cycle` : 'no marks yet'}
        data={ilPlot}
        getY={(d) => d.bps}
        formatY={(v) => fmtBpsPct(v)}
        color="#ff2e6d"
        baseline={0}
        accent="risk"
      />
    </div>
  )
}

// ── candlestick pool-price chart ─────────────────────────────────────────────
function CandleChart({ data, entryPrice }) {
  const W = 720
  const H = 260
  const PAD = { l: 10, r: 58, t: 16, b: 24 }
  const [hover, setHover] = useState(null)

  // Live candle flicker: randomly oscillate the most-recent candle between green
  // and red on a short interval for a "live ticker" feel (pattern is random).
  const [liveUp, setLiveUp] = useState(true)
  useEffect(() => {
    const id = setInterval(() => setLiveUp(Math.random() > 0.5), 650)
    return () => clearInterval(id)
  }, [])
  const liveColor = liveUp ? UP : DOWN

  const model = useMemo(() => {
    if (!data.length) return null
    const n = data.length
    const groupSize = Math.max(1, Math.ceil(n / MAX_CANDLES))
    const groups = []
    for (let i = 0; i < n; i += groupSize) groups.push(data.slice(i, i + groupSize))

    let prevClose = entryPrice && entryPrice > 0 ? entryPrice : groups[0][0].price
    const candles = groups.map((g) => {
      const open = prevClose
      const close = g[g.length - 1].price
      const prices = g.map((d) => d.price)
      const high = Math.max(open, close, ...prices)
      const low = Math.min(open, close, ...prices)
      prevClose = close
      return { open, close, high, low, ts: g[g.length - 1].ts, n: g.length, up: close >= open }
    })

    let yMin = Math.min(...candles.map((c) => c.low), entryPrice || Infinity)
    let yMax = Math.max(...candles.map((c) => c.high), entryPrice || -Infinity)
    if (yMin === yMax) {
      const pad = Math.abs(yMin) * 0.05 + 1e-6
      yMin -= pad
      yMax += pad
    } else {
      const r = yMax - yMin
      yMin -= r * 0.12
      yMax += r * 0.12
    }

    const plotW = W - PAD.l - PAD.r
    const step = plotW / candles.length
    const bodyW = Math.min(step * 0.62, 22)
    const sy = (v) => PAD.t + (1 - (v - yMin) / Math.max(1e-9, yMax - yMin)) * (H - PAD.t - PAD.b)
    const cx = (i) => PAD.l + step * i + step / 2

    return { candles, yMin, yMax, step, bodyW, sy, cx, plotW }
  }, [data, entryPrice])

  if (!model) {
    return (
      <div className="card p-5">
        <Kicker>Pool price</Kicker>
        <p className="mt-3 font-mono text-sm text-bone/40">No swaps recorded yet.</p>
      </div>
    )
  }

  const { candles, yMin, yMax, step, bodyW, sy, cx } = model
  const lastClose = candles.at(-1).close
  const changePct = entryPrice ? (lastClose / entryPrice - 1) * 100 : 0
  const entryY = entryPrice && entryPrice > 0 ? sy(entryPrice) : null
  const active = hover != null ? candles[hover] : candles.at(-1)
  const activeUp = active.up

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Kicker>Pool price</Kicker>
            <span className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-mint">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint" />
              </span>
              live
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-bone/30">
            {data.length} swaps · {candles.length} candles{step < 9 ? ' (grouped)' : ''}
          </p>
        </div>
        <div className="text-right">
          <div
            className="font-mono text-2xl font-bold tabular-nums"
            style={{ color: activeUp ? UP : DOWN }}
          >
            {fmtNum(active.close, 4)}
          </div>
          {entryPrice > 0 && (
            <div
              className="font-mono text-[11px] font-bold tabular-nums"
              style={{ color: changePct >= 0 ? UP : DOWN }}
            >
              {changePct >= 0 ? '+' : ''}
              {changePct.toFixed(2)}% vs entry
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-3 rounded-lg border border-white/8 bg-ink-soft/40">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-56 w-full sm:h-64"
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
        >
          {/* horizontal gridlines + price labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((p) => {
            const y = PAD.t + p * (H - PAD.t - PAD.b)
            const v = yMax - p * (yMax - yMin)
            return (
              <g key={p}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={W - PAD.r + 6}
                  y={y + 3}
                  fill="rgba(243,239,228,0.35)"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {fmtNum(v, 4)}
                </text>
              </g>
            )
          })}

          {/* entry baseline */}
          {entryY !== null && (
            <>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={entryY}
                y2={entryY}
                stroke="rgba(255,255,255,0.3)"
                strokeDasharray="4 3"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PAD.l + 2}
                y={entryY - 4}
                fill="rgba(243,239,228,0.4)"
                fontSize="8"
                fontFamily="monospace"
              >
                entry
              </text>
            </>
          )}

          {/* candles */}
          {candles.map((c, i) => {
            const x = cx(i)
            const isLast = i === candles.length - 1
            // The live candle flickers green/red; the rest keep their true colour.
            const color = isLast ? liveColor : c.up ? UP : DOWN
            const yO = sy(c.open)
            const yC = sy(c.close)
            const top = Math.min(yO, yC)
            const bh = Math.max(Math.abs(yO - yC), 1.2)
            const isHover = hover === i
            return (
              <g key={i} opacity={hover != null && !isHover ? 0.55 : 1}>
                {/* wick */}
                <line
                  x1={x}
                  x2={x}
                  y1={sy(c.high)}
                  y2={sy(c.low)}
                  stroke={color}
                  strokeWidth="1.4"
                  vectorEffect="non-scaling-stroke"
                />
                {/* body */}
                <rect
                  x={x - bodyW / 2}
                  y={top}
                  width={bodyW}
                  height={bh}
                  fill={color}
                  rx="0.5"
                />
                {/* live pulse on the most-recent candle — breathes green until a
                    new swap arrives, at which point the data refetches (12s poll)
                    and the pulse re-attaches to the new last candle on its own. */}
                {isLast && (
                  <g>
                    <line
                      x1={x}
                      x2={x}
                      y1={sy(c.high)}
                      y2={sy(c.low)}
                      stroke={liveColor}
                      strokeWidth="1.4"
                      vectorEffect="non-scaling-stroke"
                    >
                      <animate attributeName="opacity" values="0;0.9;0" dur="1.6s" repeatCount="indefinite" />
                    </line>
                    <circle cx={x} cy={sy(c.close)} r="3" fill={liveColor}>
                      <animate attributeName="r" values="3;8;3" dur="1.6s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.9;0;0.9" dur="1.6s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={x} cy={sy(c.close)} r="2.4" fill={liveColor} />
                  </g>
                )}
                {/* hover hit-area */}
                <rect
                  x={x - step / 2}
                  y={0}
                  width={step}
                  height={H}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  style={{ cursor: 'crosshair' }}
                />
              </g>
            )
          })}
        </svg>

        {/* hover tooltip */}
        {hover != null && (
          <div
            className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-md border border-white/10 bg-ink px-2.5 py-1.5 font-mono text-[10px] leading-tight shadow-lg"
            style={{ left: `${(cx(hover) / W) * 100}%` }}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: active.up ? UP : DOWN }}
              />
              <span style={{ color: active.up ? UP : DOWN }}>{active.up ? 'BUY' : 'SELL'}</span>
              <span className="text-bone/40">· {timeAgo(active.ts)}</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-bone/70">
              <span className="text-bone/35">O</span>
              <span className="tabular-nums">{fmtNum(active.open, 4)}</span>
              <span className="text-bone/35">C</span>
              <span className="tabular-nums">{fmtNum(active.close, 4)}</span>
              <span className="text-bone/35">H</span>
              <span className="tabular-nums">{fmtNum(active.high, 4)}</span>
              <span className="text-bone/35">L</span>
              <span className="tabular-nums">{fmtNum(active.low, 4)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-bone/30">
        <span>{timeAgo(candles[0].ts)}</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: UP }} /> buy
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: DOWN }} /> sell
          </span>
        </div>
        <span>{timeAgo(candles.at(-1).ts)}</span>
      </div>
    </div>
  )
}

// ── impermanent-loss line chart ──────────────────────────────────────────────
function MiniChart({ title, sub, data, getY, formatY, color, baseline, accent }) {
  const W = 720
  const H = 170
  const PAD = { l: 8, r: 8, t: 12, b: 20 }

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
    const sx = (t) => PAD.l + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - PAD.l - PAD.r)
    const sy = (v) => PAD.t + (1 - (v - yMin) / Math.max(1e-9, yMax - yMin)) * (H - PAD.t - PAD.b)
    return {
      d: data.map((p) => ({ x: sx(p.ts), y: sy(getY(p)), raw: p })),
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
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-40 w-full" preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map((p) => (
            <line
              key={p}
              x1={PAD.l}
              x2={W - PAD.r}
              y1={PAD.t + p * (H - PAD.t - PAD.b)}
              y2={PAD.t + p * (H - PAD.t - PAD.b)}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
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
              vectorEffect="non-scaling-stroke"
            />
          )}

          {points && points.d.length > 1 && (
            <>
              <path
                d={`M ${points.d[0].x} ${H - PAD.b} ${points.d
                  .map((p) => `L ${p.x} ${p.y}`)
                  .join(' ')} L ${points.d.at(-1).x} ${H - PAD.b} Z`}
                fill={color}
                opacity="0.12"
              />
              <path
                d={`M ${points.d.map((p) => `${p.x} ${p.y}`).join(' L ')}`}
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
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
