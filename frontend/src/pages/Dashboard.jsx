import { useMemo, useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { ADDR, HOOK_ABI } from '../config/contracts'
import { usePositions, useClaimable, useHookCounters } from '../hooks/reads'
import { useTx } from '../hooks/useTx'
import { isSameAddr, fmtToken, shortAddr } from '../lib/format'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Leg, SectionHead } from '../components/ui/Bits'
import Button from '../components/ui/Button'
import PositionCard from '../components/PositionCard'
import SharePanel from '../components/SharePanel'
import WalletButton from '../components/layout/WalletButton'
import { Mark } from '../components/layout/Logo'

// Brutalist block: sharp corners, thick border, hard offset shadow.
const BLOCK = 'rounded-none border-2 border-bone/20 bg-ink-card'

function ConnectGate() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
      <div className={`mx-auto max-w-md p-10 text-center shadow-brutal ${BLOCK}`}>
        <div className="mx-auto w-fit">
          <Mark size={48} />
        </div>
        <h1 className="mt-5 font-black text-2xl uppercase tracking-tight">Your dashboard</h1>
        <p className="mt-2 text-sm text-bone/55">Connect a wallet on Ethereum Sepolia to see your bonds, legs, and claimable balances.</p>
        <div className="mt-6 flex justify-center">
          <WalletButton size="lg" />
        </div>
      </div>
    </div>
  )
}

