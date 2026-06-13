import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, StatusBadge, StockBadge, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, AlertTriangle, Package, Upload, Eye, CreditCard, X, Camera, Edit2, RotateCcw } from 'lucide-react'
import BarcodeScanner from '../components/BarcodeScanner'

const CHANNELS = ['Retail store','Online','Wholesale','Pop-up / Market','Instagram','Phone']
const STATUSES = [{ value: 'pending', label: 'Pending' },{ value: 'transit', label: 'Dispatched' },{ value: 'delivered', label: 'Delivered' },{ value: 'cancelled', label: 'Cancelled' }]
const PAY_METHODS = ['Cash','BML Transfer','Bank Transfer','Card','Other']
const EMPTY_FORM = { customer_id:'', customer_name:'', channel:'Retail store', status:'pending', order_date: new Date().toISOString().split('T')[0], notes:'', payment_status:'unpaid', payment_method:'', transfer_reference:'', invoice_number:'', delivery_person:'', discount_value:0, discount_type:'amount' }
const EMPTY_ITEM = { product_id:'', product_name:'', qty:1, unit_price:0 }

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editOrder, setEditOrder] = useState(null)
  const [viewModal, setViewModal] = useState(null)
  const [payModal, setPayModal] = useState(null)
  const [returnModal, setReturnModal] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [cartItems, setCartItems] = useState([{ ...EMPTY_ITEM }])
  const [payForm, setPayForm] = useState({ payment_method: 'Cash', transfer_reference: '', transfer_slip_url: '', payment_status: 'paid' })
  const [returnForm, setReturnForm] = useState({ reason: '', refund_amount: 0 })
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')
  const [payFilter, setPayFilter] = useState('all')
  const [uploadingSlip, setUploadingSlip] = useState(false)
  const [scanning, setScanning] = useState(null) // index of cart item being scanned
  const [deliveryStaff, setDeliveryStaff] = useState(() => { try { return JSON.parse(localStorage.getItem('deliveryStaff') || '[]') } catch { return [] } })
  const [newStaff, setNewStaff] = useState('')
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
    setForm({ ...EMPTY_FORM, order_date: new Date().toISOString().split('T')[0], invoice_number: num })
    setCartItems([{ ...EMPTY_ITEM }])
    setEditOrder(null)
    setModal(true)
  }

  function openEdit(order) {
    setForm({
      customer_id: order.customer_id || '',
      customer_name: order.customer_name || '',
      channel: order.channel || 'Retail store',
      status: order.status || 'pending',
      order_date: order.order_date || new Date().toISOString().split('T')[0],
      notes: order.notes || '',
      payment_status: order.payment_status || 'unpaid',
      payment_method: order.payment_method || '',
      transfer_reference: order.transfer_reference || '',
      invoice_number: order.invoice_number || '',
      delivery_person: order.delivery_person || '',
      discount_value: order.discount || 0,
      discount_type: 'amount',
    })
    setCartItems([{ product_id: order.product_id || '', product_name: order.product_name || '', qty: order.qty || 1, unit_price: order.unit_price || 0 }])
    setEditOrder(order)
    setModal(true)
  }

  function handleScanResult(code, idx) {
    const found = products.find(p => p.barcode === code || p.sku === code)
    if (found) {
      updateCartItem(idx, { product_id: found.id, product_name: found.name, unit_price: found.sell_price || 0 })
      toast.success(`✅ ${found.name} scanned!`)
    } else {
      toast.error(`No product found for: ${code}`)
    }
    setScanning(null)
  }

  function handleCustomerChange(e) {
    const cust = customers.find(c => c.id === e.target.value)
    setForm(p => ({ ...p, customer_id: e.target.value, customer_name: cust?.name || '' }))
  }

  function updateCartItem(idx, patch) {
    setCartItems(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item))
  }

  function handleProductChange(e, idx) {
    const prod = products.find(p => p.id === e.target.value)
    updateCartItem(idx, { product_id: e.target.value, product_name: prod?.name || '', unit_price: prod?.sell_price || 0 })
  }

  function addCartItem() { setCartItems(p => [...p, { ...EMPTY_ITEM }]) }
  function removeCartItem(idx) { if (cartItems.length > 1) setCartItems(p => p.filter((_, i) => i !== idx)) }

  const cartSubtotal = cartItems.reduce((s, item) => s + (parseFloat(item.qty || 0) * parseFloat(item.unit_price || 0)), 0)
  const discountVal = parseFloat(form.discount_value || 0)
  const discountAmount = form.discount_type === 'percent' ? (cartSubtotal * discountVal / 100) : discountVal
  const cartTotal = Math.max(0, cartSubtotal - discountAmount)

  function buildPayload(item, itemDiscount) {
    return {
      customer_id: form.customer_id || null,
      customer_name: form.customer_name || '',
      channel: form.channel,
      status: form.status,
      order_date: form.order_date,
      notes: form.notes || '',
      payment_status: form.payment_status,
      payment_method: form.payment_method || '',
      transfer_reference: form.transfer_reference || '',
      invoice_number: form.invoice_number || '',
      delivery_person: form.delivery_person || '',
      product_id: item.product_id,
      product_name: item.product_name,
      qty: parseInt(item.qty),
      unit_price: parseFloat(item.unit_price),
      total_price: Math.max(0, parseFloat(item.unit_price) * parseInt(item.qty) - itemDiscount),
      discount: itemDiscount,
    }
  }

  async function save() {
    const validItems = cartItems.filter(i => i.product_id && i.qty)
    if (validItems.length === 0) { toast.error('Add at least one product'); return }
    setSaving(true)

    if (editOrder) {
      const item = validItems[0]
      const payload = buildPayload(item, discountAmount)
      const { error } = await supabase.from('orders').update(payload).eq('id', editOrder.id)
      setSaving(false)
      if (error) { console.error(error); toast.error('Failed to update: ' + error.message); return }
      toast.success('Order updated!')
      setModal(false); load(); return
    }

    // New order — insert one row per cart item
    for (const item of validItems) {
      const prod = products.find(p => p.id === item.product_id)
      const itemSubtotal = parseFloat(item.unit_price) * parseInt(item.qty)
      // Each item gets the full discount applied individually
      const itemDiscount = form.discount_type === 'percent'
        ? itemSubtotal * (parseFloat(form.discount_value || 0) / 100)
        : parseFloat(form.discount_value || 0) / validItems.length
      const payload = buildPayload(item, itemDiscount)
      const { error } = await supabase.from('orders').insert(payload)
      if (error) { console.error(error); setSaving(false); toast.error('Failed to save: ' + error.message); return }
      if (prod) {
        const newStock = prod.stock_qty - parseInt(item.qty)
        await supabase.from('products').update({ stock_qty: newStock }).eq('id', item.product_id)
        if (newStock <= 0) toast.error(`⚠️ ${prod.name} OUT OF STOCK!`)
        else if (newStock <= (prod.low_stock_threshold || 10)) toast.info(`⚠️ Low stock: ${prod.name} — ${newStock} left`)
      }
    }
    setSaving(false)
    toast.success(`Order added!${validItems.length > 1 ? ` (${validItems.length} items)` : ''}`)
    setModal(false); load()
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
      reader.readAsDataURL(file); return
    }
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(fileName)
    setPayForm(p => ({ ...p, transfer_slip_url: publicUrl }))
    setUploadingSlip(false); toast.success('Slip uploaded!')
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
    setSaving(false); toast.success('Payment recorded!'); setPayModal(null); load()
  }

  async function saveReturn() {
    if (!returnModal) return
    setSaving(true)
    const order = returnModal
    // Restore stock
    if (order.product_id) {
      const { data: prod } = await supabase.from('products').select('stock_qty, name').eq('id', order.product_id).single()
      if (prod) {
        await supabase.from('products').update({ stock_qty: prod.stock_qty + order.qty }).eq('id', order.product_id)
        toast.info(`Stock restored: ${prod.name} +${order.qty}`)
      }
    }
    // Mark order as cancelled + log return
    await supabase.from('orders').update({
      status: 'cancelled',
      notes: `RETURNED: ${returnForm.reason} | Refund: MVR ${returnForm.refund_amount}${order.notes ? ' | ' + order.notes : ''}`,
    }).eq('id', order.id)
    // Log as expense (refund)
    if (parseFloat(returnForm.refund_amount) > 0) {
      await supabase.from('expenses').insert({
        description: `Refund — ${order.product_name} (${order.invoice_number || order.id.slice(0,6)})${returnForm.reason ? ': ' + returnForm.reason : ''}`,
        category: 'Returns / Refunds',
        amount: parseFloat(returnForm.refund_amount),
        expense_date: new Date().toISOString().split('T')[0],
      })
    }
    setSaving(false); toast.success('Return processed, stock restored!'); setReturnModal(null); load()
  }

  async function updateStatus(id, newStatus) {
    const order = orders.find(o => o.id === id)
    await supabase.from('orders').update({ status: newStatus }).eq('id', id)
    if (newStatus === 'cancelled' && order?.status !== 'cancelled' && order?.product_id) {
      const { data: prod } = await supabase.from('products').select('stock_qty, name').eq('id', order.product_id).single()
      if (prod) { await supabase.from('products').update({ stock_qty: prod.stock_qty + order.qty }).eq('id', order.product_id); toast.info(`Stock restored: ${prod.name} +${order.qty}`) }
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
    { key: 'total_price', label: 'Total', render: r => (
      <div>
        <span style={{ fontWeight: 600 }}>MVR {Number(r.total_price || 0).toFixed(2)}</span>
        {r.discount > 0 && <div style={{ fontSize: 10, color: '#1D9E75', fontWeight: 600 }}>-MVR {Number(r.discount).toFixed(2)} disc.</div>}
      </div>
    )},
    { key: 'payment', label: 'Payment', render: r => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Badge color={(r.payment_status || 'unpaid') === 'paid' ? 'green' : (r.payment_status || 'unpaid') === 'partial' ? 'amber' : 'red'}>
          {r.payment_status || 'unpaid'}
        </Badge>
        {r.transfer_slip_url && <span title="Slip attached" style={{ fontSize: 14 }}>📎</span>}
      </div>
    )},
    { key: 'delivery_person', label: 'Delivery', render: r => r.delivery_person ? <span style={{ fontSize: 12, background: '#EEF4FF', color: '#378ADD', padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>🚴 {r.delivery_person}</span> : <span style={{ color: '#ddd' }}>—</span> },
    { key: 'order_date', label: 'Date', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.order_date}</span> },
    { key: 'status', label: 'Status', render: r => (
      <select value={r.status} onChange={e => updateStatus(r.id, e.target.value)}
        style={{ border: 'none', background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
        {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    )},
    { key: 'actions', label: '', render: r => (
      <div style={{ display: 'flex', gap: 4 }}>
        <Button variant="ghost" size="sm" onClick={() => setViewModal(r)} title="View"><Eye size={13} /></Button>
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)} title="Edit"><Edit2 size={13} /></Button>
        <Button variant="ghost" size="sm" onClick={() => { setPayModal(r); setPayForm({ payment_method: r.payment_method || 'Cash', transfer_reference: r.transfer_reference || '', transfer_slip_url: r.transfer_slip_url || '', payment_status: r.payment_status || 'paid' }) }} title="Payment"><CreditCard size={13} /></Button>
        {r.status !== 'cancelled' && <Button variant="ghost" size="sm" onClick={() => { setReturnModal(r); setReturnForm({ reason: '', refund_amount: r.total_price || 0 }) }} title="Return" style={{ color: '#f57f17' }}><RotateCcw size={13} /></Button>}
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

      {/* ── VIEW ORDER MODAL ── */}
      {viewModal && (
        <Modal title={`Order ${viewModal.invoice_number || ''}`} onClose={() => setViewModal(null)} width={520}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Customer', value: viewModal.customer_name || 'Walk-in' },
              { label: 'Product', value: viewModal.product_name },
              { label: 'Quantity', value: viewModal.qty },
              { label: 'Unit price', value: `MVR ${Number(viewModal.unit_price || 0).toFixed(2)}` },
              { label: 'Discount', value: viewModal.discount > 0 ? `MVR ${Number(viewModal.discount).toFixed(2)}` : '—' },
              { label: 'Total', value: `MVR ${Number(viewModal.total_price || 0).toFixed(2)}` },
              { label: 'Channel', value: viewModal.channel },
              { label: 'Order date', value: viewModal.order_date },
              { label: 'Status', value: viewModal.status },
              { label: 'Payment', value: viewModal.payment_status || 'unpaid' },
              { label: 'Pay method', value: viewModal.payment_method || '—' },
              { label: 'Delivery', value: viewModal.delivery_person || '—' },
            ].map((item, i) => (
              <div key={i} style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a' }}>{item.value}</div>
              </div>
            ))}
          </div>
          {viewModal.transfer_reference && <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>Reference: <strong>{viewModal.transfer_reference}</strong></div>}
          {viewModal.notes && (
            <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#555' }}>
              <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Notes</div>
              {viewModal.notes}
            </div>
          )}
          {viewModal.transfer_slip_url && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 6 }}>Transfer slip:</div>
              {viewModal.transfer_slip_url.match(/\.(jpg|jpeg|png|gif|webp)/i) || viewModal.transfer_slip_url.startsWith('data:image')
                ? <img src={viewModal.transfer_slip_url} alt="slip" style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #eee' }} />
                : <a href={viewModal.transfer_slip_url} target="_blank" rel="noreferrer" style={{ color: '#FFA500', fontSize: 13 }}>📎 View slip</a>
              }
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => { openEdit(viewModal); setViewModal(null) }}><Edit2 size={13} /> Edit</Button>
            <Button variant="ghost" onClick={() => setViewModal(null)}>Close</Button>
          </div>
        </Modal>
      )}

      {/* ── PAYMENT MODAL ── */}
      {payModal && (
        <Modal title={`Record payment — ${payModal.invoice_number || payModal.customer_name}`} onClose={() => setPayModal(null)} width={480}>
          <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
            <div><div style={{ fontSize: 12, color: '#aaa' }}>Order total</div><div style={{ fontSize: 20, fontWeight: 800, color: '#0d1b2a' }}>MVR {Number(payModal.total_price || 0).toFixed(2)}</div></div>
            <div><div style={{ fontSize: 12, color: '#aaa' }}>Customer</div><div style={{ fontSize: 14, fontWeight: 600 }}>{payModal.customer_name || 'Walk-in'}</div></div>
          </div>
          <FormRow>
            <Select label="Payment status" value={payForm.payment_status} onChange={pf('payment_status')} options={[{ value: 'paid', label: '✅ Paid' },{ value: 'partial', label: '⚠️ Partial' },{ value: 'unpaid', label: '❌ Unpaid' }]} />
            <Select label="Payment method" value={payForm.payment_method} onChange={pf('payment_method')} options={PAY_METHODS.map(m => ({ value: m, label: m }))} />
          </FormRow>
          <Input label="Transfer reference / note" value={payForm.transfer_reference} onChange={pf('transfer_reference')} placeholder="e.g. TXN123456" style={{ marginBottom: 12 }} />
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

      {/* ── RETURN MODAL ── */}
      {returnModal && (
        <Modal title={`Return — ${returnModal.product_name}`} onClose={() => setReturnModal(null)} width={460}>
          <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ This will:</div>
            <div style={{ color: '#666', lineHeight: 1.8 }}>
              • Cancel the order<br/>
              • Restore {returnModal.qty} unit(s) back to stock<br/>
              • Log the refund as an expense
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Return reason</label>
            <input value={returnForm.reason} onChange={e => setReturnForm(p => ({ ...p, reason: e.target.value }))} placeholder="e.g. Defective item, wrong size, customer changed mind…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Refund amount (MVR)</label>
            <input type="number" step="0.01" value={returnForm.refund_amount} onChange={e => setReturnForm(p => ({ ...p, refund_amount: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setReturnModal(null)}>Cancel</Button>
            <Button onClick={saveReturn} disabled={saving} style={{ background: '#c62828' }}>{saving ? 'Processing…' : 'Process return'}</Button>
          </div>
        </Modal>
      )}

      {/* ── NEW / EDIT ORDER MODAL ── */}
      {modal && (
        <Modal title={editOrder ? `Edit order — ${editOrder.invoice_number || ''}` : 'New order'} onClose={() => { setModal(false); setScanning(null) }} width={600}>
          {/* Customer */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Customer</label>
            <select value={form.customer_id} onChange={handleCustomerChange}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none' }}>
              <option value="">— Walk-in / No customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Cart items */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Products *</label>
              {!editOrder && <button onClick={addCartItem} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#f0f0f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', color: '#555' }}><Plus size={12} /> Add item</button>}
            </div>
            {cartItems.map((item, idx) => {
              const prod = products.find(p => p.id === item.product_id)
              const avail = prod?.stock_qty || 0
              const insufficient = prod && parseInt(item.qty || 0) > avail
              return (
                <div key={idx} style={{ border: '1px solid #eee', borderRadius: 10, padding: '12px', marginBottom: 8, background: '#fafafa' }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <select value={item.product_id} onChange={e => handleProductChange(e, idx)}
                      style={{ flex: 1, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none' }}>
                      <option value="">— Select product —</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.stock_qty} in stock)</option>)}
                    </select>
                    <button onClick={() => setScanning(scanning === idx ? null : idx)}
                      style={{ padding: '8px 10px', background: scanning === idx ? '#c62828' : '#FFA500', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                      <Camera size={13} />
                    </button>
                    {cartItems.length > 1 && <button onClick={() => removeCartItem(idx)} style={{ padding: '8px', background: 'none', border: '1px solid #eee', borderRadius: 8, cursor: 'pointer', color: '#c62828' }}><X size={13} /></button>}
                  </div>
                  {scanning === idx && (
                    <div style={{ marginBottom: 8 }}>
                      <BarcodeScanner onScan={code => handleScanResult(code, idx)} onClose={() => setScanning(null)} />
                    </div>
                  )}
                  {item.product_id && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Qty</label>
                        <input type="number" min="1" value={item.qty} onChange={e => updateCartItem(idx, { qty: e.target.value })}
                          style={{ width: '100%', padding: '7px 10px', border: `1px solid ${insufficient ? '#c62828' : '#ddd'}`, borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Unit price (MVR)</label>
                        <input type="number" step="0.01" value={item.unit_price} onChange={e => updateCartItem(idx, { unit_price: e.target.value })}
                          style={{ width: '100%', padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Subtotal</label>
                        <div style={{ padding: '7px 10px', background: '#f0f0f0', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>MVR {(parseFloat(item.qty||0)*parseFloat(item.unit_price||0)).toFixed(2)}</div>
                      </div>
                    </div>
                  )}
                  {insufficient && <div style={{ fontSize: 11, color: '#c62828', marginTop: 4 }}>⚠️ Only {avail} in stock</div>}
                  {prod && !insufficient && <div style={{ fontSize: 11, color: '#1D9E75', marginTop: 4 }}>{avail} in stock → {avail - parseInt(item.qty||0)} after order</div>}
                </div>
              )
            })}
          </div>

          {/* Discount */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>Discount</label>
            <div style={{ display: 'flex', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', width: 260 }}>
              <button onClick={() => setForm(p => ({ ...p, discount_type: 'amount' }))}
                style={{ padding: '9px 16px', border: 'none', borderRight: '1px solid #ddd', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: form.discount_type === 'amount' ? '#FFA500' : '#f8f8f8', color: form.discount_type === 'amount' ? '#fff' : '#666' }}>MVR</button>
              <button onClick={() => setForm(p => ({ ...p, discount_type: 'percent' }))}
                style={{ padding: '9px 16px', border: 'none', borderRight: '1px solid #ddd', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: form.discount_type === 'percent' ? '#FFA500' : '#f8f8f8', color: form.discount_type === 'percent' ? '#fff' : '#666' }}>%</button>
              <input type="number" min="0" step="0.01" value={form.discount_value} onChange={e => setForm(p => ({ ...p, discount_value: e.target.value }))} placeholder="0"
                style={{ flex: 1, padding: '9px 12px', border: 'none', fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
            </div>
            {discountAmount > 0 && <div style={{ fontSize: 12, color: '#1D9E75', marginTop: 4, fontWeight: 600 }}>Saving MVR {discountAmount.toFixed(2)}</div>}
          </div>

          {/* Order total summary */}
          <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <span>Subtotal: <strong>MVR {cartSubtotal.toFixed(2)}</strong></span>
            {discountAmount > 0 && <span style={{ color: '#1D9E75' }}>Discount: <strong>-MVR {discountAmount.toFixed(2)}{form.discount_type === 'percent' ? ` (${form.discount_value}%)` : ''}</strong></span>}
            <span style={{ fontWeight: 800, color: '#0d1b2a' }}>Total: <strong>MVR {cartTotal.toFixed(2)}</strong></span>
            <span style={{ fontSize: 11, color: '#aaa' }}>Invoice: {form.invoice_number}</span>
          </div>

          <FormRow>
            <Select label="Channel" value={form.channel} onChange={f('channel')} options={CHANNELS} />
            <Select label="Status" value={form.status} onChange={f('status')} options={STATUSES} />
          </FormRow>

          {/* Delivery person */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>Delivery person</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={form.delivery_person} onChange={f('delivery_person')}
                style={{ flex: 1, padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none' }}>
                <option value="">— None / Self pickup —</option>
                {deliveryStaff.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={newStaff} onChange={e => setNewStaff(e.target.value)} placeholder="Add new…"
                style={{ width: 120, padding: '9px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                onKeyDown={e => { if (e.key === 'Enter' && newStaff.trim()) { const u = [...deliveryStaff, newStaff.trim()]; setDeliveryStaff(u); localStorage.setItem('deliveryStaff', JSON.stringify(u)); setForm(p => ({ ...p, delivery_person: newStaff.trim() })); setNewStaff('') } }} />
              <button onClick={() => { if (newStaff.trim()) { const u = [...deliveryStaff, newStaff.trim()]; setDeliveryStaff(u); localStorage.setItem('deliveryStaff', JSON.stringify(u)); setForm(p => ({ ...p, delivery_person: newStaff.trim() })); setNewStaff('') } }}
                style={{ padding: '9px 14px', background: '#FFA500', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>+</button>
            </div>
          </div>

          <FormRow>
            <Select label="Payment" value={form.payment_status} onChange={f('payment_status')} options={[{ value:'unpaid', label:'Unpaid' },{ value:'paid', label:'Paid' },{ value:'partial', label:'Partial' }]} />
            <Input label="Order date" type="date" value={form.order_date} onChange={f('order_date')} />
          </FormRow>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Notes</label>
            <textarea value={form.notes} onChange={f('notes')} placeholder="Any notes about this order…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 60, boxSizing: 'border-box', outline: 'none' }} />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editOrder ? 'Save changes' : 'Add order'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
