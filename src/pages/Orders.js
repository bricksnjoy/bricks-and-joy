import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, StatusBadge, StockBadge, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, AlertTriangle, Package, Upload, Eye, CreditCard, X } from 'lucide-react'

const CHANNELS = ['Retail store','Online','Wholesale','Pop-up / Market','Instagram','Phone']
const STATUSES = [{ value: 'pending', label: 'Pending' },{ value: 'transit', label: 'Dispatched' },{ value: 'delivered', label: 'Delivered' },{ value: 'cancelled', label: 'Cancelled' }]
const PAY_METHODS = ['Cash','BML Transfer','Bank Transfer','Card','Other']
const EMPTY = { customer_id:'', customer_name:'', product_id:'', product_name:'', qty:1, unit_price:0, channel:'Retail store', status:'pending', order_date: new Date().toISOString().split('T')[0], notes:'', payment_status:'unpaid', payment_method:'', transfer_reference:'', invoice_number:'' }

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [viewModal, setViewModal] = useState(null)
  const [payModal, setPayModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [payForm, setPayForm] = useState({ payment_method: 'Cash', transfer_reference: '', transfer_slip_url: '', payment_status: 'paid' })
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')
  const [payFilter, setPayFilter] = useState('all')
  const [uploadingSlip, setUploadingSlip] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, c, p] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name').order('name'),
      supabase.from('products').select('*').order('name'),
    ])
    setOrders(o.data || [])
    setCustomers(c.data || [])
    setProducts(p.data || [])
    setLoading(false)
  }

  function openAdd() { 
    const num = `INV-${Date.now().toString().slice(-6)}`
    setForm({ ...EMPTY, order_date: new Date().toISOString().split('T')[0], invoice_number: num })
    setModal(true) 
  }

  function handleProductChange(e) {
    const prod = products.find(p => p.id === e.target.value)
    setForm(prev => ({ ...prev, product_id: e.target.value, product_name: prod?.name || '', unit_price: prod?.sell_price || 0 }))
  }

  function handleCustomerChange(e) {
    const cust = customers.find(c => c.id === e.target.value)
    setForm(prev => ({ ...prev, customer_id: e.target.value, customer_name: cust?.name || '' }))
  }

  const selectedProduct = products.find(p => p.id === form.product_id)
  const availableStock = selectedProduct?.stock_qty || 0
  const stockAfter = availableStock - parseInt(form.qty || 0)
  const lowThreshold = selectedProduct?.low_stock_threshold || 10
  const insufficientStock = selectedProduct && parseInt(form.qty || 0) > availableStock

  async function save() {
    if (!form.product_id || !form.qty) return
    if (insufficientStock) { toast.error(`Only ${availableStock} in stock`); return }
    setSaving(true)
    const { error } = await supabase.from('orders').insert({ ...form, qty: parseInt(form.qty), unit_price: parseFloat(form.unit_price) })
    if (error) { setSaving(false); toast.error('Failed to save order'); return }
    if (selectedProduct) {
      const newStock = selectedProduct.stock_qty - parseInt(form.qty)
      await supabase.from('products').update({ stock_qty: newStock }).eq('id', form.product_id)
      if (newStock <= 0) toast.error(`⚠️ ${selectedProduct.name} is now OUT OF STOCK!`)
      else if (newStock <= lowThreshold) toast.info(`⚠️ Low stock: ${selectedProduct.name} — ${newStock} left`)
      else toast.success(`Order added! Stock: ${newStock} remaining`)
    }
    setSaving(false); setModal(false); load()
  }

  async function uploadSlip(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploadingSlip(true)
    const fileName = `slip-${Date.now()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('uploads').upload(fileName, file, { upsert: true })
    if (error) {
      const reader = new FileReader()
      reader.onload = ev => { setPayForm(p => ({ ...p, transfer_slip_url: ev.target.result })); setUploadingSlip(false) }
      reader.readAsDataURL(file)
      return
    }
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(fileName)
    setPayForm(p => ({ ...p, transfer_slip_url: publicUrl }))
    setUploadingSlip(false)
    toast.success('Slip uploaded!')
  }

  async function savePayment() {
    if (!payModal) return
    setSaving(true)
    await supabase.from('orders').update({
      payment_status: payForm.payment_status,
      payment_method: payForm.payment_method,
      transfer_reference: payForm.transfer_reference,
      transfer_slip_url: payForm.transfer_slip_url,
      paid_at: payForm.payment_status === 'paid' ? new Date().toISOString() : null,
    }).eq('id', payModal.id)
    setSaving(false)
    toast.success('Payment recorded!')
    setPayModal(null)
    load()
  }

  async function updateStatus(id, newStatus) {
    const order = orders.find(o => o.id === id)
    await supabase.from('orders').update({ status: newStatus }).eq('id', id)
    if (newStatus === 'cancelled' && order?.status !== 'cancelled' && order?.product_id) {
      const { data: prod } = await supabase.from('products').select('stock_qty, name').eq('id', order.product_id).single()
      if (prod) { await supabase.from('products').update({ stock_qty: prod.stock_qty + order.qty }).eq('id', order.product_id); toast.info(`Stock restored: ${prod.name} +${order.qty}`) }
    }
    if (order?.status === 'cancelled' && newStatus !== 'cancelled' && order?.product_id) {
      const { data: prod } = await supabase.from('products').select('stock_qty').eq('id', order.product_id).single()
      if (prod) await supabase.from('products').update({ stock_qty: prod.stock_qty - order.qty }).eq('id', order.product_id)
    }
    load()
  }

  async function del(id) {
    if (!window.confirm('Delete this order? Stock will be restored.')) return
    const order = orders.find(o => o.id === id)
    if (order?.status !== 'cancelled' && order?.product_id) {
      const { data: prod } = await supabase.from('products').select('stock_qty').eq('id', order.product_id).single()
      if (prod) await supabase.from('products').update({ stock_qty: prod.stock_qty + order.qty }).eq('id', order.product_id)
    }
    await supabase.from('orders').delete().eq('id', id)
    toast.success('Deleted'); load()
  }

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const pf = k => e => setPayForm(p => ({ ...p, [k]: e.target.value }))

  const filteredByStatus = filter === 'all' ? orders : orders.filter(o => o.status === filter)
  const filteredOrders = payFilter === 'all' ? filteredByStatus : filteredByStatus.filter(o => (o.payment_status || 'unpaid') === payFilter)
  const totalRevenue = orders.filter(o => o.status === 'delivered').reduce((s, o) => s + Number(o.total_price || 0), 0)
  const unpaidTotal = orders.filter(o => (o.payment_status || 'unpaid') === 'unpaid' && o.status !== 'cancelled').reduce((s, o) => s + Number(o.total_price || 0), 0)
  const lowStockCount = products.filter(p => p.stock_qty > 0 && p.stock_qty <= (p.low_stock_threshold || 10)).length
  const outOfStockCount = products.filter(p => p.stock_qty <= 0).length

  const columns = [
    { key: 'invoice_number', label: 'Invoice', render: r => <span style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>{r.invoice_number || '—'}</span> },
    { key: 'customer_name', label: 'Customer', render: r => <span style={{ fontWeight: 500 }}>{r.customer_name || 'Walk-in'}</span> },
    { key: 'product_name', label: 'Product' },
    { key: 'qty', label: 'Qty' },
    { key: 'total_price', label: 'Total', render: r => <span style={{ fontWeight: 600 }}>MVR {Number(r.total_price || 0).toFixed(2)}</span> },
    { key: 'payment', label: 'Payment', render: r => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Badge color={(r.payment_status || 'unpaid') === 'paid' ? 'green' : (r.payment_status || 'unpaid') === 'partial' ? 'amber' : 'red'}>
          {r.payment_status || 'unpaid'}
        </Badge>
        {r.transfer_slip_url && <span title="Slip attached" style={{ fontSize: 14 }}>📎</span>}
      </div>
    )},
    { key: 'channel', label: 'Channel', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.channel}</span> },
    { key: 'order_date', label: 'Date', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.order_date}</span> },
    { key: 'status', label: 'Status', render: r => (
      <select value={r.status} onChange={e => updateStatus(r.id, e.target.value)}
        style={{ border: 'none', background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
        {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    )},
    { key: 'actions', label: '', render: r => (
      <div style={{ display: 'flex', gap: 5 }}>
        <Button variant="ghost" size="sm" onClick={() => setViewModal(r)} title="View"><Eye size={13} /></Button>
        <Button variant="ghost" size="sm" onClick={() => { setPayModal(r); setPayForm({ payment_method: r.payment_method || 'Cash', transfer_reference: r.transfer_reference || '', transfer_slip_url: r.transfer_slip_url || '', payment_status: r.payment_status || 'paid' }) }} title="Record payment"><CreditCard size={13} /></Button>
        <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button>
      </div>
    )},
  ]

  return (
    <div>
      <PageHeader title="Orders"
        subtitle={`MVR ${totalRevenue.toFixed(2)} delivered · MVR ${unpaidTotal.toFixed(2)} unpaid`}
        action={<Button onClick={openAdd}><Plus size={15} /> New order</Button>} />

      {(lowStockCount > 0 || outOfStockCount > 0) && (
        <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertTriangle size={16} color="#f57f17" />
          <span style={{ fontSize: 13, color: '#854F0B' }}>
            <strong>Stock alert:</strong> {outOfStockCount > 0 && `${outOfStockCount} out of stock`}{outOfStockCount > 0 && lowStockCount > 0 && ', '}{lowStockCount > 0 && `${lowStockCount} low stock`}
          </span>
        </div>
      )}

      <Card>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['all','pending','transit','delivered','cancelled'].map(s => (
              <button key={s} onClick={() => setFilter(s)} style={{ padding: '5px 12px', borderRadius: 99, border: '1px solid #ddd', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: filter === s ? 600 : 400, background: filter === s ? '#0d1b2a' : '#fff', color: filter === s ? '#fff' : '#666' }}>
                {s.charAt(0).toUpperCase() + s.slice(1)} <span style={{ opacity: 0.6 }}>{s === 'all' ? orders.length : orders.filter(o => o.status === s).length}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
            {['all','unpaid','paid','partial'].map(s => (
              <button key={s} onClick={() => setPayFilter(s)} style={{ padding: '5px 12px', borderRadius: 99, border: '1px solid #ddd', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: payFilter === s ? 600 : 400, background: payFilter === s ? '#c62828' : '#fff', color: payFilter === s ? '#fff' : '#666' }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {loading ? <Spinner /> : <Table columns={columns} data={filteredOrders} emptyMessage="No orders yet." />}
      </Card>

      {/* View order modal */}
      {viewModal && (
        <Modal title={`Order ${viewModal.invoice_number || ''}`} onClose={() => setViewModal(null)} width={500}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Customer', value: viewModal.customer_name || 'Walk-in' },
              { label: 'Product', value: viewModal.product_name },
              { label: 'Quantity', value: viewModal.qty },
              { label: 'Unit price', value: `MVR ${Number(viewModal.unit_price).toFixed(2)}` },
              { label: 'Total', value: `MVR ${Number(viewModal.total_price || 0).toFixed(2)}` },
              { label: 'Channel', value: viewModal.channel },
              { label: 'Order date', value: viewModal.order_date },
              { label: 'Status', value: viewModal.status },
              { label: 'Payment', value: viewModal.payment_status || 'unpaid' },
              { label: 'Pay method', value: viewModal.payment_method || '—' },
            ].map((item, i) => (
              <div key={i} style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a' }}>{item.value}</div>
              </div>
            ))}
          </div>
          {viewModal.transfer_reference && <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>Reference: <strong>{viewModal.transfer_reference}</strong></div>}
          {viewModal.transfer_slip_url && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6 }}>Transfer slip:</div>
              {viewModal.transfer_slip_url.startsWith('data:image') || viewModal.transfer_slip_url.match(/\.(jpg|jpeg|png|gif|webp)/i)
                ? <img src={viewModal.transfer_slip_url} alt="transfer slip" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #eee' }} />
                : <a href={viewModal.transfer_slip_url} target="_blank" rel="noreferrer" style={{ color: '#FFA500', fontSize: 13 }}>📎 View attached slip</a>
              }
            </div>
          )}
          {viewModal.notes && <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#555' }}>{viewModal.notes}</div>}
        </Modal>
      )}

      {/* Payment modal */}
      {payModal && (
        <Modal title={`Record payment — ${payModal.invoice_number || payModal.customer_name}`} onClose={() => setPayModal(null)} width={480}>
          <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, color: '#aaa' }}>Order total</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0d1b2a' }}>MVR {Number(payModal.total_price || 0).toFixed(2)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#aaa' }}>Customer</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{payModal.customer_name || 'Walk-in'}</div>
            </div>
          </div>
          <FormRow>
            <Select label="Payment status" value={payForm.payment_status} onChange={pf('payment_status')}
              options={[{ value: 'paid', label: '✅ Paid' },{ value: 'partial', label: '⚠️ Partial' },{ value: 'unpaid', label: '❌ Unpaid' }]} />
            <Select label="Payment method" value={payForm.payment_method} onChange={pf('payment_method')}
              options={PAY_METHODS.map(m => ({ value: m, label: m }))} />
          </FormRow>
          <Input label="Transfer reference / note" value={payForm.transfer_reference} onChange={pf('transfer_reference')} placeholder="e.g. TXN123456" style={{ marginBottom: 12 }} />
          
          {/* Slip upload */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>Attach transfer slip</label>
            {payForm.transfer_slip_url ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                {payForm.transfer_slip_url.startsWith('data:image') || payForm.transfer_slip_url.match(/\.(jpg|jpeg|png|gif|webp)/i)
                  ? <img src={payForm.transfer_slip_url} alt="slip" style={{ maxHeight: 150, borderRadius: 8, border: '1px solid #eee' }} />
                  : <div style={{ padding: '10px 14px', background: '#f0f0f0', borderRadius: 8, fontSize: 13 }}>📎 Slip attached</div>
                }
                <button onClick={() => setPayForm(p => ({ ...p, transfer_slip_url: '' }))} style={{ position: 'absolute', top: -6, right: -6, background: '#c62828', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={11} /></button>
              </div>
            ) : (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#f0f0f0', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#555' }}>
                <Upload size={14} /> {uploadingSlip ? 'Uploading…' : 'Upload slip (photo/PDF)'}
                <input type="file" accept="image/*,.pdf" onChange={uploadSlip} style={{ display: 'none' }} disabled={uploadingSlip} />
              </label>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setPayModal(null)}>Cancel</Button>
            <Button onClick={savePayment} disabled={saving}>{saving ? 'Saving…' : 'Save payment'}</Button>
          </div>
        </Modal>
      )}

      {/* New order modal */}
      {modal && (
        <Modal title="New order" onClose={() => setModal(false)} width={560}>
          <FormRow>
            <Select label="Customer" value={form.customer_id} onChange={handleCustomerChange}
              options={[{ value: '', label: '— Walk-in / No customer —' }, ...customers.map(c => ({ value: c.id, label: c.name }))]}
              style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Select label="Product *" value={form.product_id} onChange={handleProductChange}
              options={[{ value: '', label: '— Select product —' }, ...products.map(p => ({ value: p.id, label: `${p.name} (${p.stock_qty} in stock)` }))]}
              style={{ gridColumn: 'span 2' }} />
          </FormRow>
          {selectedProduct && (
            <div style={{ background: insufficientStock ? '#FCEBEB' : stockAfter <= lowThreshold ? '#FFF8E1' : '#E1F5EE', border: `1px solid ${insufficientStock ? '#fcc' : stockAfter <= lowThreshold ? '#FAEEDA' : '#cde'}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Package size={15} color={insufficientStock ? '#c62828' : stockAfter <= lowThreshold ? '#f57f17' : '#1D9E75'} />
              {insufficientStock ? <span><strong style={{ color: '#c62828' }}>Insufficient stock!</strong> Only {availableStock} available.</span>
                : <span><strong style={{ color: '#1D9E75' }}>{availableStock} in stock</strong> → {stockAfter} after order</span>}
            </div>
          )}
          <FormRow>
            <Input label="Qty *" type="number" min="1" value={form.qty} onChange={f('qty')} />
            <Input label="Unit price (MVR)" type="number" step="0.01" value={form.unit_price} onChange={f('unit_price')} />
          </FormRow>
          <FormRow>
            <Select label="Channel" value={form.channel} onChange={f('channel')} options={CHANNELS} />
            <Select label="Status" value={form.status} onChange={f('status')} options={STATUSES} />
          </FormRow>
          <FormRow>
            <Select label="Payment" value={form.payment_status} onChange={f('payment_status')} options={[{ value:'unpaid', label:'Unpaid' },{ value:'paid', label:'Paid' },{ value:'partial', label:'Partial' }]} />
            <Input label="Order date" type="date" value={form.order_date} onChange={f('order_date')} />
          </FormRow>
          <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13 }}>
            <strong>Total:</strong> MVR {(parseFloat(form.qty || 0) * parseFloat(form.unit_price || 0)).toFixed(2)}
            <span style={{ fontSize: 11, color: '#aaa', marginLeft: 10 }}>Invoice: {form.invoice_number}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.product_id || insufficientStock}>{saving ? 'Saving…' : 'Add order'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
