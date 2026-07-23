import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localToday } from '../lib/dates'
import { PageHeader, Card, Button, Input, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, Landmark, TrendingUp, Wallet, Boxes, Megaphone, Package, CheckCircle2, XCircle, CreditCard } from 'lucide-react'

const AD_CATS = ['Meta Ads', 'Promotions', 'Sponsorship']
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const money = n => `MVR ${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const money0 = n => `MVR ${Math.round(num(n)).toLocaleString('en-US')}`
const monthLabel = m => new Date(m + '-01T00:00:00').toLocaleDateString('en', { month: 'short', year: '2-digit' })
const OPEN_KEY = 'bnj_opening_balance'

export default function BusinessSheet() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [expenses, setExpenses] = useState([])
  const [purchases, setPurchases] = useState([])
  const [loans, setLoans] = useState([])
  const [loanPays, setLoanPays] = useState([])
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(() => { try { return parseFloat(localStorage.getItem(OPEN_KEY)) || 0 } catch { return 0 } })

  const [loanModal, setLoanModal] = useState(false)
  const [loanForm, setLoanForm] = useState({ lender: '', amount: '', purpose: '', monthly_payment: '', taken_on: localToday(), notes: '' })
  const [payModal, setPayModal] = useState(null) // the loan being paid
  const [payForm, setPayForm] = useState({ amount: '', paid_on: localToday(), notes: '' })
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, p, e, po, l, lp] = await Promise.all([
      supabase.from('orders').select('*'),
      supabase.from('products').select('id, name, category, cost_price, sell_price, stock_qty, discontinued'),
      supabase.from('expenses').select('*'),
      supabase.from('purchase_orders').select('*'),
      supabase.from('loans').select('*').order('taken_on', { ascending: false }),
      supabase.from('loan_payments').select('*'),
    ])
    setOrders(o.data || []); setProducts(p.data || []); setExpenses(e.data || [])
    setPurchases(po.data || []); setLoans(l.data || []); setLoanPays(lp.data || [])
    setLoading(false)
  }

  function saveOpening(v) { setOpening(v); try { localStorage.setItem(OPEN_KEY, String(v)) } catch {} }

  const costOf = useMemo(() => { const m = {}; products.forEach(p => { m[p.id] = num(p.cost_price) }); return m }, [products])
  const liveOrders = useMemo(() => orders.filter(o => o.status !== 'cancelled'), [orders])

  // ── monthly performance ───────────────────────────────────────────────────────
  const monthly = useMemo(() => {
    const keys = new Set()
    liveOrders.forEach(o => o.order_date && keys.add(o.order_date.slice(0, 7)))
    expenses.forEach(e => e.expense_date && keys.add(e.expense_date.slice(0, 7)))
    loanPays.forEach(lp => lp.paid_on && keys.add(lp.paid_on.slice(0, 7)))
    const months = [...keys].sort()
    return months.map(m => {
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
  }, [liveOrders, expenses, loanPays, costOf])

  const totals = useMemo(() => monthly.reduce((t, r) => ({
    orders: t.orders + r.orders, revenue: t.revenue + r.revenue, cogs: t.cogs + r.cogs,
    ad: t.ad + r.ad, other: t.other + r.other, loan: t.loan + r.loan, totalExp: t.totalExp + r.totalExp, profit: t.profit + r.profit,
  }), { orders: 0, revenue: 0, cogs: 0, ad: 0, other: 0, loan: 0, totalExp: 0, profit: 0 }), [monthly])

  // ── inventory ─────────────────────────────────────────────────────────────────
  const inv = useMemo(() => {
    const closing = products.filter(p => !p.discontinued).reduce((s, p) => s + num(p.cost_price) * (parseInt(p.stock_qty) || 0), 0)
    const purchasesVal = purchases.reduce((s, po) => s + num(po.total_cost || (num(po.unit_cost) * (parseInt(po.qty) || 0))), 0)
    const cogs = totals.cogs
    const openingInv = closing + cogs - purchasesVal
    const avg = (openingInv + closing) / 2
    const turn = avg > 0 ? cogs / avg : 0
    const days = turn > 0 ? 365 / turn : 0
    return { closing, purchasesVal, cogs, openingInv, turn, days }
  }, [products, purchases, totals.cogs])

  // ── advertising ───────────────────────────────────────────────────────────────
  const adBreakdown = useMemo(() => {
    const map = {}
    expenses.filter(e => AD_CATS.includes(e.category)).forEach(e => { map[e.category] = (map[e.category] || 0) + num(e.amount) })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [expenses])

  // ── product-wise analysis ───────────────────────────────────────────────────────
  const productAnalysis = useMemo(() => {
    const map = {}
    liveOrders.forEach(o => {
      if (!o.product_id) return
      const k = o.product_id
      if (!map[k]) map[k] = { id: k, name: o.product_name, soldQty: 0, revenue: 0 }
      map[k].soldQty += parseInt(o.qty) || 0
      map[k].revenue += num(o.total_price)
    })
    return products.map(p => {
      const s = map[p.id] || { soldQty: 0, revenue: 0 }
      const unitCost = num(p.cost_price)
      const stock = parseInt(p.stock_qty) || 0
      const acquired = s.soldQty + stock            // units you've bought over time
      const spent = unitCost * acquired             // money put into this product's stock
      const cogs = unitCost * s.soldQty
      const profit = s.revenue - cogs
      const covered = spent > 0 ? s.revenue >= spent : s.revenue > 0
      return { id: p.id, name: p.name, category: p.category || '—', soldQty: s.soldQty, stock, revenue: s.revenue, unitCost, spent, cogs, profit, covered }
    }).filter(r => r.soldQty > 0 || r.stock > 0).sort((a, b) => b.revenue - a.revenue)
  }, [liveOrders, products])

  const categorySummary = useMemo(() => {
    const map = {}
    productAnalysis.forEach(r => {
      if (!map[r.category]) map[r.category] = { category: r.category, spent: 0, revenue: 0, profit: 0, items: 0 }
      const c = map[r.category]; c.spent += r.spent; c.revenue += r.revenue; c.profit += r.profit; c.items += 1
    })
    return Object.values(map).map(c => ({ ...c, covered: c.revenue >= c.spent })).sort((a, b) => b.revenue - a.revenue)
  }, [productAnalysis])

  // ── loans ─────────────────────────────────────────────────────────────────────
  const loanRows = useMemo(() => loans.map(l => {
    const paid = loanPays.filter(lp => lp.loan_id === l.id).reduce((s, lp) => s + num(lp.amount), 0)
    return { ...l, paid, remaining: Math.max(0, num(l.amount) - paid) }
  }), [loans, loanPays])
  const loanTotals = loanRows.reduce((t, l) => ({ amount: t.amount + num(l.amount), paid: t.paid + l.paid, remaining: t.remaining + l.remaining, monthly: t.monthly + num(l.monthly_payment) }), { amount: 0, paid: 0, remaining: 0, monthly: 0 })

  async function saveLoan() {
    if (!loanForm.amount) { toast.error('Enter the loan amount'); return }
    setSaving(true)
    const { error } = await supabase.from('loans').insert({
      lender: loanForm.lender || null, amount: num(loanForm.amount), purpose: loanForm.purpose || null,
      monthly_payment: num(loanForm.monthly_payment), taken_on: loanForm.taken_on, notes: loanForm.notes || null,
    })
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Loan added'); setLoanModal(false)
    setLoanForm({ lender: '', amount: '', purpose: '', monthly_payment: '', taken_on: localToday(), notes: '' })
    load()
  }
  async function savePayment() {
    if (!payForm.amount) { toast.error('Enter the amount'); return }
    setSaving(true)
    const { error } = await supabase.from('loan_payments').insert({ loan_id: payModal.id, amount: num(payForm.amount), paid_on: payForm.paid_on, notes: payForm.notes || null })
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Payment recorded'); setPayModal(null); setPayForm({ amount: '', paid_on: localToday(), notes: '' })
    load()
  }
  async function delLoan(l) { if (!window.confirm(`Delete the loan "${l.purpose || l.lender || 'loan'}" and its payments?`)) return; await supabase.from('loans').delete().eq('id', l.id); toast.success('Deleted'); load() }

  const closing = opening + totals.revenue - totals.totalExp

  if (loading) return <div><PageHeader title="Business Sheet" subtitle="Yearly performance, cashflow, inventory, loans & product analysis" /><Spinner /></div>

  return (
    <div>
      <style>{`
        .bs-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        table.bs { width:100%; border-collapse:collapse; font-size:12.5px; min-width:820px; }
        .bs th { text-align:right; font-size:10.5px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.4px; padding:9px 10px; border-bottom:2px solid #f0f0f0; white-space:nowrap; }
        .bs th:first-child, .bs td:first-child { text-align:left; }
        .bs td { padding:8px 10px; border-bottom:1px solid #f5f5f5; text-align:right; white-space:nowrap; color:#333; }
        .bs tfoot td { border-top:2px solid #eee; font-weight:800; color:#0d1b2a; }
        .bs .neg { color:#E24B4A; }
        .bs .pos { color:#1D9E75; }
        .bs-cards { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:22px; }
        @media(max-width:800px){ .bs-cards { grid-template-columns:1fr 1fr; } }
        .bs-metric { border-radius:14px; padding:16px 18px; }
        .bs-metric .v { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
        .bs-metric .l { font-size:12px; color:#888; font-weight:600; margin-top:3px; }
        .bs-two { display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start; }
        @media(max-width:900px){ .bs-two { grid-template-columns:1fr; } }
      `}</style>

      <PageHeader title="Business Sheet" subtitle="Yearly performance, cashflow, inventory, loans & product cost-coverage" />

      {/* headline metrics */}
      <div className="bs-cards">
        <div className="bs-metric" style={{ background: '#E9F7F1' }}><div className="v" style={{ color: '#1D9E75' }}>{money0(totals.revenue)}</div><div className="l">Total revenue · {totals.orders} orders</div></div>
        <div className="bs-metric" style={{ background: '#FDECEC' }}><div className="v" style={{ color: '#E24B4A' }}>{money0(totals.totalExp)}</div><div className="l">Total expenses</div></div>
        <div className="bs-metric" style={{ background: totals.profit >= 0 ? '#E9F7F1' : '#FDECEC' }}><div className="v" style={{ color: totals.profit >= 0 ? '#1D9E75' : '#E24B4A' }}>{money0(totals.profit)}</div><div className="l">Net profit</div></div>
        <div className="bs-metric" style={{ background: '#EAF2FD' }}><div className="v" style={{ color: '#2f6fc0' }}>{money0(closing)}</div><div className="l">Closing bank balance</div></div>
      </div>

      {/* monthly performance */}
      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}><TrendingUp size={17} color="#FFA500" /> Monthly performance</h3>
        <div className="bs-scroll">
          <table className="bs">
            <thead><tr>
              <th>Month</th><th>Orders</th><th>Revenue</th><th>Cost of sales</th><th>Advertising</th><th>Other costs</th><th>Loan</th><th>Total exp</th><th>Profit</th>
            </tr></thead>
            <tbody>
              {monthly.map(r => (
                <tr key={r.m}>
                  <td>{monthLabel(r.m)}</td><td>{r.orders}</td><td>{money(r.revenue)}</td><td>{money(r.cogs)}</td>
                  <td>{money(r.ad)}</td><td>{money(r.other)}</td><td>{money(r.loan)}</td><td>{money(r.totalExp)}</td>
                  <td className={r.profit >= 0 ? 'pos' : 'neg'}>{money(r.profit)}</td>
                </tr>
              ))}
              {monthly.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>No orders or expenses yet.</td></tr>}
            </tbody>
            {monthly.length > 0 && <tfoot><tr>
              <td>Total</td><td>{totals.orders}</td><td>{money(totals.revenue)}</td><td>{money(totals.cogs)}</td>
              <td>{money(totals.ad)}</td><td>{money(totals.other)}</td><td>{money(totals.loan)}</td><td>{money(totals.totalExp)}</td>
              <td className={totals.profit >= 0 ? 'pos' : 'neg'}>{money(totals.profit)}</td>
            </tr></tfoot>}
          </table>
        </div>
      </Card>

      <div className="bs-two" style={{ marginBottom: 20 }}>
        {/* cashflow */}
        <Card>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}><Wallet size={17} color="#FFA500" /> Cashflow</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f2f2f2' }}>
            <span style={{ color: '#667' }}>Opening balance at bank</span>
            <input type="number" value={opening} onChange={e => saveOpening(parseFloat(e.target.value) || 0)}
              style={{ width: 130, textAlign: 'right', padding: '6px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
          </div>
          <Row label="Total revenue (cash in)" value={money(totals.revenue)} color="#1D9E75" />
          <Row label="Total expenses (cash out)" value={'− ' + money(totals.totalExp)} color="#E24B4A" />
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 2px', marginTop: 6, borderTop: '2px solid #eee', fontWeight: 800, fontSize: 16 }}>
            <span>Closing balance at bank</span><span style={{ color: closing >= 0 ? '#2f6fc0' : '#E24B4A' }}>{money(closing)}</span>
          </div>
          <p style={{ fontSize: 11.5, color: '#aaa', marginTop: 10 }}>Set your bank opening balance above; it's saved on this device.</p>
        </Card>

        {/* inventory */}
        <Card>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}><Boxes size={17} color="#FFA500" /> Inventory</h3>
          <Row label="Opening inventory value" value={money(inv.openingInv)} />
          <Row label="Purchases during period" value={money(inv.purchasesVal)} />
          <Row label="Cost of goods sold" value={money(inv.cogs)} />
          <Row label="Closing inventory value" value={money(inv.closing)} bold />
          <Row label="Stock turn" value={`${inv.turn.toFixed(2)}×`} />
          <Row label="How long to sell (days)" value={`${Math.round(inv.days)} days`} />
          <p style={{ fontSize: 11.5, color: '#aaa', marginTop: 10 }}>Closing value = current stock × cost price. Opening is derived (closing + COGS − purchases).</p>
        </Card>
      </div>

      {/* advertising */}
      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}><Megaphone size={17} color="#FFA500" /> Advertising spend</h3>
        {adBreakdown.length === 0 ? <p style={{ color: '#aaa', fontSize: 13 }}>No advertising costs logged yet (categories: {AD_CATS.join(', ')}).</p> : (
          <>
            {adBreakdown.map(([cat, amt]) => (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span style={{ fontWeight: 500 }}>{cat}</span><span style={{ fontWeight: 600, color: '#E24B4A' }}>{money(amt)}</span></div>
                <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3 }}><div style={{ width: `${totals.ad > 0 ? amt / totals.ad * 100 : 0}%`, height: '100%', background: '#FFA500', borderRadius: 3 }} /></div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 10, borderTop: '1px solid #eee', fontWeight: 700 }}>
              <span>Total ad spend</span><span>{money(totals.ad)}</span>
            </div>
            <p style={{ fontSize: 11.5, color: '#aaa', marginTop: 8 }}>Return on ad spend: revenue {money(totals.revenue)} vs ad spend {money(totals.ad)} = <b>{totals.ad > 0 ? (totals.revenue / totals.ad).toFixed(1) + '×' : '—'}</b></p>
          </>
        )}
      </Card>

      {/* loans */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Landmark size={17} color="#FFA500" /> Loans</h3>
          <Button onClick={() => setLoanModal(true)}><Plus size={15} /> Add loan</Button>
        </div>
        {loanRows.length === 0 ? <p style={{ color: '#aaa', fontSize: 13 }}>No loans recorded. Add one to track what you took, what you spent it on, and how much is left.</p> : (
          <div className="bs-scroll">
            <table className="bs" style={{ minWidth: 720 }}>
              <thead><tr><th>Lender</th><th>Used for</th><th>Taken</th><th>Amount</th><th>Monthly</th><th>Paid</th><th>Left</th><th></th></tr></thead>
              <tbody>
                {loanRows.map(l => (
                  <tr key={l.id}>
                    <td>{l.lender || '—'}</td>
                    <td style={{ maxWidth: 220, whiteSpace: 'normal' }}>{l.purpose || '—'}</td>
                    <td>{l.taken_on || '—'}</td>
                    <td>{money(l.amount)}</td>
                    <td>{money(l.monthly_payment)}</td>
                    <td className="pos">{money(l.paid)}</td>
                    <td className={l.remaining > 0 ? 'neg' : 'pos'}>{money(l.remaining)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Button variant="ghost" size="sm" onClick={() => { setPayForm({ amount: l.monthly_payment || '', paid_on: localToday(), notes: '' }); setPayModal(l) }}><CreditCard size={13} /> Pay</Button>
                      <Button variant="danger" size="sm" onClick={() => delLoan(l)} style={{ marginLeft: 4 }}><Trash2 size={13} /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total</td><td>{money(loanTotals.amount)}</td><td>{money(loanTotals.monthly)}</td><td className="pos">{money(loanTotals.paid)}</td><td className={loanTotals.remaining > 0 ? 'neg' : 'pos'}>{money(loanTotals.remaining)}</td><td></td></tr></tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* category summary */}
      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}><Package size={17} color="#FFA500" /> By category — is the cost covered?</h3>
        <div className="bs-scroll">
          <table className="bs" style={{ minWidth: 640 }}>
            <thead><tr><th>Category</th><th>Products</th><th>Spent on stock</th><th>Revenue</th><th>Profit</th><th>Status</th></tr></thead>
            <tbody>
              {categorySummary.map(c => (
                <tr key={c.category}>
                  <td>{c.category}</td><td>{c.items}</td><td>{money(c.spent)}</td><td>{money(c.revenue)}</td>
                  <td className={c.profit >= 0 ? 'pos' : 'neg'}>{money(c.profit)}</td>
                  <td>{c.covered ? <Badge color="green">Covered</Badge> : <Badge color="red">Not yet</Badge>}</td>
                </tr>
              ))}
              {categorySummary.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: 20 }}>No products yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* product-wise */}
      <Card>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}><Package size={17} color="#FFA500" /> Product-wise analysis</h3>
        <p style={{ fontSize: 12, color: '#999', margin: '0 0 14px' }}>"Spent on stock" = cost price × all units bought. "Covered" means sales have earned back what you put into that product.</p>
        <div className="bs-scroll">
          <table className="bs" style={{ minWidth: 780 }}>
            <thead><tr><th>Product</th><th>Category</th><th>Sold</th><th>In stock</th><th>Spent on stock</th><th>Revenue</th><th>Profit</th><th>Covered</th></tr></thead>
            <tbody>
              {productAnalysis.map(r => (
                <tr key={r.id}>
                  <td style={{ maxWidth: 220, whiteSpace: 'normal' }}>{r.name}</td>
                  <td>{r.category}</td><td>{r.soldQty}</td><td>{r.stock}</td>
                  <td>{money(r.spent)}</td><td>{money(r.revenue)}</td>
                  <td className={r.profit >= 0 ? 'pos' : 'neg'}>{money(r.profit)}</td>
                  <td>{r.covered ? <CheckCircle2 size={16} color="#1D9E75" /> : <XCircle size={16} color="#E24B4A" />}</td>
                </tr>
              ))}
              {productAnalysis.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#aaa', padding: 20 }}>No product data yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* add loan modal */}
      {loanModal && (
        <Modal title="Add a loan" subtitle="Track what you took and what it was for" onClose={() => setLoanModal(false)}>
          <FormRow>
            <Input label="Lender / source" value={loanForm.lender} onChange={e => setLoanForm(f => ({ ...f, lender: e.target.value }))} placeholder="e.g. BML, family" />
            <Input label="Amount (MVR) *" type="number" value={loanForm.amount} onChange={e => setLoanForm(f => ({ ...f, amount: e.target.value }))} />
          </FormRow>
          <FormRow>
            <Input label="Monthly payment (MVR)" type="number" value={loanForm.monthly_payment} onChange={e => setLoanForm(f => ({ ...f, monthly_payment: e.target.value }))} />
            <Input label="Taken on" type="date" value={loanForm.taken_on} onChange={e => setLoanForm(f => ({ ...f, taken_on: e.target.value }))} />
          </FormRow>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>What did you use it for?</label>
            <textarea value={loanForm.purpose} onChange={e => setLoanForm(f => ({ ...f, purpose: e.target.value }))} rows={2} placeholder="e.g. Stock purchase for Eid, new shelves"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setLoanModal(false)}>Cancel</Button>
            <Button onClick={saveLoan} disabled={saving || !loanForm.amount}>{saving ? 'Saving…' : 'Add loan'}</Button>
          </div>
        </Modal>
      )}

      {/* record payment modal */}
      {payModal && (
        <Modal title="Record a payment" subtitle={payModal.purpose || payModal.lender || 'Loan repayment'} onClose={() => setPayModal(null)}>
          <FormRow>
            <Input label="Amount (MVR) *" type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            <Input label="Paid on" type="date" value={payForm.paid_on} onChange={e => setPayForm(f => ({ ...f, paid_on: e.target.value }))} />
          </FormRow>
          <Input label="Note (optional)" value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} style={{ marginBottom: 16 }} />
          <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#667' }}>
            Remaining after this: <b>{money(Math.max(0, num(payModal.amount) - loanPays.filter(lp => lp.loan_id === payModal.id).reduce((s, lp) => s + num(lp.amount), 0) - num(payForm.amount)))}</b>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setPayModal(null)}>Cancel</Button>
            <Button onClick={savePayment} disabled={saving || !payForm.amount}>{saving ? 'Saving…' : 'Record payment'}</Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}

function Row({ label, value, color, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f5f5f5' }}>
      <span style={{ color: '#667' }}>{label}</span>
      <span style={{ fontWeight: bold ? 800 : 600, color: color || '#0d1b2a' }}>{value}</span>
    </div>
  )
}
