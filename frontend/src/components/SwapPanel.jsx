import { useMemo, useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { parseUnits, formatUnits, maxUint256 } from 'viem'
import {
  ADDR,
  ERC20_ABI,
  SWAP_ROUTER_ABI,
  SEPOLIA_CHAIN_ID,
} from '../config/contracts'
import { POOL_KEY } from '../config/poolKey'
import { useTokenInfo, useCurrentPrice } from '../hooks/reads'
import { useTx } from '../hooks/useTx'
import { useToast } from './ui/Toast'
import { fmtToken, fmtNum } from '../lib/format'
import { sqrtPriceToPrice } from '../lib/il'
import { quoteExactInput } from '../lib/quote'
import { Card } from './ui/Card'
import { Kicker, Chip, Dot } from './ui/Bits'
import Button from './ui/Button'

const SLIPPAGE_PRESETS = ['0.5', '1', '1.5', '3']
const DEFAULT_SLIPPAGE = '1.5'

function safeParse(v) {
  try {
    if (!v || Number(v) <= 0) return 0n
    return parseUnits(String(v), 18)
  } catch {
    return 0n
  }
}

export default function SwapPanel({ onSwapped }) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID })
  const { run, pending } = useTx()
  const { toast } = useToast()
  const { bal0, bal1, refetch } = useTokenInfo(address)
  const { data: priceData } = useCurrentPrice()

  const [zeroForOne, setZeroForOne] = useState(true) // ALPHA → BETA
  const [amount, setAmount] = useState('5')
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)

  const tokenIn = zeroForOne ? ADDR.token0 : ADDR.token1
  const symIn = zeroForOne ? 'ALPHA' : 'BETA'
  const symOut = zeroForOne ? 'BETA' : 'ALPHA'
  const balIn = zeroForOne ? bal0 : bal1
  const amountIn = safeParse(amount)
  const insufficient = balIn !== undefined && amountIn > balIn

  // Spot price (token1 per token0) and the spot rate for the chosen direction.
  const price = priceData ? sqrtPriceToPrice(priceData.sqrtPriceX96) : 0
  const spotRate = price ? (zeroForOne ? price : 1 / price) : 0
  // Current swap fee (pips, 1e6 = 100%). Dynamic-fee pools store it in slot0;
  // fall back to the 0.30% base fee if it isn't populated.
  const feePips =
    priceData?.lpFee && priceData.lpFee > 0 && priceData.lpFee < 1_000_000 ? priceData.lpFee : 3000

  // Exact-input quote from the pool's live sqrtPrice + active liquidity (v4 math).
  const quote = useMemo(() => {
    if (!priceData?.sqrtPriceX96 || !priceData?.liquidity || amountIn <= 0n) return null
    return quoteExactInput({
      amountIn,
      sqrtPriceX96: priceData.sqrtPriceX96,
      liquidity: priceData.liquidity,
      feePips,
      zeroForOne,
    })
  }, [priceData?.sqrtPriceX96, priceData?.liquidity, amountIn, feePips, zeroForOne])

  const amountOutWei = quote?.amountOut ?? 0n
  const estOut = amountOutWei > 0n ? Number(formatUnits(amountOutWei, 18)) : 0

  const slipPct = Math.max(0, Number(slippage) || 0)
  const slipValid = slippage !== '' && !isNaN(Number(slippage)) && slipPct >= 0 && slipPct <= 50

  // amountOutMin sent on-chain — apply the slippage haircut to the exact quote in wei.
  const amountOutMin = useMemo(() => {
    if (amountOutWei <= 0n || !slipValid) return 0n
    const factor = BigInt(Math.round((1 - slipPct / 100) * 1_000_000))
    return (amountOutWei * factor) / 1_000_000n
  }, [amountOutWei, slipPct, slipValid])

  const minOut = amountOutMin > 0n ? Number(formatUnits(amountOutMin, 18)) : 0

  // Price impact = how far the execution rate sits below the (fee-adjusted) spot rate.
  const amtNum = Number(amount) || 0
  const execRate = estOut > 0 && amtNum > 0 ? estOut / amtNum : 0
  const priceImpact =
    spotRate > 0 && execRate > 0
      ? Math.max(0, (1 - execRate / (spotRate * (1 - feePips / 1_000_000))) * 100)
      : 0

  const rate = spotRate

  // This router pulls input tokens via a direct ERC20 transferFrom, so it needs
  // a plain ERC20 approval to the router (not the Permit2 path).
  async function ensureRouterAllowance() {
    const allowance = await publicClient.readContract({
      address: tokenIn,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, ADDR.swapRouter],
    })
    if (allowance >= amountIn) return true
    return await run(
      { address: tokenIn, abi: ERC20_ABI, functionName: 'approve', args: [ADDR.swapRouter, maxUint256] },
      { pendingMsg: `Approving ${symIn}…`, successMsg: `${symIn} approved` },
    )
  }

  async function swap() {
    if (amountIn <= 0n) {
      toast({ variant: 'error', title: 'Enter an amount' })
      return
    }
    if (!slipValid) {
      toast({ variant: 'error', title: 'Invalid slippage', desc: 'Use a percentage between 0 and 50.' })
      return
    }
    if (insufficient) {
      toast({ variant: 'error', title: `Not enough ${symIn}`, desc: 'Mint more on the Create page.' })
      return
    }
    if (!(await ensureRouterAllowance())) return
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    await run(
      {
        address: ADDR.swapRouter,
        abi: SWAP_ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [amountIn, amountOutMin, zeroForOne, POOL_KEY, '0x', address, deadline],
      },
      {
        pendingMsg: `Swapping ${symIn} → ${symOut}…`,
        successMsg: 'Swap landed — the RSC will re-mark IL',
        onSuccess: () => {
          refetch()
          onSwapped?.()
        },
      },
    )
  }

  return (
    <Card glow="volt" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Kicker>Drive the oracle</Kicker>
        <Chip color="volt">
          <Dot color="volt" pulse /> triggers RSC
        </Chip>
      </div>
      <p className="mt-2 text-sm text-bone/55">
        Swap to move the price. Each swap makes the hook emit a snapshot, and the Reactive Network recomputes every open
        position's IL within a block or two.
      </p>

      <div className="mt-5 space-y-2">
        <div className="rounded-xl border-2 border-white/12 bg-ink-soft/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="kicker">You pay</span>
            <span className="font-mono text-[11px] text-bone/40">
              bal {fmtToken(balIn)} {symIn}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="min-w-0 flex-1 bg-transparent font-mono text-xl font-bold text-bone outline-none sm:text-2xl"
              placeholder="0.0"
            />
            <span
              className={`chip ${zeroForOne ? 'border-yield/60 text-yield' : 'border-risk/60 text-risk'} text-sm`}
            >
              {symIn}
            </span>
          </div>
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => setZeroForOne((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-lg border-2 border-white/15 bg-ink-card text-bone transition-transform hover:rotate-180"
            title="flip direction"
          >
            ↓
          </button>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between">
            <span className="kicker">You receive</span>
            {rate > 0 && (
              <span className="font-mono text-[11px] text-bone/40">
                1 {symIn} ≈ {fmtNum(rate, 4)} {symOut}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="font-mono text-xl font-bold text-bone sm:text-2xl">
              {estOut > 0 ? fmtNum(estOut, 4) : <span className="text-bone/40">0.0</span>}
            </span>
            <span className={`chip ${zeroForOne ? 'border-risk/60 text-risk' : 'border-yield/60 text-yield'} text-sm`}>
              {symOut}
            </span>
          </div>
        </div>

        {estOut > 0 && (
          <div className="flex items-center justify-between px-1 font-mono text-[11px] text-bone/40">
            <span>price impact</span>
            <span
              className={
                priceImpact > 5 ? 'text-risk' : priceImpact > 1 ? 'text-amber' : 'text-bone/60'
              }
            >
              {priceImpact < 0.01 ? '<0.01' : priceImpact.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {/* slippage control */}
      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between">
          <span className="kicker">Slippage tolerance</span>
          <span className="font-mono text-[11px] text-bone/40">
            {estOut > 0 ? `min ${fmtNum(minOut, 4)} ${symOut}` : 'set price guard'}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex gap-1.5">
            {SLIPPAGE_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setSlippage(p)}
                className={`rounded-lg border px-2.5 py-1 font-mono text-xs transition-colors ${
                  slippage === p
                    ? 'border-volt/60 bg-volt/10 text-volt'
                    : 'border-white/12 text-bone/55 hover:border-white/25'
                }`}
              >
                {p}%
              </button>
            ))}
          </div>
          <div
            className={`ml-auto flex items-center gap-1 rounded-lg border px-2.5 py-1 ${
              slipValid ? 'border-white/12' : 'border-risk/60'
            }`}
          >
            <input
              type="number"
              min="0"
              max="50"
              step="0.1"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
              className="w-14 bg-transparent text-right font-mono text-sm font-bold text-bone outline-none"
              placeholder="1.5"
            />
            <span className="font-mono text-sm text-bone/50">%</span>
          </div>
        </div>
        {!slipValid && (
          <p className="mt-2 font-mono text-[10px] text-risk">Enter a percentage between 0 and 50.</p>
        )}
        {slipValid && slipPct > 5 && (
          <p className="mt-2 font-mono text-[10px] text-amber">High slippage — you may receive much less than estimated.</p>
        )}
      </div>

      {isConnected ? (
        <Button
          variant="primary"
          size="lg"
          className="mt-5 w-full"
          loading={pending}
          disabled={insufficient || amountIn <= 0n || !slipValid}
          onClick={swap}
        >
          {insufficient ? `Not enough ${symIn}` : `Swap & re-mark`}
        </Button>
      ) : (
        <p className="mt-5 text-center font-mono text-[11px] text-bone/30">connect to swap</p>
      )}
    </Card>
  )
}
