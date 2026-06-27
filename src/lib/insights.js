// Lightweight, rule-based analytics — no external AI calls.
// Produces restock predictions, an action checklist, and plain-English insights
// from the data the app already has.

const DAY = 86400000

function daysAgo(n) {
  return new Date(Date.now() - n * DAY).toISOString().split('T')[0]
}

// ── Restock predictions ──────────────────────────────────────────────────────
// Sell-through velocity per product over a recent window → days until stockout
// and a suggested reorder quantity (cover `coverDays` of demand).
export function restockPredictions(products, orders, { windowDays = 60, coverDays = 30 } = {}) {
  const since = daysAgo(windowDays)
  const delivered = orders.filter(o => o.status === 'delivered' && o.order_date >= since)
  const soldByProduct = {}
  delivered.forEach(o => {
    if (!o.product_id) return
    soldByProduct[o.product_id] = (soldByProduct[o.product_id] || 0) + Number(o.qty || 0)
  })

  return products
    .filter(p => !p.discontinued)
    .map(p => {
      const sold = soldByProduct[p.id] || 0
      const perDay = sold / windowDays
      const stock = Number(p.stock_qty || 0)
      const daysLeft = perDay > 0 ? Math.round(stock / perDay) : Infinity
      const perMonth = perDay * 30
      // Reorder enough to cover `coverDays` of demand, minus what's on hand
      const suggestedReorder = perDay > 0 ? Math.max(0, Math.ceil(perDay * coverDays - stock)) : 0
      let urgency = 'ok'
      if (perDay > 0) {
        if (stock <= 0) urgency = 'out'
        else if (daysLeft <= 7) urgency = 'critical'
        else if (daysLeft <= 21) urgency = 'soon'
      } else if (stock <= 0) {
        urgency = 'out'
      }
      return {
        id: p.id, name: p.name, photo_url: p.photo_url, category: p.category,
        stock, sold, perDay, perMonth, daysLeft, suggestedReorder, urgency,
        threshold: p.low_stock_threshold ?? 10,
      }
    })
    .filter(r => r.perDay > 0 || r.stock <= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft)
}

// ── Supplier cost history ────────────────────────────────────────────────────
// Builds a per-product timeline of unit costs from purchase order rows so you
// can see whether a supplier's prices are creeping up over time.
export function costHistoryByProduct(purchaseOrders = []) {
  const byProduct = {}
  purchaseOrders
    .filter(po => po.product_id && Number(po.unit_cost) > 0)
    .forEach(po => {
      const cost = Number(po.unit_cost) > 0 ? Number(po.unit_cost)
        : (Number(po.qty) > 0 ? Number(po.total_cost) / Number(po.qty) : 0)
      if (cost <= 0) return
      ;(byProduct[po.product_id] = byProduct[po.product_id] || []).push({
        date: po.order_date || (po.created_at || '').split('T')[0],
        cost,
      })
    })
  Object.keys(byProduct).forEach(id => {
    const list = byProduct[id].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const first = list[0].cost
    const last = list[list.length - 1].cost
    byProduct[id] = {
      points: list,
      first, last,
      changePct: first > 0 ? (last - first) / first * 100 : 0,
      trend: last > first ? 'up' : last < first ? 'down' : 'flat',
    }
  })
  return byProduct
}

// ── Action center ────────────────────────────────────────────────────────────
// The handful of things that genuinely need attention today.
export function actionItems({ orders, products, customers, loyaltyProfiles = [] }) {
  const items = []
  const today = new Date().toISOString().split('T')[0]

  const unpaid = orders.filter(o => (o.payment_status || 'unpaid') === 'unpaid' && o.status !== 'cancelled')
  const unpaidTotal = unpaid.reduce((s, o) => s + Number(o.total_price || 0), 0)
  if (unpaid.length) items.push({ key: 'unpaid', severity: 'high', icon: 'wallet', count: unpaid.length,
    title: `${unpaid.length} unpaid order${unpaid.length > 1 ? 's' : ''}`,
    detail: `MVR ${unpaidTotal.toFixed(0)} outstanding`, page: 'orders' })

  const toDispatch = orders.filter(o => o.status === 'created')
  if (toDispatch.length) items.push({ key: 'dispatch', severity: 'med', icon: 'truck', count: toDispatch.length,
    title: `${toDispatch.length} order${toDispatch.length > 1 ? 's' : ''} to dispatch`,
    detail: 'Created but not sent out yet', page: 'orders' })

  const inTransit = orders.filter(o => o.status === 'transit')
  if (inTransit.length) items.push({ key: 'transit', severity: 'low', icon: 'truck', count: inTransit.length,
    title: `${inTransit.length} out for delivery`,
    detail: 'Awaiting delivery confirmation', page: 'deliveries' })

  const outOfStock = products.filter(p => !p.discontinued && p.stock_qty <= 0)
  if (outOfStock.length) items.push({ key: 'oos', severity: 'high', icon: 'package', count: outOfStock.length,
    title: `${outOfStock.length} product${outOfStock.length > 1 ? 's' : ''} out of stock`,
    detail: outOfStock.slice(0, 3).map(p => p.name).join(', ') + (outOfStock.length > 3 ? '…' : ''), page: 'inventory' })

  const lowStock = products.filter(p => !p.discontinued && p.stock_qty > 0 && p.stock_qty <= (p.low_stock_threshold ?? 10))
  if (lowStock.length) items.push({ key: 'low', severity: 'med', icon: 'package', count: lowStock.length,
    title: `${lowStock.length} low on stock`,
    detail: lowStock.slice(0, 3).map(p => p.name).join(', ') + (lowStock.length > 3 ? '…' : ''), page: 'inventory' })

  const atRisk = loyaltyProfiles.filter(p => p.atRisk)
  if (atRisk.length) items.push({ key: 'atrisk', severity: 'med', icon: 'users', count: atRisk.length,
    title: `${atRisk.length} customer${atRisk.length > 1 ? 's' : ''} at risk`,
    detail: 'Repeat buyers who have gone quiet — win them back', page: 'customers' })

  const order = { high: 0, med: 1, low: 2 }
  return items.sort((a, b) => order[a.severity] - order[b.severity])
}

