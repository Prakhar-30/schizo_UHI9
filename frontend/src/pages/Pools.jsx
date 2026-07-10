import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePool } from '../context/PoolContext'
import { useNetwork } from '../context/NetworkContext'
import { usePoolStats, usePoolSwapSeries } from '../hooks/reads'
import { humanPrice } from '../lib/il'
import { fmtNum, fmtCompact } from '../lib/format'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Spinner } from '../components/ui/Bits'
import PoolTrend from '../components/PoolTrend'

// Uniswap-style table: click a column header to sort by it, click again to flip
// direction. The active column shows a ▲/▼ caret. Numeric columns default to
// descending on first click; the name column defaults to ascending.
const COLUMNS = [
  { key: 'name', label: 'Pair', align: 'left', sortable: true, defaultDir: 'asc' },
  { key: 'price', label: 'Price', align: 'right', sortable: true, defaultDir: 'desc' },
  { key: 'trend', label: 'Trend', align: 'right', sortable: false },
  { key: 'activity', label: 'Activity', align: 'right', sortable: true, defaultDir: 'desc' },
  { key: 'fee', label: 'Fee (live)', align: 'right', sortable: true, defaultDir: 'desc' },
  { key: 'liquidity', label: 'Liquidity', align: 'right', sortable: true, defaultDir: 'desc' },
]
// Full literal (incl. the `lg:` variant) so Tailwind's JIT scanner emits the CSS.
const GRID_LG = 'lg:grid-cols-[1.4fr_1fr_0.9fr_0.8fr_0.9fr_1.1fr]'

// Continuous green→red as the live fee climbs above the 0.30% base toward the 3% cap.
function feeStyle(pips) {
  if (pips === undefined) return { color: 'rgba(243,239,228,0.4)' }
  const t = Math.max(0, Math.min(1, (pips - 3000) / (30000 - 3000)))
  const r = Math.round(198 + (255 - 198) * t)
  const g = Math.round(255 + (46 - 255) * t)
  const b = Math.round(46 + (109 - 46) * t)
  return { color: `rgb(${r},${g},${b})` }
}

