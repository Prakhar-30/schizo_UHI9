import { useMemo } from 'react'
import { usePositions, useHookCounters, useReactiveStatus, useActivity } from '../hooks/reads'
import { POOLS } from '../config/pools'
import { fmtBpsPct } from '../lib/format'
import { ADDR, reactscanAddr } from '../config/contracts'
import Stat from '../components/ui/Stat'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Dot, Addr, SectionHead, Spinner } from '../components/ui/Bits'
import PositionCard from '../components/PositionCard'
import SwapPanel from '../components/SwapPanel'
import ActivityFeed from '../components/ActivityFeed'

export default function Markets() {
  const { positions, isLoading, refetch: refetchPositions } = usePositions()
  const { nextId, activeCount, bundles } = useHookCounters()
  const { data: activity, isLoading: actLoading, refetch: refetchActivity } = useActivity({ limit: 60 })
  const rsc = useReactiveStatus()

  const sorted = useMemo(
    () => [...positions].sort((a, b) => (a.active === b.active ? b.id - a.id : a.active ? -1 : 1)),
    [positions],
  )
  const activeSold = positions.filter((p) => p.active && p.ilBondSold)
  const avgIL = activeSold.length
    ? activeSold.reduce((s, p) => s + Number(p.ilMarkBps), 0) / activeSold.length
    : 0

  const onSwapped = () => {
    refetchPositions()
    setTimeout(() => {
      refetchPositions()
      refetchActivity()
    }, 6000)
  }

  const reactBal = rsc.balance !== undefined ? (Number(rsc.balance) / 1e18).toFixed(3) : '—'

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Live markets</Kicker>
          <h1 className="mt-2 font-black text-balance text-3xl tracking-tight sm:text-5xl">The IL bond book</h1>
          <p className="mt-3 max-w-xl text-sm text-bone/55 sm:text-base">
            Every open position on the hook, with the impermanent-loss mark the Reactive Network posts on each swap.
          </p>
        </div>
        <a
          href={reactscanAddr(ADDR.reactive)}
          target="_blank"
          rel="noreferrer"
          className="card-flat flex items-center gap-3 px-4 py-3"
        >
          <Dot color={rsc.online ? 'mint' : 'amber'} pulse={rsc.online} />
          <div>
            <p className="font-mono text-xs font-bold">{rsc.online ? 'RSC online' : 'RSC syncing'}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-bone/40">
              {reactBal} REACT · {rsc.activeCount !== undefined ? rsc.activeCount.toString() : '—'} tracked
            </p>
          </div>
          <span className="text-bone/30">↗</span>
        </a>
      </div>

      {/* stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
        <Stat label="Positions minted" value={nextId !== undefined ? nextId.toString() : '—'} loading={nextId === undefined} />
        <Stat label="Active bonds" value={activeCount !== undefined ? activeCount.toString() : '—'} accent="yield" loading={activeCount === undefined} />
        <Stat label="RSC data bundles" value={bundles !== undefined ? bundles.toString() : '—'} accent="volt" loading={bundles === undefined} />
        <Stat label="Pools" value={POOLS.length.toString()} sub="dynamic-fee markets" accent="mint" />
        <Stat
          label="Avg IL (sold)"
          value={activeSold.length ? fmtBpsPct(avgIL) : '—'}
          accent="risk"
          sub={`${activeSold.length} sold bonds`}
        />
      </div>

      {/* body */}
      <div className="mt-10 grid gap-8 lg:grid-cols-[1.55fr_1fr]">
        {/* positions */}
        <div className="order-2 lg:order-1">
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
              <p className="mt-1 text-sm text-bone/30">Be the first — mint one on the Create page.</p>
            </Card>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              {sorted.map((p) => (
                <PositionCard key={p.id} position={p} marked={bundles > 0n} onAction={refetchPositions} />
              ))}
            </div>
          )}
        </div>

        {/* aside */}
        <aside className="order-1 space-y-6 lg:sticky lg:top-20 lg:order-2 lg:self-start">
          <SwapPanel onSwapped={onSwapped} />

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <Kicker>Activity</Kicker>
              <Chip color="volt">reactive-aware</Chip>
            </div>
            <div className="mt-2 max-h-[28rem] overflow-y-auto pr-1">
              <ActivityFeed events={activity} isLoading={actLoading} />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}
