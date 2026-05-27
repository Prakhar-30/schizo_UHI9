import { useMemo } from 'react'
import { useReadContract, useReadContracts, useBalance } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http, parseEventLogs } from 'viem'
import {
  ADDR,
  HOOK_ABI,
  ERC20_ABI,
  REACTIVE_ABI,
  STATEVIEW_ABI,
  SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
} from '../config/contracts'
import { POOL_ID } from '../config/poolKey'
import { sepolia, LOG_RPC } from '../config/chains'

const hookBase = { address: ADDR.hook, abi: HOOK_ABI, chainId: SEPOLIA_CHAIN_ID }
const REFRESH = 12000

// Dedicated client for event-log reads — the main RPC may cap getLogs ranges
// (Alchemy free tier = 10 blocks), so logs read from a permissive public RPC.
const logClient = createPublicClient({ chain: sepolia, transport: http(LOG_RPC) })
const LOG_LOOKBACK = 9500n

// ── headline counters ──────────────────────────────────────────────────────
export function useHookCounters() {
  const r = useReadContracts({
    contracts: [
      { ...hookBase, functionName: 'nextPositionId' },
      { ...hookBase, functionName: 'activePositionCount' },
      { ...hookBase, functionName: 'bundleCounter' },
    ],
    query: { refetchInterval: REFRESH },
  })
  const d = r.data || []
  return {
    nextId: d[0]?.result,
    activeCount: d[1]?.result,
    bundles: d[2]?.result,
    isLoading: r.isLoading,
    refetch: r.refetch,
  }
}

// ── all positions (getPosition + getRange per id) ───────────────────────────
export function usePositions() {
  const { nextId, refetch: refetchCounters } = useHookCounters()
  const count = nextId !== undefined ? Number(nextId) : 0

  const contracts = useMemo(() => {
    const arr = []
    for (let i = 0; i < count; i++) {
      arr.push({ ...hookBase, functionName: 'getPosition', args: [BigInt(i)] })
      arr.push({ ...hookBase, functionName: 'getRange', args: [BigInt(i)] })
    }
    return arr
  }, [count])

  const r = useReadContracts({
    contracts,
    query: { enabled: count > 0, refetchInterval: REFRESH },
  })

  const positions = useMemo(() => {
    if (!r.data) return []
    const out = []
    for (let i = 0; i < count; i++) {
      const pos = r.data[i * 2]?.result
      const range = r.data[i * 2 + 1]?.result
      if (!pos) continue
      const [lp, feeHolder, ilHolder, active, ilBondSold, liquidity, entrySqrtPriceX96, ilMarkBps, markValue, askPremium] = pos
      const [tickLower, tickUpper] = range || []
      out.push({
        id: i,
        lp,
        feeHolder,
        ilHolder,
        active,
        ilBondSold,
        liquidity,
        entrySqrtPriceX96,
        ilMarkBps,
        markValue,
        askPremium,
        tickLower,
        tickUpper,
      })
    }
    return out
  }, [r.data, count])

  const refetch = () => {
    refetchCounters()
    r.refetch()
  }

  return { positions, count, isLoading: r.isLoading || (count > 0 && !r.data), refetch }
}

// ── current pool price (read straight from v4 StateView, no logs) ───────────
export function useCurrentPrice() {
  const r = useReadContract({
    address: ADDR.stateView,
    abi: STATEVIEW_ABI,
    functionName: 'getSlot0',
    args: [POOL_ID],
    chainId: SEPOLIA_CHAIN_ID,
    query: { refetchInterval: REFRESH },
  })
  const d = r.data
  return {
    data: d ? { sqrtPriceX96: d[0], tick: Number(d[1]), lpFee: d[3] } : undefined,
    refetch: r.refetch,
    isLoading: r.isLoading,
  }
}

// ── activity feed (all hook events, decoded + timestamped) ──────────────────
export function useActivity({ limit = 50 } = {}) {
  return useQuery({
    queryKey: ['activity', limit],
    refetchInterval: REFRESH,
    queryFn: async () => {
      const latest = await logClient.getBlockNumber()
      const from = latest > LOG_LOOKBACK ? latest - LOG_LOOKBACK : 0n
      const raw = await logClient.getLogs({ address: ADDR.hook, fromBlock: from, toBlock: 'latest' })
      const decoded = parseEventLogs({ abi: HOOK_ABI, logs: raw })

      const ordered = decoded
        .sort((a, b) =>
          a.blockNumber === b.blockNumber
            ? Number(a.logIndex - b.logIndex)
            : Number(a.blockNumber - b.blockNumber),
        )
        .slice(-limit)
        .reverse()

      const uniqueBlocks = [...new Set(ordered.map((l) => l.blockNumber))]
      const blocks = await Promise.all(uniqueBlocks.map((bn) => logClient.getBlock({ blockNumber: bn })))
      const tsMap = {}
      blocks.forEach((b) => (tsMap[b.number.toString()] = Number(b.timestamp)))

      return ordered.map((l) => ({
        key: `${l.transactionHash}-${l.logIndex}`,
        name: l.eventName,
        args: l.args,
        txHash: l.transactionHash,
        blockNumber: l.blockNumber,
        ts: tsMap[l.blockNumber.toString()],
      }))
    },
  })
}

// ── per-account token balances + hook allowances ────────────────────────────
export function useTokenInfo(address) {
  const r = useReadContracts({
    contracts: [
      { address: ADDR.token0, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId: SEPOLIA_CHAIN_ID },
      { address: ADDR.token1, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId: SEPOLIA_CHAIN_ID },
      { address: ADDR.token0, abi: ERC20_ABI, functionName: 'allowance', args: [address, ADDR.hook], chainId: SEPOLIA_CHAIN_ID },
      { address: ADDR.token1, abi: ERC20_ABI, functionName: 'allowance', args: [address, ADDR.hook], chainId: SEPOLIA_CHAIN_ID },
    ],
    query: { enabled: !!address, refetchInterval: REFRESH },
  })
  const d = r.data || []
  return {
    bal0: d[0]?.result,
    bal1: d[1]?.result,
    allow0: d[2]?.result,
    allow1: d[3]?.result,
    isLoading: r.isLoading,
    refetch: r.refetch,
  }
}

// ── withdrawable balance held in the hook for an account ────────────────────
export function useWithdrawable(address) {
  const r = useReadContract({
    ...hookBase,
    functionName: 'getWithdrawable',
    args: [address],
    query: { enabled: !!address, refetchInterval: REFRESH },
  })
  const [amount0, amount1] = r.data || []
  return { amount0, amount1, isLoading: r.isLoading, refetch: r.refetch }
}

// ── Reactive contract status on Lasna ───────────────────────────────────────
export function useReactiveStatus() {
  const active = useReadContract({
    address: ADDR.reactive,
    abi: REACTIVE_ABI,
    functionName: 'activeCount',
    chainId: LASNA_CHAIN_ID,
    query: { refetchInterval: 20000, retry: 1 },
  })
  const bal = useBalance({ address: ADDR.reactive, chainId: LASNA_CHAIN_ID, query: { refetchInterval: 20000, retry: 1 } })
  return {
    activeCount: active.data,
    balance: bal.data?.value,
    symbol: bal.data?.symbol || 'REACT',
    online: !active.isError && active.data !== undefined,
    isLoading: active.isLoading,
  }
}
