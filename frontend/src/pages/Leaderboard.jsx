import { useAccount } from 'wagmi'
import { useLeaderboardData, useHookCounters } from '../hooks/reads'
import { fmtToken, isSameAddr, shortAddr } from '../lib/format'
import { sepoliaAddr } from '../config/contracts'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Spinner, Addr } from '../components/ui/Bits'
import Stat from '../components/ui/Stat'

const MEDAL = ['🥇', '🥈', '🥉']

function Board({ title, sub, accent, rows, formatValue, valueLabel, emptyLabel }) {
  const { address } = useAccount()
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <Kicker>{title}</Kicker>
          {sub && <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-bone/35">{sub}</p>}
        </div>
        <Chip color={accent}>top {rows.length || 0}</Chip>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 py-6 text-center font-mono text-sm text-bone/30">{emptyLabel}</p>
      ) : (
        <ol className="mt-4 divide-y divide-white/8">
          {rows.map((r, i) => {
            const mine = isSameAddr(address, r.address)
            return (
              <li
                key={r.address}
                className={`flex items-center justify-between gap-3 py-2.5 ${
                  mine ? 'rounded-lg bg-volt/5 px-2' : ''
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-7 shrink-0 text-center font-mono text-sm font-bold">
                    {i < 3 ? MEDAL[i] : <span className="text-bone/40">{i + 1}</span>}
                  </span>
                  <div className="min-w-0">
                    <Addr value={r.address} href={sepoliaAddr(r.address)} />
                    {mine && (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-volt">you</span>
                    )}
                  </div>
                </div>
                <div className={`shrink-0 font-mono text-sm font-bold tabular-nums text-${accent}`}>
                  {formatValue(r.value)}
                  {valueLabel && (
                    <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-bone/35">
                      {valueLabel}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

export default function Leaderboard() {
  const data = useLeaderboardData()
  const { activeCount } = useHookCounters()

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Hall of the split</Kicker>
          <h1 className="mt-2 font-black text-balance text-3xl tracking-tight sm:text-5xl">Leaderboards</h1>
          <p className="mt-3 max-w-xl text-sm text-bone/55 sm:text-base">
            Who's earned the most premium, who's holding the most risk, who's most active. Rolled up from the full
            on-chain event history.
          </p>
        </div>
        {data.isLoading && (
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-bone/40">
            <Spinner /> aggregating events…
          </div>
        )}
      </div>

      {/* totals */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="Positions minted"
          value={data.totals.positionsMinted.toString()}
          accent="bone"
          sub="all-time"
        />
        <Stat
          label="Bonds sold"
          value={data.totals.bondsSold.toString()}
          accent="risk"
          sub="all-time"
        />
        <Stat
          label="Bonds sold (premium)"
          value={data.totals.bondsSold.toString()}
          accent="yield"
          sub="premiums paid across tokens"
        />
        <Stat
          label="Active bonds"
          value={activeCount !== undefined ? activeCount.toString() : '—'}
          accent="mint"
          sub="open positions"
        />
      </div>

      {/* boards */}
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Board
          title="Top yield earners"
          sub="LPs who collected the most premium"
          accent="yield"
          rows={data.lpEarnings}
          formatValue={(v) => fmtToken(v)}
          valueLabel="prem"
          emptyLabel="No bond sales yet."
        />
        <Board
          title="Biggest hunters"
          sub="Buyers who paid the most premium"
          accent="risk"
          rows={data.hunterSpend}
          formatValue={(v) => fmtToken(v)}
          valueLabel="prem"
          emptyLabel="No buyers yet."
        />
        <Board
          title="Most active LPs"
          sub="By positions minted"
          accent="volt"
          rows={data.lpCount}
          formatValue={(v) => v.toString()}
          valueLabel="bonds"
          emptyLabel="No mints yet."
        />
        <Board
          title="Heaviest IL holders"
          sub="By active IL-T legs held now"
          accent="mint"
          rows={data.ilHolders}
          formatValue={(v) => v.toString()}
          valueLabel="legs"
          emptyLabel="No IL-T positions held."
        />
      </div>

      {/* footnote */}
      <p className="mt-10 font-mono text-[10px] uppercase tracking-wider text-bone/30">
        // aggregated from the full event history indexed off-chain. active-IL counts use live chain state.
      </p>
    </div>
  )
}
