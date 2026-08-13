import { supabase } from './supabase'

const round2 = n => Math.round(n * 100) / 100

/**
 * Re-price every USD-based catalog product to a new MVR rate.
 *
 * Supplier costs are quoted in USD. When a product is imported in dollars we keep
 * the original figure in `cost_usd`, and its MVR `cost_price` is always that
 * dollars figure times the current rate. So when the rate changes we recompute
 * `cost_price = cost_usd × rate` for every such product. Products entered
 * directly in MVR carry no `cost_usd` and are left exactly as they are.
 *
 * @param {number} newRate MVR per 1 USD
 * @returns {Promise<number>} how many products were repriced, or -1 if the
 *   `cost_usd` column isn't set up yet (nothing to do until the migration runs).
 */
export async function reconvertCatalogToRate(newRate) {
  const rate = Number(newRate)
  if (!rate || rate <= 0) return 0
  const { data, error } = await supabase
    .from('supplier_products')
    .select('id, cost_usd')
    .not('cost_usd', 'is', null)
  if (error) return -1
  let n = 0
  for (const r of (data || [])) {
    const usd = Number(r.cost_usd)
    if (!isFinite(usd)) continue
    const { error: e } = await supabase
      .from('supplier_products')
      .update({ cost_price: round2(usd * rate) })
      .eq('id', r.id)
    if (!e) n++
  }
  return n
}
