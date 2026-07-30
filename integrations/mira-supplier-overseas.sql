-- ============================================================================
-- Brick's & Joy — mark suppliers located overseas (non-resident)
-- Run once in Supabase → SQL Editor. Lets the MIRA Schedule 2 form total your
-- payments to overseas suppliers into Box 27 (payments to non-residents).
-- Safe to run more than once.
-- ============================================================================

alter table suppliers add column if not exists is_overseas boolean default false;
