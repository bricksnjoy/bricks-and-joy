import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, Package, Truck, X, Info, AlertTriangle, CreditCard, Wallet, CheckCircle } from 'lucide-react'

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
  const [batchForm, setBatchForm] = useState({ supplier_id: '', supplier_name: '', order_date: new Date().toISOString().split('T')[0], expected_date: '', items: [] })
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_name: '', email: '', phone: '', address: '' })
  const [saving, setSaving] = useState(false)
  const [supplierCatalog, setSupplierCatalog] = useState([])
  const [itemSearch, setItemSearch] = useState({})
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
      items: suggestedItems.length > 0 ? suggestedItems : [{ product_id: '', product_name: '', qty: 1, unit_cost: 0, current_stock: 0 }]
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

  async function saveBatch() {
    const validItems = batchForm.items.filter(i => i.product_id && i.qty > 0)
    if (validItems.length === 0) { toast.error('Add at least one product'); return }
    setSaving(true)
    
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
    }))
    
    const { error } = await supabase.from('purchase_orders').insert(records)
    setSaving(false)
    if (error) { toast.error('Failed to save'); return }
    toast.success(`Batch order created! ${validItems.length} items`)
    setBatchModal(false)
    load()
  }

  async function updateStatus(id, status) {
    const po = pos.find(p => p.id === id)
    await supabase.from('purchase_orders').update({ status }).eq('id', id)
    
    // If received, add to stock
    if (status === 'received' && po?.product_id && po?.status !== 'received') {
      const { data: prod } = await supabase.from('products').select('stock_qty, name').eq('id', po.product_id).single()
      if (prod) {
        const newStock = prod.stock_qty + po.qty
        await supabase.from('products').update({ stock_qty: newStock }).eq('id', po.product_id)
        toast.success(`Stock updated: ${prod.name} +${po.qty} = ${newStock}`)
      }
    }
    load()
  }

  async function markAllReceived() {
    if (!window.confirm('Mark all pending orders as received? This will add all quantities to stock.')) return
    const pending = pos.filter(p => p.status === 'pending' || p.status === 'ordered')
    for (const po of pending) {
      await updateStatus(po.id, 'received')
    }
    toast.success(`${pending.length} items received and added to stock`)
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

  const sf = k => e => setSupplierForm(prev => ({ ...prev, [k]: e.target.value }))

  function openPayModal(po) {
    const paid = payments.filter(p => p.purchase_order_id === po.id).reduce((s, p) => s + Number(p.amount), 0)
    const outstanding = Math.max(0, Number(po.total_cost || 0) - paid)
    setPayForm({ amount: outstanding.toFixed(2), payment_date: new Date().toISOString().split('T')[0], payment_method: 'Bank Transfer', reference: '', notes: '' })
    setPayModal(po)
  }

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

  function paidForPO(poId) {
    return payments.filter(p => p.purchase_order_id === poId).reduce((s, p) => s + Number(p.amount), 0)
  }

  function payStatusBadge(po) {
    const total = Number(po.total_cost || 0)
    const paid = paidForPO(po.id)
    if (paid <= 0) return <span style={{ fontSize: 11, fontWeight: 600, color: '#E24B4A', background: '#fef2f2', padding: '2px 8px', borderRadius: 99 }}>Unpaid</span>
    if (paid >= total) return <span style={{ fontSize: 11, fontWeight: 600, color: '#1D9E75', background: '#E1F5EE', padding: '2px 8px', borderRadius: 99 }}>Paid</span>
    return <span style={{ fontSize: 11, fontWeight: 600, color: '#f57f17', background: '#FFF8E1', padding: '2px 8px', borderRadius: 99 }}>Partial</span>
  }

  const totalSpend = pos.filter(p => p.status === 'received').reduce((s, p) => s + Number(p.total_cost || 0), 0)
  const pendingValue = pos.filter(p => p.status === 'pending' || p.status === 'ordered').reduce((s, p) => s + Number(p.total_cost || 0), 0)
  const batchTotal = batchForm.items.reduce((s, i) => s + (parseFloat(i.qty || 0) * parseFloat(i.unit_cost || 0)), 0)
  const lowStockProducts = products.filter(p => p.stock_qty <= (p.low_stock_threshold || 10))

  const columns = [
    { key: 'supplier_name', label: 'Supplier', render: r => r.supplier_name
      ? <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><Avatar name={r.supplier_name} /><span style={{ fontWeight: 500, color: '#0d1b2a' }}>{r.supplier_name}</span></div>
      : <span style={{ color: '#aaa' }}>—</span> },
    { key: 'product_name', label: 'Product' },
    { key: 'qty', label: 'Qty', render: r => <strong>{r.qty}</strong> },
    { key: 'unit_cost', label: 'Unit cost', render: r => `MVR ${Number(r.unit_cost).toFixed(2)}` },
    { key: 'total_cost', label: 'Total', render: r => <span style={{ fontWeight: 500 }}>MVR {Number(r.total_cost || 0).toFixed(2)}</span> },
    { key: 'order_date', label: 'Ordered', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.order_date}</span> },
    { key: 'expected_date', label: 'Expected', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.expected_date || '—'}</span> },
    { key: 'status', label: 'Status', render: r => (
      <select value={r.status} onChange={e => updateStatus(r.id, e.target.value)}
        style={{ border: 'none', background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
        {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    )},
    { key: 'payment', label: 'Payment', render: r => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {payStatusBadge(r)}
        <button className="icon-btn primary" title="Record payment" onClick={() => openPayModal(r)}><CreditCard size={12} /></button>
      </div>
    )},
    { key: 'actions', label: '', render: r => <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button> },
  ]

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
        {loading ? <Spinner /> : <Table columns={columns} data={pos} emptyMessage="No purchase orders yet. Click 'Batch order' to create one." />}
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
            <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
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
                              placeholder="Search product..."
                              style={{width:'100%',padding:'6px 8px',border:'1px solid #ddd',borderRadius:6,fontSize:12,fontFamily:'inherit',boxSizing:'border-box'}}
                              autoFocus={idx===batchForm.items.length-1}
                            />
                            {(itemSearch[idx]||'').length > 0 && (() => {
                              const q = (itemSearch[idx]||'').toLowerCase()
                              const suppId = batchForm.supplier_id
                              // Catalog items for this supplier
                              const catItems = supplierCatalog
                                .filter(p => (!suppId || p.supplier_id === suppId) && p.product_name?.toLowerCase().includes(q))
                                .slice(0,8)
                              // Inventory items
                              const invItems = products
                                .filter(p => p.name?.toLowerCase().includes(q))
                                .slice(0,5)
                              const total = catItems.length + invItems.length
                              if (total === 0) return null
                              return (
                                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:'1px solid #e0e0e0',borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,0.1)',zIndex:999,maxHeight:220,overflowY:'auto'}}>
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
      {payModal && (
        <Modal title="Record Payment" subtitle={`${payModal.supplier_name || 'Supplier'} — MVR ${Number(payModal.total_cost || 0).toFixed(2)} total`} onClose={() => setPayModal(null)} width={480}>
          <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: '#bbb', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Outstanding Balance</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#E24B4A' }}>MVR {Math.max(0, Number(payModal.total_cost || 0) - paidForPO(payModal.id)).toFixed(2)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#bbb', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Already Paid</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1D9E75' }}>MVR {paidForPO(payModal.id).toFixed(2)}</div>
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
      )}

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

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
