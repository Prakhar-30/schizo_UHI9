// Tiny SVG sparkline of a pool's price series. Green if up over the window, red if down.
export default function PoolTrend({ prices, width = 140, height = 40 }) {
  if (!prices || prices.length < 2) {
    return (
      <div
        className="flex items-center justify-center font-mono text-[9px] uppercase tracking-wider text-bone/25"
        style={{ width, height }}
      >
        no swaps yet
      </div>
    )
  }
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const span = max - min || Math.abs(max) * 0.001 || 1
  const pad = 3
  const n = prices.length
  const x = (i) => pad + (i / (n - 1)) * (width - 2 * pad)
  const y = (v) => pad + (1 - (v - min) / span) * (height - 2 * pad)
  const up = prices[n - 1] >= prices[0]
  const color = up ? '#26d07c' : '#ff3b6b'
  const d = prices.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ')
  const area = `${d} L ${x(n - 1).toFixed(1)} ${height - pad} L ${x(0).toFixed(1)} ${height - pad} Z`
  const hx = x(n - 1)
  const hy = y(prices[n - 1])
  return (
    <svg width={width} height={height} className="block">
      <path d={area} fill={color} opacity="0.12" />
      <path d={d} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* live head — bobs up/down a touch and blinks, so it reads as live (auto-refreshes every ~12s) */}
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
