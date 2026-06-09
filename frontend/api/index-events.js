// ───────────────────────────────────────────────────────────────────────────
//  schizō · ILBondHook event indexer  (Vercel Node serverless function)
//
//  Pulls ILBondHook logs from Sepolia and upserts them into Supabase so the
//  app's leaderboard / charts / activity feeds aren't capped to the ~9500-block
//  (~32h) public-RPC getLogs window. Idempotent and incremental:
//   • first run backfills from HOOK_DEPLOY_BLOCK → head in ≤MAX_RANGE chunks
//   • later runs scan only from the last indexed block → head
//
//  Triggered by a Vercel cron (see vercel.json) and nudged from the client.
//  Uses the SERVICE-ROLE key (server-only) so it can write past RLS.
// ───────────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { createPublicClient, http, parseAbi, parseAbiItem, parseEventLogs } from 'viem'
import { sepolia } from 'viem/chains'

// v3 fresh deployment (45 pairs).
const HOOK = '0x58A3A816864F1E5f6F38F01f9f5AE1Cacc9210C0'
// PoolManager — source of the position→pool link (salt = positionId, id = poolId).
const POOL_MANAGER = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'
// First block with hook activity (deployed in this session). Backfill starts here.
const HOOK_DEPLOY_BLOCK = 11008000n
const MAX_RANGE = 9500n // public-RPC getLogs cap
const MIN_INTERVAL_MS = 8000 // self-throttle so client nudges don't hammer the RPC

const RPC = process.env.LOG_RPC || process.env.VITE_LOG_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const HOOK_ABI = parseAbi([
  'event SwapOccurred(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick, uint128 liquidity)',
  'event PositionCreated(uint256 indexed positionId, address indexed owner, uint160 entrySqrtPriceX96)',
  'event PositionExited(uint256 indexed positionId)',
  'event ILBondSold(uint256 indexed positionId, address indexed buyer, uint256 premium)',
  'event ILMarkUpdated(uint256 indexed positionId, int256 ilBps, uint256 markValue)',
  'event FeeTokenTransferred(uint256 indexed positionId, address indexed from, address indexed to)',
  'event ILTokenTransferred(uint256 indexed positionId, address indexed from, address indexed to)',
  'event ILBondDataBundle(uint256 indexed bundleId, bytes data)',
  'event CycleCompleted(uint256 timestamp, uint256 positionsChecked)',
])

// PoolManager event we use only to recover each position's poolId (the hook's
// PositionCreated event doesn't carry it). salt = bytes32(positionId), id = poolId.
const MODIFY_LIQ = parseAbiItem(
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
)

// Bumped for the v2 hook so the indexer re-backfills from the new deploy block
// instead of resuming the old hook's cursor.
const STATE_ID = 'ilbondhook_v3'

// JSON replacer: bigint → decimal string (everything else passes through).
const jsonSafe = (obj) => JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var' })
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const client = createPublicClient({ chain: sepolia, transport: http(RPC) })

  try {
    // ── resume point + throttle ──────────────────────────────────────────────
    const { data: state } = await db.from('indexer_state').select('*').eq('id', STATE_ID).maybeSingle()
    if (state?.updated_at && Date.now() - new Date(state.updated_at).getTime() < MIN_INTERVAL_MS) {
      return res.status(200).json({ ok: true, skipped: 'throttled', lastBlock: state.last_block })
    }

    const head = await client.getBlockNumber()
    let from = state?.last_block !== undefined ? BigInt(state.last_block) + 1n : HOOK_DEPLOY_BLOCK
    if (from > head) {
      return res.status(200).json({ ok: true, upToDate: true, lastBlock: head.toString() })
    }

    // ── scan in ≤MAX_RANGE chunks, decode, upsert ────────────────────────────
    let inserted = 0
    let scannedTo = from - 1n
    const tsCache = new Map()

    for (let start = from; start <= head; start += MAX_RANGE + 1n) {
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
            address: POOL_MANAGER,
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
            hook_address: HOOK.toLowerCase(), // tag rows so the frontend can filter by deployment
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
    }

    // ── persist resume point ──────────────────────────────────────────────────
    const { error: sErr } = await db
      .from('indexer_state')
      .upsert({ id: STATE_ID, last_block: Number(scannedTo), updated_at: new Date().toISOString() })
    if (sErr) throw sErr

    return res.status(200).json({
      ok: true,
      fromBlock: from.toString(),
      toBlock: scannedTo.toString(),
      eventsUpserted: inserted,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
}