// ── Plain-English insights ───────────────────────────────────────────────────
export function generateInsights({ orders, products, customers, restock = [], loyaltyProfiles = [] }) {
  const out = []
  const thisMonth = new Date().toISOString().slice(0, 7)
  const lastMonthD = new Date(); lastMonthD.setMonth(lastMonthD.getMonth() - 1)
  const lastMonth = lastMonthD.toISOString().slice(0, 7)
  const delivered = orders.filter(o => o.status === 'delivered')
  const revenueOrders = orders.filter(o => o.status !== 'cancelled' && (o.status === 'delivered' || o.payment_status === 'paid'))

  const rev = m => revenueOrders.filter(o => o.order_date?.startsWith(m)).reduce((s, o) => s + Number(o.total_price || 0), 0)
  const thisRev = rev(thisMonth), lastRev = rev(lastMonth)

  // Revenue trend
  if (lastRev > 0) {
    const change = (thisRev - lastRev) / lastRev * 100
    if (change >= 10) out.push({ tone: 'good', text: `Revenue is up ${change.toFixed(0)}% vs last month (MVR ${thisRev.toFixed(0)} so far). Keep the momentum — consider increasing your best-selling stock.` })
    else if (change <= -10) out.push({ tone: 'warn', text: `Revenue is down ${Math.abs(change).toFixed(0)}% vs last month. A quick promo to your loyal customers could help recover.` })
    else out.push({ tone: 'neutral', text: `Revenue is steady (MVR ${thisRev.toFixed(0)} this month, ${change >= 0 ? '+' : ''}${change.toFixed(0)}% vs last).` })
  } else if (thisRev > 0) {
    out.push({ tone: 'good', text: `MVR ${thisRev.toFixed(0)} in sales this month so far.` })
  }

  // Best seller (30d)
  const since30 = daysAgo(30)
  const sold30 = {}
  delivered.filter(o => o.order_date >= since30).forEach(o => { if (o.product_name) sold30[o.product_name] = (sold30[o.product_name] || 0) + Number(o.qty || 0) })
  const topSeller = Object.entries(sold30).sort((a, b) => b[1] - a[1])[0]
  if (topSeller) out.push({ tone: 'good', text: `“${topSeller[0]}” is your hot seller — ${topSeller[1]} units in 30 days. Make sure it never goes out of stock.` })

  // Urgent restock
  const critical = restock.filter(r => r.urgency === 'critical' || r.urgency === 'out')
  if (critical.length) {
    const r = critical[0]
    out.push({ tone: 'warn', text: r.urgency === 'out'
      ? `“${r.name}” is out of stock and still selling ~${r.perMonth.toFixed(0)}/month — reorder ${r.suggestedReorder || 'soon'} to avoid lost sales.`
      : `“${r.name}” will run out in about ${r.daysLeft} days at the current pace. Reorder ~${r.suggestedReorder} units now.` })
  }

  // Unpaid follow-up
  const unpaid = orders.filter(o => (o.payment_status || 'unpaid') === 'unpaid' && o.status !== 'cancelled')
  const unpaidTotal = unpaid.reduce((s, o) => s + Number(o.total_price || 0), 0)
  if (unpaidTotal > 0) out.push({ tone: 'warn', text: `MVR ${unpaidTotal.toFixed(0)} is unpaid across ${unpaid.length} order${unpaid.length > 1 ? 's' : ''}. A friendly payment reminder could free up that cash.` })

  // At-risk customers
  const atRisk = loyaltyProfiles.filter(p => p.atRisk)
  if (atRisk.length) out.push({ tone: 'neutral', text: `${atRisk.length} repeat ${atRisk.length === 1 ? 'buyer has' : 'buyers have'} gone quiet. Send a win-back offer from the Customers tab.` })

  // Repeat-buyer ratio
  const repeat = loyaltyProfiles.filter(p => p.isRepeat).length
  if (loyaltyProfiles.length >= 5) {
    const ratio = repeat / loyaltyProfiles.length * 100
    if (ratio >= 40) out.push({ tone: 'good', text: `${ratio.toFixed(0)}% of your customers are repeat buyers — excellent loyalty. Reward them to keep it going.` })
    else if (ratio < 20) out.push({ tone: 'neutral', text: `Only ${ratio.toFixed(0)}% of customers come back. A loyalty offer after the first order could lift repeat sales.` })
  }

  if (!out.length) out.push({ tone: 'neutral', text: 'Not enough recent activity yet — keep recording orders and insights will sharpen up.' })
  return out
}
