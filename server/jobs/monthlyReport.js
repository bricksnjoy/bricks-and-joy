// The monthly business report, by email.
//
// Ported from the monthly-report Edge Function. It reads straight from the
// database now rather than going back out through an HTTP API, which is both
// faster and one less key to keep.
//
// Body (all optional):
//   { month: "2026-05" }  -> that calendar month
//   { test: true }        -> this month so far, for checking it works
//   {}                    -> the previous full month

const db = require('../db')
const { sendEmail } = require('../lib/mail')

const CURRENCY = 'MVR'
const DAY = 86_400_000
const money = n =>
  `${CURRENCY} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const ymd = d => d.toISOString().split('T')[0]

function monthRange(monthStr, test) {
  const now = new Date()
  let y, m   // m is 0-indexed
  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    y = +monthStr.slice(0, 4); m = +monthStr.slice(5, 7) - 1
  } else if (test) {
    y = now.getUTCFullYear(); m = now.getUTCMonth()
  } else {
    y = now.getUTCFullYear(); m = now.getUTCMonth() - 1
    if (m < 0) { m = 11; y -= 1 }
  }
  const start = new Date(Date.UTC(y, m, 1))
  const end = test ? now : new Date(Date.UTC(y, m + 1, 0))    // last day of the month
  const label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { start: ymd(start), end: ymd(end), label }
}

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

async function buildReport(body = {}) {
  const { start, end, label } = monthRange(body.month, body.test)

  const cfgRes = await db.query('select * from report_settings where id = 1')
  const cfg = cfgRes.rows[0] || {}
  const recipients = String(cfg.recipients || '')
    .split(/[,;\s]+/).map(s => s.trim()).filter(s => s.includes('@'))
  const incFin = cfg.include_financial !== false
  const incRestock = cfg.include_restock !== false
  const incSales = cfg.include_sales !== false

  const [ordersRes, expensesRes, productsRes] = await Promise.all([
    db.query('select id, order_date, status, qty, product_id, product_name, total_price, payment_status, customer_name from orders'),
    db.query('select expense_date, category, amount from expenses'),
    db.query('select id, name, cost_price, stock_qty, discontinued, low_stock_threshold from products'),
  ])
  const O = ordersRes.rows, E = expensesRes.rows, P = productsRes.rows

  const costById = {}
  P.forEach(p => { costById[p.id] = Number(p.cost_price || 0) })

  const asDay = d => (d instanceof Date ? ymd(d) : String(d || ''))
  const inMonth = d => { const s = asDay(d); return s && s >= start && s <= end }
  const deliveredMonth = O.filter(o => o.status === 'delivered' && inMonth(o.order_date))

  // ── Financial summary ──
  const revenue = deliveredMonth.reduce((s, o) => s + Number(o.total_price || 0), 0)
  const cogs = deliveredMonth.reduce((s, o) => s + (costById[o.product_id] || 0) * Number(o.qty || 0), 0)
  const gross = revenue - cogs
  const expSum = E.filter(e => inMonth(e.expense_date)).reduce((s, e) => s + Number(e.amount || 0), 0)
  const net = gross - expSum
  const ar = O.filter(o => o.payment_status === 'unpaid' || o.payment_status === 'partial')
    .reduce((s, o) => s + Number(o.total_price || 0), 0)

  // ── Budget vs actual — only if a budgets table has been set up ──
  let budgetRows = []
  try { budgetRows = (await db.query('select category, amount from budgets')).rows } catch { /* no budgets table */ }
  const budgetMap = {}
  budgetRows.forEach(b => { budgetMap[b.category] = Number(b.amount || 0) })
  const catAlias = { 'Marketing Ads': 'Meta Ads', 'Instagram Ads': 'Meta Ads', 'Facebook Ads': 'Meta Ads' }
  const expByCat = {}
  E.filter(e => inMonth(e.expense_date)).forEach(e => {
    const c = catAlias[e.category] || e.category || 'Other'
    expByCat[c] = (expByCat[c] || 0) + Number(e.amount || 0)
  })
  const budgetCats = Object.entries(budgetMap).filter(([, a]) => Number(a) > 0)
    .map(([cat, a]) => ({ cat, budget: Number(a), actual: expByCat[cat] || 0, over: (expByCat[cat] || 0) - Number(a) }))
    .sort((x, y) => y.over - x.over)

  // ── Restock predictions (mirrors src/lib/insights.js) ──
  const since = ymd(new Date(Date.now() - 60 * DAY))
  const soldByProduct = {}
  O.filter(o => o.status === 'delivered' && asDay(o.order_date) >= since).forEach(o => {
    if (o.product_id) soldByProduct[o.product_id] = (soldByProduct[o.product_id] || 0) + Number(o.qty || 0)
  })
  const restock = P.filter(p => !p.discontinued).map(p => {
    const sold = soldByProduct[p.id] || 0
    const perDay = sold / 60
    const stock = Number(p.stock_qty || 0)
    const daysLeft = perDay > 0 ? Math.round(stock / perDay) : Infinity
    const suggestedReorder = perDay > 0 ? Math.max(0, Math.ceil(perDay * 30 - stock)) : 0
    let urgency = 'ok'
    if (perDay > 0) {
      if (stock <= 0) urgency = 'out'
      else if (daysLeft <= 7) urgency = 'critical'
      else if (daysLeft <= 21) urgency = 'soon'
    } else if (stock <= 0) urgency = 'out'
    const unitCost = Number(p.cost_price || 0)
    return { name: p.name, stock, perMonth: perDay * 30, daysLeft, suggestedReorder, urgency, reorderCost: suggestedReorder * unitCost }
  }).filter(r => ['out', 'critical', 'soon'].includes(r.urgency))
    .sort((a, b) => a.daysLeft - b.daysLeft)

  // ── Sales highlights ──
  const orderCount = O.filter(o => inMonth(o.order_date)).length
  const byKey = (rows, key) => {
    const m = {}
    rows.forEach(o => { const k = o[key] || '—'; m[k] = (m[k] || 0) + Number(o.total_price || 0) })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }
  const topProducts = byKey(deliveredMonth, 'product_name')
  const topCustomers = byKey(deliveredMonth, 'customer_name')

  // ── HTML ──
  const C = { navy: '#0d1b2a', orange: '#FFA500', green: '#1D9E75', red: '#E24B4A', grey: '#888' }
  const card = (title, inner) =>
    `<div style="background:#fff;border:1px solid #eee;border-radius:14px;padding:18px 20px;margin-bottom:16px">
       <div style="font-size:13px;font-weight:700;color:${C.navy};text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">${title}</div>${inner}</div>`
  const stat = (l, v, color = C.navy) =>
    `<tr><td style="padding:5px 0;color:${C.grey};font-size:13px">${l}</td><td style="padding:5px 0;text-align:right;font-weight:700;color:${color};font-size:14px">${v}</td></tr>`

  let sections = ''
  if (incFin) sections += card('💰 Financial summary', `<table style="width:100%;border-collapse:collapse">
    ${stat('Revenue', money(revenue), C.green)}
    ${stat('Cost of goods sold', '−' + money(cogs))}
    ${stat('Gross profit', money(gross))}
    ${stat('Operating expenses', '−' + money(expSum), C.red)}
    <tr><td colspan="2" style="border-top:1px solid #eee"></td></tr>
    ${stat('Net profit', money(net), net >= 0 ? C.green : C.red)}
    ${stat('Outstanding (unpaid orders)', money(ar), C.orange)}
  </table>`)

  if (budgetCats.length) {
    const totB = budgetCats.reduce((s, r) => s + r.budget, 0)
    const totA = budgetCats.reduce((s, r) => s + r.actual, 0)
    const rs = budgetCats.map(r => {
      const col = r.over > 0 ? C.red : C.green
      return `<tr><td style="padding:5px 0;font-size:13px;color:${C.navy}">${esc(r.cat)}</td><td style="padding:5px 0;text-align:right;font-size:12px;color:${C.grey}">${money(r.actual)} / ${money(r.budget)}</td><td style="padding:5px 0;text-align:right;font-weight:700;color:${col};font-size:13px">${r.over > 0 ? '+' : ''}${money(r.over)}</td></tr>`
    }).join('')
    sections += card('📊 Budget vs actual', `<table style="width:100%;border-collapse:collapse">${rs}<tr><td style="padding-top:8px;border-top:1px solid #eee;font-weight:700;color:${C.navy};font-size:13px">Total</td><td style="padding-top:8px;border-top:1px solid #eee;text-align:right;font-size:12px;color:${C.grey}">${money(totA)} / ${money(totB)}</td><td style="padding-top:8px;border-top:1px solid #eee;text-align:right;font-weight:800;color:${totA > totB ? C.red : C.green};font-size:13px">${totA - totB > 0 ? '+' : ''}${money(totA - totB)}</td></tr></table>`)
  }

  if (incSales) {
    const list = rows => rows.length
      ? rows.map(([k, v]) => `<tr><td style="padding:4px 0;font-size:13px;color:${C.navy}">${esc(k)}</td><td style="padding:4px 0;text-align:right;font-size:13px;font-weight:600">${money(v)}</td></tr>`).join('')
      : `<tr><td style="color:${C.grey};font-size:13px">No sales this period</td></tr>`
    sections += card('📈 Sales highlights', `<table style="width:100%;border-collapse:collapse">
      ${stat('Orders placed', String(orderCount))}
    </table>
    <div style="font-size:12px;color:${C.grey};font-weight:600;margin:12px 0 4px">Top products</div>
    <table style="width:100%;border-collapse:collapse">${list(topProducts)}</table>
    <div style="font-size:12px;color:${C.grey};font-weight:600;margin:12px 0 4px">Top customers</div>
    <table style="width:100%;border-collapse:collapse">${list(topCustomers)}</table>`)
  }

  if (incRestock) {
    const rows = restock.length
      ? restock.map(r => {
          const col = r.urgency === 'soon' ? C.orange : C.red
          const tag = r.urgency === 'out' ? 'OUT' : r.urgency === 'critical' ? 'CRITICAL' : 'SOON'
          return `<tr>
            <td style="padding:6px 0;font-size:13px;color:${C.navy}">${esc(r.name)}<br><span style="font-size:11px;color:${C.grey}">${r.stock} in stock · ~${r.perMonth.toFixed(0)}/mo · ${r.daysLeft === Infinity ? '—' : r.daysLeft + 'd left'}</span></td>
            <td style="padding:6px 0;text-align:right"><span style="font-size:10px;font-weight:700;color:#fff;background:${col};padding:2px 8px;border-radius:99px">${tag}</span><br><span style="font-size:13px;font-weight:700;color:${C.navy}">+${r.suggestedReorder}</span> <span style="font-size:11px;color:${C.grey}">${r.reorderCost > 0 ? money(r.reorderCost) : ''}</span></td>
          </tr>`
        }).join('') + (() => {
          const t = restock.reduce((s, r) => s + r.reorderCost, 0)
          return t > 0 ? `<tr><td style="padding-top:10px;border-top:1px solid #eee;font-weight:700;color:${C.navy};font-size:13px">Total to reorder</td><td style="padding-top:10px;border-top:1px solid #eee;text-align:right;font-weight:800;color:${C.navy};font-size:14px">${money(t)}</td></tr>` : ''
        })()
      : `<tr><td style="color:${C.green};font-size:13px">✅ Everything is well stocked.</td></tr>`
    sections += card('📦 Reorder list', `<table style="width:100%;border-collapse:collapse">${rows}</table>`)
  }

  const html = `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f6f5f2;padding:24px;max-width:600px;margin:0 auto">
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:22px;font-weight:800;color:${C.navy}">Brick's &amp; Joy</div>
      <div style="font-size:13px;color:${C.grey}">Monthly report · ${label}</div>
    </div>
    ${sections}
    <div style="text-align:center;font-size:11px;color:#bbb;margin-top:18px">Automated report · ${start} to ${end}</div>
  </div>`

  return { html, subject: `Brick's & Joy — ${label} report`, recipients, label, start, end }
}

async function runMonthlyReport(body = {}) {
  const { html, subject, recipients, label } = await buildReport(body)
  if (!recipients.length) return { ok: false, error: 'No recipients configured in report_settings' }

  const sent = await sendEmail({ to: recipients, subject, html })
  if (!sent.ok) return { ok: false, error: sent.detail || sent.error }
  return { ok: true, sent_to: recipients, month: label, id: sent.id }
}

module.exports = { runMonthlyReport, buildReport, monthRange }
