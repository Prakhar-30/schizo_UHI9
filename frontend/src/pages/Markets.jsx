import { useMemo } from 'react'
import { usePositions, useHookCounters, useReactiveStatus } from '../hooks/reads'
import { useNetwork } from '../context/NetworkContext'
import { fmtBpsPct } from '../lib/format'
import Stat from '../components/ui/Stat'
import { Card } from '../components/ui/Card'
import { Kicker, Dot, SectionHead, Spinner } from '../components/ui/Bits'
import PositionCard from '../components/PositionCard'
import Faucet from '../components/Faucet'

export default function Markets() {
  const net = useNetwork()
  const { positions, isLoading, refetch: refetchPositions } = usePositions()
  const { nextId, activeCount, bundles } = useHookCounters()
  const rsc = useReactiveStatus()

  const sorted = useMemo(
    () => [...positions].sort((a, b) => (a.active === b.active ? b.id - a.id : a.active ? -1 : 1)),
    [positions],
  )
  const activeSold = positions.filter((p) => p.active && p.ilBondSold)
  const avgIL = activeSold.length
    ? activeSold.reduce((s, p) => s + Number(p.liveIlBps ?? p.ilMarkBps), 0) / activeSold.length
    : 0

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
          href={net.reactscanUrl(net.addr.reactive)}
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
        <Stat label="Pools" value={net.pools.length.toString()} sub="dynamic-fee markets" accent="mint" />
        <Stat
          label="Avg IL (sold)"
          value={activeSold.length ? fmtBpsPct(avgIL) : '—'}
          accent="risk"
          sub={`${activeSold.length} sold bonds`}
        />
      </div>

      {/* test-token faucet (scoped to the chosen pool) */}
      <div className="mt-10 lg:max-w-md">
        <Faucet showSelector banner />
      </div>

      {/* positions (full width — data only) */}
      <div className="mt-10">
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
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((p) => (
              <PositionCard key={p.id} position={p} marked={bundles > 0n} onAction={refetchPositions} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
