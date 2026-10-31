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

// ── Stock that is bought but hasn't landed ───────────────────────────────────
// A purchase order line that is pending or ordered is stock on its way. The
// shelf is empty today, but suggesting a reorder would buy the same toys
// twice — which is exactly what happened, because four pages each worked this
// out for themselves and two of them forgot to.
//
// 'extra' lines are freight, duty and transaction charges, not goods, so they
// never count. `stock_added` catches a line whose stock has already been
// booked in while the batch sits at its old status.
//
// Products are matched by id, and by name for lines typed in by hand against
// no product — a batch entered from a supplier's invoice often carries only
// the name, and those are the lines most likely to be ordered twice.

/**
 * Index the open purchase order lines so a page can ask what is already coming.
 *
 * @param {Array} rows  purchase_orders rows; needs at least product_id,
 *                      product_name, qty, status, cost_type, stock_added, and
 *                      batch_no / supplier_name / expected_date for the labels.
 * @returns {{has:(id:string,name?:string)=>boolean, get:(id:string,name?:string)=>({qty:number,batches:string[],expected:?string}|null)}}
 */
export function openPurchaseOrders(rows = []) {
  const byId = new Map(), byName = new Map()
  const norm = s => (s || '').toLowerCase().trim()

  rows.forEach(r => {
    if (r.cost_type === 'extra' || r.stock_added) return
    if (r.status !== 'pending' && r.status !== 'ordered') return
    const entry = target => {
      const cur = target || { qty: 0, batches: [], expected: null }
      cur.qty += Number(r.qty) || 0
      const label = r.batch_no || r.supplier_name || 'batch'
      if (!cur.batches.includes(label)) cur.batches.push(label)
      // The soonest arrival is the one worth showing.
      if (r.expected_date && (!cur.expected || r.expected_date < cur.expected)) cur.expected = r.expected_date
      return cur
    }
    if (r.product_id) byId.set(r.product_id, entry(byId.get(r.product_id)))
    if (r.product_name) byName.set(norm(r.product_name), entry(byName.get(norm(r.product_name))))
  })

  // Prefer the id match: a line carrying a product_id is the reliable one, and
  // falling back to the name would double-count the very same line.
  const get = (id, name) => (id && byId.get(id)) || (name && byName.get(norm(name))) || null
  return { has: (id, name) => !!get(id, name), get }
}
