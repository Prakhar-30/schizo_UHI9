// Tiny SVG sparkline of a pool's price series. Series is anchored at the pool's
// 1:1 launch and ends at the live price, so any pool that has traded shows its
// real move (green up / red down). `muted` = the pool has had zero swaps, so it
// renders grey & flat (nothing has happened yet) rather than implying a trend.
export default function PoolTrend({ prices, current, muted = false, loading = false, width = 140, height = 40 }) {
  const hasTrend = !muted && prices && prices.length >= 2
  let series = prices && prices.length >= 2 ? prices : current && current > 0 ? [current, current] : null

  // While the swap series is still loading, show a pulsing placeholder bar
  // instead of a misleading flat line.
  if (loading) {
    return (
      <div className="flex items-center justify-end" style={{ width, height }}>
        <div className="h-2 w-full animate-pulse rounded-full bg-white/10" />
      </div>
    )
  }

  if (!series) {
    return (
      <div
        className="flex items-center justify-center font-mono text-[9px] uppercase tracking-wider text-bone/25"
        style={{ width, height }}
      >
        —
      </div>
    )
  }

  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || Math.abs(max) * 0.001 || 1
  const pad = 3
  const n = series.length
  const x = (i) => pad + (i / (n - 1)) * (width - 2 * pad)
  const y = (v) => pad + (1 - (v - min) / span) * (height - 2 * pad)
  const up = series[n - 1] >= series[0]
  const color = !hasTrend ? '#6a6a78' : up ? '#26d07c' : '#ff3b6b' // grey = flat/no trades
  const d = series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ')
  const area = `${d} L ${x(n - 1).toFixed(1)} ${height - pad} L ${x(0).toFixed(1)} ${height - pad} Z`
  const hx = x(n - 1)
  const hy = y(series[n - 1])
  return (
    <svg width={width} height={height} className="block">
      {hasTrend && <path d={area} fill={color} opacity="0.12" />}
      <path d={d} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* live head — bobs + blinks so the row reads as live (auto-refreshes ~12s) */}
      <circle cx={hx} cy={hy} r="3.5" fill={color} opacity="0.25">
        <animate attributeName="r" values="3;7;3" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.35;0;0.35" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx={hx} cy={hy} r="2.4" fill={color}>
        <animate attributeName="cy" values={`${hy};${hy - 2.2};${hy};${hy + 2.2};${hy}`} dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}
