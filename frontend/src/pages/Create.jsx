import { useState, useMemo } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { parseUnits, maxUint256 } from 'viem'
import {
  HOOK_ABI,
  ERC20_ABI,
  SQRT_PRICE_1_1,
  BASE_FEE_BPS,
  TICK_LOWER,
  TICK_UPPER,
} from '../config/contracts'
import { usePool } from '../context/PoolContext'
import { useNetwork } from '../context/NetworkContext'
import { useTokenInfo, useCurrentPrice } from '../hooks/reads'
import { useTx } from '../hooks/useTx'
import { useToast } from '../components/ui/Toast'
import { amountsForLiquidity, withBuffer, liquidityForToken0 } from '../lib/liquidity'
import { humanPrice } from '../lib/il'
import { fmtToken, fmtNum, fmtCompact } from '../lib/format'
import { Card } from '../components/ui/Card'
import { Kicker, Chip, Dot, Leg, Divider } from '../components/ui/Bits'
import { Field, Input } from '../components/ui/Input'
import Button from '../components/ui/Button'
import WalletButton from '../components/layout/WalletButton'
import PoolSelector from '../components/PoolSelector'

function safeParse(v, decimals) {
  try {
    if (!v || Number(v) <= 0) return 0n
    return parseUnits(String(v), decimals)
  } catch {
    return 0n
  }
}

