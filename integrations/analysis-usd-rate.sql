-- USD-based supplier costs: conversion rates and the original dollar figure.
--
-- Supplier costs are quoted in USD. The catalog import converts them to MVR
-- using the rate in Settings, and stores the ORIGINAL dollars in cost_usd so a
-- later rate change can re-price every USD product (cost_price = cost_usd × rate).
-- Products entered directly in MVR leave cost_usd null and are never re-priced.
--
-- Each Cost Analysis draft also stores its OWN rate (usd_rate) so the USD→MVR
-- rate is locked for that batch even if the Settings rate changes later. Its
-- catalog lines derive from the product's cost_usd × the draft's rate.
--
-- Safe to run more than once.

ALTER TABLE order_analyses
  ADD COLUMN IF NOT EXISTS usd_rate numeric DEFAULT 15.42;

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS cost_usd numeric;
