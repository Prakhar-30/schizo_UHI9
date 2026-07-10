// ───────────────────────────────────────────────────────────────────────────
//  schizō · ILBondHook event indexer  (Vercel Node serverless function)
//
//  Pulls ILBondHook logs from EVERY supported chain (Ethereum Sepolia +
//  Unichain Sepolia) and upserts them into Supabase so the app's leaderboard /
//  charts / activity feeds aren't capped to the ~9500-block public-RPC getLogs
//  window. Idempotent and incremental, PER CHAIN:
//   • first run backfills from each hook's deploy block → head in ≤MAX_RANGE chunks
//   • later runs scan only from that chain's last indexed block → head
//
//  Rows are tagged with hook_address (unique per chain), so the two deployments
//  share one table yet stay fully isolated - the frontend filters by hook.
//  Each chain keeps its own indexer_state cursor, so they resume independently.
//
//  Triggered by a Vercel cron (see vercel.json) and nudged from the client.
//  Uses the SERVICE-ROLE key (server-only) so it can write past RLS.
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { createPublicClient, http, parseAbi, parseAbiItem, parseEventLogs } from 'viem'
import { sepolia, unichainSepolia } from 'viem/chains'

const MAX_RANGE = 9500n // public-RPC getLogs cap (both chains honour this)
const MIN_INTERVAL_MS = 8000 // self-throttle so client nudges don't hammer the RPC
// Safety cap so one invocation can't run long enough to time out on a fast chain
// (Unichain ~1s blocks). The cursor persists, so repeated runs catch up.
const MAX_CHUNKS_PER_CHAIN = 60

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// ── per-chain config (each its own hook, pool manager, deploy block, RPC, and
//    indexer_state cursor). Mirrors src/config/networks.js + api/og.js. ───────
const NETWORKS = [
  {
    chainId: 11155111,
    chain: sepolia,
    // Sepolia - v5 self-marking deployment (45 pairs).
    hook: '0x57696AB5077Aa634c13682C3d3E84287935290c0',
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
    deployBlock: 11239703n,
    rpc: process.env.LOG_RPC || process.env.VITE_LOG_RPC || process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    stateId: 'ilbondhook_v5',
  },
  {
    chainId: 1301,
    chain: unichainSepolia,
    // Unichain Sepolia - second, independent v5 deployment (mock tokens, fresh hook).
    hook: '0x20487A756FececfF800d15EC76C78e0487A2D0c0',
    poolManager: '0x00B036B58a818B1BC34d502D3fE730Db729e62AC',
    deployBlock: 56790639n,
    rpc: process.env.UNICHAIN_RPC || process.env.VITE_UNICHAIN_RPC || 'https://sepolia.unichain.org',
    stateId: 'ilbondhook_unichain_v5',
  },
]

const HOOK_ABI = parseAbi([
  // v5 hook: SwapOccurred carries the smoothed marking price, so the full IL
  // history rebuilds from swap events alone. No mark-settlement events exist.
  'event SwapOccurred(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick, uint128 liquidity, uint160 markSqrtPriceX96)',
  'event PositionCreated(uint256 indexed positionId, address indexed owner, uint160 entrySqrtPriceX96)',
  'event PositionExited(uint256 indexed positionId)',
  'event ILBondSold(uint256 indexed positionId, address indexed buyer, uint256 premium)',
  'event FeesCollected(uint256 indexed positionId, address indexed feeHolder, uint256 amount0, uint256 amount1)',
  'event FeeTokenTransferred(uint256 indexed positionId, address indexed from, address indexed to)',
  'event ILTokenTransferred(uint256 indexed positionId, address indexed from, address indexed to)',
])

// PoolManager event we use only to recover each position's poolId (the hook's
// PositionCreated event doesn't carry it). salt = bytes32(positionId), id = poolId.
const MODIFY_LIQ = parseAbiItem(
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
)

// JSON replacer: bigint → decimal string (everything else passes through).
const jsonSafe = (obj) => JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))

