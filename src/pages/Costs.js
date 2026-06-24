import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, Gift, FlaskConical, Megaphone, Instagram, Users, Package, Truck, User, Store, Lightbulb, Undo2, FileText, ArrowLeftRight, Tag, PieChart, Filter } from 'lucide-react'

const MVR_RATE = 15.42 // 1 USD = 15.42 MVR (update as needed)

const COST_CATEGORIES = [
  { value: 'Meta Ads', label: 'Meta Ads', icon: Megaphone },
  { value: 'Promotions', label: 'Promotions', icon: Tag },
  { value: 'Sponsorship', label: 'Sponsorship', icon: Users },
  { value: 'Giveaway', label: 'Giveaway', icon: Gift },
  { value: 'Sample Testing', label: 'Sample Testing', icon: FlaskConical },
  { value: 'Packaging', label: 'Packaging', icon: Package },
  { value: 'Shipping', label: 'Shipping', icon: Truck },
  { value: 'Delivery', label: 'Delivery', icon: User },
  { value: 'Returns / Refunds', label: 'Returns / Refunds', icon: Undo2 },
  { value: 'Other', label: 'Other', icon: FileText },
]

// Inline category label with its Lucide icon
function CatLabel({ value, size = 13, color = 'currentColor' }) {
  const cat = COST_CATEGORIES.find(c => c.value === value)
  const Icon = cat?.icon || Tag
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon size={size} color={color} style={{ flexShrink: 0 }} />
      {cat?.label || value}
    </span>
  )
}

const categoryColors = {
  'Meta Ads': 'amber', 'Promotions': 'purple', 'Sponsorship': 'blue',
  'Giveaway': 'purple', 'Sample Testing': 'blue', 'Packaging': 'green',
  'Shipping': 'blue', 'Delivery': 'amber',
  'Returns / Refunds': 'red', 'Other': 'gray',
}

const EMPTY = {
  description: '', category: 'Meta Ads', amount: '',
  currency: 'USD', expense_date: new Date().toISOString().split('T')[0],
}

