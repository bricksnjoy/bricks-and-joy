-- ============================================================================
-- Brick's & Joy — Planning tab setup (seasonal campaigns)
-- Run this once in Supabase → SQL Editor.
-- Fixes the Planning page being stuck in "saved in this browser only" mode by
-- creating the campaigns table (if missing) and — the important part — adding
-- the Row Level Security policy so logged-in staff can read & write campaigns.
-- ============================================================================

-- 1. Table (safe to re-run — only creates if it doesn't exist)
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  occasion_date date not null,
  emoji text,
  lead_days int default 90,
  notify_email text,
  recurring boolean default true,
  plan jsonb,
  last_notified_year int,
  notified_30_year int,
  created_at timestamptz default now()
);

-- 2. Backfill any columns an older table might be missing
alter table campaigns add column if not exists emoji text;
alter table campaigns add column if not exists lead_days int default 90;
alter table campaigns add column if not exists notify_email text;
alter table campaigns add column if not exists recurring boolean default true;
alter table campaigns add column if not exists plan jsonb;
alter table campaigns add column if not exists last_notified_year int;
alter table campaigns add column if not exists notified_30_year int;

-- 3. THE FIX: enable RLS and allow any logged-in user full access.
--    Without a policy, reads come back empty and writes are blocked, which is
--    what forces the app into browser-only mode.
alter table campaigns enable row level security;
drop policy if exists "staff_all_campaigns" on campaigns;
create policy "staff_all_campaigns" on campaigns
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
