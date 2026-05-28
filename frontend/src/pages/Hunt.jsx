import { useMemo, useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { Link } from 'react-router-dom'
import { maxUint256 } from 'viem'
import { usePositions, useHookCounters, useReactiveStatus, useCurrentPrice } from '../hooks/reads'
import OutcomeStrip from '../components/OutcomeStrip'
import { sqrtPriceToPrice } from '../lib/il'
import { fmtToken, fmtBpsPct, isSameAddr } from '../lib/format'
import { ADDR, HOOK_ABI, ERC20_ABI, SEPOLIA_CHAIN_ID, sepoliaAddr } from '../config/contracts'
import { useTx } from '../hooks/useTx'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Dot, Leg, Addr, Spinner } from '../components/ui/Bits'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import Stat from '../components/ui/Stat'
import ILGauge from '../components/ILGauge'

const SORTS = [
  { key: 'premium-asc', label: 'Premium · low → high' },
  { key: 'premium-desc', label: 'Premium · high → low' },
  { key: 'il-asc', label: 'IL mark · best for buyer' },
  { key: 'il-desc', label: 'IL mark · worst for buyer' },
  { key: 'liquidity-desc', label: 'Liquidity · biggest first' },
  { key: 'newest', label: 'Newest position' },
]

const hookBase = { address: ADDR.hook, abi: HOOK_ABI }

function HuntRow({ position, marked, busyId, currentSqrtPriceX96, onBuy }) {
  const { id, lp, askPremium, ilMarkBps, liquidity, entrySqrtPriceX96 } = position
  const busy = busyId === id
  const [open, setOpen] = useState(false)

  return (
    <Card className="flex flex-col gap-4 p-4 transition-colors hover:border-volt/30 sm:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        {/* id + lp */}
        <Link
          to={`/positions/${id}`}
          className="flex items-center gap-3 hover:text-volt md:w-32"
        >
          <span className="font-black text-2xl">#{id}</span>
          <Chip color="amber">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" /> IL-T open
          </Chip>
        </Link>

        {/* IL gauge */}
        <div className="md:w-56">
          <ILGauge ilMarkBps={ilMarkBps} marked={marked} compact />
        </div>

        {/* numbers */}
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="min-w-0">
            <p className="kicker truncate">Premium</p>
            <p className="mt-0.5 truncate font-mono text-base font-bold tabular-nums text-yield">
              {fmtToken(askPremium)} BETA
            </p>
          </div>
          <div className="min-w-0">
            <p className="kicker truncate">Liquidity</p>
            <p className="mt-0.5 truncate font-mono text-sm font-bold tabular-nums">{fmtToken(liquidity)}</p>
          </div>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <p className="kicker">Listed by</p>
            <Addr value={lp} href={sepoliaAddr(lp)} className="mt-0.5" />
          </div>
        </div>

        {/* action */}
        <div className="md:w-44">
          <Button variant="risk" size="md" className="w-full" loading={busy} onClick={() => onBuy(position)}>
            Buy IL-T
          </Button>
        </div>
      </div>

      {/* outcome math (collapsible) */}
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-bone/40 hover:text-volt"
        >
          <span>{open ? '▾' : '▸'}</span>
          {open ? 'hide outcome math' : 'show outcome math'}
        </button>
        {open && (
          <div className="mt-3">
            <OutcomeStrip
              entrySqrtPriceX96={entrySqrtPriceX96}
              currentSqrtPriceX96={currentSqrtPriceX96}
              compact
            />
          </div>
        )}
      </div>
    </Card>
  )
}

