import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAccount, usePublicClient } from 'wagmi'
import { maxUint256, isAddress } from 'viem'
import SharePanel from '../components/SharePanel'
import {
  usePositions,
  usePositionHistory,
  useHookCounters,
} from '../hooks/reads'
import { humanPrice } from '../lib/il'
import { fmtToken, fmtCompact, fmtNum, fmtBpsPct, isSameAddr } from '../lib/format'
import { HOOK_ABI, ERC20_ABI } from '../config/contracts'
import { useNetwork } from '../context/NetworkContext'
import { useTx } from '../hooks/useTx'
import { useToast } from '../components/ui/Toast'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Dot, Leg, Addr, Spinner, Divider } from '../components/ui/Bits'
import { Field, Input } from '../components/ui/Input'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Stat from '../components/ui/Stat'
import ILGauge from '../components/ILGauge'
import ActivityFeed from '../components/ActivityFeed'
import PositionChart from '../components/PositionChart'
import OutcomeStrip from '../components/OutcomeStrip'

export default function PositionDetail() {
  const { id } = useParams()
  const positionId = Number(id)
  const net = useNetwork()
  const hookBase = { address: net.addr.hook, abi: HOOK_ABI }
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: net.chainId })
  const { run, pending } = useTx()
  const { toast } = useToast()

  const { positions, isLoading, refetch } = usePositions()
  const position = positions.find((p) => Number(p.id) === positionId)
  const { bundles } = useHookCounters()
  const history = usePositionHistory(positionId, position?.poolId)

  const [transfer, setTransfer] = useState(null) // 'fee' | 'il' | null
  const [to, setTo] = useState('')

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="flex items-center gap-2 font-mono text-sm text-bone/40">
          <Spinner /> loading position…
        </div>
      </div>
    )
  }

  if (!position) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <Kicker>Not found</Kicker>
        <h1 className="mt-3 font-black text-3xl tracking-tight">No position #{id}</h1>
        <p className="mt-3 text-bone/55">
          Either it hasn't been minted yet or its id is outside the range.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button to="/markets" variant="bone" size="md">See all positions</Button>
          <Button to="/hunt" variant="outline" size="md">Hunt mode</Button>
        </div>
      </div>
    )
  }

  const {
    lp,
    feeHolder,
    ilHolder,
    active,
    ilBondSold,
    liquidity,
    entrySqrtPriceX96,
    ilMarkBps,
    liveIlBps,
    askPremium,
    tickLower,
    tickUpper,
  } = position

  // IL marked to the live pool price (falls back to the last on-chain RSC mark).
  const displayIlBps = liveIlBps !== undefined ? liveIlBps : ilMarkBps

  const isLp = isSameAddr(address, lp)
  const isFee = isSameAddr(address, feeHolder)
  const isIl = isSameAddr(address, ilHolder)
  const involved = isLp || isFee || isIl
  const canBuy = active && !ilBondSold && askPremium > 0n && isConnected && !isIl
  const canExit = active && involved

  const dec0 = position.pool?.dec0 ?? 18
  const dec1 = position.pool?.dec1 ?? 18
  const premSym = position.premiumSym || 'token1'
  const premDec = position.premiumDec ?? 18
  const premiumToken = position.premiumToken || net.demoPool.token1
  const pairLabel = position.pool?.label || 'pair'

  const entryPrice = humanPrice(entrySqrtPriceX96, dec0, dec1)
  const currentPrice = position.currentSqrtPriceX96 ? humanPrice(position.currentSqrtPriceX96, dec0, dec1) : 0
  const priceMovePct = entryPrice && currentPrice ? ((currentPrice / entryPrice) - 1) * 100 : 0

  async function handleBuy() {
    const allowance = await publicClient.readContract({
      address: premiumToken,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, net.addr.hook],
    })
    if (allowance < askPremium) {
      const ok = await run(
        { address: premiumToken, abi: ERC20_ABI, functionName: 'approve', args: [net.addr.hook, maxUint256] },
        { pendingMsg: `Approving ${premSym}…`, successMsg: `${premSym} approved` },
      )
      if (!ok) return
    }
    await run(
      { ...hookBase, functionName: 'buyILBond', args: [BigInt(positionId)] },
      { pendingMsg: 'Buying IL-T…', successMsg: `IL-T of position #${positionId} acquired`, onSuccess: refetch },
    )
  }

  async function handleExit() {
    await run(
      { ...hookBase, functionName: 'exitPosition', args: [BigInt(positionId)] },
      { pendingMsg: 'Exiting position…', successMsg: `Position #${positionId} exited`, onSuccess: refetch },
    )
  }

  async function handleTransfer() {
    if (!isAddress(to)) {
      toast({ variant: 'error', title: 'Invalid address' })
      return
    }
    const fn = transfer === 'fee' ? 'transferFeeToken' : 'transferILToken'
    const ok = await run(
      { ...hookBase, functionName: fn, args: [BigInt(positionId), to] },
      {
        pendingMsg: 'Transferring…',
        successMsg: `${transfer === 'fee' ? 'FEE-T' : 'IL-T'} transferred`,
        onSuccess: refetch,
      },
    )
    if (ok) {
      setTransfer(null)
      setTo('')
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      {/* breadcrumb */}
      <div className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-bone/40">
        <Link to="/markets" className="hover:text-volt">markets</Link>
        <span>›</span>
        <span>position #{positionId}</span>
      </div>

      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Kicker>Position</Kicker>
          <h1 className="mt-2 font-black text-3xl tracking-tight sm:text-5xl">
            #{positionId}{' '}
            {active ? (
              <Chip color="mint" className="align-middle text-xs">
                <Dot color="mint" /> active
              </Chip>
            ) : (
              <Chip color="white" className="align-middle text-xs">exited</Chip>
            )}{' '}
            <Chip color={ilBondSold ? 'risk' : 'amber'} className="align-middle text-xs">
              {ilBondSold ? 'IL-T sold' : 'IL-T open'}
            </Chip>
          </h1>
          <p className="mt-2 font-mono text-xs text-bone/40 sm:text-sm">
            {pairLabel} · tick {tickLower} → {tickUpper} · entry {fmtNum(entryPrice, 6)}
          </p>
        </div>

        {canBuy && (
          <Button variant="risk" size="lg" loading={pending} onClick={handleBuy}>
            Buy IL-T · {fmtToken(askPremium, premDec)} {premSym}
          </Button>
        )}
      </div>

      {/* stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="IL mark"
          value={displayIlBps !== undefined ? fmtBpsPct(displayIlBps) : '—'}
          accent="risk"
          sub={bundles > 0n ? 'live · marked to pool price' : 'awaiting first mark'}
        />
        <Stat
          label="Premium"
          value={`${fmtToken(askPremium, premDec)} ${premSym}`}
          accent="yield"
          sub={ilBondSold ? 'already paid' : 'ask price'}
        />
        <Stat
          label="Liquidity"
          value={fmtCompact(liquidity)}
          accent="bone"
        />
        <Stat
          label="Price move"
          value={`${priceMovePct >= 0 ? '+' : ''}${priceMovePct.toFixed(2)}%`}
          accent={Math.abs(priceMovePct) > 5 ? 'risk' : 'mint'}
          sub={`entry ${fmtNum(entryPrice, 6)} → now ${fmtNum(currentPrice, 6)}`}
        />
      </div>

      {/* body — charts get the wide column on the right (and show first on mobile);
          holders + your moves sit on the narrower left. */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.7fr]">
        {/* charts + history (right on desktop, first on mobile) */}
        <div className="space-y-6 lg:order-2">
          {/* price + IL charts */}
          <PositionChart
            ilMarks={history.ilMarks}
            swaps={history.swaps}
            entryPrice={entryPrice}
            dec0={dec0}
            dec1={dec1}
          />

          {/* gauge */}
          <Card className="p-5 sm:p-6">
            <Kicker>Live IL mark</Kicker>
            <div className="mt-3">
              <ILGauge ilMarkBps={displayIlBps} marked={displayIlBps !== undefined} />
            </div>
          </Card>

          {/* outcome calculator */}
          <OutcomeStrip
            entrySqrtPriceX96={entrySqrtPriceX96}
            currentSqrtPriceX96={position.currentSqrtPriceX96}
            askPremium={askPremium}
            liquidity={liquidity}
          />

          {/* activity */}
          <Card className="p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <Kicker>This position's history</Kicker>
              <Chip color="volt">{history.events.length} events</Chip>
            </div>
            <div className="mt-3 max-h-[24rem] overflow-y-auto pr-1">
              <ActivityFeed
                events={[...history.events].reverse()}
                isLoading={history.isLoading}
                emptyLabel="No events for this position yet."
                positionsById={{ [positionId]: position }}
              />
            </div>
          </Card>
        </div>

        {/* aside — holders / your moves / share / receipts (left on desktop) */}
        <aside className="space-y-6 lg:order-1">
          {/* holders */}
          <Card className="p-5 sm:p-6">
            <Kicker>Holders</Kicker>
            <div className="mt-3 space-y-3">
              <Row label="LP" value={lp} mine={isLp} />
              <Divider />
              <Row leg="fee" value={feeHolder} mine={isFee} />
              <Divider />
              <Row leg="il" value={ilHolder} mine={isIl} />
            </div>
          </Card>

          {/* actions */}
          {(involved || canBuy) && (
            <Card className="p-5 sm:p-6">
              <Kicker>Your moves</Kicker>
              <div className="mt-3 flex flex-col gap-2">
                {canBuy && (
                  <Button variant="risk" size="md" loading={pending} onClick={handleBuy}>
                    Buy IL-T · {fmtToken(askPremium, premDec)} {premSym}
                  </Button>
                )}
                {isFee && active && (
                  <Button variant="ghost" size="md" onClick={() => setTransfer('fee')}>
                    Transfer FEE-T
                  </Button>
                )}
                {isIl && active && (
                  <Button variant="ghost" size="md" onClick={() => setTransfer('il')}>
                    Transfer IL-T
                  </Button>
                )}
                {canExit && (
                  <Button variant="outline" size="md" loading={pending} onClick={handleExit}>
                    Exit position
                  </Button>
                )}
              </div>
            </Card>
          )}

          {/* share */}
          <SharePanel positionId={positionId} position={position} />

          {/* receipts */}
          {history.created && (
            <Card className="p-5 sm:p-6">
              <Kicker>Receipts</Kicker>
              <div className="mt-3 space-y-2 font-mono text-xs">
                <a
                  href={net.txUrl(history.created.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 text-bone/60 hover:text-volt"
                >
                  <span>Minted</span>
                  <span>{history.created.txHash.slice(0, 10)}…↗</span>
                </a>
                {history.sold && (
                  <a
                    href={net.txUrl(history.sold.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 text-bone/60 hover:text-volt"
                  >
                    <span>IL-T sold</span>
                    <span>{history.sold.txHash.slice(0, 10)}…↗</span>
                  </a>
                )}
              </div>
            </Card>
          )}
        </aside>
      </div>

      <Modal
        open={!!transfer}
        onClose={() => setTransfer(null)}
        title={`Transfer ${transfer === 'fee' ? 'FEE-T' : 'IL-T'} · #${positionId}`}
      >
        <Field label="Recipient address" hint="The new holder of this leg. This is irreversible.">
          <Input placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="mt-5 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setTransfer(null)}>
            Cancel
          </Button>
          <Button
            variant={transfer === 'fee' ? 'yield' : 'risk'}
            className="flex-1"
            loading={pending}
            onClick={handleTransfer}
          >
            Transfer
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function Row({ label, leg, value, mine }) {
  return (
    <div className="flex items-center justify-between gap-2">
      {leg ? <Leg kind={leg} /> : <span className="font-mono text-xs uppercase tracking-wider text-bone/50">{label}</span>}
      <div className="flex items-center gap-2">
        {mine && <span className="font-mono text-[10px] uppercase tracking-wider text-volt">you</span>}
        <Addr value={value} href={net.addrUrl(value)} />
      </div>
    </div>
  )
}