export default function Create() {
  const { pool } = usePool()
  const net = useNetwork()
  const { address, isConnected, chainId } = useAccount()
  const publicClient = usePublicClient({ chainId: net.chainId })
  const { run, pending } = useTx()
  const { toast } = useToast()
  const { bal0, bal1, refetch: refetchTokens } = useTokenInfo(address, pool.token0, pool.token1)
  const { data: price } = useCurrentPrice(pool.id)

  const [deposit0, setDeposit0] = useState('1')
  const [premium, setPremium] = useState('0.1')

  const tok0 = net.getToken(pool.token0)
  const tok1 = net.getToken(pool.token1)

  const sqrtP = price?.sqrtPriceX96 ?? SQRT_PRICE_1_1
  // The user enters a real amount of token0 (decimal-correct). We derive the
  // abstract liquidity (L) the hook needs, and the matching token1 amount.
  const amt0In = safeParse(deposit0, pool.dec0)
  const ask = safeParse(premium, pool.dec1) // premium paid in currency1

  const L = useMemo(() => liquidityForToken0(sqrtP, amt0In), [sqrtP, amt0In])

  const { max0, max1, est0, est1 } = useMemo(() => {
    const est = amountsForLiquidity(sqrtP, L)
    return { est0: est.amount0, est1: est.amount1, max0: withBuffer(est.amount0), max1: withBuffer(est.amount1) }
  }, [sqrtP, L])

  const curPrice = price ? humanPrice(price.sqrtPriceX96, pool.dec0, pool.dec1) : 0
  const enoughBal = bal0 !== undefined && bal1 !== undefined && bal0 >= max0 && bal1 >= max1
  const wrongChain = isConnected && chainId !== net.chainId
  const valid = L > 0n && ask > 0n
  const dynFeePct = price?.dynFee ? (price.dynFee / 10000).toFixed(3) : (BASE_FEE_BPS / 100).toFixed(3)

  async function ensureAllowance(token, needed, sym) {
    const a = await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, net.addr.hook],
    })
    if (a >= needed) return true
    return await run(
      { address: token, abi: ERC20_ABI, functionName: 'approve', args: [net.addr.hook, maxUint256] },
      { pendingMsg: `Approving ${sym}…`, successMsg: `${sym} approved` },
    )
  }

  async function deposit() {
    if (!valid) return toast({ variant: 'error', title: 'Set a liquidity amount and a premium > 0' })
    if (!enoughBal) return toast({ variant: 'error', title: 'Not enough tokens', desc: `Get ${tok0.symbol} + ${tok1.symbol} first.` })
    if (!(await ensureAllowance(pool.token0, max0, tok0.symbol))) return
    if (!(await ensureAllowance(pool.token1, max1, tok1.symbol))) return
    await run(
      {
        address: net.addr.hook,
        abi: HOOK_ABI,
        functionName: 'depositILBond',
        args: [pool.key, TICK_LOWER, TICK_UPPER, L, max0, max1, ask],
      },
      { pendingMsg: 'Minting your IL bond…', successMsg: 'Bond minted. FEE-T + IL-T are yours', onSuccess: refetchTokens },
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8 sm:mb-10">
        <Kicker>Hedging desk</Kicker>
        <h1 className="mt-2 font-black text-balance text-3xl tracking-tight sm:text-5xl">Mint an IL bond</h1>
        <p className="mt-3 max-w-2xl text-sm text-bone/55 sm:text-base">
          Pick a pool, add your two tokens, then name a premium. You get back two pieces: keep{' '}
          <Leg kind="fee" className="mx-0.5" /> for the steady earnings, and hand <Leg kind="il" className="mx-0.5" />, the
          price risk, to an underwriter who gets paid to hold it. That's your hedge.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-risk/30 bg-risk/[0.06] px-4 py-3">
        <p className="font-mono text-sm text-bone/70">
          <span className="text-risk">On the other side?</span> If you'd rather <b className="text-bone">earn premiums</b> by underwriting impermanent-loss risk instead of minting, the open bonds live on the Underwrite page.
        </p>
        <Button to="/hunt" variant="risk" size="sm">
          I'm an underwriter →
        </Button>
      </div>

      {wrongChain && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border-2 border-amber/40 bg-amber/5 p-4">
          <Dot color="amber" pulse />
          <p className="font-mono text-sm text-amber">You're on a different network. Transactions will prompt a switch to {net.name}.</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-5 sm:p-8">
          <div className="space-y-6">
            <PoolSelector label="Pool to provide into" />

            <Field
              label={`How much ${tok0.symbol} to deposit`}
              hint={`Enter an amount of ${tok0.symbol}. We compute the matching ${tok1.symbol} and the liquidity to add to ${pool.label} at the current price. Anything not used is sent right back to you.`}
            >
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="1"
                value={deposit0}
                onChange={(e) => setDeposit0(e.target.value)}
                suffix={tok0.symbol}
                invalid={deposit0 !== '' && L <= 0n}
              />
            </Field>

            <Field
              label="Premium you charge"
              hint={`Upfront income, paid to you in ${tok1.symbol}, by whoever buys the risk leg (IL-T).`}
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.1"
                value={premium}
                onChange={(e) => setPremium(e.target.value)}
                suffix={tok1.symbol}
                invalid={premium !== '' && ask <= 0n}
              />
            </Field>

            <div className="rounded-xl border border-white/10 bg-ink-soft/50 p-5">
              <p className="kicker mb-3">You will deposit (approx.)</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="font-mono text-xl font-bold tabular-nums">{fmtToken(est0, pool.dec0)}</div>
                  <div className="kicker mt-1">{tok0.symbol}</div>
                </div>
                <div>
                  <div className="font-mono text-xl font-bold tabular-nums">{fmtToken(est1, pool.dec1)}</div>
                  <div className="kicker mt-1">{tok1.symbol}</div>
                </div>
              </div>
              <Divider className="my-4" />
              <div className="flex items-center justify-between font-mono text-[11px] text-bone/45">
                <span>liquidity (L) minted</span>
                <span className="text-bone/70">{L > 0n ? fmtCompact(L) : '–'}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-bone/45">
                <span>max pulled (refundable)</span>
                <span className="text-bone/70">
                  {fmtToken(max0, pool.dec0)} {tok0.symbol} · {fmtToken(max1, pool.dec1)} {tok1.symbol}
                </span>
              </div>
            </div>

            {isConnected ? (
              <Button variant="bone" size="lg" className="w-full" loading={pending} disabled={!valid || !enoughBal} onClick={deposit}>
                {!valid ? 'Enter amounts' : !enoughBal ? 'Get tokens first' : 'Approve & mint bond →'}
              </Button>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-6">
                <p className="font-mono text-sm text-bone/50">Connect a wallet to mint</p>
                <WalletButton size="md" />
              </div>
            )}
            <p className="text-center font-mono text-[11px] text-bone/30">Approvals run automatically only when needed. Testnet only.</p>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between gap-2">
              <Kicker>Your balances</Kicker>
              <Button to="/markets" variant="ghost" size="sm">Get test tokens ↗</Button>
            </div>
            <div className="mt-3">
              {isConnected ? (
                <>
                  <div className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-yield" />
                      <span className="font-mono text-sm font-bold">{tok0.symbol}</span>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-bone/70">{fmtToken(bal0, pool.dec0)}</span>
                  </div>
                  <Divider />
                  <div className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-risk" />
                      <span className="font-mono text-sm font-bold">{tok1.symbol}</span>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-bone/70">{fmtToken(bal1, pool.dec1)}</span>
                  </div>
                </>
              ) : (
                <p className="py-4 text-center font-mono text-sm text-bone/30">connect to see balances</p>
              )}
            </div>
            <p className="mt-3 font-mono text-[11px] text-bone/40">
              Low on {tok0.symbol}/{tok1.symbol}? Mint test tokens from the faucet on the Markets page.
            </p>
          </Card>

          <Card className="p-6">
            <Kicker>Pool</Kicker>
            <ul className="mt-3 space-y-3 text-sm">
              <li className="flex justify-between">
                <span className="text-bone/45">Pair</span>
                <span className="font-mono">{pool.label}{pool.demo ? ' · demo' : ''}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-bone/45">Current price</span>
                <span className="font-mono tabular-nums">{fmtNum(curPrice, 6)} {tok1.symbol}/{tok0.symbol}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-bone/45">Current tick</span>
                <span className="font-mono tabular-nums">{price?.tick ?? '–'}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-bone/45">Live fee</span>
                <span className="font-mono">{dynFeePct}% (dynamic)</span>
              </li>
              <li className="flex justify-between">
                <span className="text-bone/45">Range</span>
                <span className="font-mono">full</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
