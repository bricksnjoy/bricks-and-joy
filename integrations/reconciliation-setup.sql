-- ============================================================================
-- Brick's & Joy — Reconciliation history table
-- Run this once in Supabase → SQL Editor so reconciliations sync across
-- devices and store full line details (viewable & editable later).
-- ============================================================================

create table if not exists reconciliations (
  id uuid primary key default gen_random_uuid(),
  account text,
  period_start date,
  period_end date,
  statement_in numeric(12,2) default 0,
  statement_out numeric(12,2) default 0,
  closing_balance numeric(12,2) default 0,
  matched_count int default 0,
  unmatched_count int default 0,
  cleared jsonb,        -- book entry ids marked reconciled
  lines jsonb,          -- every statement line with its match (for view/edit)
  created_at timestamptz default now()
);

-- For tables created before this update:
alter table reconciliations add column if not exists lines jsonb;

alter table reconciliations enable row level security;
drop policy if exists "staff_all_reconciliations" on reconciliations;
create policy "staff_all_reconciliations" on reconciliations
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
