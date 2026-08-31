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
