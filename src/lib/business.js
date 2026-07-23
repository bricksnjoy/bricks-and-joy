import * as XLSX from 'xlsx'
import { supabase } from './supabase'

export const AD_CATS = ['Meta Ads', 'Promotions', 'Sponsorship']
export const OPEN_KEY = 'bnj_opening_balance'
export const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
export const monthLabel = m => new Date(m + '-01T00:00:00').toLocaleDateString('en', { month: 'short', year: '2-digit' })
export const getOpening = () => { try { return parseFloat(localStorage.getItem(OPEN_KEY)) || 0 } catch { return 0 } }
export const setOpening = v => { try { localStorage.setItem(OPEN_KEY, String(v)) } catch {} }

// Load everything the business reports need, in one shot.
export async function loadBusinessData() {
  const [o, p, e, po, l, lp] = await Promise.all([
    supabase.from('orders').select('*'),
    supabase.from('products').select('id, name, category, cost_price, sell_price, stock_qty, discontinued'),
    supabase.from('expenses').select('*'),
    supabase.from('purchase_orders').select('*'),
    supabase.from('loans').select('*').order('taken_on', { ascending: false }),
    supabase.from('loan_payments').select('*'),
  ])
  return { orders: o.data || [], products: p.data || [], expenses: e.data || [], purchases: po.data || [], loans: l.data || [], loanPays: lp.data || [] }
}

// Pure computation from the raw data.
export function computeBusiness(data) {
  const { orders, products, expenses, purchases, loans, loanPays } = data
  const costOf = {}; products.forEach(p => { costOf[p.id] = num(p.cost_price) })
  const liveOrders = orders.filter(o => o.status !== 'cancelled')

  // monthly
  const keys = new Set()
  liveOrders.forEach(o => o.order_date && keys.add(o.order_date.slice(0, 7)))
  expenses.forEach(e => e.expense_date && keys.add(e.expense_date.slice(0, 7)))
  loanPays.forEach(lp => lp.paid_on && keys.add(lp.paid_on.slice(0, 7)))
  const monthly = [...keys].sort().map(m => {
    const mo = liveOrders.filter(o => (o.order_date || '').startsWith(m))
    const invoices = new Set(mo.map(o => o.invoice_number || o.id))
    const revenue = mo.reduce((s, o) => s + num(o.total_price), 0)
    const cogs = mo.reduce((s, o) => s + (costOf[o.product_id] || 0) * (parseInt(o.qty) || 0), 0)
    const exps = expenses.filter(e => (e.expense_date || '').startsWith(m))
    const ad = exps.filter(e => AD_CATS.includes(e.category)).reduce((s, e) => s + num(e.amount), 0)
    const other = exps.filter(e => !AD_CATS.includes(e.category)).reduce((s, e) => s + num(e.amount), 0)
    const loan = loanPays.filter(lp => (lp.paid_on || '').startsWith(m)).reduce((s, lp) => s + num(lp.amount), 0)
    const totalExp = cogs + ad + other + loan
    return { m, orders: invoices.size, revenue, cogs, ad, other, loan, totalExp, profit: revenue - totalExp }
  })
  const totals = monthly.reduce((t, r) => ({
    orders: t.orders + r.orders, revenue: t.revenue + r.revenue, cogs: t.cogs + r.cogs, ad: t.ad + r.ad,
    other: t.other + r.other, loan: t.loan + r.loan, totalExp: t.totalExp + r.totalExp, profit: t.profit + r.profit,
  }), { orders: 0, revenue: 0, cogs: 0, ad: 0, other: 0, loan: 0, totalExp: 0, profit: 0 })

  // inventory
  const closing = products.filter(p => !p.discontinued).reduce((s, p) => s + num(p.cost_price) * (parseInt(p.stock_qty) || 0), 0)
  const purchasesVal = purchases.reduce((s, po) => s + num(po.total_cost || (num(po.unit_cost) * (parseInt(po.qty) || 0))), 0)
  const openingInv = closing + totals.cogs - purchasesVal
  const avg = (openingInv + closing) / 2
  const turn = avg > 0 ? totals.cogs / avg : 0
  const inventory = { closing, purchasesVal, cogs: totals.cogs, openingInv, turn, days: turn > 0 ? 365 / turn : 0 }

  // advertising
  const adMap = {}
  expenses.filter(e => AD_CATS.includes(e.category)).forEach(e => { adMap[e.category] = (adMap[e.category] || 0) + num(e.amount) })
  const adBreakdown = Object.entries(adMap).sort((a, b) => b[1] - a[1])

  // product analysis
  const sold = {}
  liveOrders.forEach(o => {
    if (!o.product_id) return
    if (!sold[o.product_id]) sold[o.product_id] = { soldQty: 0, revenue: 0 }
    sold[o.product_id].soldQty += parseInt(o.qty) || 0
    sold[o.product_id].revenue += num(o.total_price)
  })
  const productAnalysis = products.map(p => {
    const s = sold[p.id] || { soldQty: 0, revenue: 0 }
    const unitCost = num(p.cost_price)
    const stock = parseInt(p.stock_qty) || 0
    const spent = unitCost * (s.soldQty + stock)
    const cogs = unitCost * s.soldQty
    const profit = s.revenue - cogs
    const covered = spent > 0 ? s.revenue >= spent : s.revenue > 0
    return { id: p.id, name: p.name, category: p.category || '—', soldQty: s.soldQty, stock, revenue: s.revenue, unitCost, spent, cogs, profit, covered }
  }).filter(r => r.soldQty > 0 || r.stock > 0).sort((a, b) => b.revenue - a.revenue)

  const catMap = {}
  productAnalysis.forEach(r => {
    if (!catMap[r.category]) catMap[r.category] = { category: r.category, spent: 0, revenue: 0, profit: 0, items: 0 }
    const c = catMap[r.category]; c.spent += r.spent; c.revenue += r.revenue; c.profit += r.profit; c.items += 1
  })
  const categorySummary = Object.values(catMap).map(c => ({ ...c, covered: c.revenue >= c.spent })).sort((a, b) => b.revenue - a.revenue)

  // loans
  const loanRows = loans.map(l => {
    const paid = loanPays.filter(lp => lp.loan_id === l.id).reduce((s, lp) => s + num(lp.amount), 0)
    return { ...l, paid, remaining: Math.max(0, num(l.amount) - paid) }
  })

  return { monthly, totals, inventory, adBreakdown, productAnalysis, categorySummary, loanRows }
}

