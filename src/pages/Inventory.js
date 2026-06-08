import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Badge, StockBadge, Spinner, FormRow, useToast, Toasts } from '../components/UI'
import { Plus, Trash2, Edit2 } from 'lucide-react'

const CATEGORIES = ['Building & Blocks', 'Action Figures', 'Dolls & Plush', 'Board Games', 'Outdoor & Sports', 'Educational', 'Vehicles & RC', 'Arts & Crafts', 'Puzzles', 'Other']
const AGE_RANGES = ['0–2', '3–5', '6–8', '9–12', '12+', 'All ages']

const EMPTY = { name: '', category: 'Building & Blocks', age_range: '3–5', brand: '', sku: '', stock_qty: 0, low_stock_threshold: 10, cost_price: 0, sell_price: 0, description: '' }

export default function Inventory() {
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'add' | 'edit'
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [p, s] = await Promise.all([
      supabase.from('products').select('*, suppliers(name)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('id, name')
    ])
    setProducts(p.data || [])
    setSuppliers(s.data || [])
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setModal('add') }
  function openEdit(p) { setForm(p); setModal('edit') }

  async function save() {
    if (!form.name) return
    setSaving(true)
    const payload = { ...form, stock_qty: parseInt(form.stock_qty) || 0, cost_price: parseFloat(form.cost_price) || 0, sell_price: parseFloat(form.sell_price) || 0 }
    const { error } = modal === 'add'
      ? await supabase.from('products').insert(payload)
      : await supabase.from('products').update(payload).eq('id', form.id)
    setSaving(false)
    if (error) { toast.error('Failed to save product'); return }
    toast.success(modal === 'add' ? 'Product added!' : 'Product updated!')
    setModal(null)
    load()
  }

  async function del(id) {
    if (!window.confirm('Delete this product?')) return
    await supabase.from('products').delete().eq('id', id)
    toast.success('Product deleted')
    load()
  }

  const f = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }))

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase()) ||
    (p.brand || '').toLowerCase().includes(search.toLowerCase())
  )

  const columns = [
    { key: 'name', label: 'Product', render: r => <span style={{ fontWeight: 500, color: '#0d1b2a' }}>{r.name}</span> },
    { key: 'category', label: 'Category', render: r => <Badge color="purple">{r.category}</Badge> },
    { key: 'age_range', label: 'Age', render: r => <Badge color="blue">{r.age_range}</Badge> },
    { key: 'brand', label: 'Brand', render: r => <span style={{ color: '#888' }}>{r.brand || '—'}</span> },
    { key: 'stock_qty', label: 'Stock', render: r => r.stock_qty },
    { key: 'cost_price', label: 'Cost', render: r => `$${Number(r.cost_price).toFixed(2)}` },
    { key: 'sell_price', label: 'Price', render: r => `$${Number(r.sell_price).toFixed(2)}` },
    { key: 'margin', label: 'Margin', render: r => {
      const m = r.sell_price > 0 ? Math.round((r.sell_price - r.cost_price) / r.sell_price * 100) : 0
      return <span style={{ color: m >= 40 ? '#2e7d32' : m >= 20 ? '#f57f17' : '#c62828', fontWeight: 500 }}>{m}%</span>
    }},
    { key: 'status', label: 'Status', render: r => <StockBadge qty={r.stock_qty} threshold={r.low_stock_threshold} /> },
    { key: 'actions', label: '', render: r => (
      <div style={{ display: 'flex', gap: 6 }}>
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Edit2 size={13} /></Button>
        <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button>
      </div>
    )},
  ]

  return (
    <div>
      <PageHeader title="Inventory" subtitle={`${products.length} products`}
        action={<Button onClick={openAdd}><Plus size={15} /> Add product</Button>} />

      <Card>
        <div style={{ marginBottom: 16 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
            style={{ padding: '9px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: 260, outline: 'none' }} />
        </div>
        {loading ? <Spinner /> : <Table columns={columns} data={filtered} emptyMessage="No products yet. Add your first toy!" />}
      </Card>

      {modal && (
        <Modal title={modal === 'add' ? 'Add product' : 'Edit product'} onClose={() => setModal(null)} width={560}>
          <FormRow>
            <Input label="Product name *" value={form.name} onChange={f('name')} placeholder="e.g. LEGO Classic Set" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Select label="Category" value={form.category} onChange={f('category')} options={CATEGORIES} />
            <Select label="Age range" value={form.age_range} onChange={f('age_range')} options={AGE_RANGES} />
          </FormRow>
          <FormRow>
            <Input label="Brand" value={form.brand} onChange={f('brand')} placeholder="e.g. LEGO, Mattel" />
            <Input label="SKU" value={form.sku} onChange={f('sku')} placeholder="Optional" />
          </FormRow>
          <FormRow>
            <Input label="Stock qty" type="number" value={form.stock_qty} onChange={f('stock_qty')} />
            <Input label="Low stock alert at" type="number" value={form.low_stock_threshold} onChange={f('low_stock_threshold')} />
          </FormRow>
          <FormRow>
            <Input label="Cost price ($)" type="number" step="0.01" value={form.cost_price} onChange={f('cost_price')} />
            <Input label="Sell price ($)" type="number" step="0.01" value={form.sell_price} onChange={f('sell_price')} />
          </FormRow>
          <Select label="Supplier" value={form.supplier_id || ''} onChange={f('supplier_id')}
            options={[{ value: '', label: '— None —' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
            style={{ marginBottom: 16 }} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : modal === 'add' ? 'Add product' : 'Save changes'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
