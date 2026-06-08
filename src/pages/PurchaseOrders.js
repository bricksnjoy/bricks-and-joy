import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, StatusBadge, Spinner, FormRow, useToast, Toasts } from '../components/UI'
import { Plus, Trash2 } from 'lucide-react'

const STATUSES = [{ value: 'pending', label: 'Pending' }, { value: 'ordered', label: 'Ordered' }, { value: 'received', label: 'Received' }, { value: 'cancelled', label: 'Cancelled' }]
const EMPTY = { supplier_id: '', supplier_name: '', product_id: '', product_name: '', qty: 1, unit_cost: 0, status: 'pending', order_date: new Date().toISOString().split('T')[0], expected_date: '', notes: '' }

export default function PurchaseOrders() {
  const [pos, setPOs] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [supplierModal, setSupplierModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_name: '', email: '', phone: '', address: '' })
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [p, s, pr] = await Promise.all([
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('id, name, cost_price').order('name'),
    ])
    setPOs(p.data || [])
    setSuppliers(s.data || [])
    setProducts(pr.data || [])
    setLoading(false)
  }

  function openAdd() { setForm({ ...EMPTY, order_date: new Date().toISOString().split('T')[0] }); setModal(true) }

  function handleSupplierChange(e) {
    const s = suppliers.find(s => s.id === e.target.value)
    setForm(prev => ({ ...prev, supplier_id: e.target.value, supplier_name: s?.name || '' }))
  }

  function handleProductChange(e) {
    const p = products.find(p => p.id === e.target.value)
    setForm(prev => ({ ...prev, product_id: e.target.value, product_name: p?.name || '', unit_cost: p?.cost_price || 0 }))
  }

  async function save() {
    if (!form.product_id || !form.qty) return
    setSaving(true)
    const { error } = await supabase.from('purchase_orders').insert({
      ...form, qty: parseInt(form.qty), unit_cost: parseFloat(form.unit_cost)
    })
    setSaving(false)
    if (error) { toast.error('Failed to save'); return }
    toast.success('Purchase order added!')
    setModal(false)
    load()
  }

  async function updateStatus(id, status) {
    await supabase.from('purchase_orders').update({ status }).eq('id', id)
    // If received, update stock
    if (status === 'received') {
      const po = pos.find(p => p.id === id)
      if (po?.product_id) {
        const { data: prod } = await supabase.from('products').select('stock_qty').eq('id', po.product_id).single()
        if (prod) await supabase.from('products').update({ stock_qty: prod.stock_qty + po.qty }).eq('id', po.product_id)
        toast.success('Stock updated automatically!')
      }
    }
    load()
  }

  async function del(id) {
    if (!window.confirm('Delete this purchase order?')) return
    await supabase.from('purchase_orders').delete().eq('id', id)
    toast.success('Deleted')
    load()
  }

  async function saveSupplier() {
    if (!supplierForm.name) return
    setSaving(true)
    const { error } = await supabase.from('suppliers').insert(supplierForm)
    setSaving(false)
    if (error) { toast.error('Failed to save supplier'); return }
    toast.success('Supplier added!')
    setSupplierModal(false)
    setSupplierForm({ name: '', contact_name: '', email: '', phone: '', address: '' })
    load()
  }

  const f = k => e => setForm(prev => ({ ...prev, [k]: e.target.value }))
  const sf = k => e => setSupplierForm(prev => ({ ...prev, [k]: e.target.value }))

  const totalSpend = pos.filter(p => p.status === 'received').reduce((s, p) => s + Number(p.total_cost || 0), 0)

  const columns = [
    { key: 'supplier_name', label: 'Supplier', render: r => <span style={{ fontWeight: 500 }}>{r.supplier_name || '—'}</span> },
    { key: 'product_name', label: 'Product' },
    { key: 'qty', label: 'Qty' },
    { key: 'unit_cost', label: 'Unit cost', render: r => `MVR ${Number(r.unit_cost).toFixed(2)}` },
    { key: 'total_cost', label: 'Total', render: r => <span style={{ fontWeight: 500 }}>${Number(r.total_cost || 0).toFixed(2)}</span> },
    { key: 'order_date', label: 'Ordered', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.order_date}</span> },
    { key: 'expected_date', label: 'Expected', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.expected_date || '—'}</span> },
    { key: 'status', label: 'Status', render: r => (
      <select value={r.status} onChange={e => updateStatus(r.id, e.target.value)}
        style={{ border: 'none', background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
        {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    )},
    { key: 'actions', label: '', render: r => <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button> },
  ]

  return (
    <div>
      <PageHeader title="Purchase Orders" subtitle={`MVR ${totalSpend.toFixed(2)} received this period`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => setSupplierModal(true)}><Plus size={15} /> Add supplier</Button>
            <Button onClick={openAdd}><Plus size={15} /> New PO</Button>
          </div>
        } />

      {/* Suppliers quick view */}
      {suppliers.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {suppliers.map(s => (
            <div key={s.id} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: '6px 14px', fontSize: 12, color: '#555' }}>
              {s.name} {s.phone && <span style={{ color: '#aaa' }}>· {s.phone}</span>}
            </div>
          ))}
        </div>
      )}

      <Card>
        {loading ? <Spinner /> : <Table columns={columns} data={pos} emptyMessage="No purchase orders yet." />}
      </Card>

      {/* New PO modal */}
      {modal && (
        <Modal title="New purchase order" onClose={() => setModal(false)} width={520}>
          <FormRow>
            <Select label="Supplier" value={form.supplier_id} onChange={handleSupplierChange}
              options={[{ value: '', label: '— Select supplier —' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
              style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Select label="Product *" value={form.product_id} onChange={handleProductChange}
              options={[{ value: '', label: '— Select product —' }, ...products.map(p => ({ value: p.id, label: p.name }))]}
              style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Input label="Qty *" type="number" min="1" value={form.qty} onChange={f('qty')} />
            <Input label="Unit cost ($)" type="number" step="0.01" value={form.unit_cost} onChange={f('unit_cost')} />
          </FormRow>
          <FormRow>
            <Input label="Order date" type="date" value={form.order_date} onChange={f('order_date')} />
            <Input label="Expected delivery" type="date" value={form.expected_date} onChange={f('expected_date')} />
          </FormRow>
          <Select label="Status" value={form.status} onChange={f('status')} options={STATUSES} style={{ marginBottom: 12 }} />
          <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
            <strong>Order total:</strong> MVR {(parseFloat(form.qty || 0) * parseFloat(form.unit_cost || 0)).toFixed(2)}
            <span style={{ marginLeft: 12, color: '#aaa', fontSize: 12 }}>Marking as "Received" will automatically add to stock</span>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.product_id}>{saving ? 'Saving…' : 'Add order'}</Button>
          </div>
        </Modal>
      )}

      {/* Add supplier modal */}
      {supplierModal && (
        <Modal title="Add supplier" onClose={() => setSupplierModal(false)}>
          <FormRow>
            <Input label="Supplier name *" value={supplierForm.name} onChange={sf('name')} placeholder="e.g. LEGO Group, Mattel" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Input label="Contact person" value={supplierForm.contact_name} onChange={sf('contact_name')} placeholder="Name" />
            <Input label="Phone" value={supplierForm.phone} onChange={sf('phone')} placeholder="+1 xxx xxx xxxx" />
          </FormRow>
          <FormRow>
            <Input label="Email" type="email" value={supplierForm.email} onChange={sf('email')} placeholder="orders@supplier.com" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <Input label="Address" value={supplierForm.address} onChange={sf('address')} placeholder="City, Country" style={{ marginBottom: 16 }} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setSupplierModal(false)}>Cancel</Button>
            <Button onClick={saveSupplier} disabled={saving}>{saving ? 'Saving…' : 'Add supplier'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