export default function Costs() {
  const [costs, setCosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [filterCat, setFilterCat] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [displayCurrency, setDisplayCurrency] = useState('USD')
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('expenses').select('*').order('expense_date', { ascending: false })
    setCosts(data || [])
    setLoading(false)
  }

  async function save() {
    if (!form.description || !form.amount) return
    setSaving(true)
    // Always store in USD internally
    const amountUSD = form.currency === 'MVR'
      ? parseFloat(form.amount) / MVR_RATE
      : parseFloat(form.amount)
    const { error } = await supabase.from('expenses').insert({
      description: `${form.description} [${form.currency}]`,
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

  async function del(id) {
    if (!window.confirm('Delete this cost entry?')) return
    await supabase.from('expenses').delete().eq('id', id)
    toast.success('Deleted')
    load()
  }

  const f = k => e => setForm(prev => ({ ...prev, [k]: e.target.value }))

  // Convert display amount, labelled with the currently selected currency
  function displayAmt(usdAmount) {
    if (displayCurrency === 'MVR') return `MVR ${(usdAmount * MVR_RATE).toFixed(2)}`
    return `$${Number(usdAmount).toFixed(2)}`
  }

  // Filter
  const months = [...new Set(costs.map(c => c.expense_date?.slice(0, 7)).filter(Boolean))].sort().reverse()
  const filtered = costs.filter(c => {
    const catMatch = filterCat === 'all' || c.category === filterCat
    const monthMatch = filterMonth === 'all' || c.expense_date?.startsWith(filterMonth)
    return catMatch && monthMatch
  })

  const totalUSD = filtered.reduce((s, c) => s + Number(c.amount || 0), 0)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisMonthUSD = costs.filter(c => c.expense_date?.startsWith(thisMonth)).reduce((s, c) => s + Number(c.amount || 0), 0)

  const byCat = {}
  costs.forEach(c => { byCat[c.category] = (byCat[c.category] || 0) + Number(c.amount || 0) })
  const topCategory = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]

  // Preview amount in both currencies
  const previewUSD = form.currency === 'MVR'
    ? (parseFloat(form.amount || 0) / MVR_RATE).toFixed(2)
    : parseFloat(form.amount || 0).toFixed(2)
  const previewMVR = form.currency === 'USD'
    ? (parseFloat(form.amount || 0) * MVR_RATE).toFixed(2)
    : parseFloat(form.amount || 0).toFixed(2)

  const columns = [
    { key: 'expense_date', label: 'Date', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.expense_date}</span> },
    { key: 'description', label: 'Description', render: r => <span style={{ fontWeight: 500 }}>{r.description.replace(/ \[(USD|MVR)\]/, '')}</span> },
    { key: 'category', label: 'Category', render: r => (
      <Badge color={categoryColors[r.category] || 'gray'}><CatLabel value={r.category} size={11} /></Badge>
    )},
    { key: 'amount_usd', label: 'USD', render: r => <span style={{ fontWeight: 600, color: '#378ADD' }}>${Number(r.amount).toFixed(2)}</span> },
    { key: 'amount_mvr', label: 'MVR', render: r => <span style={{ fontWeight: 600, color: '#1D9E75' }}>MVR {(Number(r.amount) * MVR_RATE).toFixed(2)}</span> },
    { key: 'actions', label: '', render: r => <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button> },
  ]

  return (
    <div>
      <style>{`
        .costs-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 24px; }
        .costs-split { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 20px; }
        .currency-toggle { display: flex; background: #f0f0f0; border-radius: 8px; padding: 3px; }
        .currency-btn { padding: 6px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.15s; font-family: inherit; }
        @media (max-width: 768px) {
          .costs-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .costs-split { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <PageHeader
        title="Cost Management"
        subtitle="Track giveaways, samples, ads and all business costs"
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Display currency toggle */}
            <div className="currency-toggle">
              <button className="currency-btn" onClick={() => setDisplayCurrency('USD')}
                style={{ background: displayCurrency === 'USD' ? '#fff' : 'transparent', color: displayCurrency === 'USD' ? '#0d1b2a' : '#888', boxShadow: displayCurrency === 'USD' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                $ USD
              </button>
              <button className="currency-btn" onClick={() => setDisplayCurrency('MVR')}
                style={{ background: displayCurrency === 'MVR' ? '#fff' : 'transparent', color: displayCurrency === 'MVR' ? '#0d1b2a' : '#888', boxShadow: displayCurrency === 'MVR' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
                MVR
              </button>
            </div>
            <Button onClick={() => { setForm(EMPTY); setModal(true) }}><Plus size={15} /> Add cost</Button>
          </div>
        }
      />

      {/* Summary metrics */}
      <div className="costs-grid">
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Total costs</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#E24B4A' }}>{displayAmt(totalUSD)}</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{displayCurrency === 'USD' ? `MVR ${(totalUSD * MVR_RATE).toFixed(2)}` : `$${totalUSD.toFixed(2)}`}</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>This month</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#FFA500' }}>{displayAmt(thisMonthUSD)}</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{displayCurrency === 'USD' ? `MVR ${(thisMonthUSD * MVR_RATE).toFixed(2)}` : `$${thisMonthUSD.toFixed(2)}`}</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Top category</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0d1b2a' }}>{topCategory ? <CatLabel value={topCategory[0]} size={17} color="#FFA500" /> : '—'}</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{topCategory ? displayAmt(topCategory[1]) : 'No data yet'}</div>
        </div>
      </div>

      <div className="costs-split">
        {/* Table */}
        <Card>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <Filter size={15} color="#bbb" style={{ flexShrink: 0 }} />
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              style={{ padding: '7px 12px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', color: '#0d1b2a', background: '#fff', cursor: 'pointer', outline: 'none' }}>
              <option value="all">All categories</option>
              {COST_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              style={{ padding: '7px 12px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', color: '#0d1b2a', background: '#fff', cursor: 'pointer', outline: 'none' }}>
              <option value="all">All months</option>
              {months.map(m => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en', { month: 'long', year: 'numeric' })}</option>)}
            </select>
          </div>
          {loading ? <Spinner /> : <Table columns={columns} data={filtered} emptyMessage="No costs yet. Add your first cost above." />}
        </Card>

        {/* Category breakdown */}
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0d1b2a', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 7 }}><PieChart size={15} color="#FFA500" /> By category</h3>
          {Object.keys(byCat).length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 13 }}>No data yet.</p>
          ) : Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, usdAmt]) => {
            const total = Object.values(byCat).reduce((s, v) => s + v, 0)
            const pct = total > 0 ? (usdAmt / total * 100).toFixed(0) : 0
            return (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                  <span style={{ fontWeight: 500, color: '#0d1b2a' }}><CatLabel value={cat} size={13} color="#888" /></span>
                  <span style={{ color: '#E24B4A', fontWeight: 600 }}>{displayAmt(usdAmt)}</span>
                </div>
                <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: '#FFA500', borderRadius: 3, transition: 'width 0.4s ease' }} />
                </div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{pct}% of total</div>
              </div>
            )
          })}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #eee', fontSize: 12, color: '#aaa', textAlign: 'center' }}>
            Rate: 1 USD = {MVR_RATE} MVR
          </div>
        </Card>
      </div>

      {/* Add cost modal */}
      {modal && (
        <Modal title="Add cost" subtitle="Log a new business expense" onClose={() => setModal(false)}>
          <FormRow>
            <Input label="Description *" value={form.description} onChange={f('description')}
              placeholder="e.g. Instagram giveaway for June" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Select label="Category *" value={form.category} onChange={f('category')}
              options={COST_CATEGORIES.map(c => ({ value: c.value, label: c.label }))} />
            <Input label="Date" type="date" value={form.expense_date} onChange={f('expense_date')} />
          </FormRow>

          {/* Amount + Currency */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>Amount & Currency *</label>
            <div style={{ display: 'flex', gap: 0, border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
              {/* Currency selector */}
              <div style={{ display: 'flex', borderRight: '1px solid #ddd' }}>
                <button onClick={() => setForm(p => ({ ...p, currency: 'USD' }))}
                  style={{ padding: '9px 14px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', background: form.currency === 'USD' ? '#FFA500' : '#f8f8f8', color: form.currency === 'USD' ? '#fff' : '#666', transition: 'all 0.15s' }}>
                  $ USD
                </button>
                <button onClick={() => setForm(p => ({ ...p, currency: 'MVR' }))}
                  style={{ padding: '9px 14px', border: 'none', borderLeft: '1px solid #ddd', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', background: form.currency === 'MVR' ? '#FFA500' : '#f8f8f8', color: form.currency === 'MVR' ? '#fff' : '#666', transition: 'all 0.15s' }}>
                  MVR
                </button>
              </div>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={f('amount')}
                placeholder="0.00"
                style={{ flex: 1, padding: '9px 12px', border: 'none', fontSize: 16, fontFamily: 'inherit', outline: 'none', background: '#fff' }} />
            </div>
          </div>

          {/* Live conversion preview */}
          {form.amount > 0 && (
            <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Conversion</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#aaa' }}>USD</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#378ADD' }}>${previewUSD}</div>
                </div>
                <ArrowLeftRight size={20} color="#ddd" />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#aaa' }}>MVR</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1D9E75' }}>MVR {previewMVR}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#bbb', marginTop: 8, textAlign: 'center' }}>Rate: 1 USD = {MVR_RATE} MVR</div>
            </div>
          )}

          {/* Quick category buttons */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>Quick select</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['Meta Ads', 'Promotions', 'Sponsorship', 'Delivery', 'Packaging'].map(cat => (
                <button key={cat} onClick={() => setForm(p => ({ ...p, category: cat }))}
                  style={{ padding: '5px 12px', borderRadius: 99, border: '1px solid #ddd', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', background: form.category === cat ? '#FFA500' : '#fff', color: form.category === cat ? '#fff' : '#555', fontWeight: form.category === cat ? 600 : 500, transition: 'all 0.15s' }}>
                  <CatLabel value={cat} size={12} />
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.description || !form.amount}>
              {saving ? 'Saving…' : 'Add cost'}
            </Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
