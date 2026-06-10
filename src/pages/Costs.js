import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, MetricCard, Badge } from '../components/UI'
import { Plus, Trash2, TrendingDown, Gift, Megaphone, Package, FlaskConical, MoreHorizontal } from 'lucide-react'

const COST_CATEGORIES = [
  { value: 'Giveaway', label: '🎁 Giveaway', icon: '🎁' },
  { value: 'Sample Testing', label: '🧪 Sample Testing', icon: '🧪' },
  { value: 'Marketing Ads', label: '📣 Marketing Ads', icon: '📣' },
  { value: 'Instagram Ads', label: '📸 Instagram Ads', icon: '📸' },
  { value: 'Facebook Ads', label: '👥 Facebook Ads', icon: '👥' },
  { value: 'Packaging', label: '📦 Packaging', icon: '📦' },
  { value: 'Shipping', label: '🚚 Shipping', icon: '🚚' },
  { value: 'Staff / Salary', label: '👤 Staff / Salary', icon: '👤' },
  { value: 'Rent / Warehouse', label: '🏪 Rent / Warehouse', icon: '🏪' },
  { value: 'Utilities', label: '💡 Utilities', icon: '💡' },
  { value: 'Returns / Refunds', label: '↩️ Returns / Refunds', icon: '↩️' },
  { value: 'Other', label: '📝 Other', icon: '📝' },
]

const EMPTY = {
  description: '',
  category: 'Marketing Ads',
  amount: '',
  quantity: 1,
  expense_date: new Date().toISOString().split('T')[0],
  notes: ''
}

const categoryColors = {
  'Giveaway': 'purple',
  'Sample Testing': 'blue',
  'Marketing Ads': 'amber',
  'Instagram Ads': 'red',
  'Facebook Ads': 'blue',
  'Packaging': 'green',
  'Shipping': 'teal',
  'Staff / Salary': 'gray',
  'Rent / Warehouse': 'gray',
  'Utilities': 'amber',
  'Returns / Refunds': 'red',
  'Other': 'gray',
}

