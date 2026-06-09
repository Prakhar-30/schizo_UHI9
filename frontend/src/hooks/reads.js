import { useMemo } from 'react'
import { useReadContract, useReadContracts, useBalance } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http, parseEventLogs, parseAbiItem } from 'viem'
import {
  HOOK_ABI,
  ERC20_ABI,
  REACTIVE_ABI,
  STATEVIEW_ABI,
  LASNA_CHAIN_ID,
} from '../config/contracts'
import { useNetwork } from '../context/NetworkContext'
import { fetchEventsFromSupabase, supabaseEnabled, nudgeIndexer } from '../lib/supabase'
import { computeIL, bundleMark } from '../lib/il'

export const REFRESH = 12000
const LOG_LOOKBACK = 9500n

// Per-chain event-log client (the main RPC may cap getLogs ranges). Cached by id.
const _logClients = {}
function logClientFor(net) {
  if (!_logClients[net.chainId]) {
    _logClients[net.chainId] = createPublicClient({ chain: net.viemChain, transport: http(net.logRpc) })
  }
  return _logClients[net.chainId]
}

// Convenience: the contract base for the active hook.
function useHookBase() {
  const net = useNetwork()
  return { net, hookBase: { address: net.addr.hook, abi: HOOK_ABI, chainId: net.chainId } }
}

// ── headline counters ──────────────────────────────────────────────────────
export function useHookCounters() {
  const { hookBase } = useHookBase()
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

// ── position → poolId map (backend-first; on-chain ModifyLiquidity fallback) ──
const MODIFY_LIQ_EVENT = parseAbiItem(
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
)
export function usePositionPoolMap() {
  const net = useNetwork()
  // Backend-first: the indexer folds each position's poolId into its
  // PositionCreated event args, so we read it straight from Supabase via
  // useAllEvents. Only fall back to an on-chain PoolManager.ModifyLiquidity scan
  // when the backend yields nothing (e.g. Unichain, which has no indexer).
  const ev = useAllEvents()
  const fromEvents = useMemo(() => {
    const m = {}
    for (const e of ev.data || []) {
      if (e.name === 'PositionCreated' && e.args?.poolId) {
        const pid = Number(e.args.positionId)
        if (m[pid] === undefined) m[pid] = String(e.args.poolId).toLowerCase()
      }
    }
    return m
  }, [ev.data])

  const needFallback = Object.keys(fromEvents).length === 0

  const fallback = useQuery({
    queryKey: ['posPoolMapRpc', net.chainId, net.addr.hook],
    enabled: needFallback,
    refetchInterval: REFRESH,
    queryFn: async () => {
      const logs = await logClientFor(net).getLogs({
        address: net.addr.poolManager,
        event: MODIFY_LIQ_EVENT,
        args: { sender: net.addr.hook },
        fromBlock: net.deployBlock,
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

  return { data: needFallback ? fallback.data : fromEvents }
}

// ── all positions (getPosition + getRange per id), annotated with their pool ──
export function usePositions() {
  const { net, hookBase } = useHookBase()
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
  }, [count, hookBase.address, hookBase.chainId])

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
      const poolId = poolMap?.[i]
      const pool = net.getPoolById(poolId)
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
        pool,
        poolId,
        currentSqrtPriceX96: currentSqrt,
        premiumSym: pool?.sym1 || 'token1',
        premiumDec: pool?.dec1 ?? 18,
        premiumToken: pool?.token1,
      })
    }
    return out
  }, [r.data, count, poolStats, poolMap, net])

  const refetch = () => {
    refetchCounters()
    r.refetch()
  }

  return { positions, count, isLoading: r.isLoading || (count > 0 && !r.data), refetch }
}

