import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner } from '../components/UI'
import { FileText, BookOpen, Calendar, Download, TrendingUp, TrendingDown } from 'lucide-react'

const MVR_RATE = 15.4

export default function Accounting() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [expenses, setExpenses] = useState([])
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('income')
  const [periodFilter, setPeriodFilter] = useState('all')
  const [currency, setCurrency] = useState('MVR')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, p, e, po, c] = await Promise.all([
      supabase.from('orders').select('*').order('order_date'),
      supabase.from('products').select('id, name, cost_price'),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
      supabase.from('purchase_orders').select('*'),
      supabase.from('customers').select('*'),
    ])
    setOrders(o.data || [])
    setProducts(p.data || [])
    setExpenses(e.data || [])
    setPurchaseOrders(po.data || [])
    setCustomers(c.data || [])
    setLoading(false)
  }

  const fmt = v => currency === 'MVR' ? `MVR ${Number(v).toFixed(2)}` : `USD ${(Number(v) / MVR_RATE).toFixed(2)}`

  const allMonths = [...new Set([
    ...orders.map(o => o.order_date?.slice(0, 7)),
    ...expenses.map(e => e.expense_date?.slice(0, 7)),
  ].filter(Boolean))].sort().reverse()

  const inPeriod = date => periodFilter === 'all' || (date && date.startsWith(periodFilter))

  // Calculations
  const delivered = orders.filter(o => o.status === 'delivered' && inPeriod(o.order_date))
  const revenue = delivered.reduce((s, o) => s + Number(o.total_price || 0), 0)
  const cogs = delivered.reduce((s, o) => {
    const p = products.find(p => p.id === o.product_id)
    return s + (p ? o.qty * Number(p.cost_price) : 0)
  }, 0)
  const grossProfit = revenue - cogs
  const periodExp = expenses.filter(e => inPeriod(e.expense_date))
  const expByCat = {}
  periodExp.forEach(e => { expByCat[e.category] = (expByCat[e.category] || 0) + Number(e.amount) })
  const totalOpEx = Object.values(expByCat).reduce((s, v) => s + v, 0)
  const netIncome = grossProfit - totalOpEx
  const grossMargin = revenue > 0 ? (grossProfit / revenue * 100).toFixed(1) : '0.0'
  const netMargin = revenue > 0 ? (netIncome / revenue * 100).toFixed(1) : '0.0'

  // Monthly data
  const last6 = allMonths.slice(0, 6).reverse()
  const monthlyMatrix = {}
  expenses.forEach(e => {
    const m = e.expense_date?.slice(0, 7)
    if (!m) return
    if (!monthlyMatrix[e.category]) monthlyMatrix[e.category] = {}
    monthlyMatrix[e.category][m] = (monthlyMatrix[e.category][m] || 0) + Number(e.amount)
  })
  const monthlyRevenue = {}
  orders.filter(o => o.status === 'delivered').forEach(o => {
    const m = o.order_date?.slice(0, 7)
    if (m) monthlyRevenue[m] = (monthlyRevenue[m] || 0) + Number(o.total_price || 0)
  })

  // Journal
  const journal = []
  orders.filter(o => o.status === 'delivered').forEach(o => {
    const amt = Number(o.total_price || 0)
    const p = products.find(p => p.id === o.product_id)
    const cost = p ? o.qty * Number(p.cost_price) : 0
    journal.push({
      date: o.order_date, ref: `SALE-${o.id?.slice(0, 6)}`,
      desc: `Sale: ${o.product_name} ×${o.qty} to ${o.customer_name || 'Walk-in'}`,
      entries: [
        { account: 'Cash / Accounts Receivable', debit: amt, credit: 0 },
        { account: 'Sales Revenue', debit: 0, credit: amt },
        ...(cost > 0 ? [
          { account: 'Cost of Goods Sold', debit: cost, credit: 0 },
          { account: 'Inventory', debit: 0, credit: cost },
        ] : [])
      ]
    })
  })
  expenses.forEach(e => {
    journal.push({
      date: e.expense_date, ref: `EXP-${e.id?.slice(0, 6)}`,
      desc: e.description,
      entries: [
        { account: `${e.category} Expense`, debit: Number(e.amount), credit: 0 },
        { account: 'Cash', debit: 0, credit: Number(e.amount) },
      ]
    })
  })
  purchaseOrders.filter(po => po.status === 'received').forEach(po => {
    const amt = Number(po.total_cost || 0)
    journal.push({
      date: po.order_date, ref: `PO-${po.id?.slice(0, 6)}`,
      desc: `Purchase: ${po.product_name} ×${po.qty} from ${po.supplier_name || 'Supplier'}`,
      entries: [
        { account: 'Inventory', debit: amt, credit: 0 },
        { account: 'Cash / Accounts Payable', debit: 0, credit: amt },
      ]
    })
  })
  journal.sort((a, b) => new Date(b.date) - new Date(a.date))
  const journalFiltered = journal.filter(j => inPeriod(j.date))

  const mLabel = m => new Date(m + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' })
  const periodLabel = periodFilter === 'all' ? 'All time' : new Date(periodFilter + '-01').toLocaleDateString('en', { month: 'long', year: 'numeric' })
  const companyName = "Brick's & Joy"

  // ── DOWNLOAD HELPERS ──────────────────────────────────────────────────────
  function downloadCSV(filename, headers, rows) {
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  }

  function downloadIncomeStatementCSV() {
    downloadCSV(`income-statement-${periodFilter}.csv`,
      ['Item', 'Amount (MVR)', 'Amount (USD)'],
      [
        ['Gross Revenue', revenue.toFixed(2), (revenue / MVR_RATE).toFixed(2)],
        ['Cost of Goods Sold', (-cogs).toFixed(2), (-cogs / MVR_RATE).toFixed(2)],
        ['Gross Profit', grossProfit.toFixed(2), (grossProfit / MVR_RATE).toFixed(2)],
        ['Gross Margin %', grossMargin + '%', grossMargin + '%'],
        ...Object.entries(expByCat).map(([cat, amt]) => [cat + ' Expense', (-amt).toFixed(2), (-amt / MVR_RATE).toFixed(2)]),
        ['Total Operating Expenses', (-totalOpEx).toFixed(2), (-totalOpEx / MVR_RATE).toFixed(2)],
        ['Net Income', netIncome.toFixed(2), (netIncome / MVR_RATE).toFixed(2)],
        ['Net Margin %', netMargin + '%', netMargin + '%'],
      ]
    )
  }

  function downloadJournalCSV() {
    const rows = []
    journalFiltered.forEach(j => {
      j.entries.forEach(e => {
        rows.push([j.date, j.ref, j.desc, e.account, e.debit > 0 ? e.debit.toFixed(2) : '', e.credit > 0 ? e.credit.toFixed(2) : ''])
      })
    })
    downloadCSV(`journal-${periodFilter}.csv`, ['Date', 'Reference', 'Description', 'Account', 'Debit (MVR)', 'Credit (MVR)'], rows)
  }

  function downloadMonthlyCostsCSV() {
    const cats = Object.keys(monthlyMatrix)
    const months = last6
    const rows = cats.map(cat => [
      cat,
      ...months.map(m => (monthlyMatrix[cat]?.[m] || 0).toFixed(2)),
      Object.values(monthlyMatrix[cat] || {}).reduce((s, v) => s + v, 0).toFixed(2)
    ])
    downloadCSV('monthly-costs.csv', ['Category', ...months.map(mLabel), 'Total'], rows)
  }

  function downloadOrdersCSV() {
    downloadCSV(`orders-${periodFilter}.csv`,
      ['Date', 'Customer', 'Product', 'Qty', 'Unit Price (MVR)', 'Total (MVR)', 'Channel', 'Status'],
      orders.filter(o => inPeriod(o.order_date)).map(o => [
        o.order_date, o.customer_name || 'Walk-in', o.product_name,
        o.qty, Number(o.unit_price).toFixed(2), Number(o.total_price || 0).toFixed(2),
        o.channel, o.status
      ])
    )
  }

  function downloadCostsCSV() {
    downloadCSV(`costs-${periodFilter}.csv`,
      ['Date', 'Description', 'Category', 'Amount (MVR)', 'Amount (USD)'],
      periodExp.map(e => [
        e.expense_date, e.description, e.category,
        Number(e.amount).toFixed(2), (Number(e.amount) / MVR_RATE).toFixed(2)
      ])
    )
  }

  function downloadCustomersCSV() {
    downloadCSV('customers.csv',
      ['Name', 'Username/Instagram', 'Phone', 'Address'],
      customers.map(c => [c.name, c.email || '', c.phone || '', c.address || ''])
    )
  }

  function printIncomeStatement() {
    const w = window.open('', '_blank')
    w.document.write(`
      <html><head><title>Income Statement - ${companyName}</title>
      <style>
        body { font-family: 'Poppins', Arial, sans-serif; max-width: 600px; margin: 40px auto; color: #111; font-size: 13px; }
        h1 { font-size: 20px; margin: 0; } h2 { font-size: 14px; color: #555; margin: 4px 0 0; font-weight: 400; }
        .period { font-size: 12px; color: #999; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
        td { padding: 7px 0; border-bottom: 1px solid #f0f0f0; }
        td:last-child { text-align: right; font-weight: 600; }
        .section { font-weight: 700; color: #333; padding-top: 16px; border-bottom: 2px solid #333 !important; }
        .indent td:first-child { padding-left: 20px; color: #555; }
        .total td { font-weight: 800; font-size: 15px; border-top: 2px solid #111; border-bottom: none; padding-top: 12px; }
        .subtotal td { font-weight: 700; border-top: 1px solid #333; }
        .red { color: #c62828; } .green { color: #1D9E75; }
        @media print { body { margin: 20px; } }
      </style></head><body>
      <h1>${companyName}</h1>
      <h2>Income Statement</h2>
      <div class="period">${periodLabel} · Generated ${new Date().toLocaleDateString()}</div>
      <table>
        <tr class="section"><td>REVENUE</td><td></td></tr>
        <tr class="indent"><td>Sales Revenue</td><td>MVR ${revenue.toFixed(2)}</td></tr>
        <tr class="subtotal"><td>Total Revenue</td><td>MVR ${revenue.toFixed(2)}</td></tr>
        <tr class="section"><td>COST OF GOODS SOLD</td><td></td></tr>
        <tr class="indent"><td>Cost of Goods Sold</td><td class="red">(MVR ${cogs.toFixed(2)})</td></tr>
        <tr class="subtotal"><td>GROSS PROFIT <span style="font-weight:400;font-size:11px">(${grossMargin}% margin)</span></td><td class="${grossProfit >= 0 ? 'green' : 'red'}">MVR ${grossProfit.toFixed(2)}</td></tr>
        <tr class="section"><td>OPERATING EXPENSES</td><td></td></tr>
        ${Object.entries(expByCat).map(([cat, amt]) => `<tr class="indent"><td>${cat}</td><td class="red">(MVR ${amt.toFixed(2)})</td></tr>`).join('')}
        ${Object.keys(expByCat).length === 0 ? '<tr class="indent"><td>No expenses</td><td>—</td></tr>' : ''}
        <tr class="subtotal"><td>Total Operating Expenses</td><td class="red">(MVR ${totalOpEx.toFixed(2)})</td></tr>
        <tr class="total"><td>NET INCOME <span style="font-weight:400;font-size:11px">(${netMargin}% margin)</span></td><td class="${netIncome >= 0 ? 'green' : 'red'}">MVR ${netIncome.toFixed(2)}</td></tr>
      </table>
      <div style="font-size:11px;color:#aaa;margin-top:20px;border-top:1px solid #eee;padding-top:10px">
        Rate: 1 USD = ${MVR_RATE} MVR · Revenue recognized on delivered orders only
      </div>
      <script>window.onload = () => window.print()</script>
      </body></html>`)
    w.document.close()
  }

  if (loading) return <Spinner />

  return (
    <div>
      <style>{`
        .acc-tabs { display: flex; gap: 0; background: #f0f0f0; border-radius: 10px; padding: 4px; margin-bottom: 20px; width: fit-content; flex-wrap: wrap; }
        .acc-tab { padding: 8px 18px; border-radius: 7px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit; transition: all 0.15s; display: flex; align-items: center; gap: 6px; }
        .dl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
        .dl-card { background: #fff; border: 1px solid #eee; border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; cursor: pointer; transition: all 0.15s; }
        .dl-card:hover { border-color: #FFA500; box-shadow: 0 2px 12px rgba(255,165,0,0.12); }
        .is-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .is-table td { padding: 9px 12px; }
        .matrix-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .matrix-table th { padding: 8px 10px; text-align: right; font-size: 11px; color: #999; border-bottom: 2px solid #eee; font-weight: 600; white-space: nowrap; }
        .matrix-table th:first-child { text-align: left; }
        .matrix-table td { padding: 8px 10px; text-align: right; border-bottom: 1px solid #f5f5f5; white-space: nowrap; }
        .matrix-table td:first-child { text-align: left; font-weight: 500; }
        .currency-toggle { display: flex; background: #f0f0f0; border-radius: 8px; padding: 3px; }
        .currency-btn { padding: 6px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.15s; font-family: inherit; }
        @media (max-width: 768px) { .acc-tabs { width: 100%; } .matrix-wrap { overflow-x: auto; } }
      `}</style>

      <PageHeader
        title="Accounting"
        subtitle="Income statement, journal, monthly reports & downloadable documents"
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}
              style={{ padding: '7px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
              <option value="all">All time</option>
              {allMonths.map(m => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en', { month: 'long', year: 'numeric' })}</option>)}
            </select>
            <div className="currency-toggle">
              <button className="currency-btn" onClick={() => setCurrency('MVR')} style={{ background: currency === 'MVR' ? '#fff' : 'transparent', color: currency === 'MVR' ? '#0d1b2a' : '#888', boxShadow: currency === 'MVR' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>MVR</button>
              <button className="currency-btn" onClick={() => setCurrency('USD')} style={{ background: currency === 'USD' ? '#fff' : 'transparent', color: currency === 'USD' ? '#0d1b2a' : '#888', boxShadow: currency === 'USD' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>USD</button>
            </div>
          </div>
        }
      />

      {/* Tabs */}
      <div className="acc-tabs">
        {[['income', 'Income Statement', FileText], ['monthly', 'Monthly Reports', Calendar], ['journal', 'Journal', BookOpen], ['download', 'Download Documents', Download]].map(([id, label, Icon]) => (
          <button key={id} className="acc-tab" onClick={() => setActiveTab(id)}
            style={{ background: activeTab === id ? '#fff' : 'transparent', color: activeTab === id ? '#0d1b2a' : '#888', boxShadow: activeTab === id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', fontWeight: activeTab === id ? 700 : 500 }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── INCOME STATEMENT ── */}
      {activeTab === 'income' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Card style={{ maxWidth: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid #0d1b2a' }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#0d1b2a' }}>{companyName}</div>
                <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>Income Statement</div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{periodLabel}</div>
              </div>
              <button onClick={printIncomeStatement} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#0d1b2a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
                <Download size={13} /> Print / PDF
              </button>
            </div>
            <table className="is-table">
              <tbody>
                <tr><td style={{ fontWeight: 700, color: '#0d1b2a' }}>REVENUE</td><td></td></tr>
                <tr><td style={{ paddingLeft: 24 }}>Sales Revenue</td><td style={{ textAlign: 'right', fontWeight: 500 }}>{fmt(revenue)}</td></tr>
                <tr style={{ borderTop: '1px solid #eee' }}><td style={{ fontWeight: 600 }}>Total Revenue</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(revenue)}</td></tr>
                <tr><td style={{ fontWeight: 700, color: '#0d1b2a', paddingTop: 16 }}>COST OF GOODS SOLD</td><td></td></tr>
                <tr><td style={{ paddingLeft: 24 }}>Cost of Goods Sold</td><td style={{ textAlign: 'right', color: '#c62828' }}>({fmt(cogs)})</td></tr>
                <tr style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ fontWeight: 700 }}>GROSS PROFIT <span style={{ fontWeight: 400, fontSize: 11, color: '#999' }}>({grossMargin}%)</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: grossProfit >= 0 ? '#1D9E75' : '#c62828' }}>{fmt(grossProfit)}</td>
                </tr>
                <tr><td style={{ fontWeight: 700, color: '#0d1b2a', paddingTop: 16 }}>OPERATING EXPENSES</td><td></td></tr>
                {Object.entries(expByCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                  <tr key={cat}><td style={{ paddingLeft: 24 }}>{cat}</td><td style={{ textAlign: 'right', color: '#c62828' }}>({fmt(amt)})</td></tr>
                ))}
                {Object.keys(expByCat).length === 0 && <tr><td style={{ paddingLeft: 24, color: '#aaa' }}>No expenses</td><td style={{ textAlign: 'right', color: '#aaa' }}>—</td></tr>}
                <tr style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ fontWeight: 600 }}>Total Operating Expenses</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#c62828' }}>({fmt(totalOpEx)})</td>
                </tr>
                <tr style={{ borderTop: '3px double #0d1b2a' }}>
                  <td style={{ fontWeight: 800, fontSize: 15, paddingTop: 14 }}>NET INCOME <span style={{ fontWeight: 400, fontSize: 11, color: '#999' }}>({netMargin}%)</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 16, paddingTop: 14, color: netIncome >= 0 ? '#1D9E75' : '#c62828' }}>{fmt(netIncome)}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: 16, padding: '8px 12px', background: '#f8f7f4', borderRadius: 8, fontSize: 11, color: '#999', textAlign: 'center' }}>
              Rate: 1 USD = {MVR_RATE} MVR · Revenue recognized on delivered orders
            </div>
          </Card>

          {/* Summary metrics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { label: 'Revenue', val: revenue, color: '#0d1b2a', icon: TrendingUp },
              { label: 'Gross profit', val: grossProfit, color: grossProfit >= 0 ? '#1D9E75' : '#c62828', icon: TrendingUp, sub: `${grossMargin}% margin` },
              { label: 'Operating costs', val: -totalOpEx, color: '#c62828', icon: TrendingDown },
              { label: 'Net income', val: netIncome, color: netIncome >= 0 ? '#1D9E75' : '#c62828', icon: netIncome >= 0 ? TrendingUp : TrendingDown, sub: `${netMargin}% net margin` },
            ].map((m, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: m.color }}>{fmt(Math.abs(m.val))}</div>
                  {m.sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{m.sub}</div>}
                </div>
                <div style={{ background: '#f8f7f4', borderRadius: 10, padding: 10 }}><m.icon size={18} color={m.color} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MONTHLY REPORTS ── */}
      {activeTab === 'monthly' && (
        <>
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#0d1b2a' }}>Monthly costs by category</h3>
                <p style={{ fontSize: 12, color: '#999', margin: '4px 0 0' }}>Last 6 months — in {currency}</p>
              </div>
              <button onClick={downloadMonthlyCostsCSV} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
                <Download size={13} /> Download CSV
              </button>
            </div>
            <div className="matrix-wrap" style={{ overflowX: 'auto' }}>
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    {last6.map(m => <th key={m}>{mLabel(m)}</th>)}
                    <th style={{ borderLeft: '2px solid #eee' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(monthlyMatrix).filter(c => Object.values(monthlyMatrix[c] || {}).some(v => v > 0)).map(cat => {
                    const rowTotal = Object.values(monthlyMatrix[cat] || {}).reduce((s, v) => s + v, 0)
                    return (
                      <tr key={cat}>
                        <td>{cat}</td>
                        {last6.map(m => { const v = monthlyMatrix[cat]?.[m] || 0; return <td key={m} style={{ color: v > 0 ? '#c62828' : '#ccc' }}>{v > 0 ? fmt(v) : '—'}</td> })}
                        <td style={{ fontWeight: 700, color: '#c62828', borderLeft: '2px solid #eee' }}>{fmt(rowTotal)}</td>
                      </tr>
                    )
                  })}
                  <tr style={{ borderTop: '2px solid #0d1b2a' }}>
                    <td style={{ fontWeight: 800 }}>TOTAL</td>
                    {last6.map(m => { const t = Object.values(monthlyMatrix).reduce((s, row) => s + (row[m] || 0), 0); return <td key={m} style={{ fontWeight: 700, color: '#c62828' }}>{t > 0 ? fmt(t) : '—'}</td> })}
                    <td style={{ fontWeight: 800, color: '#c62828', borderLeft: '2px solid #eee' }}>{fmt(Object.values(monthlyMatrix).reduce((s, r) => s + Object.values(r).reduce((a, b) => a + b, 0), 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {expenses.length === 0 && <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No cost data yet.</p>}
          </Card>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#0d1b2a' }}>Monthly summary</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="matrix-table">
                <thead><tr><th>Month</th><th>Revenue</th><th>Costs</th><th>Profit</th></tr></thead>
                <tbody>
                  {last6.slice().reverse().map(m => {
                    const rev = monthlyRevenue[m] || 0
                    const cost = Object.values(monthlyMatrix).reduce((s, row) => s + (row[m] || 0), 0)
                    const profit = rev - cost
                    return (
                      <tr key={m}>
                        <td>{new Date(m + '-01').toLocaleDateString('en', { month: 'long', year: 'numeric' })}</td>
                        <td style={{ color: '#1D9E75', fontWeight: 600 }}>{fmt(rev)}</td>
                        <td style={{ color: '#c62828', fontWeight: 600 }}>({fmt(cost)})</td>
                        <td style={{ fontWeight: 700, color: profit >= 0 ? '#1D9E75' : '#c62828' }}>{fmt(profit)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ── JOURNAL ── */}
      {activeTab === 'journal' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#0d1b2a' }}>General Journal (Double-Entry)</h3>
              <p style={{ fontSize: 12, color: '#999', margin: '4px 0 0' }}>Auto-generated from sales, costs and purchases</p>
            </div>
            <button onClick={downloadJournalCSV} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
              <Download size={13} /> Download CSV
            </button>
          </div>
          {journalFiltered.length === 0 ? <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No transactions in this period.</p>
            : journalFiltered.map((j, i) => (
              <div key={i} style={{ marginBottom: 14, border: '1px solid #f0f0f0', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#fafafa', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 700, color: '#0d1b2a' }}>{j.date}</span>
                    <span style={{ color: '#aaa', marginLeft: 10 }}>{j.ref}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#666' }}>{j.desc}</div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <th style={{ textAlign: 'left', padding: '6px 14px', fontWeight: 500, color: '#999', fontSize: 11 }}>ACCOUNT</th>
                    <th style={{ textAlign: 'right', padding: '6px 14px', fontWeight: 500, color: '#999', fontSize: 11 }}>DEBIT</th>
                    <th style={{ textAlign: 'right', padding: '6px 14px', fontWeight: 500, color: '#999', fontSize: 11 }}>CREDIT</th>
                  </tr></thead>
                  <tbody>
                    {j.entries.map((e, k) => (
                      <tr key={k} style={{ borderBottom: k < j.entries.length - 1 ? '1px solid #fafafa' : 'none' }}>
                        <td style={{ padding: '7px 14px', paddingLeft: e.credit > 0 ? 34 : 14 }}>{e.account}</td>
                        <td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 600, color: '#1565c0' }}>{e.debit > 0 ? fmt(e.debit) : ''}</td>
                        <td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 600, color: '#2e7d32' }}>{e.credit > 0 ? fmt(e.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </Card>
      )}

      {/* ── DOWNLOAD DOCUMENTS ── */}
      {activeTab === 'download' && (
        <>
          <div style={{ marginBottom: 20, padding: '14px 18px', background: '#f8f7f4', borderRadius: 12, fontSize: 13, color: '#666' }}>
            💡 All downloads are based on the period selected in the filter above. CSV files open in Excel or Google Sheets.
          </div>
          <div className="dl-grid">
            {[
              { title: 'Income Statement', desc: 'Revenue, costs, gross & net profit', icon: '📄', action: downloadIncomeStatementCSV, label: 'Download CSV', secondary: printIncomeStatement, secondaryLabel: 'Print / PDF' },
              { title: 'Monthly Cost Report', desc: 'Costs broken down by category per month', icon: '📅', action: downloadMonthlyCostsCSV, label: 'Download CSV' },
              { title: 'General Journal', desc: 'All double-entry accounting records', icon: '📖', action: downloadJournalCSV, label: 'Download CSV' },
              { title: 'Orders Report', desc: 'All sales orders with details', icon: '🛒', action: downloadOrdersCSV, label: 'Download CSV' },
              { title: 'Cost Detail Report', desc: 'All expenses with categories', icon: '💰', action: downloadCostsCSV, label: 'Download CSV' },
              { title: 'Customer List', desc: 'All customer contact information', icon: '👥', action: downloadCustomersCSV, label: 'Download CSV' },
            ].map((doc, i) => (
              <div key={i} className="dl-card">
                <div style={{ fontSize: 28 }}>{doc.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a', marginBottom: 4 }}>{doc.title}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{doc.desc}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={doc.action} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#FFA500', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
                    <Download size={13} /> {doc.label}
                  </button>
                  {doc.secondary && (
                    <button onClick={doc.secondary} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#0d1b2a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
                      <Download size={13} /> {doc.secondaryLabel}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
