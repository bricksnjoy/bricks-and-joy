// What an order is actually worth.
//
// `total_price` is a column the database computes as qty × unit_price, so it is
// always the price before any discount. The discount is kept beside it, per row,
// because a discount given on a two-item invoice is split across both lines.
//
// That means `total_price` on its own is never the number a customer paid, and
// summing it gives a figure the bank will not agree with. Every page that talks
// about money should go through here, so they cannot drift apart.

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Before the discount — what the goods list at. */
export const grossOf = row => num(row?.total_price)

/** The discount on this row. A two-item invoice carries a share on each line. */
export const discountOf = row => num(row?.discount)

/**
 * What the customer actually pays for this row: the price less its discount.
 * Never negative — a discount bigger than the line is a data-entry mistake, and
 * a negative sale would quietly corrupt every total it reached.
 */
export const netOf = row => Math.max(0, grossOf(row) - discountOf(row))

/** The same three, totalled over the rows of an invoice. */
export const sumGross = rows => (rows || []).reduce((s, r) => s + grossOf(r), 0)
export const sumDiscount = rows => (rows || []).reduce((s, r) => s + discountOf(r), 0)
export const sumNet = rows => (rows || []).reduce((s, r) => s + netOf(r), 0)

/**
 * Whether an order counts as money earned.
 *
 * Paid, or delivered and awaiting payment. An order sitting "under review" is
 * not revenue: nobody has paid for it and it may yet be cancelled.
 *
 * This lived in ProfitLoss.js while the Business Sheet counted every order that
 * had not been cancelled — so the two tabs of the same page answered the same
 * question differently, the second one counting money that had not arrived.
 * One rule, in one place, so they cannot disagree again.
 */
export const isRevenue = row =>
  !!row && row.status !== 'cancelled' && (row.status === 'delivered' || row.payment_status === 'paid')

/** Revenue over a set of rows — the rule above, netted. */
export const sumRevenue = rows => (rows || []).filter(isRevenue).reduce((s, r) => s + netOf(r), 0)

/**
 * What one line of an order cost us.
 *
 * `unit_cost` is written onto the row when the order is placed, so a supplier
 * changing their price tomorrow does not rewrite what last month's profit was.
 * Orders placed before that column existed have nothing recorded, so they fall
 * back to the product's cost today — which is what every calculation used to do
 * for every order, and is the best that can be said about history now.
 *
 * @param row       the order row
 * @param costOfId  map of product id → current cost price, for the fallback
 */
export function costOfRow(row, costOfId = {}) {
  if (!row) return 0
  const qty = parseInt(row.qty) || 0
  const recorded = row.unit_cost == null || row.unit_cost === '' ? null : num(row.unit_cost)
  const unit = recorded != null ? recorded : num(costOfId[row.product_id])
  return unit * qty
}

/** Cost of sales over a set of rows. */
export const sumCost = (rows, costOfId = {}) =>
  (rows || []).reduce((s, r) => s + costOfRow(r, costOfId), 0)
