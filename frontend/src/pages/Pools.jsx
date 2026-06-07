import { useMemo, useState } from 'react'
import { POOLS } from '../config/pools'
import { usePoolStats, usePoolSwapSeries } from '../hooks/reads'
import { humanPrice } from '../lib/il'
import { fmtNum, fmtCompact } from '../lib/format'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Spinner } from '../components/ui/Bits'
import PoolTrend from '../components/PoolTrend'

const SORTS = [
  { key: 'liq-desc', label: 'Liquidity' },
  { key: 'change-desc', label: 'Top movers' },
  { key: 'change-asc', label: 'Worst movers' },
  { key: 'fee-desc', label: 'Highest fee' },
  { key: 'name', label: 'Name' },
]

function feeColor(pips) {
  if (pips === undefined) return 'text-bone/40'
  if (pips <= 3000) return 'text-yield'
  if (pips < 12000) return 'text-amber'
  return 'text-risk'
}

export default function Pools() {
  const { byId, isLoading } = usePoolStats()
  const { data: series } = usePoolSwapSeries()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('liq-desc')

  const rows = useMemo(() => {
    const list = POOLS.map((p) => {
      const stat = byId[p.id.toLowerCase()]
      const swaps = series?.[p.id.toLowerCase()] || []
      const prices = swaps.map((s) => humanPrice(s.sqrtPriceX96, p.dec0, p.dec1))
      const price = stat ? humanPrice(stat.sqrtPriceX96, p.dec0, p.dec1) : 0
      const change = prices.length >= 2 ? (prices[prices.length - 1] / prices[0] - 1) * 100 : 0
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
    const s = [...filtered]
    switch (sort) {
      case 'liq-desc': s.sort((a, b) => Number((b.liquidity || 0n) - (a.liquidity || 0n))); break
      case 'change-desc': s.sort((a, b) => b.change - a.change); break
      case 'change-asc': s.sort((a, b) => a.change - b.change); break
      case 'fee-desc': s.sort((a, b) => (b.dynFee || 0) - (a.dynFee || 0)); break
      case 'name': s.sort((a, b) => a.label.localeCompare(b.label)); break
      default: break
    }
    return s
  }, [byId, series, q, sort])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Pools</Kicker>
          <h1 className="mt-2 font-black text-balance text-3xl tracking-tight sm:text-5xl">
            Every pool the hook runs
          </h1>
          <p className="mt-3 max-w-xl text-sm text-bone/55 sm:text-base">
            Dynamic-fee pools, each marked to market by the Reactive Network. Provide IL-bonded liquidity
            on any of them. Prices are decimal-adjusted to whole units.
          </p>
        </div>
      </div>

      {/* controls */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search pair, e.g. WETH or USDC"
          className="min-w-0 flex-1 rounded-lg border-2 border-white/12 bg-ink-soft/60 px-3 py-2 font-mono text-sm text-bone outline-none focus:border-volt/50 sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-1.5">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`rounded-lg border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                sort === s.key ? 'border-volt/60 bg-volt/10 text-volt' : 'border-white/12 text-bone/55 hover:border-white/25'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* list header (lg) */}
      <div className="mt-6 hidden grid-cols-[1.4fr_1fr_0.9fr_0.9fr_1.1fr] gap-4 px-4 font-mono text-[10px] uppercase tracking-wider text-bone/30 lg:grid">
        <span>Pair</span>
        <span className="text-right">Price</span>
        <span className="text-right">Trend</span>
        <span className="text-right">Fee (live)</span>
        <span className="text-right">Liquidity</span>
      </div>

      {isLoading && rows.every((r) => !r.liquidity) ? (
        <div className="mt-8 flex items-center gap-2 font-mono text-sm text-bone/40">
          <Spinner /> loading pools…
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="grid grid-cols-2 items-center gap-4 lg:grid-cols-[1.4fr_1fr_0.9fr_0.9fr_1.1fr]">
                {/* pair */}
                <div className="flex items-center gap-2">
                  <span className="font-display text-base font-bold">{r.label}</span>
                  {r.demo && <Chip color="mint">demo · faucet</Chip>}
                </div>

                {/* price */}
                <div className="text-right">
                  <div className="font-mono text-sm font-bold tabular-nums">
                    {r.price ? fmtNum(r.price, r.price < 1 ? 6 : 4) : '—'}
                  </div>
                  <div
                    className={`font-mono text-[11px] tabular-nums ${
                      r.change >= 0 ? 'text-[#26d07c]' : 'text-[#ff3b6b]'
                    }`}
                  >
                    {r.swapCount >= 2 ? `${r.change >= 0 ? '+' : ''}${r.change.toFixed(2)}%` : '·'}
                  </div>
                </div>

                {/* trend */}
                <div className="flex justify-end">
                  <PoolTrend prices={r.prices} />
                </div>

                {/* fee */}
                <div className={`text-right font-mono text-sm font-bold tabular-nums ${feeColor(r.dynFee)}`}>
                  {r.dynFee !== undefined ? `${(r.dynFee / 10000).toFixed(3)}%` : '—'}
                </div>

                {/* liquidity */}
                <div className="text-right font-mono text-sm tabular-nums text-bone/70">
                  {r.liquidity !== undefined ? fmtCompact(r.liquidity) : '—'}
                </div>
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
