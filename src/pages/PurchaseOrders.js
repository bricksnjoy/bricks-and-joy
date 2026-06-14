import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, Package, Truck, X, Info, AlertTriangle, CreditCard, Wallet, CheckCircle, Paperclip, Eye } from 'lucide-react'

const AVATAR_COLORS = ['#7F77DD', '#1D9E75', '#FFA500', '#378ADD', '#E24B4A', '#0F6E56']
function avatarColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function Avatar({ name, size = 30 }) {
  const color = avatarColor(name)
  return (
    <div style={{
      width: size, height: size, borderRadius: size > 24 ? 8 : 6, background: color + '18', color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size > 24 ? 13 : 11, fontWeight: 600, flexShrink: 0,
    }}>{(name || '?').charAt(0).toUpperCase()}</div>
  )
}

const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' }
]

export default function PurchaseOrders() {
  const [pos, setPOs] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [payments, setPayments] = useState([]) // supplier_payments
  const [loading, setLoading] = useState(true)
  const [batchModal, setBatchModal] = useState(false)
  const [supplierModal, setSupplierModal] = useState(false)
  const [payModal, setPayModal] = useState(null) // PO object being paid
  const [payForm, setPayForm] = useState({ amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'Bank Transfer', reference: '', notes: '' })
  const [paymentsTab, setPaymentsTab] = useState(false)
  const [batchForm, setBatchForm] = useState({ supplier_id: '', supplier_name: '', order_date: new Date().toISOString().split('T')[0], expected_date: '', items: [], extraCosts: [] })
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_name: '', email: '', phone: '', address: '' })
  const [saving, setSaving] = useState(false)
  const [supplierCatalog, setSupplierCatalog] = useState([])
  const [itemSearch, setItemSearch] = useState({})
  const [focusedRow, setFocusedRow] = useState(null)
  const [slipModal, setSlipModal] = useState(null) // PO object
  const [slipUploading, setSlipUploading] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [p, s, pr, pay, sp] = await Promise.all([
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('*').order('name'),
      supabase.from('supplier_payments').select('*').order('payment_date', { ascending: false }),
      supabase.from('supplier_products').select('*').order('product_name'),
    ])
    setPOs(p.data || [])
    setSuppliers(s.data || [])
    setProducts(pr.data || [])
    setPayments(pay.data || [])
    setSupplierCatalog(sp.data || [])
    setLoading(false)
  }

  function openBatchAdd() {
    // Auto-suggest low stock items
    const lowStock = products.filter(p => p.stock_qty <= (p.low_stock_threshold || 10))
    const suggestedItems = lowStock.map(p => ({
      product_id: p.id,
      product_name: p.name,
      qty: Math.max(20, (p.low_stock_threshold || 10) * 2 - p.stock_qty),
      unit_cost: Number(p.cost_price) || 0,
      current_stock: p.stock_qty
    }))
    setBatchForm({
      supplier_id: '', supplier_name: '',
      order_date: new Date().toISOString().split('T')[0],
      expected_date: '',
      items: suggestedItems.length > 0 ? suggestedItems : [{ product_id: '', product_name: '', qty: 1, unit_cost: 0, current_stock: 0 }],
      extraCosts: []
    })
    setBatchModal(true)
  }

  function handleSupplierChange(e) {
    const s = suppliers.find(s => s.id === e.target.value)
    setBatchForm(prev => ({ ...prev, supplier_id: e.target.value, supplier_name: s?.name || '' }))
  }

  function updateItem(idx, key, value) {
    const newItems = [...batchForm.items]
    if (key === 'product_id') {
      if (value.startsWith('cat:')) {
        // From supplier catalog
        const catId = value.replace('cat:', '')
        const cp = supplierCatalog.find(p => p.id === catId)
        newItems[idx] = { ...newItems[idx], product_id: value, product_name: cp?.product_name || '', unit_cost: cp?.cost_price || 0, current_stock: '—', image_url: cp?.image_url || '' }
      } else {
        const p = products.find(p => p.id === value)
        newItems[idx] = { ...newItems[idx], product_id: value, product_name: p?.name || '', unit_cost: p?.cost_price || 0, current_stock: p?.stock_qty || 0, image_url: p?.image_url || '' }
      }
    } else {
      newItems[idx] = { ...newItems[idx], [key]: value }
    }
    setBatchForm(prev => ({ ...prev, items: newItems }))
  }

  function addItem() {
    setBatchForm(prev => ({ ...prev, items: [...prev.items, { product_id: '', product_name: '', qty: 1, unit_cost: 0, current_stock: 0 }] }))
  }

  function removeItem(idx) {
    setBatchForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))
  }

  function addCost() {
    setBatchForm(prev => ({ ...prev, extraCosts: [...(prev.extraCosts || []), { type: 'Alibaba transaction charge', label: '', amount: '' }] }))
  }

  function updateCost(idx, key, value) {
    setBatchForm(prev => {
      const next = [...(prev.extraCosts || [])]
      next[idx] = { ...next[idx], [key]: value }
      return { ...prev, extraCosts: next }
    })
  }

  function removeCost(idx) {
    setBatchForm(prev => ({ ...prev, extraCosts: (prev.extraCosts || []).filter((_, i) => i !== idx) }))
  }

  async function saveBatch() {
    const validItems = batchForm.items.filter(i => i.product_id && i.qty > 0)
    if (validItems.length === 0) { toast.error('Add at least one product'); return }
    setSaving(true)

    const batchId = (window.crypto?.randomUUID?.() || `b${Date.now()}${Math.random().toString(36).slice(2, 8)}`)

    const records = validItems.map(item => ({
      supplier_id: batchForm.supplier_id || null,
      supplier_name: batchForm.supplier_name,
      product_id: item.product_id?.startsWith('cat:') ? null : (item.product_id || null),
      product_name: item.product_name,
      qty: parseInt(item.qty),
      unit_cost: parseFloat(item.unit_cost),
      status: 'pending',
      order_date: batchForm.order_date,
      expected_date: batchForm.expected_date || null,
      image_url: item.image_url || null,
      batch_id: batchId,
    }))

    // Extra costs become their own line items (freight, fees, etc.)
    const costRecords = (batchForm.extraCosts || [])
      .filter(c => Number(c.amount) > 0)
      .map(c => ({
        supplier_id: batchForm.supplier_id || null,
        supplier_name: batchForm.supplier_name,
        product_id: null,
        product_name: c.type === 'Other' ? (c.label || 'Other cost') : c.type,
        qty: 1,
        unit_cost: parseFloat(c.amount),
        status: 'pending',
        order_date: batchForm.order_date,
        expected_date: batchForm.expected_date || null,
        cost_type: 'extra',
        batch_id: batchId,
      }))

    const { error } = await supabase.from('purchase_orders').insert([...records, ...costRecords])
    setSaving(false)
    if (error) { toast.error('Failed to save'); return }
    toast.success(`Batch order created! ${validItems.length} item${validItems.length > 1 ? 's' : ''}${costRecords.length ? ` + ${costRecords.length} cost${costRecords.length > 1 ? 's' : ''}` : ''}`)
    setBatchModal(false)
    load()
  }

  async function updateBatchStatus(group, newStatus) {
    const ids = group.rows.map(r => r.id)
    const wasReceived = group.rows[0]?.status === 'received'
    await supabase.from('purchase_orders').update({ status: newStatus }).in('id', ids)

    if (newStatus === 'received' && !wasReceived) {
      const productRows = group.rows.filter(r => r.cost_type !== 'extra')
      for (const row of productRows) {
        if (row.product_id) {
          // Linked inventory product — just add stock
          const { data: prod } = await supabase.from('products').select('id, stock_qty, name').eq('id', row.product_id).single()
          if (prod) {
            await supabase.from('products').update({ stock_qty: prod.stock_qty + row.qty }).eq('id', row.product_id)
            toast.success(`${prod.name}: +${row.qty} units in stock`)
          }
        } else if (row.product_name) {
          // Catalog item — find matching inventory product by name (case-insensitive), or create
          const { data: existing } = await supabase.from('products').select('id, stock_qty, name').ilike('name', row.product_name).maybeSingle()
          if (existing) {
            await supabase.from('products').update({ stock_qty: existing.stock_qty + row.qty }).eq('id', existing.id)
            toast.success(`${existing.name}: +${row.qty} added to existing stock`)
          } else {
            await supabase.from('products').insert({
              name: row.product_name,
              stock_qty: row.qty,
              cost_price: row.unit_cost || 0,
              sell_price: parseFloat(((row.unit_cost || 0) * 1.3).toFixed(2)),
              image_url: row.image_url || null,
              low_stock_threshold: 10,
            })
            toast.success(`${row.product_name}: added to inventory`)
          }
        }
      }
      // Prompt payment if unpaid
      const paid = paidForGroup(group)
      if (paid < group.total) openGroupPayModal(group)
    }
    load()
  }

  async function delGroup(group) {
    if (!window.confirm('Delete this order? This will delete all line items including fees.')) return
    await supabase.from('purchase_orders').delete().in('id', group.rows.map(r => r.id))
    toast.success('Order deleted')
    load()
  }

  function paidForGroup(group) {
    const ids = new Set(group.rows.map(r => r.id))
    return payments.filter(p => ids.has(p.purchase_order_id)).reduce((s, p) => s + Number(p.amount), 0)
  }

  function openGroupPayModal(group) {
    const anchor = group.rows.find(r => r.cost_type !== 'extra') || group.rows[0]
    const paid = paidForGroup(group)
    const outstanding = Math.max(0, group.total - paid)
    setPayForm({ amount: outstanding.toFixed(2), payment_date: new Date().toISOString().split('T')[0], payment_method: 'Bank Transfer', reference: '', notes: '' })
    setPayModal({ ...anchor, total_cost: group.total, _groupTotal: group.total, _groupPaid: paid })
  }

  async function markAllReceived() {
    if (!window.confirm('Mark all pending orders as received? This will update stock.')) return
    for (const g of poGroups.filter(g => g.rows[0]?.status === 'pending' || g.rows[0]?.status === 'ordered')) {
      await updateBatchStatus(g, 'received')
    }
    toast.success('All orders received and stock updated')
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

  const sf = k => e => setSupplierForm(prev => ({ ...prev, [k]: e.target.value }))

  async function recordPayment() {
    if (!payForm.amount || Number(payForm.amount) <= 0) { toast.error('Enter a valid amount'); return }
    const { error } = await supabase.from('supplier_payments').insert({
      purchase_order_id: payModal.id,
      supplier_id: payModal.supplier_id || null,
      supplier_name: payModal.supplier_name || '',
      amount: parseFloat(payForm.amount),
      payment_date: payForm.payment_date,
      payment_method: payForm.payment_method,
      reference: payForm.reference || null,
      notes: payForm.notes || null,
    })
    if (error) { toast.error('Failed to record payment'); return }
    toast.success(`Payment of MVR ${parseFloat(payForm.amount).toFixed(2)} recorded`)
    setPayModal(null)
    load()
  }

  async function uploadSlip(file) {
    if (!file || !slipModal) return
    setSlipUploading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result
      // Store slip on the anchor row ID
      const { error } = await supabase.from('purchase_orders').update({ slip_url: dataUrl }).eq('id', slipModal._anchorId || slipModal.id)
      setSlipUploading(false)
      if (error) { toast.error('Failed to save slip'); return }
      toast.success('Payment slip saved')
      setSlipModal(prev => ({ ...prev, slip_url: dataUrl }))
      load()
    }
    reader.readAsDataURL(file)
  }

  function payStatusBadgeForGroup(group) {
    const total = group.total
    const paid = paidForGroup(group)
    if (paid <= 0) return <span style={{ fontSize: 11, fontWeight: 600, color: '#E24B4A', background: '#fef2f2', padding: '2px 8px', borderRadius: 99 }}>Unpaid</span>
    if (paid >= total - 0.01) return <span style={{ fontSize: 11, fontWeight: 600, color: '#1D9E75', background: '#E1F5EE', padding: '2px 8px', borderRadius: 99 }}>Paid</span>
    return <span style={{ fontSize: 11, fontWeight: 600, color: '#f57f17', background: '#FFF8E1', padding: '2px 8px', borderRadius: 99 }}>Partial</span>
  }

  const totalSpend = pos.filter(p => p.status === 'received').reduce((s, p) => s + Number(p.total_cost || 0), 0)
  const pendingValue = pos.filter(p => p.status === 'pending' || p.status === 'ordered').reduce((s, p) => s + Number(p.total_cost || 0), 0)
  const batchItemsTotal = batchForm.items.reduce((s, i) => s + (parseFloat(i.qty || 0) * parseFloat(i.unit_cost || 0)), 0)
  const batchCostsTotal = (batchForm.extraCosts || []).reduce((s, c) => s + parseFloat(c.amount || 0), 0)
  const batchTotal = batchItemsTotal + batchCostsTotal
  const lowStockProducts = products.filter(p => p.stock_qty <= (p.low_stock_threshold || 10))

  // Group line items that belong to the same batch order
  const poGroups = (() => {
    const map = {}
    const order = []
    pos.forEach(po => {
      const key = po.batch_id || po.id
      if (!map[key]) { map[key] = []; order.push(key) }
      map[key].push(po)
    })
    return order.map(key => {
      const rows = map[key]
      rows.sort((a, b) => (a.cost_type === 'extra' ? 1 : 0) - (b.cost_type === 'extra' ? 1 : 0))
      const anchor = rows.find(r => r.cost_type !== 'extra') || rows[0]
      return { key, rows, anchor, total: rows.reduce((s, r) => s + Number(r.total_cost || 0), 0) }
    })
  })()

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle={`MVR ${totalSpend.toFixed(2)} received · MVR ${pendingValue.toFixed(2)} pending`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => setSupplierModal(true)}><Plus size={15} /> Supplier</Button>
            <Button onClick={openBatchAdd}><Plus size={15} /> Batch order</Button>
          </div>
        }
      />

      {/* Low stock suggestion banner */}
      {lowStockProducts.length > 0 && (
        <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 12, padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ background: '#FBE6BE', borderRadius: 10, padding: 9, flexShrink: 0, display: 'flex' }}>
            <AlertTriangle size={18} color="#f57f17" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#854F0B', marginBottom: 4 }}>
              {lowStockProducts.length} {lowStockProducts.length === 1 ? 'product needs' : 'products need'} restocking
            </div>
            <div style={{ fontSize: 12, color: '#a16d0a' }}>
              {lowStockProducts.slice(0, 5).map(p => `${p.name} (${p.stock_qty})`).join(' · ')}
              {lowStockProducts.length > 5 && ` and ${lowStockProducts.length - 5} more...`}
            </div>
          </div>
          <Button onClick={openBatchAdd}>Create batch order</Button>
        </div>
      )}

      {/* Suppliers chips */}
      {suppliers.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {suppliers.map(s => (
            <div key={s.id} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 99, padding: '5px 14px 5px 7px', fontSize: 12, color: '#555', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar name={s.name} size={22} />
              <span style={{ fontWeight: 500, color: '#0d1b2a' }}>{s.name}</span> {s.phone && <span style={{ color: '#aaa' }}>· {s.phone}</span>}
            </div>
          ))}
        </div>
      )}

      <Card>
        {pos.filter(p => p.status === 'pending' || p.status === 'ordered').length > 0 && (
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={markAllReceived}>
              <Truck size={13} /> Mark all pending as received
            </Button>
          </div>
        )}
        {loading ? <Spinner /> : poGroups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 0', color: '#c4c4c4', fontSize: 14 }}>
            <Package size={36} color="#e0e0e0" style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 500 }}>No purchase orders yet. Click 'Batch order' to create one.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Supplier','Products','Qty','Total','Ordered','Expected','Status','Payment','Slip',''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, color: '#bbb', borderBottom: '2px solid #f0f0f0', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {poGroups.map(g => {
                  const { anchor, rows } = g
                  const productRows = rows.filter(r => r.cost_type !== 'extra')
                  const feeRows = rows.filter(r => r.cost_type === 'extra')
                  const totalQty = productRows.reduce((s, r) => s + Number(r.qty || 0), 0)
                  const slipUrl = rows.find(r => r.slip_url)?.slip_url || null
                  const slipAnchorId = rows.find(r => r.slip_url)?.id || anchor.id

                  return (
                    <tr key={g.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      {/* Supplier */}
                      <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
                        {anchor.supplier_name
                          ? <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Avatar name={anchor.supplier_name} /><span style={{ fontWeight: 500, color: '#0d1b2a' }}>{anchor.supplier_name}</span></div>
                          : <span style={{ color: '#aaa' }}>—</span>}
                      </td>
                      {/* Products + fees summary */}
                      <td style={{ padding: '12px 12px', verticalAlign: 'middle', maxWidth: 260 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {productRows.map(r => (
                            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                              {r.image_url
                                ? <img src={r.image_url} style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 6, border: '1px solid #f0f0f0', flexShrink: 0 }} onError={e => e.target.style.display='none'} />
                                : <div style={{ width: 32, height: 32, borderRadius: 6, background: '#f5f5f5', flexShrink: 0 }} />}
                              <span style={{ fontWeight: 500, color: '#0d1b2a' }}>{r.product_name}</span>
                              <span style={{ color: '#aaa', fontSize: 11 }}>×{r.qty}</span>
                            </div>
                          ))}
                          {feeRows.length > 0 && (
                            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
                              {feeRows.map(f => (
                                <span key={f.id} style={{ fontSize: 10, fontWeight: 600, color: '#b8740a', background: '#FFF3D6', padding: '2px 7px', borderRadius: 99 }}>
                                  {f.product_name} MVR {Number(f.unit_cost).toFixed(2)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Total qty */}
                      <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
                        <strong>{totalQty}</strong>
                      </td>
                      {/* Total cost */}
                      <td style={{ padding: '12px 12px', verticalAlign: 'middle', fontWeight: 700, color: '#0d1b2a' }}>
                        MVR {g.total.toFixed(2)}
                      </td>
                      {/* Dates */}
                      <td style={{ padding: '12px 12px', verticalAlign: 'middle', color: '#888', fontSize: 12 }}>{anchor.order_date}</td>
                      <td style={{ padding: '12px 12px', verticalAlign: 'middle', color: '#888', fontSize: 12 }}>{anchor.expected_date || '—'}</td>
                      {/* Status — updates all rows */}
                      <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
                        <select value={anchor.status} onChange={e => updateBatchStatus(g, e.target.value)}
                          style={{ border: 'none', background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </td>
                      {/* Payment — for whole batch */}
                      <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {payStatusBadgeForGroup(g)}
                          <button className="icon-btn primary" title="Record payment" onClick={() => openGroupPayModal(g)}><CreditCard size={12} /></button>
                        </div>
                      </td>
                      {/* Slip — one per batch */}
                      <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
                        <button
                          onClick={() => setSlipModal({ ...anchor, slip_url: slipUrl, _anchorId: slipAnchorId })}
                          style={{ background: slipUrl ? '#E1F5EE' : '#fafafa', border: `1px solid ${slipUrl ? '#1D9E75' : '#e0e0e0'}`, borderRadius: 6, cursor: 'pointer', padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 4, color: slipUrl ? '#1D9E75' : '#aaa' }}>
                          {slipUrl ? <Eye size={13} /> : <Paperclip size={13} />}
                          <span style={{ fontSize: 10, fontWeight: 600 }}>{slipUrl ? 'View' : 'Attach'}</span>
                        </button>
                      </td>
                      {/* Delete */}
                      <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
                        <Button variant="danger" size="sm" onClick={() => delGroup(g)}><Trash2 size={13} /></Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Batch order modal */}
      {batchModal && (
        <Modal title="Create batch purchase order" subtitle="Order multiple products from a supplier in one go" onClose={() => setBatchModal(false)} width={780}>
          <FormRow>
            <Select label="Supplier" value={batchForm.supplier_id} onChange={handleSupplierChange}
              options={[{ value: '', label: '— Select or type below —' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]} />
            <Input label="Order date" type="date" value={batchForm.order_date} onChange={e => setBatchForm(p => ({ ...p, order_date: e.target.value }))} />
            <Input label="Expected delivery" type="date" value={batchForm.expected_date} onChange={e => setBatchForm(p => ({ ...p, expected_date: e.target.value }))} />
          </FormRow>

          {/* Items table */}
          <div style={{ marginTop: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Items ({batchForm.items.length})</span>
              <Button variant="ghost" size="sm" onClick={addItem}><Plus size={13} /> Add item</Button>
            </div>
            <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'visible' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase' }}>Product</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase' }}>Stock</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 80 }}>Qty</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 110 }}>Unit cost</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 110 }}>Total</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {batchForm.items.map((item, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid #f5f5f5' }}>
                      <td style={{ padding: 6 }}>
                        {item.product_id ? (
                          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 8px', border:'1px solid #ddd', borderRadius:6, background:'#fff' }}>
                            {item.image_url && <img src={item.image_url} style={{width:24,height:24,objectFit:'contain',borderRadius:4}} onError={e=>e.target.style.display='none'} />}
                            <span style={{flex:1,fontSize:12,color:'#0d1b2a'}}>{item.product_name}</span>
                            <button onClick={() => updateItem(idx,'product_id','')} style={{background:'none',border:'none',cursor:'pointer',color:'#aaa',padding:0}}><X size={12}/></button>
                          </div>
                        ) : (
                          <div style={{position:'relative'}}>
                            <input
                              value={itemSearch[idx]||''}
                              onChange={e => setItemSearch(p=>({...p,[idx]:e.target.value}))}
                              onFocus={() => setFocusedRow(idx)}
                              onBlur={() => setTimeout(() => setFocusedRow(f => f === idx ? null : f), 180)}
                              placeholder="Search product..."
                              style={{width:'100%',padding:'6px 8px',border:'1px solid #ddd',borderRadius:6,fontSize:12,fontFamily:'inherit',boxSizing:'border-box'}}
                              autoFocus={idx===batchForm.items.length-1}
                            />
                            {(focusedRow === idx || (itemSearch[idx]||'').length > 0) && (() => {
                              const q = (itemSearch[idx]||'').toLowerCase()
                              const suppId = batchForm.supplier_id
                              const catItems = supplierCatalog
                                .filter(p => (!suppId || p.supplier_id === suppId) && (!q || p.product_name?.toLowerCase().includes(q)))
                              const invItems = products
                                .filter(p => !q || p.name?.toLowerCase().includes(q))
                                .slice(0, q ? 20 : 5)
                              const total = catItems.length + invItems.length
                              if (total === 0) return null
                              return (
                                <div style={{position:'absolute',top:'100%',left:0,right:0,marginTop:4,background:'#fff',border:'1px solid #e0e0e0',borderRadius:8,boxShadow:'0 8px 28px rgba(0,0,0,0.16)',zIndex:9999,maxHeight:300,overflowY:'auto'}}>
                                  {catItems.length > 0 && <div style={{padding:'4px 10px',fontSize:10,fontWeight:700,color:'#FFA500',textTransform:'uppercase',letterSpacing:'0.5px',borderBottom:'1px solid #f5f5f5'}}>Supplier Catalog</div>}
                                  {catItems.map(p => (
                                    <div key={'cat:'+p.id} onClick={() => { updateItem(idx,'product_id','cat:'+p.id); setItemSearch(s=>({...s,[idx]:''})) }}
                                      style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',cursor:'pointer',fontSize:12,color:'#0d1b2a',borderBottom:'1px solid #f9f9f9'}}
                                      onMouseEnter={e=>e.currentTarget.style.background='#FFF8E0'}
                                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                                      {p.image_url && <img src={p.image_url} style={{width:22,height:22,objectFit:'contain',borderRadius:4,flexShrink:0}} onError={e=>e.target.style.display='none'} />}
                                      <div style={{flex:1}}>
                                        <div>{p.product_name}</div>
                                        {p.cost_price && <div style={{fontSize:10,color:'#aaa'}}>Cost: MVR {Number(p.cost_price).toFixed(2)}</div>}
                                      </div>
                                      {p.sku && <span style={{fontSize:10,color:'#ccc'}}>{p.sku}</span>}
                                    </div>
                                  ))}
                                  {invItems.length > 0 && <div style={{padding:'4px 10px',fontSize:10,fontWeight:700,color:'#378ADD',textTransform:'uppercase',letterSpacing:'0.5px',borderBottom:'1px solid #f5f5f5',marginTop:catItems.length?4:0}}>Inventory</div>}
                                  {invItems.map(p => (
                                    <div key={p.id} onClick={() => { updateItem(idx,'product_id',p.id); setItemSearch(s=>({...s,[idx]:''})) }}
                                      style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',cursor:'pointer',fontSize:12,color:'#0d1b2a',borderBottom:'1px solid #f9f9f9'}}
                                      onMouseEnter={e=>e.currentTarget.style.background='#f0f7ff'}
                                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                                      <div style={{flex:1}}>
                                        <div>{p.name}</div>
                                        <div style={{fontSize:10,color:'#aaa'}}>Stock: {p.stock_qty}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )
                            })()}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: item.current_stock <= 10 ? '#c62828' : '#888' }}>
                        {item.product_id ? item.current_stock : '—'}
                      </td>
                      <td style={{ padding: 6 }}>
                        <input type="number" min="1" value={item.qty} onChange={e => updateItem(idx, 'qty', e.target.value)}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: 6 }}>
                        <input type="number" step="0.01" min="0" value={item.unit_cost} onChange={e => updateItem(idx, 'unit_cost', e.target.value)}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>
                        MVR {(parseFloat(item.qty || 0) * parseFloat(item.unit_cost || 0)).toFixed(2)}
                      </td>
                      <td>
                        <button onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', padding: 4 }}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#fafafa', borderTop: '2px solid #eee' }}>
                    <td colSpan={4} style={{ padding: '10px', fontWeight: 700, color: '#0d1b2a' }}>Batch total</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: '#FFA500' }}>MVR {batchTotal.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Additional costs */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Additional costs ({(batchForm.extraCosts || []).length})</span>
              <Button variant="ghost" size="sm" onClick={addCost}><Plus size={13} /> Add cost</Button>
            </div>
            {(batchForm.extraCosts || []).length > 0 && (
              <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase' }}>Cost type</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 140 }}>Amount (MVR)</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(batchForm.extraCosts || []).map((c, idx) => (
                      <tr key={idx} style={{ borderTop: '1px solid #f5f5f5' }}>
                        <td style={{ padding: 6 }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select value={c.type} onChange={e => updateCost(idx, 'type', e.target.value)}
                              style={{ flex: c.type === 'Other' ? '0 0 130px' : 1, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: '#fff' }}>
                              {['Alibaba transaction charge', 'China local delivery', 'Shipping / Freight', 'Customs / Duty', 'Other'].map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {c.type === 'Other' && (
                              <input value={c.label} onChange={e => updateCost(idx, 'label', e.target.value)} placeholder="Specify cost..."
                                style={{ flex: 1, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }} />
                            )}
                          </div>
                        </td>
                        <td style={{ padding: 6 }}>
                          <input type="number" step="0.01" min="0" value={c.amount} onChange={e => updateCost(idx, 'amount', e.target.value)} placeholder="0.00"
                            style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', textAlign: 'right', boxSizing: 'border-box' }} />
                        </td>
                        <td>
                          <button onClick={() => removeCost(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', padding: 4 }}>
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Grand total summary */}
          {batchCostsTotal > 0 && (
            <div style={{ background: '#FFF8E0', border: '1px solid #FAEEDA', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', marginBottom: 5 }}><span>Products</span><span>MVR {batchItemsTotal.toFixed(2)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', marginBottom: 8 }}><span>Additional costs</span><span>MVR {batchCostsTotal.toFixed(2)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#0d1b2a', borderTop: '1px solid #FAEEDA', paddingTop: 8 }}><span>Grand total</span><span style={{ color: '#FFA500' }}>MVR {batchTotal.toFixed(2)}</span></div>
            </div>
          )}

          <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={15} color="#aaa" style={{ flexShrink: 0 }} />
            <span>When you mark items as <strong style={{ color: '#555', fontWeight: 600 }}>Received</strong>, stock will be automatically added to inventory.</span>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setBatchModal(false)}>Cancel</Button>
            <Button onClick={saveBatch} disabled={saving}>{saving ? 'Saving…' : `Create batch order (${batchForm.items.filter(i => i.product_id).length} items)`}</Button>
          </div>
        </Modal>
      )}

      {/* Supplier modal */}
      {supplierModal && (
        <Modal title="Add supplier" subtitle="Save a vendor to reuse on future orders" onClose={() => setSupplierModal(false)}>
          <FormRow>
            <Input label="Supplier name *" value={supplierForm.name} onChange={sf('name')} placeholder="e.g. LEGO, Mattel" style={{ gridColumn: 'span 2' }} />
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
      {/* Payment modal */}
      {payModal && (() => {
        const modalTotal = payModal._groupTotal || Number(payModal.total_cost || 0)
        const modalPaid = payModal._groupPaid ?? payments.filter(p => p.purchase_order_id === payModal.id).reduce((s, p) => s + Number(p.amount), 0)
        return (
        <Modal title="Record Payment" subtitle={`${payModal.supplier_name || 'Supplier'} — MVR ${modalTotal.toFixed(2)} total`} onClose={() => setPayModal(null)} width={480}>
          <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: '#bbb', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Outstanding Balance</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#E24B4A' }}>MVR {Math.max(0, modalTotal - modalPaid).toFixed(2)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#bbb', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Already Paid</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1D9E75' }}>MVR {modalPaid.toFixed(2)}</div>
            </div>
          </div>
          <FormRow>
            <Input label="Amount (MVR) *" type="number" min="0" step="0.01" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} />
            <Input label="Payment date" type="date" value={payForm.payment_date} onChange={e => setPayForm(p => ({ ...p, payment_date: e.target.value }))} />
          </FormRow>
          <Select label="Payment method" value={payForm.payment_method} onChange={e => setPayForm(p => ({ ...p, payment_method: e.target.value }))}
            options={['Bank Transfer', 'Cash', 'Cheque', 'Online Transfer', 'Other']} style={{ marginBottom: 14 }} />
          <Input label="Reference / Transaction ID" value={payForm.reference} onChange={e => setPayForm(p => ({ ...p, reference: e.target.value }))} placeholder="TXN-12345 (optional)" style={{ marginBottom: 14 }} />
          <Input label="Notes" value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" style={{ marginBottom: 20 }} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setPayModal(null)}>Cancel</Button>
            <Button onClick={recordPayment}><CreditCard size={13} /> Record Payment</Button>
          </div>
        </Modal>
        )
      })()}

      {/* Payments history panel */}
      {payments.length > 0 && (
        <Card style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ background: '#E1F5EE', borderRadius: 8, padding: 7 }}><Wallet size={14} color="#1D9E75" /></div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a' }}>Payment History</div>
                <div style={{ fontSize: 11, color: '#bbb' }}>Total paid: MVR {payments.reduce((s, p) => s + Number(p.amount), 0).toFixed(2)}</div>
              </div>
            </div>
            <button onClick={() => setPaymentsTab(p => !p)} style={{ fontSize: 12, color: '#FFA500', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
              {paymentsTab ? 'Hide' : `Show all (${payments.length})`}
            </button>
          </div>
          {paymentsTab && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['Date','Supplier','PO Product','Amount','Method','Reference'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '7px 12px', fontSize: 11, color: '#bbb', borderBottom: '1px solid #f0f0f0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {payments.map((p, i) => {
                  const po = pos.find(o => o.id === p.purchase_order_id)
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '9px 12px', color: '#888', fontSize: 12 }}>{p.payment_date}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 500 }}>{p.supplier_name || '—'}</td>
                      <td style={{ padding: '9px 12px', color: '#666', fontSize: 12 }}>{po?.product_name || '—'}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 700, color: '#1D9E75' }}>MVR {Number(p.amount).toFixed(2)}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12 }}><span style={{ background: '#f5f5f5', padding: '2px 8px', borderRadius: 99, fontWeight: 500 }}>{p.payment_method}</span></td>
                      <td style={{ padding: '9px 12px', color: '#aaa', fontSize: 11 }}>{p.reference || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* Slip modal */}
      {slipModal && (
        <Modal title="Payment Slip" subtitle={`${slipModal.product_name} — ${slipModal.supplier_name || ''}`} onClose={() => setSlipModal(null)} width={520}>
          {slipModal.slip_url ? (
            <div>
              <img src={slipModal.slip_url} alt="Payment slip" style={{ width: '100%', borderRadius: 10, border: '1px solid #eee', marginBottom: 16, maxHeight: 400, objectFit: 'contain' }} />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                <Button variant="ghost" onClick={() => { const a = document.createElement('a'); a.href = slipModal.slip_url; a.download = 'slip.jpg'; a.click() }}>Download</Button>
                <div style={{ display: 'flex', gap: 10 }}>
                  <label style={{ cursor: 'pointer' }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => uploadSlip(e.target.files[0])} />
                    <Button variant="ghost" as="span">Replace</Button>
                  </label>
                  <Button variant="danger" onClick={async () => { await supabase.from('purchase_orders').update({ slip_url: null }).eq('id', slipModal.id); toast.success('Slip removed'); setSlipModal(null); load() }}>Remove</Button>
                </div>
              </div>
            </div>
          ) : (
            <label
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#FFA500' }}
              onDragLeave={e => e.currentTarget.style.borderColor = '#e0e0e0'}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#e0e0e0'; uploadSlip(e.dataTransfer.files[0]) }}
              style={{ display: 'block', border: '2px dashed #e0e0e0', borderRadius: 12, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s' }}>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => uploadSlip(e.target.files[0])} />
              <Paperclip size={32} color="#ccc" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: '#555', marginBottom: 6 }}>{slipUploading ? 'Uploading…' : 'Drag & drop or click to upload'}</div>
              <div style={{ fontSize: 12, color: '#aaa' }}>Payment receipt, bank slip, or invoice image</div>
            </label>
          )}
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
