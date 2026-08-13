-- Per-batch dollar conversion rate for Order (Cost) Analysis drafts.
--
-- Supplier costs are quoted in USD. The catalog import converts them to MVR
-- using the rate in Settings. Each analysis draft also stores its OWN rate so
-- the USD→MVR rate is locked for that batch even if the Settings rate changes
-- later. Defaults to a sensible reference rate; the app overwrites it with the
-- current Settings rate whenever a draft is created.
--
-- Safe to run more than once.

ALTER TABLE order_analyses
  ADD COLUMN IF NOT EXISTS usd_rate numeric DEFAULT 15.42;
