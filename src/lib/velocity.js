// How fast a product actually moves.
//
// There were two of these — one behind the restock suggestions, one behind the
// order analysis — and they disagreed. The first counted only orders carrying a
// product_id; the second also matched on name, so an order typed in before the
// product existed in inventory counted on one page and not the other, and the
// same toy showed two different sales rates depending on where you looked.
//
// They also shared a mistake. Both divided the quantity sold by the whole
// window, whether or not the product had been on sale for all of it. A toy
// launched ten days ago that sold sixty came out at one a day instead of six,
// so the restock suggestion covered a fifth of what was needed — and the faster
// a new product sold, the further out the number was. New lines selling well
// are exactly the ones worth reordering, and they were the ones being
// under-ordered.
//
// A product cannot have sold anything before it existed, so the window is cut
// at whichever is later: the start of the window, or the day the product was
// added.

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const DAY = 86400000

const normName = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Build a velocity lookup over a set of products and orders.
 *
 * @returns {(item) => {stock, sold, perDay, perMonth, days, known}}
 *   `days` is how much of the window the product was actually on sale for.
 */
export function buildVelocity(products, orders, { windowDays = 60, now = Date.now() } = {}) {
  const since = new Date(now - windowDays * DAY)
  const sinceISO = since.toISOString().slice(0, 10)

  const byId = {}, byName = {}
  ;(orders || []).forEach(o => {
    if (o.status !== 'delivered') return
    if ((o.order_date || '') < sinceISO) return
    const q = num(o.qty)
    if (o.product_id) byId[o.product_id] = (byId[o.product_id] || 0) + q
    const n = normName(o.product_name)
    if (n) byName[n] = (byName[n] || 0) + q
  })

  const prodById = new Map((products || []).map(p => [p.id, p]))
  const prodByName = new Map((products || []).map(p => [normName(p.name), p]))

  // How many days of the window this product could have been selling for.
  // Never more than the window, never less than one — a product added today has
  // had one day, not zero, and dividing by zero helps nobody.
  const daysOnSale = p => {
    const created = p && p.created_at ? new Date(p.created_at) : null
    if (!created || isNaN(created)) return windowDays
    const days = Math.ceil((now - created.getTime()) / DAY)
    return Math.max(1, Math.min(windowDays, days))
  }

  return item => {
    const p = (item.product_id && prodById.get(item.product_id)) || prodByName.get(normName(item.product_name))
    // By id where we have one, by name otherwise — never both added together,
    // which would count the same sale twice.
    const sold = (p && byId[p.id]) || byName[normName(item.product_name)] || 0
    const days = daysOnSale(p)
    const perDay = sold / days
    return {
      stock: p ? num(p.stock_qty) : num(item.current_stock),
      sold, days, perDay, perMonth: perDay * 30,
      known: !!p,
    }
  }
}
