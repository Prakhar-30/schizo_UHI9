import { createClient } from '@supabase/supabase-js'
import { ADDR } from '../config/contracts'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Read-only public client. Writes happen server-side in api/index-events.js with
// the service-role key. If the env vars are missing, callers fall back to chain.
export const supabase = URL && KEY ? createClient(URL, KEY, { auth: { persistSession: false } }) : null
export const supabaseEnabled = !!supabase

const BIGINT_RE = /^-?\d+$/

// The indexer serializes bigint args to decimal strings; revive them so rows
// behave identically to the viem decode path.
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

// Full hook-event history from Supabase (paged past the 1000-row limit).
// Throws on error so the caller can fall back to reading logs directly.
export async function fetchEventsFromSupabase(hookAddr = ADDR.hook) {
  if (!supabase) throw new Error('supabase not configured')
  const HOOK_ADDR = hookAddr.toLowerCase()
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('hook_events')
      .select('*')
      .eq('hook_address', HOOK_ADDR) // hook address is unique per chain → isolates deployments
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

// Fire-and-forget nudge to the indexer between cron runs (Vercel Hobby crons
// are daily). Throttled per tab; no-ops without /api (plain `npm run dev`).
let lastNudge = 0
export function nudgeIndexer() {
  const now = Date.now()
  if (now - lastNudge < 30000) return
  lastNudge = now
  fetch('/api/index-events', { method: 'POST' }).catch(() => {})
}
