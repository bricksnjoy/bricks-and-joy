-- ============================================================================
-- Brick's & Joy — remember a product's size on an order analysis line
-- Run once in Supabase → SQL Editor. Safe to run more than once.
--
-- The size the product is sold in (S/M/L, 1:18, 60cm) — not its packed
-- dimensions — so the analysis list and the supplier order sheet can show which
-- size is being ordered. Lines added before this ran fall back to the size on
-- the catalog or inventory record they came from.
-- ============================================================================

alter table order_analysis_items add column if not exists sizes text;