export default function Costs() {
  const [costs, setCosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [filterCat, setFilterCat] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .order('expense_date', { ascending: false })
    setCosts(data || [])
    setLoading(false)
  }

  async function save() {
    if (!form.description || !form.amount) return
    setSaving(true)
    const { error } = await supabase.from('expenses').insert({
      description: form.description,
      category: form.category,
      amount: parseFloat(form.amount) * parseInt(form.quantity || 1),
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

  // Filter
  const months = [...new Set(costs.map(c => c.expense_date?.slice(0, 7)).filter(Boolean))].sort().reverse()
  const filtered = costs.filter(c => {
    const catMatch = filterCat === 'all' || c.category === filterCat
    const monthMatch = filterMonth === 'all' || c.expense_date?.startsWith(filterMonth)
    return catMatch && monthMatch
  })

  // Stats
  const totalCost = filtered.reduce((s, c) => s + Number(c.amount || 0), 0)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisMonthCost = costs.filter(c => c.expense_date?.startsWith(thisMonth)).reduce((s, c) => s + Number(c.amount || 0), 0)

  // By category
  const byCat = {}
  costs.forEach(c => { byCat[c.category] = (byCat[c.category] || 0) + Number(c.amount || 0) })
  const topCategory = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]

  const columns = [
    { key: 'expense_date', label: 'Date', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.expense_date}</span> },
    { key: 'description', label: 'Description', render: r => <span style={{ fontWeight: 500 }}>{r.description}</span> },
    { key: 'category', label: 'Category', render: r => {
      const cat = COST_CATEGORIES.find(c => c.value === r.category)
      return <Badge color={categoryColors[r.category] || 'gray'}>{cat?.icon} {r.category}</Badge>
    }},
    { key: 'amount', label: 'Amount', render: r => <span style={{ fontWeight: 600, color: '#c62828' }}>-${Number(r.amount).toFixed(2)}</span> },
    { key: 'actions', label: '', render: r => <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button> },
  ]

  return (
    <div>
      <style>{`
        .costs-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 24px; }
        .costs-split { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 20px; }
        @media (max-width: 768px) {
          .costs-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .costs-split { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <PageHeader
        title="Cost Management"
        subtitle="Track giveaways, samples, ads and all business costs"
        action={<Button onClick={() => { setForm(EMPTY); setModal(true) }}><Plus size={15} /> Add cost</Button>}
      />

      {/* Summary metrics */}
      <div className="costs-grid">
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Total costs</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#c62828' }}>${totalCost.toFixed(2)}</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{filtered.length} entries</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>This month</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f57f17' }}>${thisMonthCost.toFixed(2)}</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{new Date().toLocaleDateString('en', { month: 'long', year: 'numeric' })}</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Top category</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0d1b2a' }}>{topCategory ? topCategory[0] : '—'}</div>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{topCategory ? `$${topCategory[1].toFixed(2)}` : 'No data yet'}</div>
        </div>
      </div>

      <div className="costs-split">
        {/* Main costs table */}
        <Card>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              style={{ padding: '7px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
              <option value="all">All categories</option>
              {COST_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              style={{ padding: '7px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
              <option value="all">All months</option>
              {months.map(m => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en', { month: 'long', year: 'numeric' })}</option>)}
            </select>
            {(filterCat !== 'all' || filterMonth !== 'all') && (
              <button onClick={() => { setFilterCat('all'); setFilterMonth('all') }}
                style={{ padding: '7px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 12, background: '#fff', cursor: 'pointer', color: '#999' }}>
                Clear filters
              </button>
            )}
          </div>
          {loading ? <Spinner /> : <Table columns={columns} data={filtered} emptyMessage="No costs recorded yet. Add your first cost above." />}
        </Card>

        {/* Category breakdown */}
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 16 }}>By category</h3>
          {Object.keys(byCat).length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 13 }}>No data yet.</p>
          ) : Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
            const total = Object.values(byCat).reduce((s, v) => s + v, 0)
            const pct = total > 0 ? (amt / total * 100).toFixed(0) : 0
            const catObj = COST_CATEGORIES.find(c => c.value === cat)
            return (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                  <span style={{ fontWeight: 500 }}>{catObj?.icon} {cat}</span>
                  <span style={{ color: '#c62828', fontWeight: 600 }}>${amt.toFixed(2)}</span>
                </div>
                <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: '#FFA500', borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{pct}% of total</div>
              </div>
            )
          })}
        </Card>
      </div>

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
          <FormRow>
            <Input label="Amount ($) *" type="number" step="0.01" min="0" value={form.amount} onChange={f('amount')} placeholder="0.00" />
            <Input label="Quantity" type="number" min="1" value={form.quantity} onChange={f('quantity')}
              placeholder="1" />
          </FormRow>

          {/* Quick category buttons */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>Quick select</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['Giveaway', 'Sample Testing', 'Marketing Ads', 'Instagram Ads', 'Packaging'].map(cat => (
                <button key={cat} onClick={() => setForm(p => ({ ...p, category: cat }))}
                  style={{
                    padding: '5px 12px', borderRadius: 99, border: '1px solid #ddd',
                    fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                    background: form.category === cat ? '#FFA500' : '#fff',
                    color: form.category === cat ? '#fff' : '#555',
                    fontWeight: form.category === cat ? 600 : 400
                  }}>
                  {COST_CATEGORIES.find(c => c.value === cat)?.icon} {cat}
                </button>
              ))}
            </div>
          </div>

          {form.amount && form.quantity > 1 && (
            <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
              <strong>Total:</strong> ${(parseFloat(form.amount || 0) * parseInt(form.quantity || 1)).toFixed(2)}
              <span style={{ color: '#aaa', marginLeft: 8 }}>({form.quantity} × ${parseFloat(form.amount || 0).toFixed(2)})</span>
            </div>
          )}

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
