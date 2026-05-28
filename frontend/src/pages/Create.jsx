import { useState, useMemo } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { parseUnits, maxUint256 } from 'viem'
import {
  ADDR,
  HOOK_ABI,
  ERC20_ABI,
  SEPOLIA_CHAIN_ID,
  SQRT_PRICE_1_1,
  BASE_FEE_BPS,
  TICK_LOWER,
  TICK_UPPER,
} from '../config/contracts'
import { POOL_KEY } from '../config/poolKey'
import { useTokenInfo, useCurrentPrice } from '../hooks/reads'
import { useTx } from '../hooks/useTx'
import { useToast } from '../components/ui/Toast'
import { amountsForLiquidity, withBuffer } from '../lib/liquidity'
import { sqrtPriceToPrice } from '../lib/il'
import { fmtToken, fmtNum } from '../lib/format'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Dot, Leg, Divider } from '../components/ui/Bits'
import { Field, Input } from '../components/ui/Input'
import Button from '../components/ui/Button'
import WalletButton from '../components/layout/WalletButton'

function safeParse(v) {
  try {
    if (!v || Number(v) <= 0) return 0n
    return parseUnits(String(v), 18)
  } catch {
    return 0n
  }
}

function BalanceLine({ sym, color, value, onMint, minting }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${color}`} />
        <span className="font-mono text-sm font-bold">{sym}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm tabular-nums text-bone/70">{fmtToken(value)}</span>
        <Button size="sm" variant="ghost" loading={minting} onClick={onMint}>
          +1,000
        </Button>
      </div>
    </div>
  )
}

export default function Create() {
  const { address, isConnected, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID })
  const { run, pending } = useTx()
  const { toast } = useToast()
  const { bal0, bal1, refetch: refetchTokens } = useTokenInfo(address)
  const { data: price } = useCurrentPrice()
  const [mintingToken, setMintingToken] = useState(null)

  const [liq, setLiq] = useState('10')
  const [premium, setPremium] = useState('0.1')

  const L = safeParse(liq)
  const ask = safeParse(premium)
  const sqrtP = price?.sqrtPriceX96 ?? SQRT_PRICE_1_1

  const { max0, max1, est0, est1 } = useMemo(() => {
    const est = amountsForLiquidity(sqrtP, L)
    return { est0: est.amount0, est1: est.amount1, max0: withBuffer(est.amount0), max1: withBuffer(est.amount1) }
  }, [sqrtP, L])

  const curPrice = sqrtPriceToPrice(sqrtP)
  const enoughBal = bal0 !== undefined && bal1 !== undefined && bal0 >= max0 && bal1 >= max1
  const wrongChain = isConnected && chainId !== SEPOLIA_CHAIN_ID
  const valid = L > 0n && ask > 0n

  async function mint(token, sym) {
    setMintingToken(sym)
    await run(
      { address: token, abi: ERC20_ABI, functionName: 'mint', args: [address, parseUnits('1000', 18)] },
      { pendingMsg: `Minting ${sym}…`, successMsg: `+1,000 ${sym} minted`, onSuccess: refetchTokens },
    )
    setMintingToken(null)
  }

  async function ensureAllowance(token, needed, sym) {
    const a = await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, ADDR.hook],
    })
    if (a >= needed) return true
    return await run(
      { address: token, abi: ERC20_ABI, functionName: 'approve', args: [ADDR.hook, maxUint256] },
      { pendingMsg: `Approving ${sym}…`, successMsg: `${sym} approved` },
    )
  }

  async function deposit() {
    if (!valid) {
      toast({ variant: 'error', title: 'Set a liquidity amount and a premium > 0' })
      return
    }
    if (!enoughBal) {
      toast({ variant: 'error', title: 'Not enough test tokens', desc: 'Use the faucet to mint ALPHA + BETA.' })
      return
    }
    if (!(await ensureAllowance(ADDR.token0, max0, 'ALPHA'))) return
    if (!(await ensureAllowance(ADDR.token1, max1, 'BETA'))) return
    await run(
      {
        address: ADDR.hook,
        abi: HOOK_ABI,
        functionName: 'depositILBond',
        args: [POOL_KEY, TICK_LOWER, TICK_UPPER, L, max0, max1, ask],
      },
      {
        pendingMsg: 'Minting your IL bond…',
        successMsg: 'Bond minted — FEE-T + IL-T are yours',
        onSuccess: refetchTokens,
      },
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 sm:mb-10">
        <Kicker>Creator console</Kicker>
        <h1 className="mt-2 font-black text-balance text-3xl tracking-tight sm:text-5xl">Mint an IL bond</h1>
        <p className="mt-3 max-w-2xl text-sm text-bone/55 sm:text-base">
          Add your two tokens to the pool, then name a premium. You get back two pieces: keep{' '}
          <Leg kind="fee" className="mx-0.5" /> for the steady earnings, and sell <Leg kind="il" className="mx-0.5" /> — the
          price risk — to someone who wants it.
        </p>
      </div>

      {wrongChain && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border-2 border-amber/40 bg-amber/5 p-4">
          <Dot color="amber" pulse />
          <p className="font-mono text-sm text-amber">You're on the wrong network — transactions will prompt a switch to Ethereum Sepolia.</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* ── form ─────────────────────────────────────────── */}
        <Card className="p-5 sm:p-8">
          <div className="space-y-6">
            <Field
              label="How much to deposit"
              hint="Roughly how many of each token (ALPHA + BETA) you'll put in. Bigger means more fees earned — and more impermanent loss to hand off. Anything not used is sent right back to you."
            >
              <Input
                type="number"
                min="0"
                placeholder="10"
                value={liq}
                onChange={(e) => setLiq(e.target.value)}
                suffix="tokens"
                invalid={liq !== '' && L <= 0n}
              />
            </Field>

            <Field
              label="Premium you charge"
              hint="Upfront income, paid to you in BETA, by whoever buys the risk leg (IL-T). It's the price you put on handing off the impermanent-loss risk."
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.1"
                value={premium}
                onChange={(e) => setPremium(e.target.value)}
                suffix="BETA"
                invalid={premium !== '' && ask <= 0n}
              />
            </Field>

            <div className="rounded-xl border border-white/10 bg-ink-soft/50 p-5">
              <p className="kicker mb-3">You will deposit (approx.)</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="font-mono text-xl font-bold tabular-nums">{fmtToken(est0)}</div>
                  <div className="kicker mt-1">ALPHA</div>
                </div>
                <div>
                  <div className="font-mono text-xl font-bold tabular-nums">{fmtToken(est1)}</div>
                  <div className="kicker mt-1">BETA</div>
                </div>
              </div>
              <Divider className="my-4" />
              <div className="flex items-center justify-between font-mono text-[11px] text-bone/45">
                <span>max pulled (refundable)</span>
                <span className="text-bone/70">
                  {fmtToken(max0)} ALPHA · {fmtToken(max1)} BETA
                </span>
              </div>
            </div>

            {isConnected ? (
              <Button
                variant="bone"
                size="lg"
                className="w-full"
                loading={pending}
                disabled={!valid || !enoughBal}
                onClick={deposit}
              >
                {!valid ? 'Enter amounts' : !enoughBal ? 'Mint test tokens first' : 'Approve & mint bond →'}
              </Button>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-6">
                <p className="font-mono text-sm text-bone/50">Connect a wallet to mint</p>
                <WalletButton size="md" />
              </div>
            )}
            <p className="text-center font-mono text-[11px] text-bone/30">
              Approvals run automatically only when needed. Testnet only.
            </p>
          </div>
        </Card>

        {/* ── side ─────────────────────────────────────────── */}
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <Kicker>Faucet · your balances</Kicker>
              <Chip color="mint">free</Chip>
            </div>
            <div className="mt-3">
              {isConnected ? (
                <>
                  <BalanceLine sym="ALPHA" color="bg-yield" value={bal0} minting={mintingToken === 'ALPHA'} onMint={() => mint(ADDR.token0, 'ALPHA')} />
                  <Divider />
                  <BalanceLine sym="BETA" color="bg-risk" value={bal1} minting={mintingToken === 'BETA'} onMint={() => mint(ADDR.token1, 'BETA')} />
                </>
              ) : (
                <p className="py-4 text-center font-mono text-sm text-bone/30">connect to see balances</p>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <Kicker>Pool</Kicker>
            <ul className="mt-3 space-y-3 text-sm">
              <li className="flex justify-between">
                <span className="text-bone/45">Pair</span>
                <span className="font-mono">ALPHA / BETA</span>
              </li>
              <li className="flex justify-between">
                <span className="text-bone/45">Current price</span>
                <span className="font-mono tabular-nums">{fmtNum(curPrice, 4)} BETA/ALPHA</span>
              </li>
              <li className="flex justify-between">
                <span className="text-bone/45">Current tick</span>
                <span className="font-mono tabular-nums">{price?.tick ?? '—'}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-bone/45">Base fee</span>
                <span className="font-mono">{(BASE_FEE_BPS / 100).toFixed(2)}% (dynamic)</span>
              </li>
              <li className="flex justify-between">
                <span className="text-bone/45">Range</span>
                <span className="font-mono">full</span>
              </li>
            </ul>
          </Card>

          <Card className="p-6">
            <Kicker>After you mint</Kicker>
            <ol className="mt-3 space-y-3 text-sm text-bone/60">
              <li className="flex gap-3">
                <span className="font-mono text-volt">01</span>
                Your position shows up in <b className="text-bone">Markets</b> for buyers.
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-volt">02</span>A buyer pays your premium and takes <Leg kind="il" className="mx-0.5" />.
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-volt">03</span>
                The Reactive Network updates the loss after every trade — watch it in <b className="text-bone">Dashboard</b>.
              </li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  )
}
