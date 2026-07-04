// Customer loyalty / repeat-buyer logic.
// Tiers are based on the number of *delivered* orders; "at risk" flags
// previously-active customers who have gone quiet.

export const TIERS = [
  { key: 'vip',       label: 'VIP',       min: 8, color: '#7F77DD', emoji: '👑', perk: 'Best customer — offer early access & exclusive bundles' },
  { key: 'loyal',     label: 'Loyal',     min: 4, color: '#1D9E75', emoji: '⭐', perk: 'Reward with a thank-you discount or free add-on' },
  { key: 'returning', label: 'Returning', min: 2, color: '#378ADD', emoji: '🔁', perk: 'Nudge toward their 4th order with a small offer' },
  { key: 'new',       label: 'New',       min: 1, color: '#FFA500', emoji: '🌱', perk: 'Make a great first impression — follow up after delivery' },
  { key: 'prospect',  label: 'Prospect',  min: 0, color: '#9CA3AF', emoji: '○',  perk: 'No completed orders yet' },
]

export const AT_RISK_DAYS = 60

// Order rows are stored one per line item (products, 🚚 delivery fee, 🎁 gift)
// sharing an invoice_number. Collapse them to ONE entry per invoice with the
// totals summed, so order counts and loyalty tiers aren't inflated by extra lines.
export function dedupeInvoices(rows) {
  const map = new Map()
  ;(rows || []).forEach(o => {
    const key = o.customer_id && o.invoice_number ? `${o.customer_id}|${o.invoice_number}` : o.id
    const prev = map.get(key)
    if (prev) {
      prev.total_price = Number(prev.total_price || 0) + Number(o.total_price || 0)
      // A charge row shouldn't decide the invoice's status/product — keep the first product row's
      if (!prev.product_id && o.product_id) { prev.product_id = o.product_id; prev.product_name = o.product_name; prev.status = o.status }
    } else {
      map.set(key, { ...o })
    }
  })
  return [...map.values()]
}

export function tierFor(deliveredCount) {
  return TIERS.find(t => deliveredCount >= t.min) || TIERS[TIERS.length - 1]
}

export function daysSince(dateStr) {
  if (!dateStr) return Infinity
  const d = new Date(dateStr)
  if (isNaN(d)) return Infinity
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

// Build a rich loyalty profile from a customer's orders.
export function loyaltyProfile(custRows) {
  const custOrders = dedupeInvoices(custRows)   // one entry per invoice
  const delivered = custOrders.filter(o => o.status === 'delivered')
  const totalSpent = delivered.reduce((s, o) => s + Number(o.total_price || 0), 0)
  const dates = custOrders.map(o => o.order_date).filter(Boolean).sort()
  const lastOrder = dates[dates.length - 1] || null
  const firstOrder = dates[0] || null
  const tier = tierFor(delivered.length)
  const isRepeat = delivered.length >= 2
  const since = daysSince(lastOrder)
  // "At risk" = was a repeat buyer but hasn't ordered in a while
  const atRisk = isRepeat && since >= AT_RISK_DAYS && since !== Infinity
  const avgOrderValue = delivered.length > 0 ? totalSpent / delivered.length : 0
  return {
    tier, isRepeat, atRisk, totalSpent, avgOrderValue,
    deliveredCount: delivered.length,
    orderCount: custOrders.length,
    lastOrder, firstOrder, daysSinceLast: since,
  }
}
