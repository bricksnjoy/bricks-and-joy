import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, StatusBadge, StockBadge, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, AlertTriangle, Package, Upload, Eye, CreditCard, X, Camera, Edit2, RotateCcw, MessageSquare, MoreVertical, LayoutGrid, List, Instagram } from 'lucide-react'
import BarcodeScanner from '../components/BarcodeScanner'
import { sendSMS } from '../lib/sms'

const CHANNELS = ['Retail store','Online','Wholesale','Pop-up / Market','Instagram','Phone']
const STATUSES = [{ value: 'created', label: 'Order created' },{ value: 'transit', label: 'Dispatched' },{ value: 'delivered', label: 'Delivered' },{ value: 'cancelled', label: 'Cancelled' }]
const PAY_METHODS = ['Cash','BML Transfer','Bank Transfer','Card','Other']
const EMPTY_FORM = { customer_id:'', customer_name:'', channel:'Retail store', status:'created', order_date: new Date().toISOString().split('T')[0], notes:'', payment_status:'unpaid', payment_method:'', transfer_reference:'', invoice_number:'', delivery_person:'', discount_value:0, discount_type:'amount' }
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
  const [filter, setFilter] = useState('created')
  const [uploadingSlip, setUploadingSlip] = useState(false)
  const [scanning, setScanning] = useState(null)
  const [contacts, setContacts] = useState([])
  const [smsModal, setSmsModal] = useState(null)
  const [smsForm, setSmsForm] = useState({ mode: 'customer', to: '', message: '', contactId: '' })
  const [smsSending, setSmsSending] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [stockOpen, setStockOpen] = useState(false)
  const [view, setView] = useState('cards') // cards | list
  const [kebabOpen, setKebabOpen] = useState(null)
  const kebabRef = useRef(null)
  const toast = useToast()

  useEffect(() => { load() }, [])

  // Close kebab when clicking outside
  useEffect(() => {
    function handler(e) {
      if (kebabRef.current && !kebabRef.current.contains(e.target)) setKebabOpen(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function load() {
    setLoading(true)
    const [o, c, p, ct, u] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name, phone, address, instagram, landmark').order('name'),
      supabase.from('products').select('*').order('name'),
      supabase.from('email_contacts').select('*').order('name'),
      supabase.auth.getUser(),
    ])
    setUserEmail(u?.data?.user?.email || '')
    setOrders(o.data || [])
    setCustomers(c.data || [])
    setProducts(p.data || [])
    setContacts(ct.data || [])
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
      created_by_email: editOrder ? (editOrder.created_by_email || userEmail) : userEmail,
    }
  }

  function dropMissingCol(error, payload) {
    const m = (error?.message || '').match(/'([a-z_]+)' column/i) || (error?.message || '').match(/column "?([a-z_]+)"?/i)
    const col = m && m[1]
    if (col && col in payload) { delete payload[col]; return true }
    return false
  }

  async function applyStockDelta(productId, delta) {
    if (!productId || !delta) return
    const { data: prod } = await supabase.from('products').select('stock_qty').eq('id', productId).single()
    if (prod) await supabase.from('products').update({ stock_qty: (prod.stock_qty || 0) + delta }).eq('id', productId)
  }

  async function save() {
    if (!form.customer_id) { toast.error('Please select a customer'); return }
    const validItems = cartItems.filter(i => i.product_id && i.qty)
    if (validItems.length === 0) { toast.error('Add at least one product'); return }
    setSaving(true)

    if (editOrder) {
      const item = validItems[0]
      const payload = buildPayload(item, discountAmount)
      let { error } = await supabase.from('orders').update(payload).eq('id', editOrder.id)
      while (error && dropMissingCol(error, payload)) { error = (await supabase.from('orders').update(payload).eq('id', editOrder.id)).error }
      if (error) { console.error(error); setSaving(false); toast.error('Failed to update: ' + error.message); return }
      if (editOrder.status !== 'cancelled') {
        const oldQty = parseInt(editOrder.qty) || 0
        const newQty = parseInt(item.qty) || 0
        if (editOrder.product_id === item.product_id) {
          await applyStockDelta(item.product_id, -(newQty - oldQty))
        } else {
          await applyStockDelta(editOrder.product_id, oldQty)
          await applyStockDelta(item.product_id, -newQty)
        }
      }
      setSaving(false)
      toast.success('Order updated!')
      setModal(false); load(); return
    }

    for (const item of validItems) {
      const itemSubtotal = parseFloat(item.unit_price) * parseInt(item.qty)
      const itemDiscount = form.discount_type === 'percent'
        ? itemSubtotal * (parseFloat(form.discount_value || 0) / 100)
        : parseFloat(form.discount_value || 0) / validItems.length
      const payload = buildPayload(item, itemDiscount)
      let { error } = await supabase.from('orders').insert(payload)
      while (error && dropMissingCol(error, payload)) { error = (await supabase.from('orders').insert(payload)).error }
      if (error) { console.error(error); setSaving(false); toast.error('Failed to save: ' + error.message); return }
      const { data: prod } = await supabase.from('products').select('stock_qty, name, low_stock_threshold').eq('id', item.product_id).single()
      if (prod) {
        const newStock = (prod.stock_qty || 0) - parseInt(item.qty)
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
    if (order.product_id) {
      const { data: prod } = await supabase.from('products').select('stock_qty, name').eq('id', order.product_id).single()
      if (prod) {
        await supabase.from('products').update({ stock_qty: prod.stock_qty + order.qty }).eq('id', order.product_id)
        toast.info(`Stock restored: ${prod.name} +${order.qty}`)
      }
    }
    await supabase.from('orders').update({
      status: 'cancelled',
      notes: `RETURNED: ${returnForm.reason} | Refund: MVR ${returnForm.refund_amount}${order.notes ? ' | ' + order.notes : ''}`,
    }).eq('id', order.id)
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

  function customerMsg(o) {
    return `Hi ${o.customer_name || 'there'}, your order ${o.invoice_number || ''} (${o.product_name} ×${o.qty}) total MVR ${Number(o.total_price || 0).toFixed(2)} is ${o.status}. Thank you! — Brick's & Joy`
  }
  function deliveryMsg(o, cust) {
    return `DELIVERY — ${o.customer_name || 'Walk-in'}\nPhone: ${cust?.phone || '—'}\nAddress: ${cust?.address || '—'}\nOrder ${o.invoice_number || ''}: ${o.product_name} ×${o.qty}\nTotal: MVR ${Number(o.total_price || 0).toFixed(2)} (${o.payment_status || 'unpaid'})`
  }
  function openSms(order) {
    const cust = customers.find(c => c.id === order.customer_id)
    setSmsForm({ mode: 'customer', to: cust?.phone || '', contactId: '', message: customerMsg(order) })
    setSmsModal({ ...order, _cust: cust })
  }
  function smsModeSwitch(mode) {
    const o = smsModal
    if (mode === 'customer') setSmsForm({ mode, to: o._cust?.phone || '', contactId: '', message: customerMsg(o) })
    else setSmsForm({ mode, to: '', contactId: '', message: deliveryMsg(o, o._cust) })
  }
  function pickContact(id) {
    const c = contacts.find(x => x.id === id)
    setSmsForm(p => ({ ...p, contactId: id, to: c?.phone || p.to }))
  }
  async function sendSms() {
    if (!smsForm.to) { toast.error('Enter a phone number'); return }
    if (!smsForm.message.trim()) { toast.error('Message is empty'); return }
    setSmsSending(true)
    try {
      await sendSMS(smsForm.to, smsForm.message)
      toast.success('SMS sent!')
      setSmsModal(null)
    } catch (e) {
      toast.error('SMS failed: ' + e.message)
    }
    setSmsSending(false)
  }

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const pf = k => e => setPayForm(p => ({ ...p, [k]: e.target.value }))

  const creatorName = email => {
    const c = contacts.find(x => (x.email || '').toLowerCase() === (email || '').toLowerCase())
    return c?.name || email
  }

  const filteredOrders = filter === 'all' ? orders : orders.filter(o => o.status === filter)
  const totalRevenue = orders.filter(o => o.status === 'delivered').reduce((s, o) => s + Number(o.total_price || 0), 0)
  const unpaidTotal = orders.filter(o => (o.payment_status || 'unpaid') === 'unpaid' && o.status !== 'cancelled').reduce((s, o) => s + Number(o.total_price || 0), 0)
  const lowStockCount = products.filter(p => p.stock_qty > 0 && p.stock_qty <= (p.low_stock_threshold || 10)).length
  const outOfStockCount = products.filter(p => p.stock_qty <= 0).length

  const AVATAR_COLORS = ['#7F77DD','#1D9E75','#FFA500','#378ADD','#E24B4A','#0F6E56']
  const statusColors = { created: '#7F77DD', pending: '#FFA500', transit: '#378ADD', delivered: '#1D9E75', cancelled: '#E24B4A' }
  const payColors = { paid: '#1D9E75', partial: '#FFA500', unpaid: '#E24B4A' }

  const productPhoto = o => products.find(p => p.id === o.product_id)?.photo_url || ''
  const customerInsta = o => customers.find(c => c.id === o.customer_id)?.instagram || ''

  // Table columns (list view)
  const columns = [
    { key: 'invoice_number', label: 'Invoice', render: r => (
      <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace', background: '#f5f5f5', padding: '3px 7px', borderRadius: 6 }}>
        {r.invoice_number || '—'}
      </span>
    )},
    { key: 'customer_name', label: 'Customer', render: r => {
      const name = r.customer_name || 'Walk-in'
      const ci = name.charCodeAt(0) % AVATAR_COLORS.length
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: AVATAR_COLORS[ci] + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: AVATAR_COLORS[ci], flexShrink: 0 }}>
            {name[0].toUpperCase()}
          </div>
          <span style={{ fontWeight: 600, color: '#0d1b2a', fontSize: 13 }}>{name}</span>
        </div>
      )
    }},
    { key: 'product_name', label: 'Product', render: r => (
      <div>
        <div style={{ fontWeight: 500, color: '#333', fontSize: 13 }}>{r.product_name}</div>
        <div style={{ fontSize: 11, color: '#bbb' }}>× {r.qty}</div>
      </div>
    )},
    { key: 'total_price', label: 'Total', render: r => (
      <div>
        <div style={{ fontWeight: 700, color: '#0d1b2a', fontSize: 13 }}>MVR {Number(r.total_price || 0).toFixed(2)}</div>
        {r.discount > 0 && <div style={{ fontSize: 10, color: '#1D9E75', fontWeight: 600 }}>-MVR {Number(r.discount).toFixed(2)} off</div>}
      </div>
    )},
    { key: 'payment', label: 'Payment', render: r => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Badge color={(r.payment_status || 'unpaid') === 'paid' ? 'green' : (r.payment_status || 'unpaid') === 'partial' ? 'amber' : 'red'}>
          {r.payment_status || 'unpaid'}
        </Badge>
      </div>
    )},
    { key: 'status', label: 'Status', render: r => (
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <select value={r.status} onChange={e => updateStatus(r.id, e.target.value)}
          style={{ appearance: 'none', WebkitAppearance: 'none', border: 'none', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, paddingRight: 16, paddingLeft: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 99, background: (statusColors[r.status] || '#ccc') + '18', color: statusColors[r.status] || '#888', outline: 'none' }}>
          {!STATUSES.some(s => s.value === r.status) && r.status && <option value={r.status}>{r.status}</option>}
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <span style={{ position: 'absolute', right: 4, pointerEvents: 'none', fontSize: 8, color: statusColors[r.status] || '#888' }}>▼</span>
      </div>
    )},
    { key: 'actions', label: '', render: r => (
      <div style={{ display: 'flex', gap: 3 }}>
        <button className="icon-btn primary" onClick={() => setViewModal(r)} title="View"><Eye size={13} /></button>
        <button className="icon-btn" onClick={() => openEdit(r)} title="Edit"><Edit2 size={13} /></button>
        <button className="icon-btn" onClick={() => openSms(r)} title="Send SMS" style={{ color: '#1D9E75' }}><MessageSquare size={13} /></button>
        <button className="icon-btn primary" onClick={() => { setPayModal(r); setPayForm({ payment_method: r.payment_method || 'Cash', transfer_reference: r.transfer_reference || '', transfer_slip_url: r.transfer_slip_url || '', payment_status: r.payment_status || 'paid' }) }} title="Record payment"><CreditCard size={13} /></button>
        {r.status !== 'cancelled' && <button className="icon-btn warning" onClick={() => { setReturnModal(r); setReturnForm({ reason: '', refund_amount: r.total_price || 0 }) }} title="Process return"><RotateCcw size={13} /></button>}
        <button className="icon-btn danger" onClick={() => del(r.id)} title="Delete"><Trash2 size={13} /></button>
      </div>
    )},
  ]

  return (
    <div>
      <style>{`
        .ord-photo { width:220px; height:220px; flex-shrink:0; border-radius:12px; overflow:hidden; background:#fff; border:1px solid #f0eee8; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box; cursor:pointer; transition: box-shadow 0.18s; }
        .ord-photo:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.10); }
        .ord-photo img { width:100%; height:100%; object-fit:contain; border-radius:6px; }
        .ord-card { display:flex; gap:20px; border:1px solid #eee; border-radius:16px; padding:16px; background:#fff; transition: box-shadow 0.18s, transform 0.18s; animation: ordFade 0.3s ease both; }
        .ord-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.06); transform: translateY(-1px); }
        .ord-cardbody { flex:1; min-width:0; display:flex; flex-direction:column; gap:10px; }
        .ord-cards { display:grid; grid-template-columns:1fr; gap:16px; }
        @keyframes ordFade { from { opacity:0; transform: translateY(6px) } to { opacity:1; transform:none } }
        .ord-status { appearance:none; -webkit-appearance:none; border:none; font-size:12px; cursor:pointer; font-family:inherit; font-weight:700; padding:5px 20px 5px 10px; border-radius:99px; outline:none; }
        .ord-kebab-wrap { position:relative; }
        .ord-kebab-menu { position:absolute; right:0; top:32px; background:#fff; border:1px solid #eee; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.10); min-width:140px; z-index:99; overflow:hidden; animation: ordFade 0.15s ease both; }
        .ord-kebab-item { display:flex; align-items:center; gap:8px; width:100%; padding:10px 14px; border:none; background:none; cursor:pointer; font-size:13px; font-family:inherit; color:#333; transition:background 0.12s; text-align:left; }
        .ord-kebab-item:hover { background:#f5f5f5; }
        .ord-kebab-item.danger { color:#E24B4A; }
        .ord-pill-btn { padding:7px 14px; border-radius:99px; border:none; cursor:pointer; font-size:12.5px; font-weight:600; font-family:inherit; transition: all 0.15s; }
        .ord-paybtn { transition: all 0.15s; }
        .ord-paybtn:hover { background:#0d1b2a !important; color:#fff !important; border-color:#0d1b2a !important; }
        .ord-status { transition: background 0.2s, color 0.2s; }
        .stock-detail { overflow:hidden; transition: max-height 0.3s ease, opacity 0.3s ease; }
        @media (max-width: 860px) {
          .ord-card { flex-direction:column; gap:14px; }
          .ord-photo { width:100%; height:auto; aspect-ratio:1/1; max-width:340px; align-self:center; }
        }
        /* Phone-only: keep filter tabs reachable, smaller text, bigger photo */
        @media (max-width: 600px) {
          .ord-filters { flex-wrap:wrap !important; }
          .ord-photo { max-width:100% !important; padding:12px; }
          .ord-cust { font-size:17px !important; }
          .ord-prod { font-size:13px !important; }
          .ord-price { font-size:16px !important; }
          .ord-cardbody { gap:8px; }
          .ord-status { font-size:11px !important; padding:4px 17px 4px 8px !important; }
          .ord-paybtn { font-size:10.5px !important; padding:4px 9px !important; }
          .ord-paybadge { font-size:10.5px !important; padding:3px 9px !important; }
        }
      `}</style>

      <PageHeader title="Orders"
        subtitle={`MVR ${totalRevenue.toFixed(2)} delivered · MVR ${unpaidTotal.toFixed(2)} unpaid`}
        action={<Button onClick={openAdd}><Plus size={15} /> New order</Button>} />

      {(lowStockCount > 0 || outOfStockCount > 0) && (
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setStockOpen(v => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: stockOpen ? '10px 10px 0 0' : 10, padding: '10px 16px', cursor: 'pointer', fontFamily: 'inherit', width: '100%', transition: 'border-radius 0.2s' }}>
            <AlertTriangle size={16} color="#f57f17" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#854F0B', fontWeight: 600, flex: 1, textAlign: 'left' }}>
              Stock alert: {outOfStockCount > 0 && `${outOfStockCount} out of stock`}{outOfStockCount > 0 && lowStockCount > 0 && ', '}{lowStockCount > 0 && `${lowStockCount} low stock`}
            </span>
            <span style={{ fontSize: 11, color: '#c8a85c', fontWeight: 600 }}>{stockOpen ? '▲ hide' : '▼ details'}</span>
          </button>
          <div className="stock-detail" style={{ maxHeight: stockOpen ? '400px' : '0', opacity: stockOpen ? 1 : 0, background: '#FFFBF0', border: stockOpen ? '1px solid #FAEEDA' : 'none', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: stockOpen ? '10px 16px' : '0 16px' }}>
            {outOfStockCount > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#E24B4A', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Out of stock</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {products.filter(p => p.stock_qty <= 0).map(p => (
                    <span key={p.id} style={{ fontSize: 12, background: '#FFE8E8', color: '#c62828', padding: '3px 10px', borderRadius: 99, fontWeight: 600 }}>{p.name}</span>
                  ))}
                </div>
              </div>
            )}
            {lowStockCount > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#f57f17', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>Low stock</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {products.filter(p => p.stock_qty > 0 && p.stock_qty <= (p.low_stock_threshold || 10)).map(p => (
                    <span key={p.id} style={{ fontSize: 12, background: '#FFF3E0', color: '#e65100', padding: '3px 10px', borderRadius: 99, fontWeight: 600 }}>{p.name} <span style={{ opacity: 0.7 }}>({p.stock_qty} left)</span></span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Card>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Status filters */}
            <div className="ord-filters" style={{ display: 'flex', background: '#f5f5f5', borderRadius: 10, padding: 3, gap: 2 }}>
              {[
                { key: 'created', label: 'Created', count: orders.filter(o => o.status === 'created').length },
                { key: 'transit', label: 'Dispatched', count: orders.filter(o => o.status === 'transit').length },
                { key: 'delivered', label: 'Delivered', count: orders.filter(o => o.status === 'delivered').length },
                { key: 'cancelled', label: 'Cancelled', count: orders.filter(o => o.status === 'cancelled').length },
                { key: 'all', label: 'All', count: orders.length },
              ].map(s => (
                <button key={s.key} onClick={() => setFilter(s.key)} style={{
                  padding: '6px 13px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: filter === s.key ? 700 : 500,
                  background: filter === s.key ? '#fff' : 'transparent',
                  color: filter === s.key ? '#0d1b2a' : '#999',
                  boxShadow: filter === s.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  {s.label}
                  <span style={{ fontSize: 10, fontWeight: 700, background: filter === s.key ? '#f0f0f0' : 'transparent', borderRadius: 99, padding: filter === s.key ? '1px 5px' : '0', color: filter === s.key ? '#555' : '#bbb' }}>{s.count}</span>
                </button>
              ))}
            </div>
          </div>
          {/* View toggle */}
          <div style={{ display: 'flex', background: '#f3f1ec', borderRadius: 99, padding: 3, gap: 1 }}>
            {[['cards', LayoutGrid], ['list', List]].map(([id, Icon]) => (
              <button key={id} onClick={() => setView(id)} style={{
                padding: '7px 12px', borderRadius: 99, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: view === id ? '#0d1b2a' : 'transparent', color: view === id ? '#fff' : '#888',
                display: 'flex', alignItems: 'center', transition: 'all 0.15s',
              }}><Icon size={14} /></button>
            ))}
          </div>
        </div>

        {loading ? <Spinner /> : view === 'list' ? (
          <Table columns={columns} data={filteredOrders} emptyMessage="No orders yet." />
        ) : filteredOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '46px 0', color: '#c4c4c4' }}>
            <div style={{ width: 58, height: 58, borderRadius: 16, background: 'linear-gradient(135deg,#fff3df,#ffe9c7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <Package size={26} color="#FFA500" />
            </div>
            <div style={{ fontWeight: 600, color: '#999' }}>No orders to show.</div>
          </div>
        ) : (
          <div className="ord-cards" ref={kebabRef}>
            {filteredOrders.map(o => {
              const photo = productPhoto(o)
              const insta = customerInsta(o)
              const payStatus = o.payment_status || 'unpaid'
              return (
                <div key={o.id} className="ord-card">
                  {/* Left: product photo — click to view details */}
                  <div className="ord-photo" onClick={() => setViewModal(o)} title="Click to view order details">
                    {photo ? <img src={photo} alt={o.product_name} /> : <Package size={56} color="#d8d4c8" />}
                  </div>

                  {/* Right: details */}
                  <div className="ord-cardbody">
                    {/* Top row: customer name + kebab */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div className="ord-cust" style={{ fontSize: 22, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-0.3px' }}>{o.customer_name || 'Walk-in'}</div>
                        {insta && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#C13584', fontSize: 11.5, marginTop: 1 }}>
                            <Instagram size={11} /> @{insta.replace(/^@/, '')}
                          </div>
                        )}
                      </div>
                      {/* Kebab menu */}
                      <div className="ord-kebab-wrap">
                        <button onClick={() => setKebabOpen(kebabOpen === o.id ? null : o.id)}
                          style={{ padding: 6, border: '1px solid #eee', borderRadius: 8, background: '#fafafa', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#888' }}>
                          <MoreVertical size={15} />
                        </button>
                        {kebabOpen === o.id && (
                          <div className="ord-kebab-menu">
                            <button className="ord-kebab-item" onClick={() => { openEdit(o); setKebabOpen(null) }}><Edit2 size={13} /> Edit</button>
                            <button className="ord-kebab-item" onClick={() => { openSms(o); setKebabOpen(null) }}><MessageSquare size={13} /> SMS</button>
                            {o.status !== 'cancelled' && (
                              <button className="ord-kebab-item" onClick={() => { setReturnModal(o); setReturnForm({ reason: '', refund_amount: o.total_price || 0 }); setKebabOpen(null) }}><RotateCcw size={13} /> Return</button>
                            )}
                            <button className="ord-kebab-item danger" onClick={() => { del(o.id); setKebabOpen(null) }}><Trash2 size={13} /> Delete</button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Product (relevant — bigger) */}
                    <div className="ord-prod" style={{ fontSize: 16, color: '#333', fontWeight: 600 }}>{o.product_name} <span style={{ color: '#aaa', fontWeight: 500 }}>× {o.qty}</span></div>

                    {/* Price (relevant — bigger) */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                      <span className="ord-price" style={{ fontWeight: 800, fontSize: 19, color: '#0d1b2a' }}>MVR {Number(o.total_price || 0).toFixed(2)}</span>
                      {o.discount > 0 && <span style={{ fontSize: 11, color: '#1D9E75', fontWeight: 600 }}>-MVR {Number(o.discount).toFixed(2)}</span>}
                    </div>

                    {/* Status + Payment row */}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      {/* Status inline dropdown */}
                      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                        <select
                          value={o.status}
                          onChange={e => updateStatus(o.id, e.target.value)}
                          className="ord-status"
                          style={{ background: (statusColors[o.status] || '#ccc') + '18', color: statusColors[o.status] || '#888', paddingRight: 22 }}>
                          {!STATUSES.some(s => s.value === o.status) && o.status && <option value={o.status}>{o.status}</option>}
                          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        <span style={{ position: 'absolute', right: 7, pointerEvents: 'none', fontSize: 8, color: statusColors[o.status] || '#888' }}>▼</span>
                      </div>

                      {/* Payment status — display only (change it via the Payment button) */}
                      <span className="ord-paybadge" style={{
                        padding: '5px 12px', borderRadius: 99, fontSize: 11.5, fontWeight: 700, textTransform: 'capitalize',
                        background: (payColors[payStatus] || '#ccc') + '18',
                        color: payColors[payStatus] || '#888',
                      }}>{payStatus}</span>

                      {/* Payment modal button — the only way to change payment */}
                      <button
                        onClick={() => { setPayModal(o); setPayForm({ payment_method: o.payment_method || 'Cash', transfer_reference: o.transfer_reference || '', transfer_slip_url: o.transfer_slip_url || '', payment_status: o.payment_status || 'paid' }) }}
                        title="Record / change payment"
                        className="ord-paybtn"
                        style={{ padding: '5px 12px', borderRadius: 99, border: '1px solid #ddd', background: '#fafafa', color: '#777', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CreditCard size={12} /> Payment
                      </button>
                    </div>

                    {/* Delivered by */}
                    {o.delivery_person && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#378ADD', background: '#EEF4FF', padding: '4px 10px', borderRadius: 99, alignSelf: 'flex-start', fontWeight: 600 }}>
                        <Package size={11} /> Delivered by {o.delivery_person}
                      </div>
                    )}

                    {/* Date · created by · invoice */}
                    <div style={{ fontSize: 11, color: '#bbb' }}>
                      {o.order_date}
                      {o.created_by_email && <span style={{ color: '#cfcfc9' }}> · by {creatorName(o.created_by_email)}</span>}
                      {o.invoice_number && <span style={{ fontFamily: 'monospace', color: '#d4d4d4' }}> · {o.invoice_number}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
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
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#cfcfcf' }}>
              {viewModal.created_by_email ? `Created by ${creatorName(viewModal.created_by_email)}` : ''}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" onClick={() => { openEdit(viewModal); setViewModal(null) }}><Edit2 size={13} /> Edit</Button>
              <Button variant="ghost" onClick={() => setViewModal(null)}>Close</Button>
            </div>
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
        <Modal title={editOrder ? `Edit order — ${editOrder.invoice_number || ''}` : 'New order'} onClose={() => { setModal(false); setScanning(null) }} width={600} noBackdropClose>
          {/* Customer — required */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>
              Customer <span style={{ color: '#E24B4A' }}>*</span>
            </label>
            <select value={form.customer_id} onChange={handleCustomerChange}
              style={{ width: '100%', padding: '9px 12px', border: `1px solid ${!form.customer_id ? '#FAEEDA' : '#ddd'}`, borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: !form.customer_id ? '#FFFDF7' : '#fff', outline: 'none' }}>
              <option value="">— Select a customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!form.customer_id && <div style={{ fontSize: 11, color: '#FFA500', marginTop: 3 }}>A customer must be selected to create an order.</div>}
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
                      style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none' }}>
                      <option value="">— Select product —</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.stock_qty} in stock)</option>)}
                    </select>
                    <button onClick={() => setScanning(scanning === idx ? null : idx)}
                      style={{ flexShrink: 0, padding: '8px 10px', background: scanning === idx ? '#c62828' : '#FFA500', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                      <Camera size={13} />
                    </button>
                    {cartItems.length > 1 && <button onClick={() => removeCartItem(idx)} style={{ flexShrink: 0, padding: '8px', background: 'none', border: '1px solid #eee', borderRadius: 8, cursor: 'pointer', color: '#c62828' }}><X size={13} /></button>}
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

          {/* Discount + Channel */}
          <div style={{ marginBottom: 14, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>Discount</label>
              <div style={{ display: 'flex', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', width: 260 }}>
                <button onClick={() => setForm(p => ({ ...p, discount_type: 'amount' }))}
                  style={{ padding: '9px 16px', border: 'none', borderRight: '1px solid #ddd', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: form.discount_type === 'amount' ? '#FFA500' : '#f8f8f8', color: form.discount_type === 'amount' ? '#fff' : '#666' }}>MVR</button>
                <button onClick={() => setForm(p => ({ ...p, discount_type: 'percent' }))}
                  style={{ padding: '9px 16px', border: 'none', borderRight: '1px solid #ddd', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', background: form.discount_type === 'percent' ? '#FFA500' : '#f8f8f8', color: form.discount_type === 'percent' ? '#fff' : '#666' }}>%</button>
                <input type="number" min="0" step="0.01" value={form.discount_value} onChange={e => setForm(p => ({ ...p, discount_value: e.target.value }))} placeholder="0"
                  style={{ flex: 1, padding: '9px 12px', border: 'none', fontSize: 14, fontFamily: 'inherit', outline: 'none', width: 80 }} />
              </div>
              {discountAmount > 0 && <div style={{ fontSize: 12, color: '#1D9E75', marginTop: 4, fontWeight: 600 }}>Saving MVR {discountAmount.toFixed(2)}</div>}
            </div>
            <div style={{ minWidth: 180, flex: 1 }}>
              <Select label="Channel" value={form.channel} onChange={f('channel')} options={CHANNELS} />
            </div>
          </div>

          {/* Order total summary */}
          <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <span>Subtotal: <strong>MVR {cartSubtotal.toFixed(2)}</strong></span>
            {discountAmount > 0 && <span style={{ color: '#1D9E75' }}>Discount: <strong>-MVR {discountAmount.toFixed(2)}{form.discount_type === 'percent' ? ` (${form.discount_value}%)` : ''}</strong></span>}
            <span style={{ fontWeight: 800, color: '#0d1b2a' }}>Total: <strong>MVR {cartTotal.toFixed(2)}</strong></span>
            <span style={{ fontSize: 11, color: '#aaa' }}>Invoice: {form.invoice_number}</span>
          </div>

          {editOrder && (
            <div style={{ marginBottom: 14, maxWidth: 220 }}>
              <Input label="Order date" type="date" value={form.order_date} onChange={f('order_date')} />
            </div>
          )}

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

      {/* ── SMS MODAL ── */}
      {smsModal && (
        <Modal title={`Send SMS — ${smsModal.invoice_number || smsModal.customer_name || 'Order'}`} onClose={() => setSmsModal(null)} width={480}>
          <div style={{ display: 'flex', background: '#f5f5f5', borderRadius: 10, padding: 3, gap: 2, marginBottom: 14 }}>
            {[{ k: 'customer', label: 'Notify customer' }, { k: 'delivery', label: 'Delivery / staff' }].map(m => (
              <button key={m.k} onClick={() => smsModeSwitch(m.k)} style={{
                flex: 1, padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12.5, fontWeight: smsForm.mode === m.k ? 700 : 500,
                background: smsForm.mode === m.k ? '#fff' : 'transparent',
                color: smsForm.mode === m.k ? '#0d1b2a' : '#999',
                boxShadow: smsForm.mode === m.k ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}>{m.label}</button>
            ))}
          </div>
          {smsForm.mode === 'delivery' && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Send to (saved contact)</label>
              <select value={smsForm.contactId} onChange={e => pickContact(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none' }}>
                <option value="">— Pick a delivery person / staff / director —</option>
                {contacts.filter(c => c.phone).map(c => <option key={c.id} value={c.id}>{c.name}{c.role ? ` (${c.role})` : ''} · {c.phone}</option>)}
              </select>
            </div>
          )}
          <Input label="Phone number" value={smsForm.to} onChange={e => setSmsForm(p => ({ ...p, to: e.target.value }))} placeholder="7-digit or with 960" style={{ marginBottom: 12 }} />
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Message</label>
            <textarea value={smsForm.message} onChange={e => setSmsForm(p => ({ ...p, message: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 90, boxSizing: 'border-box', outline: 'none' }} />
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{smsForm.message.length} characters · ~{Math.max(1, Math.ceil(smsForm.message.length / 160))} SMS</div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
            <Button variant="ghost" onClick={() => setSmsModal(null)}>Cancel</Button>
            <Button onClick={sendSms} disabled={smsSending}><MessageSquare size={13} /> {smsSending ? 'Sending…' : 'Send SMS'}</Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
