import { supabase } from './supabase'

const round2 = n => Math.round(n * 100) / 100
const round4 = n => Math.round(n * 10000) / 10000

/**
 * Re-price the whole catalog to a new MVR rate, live.
 *
 * Every product's MVR cost is `dollars × rate`. The dollar figure comes from
 * `cost_usd` when it's recorded; otherwise it's derived from the rate the catalog
 * was priced at until now (`cost_price ÷ oldRate`). Either way the dollars are
 * written back to `cost_usd`, so from then on the amount is on record and future
 * rate changes are exact.
 *
 * @param {number} newRate MVR per 1 USD to switch to
 * @param {number} oldRate MVR per 1 USD the catalog was priced at until now
 * @returns {Promise<number>} how many products were repriced, or -1 if the
 *   `cost_usd` column isn't set up yet (nothing to do until the migration runs).
 */
export async function reconvertCatalogToRate(newRate, oldRate) {
  const rate = Number(newRate)
  const old = Number(oldRate)
  if (!rate || rate <= 0) return 0
  const { data, error } = await supabase
    .from('supplier_products')
    .select('id, cost_price, cost_usd')
  if (error) return -1
  let n = 0
  for (const r of (data || [])) {
    const recorded = (r.cost_usd != null && r.cost_usd !== '') ? Number(r.cost_usd) : NaN
    const cp = (r.cost_price == null || r.cost_price === '') ? NaN : Number(r.cost_price)
    // Recorded dollars win; otherwise back them out of the rate priced at until now.
    const usd = isFinite(recorded) ? recorded : (isFinite(cp) && old > 0 ? round4(cp / old) : NaN)
    if (!isFinite(usd)) continue
    const { error: e } = await supabase
      .from('supplier_products')
      .update({ cost_usd: usd, cost_price: round2(usd * rate) })
      .eq('id', r.id)
    if (!e) n++
  }
  return n
}

/**
 * One-time back-fill: give every catalog product a USD cost so rate changes can
 * re-price it from then on.
 *
 * Products imported before USD costs existed only have an MVR `cost_price`, with
 * no record of the dollars behind it. This derives the dollars from the rate the
 * catalog is *currently* priced at (`cost_usd = cost_price ÷ basisRate`), stores
 * it, and re-prices the MVR cost to `targetRate`. Products that already carry a
 * `cost_usd` keep it (only their MVR is refreshed to the target), so this is safe
 * to run more than once.
 *
 * @param {number} basisRate MVR-per-USD the catalog's current MVR costs were set at
 * @param {number} targetRate MVR-per-USD to switch every product to
 * @returns {Promise<{count?: number, error?: 'bad-rate'|'no-column'}>}
 */
export async function backfillCatalogUsd(basisRate, targetRate) {
  const basis = Number(basisRate)
  const target = Number(targetRate)
  if (!basis || basis <= 0 || !target || target <= 0) return { error: 'bad-rate' }
  const { data, error } = await supabase
    .from('supplier_products')
    .select('id, cost_price, cost_usd')
  if (error) return { error: 'no-column' }
  let n = 0
  for (const r of (data || [])) {
    const existing = (r.cost_usd != null && r.cost_usd !== '') ? Number(r.cost_usd) : NaN
    const cp = (r.cost_price == null || r.cost_price === '') ? NaN : Number(r.cost_price)
    // Keep a dollar cost already on record; otherwise derive it from the basis rate.
    const usd = isFinite(existing) ? existing : (isFinite(cp) ? round4(cp / basis) : NaN)
    if (!isFinite(usd)) continue
    const { error: e } = await supabase
      .from('supplier_products')
      .update({ cost_usd: usd, cost_price: round2(usd * target) })
      .eq('id', r.id)
    if (!e) n++
  }
  return { count: n }
}