export default function Hunt() {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID })
  const { positions, isLoading, refetch } = usePositions()
  const { nextId, activeCount, bundles } = useHookCounters()
  const { data: price } = useCurrentPrice()
  const rsc = useReactiveStatus()
  const { run, pending } = useTx()
  const [busyId, setBusyId] = useState(null)
  const [sort, setSort] = useState('premium-asc')
  const [query, setQuery] = useState('')
  const [hideMine, setHideMine] = useState(false)

  const buyable = useMemo(() => {
    const q = query.trim().toLowerCase()
    return positions
      .filter((p) => p.active && !p.ilBondSold && p.askPremium > 0n)
      .filter((p) => (hideMine && address ? !isSameAddr(address, p.lp) : true))
      .filter((p) => {
        if (!q) return true
        return (
          String(p.id).includes(q) ||
          (p.lp || '').toLowerCase().includes(q) ||
          (p.feeHolder || '').toLowerCase().includes(q)
        )
      })
  }, [positions, query, hideMine, address])

  const sorted = useMemo(() => {
    const arr = [...buyable]
    switch (sort) {
      case 'premium-asc':
        arr.sort((a, b) => (a.askPremium < b.askPremium ? -1 : 1))
        break
      case 'premium-desc':
        arr.sort((a, b) => (a.askPremium > b.askPremium ? -1 : 1))
        break
      case 'il-asc':
        arr.sort((a, b) => Number(a.ilMarkBps) - Number(b.ilMarkBps))
        break
      case 'il-desc':
        arr.sort((a, b) => Number(b.ilMarkBps) - Number(a.ilMarkBps))
        break
      case 'liquidity-desc':
        arr.sort((a, b) => (a.liquidity > b.liquidity ? -1 : 1))
        break
      case 'newest':
        arr.sort((a, b) => b.id - a.id)
        break
      default:
        break
    }
    return arr
  }, [buyable, sort])

  const totalPremium = useMemo(
    () => buyable.reduce((s, p) => s + (typeof p.askPremium === 'bigint' ? p.askPremium : 0n), 0n),
    [buyable],
  )

  async function handleBuy(position) {
    if (!isConnected) return
    setBusyId(position.id)
    try {
      const allowance = await publicClient.readContract({
        address: ADDR.token1,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, ADDR.hook],
      })
      if (allowance < position.askPremium) {
        const ok = await run(
          { address: ADDR.token1, abi: ERC20_ABI, functionName: 'approve', args: [ADDR.hook, maxUint256] },
          { pendingMsg: 'Approving BETA…', successMsg: 'BETA approved' },
        )
        if (!ok) return
      }
      await run(
        { ...hookBase, functionName: 'buyILBond', args: [BigInt(position.id)] },
        {
          pendingMsg: `Buying IL-T #${position.id}…`,
          successMsg: `IL-T #${position.id} acquired`,
          onSuccess: refetch,
        },
      )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Hunt mode</Kicker>
          <h1 className="mt-2 font-black text-balance text-3xl tracking-tight sm:text-5xl">
            Buyable <span className="text-risk">IL-T</span> bonds
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-bone/55 sm:text-base">
            Every open position whose risk leg hasn't been sold yet — collected in one place. Pick a premium, take the
            price risk, collect the LP composition on exit.
          </p>
        </div>
        <Link
          to="/about"
          className="font-mono text-[11px] uppercase tracking-wider text-bone/40 hover:text-volt"
        >
          how does this work? ↗
        </Link>
      </div>

      {/* stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="Open to buy"
          value={buyable.length.toString()}
          sub={`of ${positions.filter((p) => p.active).length} active`}
          accent="amber"
        />
        <Stat
          label="Total premium open"
          value={`${fmtToken(totalPremium)} BETA`}
          accent="yield"
        />
        <Stat
          label="Pool price"
          value={price ? Number(sqrtPriceToPrice(price.sqrtPriceX96)).toFixed(4) : '—'}
          sub={price ? `tick ${price.tick}` : 'reading…'}
          accent="mint"
        />
        <Stat
          label="RSC marks posted"
          value={bundles !== undefined ? bundles.toString() : '—'}
          sub={rsc.online ? 'reactive online' : 'reactive syncing'}
          accent="volt"
        />
      </div>

      {/* controls */}
      <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-white/10 bg-ink-soft/40 p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="w-full flex-1 sm:min-w-[14rem]">
          <Input
            placeholder="Search by ID or address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="w-full rounded-md border-2 border-white/15 bg-ink-card px-3 py-2.5 font-mono text-sm text-bone focus:border-volt focus:outline-none sm:w-auto"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <label className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-wider text-bone/60">
            <input
              type="checkbox"
              checked={hideMine}
              onChange={(e) => setHideMine(e.target.checked)}
              className="h-4 w-4 accent-volt"
            />
            hide mine
          </label>
          <button
            onClick={refetch}
            className="font-mono text-[11px] uppercase tracking-wider text-bone/40 hover:text-volt"
          >
            ↻ refresh
          </button>
        </div>
      </div>

      {/* connect notice */}
      {!isConnected && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-volt/30 bg-volt/5 px-4 py-3">
          <p className="text-sm text-bone/70">Connect a wallet to buy a bond. Reading the book works without one.</p>
          <Dot color="volt" pulse />
        </div>
      )}

      {/* list */}
      <div className="mt-6">
        {isLoading ? (
          <div className="flex items-center gap-2 font-mono text-sm text-bone/40">
            <Spinner /> loading positions…
          </div>
        ) : sorted.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="font-mono text-sm text-bone/40">
              {buyable.length === 0 && positions.length > 0
                ? 'Every active bond has already been bought.'
                : positions.length === 0
                ? 'No bonds minted yet.'
                : 'No matches for that filter.'}
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <Button to="/create" variant="bone" size="sm">
                Mint one yourself →
              </Button>
              <Button to="/markets" variant="outline" size="sm">
                See all positions
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {sorted.map((p) => (
              <HuntRow
                key={p.id}
                position={p}
                marked={bundles > 0n}
                busyId={pending ? busyId : null}
                currentSqrtPriceX96={price?.sqrtPriceX96}
                onBuy={handleBuy}
              />
            ))}
          </div>
        )}
      </div>

      {/* footer helper */}
      <div className="mt-10 rounded-2xl border border-white/10 bg-ink-soft/30 p-5 sm:mt-12 sm:p-6">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="max-w-xl">
            <Kicker>What you're buying</Kicker>
            <p className="mt-2 text-sm leading-relaxed text-bone/60">
              When you buy <Leg kind="il" className="mx-0.5" />, you pay the LP an upfront premium in BETA. In return,
              you take the underlying LP composition — and the impermanent loss with it. The Reactive Network re-prices
              your exposure after every swap, so you always see the live mark.
            </p>
          </div>
          <Button to="/markets" variant="outline" size="md" className="w-full md:w-auto">
            See full book ↗
          </Button>
        </div>
      </div>
    </div>
  )
}