function BStat({ label, value, sub, accent = 'text-bone', shadow = 'shadow-brutal' }) {
  return (
    <div className={`${BLOCK} ${shadow} p-4 sm:p-5`}>
      <div className={`font-black text-3xl tabular-nums sm:text-4xl ${accent}`}>{value}</div>
      <div className="kicker mt-1.5">{label}</div>
      {sub && <div className="mt-0.5 font-mono text-[10px] text-bone/30">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const { address, isConnected } = useAccount()
  const { positions, refetch: refetchPositions } = usePositions()
  const { claims, refetch: refetchClaims } = useClaimable(address)
  const { bundles } = useHookCounters()
  const { run, pending } = useTx()

  const mine = useMemo(
    () =>
      positions.filter(
        (p) => isSameAddr(address, p.feeHolder) || isSameAddr(address, p.ilHolder) || isSameAddr(address, p.lp),
      ),
    [positions, address],
  )
  const feeLegs = mine.filter((p) => isSameAddr(address, p.feeHolder) && p.active).length
  const ilLegs = mine.filter((p) => isSameAddr(address, p.ilHolder) && p.active).length

  const shareable = useMemo(() => mine.filter((p) => p.active).sort((a, b) => b.id - a.id), [mine])
  const [shareId, setShareId] = useState(null)
  useEffect(() => {
    if (shareId === null && shareable.length > 0) setShareId(shareable[0].id)
    if (shareId !== null && !shareable.some((p) => p.id === shareId) && shareable.length > 0) {
      setShareId(shareable[0].id)
    }
  }, [shareable, shareId])
  const sharePosition = shareable.find((p) => p.id === shareId) || null
  const showShare = shareable.length > 0 && sharePosition

  const nothing = claims.length === 0

  async function withdraw(token, sym) {
    await run(
      { address: ADDR.hook, abi: HOOK_ABI, functionName: 'withdraw', args: [token] },
      { pendingMsg: `Claiming ${sym}…`, successMsg: `${sym} claimed to your wallet`, onSuccess: () => { refetchClaims() } },
    )
  }

  if (!isConnected) return <ConnectGate />

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      {/* ── header block ─────────────────────────────────────── */}
      <div className={`${BLOCK} shadow-brutal-bone flex flex-wrap items-center justify-between gap-4 p-5 sm:p-7`}>
        <div className="min-w-0">
          <span className="kicker">Dashboard</span>
          <h1 className="mt-1 font-black uppercase leading-[0.9] tracking-tighter text-4xl sm:text-6xl">
            Your positions
          </h1>
          <p className="mt-2 font-mono text-xs text-bone/45">{shortAddr(address)} · ETHEREUM SEPOLIA</p>
        </div>
        <Button to="/create" variant="bone" size="md">
          + New bond
        </Button>
      </div>

      {/* ── stats ────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BStat label="Your bonds" value={mine.length.toString()} />
        <BStat label="FEE-T held" value={feeLegs.toString()} accent="text-yield" sub="active yield legs" shadow="shadow-brutal-yield" />
        <BStat label="IL-T held" value={ilLegs.toString()} accent="text-risk" sub="active risk legs" shadow="shadow-brutal-risk" />
        <BStat label="Token claims" value={claims.length.toString()} accent="text-mint" sub="tokens to withdraw" />
      </div>

      {/* ── claimable + cast your bonds (restored side-by-side) ─ */}
      <div className={`mt-6 grid gap-4 ${showShare ? 'lg:grid-cols-[1.4fr_1fr]' : ''}`}>
        {/* claimable */}
        <div className={`${BLOCK} shadow-brutal-yield p-5 sm:p-6`}>
          <div className="flex items-center justify-between gap-2">
            <Kicker>Claimable from the hook</Kicker>
            {!nothing && <Chip color="yield">{claims.length} token{claims.length > 1 ? 's' : ''}</Chip>}
          </div>
          {nothing ? (
            <div className="mt-4 flex items-center gap-2">
              <Chip color="white">nothing to claim</Chip>
              <span className="font-mono text-[11px] text-bone/35">proceeds appear here after a position exits</span>
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {claims.map((c) => (
                <div key={c.token} className="flex items-center justify-between gap-3 rounded-none border-2 border-bone/15 bg-white/[0.02] px-3 py-2.5">
                  <span className="font-mono text-base font-bold tabular-nums text-yield">
                    {fmtToken(c.amount, c.dec)} {c.sym}
                  </span>
                  <Button variant="bone" size="sm" loading={pending} onClick={() => withdraw(c.token, c.sym)}>
                    Claim
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* cast your bonds */}
        {showShare && (
          <div className={`${BLOCK} shadow-brutal-volt p-5 sm:p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Kicker>Cast your bonds</Kicker>
              <div className="flex flex-wrap items-center gap-1.5">
                {shareable.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setShareId(p.id)}
                    className={`rounded-none border-2 px-2.5 py-1 font-mono text-xs font-bold transition-colors ${
                      p.id === shareId
                        ? 'border-volt bg-volt/10 text-volt'
                        : 'border-white/15 text-bone/60 hover:border-white/35 hover:text-bone'
                    }`}
                  >
                    #{p.id}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <SharePanel positionId={sharePosition.id} position={sharePosition} embedded />
            </div>
          </div>
        )}
      </div>

      {/* ── my positions ─────────────────────────────────────── */}
      <div className="mt-10">
        <SectionHead
          kicker="Holdings"
          title="Bonds you touch"
          sub="Anything where you're the LP, the FEE-T holder, or the IL-T holder."
          right={
            <button onClick={refetchPositions} className="font-mono text-[11px] uppercase tracking-wider text-bone/40 hover:text-volt">
              ↻ refresh
            </button>
          }
        />
        {mine.length === 0 ? (
          <div className={`${BLOCK} shadow-brutal mt-6 p-10 text-center`}>
            <p className="font-mono text-sm text-bone/40">You don't hold any legs yet.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button to="/create" variant="bone" size="sm">Mint a bond</Button>
              <Button to="/markets" variant="ghost" size="sm">Buy IL-T on Markets</Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {mine
              .sort((a, b) => (a.active === b.active ? b.id - a.id : a.active ? -1 : 1))
              .map((p) => (
                <div key={p.id} className="relative">
                  <div className="absolute -top-2 left-4 z-10 flex gap-1">
                    {isSameAddr(address, p.feeHolder) && <Leg kind="fee" />}
                    {isSameAddr(address, p.ilHolder) && <Leg kind="il" />}
                  </div>
                  <PositionCard position={p} marked={bundles > 0n} onAction={() => { refetchPositions(); refetchClaims(); }} />
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
