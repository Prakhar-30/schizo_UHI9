import { useMemo } from 'react'
import { usePositions, useHookCounters, useMarkCount, useActivity } from '../hooks/reads'
import { useNetwork } from '../context/NetworkContext'
import { fmtBpsPct } from '../lib/format'
import Stat from '../components/ui/Stat'
import { Card } from '../components/ui/Card'
import { Kicker, Dot, SectionHead, Spinner } from '../components/ui/Bits'
import PositionCard from '../components/PositionCard'
import ActivityFeed from '../components/ActivityFeed'
import Faucet from '../components/Faucet'

export default function Markets() {
  const net = useNetwork()
  const { positions, isLoading, refetch: refetchPositions } = usePositions()
  const { nextId, activeCount } = useHookCounters()
  const { count: markCount } = useMarkCount()
  const { data: activity, isLoading: activityLoading } = useActivity({ limit: 40 })

  const sorted = useMemo(
    () => [...positions].sort((a, b) => (a.active === b.active ? b.id - a.id : a.active ? -1 : 1)),
    [positions],
  )
  const activeSold = positions.filter((p) => p.active && p.ilBondSold)
  const avgIL = activeSold.length
    ? activeSold.reduce((s, p) => s + Number(p.liveIlBps ?? p.ilMarkBps), 0) / activeSold.length
    : 0

  const positionsById = useMemo(() => {
    const m = {}
    for (const p of positions) m[Number(p.id)] = p
    return m
  }, [positions])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Live markets</Kicker>
          <h1 className="mt-2 font-black text-balance text-3xl tracking-tight sm:text-5xl">The IL bond book</h1>
          <p className="mt-3 max-w-xl text-sm text-bone/55 sm:text-base">
            Every open position on the hook, with an impermanent-loss mark derived live from each pool's smoothed price.
          </p>
        </div>
        <a
          href={net.addrUrl(net.addr.hook)}
          target="_blank"
          rel="noreferrer"
          className="card-flat flex items-center gap-3 px-4 py-3"
        >
          <Dot color="mint" pulse />
          <div>
            <p className="font-mono text-xs font-bold">Marks live in-hook</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-bone/40">
              {activeCount !== undefined ? activeCount.toString() : '–'} tracked · zero dependencies
            </p>
          </div>
          <span className="text-bone/30">↗</span>
        </a>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
        <Stat label="Positions minted" value={nextId !== undefined ? nextId.toString() : '–'} loading={nextId === undefined} />
        <Stat label="Active bonds" value={activeCount !== undefined ? activeCount.toString() : '–'} accent="yield" loading={activeCount === undefined} />
        <Stat label="Marks posted" value={markCount !== undefined ? markCount.toString() : '–'} accent="volt" loading={markCount === undefined} />
        <Stat label="Pools" value={net.pools.length.toString()} sub="dynamic-fee markets" accent="mint" />
        <Stat
          label="Avg IL (sold)"
          value={activeSold.length ? fmtBpsPct(avgIL) : '–'}
          accent="risk"
          sub={`${activeSold.length} sold bonds`}
        />
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_360px] lg:items-start">
        <div>
          <SectionHead
            kicker="Order book"
            title="Positions"
            right={
              <button onClick={refetchPositions} className="font-mono text-[11px] uppercase tracking-wider text-bone/40 hover:text-volt">
                ↻ refresh
              </button>
            }
          />
          {isLoading ? (
            <div className="mt-8 flex items-center gap-2 font-mono text-sm text-bone/40">
              <Spinner /> loading positions…
            </div>
          ) : sorted.length === 0 ? (
            <Card className="mt-6 p-10 text-center">
              <p className="font-mono text-sm text-bone/40">No positions yet.</p>
              <p className="mt-1 text-sm text-bone/30">Be the first: mint one on the Create page.</p>
            </Card>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {sorted.map((p) => (
                <PositionCard key={p.id} position={p} onAction={refetchPositions} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Faucet showSelector banner />
          <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
              <Kicker>Live activity</Kicker>
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-bone/40">
                <Dot color="mint" pulse /> all pools
              </div>
            </div>
            <div className="mt-3 max-h-[32rem] overflow-y-auto pr-1">
              <ActivityFeed
                events={activity}
                isLoading={activityLoading}
                emptyLabel="No activity yet. Make a swap or mint a bond."
                positionsById={positionsById}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
