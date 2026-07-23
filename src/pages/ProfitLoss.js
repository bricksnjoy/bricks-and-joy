import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner } from '../components/UI'
import { FinancialBusiness } from '../components/BusinessSections'
import { FileText, BookOpen, Calendar, Download, TrendingUp, TrendingDown, Receipt, CheckCircle, AlertTriangle, Info } from 'lucide-react'

const MVR_RATE = 15.42

export default function Accounting() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [expenses, setExpenses] = useState([])
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [customers, setCustomers] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('income')
  const [gstSettings, setGstSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bj_gst_settings') || '{}') } catch { return {} }
  })
  const [gstPeriod, setGstPeriod] = useState('12m')
  const [periodFilter, setPeriodFilter] = useState('all')
  const [currency, setCurrency] = useState('MVR')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, p, e, po, c, s] = await Promise.all([
      supabase.from('orders').select('*').order('order_date'),
      supabase.from('products').select('id, name, cost_price, stock_qty'),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
      supabase.from('purchase_orders').select('*'),
      supabase.from('customers').select('*'),
      supabase.from('suppliers').select('id, name, contact_name'),
    ])
    setOrders(o.data || [])
    setProducts(p.data || [])
    setExpenses(e.data || [])
    setPurchaseOrders(po.data || [])
    setCustomers(c.data || [])
    setSuppliers(s.data || [])
    setLoading(false)
  }

  const fmt = v => currency === 'MVR' ? `MVR ${Number(v).toFixed(2)}` : `USD ${(Number(v) / MVR_RATE).toFixed(2)}`
  const supName = po => { const s = suppliers.find(x => x.id === po.supplier_id); return s?.contact_name || s?.name || po.supplier_name || 'Supplier' }

  const allMonths = [...new Set([
    ...orders.map(o => o.order_date?.slice(0, 7)),
    ...expenses.map(e => e.expense_date?.slice(0, 7)),
  ].filter(Boolean))].sort().reverse()

  const inPeriod = date => periodFilter === 'all' || (date && date.startsWith(periodFilter))

  // Calculations — revenue counts paid orders even if not yet delivered
  const isRevenue = o => o.status !== 'cancelled' && (o.status === 'delivered' || o.payment_status === 'paid')
  const revOrders = orders.filter(o => isRevenue(o) && inPeriod(o.order_date))
  const delivered = orders.filter(o => o.status === 'delivered' && inPeriod(o.order_date))
  const revenue = revOrders.reduce((s, o) => s + Number(o.total_price || 0), 0)
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
  orders.filter(isRevenue).forEach(o => {
    const m = o.order_date?.slice(0, 7)
    if (m) monthlyRevenue[m] = (monthlyRevenue[m] || 0) + Number(o.total_price || 0)
  })

  // Journal
  const journal = []
  orders.filter(isRevenue).forEach(o => {
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
    const isCost = po.cost_type === 'extra'
    journal.push({
      date: po.order_date, ref: `PO-${po.id?.slice(0, 6)}`,
      desc: isCost
        ? `Import cost: ${po.product_name} (${supName(po)})`
        : `Purchase: ${po.product_name} ×${po.qty} from ${supName(po)}`,
      entries: [
        { account: isCost ? 'Import & Handling Costs' : 'Inventory', debit: amt, credit: 0 },
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
    const logoUrl = window.location.origin + '/logo-full.png'
    const w = window.open('', '_blank')
    w.document.write(`
      <html><head><title>Income Statement — ${companyName}</title>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Poppins', Arial, sans-serif; color: #0d1b2a; padding: 40px; max-width: 640px; margin: 0 auto; }
        .doc-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 3px solid #FFA500; margin-bottom: 28px; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand img { height: 56px; width: auto; max-width: 220px; object-fit: contain; }
        .brand-name { font-size: 20px; font-weight: 800; color: #0d1b2a; letter-spacing: -0.3px; }
        .brand-tag { font-size: 10px; color: #aaa; text-transform: uppercase; letter-spacing: 1.2px; margin-top: 2px; }
        .doc-meta { text-align: right; }
        .doc-type { font-size: 11px; font-weight: 700; color: #FFA500; text-transform: uppercase; letter-spacing: 1.5px; }
        .doc-title { font-size: 18px; font-weight: 900; color: #0d1b2a; margin-top: 4px; }
        .doc-period { font-size: 11px; color: #aaa; margin-top: 3px; }
        .kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
        .kpi { background: #f8f7f4; border-radius: 10px; padding: 14px 16px; border-left: 3px solid var(--kc); }
        .kpi-label { font-size: 10px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; font-weight: 600; }
        .kpi-value { font-size: 16px; font-weight: 800; color: var(--kc); letter-spacing: -0.3px; }
        .section-head { font-size: 10px; font-weight: 800; color: #FFA500; text-transform: uppercase; letter-spacing: 1.5px; margin: 20px 0 8px; padding-bottom: 6px; border-bottom: 1px solid #f0f0f0; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
        td { padding: 9px 4px; border-bottom: 1px solid #f5f5f5; font-size: 13px; }
        td:last-child { text-align: right; font-weight: 600; }
        .row-indent td:first-child { padding-left: 18px; color: #555; font-weight: 400; }
        .row-total td { font-weight: 800; font-size: 13px; border-top: 1px solid #ddd; border-bottom: none; padding-top: 10px; }
        .net-block { margin-top: 24px; display: flex; justify-content: space-between; align-items: center; padding: 18px 22px; background: #0d1b2a; border-radius: 12px; }
        .net-left { font-size: 13px; font-weight: 700; color: #fff; }
        .net-margin { font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 3px; }
        .net-value { font-size: 26px; font-weight: 900; letter-spacing: -0.8px; }
        .red { color: #E24B4A; } .green { color: #1D9E75; }
        .doc-footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #f0f0f0; display: flex; justify-content: space-between; font-size: 10px; color: #ccc; }
        .footer-brand { font-weight: 700; color: #0d1b2a; }
        @media print { body { padding: 24px; } }
      </style></head>
      <body>
        <div class="doc-header">
          <div class="brand">
            <img src="${logoUrl}" alt="Brick's & Joy" onerror="this.style.display='none';document.getElementById('plBrandFallback').style.display='block'" />
            <div>
              <div id="plBrandFallback" class="brand-name" style="display:none">Brick's &amp; Joy</div>
              <div class="brand-tag">Toy Company · Maldives</div>
            </div>
          </div>
          <div class="doc-meta">
            <div class="doc-type">Financial Document</div>
            <div class="doc-title">Income Statement</div>
            <div class="doc-period">${periodLabel} · Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
          </div>
        </div>

        <div class="kpi-row">
          <div class="kpi" style="--kc:#1D9E75">
            <div class="kpi-label">Total Revenue</div>
            <div class="kpi-value">MVR ${revenue.toFixed(2)}</div>
          </div>
          <div class="kpi" style="--kc:${grossProfit >= 0 ? '#1D9E75' : '#E24B4A'}">
            <div class="kpi-label">Gross Profit</div>
            <div class="kpi-value">MVR ${grossProfit.toFixed(2)}</div>
          </div>
          <div class="kpi" style="--kc:#FFA500">
            <div class="kpi-label">Gross Margin</div>
            <div class="kpi-value">${grossMargin}%</div>
          </div>
        </div>

        <div class="section-head">Revenue</div>
        <table>
          <tr class="row-indent"><td>Sales Revenue</td><td>MVR ${revenue.toFixed(2)}</td></tr>
          <tr class="row-total"><td>Total Revenue</td><td>MVR ${revenue.toFixed(2)}</td></tr>
        </table>

        <div class="section-head">Cost of Goods Sold</div>
        <table>
          <tr class="row-indent"><td>Cost of Goods Sold</td><td class="red">(MVR ${cogs.toFixed(2)})</td></tr>
          <tr class="row-total"><td>Gross Profit <span style="font-size:11px;font-weight:400;color:#aaa">(${grossMargin}% margin)</span></td><td class="${grossProfit >= 0 ? 'green' : 'red'}">MVR ${grossProfit.toFixed(2)}</td></tr>
        </table>

        <div class="section-head">Operating Expenses</div>
        <table>
          ${Object.entries(expByCat).map(([cat, amt]) => `<tr class="row-indent"><td>${cat}</td><td class="red">(MVR ${amt.toFixed(2)})</td></tr>`).join('')}
          ${Object.keys(expByCat).length === 0 ? '<tr class="row-indent"><td style="color:#ccc">No expenses recorded</td><td>—</td></tr>' : ''}
          <tr class="row-total"><td>Total Operating Expenses</td><td class="red">(MVR ${totalOpEx.toFixed(2)})</td></tr>
        </table>

        <div class="net-block">
          <div>
            <div class="net-left">Net Income</div>
            <div class="net-margin">${netMargin}% net margin</div>
          </div>
          <div class="net-value ${netIncome >= 0 ? 'green' : 'red'}">MVR ${netIncome.toFixed(2)}</div>
        </div>

        <div class="doc-footer">
          <div class="footer-brand">Brick's &amp; Joy</div>
          <div>Rate: 1 USD = ${MVR_RATE} MVR &nbsp;·&nbsp; Revenue recognized on paid & delivered orders</div>
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
        {[['income', 'Income Statement', FileText], ['gst', 'GST / Tax', Receipt], ['balance', 'Balance Sheet', BookOpen], ['cashflow', 'Cash Flow', TrendingUp], ['transactions', 'Transactions', Calendar], ['monthly', 'Monthly Reports', Calendar], ['journal', 'Journal', BookOpen], ['download', 'Download Documents', Download]].map(([id, label, Icon]) => (
          <button key={id} className="acc-tab" onClick={() => setActiveTab(id)}
            style={{ background: activeTab === id ? '#fff' : 'transparent', color: activeTab === id ? '#0d1b2a' : '#888', boxShadow: activeTab === id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', fontWeight: activeTab === id ? 700 : 500 }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* ── GST / TAX ── */}
      {activeTab === 'gst' && (() => {
        const GST_RATE = 0.08
        const GST_THRESHOLD = 1000000
        const now = new Date()

        // Period revenue
        const sinceDate = gstPeriod === '1m' ? new Date(now.getFullYear(), now.getMonth(), 1)
          : gstPeriod === '3m' ? new Date(now.getFullYear(), now.getMonth() - 3, 1)
          : new Date(now.getFullYear(), now.getMonth() - 12, 1)
        const sinceDateStr = sinceDate.toISOString().split('T')[0]
        const periodDelivered = orders.filter(o => isRevenue(o) && o.order_date >= sinceDateStr)
        const periodRevenue = periodDelivered.reduce((s, o) => s + Number(o.total_price || 0), 0)

        // Last 12m revenue (for threshold check)
        const last12Start = new Date(now.getFullYear(), now.getMonth() - 12, 1).toISOString().split('T')[0]
        const last12Revenue = orders.filter(o => isRevenue(o) && o.order_date >= last12Start)
          .reduce((s, o) => s + Number(o.total_price || 0), 0)

        const thresholdPct = Math.min(100, (last12Revenue / GST_THRESHOLD) * 100)
        const exceedsThreshold = last12Revenue >= GST_THRESHOLD

        const gstApplies = gstSettings.tourism || gstSettings.imports || gstSettings.voluntary || exceedsThreshold
        const gstExclusive = periodRevenue / (1 + GST_RATE) // if prices are GST-inclusive
        const gstToRemit = periodRevenue * GST_RATE // if prices are GST-exclusive (standard retail)

        function saveGstSettings(key, val) {
          const next = { ...gstSettings, [key]: val }
          setGstSettings(next)
          localStorage.setItem('bj_gst_settings', JSON.stringify(next))
        }

        const periodLabels = { '1m': 'This Month', '3m': 'Last 3 Months', '12m': 'Last 12 Months' }

        return (
          <div>
            {/* Eligibility */}
            <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <div style={{ background: '#f8f7f4', borderRadius: 8, padding: 7 }}><Receipt size={15} color="#FFA500" /></div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a' }}>GST Eligibility</span>
                </div>
                {[
                  { key: 'tourism', label: 'We provide tourism goods / services' },
                  { key: 'imports', label: 'We import goods into the Maldives' },
                  { key: 'voluntary', label: 'Voluntarily GST-registered' },
                ].map(({ key, label }) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f5f5f5', cursor: 'pointer', fontSize: 13 }}>
                    <div onClick={() => saveGstSettings(key, !gstSettings[key])} style={{
                      width: 38, height: 22, borderRadius: 99, background: gstSettings[key] ? '#FFA500' : '#e0e0e0',
                      position: 'relative', transition: 'background 0.2s', flexShrink: 0, cursor: 'pointer'
                    }}>
                      <div style={{ position: 'absolute', top: 3, left: gstSettings[key] ? 18 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                    </div>
                    <span style={{ color: '#333' }}>{label}</span>
                  </label>
                ))}
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: '#888' }}>Sales threshold (last 12 months)</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: exceedsThreshold ? '#E24B4A' : '#1D9E75' }}>
                      MVR {last12Revenue.toLocaleString('en', { minimumFractionDigits: 0 })} / 1,000,000
                    </span>
                  </div>
                  <div style={{ height: 8, background: '#f0f0f0', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${thresholdPct}%`, background: thresholdPct >= 100 ? '#E24B4A' : thresholdPct >= 70 ? '#f57f17' : '#1D9E75', borderRadius: 99, transition: 'width 0.6s ease' }} />
                  </div>
                  {exceedsThreshold && <p style={{ fontSize: 11, color: '#E24B4A', marginTop: 6, fontWeight: 500 }}>Threshold exceeded — GST registration mandatory</p>}
                </div>
              </Card>

              <Card>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  {gstApplies
                    ? <><div style={{ background: '#fef2f2', borderRadius: 8, padding: 7 }}><AlertTriangle size={15} color="#E24B4A" /></div><span style={{ fontSize: 14, fontWeight: 700, color: '#E24B4A' }}>GST Applies</span></>
                    : <><div style={{ background: '#E1F5EE', borderRadius: 8, padding: 7 }}><CheckCircle size={15} color="#1D9E75" /></div><span style={{ fontSize: 14, fontWeight: 700, color: '#1D9E75' }}>GST Not Required</span></>
                  }
                </div>
                {!gstApplies ? (
                  <p style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6 }}>
                    Based on your settings, you are below the MVR 1M threshold and don't provide tourism goods, import goods, or hold voluntary registration. No GST obligation currently.
                  </p>
                ) : (
                  <p style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>
                    GST at <strong>8%</strong> applies to your sales. You must file returns with <strong>MIRA</strong> and remit the GST collected.
                  </p>
                )}
                <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginTop: 12, fontSize: 12, color: '#888', display: 'flex', gap: 8 }}>
                  <Info size={13} color="#aaa" style={{ flexShrink: 0, marginTop: 1 }} />
                  GST rate: <strong style={{ color: '#0d1b2a' }}>8%</strong> · Maldives GST Act (Tourism Goods & Services Tax) · Threshold: <strong style={{ color: '#0d1b2a' }}>MVR 1,000,000</strong>
                </div>
              </Card>
            </div>

            {/* GST Calculation */}
            {gstApplies && (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {Object.entries(periodLabels).map(([v, l]) => (
                    <button key={v} onClick={() => setGstPeriod(v)}
                      style={{ padding: '6px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                        background: gstPeriod === v ? '#0d1b2a' : '#f0f0f0', color: gstPeriod === v ? '#fff' : '#666' }}>
                      {l}
                    </button>
                  ))}
                </div>

                <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>
                  {[
                    { label: 'Taxable Revenue', value: `MVR ${periodRevenue.toFixed(2)}`, color: '#378ADD', note: periodLabels[gstPeriod] },
                    { label: 'GST Collected (8%)', value: `MVR ${gstToRemit.toFixed(2)}`, color: '#E24B4A', note: 'On GST-exclusive prices' },
                    { label: 'GST Inclusive (8/108)', value: `MVR ${(periodRevenue - gstExclusive).toFixed(2)}`, color: '#f57f17', note: 'If prices include GST' },
                  ].map((s, i) => (
                    <Card key={i} style={{ borderLeft: `4px solid ${s.color}` }}>
                      <div style={{ fontSize: 10, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>{s.note}</div>
                    </Card>
                  ))}
                </div>

                {/* GST Remittance card */}
                <div style={{ background: 'linear-gradient(135deg, #0d1b2a 0%, #162538 100%)', borderRadius: 16, padding: '24px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, marginBottom: 6 }}>GST to Remit to MIRA — {periodLabels[gstPeriod]}</div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: '#FFA500', letterSpacing: '-1px' }}>MVR {gstToRemit.toFixed(2)}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>Based on {periodLabels[gstPeriod].toLowerCase()} revenue of MVR {periodRevenue.toFixed(2)} × 8%</div>
                  </div>
                  <div style={{ background: 'rgba(255,165,0,0.12)', borderRadius: 14, padding: '14px 18px', textAlign: 'center' }}>
                    <Receipt size={28} color="#FFA500" />
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>File with MIRA</div>
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })()}

      {/* ── INCOME STATEMENT ── */}
      {activeTab === 'income' && (
        <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
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

      {/* ── BALANCE SHEET ── */}
      {activeTab === 'balance' && (() => {
        const inventory = products.reduce((s, p) => s + (p.stock_qty || 0) * Number(p.cost_price || 0), 0)
        const cashFromSales = delivered.reduce((s, o) => s + Number(o.total_price || 0), 0)
        const totalAssets = inventory + cashFromSales
        const accountsPayable = purchaseOrders.filter(po => po.status !== 'received').reduce((s, po) => s + Number(po.total_cost || 0), 0)
        const totalLiabilities = accountsPayable
        const equity = totalAssets - totalLiabilities
        return (
          <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid #0d1b2a' }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#0d1b2a' }}>{companyName}</div>
                  <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>Balance Sheet</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{periodLabel}</div>
                </div>
              </div>
              <table className="is-table"><tbody>
                <tr><td style={{ fontWeight: 700, color: '#0d1b2a' }}>ASSETS</td><td></td></tr>
                <tr><td style={{ paddingLeft: 24 }}>Cash & Accounts Receivable</td><td style={{ textAlign: 'right', fontWeight: 500 }}>{fmt(cashFromSales)}</td></tr>
                <tr><td style={{ paddingLeft: 24 }}>Inventory (at cost)</td><td style={{ textAlign: 'right', fontWeight: 500 }}>{fmt(inventory)}</td></tr>
                <tr style={{ borderTop: '2px solid #0d1b2a' }}><td style={{ fontWeight: 800, fontSize: 14, paddingTop: 10 }}>TOTAL ASSETS</td><td style={{ textAlign: 'right', fontWeight: 800, fontSize: 14, paddingTop: 10, color: '#1D9E75' }}>{fmt(totalAssets)}</td></tr>
                <tr><td style={{ fontWeight: 700, color: '#0d1b2a', paddingTop: 20 }}>LIABILITIES</td><td></td></tr>
                <tr><td style={{ paddingLeft: 24 }}>Accounts Payable (open POs)</td><td style={{ textAlign: 'right', fontWeight: 500, color: '#c62828' }}>{fmt(accountsPayable)}</td></tr>
                <tr style={{ borderTop: '2px solid #0d1b2a' }}><td style={{ fontWeight: 800, fontSize: 14, paddingTop: 10 }}>TOTAL LIABILITIES</td><td style={{ textAlign: 'right', fontWeight: 800, fontSize: 14, paddingTop: 10, color: '#c62828' }}>{fmt(totalLiabilities)}</td></tr>
                <tr><td style={{ fontWeight: 700, color: '#0d1b2a', paddingTop: 20 }}>EQUITY</td><td></td></tr>
                <tr><td style={{ paddingLeft: 24 }}>Retained Earnings</td><td style={{ textAlign: 'right', fontWeight: 500 }}>{fmt(netIncome)}</td></tr>
                <tr style={{ borderTop: '3px double #0d1b2a' }}><td style={{ fontWeight: 800, fontSize: 15, paddingTop: 14 }}>TOTAL EQUITY</td><td style={{ textAlign: 'right', fontWeight: 800, fontSize: 16, paddingTop: 14, color: equity >= 0 ? '#1D9E75' : '#c62828' }}>{fmt(equity)}</td></tr>
              </tbody></table>
              <div style={{ marginTop: 16, padding: '8px 12px', background: '#f8f7f4', borderRadius: 8, fontSize: 11, color: '#999', textAlign: 'center' }}>
                Assets = Liabilities + Equity · Inventory valued at cost price
              </div>
            </Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Total Assets', val: totalAssets, color: '#1D9E75' },
                { label: 'Total Liabilities', val: totalLiabilities, color: '#c62828' },
                { label: 'Net Equity', val: equity, color: equity >= 0 ? '#1D9E75' : '#c62828' },
                { label: 'Inventory Value', val: inventory, color: '#378ADD' },
              ].map((m, i) => (
                <div key={i} style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #eee' }}>
                  <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: m.color }}>{fmt(m.val)}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── CASH FLOW ── */}
      {activeTab === 'cashflow' && (() => {
        const cashIn = delivered.reduce((s, o) => s + Number(o.total_price || 0), 0)
        const cashOutExpenses = expenses.filter(e => inPeriod(e.expense_date)).reduce((s, e) => s + Number(e.amount || 0), 0)
        const receivedPOs = purchaseOrders.filter(po => po.status === 'received' && inPeriod(po.order_date))
        const cashOutPurchases = receivedPOs.filter(po => po.cost_type !== 'extra').reduce((s, po) => s + Number(po.total_cost || 0), 0)
        const cashOutImportCosts = receivedPOs.filter(po => po.cost_type === 'extra').reduce((s, po) => s + Number(po.total_cost || 0), 0)
        const operatingCashFlow = cashIn - cashOutExpenses - cashOutImportCosts
        const investingCashFlow = -cashOutPurchases
        const netCashFlow = operatingCashFlow + investingCashFlow

        const monthlyFlow = {}
        delivered.forEach(o => { const m = o.order_date?.slice(0,7); if(m) { if(!monthlyFlow[m]) monthlyFlow[m]={in:0,out:0}; monthlyFlow[m].in += Number(o.total_price||0) } })
        expenses.forEach(e => { const m = e.expense_date?.slice(0,7); if(m) { if(!monthlyFlow[m]) monthlyFlow[m]={in:0,out:0}; monthlyFlow[m].out += Number(e.amount||0) } })
        purchaseOrders.filter(po=>po.status==='received').forEach(po => { const m = po.order_date?.slice(0,7); if(m) { if(!monthlyFlow[m]) monthlyFlow[m]={in:0,out:0}; monthlyFlow[m].out += Number(po.total_cost||0) } })

        return (
          <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <Card>
              <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid #0d1b2a' }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#0d1b2a' }}>{companyName}</div>
                <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>Cash Flow Statement</div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{periodLabel}</div>
              </div>
              <table className="is-table"><tbody>
                <tr><td style={{ fontWeight: 700, color: '#0d1b2a' }}>OPERATING ACTIVITIES</td><td></td></tr>
                <tr><td style={{ paddingLeft: 24 }}>Cash received from customers</td><td style={{ textAlign: 'right', color: '#1D9E75', fontWeight: 500 }}>{fmt(cashIn)}</td></tr>
                <tr><td style={{ paddingLeft: 24 }}>Cash paid for expenses</td><td style={{ textAlign: 'right', color: '#c62828', fontWeight: 500 }}>({fmt(cashOutExpenses)})</td></tr>
                {cashOutImportCosts > 0 && <tr><td style={{ paddingLeft: 24 }}>Import &amp; handling costs</td><td style={{ textAlign: 'right', color: '#c62828', fontWeight: 500 }}>({fmt(cashOutImportCosts)})</td></tr>}
                <tr style={{ borderTop: '1px solid #eee' }}><td style={{ fontWeight: 700 }}>Net Operating Cash Flow</td><td style={{ textAlign: 'right', fontWeight: 700, color: operatingCashFlow >= 0 ? '#1D9E75' : '#c62828' }}>{fmt(operatingCashFlow)}</td></tr>
                <tr><td style={{ fontWeight: 700, color: '#0d1b2a', paddingTop: 20 }}>INVESTING ACTIVITIES</td><td></td></tr>
                <tr><td style={{ paddingLeft: 24 }}>Purchase of inventory</td><td style={{ textAlign: 'right', color: '#c62828', fontWeight: 500 }}>({fmt(cashOutPurchases)})</td></tr>
                <tr style={{ borderTop: '1px solid #eee' }}><td style={{ fontWeight: 700 }}>Net Investing Cash Flow</td><td style={{ textAlign: 'right', fontWeight: 700, color: '#c62828' }}>{fmt(Math.abs(investingCashFlow))}</td></tr>
                <tr style={{ borderTop: '3px double #0d1b2a' }}><td style={{ fontWeight: 800, fontSize: 15, paddingTop: 14 }}>NET CASH FLOW</td><td style={{ textAlign: 'right', fontWeight: 800, fontSize: 16, paddingTop: 14, color: netCashFlow >= 0 ? '#1D9E75' : '#c62828' }}>{fmt(netCashFlow)}</td></tr>
              </tbody></table>
            </Card>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 14 }}>Monthly cash flow</h3>
              {Object.entries(monthlyFlow).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,6).map(([m, flow]) => {
                const net = flow.in - flow.out
                return (
                  <div key={m} style={{ background: '#fff', borderRadius: 10, border: '1px solid #eee', padding: '12px 16px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{new Date(m+'-01').toLocaleDateString('en',{month:'long',year:'numeric'})}</span>
                      <span style={{ fontWeight: 700, color: net >= 0 ? '#1D9E75' : '#c62828' }}>{net >= 0 ? '+' : ''}{fmt(net)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                      <span style={{ color: '#1D9E75' }}>▲ {fmt(flow.in)}</span>
                      <span style={{ color: '#c62828' }}>▼ {fmt(flow.out)}</span>
                    </div>
                  </div>
                )
              })}
              {Object.keys(monthlyFlow).length === 0 && <p style={{ color: '#aaa', fontSize: 13 }}>No cash flow data yet.</p>}
            </div>
          </div>
        )
      })()}

      {/* ── TRANSACTIONS ── */}
      {activeTab === 'transactions' && (() => {
        const allTxn = [
          ...orders.filter(o => inPeriod(o.order_date)).map(o => ({
            date: o.order_date, type: 'sale', ref: o.invoice_number || `ORD-${o.id?.slice(0,6)}`,
            description: `Sale: ${o.product_name} ×${o.qty} — ${o.customer_name || 'Walk-in'}`,
            amount: Number(o.total_price || 0), direction: 'in',
            status: o.status, payment: o.payment_status || 'unpaid', channel: o.channel
          })),
          ...expenses.filter(e => inPeriod(e.expense_date)).map(e => ({
            date: e.expense_date, type: 'expense', ref: `EXP-${e.id?.slice(0,6)}`,
            description: `${e.category}: ${e.description}`,
            amount: Number(e.amount || 0), direction: 'out', status: 'done', payment: 'paid'
          })),
          ...purchaseOrders.filter(po => inPeriod(po.order_date)).map(po => ({
            date: po.order_date, type: po.cost_type === 'extra' ? 'cost' : 'purchase', ref: `PO-${po.id?.slice(0,6)}`,
            description: po.cost_type === 'extra'
              ? `Import cost: ${po.product_name} — ${supName(po)}`
              : `Purchase: ${po.product_name} ×${po.qty} from ${supName(po)}`,
            amount: Number(po.total_cost || 0), direction: 'out', status: po.status, payment: po.status === 'received' ? 'paid' : 'pending'
          })),
        ].sort((a,b) => new Date(b.date) - new Date(a.date))

        const totalIn = allTxn.filter(t=>t.direction==='in').reduce((s,t)=>s+t.amount,0)
        const totalOut = allTxn.filter(t=>t.direction==='out').reduce((s,t)=>s+t.amount,0)

        return (
          <div>
            <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
              {[
                { label: 'Total in', val: totalIn, color: '#1D9E75' },
                { label: 'Total out', val: totalOut, color: '#c62828' },
                { label: 'Net', val: totalIn - totalOut, color: (totalIn-totalOut) >= 0 ? '#1D9E75' : '#c62828' },
              ].map((m,i) => (
                <div key={i} style={{ background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #eee' }}>
                  <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: m.color }}>{fmt(m.val)}</div>
                </div>
              ))}
            </div>
            <Card>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 16 }}>All transactions</h3>
              {allTxn.length === 0 ? <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No transactions in this period.</p> : (
                <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ background: '#fafafa' }}>
                      {['Date','Ref','Description','Type','Amount',''].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: '1px solid #eee' }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {allTxn.map((t, i) => (
                        <tr key={i} style={{ borderBottom: i < allTxn.length-1 ? '1px solid #f5f5f5' : 'none' }}>
                          <td style={{ padding: '9px 12px', color: '#888', fontSize: 12, whiteSpace: 'nowrap' }}>{t.date}</td>
                          <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'monospace', color: '#aaa' }}>{t.ref}</td>
                          <td style={{ padding: '9px 12px', fontWeight: 500, maxWidth: 260 }}>{t.description}</td>
                          <td style={{ padding: '9px 12px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                              background: t.type==='sale' ? '#E1F5EE' : t.type==='expense' ? '#FCEBEB' : t.type==='cost' ? '#FFF3D6' : '#EEF4FF',
                              color: t.type==='sale' ? '#1D9E75' : t.type==='expense' ? '#c62828' : t.type==='cost' ? '#b8740a' : '#378ADD' }}>
                              {t.type}
                            </span>
                          </td>
                          <td style={{ padding: '9px 12px', fontWeight: 700, color: t.direction==='in' ? '#1D9E75' : '#c62828', whiteSpace: 'nowrap' }}>
                            {t.direction==='in' ? '+' : '-'}{fmt(t.amount)}
                          </td>
                          <td style={{ padding: '9px 12px' }}>
                            <span style={{ fontSize: 11, color: t.payment==='paid' ? '#1D9E75' : '#f57f17', fontWeight: 600 }}>{t.payment}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )
      })()}

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
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
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
      <FinancialBusiness />
    </div>
  )
}