export default function Pools() {
  const navigate = useNavigate()
  const net = useNetwork()
  const { setPoolId } = usePool()
  const { byId, isLoading } = usePoolStats()
  const { data: series, isLoading: seriesLoading } = usePoolSwapSeries()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState({ key: 'liquidity', dir: 'desc' })

  const openPool = (id) => {
    setPoolId(id)
    navigate('/create')
  }

  const toggleSort = (col) => {
    if (!col.sortable) return
    setSort((s) =>
      s.key === col.key
        ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key: col.key, dir: col.defaultDir },
    )
  }

  const rows = useMemo(() => {
    const list = net.pools.map((p) => {
      const stat = byId[p.id.toLowerCase()]
      const swaps = series?.[p.id.toLowerCase()] || []
      const swapPrices = swaps
        .map((s) => humanPrice(s.sqrtPriceX96, p.dec0, p.dec1))
        .filter((v) => Number.isFinite(v) && v > 0)
      const price = stat ? humanPrice(stat.sqrtPriceX96, p.dec0, p.dec1) : 0
      // Anchor every sparkline at the pool's 1:1 launch baseline, then plot each
      // observed swap, ending at the live price. Collapse consecutive duplicates.
      const LAUNCH = 1
      const raw = [LAUNCH, ...swapPrices, ...(price > 0 ? [price] : [])]
      const prices = raw.filter((v, i) => i === 0 || v !== raw[i - 1])
      const change = price > 0 ? (price / LAUNCH - 1) * 100 : 0
      return {
        ...p,
        price,
        prices,
        change,
        swapCount: swaps.length,
        liquidity: stat?.liquidity,
        dynFee: stat?.dynFee,
      }
    })
    const filtered = q
      ? list.filter((r) => r.label.toLowerCase().includes(q.toLowerCase().replace(/\s/g, '')))
      : list
    const dir = sort.dir === 'asc' ? 1 : -1
    const s = [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return a.label.localeCompare(b.label) * dir
        case 'price':
          return (a.change - b.change) * dir
        case 'activity':
          return (a.swapCount - b.swapCount) * dir
        case 'fee':
          return ((a.dynFee || 0) - (b.dynFee || 0)) * dir
        case 'liquidity':
          return Number((a.liquidity || 0n) - (b.liquidity || 0n)) * dir
        default:
          return 0
      }
    })
    return s
  }, [byId, series, q, sort, net])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Pools</Kicker>
          <h1 className="mt-2 font-black text-balance text-3xl tracking-tight sm:text-5xl">
            Every pool the hook runs
          </h1>
          <p className="mt-3 max-w-xl text-sm text-bone/55 sm:text-base">
            Dynamic-fee pools, each marked to market by the hook on every swap. Provide IL-bonded liquidity
            on any of them. Prices are decimal-adjusted to whole units.
          </p>
        </div>
      </div>

      <div className="mt-8">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search pair, e.g. WETH or USDC"
          className="w-full rounded-lg border-2 border-white/12 bg-ink-soft/60 px-3 py-2.5 font-mono text-sm text-bone outline-none focus:border-volt/50 sm:max-w-sm"
        />
      </div>

      <div className={`mt-6 hidden ${GRID_LG} gap-4 border-b border-white/10 px-4 pb-2 lg:grid`}>
        {COLUMNS.map((c) => {
          const active = sort.key === c.key
          return (
            <button
              key={c.key}
              onClick={() => toggleSort(c)}
              disabled={!c.sortable}
              className={`flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                c.align === 'right' ? 'justify-end' : ''
              } ${c.sortable ? 'cursor-pointer hover:text-bone' : 'cursor-default'} ${
                active ? 'text-volt' : 'text-bone/30'
              }`}
            >
              {c.align === 'right' && active && <span>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
              {c.label}
              {c.align === 'left' && active && <span>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
            </button>
          )
        })}
      </div>

      {isLoading && rows.every((r) => !r.liquidity) ? (
        <div className="mt-8 flex items-center gap-2 font-mono text-sm text-bone/40">
          <Spinner /> loading pools…
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {rows.map((r) => (
            <Card
              key={r.id}
              onClick={() => openPool(r.id)}
              className="cursor-pointer p-4 transition-colors hover:border-volt/40"
              title={`Provide IL-bonded liquidity on ${r.label}`}
            >
              <div className={`grid grid-cols-2 items-center gap-4 ${GRID_LG}`}>
                <div className="flex items-center gap-2">
                  <span className="font-display text-base font-bold">{r.label}</span>
                  {r.demo && <Chip color="mint">demo · faucet</Chip>}
                </div>

                <div className="text-right">
                  <div className="font-mono text-sm font-bold tabular-nums">
                    {r.price ? fmtNum(r.price, r.price < 1 ? 6 : 4) : '–'}
                  </div>
                  <div
                    className={`font-mono text-[11px] tabular-nums ${
                      r.swapCount === 0 ? 'text-bone/30' : r.change >= 0 ? 'text-[#26d07c]' : 'text-[#ff3b6b]'
                    }`}
                    title={r.swapCount === 0 ? 'no swaps yet' : `${r.swapCount} swap${r.swapCount === 1 ? '' : 's'} · since 1:1 launch`}
                  >
                    {r.swapCount === 0 ? 'no trades' : `${r.change >= 0 ? '+' : ''}${r.change.toFixed(2)}%`}
                  </div>
                </div>

                <div className="flex justify-end">
                  <PoolTrend prices={r.prices} current={r.price} muted={r.swapCount === 0} loading={seriesLoading && r.swapCount === 0} />
                </div>

                <div className="hidden text-right font-mono text-sm tabular-nums text-bone/70 lg:block">
                  {seriesLoading && r.swapCount === 0 ? '…' : r.swapCount}
                </div>

                <div className="hidden text-right font-mono text-sm font-bold tabular-nums lg:block" style={feeStyle(r.dynFee)}>
                  {r.dynFee !== undefined ? `${(r.dynFee / 10000).toFixed(3)}%` : '–'}
                </div>

                <div className="hidden text-right font-mono text-sm tabular-nums text-bone/70 lg:block">
                  {r.liquidity !== undefined ? fmtCompact(r.liquidity) : '–'}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/8 pt-3 font-mono text-[11px] tabular-nums text-bone/50 lg:hidden">
                <span>{seriesLoading && r.swapCount === 0 ? '…' : `${r.swapCount} swaps`}</span>
                <span style={feeStyle(r.dynFee)}>{r.dynFee !== undefined ? `${(r.dynFee / 10000).toFixed(3)}% fee` : '–'}</span>
                <span>{r.liquidity !== undefined ? `${fmtCompact(r.liquidity)} L` : '–'}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 font-mono text-[11px] text-bone/35">
        {rows.length} pools · fee rises with realized volatility (0.30% base → 3% cap) · prices update every ~12s
      </p>
    </div>
  )
}
