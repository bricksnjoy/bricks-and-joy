import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, StatusBadge, Spinner, FormRow, useToast, Toasts } from '../components/UI'
import { Plus, Trash2 } from 'lucide-react'

const CHANNELS = ['Retail store', 'Online', 'Wholesale', 'Pop-up / Market', 'Phone']
const STATUSES = [{ value: 'pending', label: 'Pending' }, { value: 'transit', label: 'Dispatched' }, { value: 'delivered', label: 'Delivered' }, { value: 'cancelled', label: 'Cancelled' }]
const EMPTY = { customer_id: '', customer_name: '', product_id: '', product_name: '', qty: 1, unit_price: 0, channel: 'Retail store', status: 'pending', order_date: new Date().toISOString().split('T')[0], notes: '' }

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, c, p] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name').order('name'),
      supabase.from('products').select('id, name, sell_price').order('name'),
    ])
    setOrders(o.data || [])
    setCustomers(c.data || [])
    setProducts(p.data || [])
    setLoading(false)
  }

  function openAdd() { setForm({ ...EMPTY, order_date: new Date().toISOString().split('T')[0] }); setModal(true) }

  function handleProductChange(e) {
    const prod = products.find(p => p.id === e.target.value)
    setForm(prev => ({ ...prev, product_id: e.target.value, product_name: prod?.name || '', unit_price: prod?.sell_price || 0 }))
  }

  function handleCustomerChange(e) {
    const cust = customers.find(c => c.id === e.target.value)
    setForm(prev => ({ ...prev, customer_id: e.target.value, customer_name: cust?.name || '' }))
  }

  async function save() {
    if (!form.product_id || !form.qty) return
    setSaving(true)
    const { error } = await supabase.from('orders').insert({
      ...form, qty: parseInt(form.qty), unit_price: parseFloat(form.unit_price)
    })
    setSaving(false)
    if (error) { toast.error('Failed to save order'); return }
    toast.success('Order added!')
    setModal(false)
    load()
  }

  async function updateStatus(id, status) {
    await supabase.from('orders').update({ status }).eq('id', id)
    load()
  }

  async function del(id) {
    if (!window.confirm('Delete this order?')) return
    await supabase.from('orders').delete().eq('id', id)
    toast.success('Order deleted')
    load()
  }

  const f = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }))

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter)
  const totalRevenue = orders.filter(o => o.status === 'delivered').reduce((s, o) => s + Number(o.total_price || 0), 0)

  const columns = [
    { key: 'customer_name', label: 'Customer', render: r => <span style={{ fontWeight: 500 }}>{r.customer_name || '—'}</span> },
    { key: 'product_name', label: 'Product' },
    { key: 'qty', label: 'Qty' },
    { key: 'unit_price', label: 'Unit price', render: r => `MVR ${Number(r.unit_price).toFixed(2)}` },
    { key: 'total_price', label: 'Total', render: r => <span style={{ fontWeight: 500 }}>${Number(r.total_price || 0).toFixed(2)}</span> },
    { key: 'channel', label: 'Channel', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.channel}</span> },
    { key: 'order_date', label: 'Date', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.order_date}</span> },
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
      <PageHeader title="Orders" subtitle={`MVR ${totalRevenue.toFixed(2)} delivered revenue`}
        action={<Button onClick={openAdd}><Plus size={15} /> New order</Button>} />

      <Card>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {['all', 'pending', 'transit', 'delivered', 'cancelled'].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding: '6px 14px', borderRadius: 99, border: '1px solid #ddd', fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit', fontWeight: filter === s ? 600 : 400,
              background: filter === s ? '#0d1b2a' : '#fff', color: filter === s ? '#fff' : '#666'
            }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
              <span style={{ marginLeft: 6, opacity: 0.6 }}>
                {s === 'all' ? orders.length : orders.filter(o => o.status === s).length}
              </span>
            </button>
          ))}
        </div>
        {loading ? <Spinner /> : <Table columns={columns} data={filtered} emptyMessage="No orders yet." />}
      </Card>

      {modal && (
        <Modal title="New order" onClose={() => setModal(false)} width={520}>
          <FormRow>
            <Select label="Customer" value={form.customer_id} onChange={handleCustomerChange}
              options={[{ value: '', label: '— Walk-in / No customer —' }, ...customers.map(c => ({ value: c.id, label: c.name }))]}
              style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Select label="Product *" value={form.product_id} onChange={handleProductChange}
              options={[{ value: '', label: '— Select product —' }, ...products.map(p => ({ value: p.id, label: p.name }))]}
              style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Input label="Qty *" type="number" min="1" value={form.qty} onChange={f('qty')} />
            <Input label="Unit price ($)" type="number" step="0.01" value={form.unit_price} onChange={f('unit_price')} />
          </FormRow>
          <FormRow>
            <Select label="Channel" value={form.channel} onChange={f('channel')} options={CHANNELS} />
            <Select label="Status" value={form.status} onChange={f('status')} options={STATUSES} />
          </FormRow>
          <FormRow>
            <Input label="Order date" type="date" value={form.order_date} onChange={f('order_date')} />
          </FormRow>
          <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
            <strong>Order total:</strong> MVR {(parseFloat(form.qty || 0) * parseFloat(form.unit_price || 0)).toFixed(2)}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.product_id}>{saving ? 'Saving…' : 'Add order'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
