import { useMemo } from 'react'
import { useReadContract, useReadContracts, usePublicClient, useBalance } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import {
  ADDR,
  HOOK_ABI,
  ERC20_ABI,
  REACTIVE_ABI,
  SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
  SQRT_PRICE_1_1,
} from '../config/contracts'
import { POOL_ID } from '../config/poolKey'

const hookBase = { address: ADDR.hook, abi: HOOK_ABI, chainId: SEPOLIA_CHAIN_ID }
const REFRESH = 12000

const EVENTS = HOOK_ABI.filter((i) => i.type === 'event')

// getLogs over a wide window, falling back to a narrow one if the provider
// rejects the range (some RPCs cap eth_getLogs at ~10k blocks).
async function rangedLogs(client, params, lookback = 95000n) {
  const latest = await client.getBlockNumber()
  const from = latest > lookback ? latest - lookback : 0n
  try {
    return await client.getLogs({ ...params, fromBlock: from, toBlock: 'latest' })
  } catch {
    const narrow = latest > 9000n ? latest - 9000n : 0n
    return await client.getLogs({ ...params, fromBlock: narrow, toBlock: 'latest' })
  }
}

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

// ── current pool price (latest SwapOccurred) ────────────────────────────────
export function useCurrentPrice() {
  const client = usePublicClient({ chainId: SEPOLIA_CHAIN_ID })
  const swapEvent = EVENTS.find((e) => e.name === 'SwapOccurred')

  return useQuery({
    queryKey: ['current-price'],
    enabled: !!client,
    refetchInterval: REFRESH,
    queryFn: async () => {
      const logs = await rangedLogs(client, { address: ADDR.hook, event: swapEvent, args: { poolId: POOL_ID } })
      if (!logs.length) {
        return { sqrtPriceX96: SQRT_PRICE_1_1, tick: 0, liquidity: 0n, hasSwaps: false, swaps: 0 }
      }
      const last = logs[logs.length - 1]
      return {
        sqrtPriceX96: last.args.sqrtPriceX96,
        tick: Number(last.args.tick),
        liquidity: last.args.liquidity,
        hasSwaps: true,
        swaps: logs.length,
      }
    },
  })
}

// ── activity feed (all hook events, decoded + timestamped) ──────────────────
export function useActivity({ limit = 50 } = {}) {
  const client = usePublicClient({ chainId: SEPOLIA_CHAIN_ID })

  return useQuery({
    queryKey: ['activity', limit],
    enabled: !!client,
    refetchInterval: REFRESH,
    queryFn: async () => {
      const logs = await rangedLogs(client, { address: ADDR.hook, events: EVENTS })

      const ordered = logs
        .sort((a, b) =>
          a.blockNumber === b.blockNumber
            ? Number(a.logIndex - b.logIndex)
            : Number(a.blockNumber - b.blockNumber),
        )
        .slice(-limit)
        .reverse()

      const uniqueBlocks = [...new Set(ordered.map((l) => l.blockNumber))]
      const blocks = await Promise.all(uniqueBlocks.map((bn) => client.getBlock({ blockNumber: bn })))
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
