// Moving stock.
//
// Every page that changed a stock level did the same three steps: read the
// number, add or subtract in the browser, write the answer back. Two people
// working at once both read the same number and the second write erased the
// first, so a movement vanished — the shop believing it still held toys it had
// already sent out. Measured on a real database, twenty concurrent dispatches
// against a stock of 100 ended at 99 rather than 80: nineteen lost.
//
// One page fixing this on its own is not enough; a dispatch racing against a
// shipment being received is the same race between two different files. So the
// arithmetic happens in the database, in a single statement, and every page
// comes through here.
//
// Note what a fresh read does not buy. CostManagement.js used to read the level
// immediately before writing, with a comment saying it was doing so "so
// concurrent edits aren't clobbered" — but the gap between reading and writing
// is the whole problem, and shortening it only makes the race rarer.

import { supabase } from './supabase'

/**
 * Add `delta` to a product's stock. Negative takes stock out.
 *
 * @returns {Promise<{stock_qty:number, name:string, low_stock_threshold:number}|null>}
 *   the product as it stands *after* the move, or null if it could not be made.
 */
export async function adjustStock(productId, delta) {
  if (!productId || !delta) return null
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_product_id: productId,
    p_delta: Math.round(Number(delta) || 0),
  })
  if (error) {
    console.error('[stock] could not adjust:', error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null
  return {
    ...row,
    stock_qty: Number(row.stock_qty) || 0,
    low_stock_threshold: row.low_stock_threshold == null ? null : Number(row.low_stock_threshold),
  }
}

/**
 * Say what just happened to the shelf, in the words the back office already
 * used: out of stock shouts, low stock mentions the number, anything else is a
 * quiet note.
 */
export function announceStock(row, delta, toast, fallbackThreshold = 10) {
  if (!row || !toast) return
  const n = Math.abs(delta)
  if (delta > 0) { toast.info(`Stock restored: ${row.name} +${n}`); return }
  const limit = row.low_stock_threshold ?? fallbackThreshold ?? 10
  if (row.stock_qty <= 0) toast.error(`⚠️ ${row.name} OUT OF STOCK!`)
  else if (row.stock_qty <= limit) toast.info(`⚠️ Low stock: ${row.name} — ${row.stock_qty} left`)
  else toast.info(`${row.name} −${n} from stock`)
}
