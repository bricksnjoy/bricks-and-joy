-- ============================================================================
-- Brick's & Joy — Reconciliation sync (settled entries + saved settings)
-- Run this once in Supabase → SQL Editor so the "Won't appear" list and the
-- "records start" date sync across devices instead of living on one browser.
-- Safe to run more than once.
-- ============================================================================

-- ── Small key/value store for single settings that must sync ──────────────────
-- Currently holds the reconciliation start date under key 'books_start'.
create table if not exists app_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

alter table app_settings enable row level security;
drop policy if exists "staff_all_app_settings" on app_settings;
create policy "staff_all_app_settings" on app_settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── Book entries settled by hand as "won't appear on the bank statement" ──────
-- book_id is the reconciliation's own id for a sale/cost, e.g. 'expense:123'.
-- These stay real in the books and Profit & Loss; settling only stops the
-- reconciliation asking about them forever.
create table if not exists settled_entries (
  book_id text primary key,
  reason text,
  created_at timestamptz default now()
);

alter table settled_entries enable row level security;
drop policy if exists "staff_all_settled_entries" on settled_entries;
create policy "staff_all_settled_entries" on settled_entries
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
