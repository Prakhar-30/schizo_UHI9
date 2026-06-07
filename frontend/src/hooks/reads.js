import { useMemo } from 'react'
import { useReadContract, useReadContracts, useBalance } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http, parseEventLogs, parseAbiItem } from 'viem'
import {
  ADDR,
  HOOK_ABI,
  ERC20_ABI,
  REACTIVE_ABI,
  STATEVIEW_ABI,
  SEPOLIA_CHAIN_ID,
  LASNA_CHAIN_ID,
} from '../config/contracts'
import { POOLS, DEMO_POOL, getPoolById, TOKENS } from '../config/pools'
import { sepolia, LOG_RPC } from '../config/chains'
import { fetchEventsFromSupabase, supabaseEnabled, nudgeIndexer } from '../lib/supabase'
import { computeIL, bundleMark } from '../lib/il'

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

// ── position → poolId map, derived from PoolManager ModifyLiquidity events ────
// getPosition() doesn't return the pool, but the hook mints liquidity with
// salt = bytes32(positionId), so each position's pool is recoverable from the
// PoolManager's ModifyLiquidity logs (sender = hook). Multi-pool safe.
const MODIFY_LIQ_EVENT = parseAbiItem(
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
)
export function usePositionPoolMap() {
  return useQuery({
    queryKey: ['posPoolMap', ADDR.hook],
    refetchInterval: REFRESH,
    queryFn: async () => {
      const latest = await logClient.getBlockNumber()
      const from = latest > LOG_LOOKBACK ? latest - LOG_LOOKBACK : 0n
      const logs = await logClient.getLogs({
        address: ADDR.poolManager,
        event: MODIFY_LIQ_EVENT,
        args: { sender: ADDR.hook },
        fromBlock: from,
        toBlock: 'latest',
      })
      const map = {}
      for (const l of logs) {
        const pid = Number(BigInt(l.args.salt))
        if (map[pid] === undefined) map[pid] = String(l.args.id).toLowerCase()
      }
      return map
    },
  })
}

// ── all positions (getPosition + getRange per id), annotated with their pool ──
export function usePositions() {
  const { nextId, refetch: refetchCounters } = useHookCounters()
  const count = nextId !== undefined ? Number(nextId) : 0
  const { byId: poolStats } = usePoolStats()
  const { data: poolMap } = usePositionPoolMap()

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
      // Resolve this position's pool, then mark IL against THAT pool's live price.
      const poolId = poolMap?.[i]
      const pool = getPoolById(poolId)
      const currentSqrt = poolId ? poolStats[poolId.toLowerCase()]?.sqrtPriceX96 : undefined
      const liveIlBps =
        currentSqrt && entrySqrtPriceX96
          ? BigInt(Math.round(computeIL(entrySqrtPriceX96, currentSqrt) * 10000))
          : ilMarkBps
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
        liveIlBps,
        markValue,
        askPremium,
        tickLower,
        tickUpper,
        // pool metadata (undefined until the ModifyLiquidity log is in range)
        pool,
        poolId,
        currentSqrtPriceX96: currentSqrt,
        // premium is paid in the pool's currency1
        premiumSym: pool?.sym1 || 'token1',
        premiumDec: pool?.dec1 ?? 18,
        premiumToken: pool?.token1,
      })
    }
    return out
  }, [r.data, count, poolStats, poolMap])

  const refetch = () => {
    refetchCounters()
    r.refetch()
  }

  return { positions, count, isLoading: r.isLoading || (count > 0 && !r.data), refetch }
}

// ── current price + liquidity + live dynamic fee for ONE pool (StateView+hook) ─
export function useCurrentPrice(poolId = DEMO_POOL.id) {
  const r = useReadContracts({
    contracts: [
      { address: ADDR.stateView, abi: STATEVIEW_ABI, functionName: 'getSlot0', args: [poolId], chainId: SEPOLIA_CHAIN_ID },
      { address: ADDR.stateView, abi: STATEVIEW_ABI, functionName: 'getLiquidity', args: [poolId], chainId: SEPOLIA_CHAIN_ID },
      { ...hookBase, functionName: 'currentFee', args: [poolId] },
    ],
    query: { refetchInterval: REFRESH },
  })
  const slot0 = r.data?.[0]?.result
  const liquidity = r.data?.[1]?.result
  const dynFee = r.data?.[2]?.result
  return {
    data: slot0
      ? {
          sqrtPriceX96: slot0[0],
          tick: Number(slot0[1]),
          lpFee: Number(slot0[3]),
          liquidity,
          // The live volatility-adjusted fee the pool will charge next swap (pips).
          dynFee: dynFee !== undefined ? Number(dynFee) : undefined,
        }
      : undefined,
    refetch: r.refetch,
    isLoading: r.isLoading,
  }
}

// ── all pools: live slot0 + liquidity + dynamic fee (one multicall) ─────────
export function usePoolStats() {
  const contracts = useMemo(() => {
    const arr = []
    for (const p of POOLS) {
      arr.push({ address: ADDR.stateView, abi: STATEVIEW_ABI, functionName: 'getSlot0', args: [p.id], chainId: SEPOLIA_CHAIN_ID })
      arr.push({ address: ADDR.stateView, abi: STATEVIEW_ABI, functionName: 'getLiquidity', args: [p.id], chainId: SEPOLIA_CHAIN_ID })
      arr.push({ ...hookBase, functionName: 'currentFee', args: [p.id] })
    }
    return arr
  }, [])
  const r = useReadContracts({ contracts, query: { refetchInterval: REFRESH } })
  const byId = useMemo(() => {
    const m = {}
    POOLS.forEach((p, i) => {
      const slot0 = r.data?.[i * 3]?.result
      const liquidity = r.data?.[i * 3 + 1]?.result
      const fee = r.data?.[i * 3 + 2]?.result
      m[p.id.toLowerCase()] = slot0
        ? {
            sqrtPriceX96: slot0[0],
            tick: Number(slot0[1]),
            lpFee: Number(slot0[3]),
            liquidity,
            dynFee: fee !== undefined ? Number(fee) : undefined,
          }
        : undefined
    })
    return m
  }, [r.data])
  return { byId, isLoading: r.isLoading, refetch: r.refetch }
}

