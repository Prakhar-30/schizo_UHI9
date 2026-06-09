-- ───────────────────────────────────────────────────────────────────────────
--  schizō · ILBondHook event index
--  Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
--  Safe to re-run: every statement is idempotent.
-- ───────────────────────────────────────────────────────────────────────────

-- One row per on-chain hook event, keyed by (tx_hash, log_index) so the
-- indexer can upsert without ever creating duplicates.
create table if not exists public.hook_events (
  tx_hash      text    not null,
  log_index    integer not null,
  event_name   text    not null,
  position_id  bigint,            -- null for pool-wide events (SwapOccurred, CycleCompleted)
  block_number bigint  not null,
  block_ts     bigint  not null,  -- unix seconds
  hook_address text,              -- which hook deployment emitted this (v2 multi-pool)
  args         jsonb   not null,  -- decoded event args; bigints stored as decimal strings
                                   -- NOTE: PositionCreated rows are enriched with
                                   -- args.poolId (recovered from PoolManager.ModifyLiquidity)
                                   -- so the app resolves a position's pool backend-first.
  primary key (tx_hash, log_index)
);

-- If the table already exists from the v1 deployment, add the new column:
alter table public.hook_events add column if not exists hook_address text;

create index if not exists hook_events_position_id_idx on public.hook_events (position_id);
create index if not exists hook_events_block_number_idx on public.hook_events (block_number);
create index if not exists hook_events_event_name_idx  on public.hook_events (event_name);
create index if not exists hook_events_hook_address_idx on public.hook_events (hook_address);

-- Tracks how far the indexer has scanned so it can resume incrementally.
create table if not exists public.indexer_state (
  id          text        primary key,
  last_block  bigint      not null,
  updated_at  timestamptz not null default now()
);

-- ── Row-Level Security ──────────────────────────────────────────────────────
-- Public (anon / publishable key) may ONLY read events. Writes are performed by
-- the indexer using the service-role key, which bypasses RLS entirely — so no
-- insert/update/delete policy is granted to the public.
alter table public.hook_events   enable row level security;
alter table public.indexer_state enable row level security;

drop policy if exists "public read events" on public.hook_events;
create policy "public read events"
  on public.hook_events
  for select
  to anon, authenticated
  using (true);

-- indexer_state stays fully locked to the public (no policies = no anon access).
