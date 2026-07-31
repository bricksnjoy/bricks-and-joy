-- ============================================================================
-- Brick's & Joy — take stock out at dispatch instead of at order creation
-- Run once in Supabase → SQL Editor. Safe to run more than once.
--
-- Adds a flag that records whether an order's stock is currently out of
-- inventory, so the deduction is never applied or reversed twice.
--
-- Backfill: until now every order removed its stock the moment it was created,
-- so every order that isn't cancelled is already holding its stock out — we
-- mark those as deducted. Cancelled orders already had their stock returned, so
-- they stay false. After this, newly created orders wait until "Dispatched" to
-- leave inventory, while these existing ones keep the stock they already took.
-- ============================================================================

alter table orders add column if not exists stock_deducted boolean default false;

update orders set stock_deducted = true  where status <> 'cancelled' and stock_deducted is distinct from true;
update orders set stock_deducted = false where status =  'cancelled' and stock_deducted is distinct from false;