// ── current price + liquidity + live dynamic fee for ONE pool ────────────────
export function useCurrentPrice(poolId) {
  const net = useNetwork()
  const id = poolId || net.demoPool.id
  const r = useReadContracts({
    contracts: [
      { address: net.addr.stateView, abi: STATEVIEW_ABI, functionName: 'getSlot0', args: [id], chainId: net.chainId },
      { address: net.addr.stateView, abi: STATEVIEW_ABI, functionName: 'getLiquidity', args: [id], chainId: net.chainId },
      { address: net.addr.hook, abi: HOOK_ABI, functionName: 'currentFee', args: [id], chainId: net.chainId },
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
          dynFee: dynFee !== undefined ? Number(dynFee) : undefined,
        }
      : undefined,
    refetch: r.refetch,
    isLoading: r.isLoading,
  }
}

// ── all pools: live slot0 + liquidity + dynamic fee (one multicall) ─────────
export function usePoolStats() {
  const net = useNetwork()
  const contracts = useMemo(() => {
    const arr = []
    for (const p of net.pools) {
      arr.push({ address: net.addr.stateView, abi: STATEVIEW_ABI, functionName: 'getSlot0', args: [p.id], chainId: net.chainId })
      arr.push({ address: net.addr.stateView, abi: STATEVIEW_ABI, functionName: 'getLiquidity', args: [p.id], chainId: net.chainId })
      arr.push({ address: net.addr.hook, abi: HOOK_ABI, functionName: 'currentFee', args: [p.id], chainId: net.chainId })
    }
    return arr
  }, [net])
  const r = useReadContracts({ contracts, query: { refetchInterval: REFRESH } })
  const byId = useMemo(() => {
    const m = {}
    net.pools.forEach((p, i) => {
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
  }, [r.data, net])
  return { byId, isLoading: r.isLoading, refetch: r.refetch }
}

// ── per-pool SwapOccurred price series, grouped by poolId ────────────────────
export function usePoolSwapSeries() {
  const r = useAllEvents()
  const byPool = useMemo(() => {
    const m = {}
    if (!r.data) return m
    for (const e of r.data) {
      if (e.name !== 'SwapOccurred' || !e.args?.poolId) continue
      const pid = String(e.args.poolId).toLowerCase()
      ;(m[pid] ||= []).push({
        block: Number(e.blockNumber),
        idx: Number(e.logIndex),
        sqrtPriceX96: e.args.sqrtPriceX96,
        tick: Number(e.args.tick),
        ts: e.ts,
      })
    }
    for (const k in m) {
      m[k].sort((a, b) => (a.block === b.block ? a.idx - b.idx : a.block - b.block))
    }
    return m
  }, [r.data])
  return { data: byPool, isLoading: r.isLoading, refetch: r.refetch }
}

// ── on-chain fallback: events within the ~9500-block public-RPC window ───────
async function fetchEventsOnChain(net) {
  const client = logClientFor(net)
  const latest = await client.getBlockNumber()
  const from = latest > LOG_LOOKBACK ? latest - LOG_LOOKBACK : 0n
  const raw = await client.getLogs({ address: net.addr.hook, fromBlock: from, toBlock: 'latest' })
  const decoded = parseEventLogs({ abi: HOOK_ABI, logs: raw })

  const uniqueBlocks = [...new Set(decoded.map((l) => l.blockNumber))]
  const blocks = await Promise.all(uniqueBlocks.map((bn) => client.getBlock({ blockNumber: bn })))
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
export function useAllEvents() {
  const net = useNetwork()
  return useQuery({
    queryKey: ['allHookEvents', net.chainId, net.addr.hook],
    refetchInterval: REFRESH,
    queryFn: async () => {
      if (supabaseEnabled) {
        try {
          const events = await fetchEventsFromSupabase(net.addr.hook)
          nudgeIndexer()
          if (events.length > 0) return events
        } catch (err) {
          console.warn('[schizo] Supabase event read failed, falling back to chain:', err)
        }
      }
      return fetchEventsOnChain(net)
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
  return { data: events, isLoading: r.isLoading, refetch: r.refetch, dataUpdatedAt: r.dataUpdatedAt }
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
    const swaps = wantPool
      ? r.data
          .filter((e) => e.name === 'SwapOccurred' && String(e.args?.poolId).toLowerCase() === wantPool)
          .sort((a, b) => Number(a.blockNumber - b.blockNumber))
      : []
    const created = events.find((e) => e.name === 'PositionCreated') || null
    const sold = events.find((e) => e.name === 'ILBondSold') || null

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

    const onChainMarks = events.filter((e) => e.name === 'ILMarkUpdated')
    const ilMarks = derived.length ? derived : onChainMarks

    return { events, ilMarks, swaps, created, sold, isLoading: r.isLoading }
  }, [r.data, positionId, poolId, r.isLoading])
}

// ── leaderboard aggregations from event log + on-chain position state ──────
export function useLeaderboardData() {
  const r = useAllEvents()
  const { positions } = usePositions()
  return useMemo(() => {
    const events = r.data || []
    const sold = events.filter((e) => e.name === 'ILBondSold')
    const created = events.filter((e) => e.name === 'PositionCreated')

    const byId = new Map(positions.map((p) => [Number(p.id), p]))

    const lpEarn = new Map()
    for (const e of sold) {
      const p = byId.get(Number(e.args.positionId))
      if (!p) continue
      const lp = (p.lp || '').toLowerCase()
      lpEarn.set(lp, (lpEarn.get(lp) || 0n) + (e.args.premium || 0n))
    }

    const hunterSpend = new Map()
    for (const e of sold) {
      const b = (e.args.buyer || '').toLowerCase()
      hunterSpend.set(b, (hunterSpend.get(b) || 0n) + (e.args.premium || 0n))
    }

    const lpCount = new Map()
    for (const e of created) {
      const o = (e.args.owner || '').toLowerCase()
      lpCount.set(o, (lpCount.get(o) || 0) + 1)
    }

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

// ── per-account balances + hook allowances for a token pair ──────────────────
export function useTokenInfo(address, token0, token1) {
  const { net, hookBase } = useHookBase()
  const t0 = token0 || net.demoPool.token0
  const t1 = token1 || net.demoPool.token1
  const r = useReadContracts({
    contracts: [
      { address: t0, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId: net.chainId },
      { address: t1, abi: ERC20_ABI, functionName: 'balanceOf', args: [address], chainId: net.chainId },
      { address: t0, abi: ERC20_ABI, functionName: 'allowance', args: [address, net.addr.hook], chainId: net.chainId },
      { address: t1, abi: ERC20_ABI, functionName: 'allowance', args: [address, net.addr.hook], chainId: net.chainId },
    ],
    query: { enabled: !!address && !!t0 && !!t1, refetchInterval: REFRESH },
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
export function useClaimable(address) {
  const { net, hookBase } = useHookBase()
  const tokenList = useMemo(() => Object.values(net.tokens), [net])
  const r = useReadContracts({
    contracts: tokenList.map((t) => ({ ...hookBase, functionName: 'getClaimable', args: [address, t.address] })),
    query: { enabled: !!address, refetchInterval: REFRESH },
  })
  const claims = useMemo(() => {
    const out = []
    tokenList.forEach((t, i) => {
      const amount = r.data?.[i]?.result
      if (amount && amount > 0n) out.push({ token: t.address, sym: t.symbol, dec: t.decimals, amount })
    })
    return out
  }, [r.data, tokenList])
  return { claims, isLoading: r.isLoading, refetch: r.refetch }
}

// ── Reactive contract status on Lasna ───────────────────────────────────────
export function useReactiveStatus() {
  const net = useNetwork()
  const active = useReadContract({
    address: net.addr.reactive,
    abi: REACTIVE_ABI,
    functionName: 'activeCount',
    chainId: LASNA_CHAIN_ID,
    query: { refetchInterval: 20000, retry: 1 },
  })
  const bal = useBalance({ address: net.addr.reactive, chainId: LASNA_CHAIN_ID, query: { refetchInterval: 20000, retry: 1 } })
  return {
    activeCount: active.data,
    balance: bal.data?.value,
    symbol: bal.data?.symbol || 'REACT',
    online: !active.isError && active.data !== undefined,
    isLoading: active.isLoading,
  }
}
