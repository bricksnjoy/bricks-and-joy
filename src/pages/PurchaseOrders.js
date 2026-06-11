import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, Package, Truck, X } from 'lucide-react'

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
  const [loading, setLoading] = useState(true)
  const [batchModal, setBatchModal] = useState(false)
  const [supplierModal, setSupplierModal] = useState(false)
  const [batchForm, setBatchForm] = useState({ supplier_id: '', supplier_name: '', order_date: new Date().toISOString().split('T')[0], expected_date: '', items: [] })
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_name: '', email: '', phone: '', address: '' })
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [p, s, pr] = await Promise.all([
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('*').order('name'),
    ])
    setPOs(p.data || [])
    setSuppliers(s.data || [])
    setProducts(pr.data || [])
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
      const p = products.find(p => p.id === value)
      newItems[idx] = { ...newItems[idx], product_id: value, product_name: p?.name || '', unit_cost: p?.cost_price || 0, current_stock: p?.stock_qty || 0 }
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
      product_id: item.product_id,
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

  const totalSpend = pos.filter(p => p.status === 'received').reduce((s, p) => s + Number(p.total_cost || 0), 0)
  const pendingValue = pos.filter(p => p.status === 'pending' || p.status === 'ordered').reduce((s, p) => s + Number(p.total_cost || 0), 0)
  const batchTotal = batchForm.items.reduce((s, i) => s + (parseFloat(i.qty || 0) * parseFloat(i.unit_cost || 0)), 0)
  const lowStockProducts = products.filter(p => p.stock_qty <= (p.low_stock_threshold || 10))

  const columns = [
    { key: 'supplier_name', label: 'Supplier', render: r => <span style={{ fontWeight: 500 }}>{r.supplier_name || '—'}</span> },
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
          <Package size={20} color="#f57f17" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#854F0B', marginBottom: 4 }}>
              {lowStockProducts.length} {lowStockProducts.length === 1 ? 'product needs' : 'products need'} restocking
            </div>
            <div style={{ fontSize: 12, color: '#a16d0a' }}>
              {lowStockProducts.slice(0, 5).map(p => `${p.name} (${p.stock_qty})`).join(' · ')}
              {lowStockProducts.length > 5 && ` and ${lowStockProducts.length - 5} more...`}
            </div>
          </div>
          <Button onClick={openBatchAdd} style={{ background: '#f57f17' }}>Create batch order</Button>
        </div>
      )}

      {/* Suppliers chips */}
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
        <Modal title="Create batch purchase order" onClose={() => setBatchModal(false)} width={780}>
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
                        <select value={item.product_id} onChange={e => updateItem(idx, 'product_id', e.target.value)}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: '#fff' }}>
                          <option value="">— Select —</option>
                          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
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
                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 800, color: '#FFA500' }}>MVR {batchTotal.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#888' }}>
            💡 When you mark items as <strong>Received</strong>, stock will be automatically added to inventory.
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setBatchModal(false)}>Cancel</Button>
            <Button onClick={saveBatch} disabled={saving}>{saving ? 'Saving…' : `Create batch order (${batchForm.items.filter(i => i.product_id).length} items)`}</Button>
          </div>
        </Modal>
      )}

      {/* Supplier modal */}
      {supplierModal && (
        <Modal title="Add supplier" onClose={() => setSupplierModal(false)}>
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
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
