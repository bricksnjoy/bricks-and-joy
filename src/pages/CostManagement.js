import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, Edit2 } from 'lucide-react'

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

const CAT_COLORS = {
  'Giveaway': 'purple', 'Sample Testing': 'blue', 'Marketing Ads': 'amber',
  'Instagram Ads': 'red', 'Facebook Ads': 'blue', 'Packaging': 'green',
  'Shipping': 'blue', 'Staff / Salary': 'gray', 'Rent / Warehouse': 'gray',
  'Utilities': 'amber', 'Returns / Refunds': 'red', 'Other': 'gray',
}

const EMPTY = { description: '', category: 'Marketing Ads', amount: '', currency: 'MVR', expense_date: new Date().toISOString().split('T')[0] }

export default function CostManagement() {
  const [costs, setCosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [filterCat, setFilterCat] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('expenses').select('*').order('expense_date', { ascending: false })
    setCosts(data || [])
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setEditItem(null); setModal(true) }
  function openEdit(item) {
    setForm({ ...item, currency: 'MVR', amount: item.amount })
    setEditItem(item)
    setModal(true)
  }

  async function save() {
    if (!form.description || !form.amount) return
    setSaving(true)
    const amountMVR = form.currency === 'USD' ? parseFloat(form.amount) * MVR_RATE : parseFloat(form.amount)
    const payload = { description: form.description, category: form.category, amount: parseFloat(amountMVR.toFixed(2)), expense_date: form.expense_date }
    const { error } = editItem
      ? await supabase.from('expenses').update(payload).eq('id', editItem.id)
      : await supabase.from('expenses').insert(payload)
    setSaving(false)
    if (error) { toast.error('Failed to save'); return }
    toast.success(editItem ? 'Cost updated!' : 'Cost added!')
    setModal(false); load()
  }

  async function del(id) {
    if (!window.confirm('Delete this cost?')) return
    await supabase.from('expenses').delete().eq('id', id)
    toast.success('Deleted'); load()
  }

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const months = [...new Set(costs.map(c => c.expense_date?.slice(0, 7)).filter(Boolean))].sort().reverse()
  const filtered = costs.filter(c => {
    const catOk = filterCat === 'all' || c.category === filterCat
    const monthOk = filterMonth === 'all' || c.expense_date?.startsWith(filterMonth)
    return catOk && monthOk
  })

  const total = filtered.reduce((s, c) => s + Number(c.amount || 0), 0)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisMonthTotal = costs.filter(c => c.expense_date?.startsWith(thisMonth)).reduce((s, c) => s + Number(c.amount || 0), 0)

  const byCat = {}
  costs.forEach(c => { byCat[c.category] = (byCat[c.category] || 0) + Number(c.amount || 0) })
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]

  const previewMVR = form.currency === 'USD' ? (parseFloat(form.amount || 0) * MVR_RATE).toFixed(2) : parseFloat(form.amount || 0).toFixed(2)
  const previewUSD = form.currency === 'MVR' ? (parseFloat(form.amount || 0) / MVR_RATE).toFixed(2) : parseFloat(form.amount || 0).toFixed(2)

  const columns = [
    { key: 'expense_date', label: 'Date', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.expense_date}</span> },
    { key: 'description', label: 'Description', render: r => <span style={{ fontWeight: 500 }}>{r.description}</span> },
    { key: 'category', label: 'Category', render: r => <Badge color={CAT_COLORS[r.category] || 'gray'}>{COST_CATEGORIES.find(c => c.value === r.category)?.label || r.category}</Badge> },
    { key: 'amount', label: 'Amount (MVR)', render: r => <span style={{ fontWeight: 700, color: '#c62828' }}>MVR {Number(r.amount).toFixed(2)}</span> },
    { key: 'amount_usd', label: 'Approx USD', render: r => <span style={{ color: '#aaa', fontSize: 12 }}>≈ ${(Number(r.amount) / MVR_RATE).toFixed(2)}</span> },
    { key: 'actions', label: '', render: r => (
      <div style={{ display: 'flex', gap: 6 }}>
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Edit2 size={13} /></Button>
        <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button>
      </div>
    )},
  ]

  return (
    <div>
      <style>{`
        .cm-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 24px; }
        .cm-split { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
        @media (max-width: 768px) { .cm-grid { grid-template-columns: repeat(2,1fr)!important; } .cm-split { grid-template-columns: 1fr!important; } }
      `}</style>

      <PageHeader title="Cost Management" subtitle="Track all business costs — giveaways, ads, samples, operations"
        action={<Button onClick={openAdd}><Plus size={15} /> Add cost</Button>} />

      {/* Summary */}
      <div className="cm-grid">
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Total costs</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#c62828' }}>MVR {total.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{filtered.length} entries · ≈ ${(total / MVR_RATE).toFixed(2)}</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>This month</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#f57f17' }}>MVR {thisMonthTotal.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{new Date().toLocaleDateString('en', { month: 'long', year: 'numeric' })}</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
          <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Top category</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0d1b2a' }}>{topCat ? COST_CATEGORIES.find(c => c.value === topCat[0])?.label || topCat[0] : '—'}</div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{topCat ? `MVR ${topCat[1].toFixed(2)}` : 'No data yet'}</div>
        </div>
      </div>

      <div className="cm-split">
        <Card>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
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
                style={{ padding: '7px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 12, background: '#fff', cursor: 'pointer', color: '#999' }}>Clear</button>
            )}
          </div>
          {loading ? <Spinner /> : <Table columns={columns} data={filtered} emptyMessage="No costs yet. Add your first cost above." />}
        </Card>

        {/* Category breakdown */}
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 16 }}>By category</h3>
          {Object.keys(byCat).length === 0 ? <p style={{ color: '#aaa', fontSize: 13 }}>No data yet.</p>
            : Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
              const pct = total > 0 ? (amt / total * 100).toFixed(0) : 0
              const catObj = COST_CATEGORIES.find(c => c.value === cat)
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                    <span style={{ fontWeight: 500 }}>{catObj?.label || cat}</span>
                    <span style={{ color: '#c62828', fontWeight: 700 }}>MVR {amt.toFixed(2)}</span>
                  </div>
                  <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#FFA500', borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{pct}% · ≈ ${(amt / MVR_RATE).toFixed(2)}</div>
                </div>
              )
            })}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #eee', fontSize: 11, color: '#aaa', textAlign: 'center' }}>Rate: 1 USD = {MVR_RATE} MVR</div>
        </Card>
      </div>

      {modal && (
        <Modal title={editItem ? 'Edit cost' : 'Add cost'} onClose={() => setModal(false)}>
          <FormRow>
            <Input label="Description *" value={form.description} onChange={f('description')} placeholder="e.g. Instagram giveaway for June" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Select label="Category *" value={form.category} onChange={f('category')} options={COST_CATEGORIES.map(c => ({ value: c.value, label: c.label }))} />
            <Input label="Date" type="date" value={form.expense_date} onChange={f('expense_date')} />
          </FormRow>

          {/* Currency + Amount */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>Amount *</label>
            <div style={{ display: 'flex', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
              <button onClick={() => setForm(p => ({ ...p, currency: 'MVR' }))}
                style={{ padding: '9px 16px', border: 'none', borderRight: '1px solid #ddd', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: form.currency === 'MVR' ? '#FFA500' : '#f8f8f8', color: form.currency === 'MVR' ? '#fff' : '#666', transition: 'all 0.15s' }}>MVR</button>
              <button onClick={() => setForm(p => ({ ...p, currency: 'USD' }))}
                style={{ padding: '9px 16px', border: 'none', borderRight: '1px solid #ddd', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: form.currency === 'USD' ? '#FFA500' : '#f8f8f8', color: form.currency === 'USD' ? '#fff' : '#666', transition: 'all 0.15s' }}>USD</button>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={f('amount')} placeholder="0.00"
                style={{ flex: 1, padding: '9px 12px', border: 'none', fontSize: 16, fontFamily: 'inherit', outline: 'none' }} />
            </div>
          </div>

          {parseFloat(form.amount) > 0 && (
            <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-around' }}>
              <div style={{ textAlign: 'center' }}><div style={{ fontSize: 11, color: '#aaa' }}>MVR</div><div style={{ fontSize: 18, fontWeight: 800, color: '#1D9E75' }}>MVR {previewMVR}</div></div>
              <div style={{ fontSize: 18, color: '#ddd', alignSelf: 'center' }}>⇄</div>
              <div style={{ textAlign: 'center' }}><div style={{ fontSize: 11, color: '#aaa' }}>USD</div><div style={{ fontSize: 18, fontWeight: 800, color: '#1565c0' }}>${previewUSD}</div></div>
            </div>
          )}

          {/* Quick category */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>Quick select</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['Giveaway', 'Sample Testing', 'Marketing Ads', 'Instagram Ads', 'Packaging', 'Shipping'].map(cat => (
                <button key={cat} onClick={() => setForm(p => ({ ...p, category: cat }))}
                  style={{ padding: '5px 12px', borderRadius: 99, border: '1px solid #ddd', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', background: form.category === cat ? '#FFA500' : '#fff', color: form.category === cat ? '#fff' : '#555', fontWeight: form.category === cat ? 600 : 400 }}>
                  {COST_CATEGORIES.find(c => c.value === cat)?.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.description || !form.amount}>{saving ? 'Saving…' : editItem ? 'Save changes' : 'Add cost'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
