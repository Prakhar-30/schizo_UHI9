import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http, parseEventLogs, parseAbiItem } from 'viem'
import { HOOK_ABI, ERC20_ABI, STATEVIEW_ABI } from '../config/contracts'
import { useNetwork } from '../context/NetworkContext'
import { fetchEventsFromSupabase, supabaseEnabled, nudgeIndexer } from '../lib/supabase'
import { computeIL } from '../lib/il'

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
    ],
    query: { refetchInterval: REFRESH },
  })
  const d = r.data || []
  return {
    nextId: d[0]?.result,
    activeCount: d[1]?.result,
    isLoading: r.isLoading,
    refetch: r.refetch,
  }
}

// SwapOccurred count = how many times the mark has moved (every swap re-marks).
export function useMarkCount() {
  const r = useAllEvents()
  const count = useMemo(
    () => (r.data ? r.data.filter((e) => e.name === 'SwapOccurred').length : undefined),
    [r.data],
  )
  return { count, isLoading: r.isLoading }
}

// ── position → poolId map (backend-first; on-chain ModifyLiquidity fallback) ──
const MODIFY_LIQ_EVENT = parseAbiItem(
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
)
export function usePositionPoolMap() {
  const net = useNetwork()
  // Indexer folds poolId into PositionCreated args; fall back to an on-chain
  // ModifyLiquidity scan only when the backend yields nothing (e.g. Unichain).
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

// Resolve block timestamps with bounded concurrency + best-effort: a single RPC
// hiccup must never reject the whole feed (the old Promise.all-over-every-block
// burst rate-limited public RPCs intermittently → empty feed).
async function blockTimestamps(client, blockNumbers, concurrency = 6) {
  const tsMap = {}
  let i = 0
  const worker = async () => {
    while (i < blockNumbers.length) {
      const bn = blockNumbers[i++]
      try {
        const b = await client.getBlock({ blockNumber: bn })
        tsMap[bn.toString()] = Number(b.timestamp)
      } catch {
        /* leave undefined; consumers tolerate a missing ts */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, blockNumbers.length) }, worker))
  return tsMap
}

// On-chain hook events from `fromBlock` (clamped to the ~9500-block public-RPC
// window) to head. Used for the RECENT tail the indexer hasn't reached yet.
async function fetchEventsOnChain(net, fromBlock) {
  const client = logClientFor(net)
  const latest = await client.getBlockNumber()
  const floor = latest > LOG_LOOKBACK ? latest - LOG_LOOKBACK : 0n
  const from = fromBlock != null && fromBlock > floor ? fromBlock : floor
  if (from > latest) return []
  const raw = await client.getLogs({ address: net.addr.hook, fromBlock: from, toBlock: 'latest' })
  const decoded = parseEventLogs({ abi: HOOK_ABI, logs: raw })

  const uniqueBlocks = [...new Set(decoded.map((l) => l.blockNumber))]
  const tsMap = await blockTimestamps(client, uniqueBlocks)

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

// Merge two event lists, de-duping by txHash-logIndex.
function mergeEvents(...lists) {
  const seen = new Map()
  for (const list of lists) for (const e of list) seen.set(e.key, e)
  return [...seen.values()]
}

// All hook events: Supabase holds the full backlog but lags head, so always
// merge in the on-chain tail past its high-water mark.
export function useAllEvents() {
  const net = useNetwork()
  return useQuery({
    queryKey: ['allHookEvents', net.chainId, net.addr.hook],
    refetchInterval: REFRESH,
    queryFn: async () => {
      let supa = []
      if (supabaseEnabled) {
        try {
          supa = await fetchEventsFromSupabase(net.addr.hook)
          nudgeIndexer()
        } catch (err) {
          console.warn('[schizo] Supabase event read failed, using chain only:', err)
        }
      }
      // Only scan the tail Supabase hasn't indexed yet (cheap); full window if empty.
      const supaHead = supa.reduce((m, e) => (e.blockNumber > m ? e.blockNumber : m), 0n)
      let recent = []
      try {
        recent = await fetchEventsOnChain(net, supaHead > 0n ? supaHead : undefined)
      } catch (err) {
        console.warn('[schizo] on-chain tail read failed:', err)
        if (supa.length === 0) throw err // nothing to show → let React Query retry
      }
      return mergeEvents(supa, recent)
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
    const sorted = [...arr]
      .sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? Number(a.logIndex - b.logIndex)
          : Number(a.blockNumber - b.blockNumber),
      )
      .reverse() // newest first
    // limit === null/undefined → return the full history (no cap)
    return limit != null && Number.isFinite(limit) ? sorted.slice(0, limit) : sorted
  }, [r.data, limit, positionId])
  return {
    data: events,
    isLoading: r.isLoading,
    isFetching: r.isFetching,
    refetch: r.refetch,
    dataUpdatedAt: r.dataUpdatedAt,
  }
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

    // SwapOccurred carries the smoothed marking price, so IL history rebuilds
    // from the event log alone (old logs without the field fall back to spot).
    const entrySqrt = created?.args?.entrySqrtPriceX96
    const ilMarks = entrySqrt
      ? swaps
          .filter((e) => e.blockNumber >= created.blockNumber)
          .map((e) => {
            const markSqrt = e.args?.markSqrtPriceX96 || e.args?.sqrtPriceX96
            if (!markSqrt) return null
            return {
              ts: e.ts,
              blockNumber: e.blockNumber,
              logIndex: e.logIndex,
              name: 'ILMark',
              derived: true,
              args: {
                positionId: BigInt(want),
                ilBps: BigInt(Math.round(computeIL(entrySqrt, markSqrt) * 10000)),
              },
            }
          })
          .filter(Boolean)
      : []

    return { events, ilMarks, swaps, created, sold, isLoading: r.isLoading }
  }, [r.data, positionId, poolId, r.isLoading])
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
