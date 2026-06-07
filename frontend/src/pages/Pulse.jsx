import { useActivity, useHookCounters, useReactiveStatus } from '../hooks/reads'
import { reactscanAddr, ADDR } from '../config/contracts'
import ActivityFeed from '../components/ActivityFeed'
import { Card } from '../components/ui/Card'
import { Kicker, Dot } from '../components/ui/Bits'
import Stat from '../components/ui/Stat'

// Platform-wide live activity — every hook event across all pools.
export default function Pulse() {
  const { data: activity, isLoading, refetch } = useActivity({ limit: 200 })
  const { nextId, activeCount, bundles } = useHookCounters()
  const rsc = useReactiveStatus()

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
          href={reactscanAddr(ADDR.reactive)}
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
        <Stat label="Events shown" value={activity?.length ? activity.length.toString() : '—'} accent="mint" />
      </div>

      <Card className="mt-8 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <Kicker>Most recent first</Kicker>
          <button onClick={refetch} className="font-mono text-[11px] uppercase tracking-wider text-bone/40 hover:text-volt">
            ↻ refresh
          </button>
        </div>
        <div className="mt-3 max-h-[70vh] overflow-y-auto pr-1">
          <ActivityFeed events={activity} isLoading={isLoading} emptyLabel="No activity yet — make a swap or mint a bond." />
        </div>
      </Card>
    </div>
  )
}