// ── per-pool SwapOccurred price series (on-chain, new hook, recent window) ───
// Reads directly from the live hook (bypasses Supabase, which indexes the old
// hook) so per-pool price charts reflect the current deployment immediately.
export function usePoolSwapSeries() {
  return useQuery({
    queryKey: ['poolSwapSeries', ADDR.hook],
    refetchInterval: REFRESH,
    queryFn: async () => {
      const latest = await logClient.getBlockNumber()
      const from = latest > LOG_LOOKBACK ? latest - LOG_LOOKBACK : 0n
      const raw = await logClient.getLogs({ address: ADDR.hook, fromBlock: from, toBlock: 'latest' })
      const decoded = parseEventLogs({ abi: HOOK_ABI, logs: raw })
      const byPool = {}
      for (const l of decoded) {
        if (l.eventName !== 'SwapOccurred') continue
        const pid = String(l.args.poolId).toLowerCase()
        ;(byPool[pid] ||= []).push({
          block: Number(l.blockNumber),
          idx: Number(l.logIndex),
          sqrtPriceX96: l.args.sqrtPriceX96,
          tick: Number(l.args.tick),
        })
      }
      for (const k in byPool) {
        byPool[k].sort((a, b) => (a.block === b.block ? a.idx - b.idx : a.block - b.block))
      }
      return byPool
    },
  })
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
export function usePositionHistory(positionId, poolId) {
  const r = useAllEvents()
  return useMemo(() => {
    const empty = { events: [], ilMarks: [], swaps: [], created: null, sold: null }
    if (!r.data || positionId === undefined || positionId === null) {
      return { ...empty, isLoading: r.isLoading }
    }
    const want = Number(positionId)
    const wantPool = poolId ? String(poolId).toLowerCase() : null
    const events = r.data
      .filter((e) => e.args?.positionId !== undefined && Number(e.args.positionId) === want)
      .sort((a, b) => Number(a.blockNumber - b.blockNumber))
    // Only this position's pool's swaps (multi-pool safe). If pool unknown, show none
    // rather than mixing pools.
    const swaps = r.data
      .filter((e) => e.name === 'SwapOccurred' && (!wantPool || String(e.args?.poolId).toLowerCase() === wantPool))
      .sort((a, b) => Number(a.blockNumber - b.blockNumber))
    const created = events.find((e) => e.name === 'PositionCreated') || null
    const sold = events.find((e) => e.name === 'ILBondSold') || null

    // IL series — derive a mark from every ILBondDataBundle that includes this
    // position. The bundle carries current price + per-position entry/liquidity,
    // so we reproduce the RSC's mark for each cycle. This keeps the chart in sync
    // even when the RSC's settleILMark → ILMarkUpdated leg lags or stalls.
    const derived = r.data
      .filter((e) => e.name === 'ILBondDataBundle')
      .sort((a, b) => Number(a.blockNumber - b.blockNumber))
      .map((e) => {
        const mark = bundleMark(e.args?.data, want)
        if (!mark) return null
        return {
          ts: e.ts,
          blockNumber: e.blockNumber,
          logIndex: e.logIndex,
          name: 'ILMarkUpdated',
          derived: true,
          args: { positionId: BigInt(want), ilBps: BigInt(mark.ilBps), markValue: mark.markValue },
        }
      })
      .filter(Boolean)

    // Prefer the bundle-derived series (complete + fresh); fall back to the raw
    // on-chain ILMarkUpdated events if no bundle decoded (e.g. pre-bundle history).
    const onChainMarks = events.filter((e) => e.name === 'ILMarkUpdated')
    const ilMarks = derived.length ? derived : onChainMarks

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

// ── per-account balances + hook allowances for a token pair (default demo) ───
export function useTokenInfo(address, token0 = ADDR.token0, token1 = ADDR.token1) {
  const r = useReadContracts({
    contracts: [
      { address: token0, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId: SEPOLIA_CHAIN_ID },
      { address: token1, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId: SEPOLIA_CHAIN_ID },
      { address: token0, abi: ERC20_ABI, functionName: 'allowance', args: [address, ADDR.hook], chainId: SEPOLIA_CHAIN_ID },
      { address: token1, abi: ERC20_ABI, functionName: 'allowance', args: [address, ADDR.hook], chainId: SEPOLIA_CHAIN_ID },
    ],
    query: { enabled: !!address && !!token0 && !!token1, refetchInterval: REFRESH },
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

// ── claimable balances across EVERY registry token (multi-pool) ──────────────
const TOKEN_LIST = Object.values(TOKENS)
export function useClaimable(address) {
  const r = useReadContracts({
    contracts: TOKEN_LIST.map((t) => ({ ...hookBase, functionName: 'getClaimable', args: [address, t.address] })),
    query: { enabled: !!address, refetchInterval: REFRESH },
  })
  const claims = useMemo(() => {
    const out = []
    TOKEN_LIST.forEach((t, i) => {
      const amount = r.data?.[i]?.result
      if (amount && amount > 0n) out.push({ token: t.address, sym: t.symbol, dec: t.decimals, amount })
    })
    return out
  }, [r.data])
  return { claims, isLoading: r.isLoading, refetch: r.refetch }
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
