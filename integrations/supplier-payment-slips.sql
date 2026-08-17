-- Batch-order payments: store the payslip images and multiple references.
--
-- A single supplier payment can be made up of several bank transfers, each with
-- its own slip and reference number. We keep:
--   slips              — the uploaded payslip files (name, type, storage url) as JSON
--   payment_references — every transaction reference as a JSON array
-- The existing text `reference` column still holds all references joined with
-- commas, so search and reconciliation matching keep working unchanged.
-- (The column is payment_references, not "references", which is a reserved word.)
--
-- Without the `slips` column, attached slips were silently dropped on save.
-- Safe to run more than once.

ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS slips jsonb DEFAULT '[]'::jsonb;

ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS payment_references jsonb DEFAULT '[]'::jsonb;
