import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, TrendingUp, TrendingDown } from 'lucide-react'

const MVR_RATE = 15.4

const COST_CATEGORIES = [
  { value: 'Giveaway', label: '🎁 Giveaway' },
  { value: 'Sample Testing', label: '🧪 Sample Testing' },
  { value: 'Marketing Ads', label: '📣 Marketing Ads' },
  { value: 'Instagram Ads', label: '📸 Instagram Ads' },
  { value: 'Facebook Ads', label: '👥 Facebook Ads' },
  { value: 'Packaging', label: '📦 Packaging' },
  { value: 'Shipping', label: '🚚 Shipping' },
  { value: 'Staff / Salary', label: '👤 Staff / Salary' },
  { value: 'Rent / Warehouse', label: '🏪 Rent / Warehouse' },
  { value: 'Utilities', label: '💡 Utilities' },
  { value: 'Returns / Refunds', label: '↩️ Returns / Refunds' },
  { value: 'Other', label: '📝 Other' },
]

const categoryColors = {
  'Giveaway': 'purple', 'Sample Testing': 'blue', 'Marketing Ads': 'amber',
  'Instagram Ads': 'red', 'Facebook Ads': 'blue', 'Packaging': 'green',
  'Shipping': 'blue', 'Staff / Salary': 'gray', 'Rent / Warehouse': 'gray',
  'Utilities': 'amber', 'Returns / Refunds': 'red', 'Other': 'gray',
}

const EMPTY = {
  description: '', category: 'Marketing Ads', amount: '',
  currency: 'USD', expense_date: new Date().toISOString().split('T')[0],
}

