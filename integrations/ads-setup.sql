-- ─────────────────────────────────────────────────────────────────────────────
-- Ads & Campaigns
--
-- Run this once in Supabase → SQL Editor.
--
-- The money itself still lives in Cost Management (the `expenses` table) — that
-- stays the single record of what was actually paid. A campaign here is the
-- story around a slice of that money: what it was for, which product, over
-- which dates, and what came back.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ad_campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  platform      text default 'Instagram',
  objective     text,
  status        text default 'active',           -- planned | active | ended
  start_date    date not null default current_date,
  end_date      date,

  -- What this campaign is spending, in MVR
  spend         numeric(10,2) default 0,
  -- The expense row in Cost Management this was booked as, when it was booked
  -- from here. Null when the cost was entered separately.
  expense_id    uuid,

  -- What is being advertised (optional — a campaign can be brand-wide)
  product_id    uuid,
  product_name  text,
  audience      text,
  notes         text,

  -- Results, typed in from the platform's own report
  impressions    integer default 0,
  reach          integer default 0,
  likes          integer default 0,
  comments       integer default 0,
  shares         integer default 0,
  saves          integer default 0,
  clicks         integer default 0,
  profile_visits integer default 0,
  new_followers  integer default 0,
  messages       integer default 0,

  -- What you judge came out of it
  orders_count  integer default 0,
  revenue       numeric(10,2) default 0,

  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists ad_campaigns_dates_idx on ad_campaigns (start_date desc);
create index if not exists ad_campaigns_product_idx on ad_campaigns (product_id);

alter table ad_campaigns enable row level security;

-- Same rule as the rest of the back office: signed-in staff only.
drop policy if exists "ad_campaigns_all" on ad_campaigns;
create policy "ad_campaigns_all" on ad_campaigns
  for all to authenticated using (true) with check (true);
