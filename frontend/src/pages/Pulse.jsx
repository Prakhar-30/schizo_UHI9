import { useEffect, useMemo, useState } from 'react'
import { useActivity, useHookCounters, useReactiveStatus, usePositions, REFRESH } from '../hooks/reads'
import { useNetwork } from '../context/NetworkContext'
import ActivityFeed from '../components/ActivityFeed'
import { Card } from '../components/ui/Card'
import { Kicker, Dot } from '../components/ui/Bits'
import Stat from '../components/ui/Stat'

// Number of feed rows revealed per "load more" step.
const PAGE = 150

// Small live "auto-refreshing in Ns" pill. Counts down to the next react-query
// refetch (anchored to the query's dataUpdatedAt), then shows "refreshing…" for
// the real in-flight fetch — so the cycle is always countdown → refresh → reset,
// with no stuck "0s". `isFetching` is react-query's true fetch state.
function AutoRefresh({ dataUpdatedAt, isFetching, intervalMs = REFRESH }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const nextAt = (dataUpdatedAt || now) + intervalMs
  const secs = Math.max(0, Math.ceil((nextAt - now) / 1000))
  // Treat "countdown hit zero" the same as "fetching" so we never linger on 0s:
  // the refetch fires at zero and dataUpdatedAt bumps when it lands, restarting
  // the countdown whether or not the data actually changed.
  const busy = isFetching || secs === 0
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-soft/50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-bone/50">
      <Dot color={busy ? 'volt' : 'mint'} pulse />
      {busy ? 'refreshing…' : `auto-refresh in ${secs}s`}
    </div>
  )
}

// Platform-wide live activity — every hook event across all pools.
export default function Pulse() {
  const net = useNetwork()
  // limit: null → the full event history (backend-first, no cap). We reveal it
  // progressively below so a long history doesn't render thousands of rows at once.
  const { data: activity, isLoading, isFetching, dataUpdatedAt } = useActivity({ limit: null })
  const { nextId, activeCount, bundles } = useHookCounters()
  const { positions } = usePositions()
  const rsc = useReactiveStatus()

  const total = activity?.length || 0
  const [visible, setVisible] = useState(PAGE)
  const shown = useMemo(() => (activity || []).slice(0, visible), [activity, visible])
  const hasMore = total > shown.length

  // Resolve each event's position so ILBondSold shows the correct premium token.
  const positionsById = useMemo(() => {
    const m = {}
    for (const p of positions) m[Number(p.id)] = p
    return m
  }, [positions])

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Platform pulse</Kicker>
          <h1 className="mt-2 font-black text-balance text-3xl tracking-tight sm:text-5xl">Live activity</h1>
          <p className="mt-3 max-w-xl text-sm text-bone/55 sm:text-base">
            Every event the hook emits — across all pools — as it lands: swaps, mints, bond sales, and the Reactive
            Network's IL marks.
          </p>
        </div>
        <a
          href={net.reactscanUrl(net.addr.reactive)}
          target="_blank"
          rel="noreferrer"
          className="card-flat flex items-center gap-3 px-4 py-3"
        >
          <Dot color={rsc.online ? 'mint' : 'amber'} pulse={rsc.online} />
          <span className="font-mono text-xs font-bold">{rsc.online ? 'RSC online' : 'RSC syncing'}</span>
          <span className="text-bone/30">↗</span>
        </a>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Positions minted" value={nextId !== undefined ? nextId.toString() : '—'} />
        <Stat label="Active bonds" value={activeCount !== undefined ? activeCount.toString() : '—'} accent="yield" />
        <Stat label="RSC data bundles" value={bundles !== undefined ? bundles.toString() : '—'} accent="volt" />
        <Stat label="Total events" value={total ? total.toString() : '—'} accent="mint" />
      </div>

      <Card className="mt-8 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <Kicker>Most recent first</Kicker>
          <AutoRefresh dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} />
        </div>
        <div className="mt-3 max-h-[70vh] overflow-y-auto pr-1">
          <ActivityFeed
            events={shown}
            isLoading={isLoading}
            emptyLabel="No activity yet — make a swap or mint a bond."
            positionsById={positionsById}
          />
          {hasMore && (
            <div className="flex items-center justify-center pt-4">
              <button
                onClick={() => setVisible((v) => v + PAGE)}
                className="card-flat px-4 py-2 font-mono text-xs uppercase tracking-wider text-bone/60 hover:text-volt"
              >
                Load more · showing {shown.length} of {total}
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
