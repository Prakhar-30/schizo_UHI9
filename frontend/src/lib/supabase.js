import { createClient } from '@supabase/supabase-js'
import { ADDR } from '../config/contracts'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const HOOK_ADDR = ADDR.hook.toLowerCase()

// Read-only public client. Writes happen server-side in api/index-events.js with
// the service-role key. If the env vars are missing, callers fall back to chain.
export const supabase = URL && KEY ? createClient(URL, KEY, { auth: { persistSession: false } }) : null
export const supabaseEnabled = !!supabase

const BIGINT_RE = /^-?\d+$/

/**
 * Restore the exact types the on-chain decode produced. The indexer stores event
 * args as JSON with bigints serialized to decimal strings; numbers (e.g. int24
 * `tick`) and hex strings (addresses, bytes32) are stored as-is. Walk the object
 * and turn decimal-string scalars back into BigInt so downstream consumers
 * (sqrtPriceToPrice, premium sums, .toString(), …) behave identically to the
 * viem path.
 */
function reviveArgs(args) {
  if (!args || typeof args !== 'object') return args
  const out = Array.isArray(args) ? [] : {}
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && BIGINT_RE.test(v)) out[k] = BigInt(v)
    else if (v && typeof v === 'object') out[k] = reviveArgs(v)
    else out[k] = v
  }
  return out
}

/** Map a hook_events row to the shape useAllEvents() yields from the chain. */
export function rowToEvent(row) {
  return {
    key: `${row.tx_hash}-${row.log_index}`,
    name: row.event_name,
    args: reviveArgs(row.args),
    txHash: row.tx_hash,
    blockNumber: BigInt(row.block_number),
    logIndex: row.log_index,
    ts: Number(row.block_ts),
  }
}

/**
 * Fetch the full hook-event history from Supabase (no 9500-block / ~32h cap).
 * Pages through results so it keeps working past the 1000-row default limit.
 * Returns events in the same shape as the on-chain path. Throws on error so the
 * caller can fall back to reading logs directly.
 */
export async function fetchEventsFromSupabase() {
  if (!supabase) throw new Error('supabase not configured')
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('hook_events')
      .select('*')
      .eq('hook_address', HOOK_ADDR) // only the active deployment's events
      .order('block_number', { ascending: true })
      .order('log_index', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all.map(rowToEvent)
}

// Fire-and-forget nudge to the server-side indexer so freshly-emitted events
// show up between cron runs (important on Vercel Hobby, where crons are daily).
// Throttled to once per 30s per tab; silently no-ops if /api isn't available
// (e.g. plain `npm run dev`).
let lastNudge = 0
export function nudgeIndexer() {
  const now = Date.now()
  if (now - lastNudge < 30000) return
  lastNudge = now
  fetch('/api/index-events', { method: 'POST' }).catch(() => {})
}
