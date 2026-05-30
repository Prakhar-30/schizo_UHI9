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
import { fetchEventsFromSupabase, supabaseEnabled, nudgeIndexer } from '../lib/supabase'

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

// ── current pool price + active liquidity (read from v4 StateView, no logs) ──
export function useCurrentPrice() {
  const r = useReadContracts({
    contracts: [
      { address: ADDR.stateView, abi: STATEVIEW_ABI, functionName: 'getSlot0', args: [POOL_ID], chainId: SEPOLIA_CHAIN_ID },
      { address: ADDR.stateView, abi: STATEVIEW_ABI, functionName: 'getLiquidity', args: [POOL_ID], chainId: SEPOLIA_CHAIN_ID },
    ],
    query: { refetchInterval: REFRESH },
  })
  const slot0 = r.data?.[0]?.result
  const liquidity = r.data?.[1]?.result
  return {
    data: slot0
      ? { sqrtPriceX96: slot0[0], tick: Number(slot0[1]), lpFee: Number(slot0[3]), liquidity }
      : undefined,
    refetch: r.refetch,
    isLoading: r.isLoading,
  }
}

// ── on-chain fallback: events within the ~9500-block (~32h) public-RPC window ─
// Used only when Supabase isn't configured/reachable. The full history lives in
// Supabase (populated by api/index-events.js), which has no such cap.
async function fetchEventsOnChain() {
  const latest = await logClient.getBlockNumber()
  const from = latest > LOG_LOOKBACK ? latest - LOG_LOOKBACK : 0n
  const raw = await logClient.getLogs({ address: ADDR.hook, fromBlock: from, toBlock: 'latest' })
  const decoded = parseEventLogs({ abi: HOOK_ABI, logs: raw })

  const uniqueBlocks = [...new Set(decoded.map((l) => l.blockNumber))]
  const blocks = await Promise.all(uniqueBlocks.map((bn) => logClient.getBlock({ blockNumber: bn })))
  const tsMap = {}
  blocks.forEach((b) => (tsMap[b.number.toString()] = Number(b.timestamp)))

  return decoded.map((l) => ({
    key: `${l.transactionHash}-${l.logIndex}`,
    name: l.eventName,
    args: l.args,
    txHash: l.transactionHash,
    blockNumber: l.blockNumber,
    logIndex: l.logIndex,
    ts: tsMap[l.blockNumber.toString()],
  }))
}

// ── all hook events (full history) — Supabase-first, on-chain fallback ───────
// One fetch, shared by activity / per-position / leaderboard via react-query cache.
// Reads the complete event history from Supabase (no 32h cap); falls back to the
// on-chain log window if Supabase is unconfigured or errors. Also nudges the
// server-side indexer so newly-emitted events get picked up between cron runs.
export function useAllEvents() {
  return useQuery({
    queryKey: ['allHookEvents'],
    refetchInterval: REFRESH,
    queryFn: async () => {
      if (supabaseEnabled) {
        try {
          const events = await fetchEventsFromSupabase()
          nudgeIndexer()
          return events
        } catch (err) {
          console.warn('[schizo] Supabase event read failed, falling back to chain:', err)
        }
      }
      return fetchEventsOnChain()
    },
  })
}

// ── activity feed (newest first, optionally filtered to a position) ─────────
export function useActivity({ limit = 50, positionId } = {}) {
  const r = useAllEvents()
  const events = useMemo(() => {
    if (!r.data) return []
    let arr = r.data
    if (positionId !== undefined && positionId !== null) {
      const want = Number(positionId)
      arr = arr.filter(
        (e) => e.args?.positionId !== undefined && Number(e.args.positionId) === want,
      )
    }
    return [...arr]
      .sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? Number(a.logIndex - b.logIndex)
          : Number(a.blockNumber - b.blockNumber),
      )
      .slice(-limit)
      .reverse()
  }, [r.data, limit, positionId])
  return { data: events, isLoading: r.isLoading, refetch: r.refetch }
}

// ── per-position history: IL marks + swaps + creation/sale events ───────────
export function usePositionHistory(positionId) {
  const r = useAllEvents()
  return useMemo(() => {
    const empty = { events: [], ilMarks: [], swaps: [], created: null, sold: null }
    if (!r.data || positionId === undefined || positionId === null) {
      return { ...empty, isLoading: r.isLoading }
    }
    const want = Number(positionId)
    const events = r.data
      .filter((e) => e.args?.positionId !== undefined && Number(e.args.positionId) === want)
      .sort((a, b) => Number(a.blockNumber - b.blockNumber))
    const ilMarks = events.filter((e) => e.name === 'ILMarkUpdated')
    const swaps = r.data
      .filter((e) => e.name === 'SwapOccurred')
      .sort((a, b) => Number(a.blockNumber - b.blockNumber))
    const created = events.find((e) => e.name === 'PositionCreated') || null
    const sold = events.find((e) => e.name === 'ILBondSold') || null
    return { events, ilMarks, swaps, created, sold, isLoading: r.isLoading }
  }, [r.data, positionId, r.isLoading])
}

// ── leaderboard aggregations from event log + on-chain position state ──────
export function useLeaderboardData() {
  const r = useAllEvents()
  const { positions } = usePositions()
  return useMemo(() => {
    const events = r.data || []
    const sold = events.filter((e) => e.name === 'ILBondSold')
    const created = events.filter((e) => e.name === 'PositionCreated')

    // index positions by id for quick lookup
    const byId = new Map(positions.map((p) => [Number(p.id), p]))

    // 1. LP earnings — sum of premium received per original LP
    const lpEarn = new Map()
    for (const e of sold) {
      const p = byId.get(Number(e.args.positionId))
      if (!p) continue
      const lp = (p.lp || '').toLowerCase()
      lpEarn.set(lp, (lpEarn.get(lp) || 0n) + (e.args.premium || 0n))
    }

    // 2. Hunter spend — sum of premium paid per buyer
    const hunterSpend = new Map()
    for (const e of sold) {
      const b = (e.args.buyer || '').toLowerCase()
      hunterSpend.set(b, (hunterSpend.get(b) || 0n) + (e.args.premium || 0n))
    }

    // 3. LP activity — count of PositionCreated per owner
    const lpCount = new Map()
    for (const e of created) {
      const o = (e.args.owner || '').toLowerCase()
      lpCount.set(o, (lpCount.get(o) || 0) + 1)
    }

    // 4. Active IL-T held — count of active sold positions per ilHolder
    const ilHeld = new Map()
    for (const p of positions) {
      if (!p.active || !p.ilBondSold) continue
      const h = (p.ilHolder || '').toLowerCase()
      ilHeld.set(h, (ilHeld.get(h) || 0) + 1)
    }

    const toList = (m) =>
      [...m.entries()]
        .map(([address, value]) => ({ address, value }))
        .sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0))
        .slice(0, 10)

    return {
      lpEarnings: toList(lpEarn),
      hunterSpend: toList(hunterSpend),
      lpCount: toList(lpCount),
      ilHolders: toList(ilHeld),
      totals: {
        positionsMinted: created.length,
        bondsSold: sold.length,
        totalPremium: sold.reduce((s, e) => s + (e.args.premium || 0n), 0n),
      },
      isLoading: r.isLoading,
    }
  }, [r.data, positions, r.isLoading])
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
