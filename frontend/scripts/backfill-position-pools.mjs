// ───────────────────────────────────────────────────────────────────────────
//  Backfill position → pool into Supabase (no schema change required).
//
//  The hook's PositionCreated event doesn't carry a poolId, so the frontend used
//  to recover it via an RPC scan of PoolManager.ModifyLiquidity (salt = positionId,
//  id = poolId, sender = hook) — which is RPC, not backend-first, and capped by the
//  log window. This script resolves each position's pool ONCE and writes it into the
//  existing `hook_events` rows' jsonb `args.poolId`, so the app can read it straight
//  from Supabase (backend-first) like every other event field.
//
//  Run:  node scripts/backfill-position-pools.mjs   (from frontend/)
//  Uses the SERVICE-ROLE key (server-side) from .env to write past RLS.
// ───────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { createPublicClient, http, parseAbiItem } from 'viem'
import { sepolia } from 'viem/chains'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// minimal .env loader (no VITE_ stripping — we read both prefixes)
function loadEnv() {
  const p = path.join(__dirname, '..', '.env')
  const out = {}
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

const env = loadEnv()
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const RPC = env.LOG_RPC || env.VITE_LOG_RPC || 'https://ethereum-sepolia-rpc.publicnode.com'

const HOOK = '0x58A3A816864F1E5f6F38F01f9f5AE1Cacc9210C0'
const POOL_MANAGER = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'
const DEPLOY_BLOCK = 11008000n
const MAX_RANGE = 9500n

const MODIFY_LIQ = parseAbiItem(
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
)

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in frontend/.env')
    process.exit(1)
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const client = createPublicClient({ chain: sepolia, transport: http(RPC) })

  // 1. Build positionId → poolId from PoolManager.ModifyLiquidity (sender = hook).
  const head = await client.getBlockNumber()
  const map = {}
  let scanned = 0
  for (let start = DEPLOY_BLOCK; start <= head; start += MAX_RANGE + 1n) {
    const end = start + MAX_RANGE > head ? head : start + MAX_RANGE
    const logs = await client.getLogs({
      address: POOL_MANAGER,
      event: MODIFY_LIQ,
      args: { sender: HOOK },
      fromBlock: start,
      toBlock: end,
    })
    for (const l of logs) {
      const pid = Number(BigInt(l.args.salt))
      if (map[pid] === undefined) map[pid] = String(l.args.id).toLowerCase()
    }
    scanned += logs.length
  }
  const ids = Object.keys(map)
  console.log(`ModifyLiquidity logs seen: ${scanned} → ${ids.length} positions mapped`)
  if (ids.length === 0) {
    console.log('Nothing to backfill.')
    return
  }

  // 2. Enrich each PositionCreated row's args.poolId in Supabase.
  const { data: rows, error } = await db
    .from('hook_events')
    .select('tx_hash, log_index, position_id, args')
    .eq('hook_address', HOOK.toLowerCase())
    .eq('event_name', 'PositionCreated')
  if (error) throw error
  console.log(`PositionCreated rows in Supabase: ${rows?.length ?? 0}`)

  let updated = 0
  for (const row of rows || []) {
    const poolId = map[Number(row.position_id)]
    if (!poolId) continue
    if (row.args?.poolId === poolId) continue // already enriched
    const newArgs = { ...(row.args || {}), poolId }
    const { error: uErr } = await db
      .from('hook_events')
      .update({ args: newArgs })
      .eq('tx_hash', row.tx_hash)
      .eq('log_index', row.log_index)
    if (uErr) throw uErr
    updated++
    console.log(`  #${row.position_id} → ${poolId}`)
  }
  console.log(`\nDone. Enriched ${updated} PositionCreated row(s) with poolId.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