// ── Excel export — one workbook with a sheet per section ──────────────────────────
export function exportBusinessExcel(data, opening = getOpening()) {
  const c = computeBusiness(data)
  const r2 = n => Math.round(num(n) * 100) / 100
  const wb = XLSX.utils.book_new()

  const perf = [['Month', 'Orders', 'Revenue', 'Cost of sales', 'Advertising', 'Other costs', 'Loan', 'Total exp', 'Profit']]
  c.monthly.forEach(r => perf.push([monthLabel(r.m), r.orders, r2(r.revenue), r2(r.cogs), r2(r.ad), r2(r.other), r2(r.loan), r2(r.totalExp), r2(r.profit)]))
  perf.push(['Total', c.totals.orders, r2(c.totals.revenue), r2(c.totals.cogs), r2(c.totals.ad), r2(c.totals.other), r2(c.totals.loan), r2(c.totals.totalExp), r2(c.totals.profit)])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perf), 'Monthly Performance')

  const closing = opening + c.totals.revenue - c.totals.totalExp
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Cashflow', 'MVR'], ['Opening balance at bank', r2(opening)], ['Total revenue (cash in)', r2(c.totals.revenue)],
    ['Total expenses (cash out)', r2(c.totals.totalExp)], ['Closing balance at bank', r2(closing)],
  ]), 'Cashflow')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Inventory', 'Value'], ['Opening inventory value', r2(c.inventory.openingInv)], ['Purchases during period', r2(c.inventory.purchasesVal)],
    ['Cost of goods sold', r2(c.inventory.cogs)], ['Closing inventory value', r2(c.inventory.closing)],
    ['Stock turn', r2(c.inventory.turn) + '×'], ['How long to sell (days)', Math.round(c.inventory.days)],
  ]), 'Inventory')

  const adv = [['Advertising platform / category', 'Spent']]
  c.adBreakdown.forEach(([cat, amt]) => adv.push([cat, r2(amt)]))
  adv.push(['Total', r2(c.totals.ad)])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(adv), 'Advertising')

  const loanRows = [['Lender', 'Used for', 'Taken on', 'Amount', 'Monthly', 'Paid', 'Left']]
  c.loanRows.forEach(l => loanRows.push([l.lender || '', l.purpose || '', l.taken_on || '', r2(l.amount), r2(l.monthly_payment), r2(l.paid), r2(l.remaining)]))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(loanRows), 'Loans')

  const prod = [['Product', 'Category', 'Sold', 'In stock', 'Spent on stock', 'Revenue', 'Profit', 'Cost covered?']]
  c.productAnalysis.forEach(r => prod.push([r.name, r.category, r.soldQty, r.stock, r2(r.spent), r2(r.revenue), r2(r.profit), r.covered ? 'Yes' : 'Not yet']))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prod), 'Products')

  const cat = [['Category', 'Products', 'Spent on stock', 'Revenue', 'Profit', 'Cost covered?']]
  c.categorySummary.forEach(r => cat.push([r.category, r.items, r2(r.spent), r2(r.revenue), r2(r.profit), r.covered ? 'Yes' : 'Not yet']))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cat), 'Categories')

  const today = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `bricks-and-joy-business-sheet-${today}.xlsx`)
}