// ── index a single chain from its cursor → head; returns a per-chain summary ──
async function indexChain(db, net) {
  const client = createPublicClient({ chain: net.chain, transport: http(net.rpc) })
  const HOOK = net.hook
  const HOOK_LOWER = HOOK.toLowerCase()

  // resume point + throttle (per chain, keyed by stateId)
  const { data: state } = await db.from('indexer_state').select('*').eq('id', net.stateId).maybeSingle()
  if (state?.updated_at && Date.now() - new Date(state.updated_at).getTime() < MIN_INTERVAL_MS) {
    return { chainId: net.chainId, skipped: 'throttled', lastBlock: state.last_block }
  }

  const head = await client.getBlockNumber()
  let from = state?.last_block !== undefined ? BigInt(state.last_block) + 1n : net.deployBlock
  if (from > head) {
    return { chainId: net.chainId, upToDate: true, lastBlock: head.toString() }
  }

  let inserted = 0
  let scannedTo = from - 1n
  let chunks = 0
  const tsCache = new Map()

  for (let start = from; start <= head && chunks < MAX_CHUNKS_PER_CHAIN; start += MAX_RANGE + 1n) {
    const end = start + MAX_RANGE > head ? head : start + MAX_RANGE
    const raw = await client.getLogs({ address: HOOK, fromBlock: start, toBlock: end })
    const decoded = parseEventLogs({ abi: HOOK_ABI, logs: raw })

    if (decoded.length) {
      // resolve block timestamps (one getBlock per unique block, cached)
      const blocks = [...new Set(decoded.map((l) => l.blockNumber))]
      await Promise.all(
        blocks.map(async (bn) => {
          if (tsCache.has(bn)) return
          const b = await client.getBlock({ blockNumber: bn })
          tsCache.set(bn, Number(b.timestamp))
        }),
      )

      // For any PositionCreated in this chunk, recover its poolId from the
      // PoolManager ModifyLiquidity log in the same range and fold it into the
      // event args so the frontend can read it backend-first (no RPC scan).
      const pidPool = {}
      if (decoded.some((l) => l.eventName === 'PositionCreated')) {
        const ml = await client.getLogs({
          address: net.poolManager,
          event: MODIFY_LIQ,
          args: { sender: HOOK },
          fromBlock: start,
          toBlock: end,
        })
        for (const l of ml) {
          const pid = Number(BigInt(l.args.salt))
          if (pidPool[pid] === undefined) pidPool[pid] = String(l.args.id).toLowerCase()
        }
      }

      const rows = decoded.map((l) => {
        const base = jsonSafe(l.args || {})
        if (l.eventName === 'PositionCreated') {
          const poolId = pidPool[Number(l.args.positionId)]
          if (poolId) base.poolId = poolId
        }
        return {
          tx_hash: l.transactionHash,
          log_index: l.logIndex,
          event_name: l.eventName,
          position_id: l.args?.positionId !== undefined ? Number(l.args.positionId) : null,
          block_number: Number(l.blockNumber),
          block_ts: tsCache.get(l.blockNumber),
          hook_address: HOOK_LOWER, // tag rows so the frontend can filter by deployment
          args: base,
        }
      })

      const { error } = await db
        .from('hook_events')
        .upsert(rows, { onConflict: 'tx_hash,log_index', ignoreDuplicates: true })
      if (error) throw error
      inserted += rows.length
    }

    scannedTo = end
    chunks += 1
  }

  // persist resume point
  const { error: sErr } = await db
    .from('indexer_state')
    .upsert({ id: net.stateId, last_block: Number(scannedTo), updated_at: new Date().toISOString() })
  if (sErr) throw sErr

  return {
    chainId: net.chainId,
    fromBlock: from.toString(),
    toBlock: scannedTo.toString(),
    headBlock: head.toString(),
    caughtUp: scannedTo >= head,
    eventsUpserted: inserted,
  }
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var' })
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Index every chain. A failure on one chain doesn't abort the others.
  const results = []
  let anyError = null
  for (const net of NETWORKS) {
    try {
      results.push(await indexChain(db, net))
    } catch (err) {
      anyError = String(err?.message || err)
      results.push({ chainId: net.chainId, error: anyError })
    }
  }

  return res.status(anyError ? 207 : 200).json({ ok: !anyError, chains: results })
}