export default function ProfitLoss() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [currency, setCurrency] = useState('USD')
  const [filterCat, setFilterCat] = useState('all')
  const [activeTab, setActiveTab] = useState('overview') // 'overview' | 'costs'
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, p, e] = await Promise.all([
      supabase.from('orders').select('*'),
      supabase.from('products').select('id, name, cost_price'),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
    ])
    setOrders(o.data || [])
    setProducts(p.data || [])
    setExpenses(e.data || [])
    setLoading(false)
  }

  async function saveExpense() {
    if (!form.description || !form.amount) return
    setSaving(true)
    const amountUSD = form.currency === 'MVR'
      ? parseFloat(form.amount) / MVR_RATE
      : parseFloat(form.amount)
    const { error } = await supabase.from('expenses').insert({
      description: form.description,
      category: form.category,
      amount: parseFloat(amountUSD.toFixed(2)),
      expense_date: form.expense_date,
    })
    setSaving(false)
    if (error) { toast.error('Failed to save'); return }
    toast.success('Cost added!')
    setModal(false)
    setForm(EMPTY)
    load()
  }

  async function delExpense(id) {
    if (!window.confirm('Delete this cost?')) return
    await supabase.from('expenses').delete().eq('id', id)
    toast.success('Deleted')
    load()
  }

  const f = k => e => setForm(prev => ({ ...prev, [k]: e.target.value }))

  // Calculations (always in USD internally)
  const delivered = orders.filter(o => o.status === 'delivered')
  const revenueUSD = delivered.reduce((s, o) => s + Number(o.total_price || 0), 0)
  const cogsUSD = delivered.reduce((s, o) => {
    const p = products.find(p => p.id === o.product_id)
    return s + (p ? o.qty * Number(p.cost_price) : 0)
  }, 0)
  const grossProfitUSD = revenueUSD - cogsUSD
  const totalExpUSD = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const netProfitUSD = grossProfitUSD - totalExpUSD
  const grossMargin = revenueUSD > 0 ? (grossProfitUSD / revenueUSD * 100).toFixed(1) : 0
  const netMargin = revenueUSD > 0 ? (netProfitUSD / revenueUSD * 100).toFixed(1) : 0

  // Display helper
  const fmt = (usd) => {
    if (currency === 'MVR') return `MVR ${(usd * MVR_RATE).toFixed(2)}`
    return `$${usd.toFixed(2)}`
  }

  // By category
  const byCat = {}
  expenses.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0) })

  // This month costs
  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisMonthUSD = expenses.filter(e => e.expense_date?.startsWith(thisMonth)).reduce((s, e) => s + Number(e.amount || 0), 0)

  // Preview conversion in modal
  const previewUSD = form.currency === 'MVR' ? (parseFloat(form.amount || 0) / MVR_RATE).toFixed(2) : parseFloat(form.amount || 0).toFixed(2)
  const previewMVR = form.currency === 'USD' ? (parseFloat(form.amount || 0) * MVR_RATE).toFixed(2) : parseFloat(form.amount || 0).toFixed(2)

  const filteredExp = filterCat === 'all' ? expenses : expenses.filter(e => e.category === filterCat)

  const expColumns = [
    { key: 'expense_date', label: 'Date', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.expense_date}</span> },
    { key: 'description', label: 'Description', render: r => <span style={{ fontWeight: 500 }}>{r.description}</span> },
    { key: 'category', label: 'Category', render: r => <Badge color={categoryColors[r.category] || 'gray'}>{COST_CATEGORIES.find(c => c.value === r.category)?.label || r.category}</Badge> },
    { key: 'usd', label: 'USD', render: r => <span style={{ fontWeight: 600, color: '#1565c0' }}>${Number(r.amount).toFixed(2)}</span> },
    { key: 'mvr', label: 'MVR', render: r => <span style={{ fontWeight: 600, color: '#2e7d32' }}>MVR {(Number(r.amount) * MVR_RATE).toFixed(2)}</span> },
    { key: 'actions', label: '', render: r => <Button variant="danger" size="sm" onClick={() => delExpense(r.id)}><Trash2 size={13} /></Button> },
  ]

  if (loading) return <Spinner />

  return (
    <div>
      <style>{`
        .pl-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
        .pl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .pl-tabs { display: flex; gap: 0; background: #f0f0f0; border-radius: 10px; padding: 4px; margin-bottom: 24px; width: fit-content; }
        .pl-tab { padding: 8px 20px; border-radius: 7px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit; transition: all 0.15s; }
        .currency-toggle { display: flex; background: #f0f0f0; border-radius: 8px; padding: 3px; }
        .currency-btn { padding: 6px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.15s; font-family: inherit; }
        @media (max-width: 768px) {
          .pl-metrics { grid-template-columns: repeat(2, 1fr) !important; }
          .pl-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <PageHeader
        title="Profit & Loss"
        subtitle="Revenue, costs and net profit"
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div className="currency-toggle">
              <button className="currency-btn" onClick={() => setCurrency('USD')}
                style={{ background: currency === 'USD' ? '#fff' : 'transparent', color: currency === 'USD' ? '#0d1b2a' : '#888', boxShadow: currency === 'USD' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>$ USD</button>
              <button className="currency-btn" onClick={() => setCurrency('MVR')}
                style={{ background: currency === 'MVR' ? '#fff' : 'transparent', color: currency === 'MVR' ? '#0d1b2a' : '#888', boxShadow: currency === 'MVR' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>MVR</button>
            </div>
            <Button onClick={() => { setForm(EMPTY); setModal(true) }}><Plus size={15} /> Add cost</Button>
          </div>
        }
      />

      {/* Key metrics */}
      <div className="pl-metrics">
        {[
          { label: 'Revenue', value: fmt(revenueUSD), color: '#0d1b2a', icon: TrendingUp },
          { label: 'Gross profit', value: fmt(grossProfitUSD), sub: `${grossMargin}% margin`, color: grossProfitUSD >= 0 ? '#1D9E75' : '#c62828', icon: TrendingUp },
          { label: 'Total costs', value: fmt(totalExpUSD), sub: `This month: ${fmt(thisMonthUSD)}`, color: '#c62828', icon: TrendingDown },
          { label: 'Net profit', value: fmt(netProfitUSD), sub: `${netMargin}% margin`, color: netProfitUSD >= 0 ? '#1D9E75' : '#c62828', icon: netProfitUSD >= 0 ? TrendingUp : TrendingDown },
        ].map((m, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{m.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: m.color, letterSpacing: '-0.5px' }}>{m.value}</div>
                {m.sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{m.sub}</div>}
              </div>
              <div style={{ background: '#f8f7f4', borderRadius: 10, padding: 8 }}>
                <m.icon size={16} color={m.color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="pl-tabs">
        {[['overview', 'P&L Overview'], ['costs', 'Cost Breakdown']].map(([id, label]) => (
          <button key={id} className="pl-tab" onClick={() => setActiveTab(id)}
            style={{ background: activeTab === id ? '#fff' : 'transparent', color: activeTab === id ? '#0d1b2a' : '#888', boxShadow: activeTab === id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', fontWeight: activeTab === id ? 700 : 500 }}>
            {label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {activeTab === 'overview' && (
        <div className="pl-grid">
          {/* P&L Statement */}
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 18, color: '#0d1b2a' }}>Profit & loss statement</h3>
            {[
              { label: 'Gross revenue', value: fmt(revenueUSD), bold: false, color: '#333' },
              { label: 'Cost of goods sold (COGS)', value: `-${fmt(cogsUSD)}`, bold: false, color: '#c62828', indent: true },
              { label: 'Gross profit', value: fmt(grossProfitUSD), bold: true, color: grossProfitUSD >= 0 ? '#1D9E75' : '#c62828', sub: `${grossMargin}% margin` },
              { label: 'Operating costs', value: `-${fmt(totalExpUSD)}`, bold: false, color: '#c62828', indent: true },
              { label: 'Net profit', value: fmt(netProfitUSD), bold: true, large: true, color: netProfitUSD >= 0 ? '#1D9E75' : '#c62828', sub: `${netMargin}% net margin` },
            ].map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: row.large ? '14px 0 4px' : '10px 0', borderTop: row.bold ? '1px solid #eee' : 'none', paddingLeft: row.indent ? 16 : 0 }}>
                <div>
                  <span style={{ fontSize: row.large ? 15 : 13, fontWeight: row.bold ? 700 : 400, color: row.indent ? '#888' : '#333' }}>{row.label}</span>
                  {row.sub && <span style={{ fontSize: 11, color: '#aaa', marginLeft: 8 }}>{row.sub}</span>}
                </div>
                <span style={{ fontSize: row.large ? 16 : 13, fontWeight: row.bold ? 800 : 500, color: row.color }}>{row.value}</span>
              </div>
            ))}
            <div style={{ marginTop: 16, padding: '12px 14px', background: '#f8f7f4', borderRadius: 10, fontSize: 12, color: '#888', textAlign: 'center' }}>
              Rate: 1 USD = {MVR_RATE} MVR
            </div>
          </Card>

          {/* By category */}
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 18, color: '#0d1b2a' }}>Costs by category</h3>
            {Object.keys(byCat).length === 0 ? (
              <p style={{ color: '#aaa', fontSize: 13 }}>No costs recorded yet.</p>
            ) : Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, usdAmt]) => {
              const total = totalExpUSD || 1
              const pct = (usdAmt / total * 100).toFixed(0)
              const catObj = COST_CATEGORIES.find(c => c.value === cat)
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                    <span style={{ fontWeight: 500 }}>{catObj?.label || cat}</span>
                    <span style={{ color: '#c62828', fontWeight: 600 }}>{fmt(usdAmt)}</span>
                  </div>
                  <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#FFA500', borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{pct}% of total costs</div>
                </div>
              )
            })}
          </Card>
        </div>
      )}

      {/* Costs tab */}
      {activeTab === 'costs' && (
        <Card>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              style={{ padding: '7px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
              <option value="all">All categories</option>
              {COST_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <div style={{ fontSize: 13, color: '#888' }}>
              {filteredExp.length} entries · Total: <strong style={{ color: '#c62828' }}>{fmt(filteredExp.reduce((s, e) => s + Number(e.amount || 0), 0))}</strong>
            </div>
          </div>
          <Table columns={expColumns} data={filteredExp} emptyMessage="No costs yet. Click 'Add cost' to get started." />
        </Card>
      )}

      {/* Add cost modal */}
      {modal && (
        <Modal title="Add cost" onClose={() => setModal(false)}>
          <FormRow>
            <Input label="Description *" value={form.description} onChange={f('description')}
              placeholder="e.g. Instagram giveaway for June" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Select label="Category *" value={form.category} onChange={f('category')}
              options={COST_CATEGORIES.map(c => ({ value: c.value, label: c.label }))} />
            <Input label="Date" type="date" value={form.expense_date} onChange={f('expense_date')} />
          </FormRow>

          {/* Amount + Currency toggle */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>Amount & Currency *</label>
            <div style={{ display: 'flex', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
              <button onClick={() => setForm(p => ({ ...p, currency: 'USD' }))}
                style={{ padding: '9px 16px', border: 'none', borderRight: '1px solid #ddd', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: form.currency === 'USD' ? '#FFA500' : '#f8f8f8', color: form.currency === 'USD' ? '#fff' : '#666', transition: 'all 0.15s' }}>
                $ USD
              </button>
              <button onClick={() => setForm(p => ({ ...p, currency: 'MVR' }))}
                style={{ padding: '9px 16px', border: 'none', borderRight: '1px solid #ddd', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: form.currency === 'MVR' ? '#FFA500' : '#f8f8f8', color: form.currency === 'MVR' ? '#fff' : '#666', transition: 'all 0.15s' }}>
                MVR
              </button>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={f('amount')} placeholder="0.00"
                style={{ flex: 1, padding: '9px 12px', border: 'none', fontSize: 16, fontFamily: 'inherit', outline: 'none' }} />
            </div>
          </div>

          {/* Live conversion */}
          {parseFloat(form.amount) > 0 && (
            <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>USD</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#1565c0' }}>${previewUSD}</div>
                </div>
                <div style={{ fontSize: 18, color: '#ddd' }}>⇄</div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>MVR</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#2e7d32' }}>MVR {previewMVR}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#bbb', marginTop: 8, textAlign: 'center' }}>1 USD = {MVR_RATE} MVR</div>
            </div>
          )}

          {/* Quick category buttons */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>Quick select</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['Giveaway', 'Sample Testing', 'Marketing Ads', 'Instagram Ads', 'Packaging'].map(cat => (
                <button key={cat} onClick={() => setForm(p => ({ ...p, category: cat }))}
                  style={{ padding: '5px 12px', borderRadius: 99, border: '1px solid #ddd', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', background: form.category === cat ? '#FFA500' : '#fff', color: form.category === cat ? '#fff' : '#555', fontWeight: form.category === cat ? 600 : 400 }}>
                  {COST_CATEGORIES.find(c => c.value === cat)?.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={saveExpense} disabled={saving || !form.description || !form.amount}>
              {saving ? 'Saving…' : 'Add cost'}
            </Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
