-- ============================================================================
-- Brick's & Joy — Audit trail + order extras (special requests & delivery fee)
-- Run this once in Supabase → SQL Editor.
-- ============================================================================

-- 1. AUDIT LOG — who did what, when
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz default now(),
  user_email text,
  action text,           -- create | update | delete | cancel | return | payment | stock
  entity text,           -- order | product | purchase_order | customer | vendor | catalog
  entity_label text,     -- human-readable, e.g. "INV-123 — Bouquet of Roses ×1"
  details jsonb
);
create index if not exists idx_audit_log_at on audit_log(at desc);

alter table audit_log enable row level security;
drop policy if exists "staff_audit_insert" on audit_log;
drop policy if exists "staff_audit_read" on audit_log;
create policy "staff_audit_insert" on audit_log for insert to authenticated with check (true);
create policy "staff_audit_read"   on audit_log for select to authenticated using (true);
-- No update/delete policies: the log is append-only for everyone.

-- 2. ORDER EXTRAS — special requests (gift wrapping etc.) + island delivery fee
alter table orders add column if not exists special_request text;
alter table orders add column if not exists delivery_fee numeric(10,2) default 0;
-- true  = the shop covers the fee (logged as a Delivery expense)
-- false = the customer pays it back (added to the invoice total)
alter table orders add column if not exists delivery_fee_covered boolean default false;
-- Gift / special-request cost. Kept as a SEPARATE transaction:
--   customer pays -> its own line item on the invoice (own entry in reconciliation money-in)
--   shop covers   -> its own Packaging expense    (own entry in reconciliation money-out)
alter table orders add column if not exists special_request_cost numeric(10,2) default 0;
alter table orders add column if not exists special_request_covered boolean default false;
