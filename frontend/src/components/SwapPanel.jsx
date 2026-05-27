import { useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { parseUnits, maxUint256, maxUint160, maxUint48 } from 'viem'
import {
  ADDR,
  ERC20_ABI,
  PERMIT2_ABI,
  SWAP_ROUTER_ABI,
  SEPOLIA_CHAIN_ID,
} from '../config/contracts'
import { POOL_KEY } from '../config/poolKey'
import { useTokenInfo } from '../hooks/reads'
import { useTx } from '../hooks/useTx'
import { useToast } from './ui/Toast'
import { fmtToken } from '../lib/format'
import { Card } from './ui/Card'
import { Kicker, Chip, Dot } from './ui/Bits'
import { Input } from './ui/Input'
import Button from './ui/Button'

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

  const [zeroForOne, setZeroForOne] = useState(true) // ALPHA → BETA
  const [amount, setAmount] = useState('5')

  const tokenIn = zeroForOne ? ADDR.token0 : ADDR.token1
  const symIn = zeroForOne ? 'ALPHA' : 'BETA'
  const symOut = zeroForOne ? 'BETA' : 'ALPHA'
  const balIn = zeroForOne ? bal0 : bal1
  const amountIn = safeParse(amount)
  const insufficient = balIn !== undefined && amountIn > balIn

  async function ensureSwapApprovals() {
    // 1) ERC20 → Permit2
    const erc20Allow = await publicClient.readContract({
      address: tokenIn,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, ADDR.permit2],
    })
    if (erc20Allow < amountIn) {
      const ok = await run(
        { address: tokenIn, abi: ERC20_ABI, functionName: 'approve', args: [ADDR.permit2, maxUint256] },
        { pendingMsg: `Approving ${symIn}…`, successMsg: `${symIn} approved` },
      )
      if (!ok) return false
    }
    // 2) Permit2 → router
    const [permitAmount, expiration] = await publicClient.readContract({
      address: ADDR.permit2,
      abi: PERMIT2_ABI,
      functionName: 'allowance',
      args: [address, tokenIn, ADDR.swapRouter],
    })
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (permitAmount < amountIn || BigInt(expiration) < now) {
      const ok = await run(
        {
          address: ADDR.permit2,
          abi: PERMIT2_ABI,
          functionName: 'approve',
          args: [tokenIn, ADDR.swapRouter, maxUint160, Number(maxUint48)],
        },
        { pendingMsg: 'Authorizing router…', successMsg: 'Router authorized' },
      )
      if (!ok) return false
    }
    return true
  }

  async function swap() {
    if (amountIn <= 0n) {
      toast({ variant: 'error', title: 'Enter an amount' })
      return
    }
    if (insufficient) {
      toast({ variant: 'error', title: `Not enough ${symIn}`, desc: 'Mint more on the Create page.' })
      return
    }
    if (!(await ensureSwapApprovals())) return
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    await run(
      {
        address: ADDR.swapRouter,
        abi: SWAP_ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [amountIn, 0n, zeroForOne, POOL_KEY, '0x', address, deadline],
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
    <Card glow="volt" className="p-6">
      <div className="flex items-center justify-between">
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
              className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-bold text-bone outline-none"
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
          <span className="kicker">You receive</span>
          <div className="mt-1 flex items-center justify-between">
            <span className="font-mono text-2xl font-bold text-bone/40">~ market</span>
            <span className={`chip ${zeroForOne ? 'border-risk/60 text-risk' : 'border-yield/60 text-yield'} text-sm`}>
              {symOut}
            </span>
          </div>
        </div>
      </div>

      {isConnected ? (
        <Button variant="primary" size="lg" className="mt-5 w-full" loading={pending} disabled={insufficient || amountIn <= 0n} onClick={swap}>
          {insufficient ? `Not enough ${symIn}` : `Swap & re-mark`}
        </Button>
      ) : (
        <p className="mt-5 text-center font-mono text-[11px] text-bone/30">connect to swap</p>
      )}
    </Card>
  )
}
