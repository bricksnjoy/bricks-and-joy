import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, Edit2, Eye, Package, ShoppingCart } from 'lucide-react'

const EMPTY = { name: '', contact_name: '', email: '', phone: '', address: '', payment_terms: 'Net 30', currency: 'MVR', notes: '' }
const PAYMENT_TERMS = ['Net 7', 'Net 15', 'Net 30', 'Net 60', 'Due on receipt', 'Prepaid']

export default function Vendors() {
  const [vendors, setVendors] = useState([])
  const [products, setProducts] = useState([])
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [viewModal, setViewModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [v, p, po] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('id, name, supplier_id, cost_price, stock_qty'),
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
    ])
    setVendors(v.data || [])
    setProducts(p.data || [])
    setPurchaseOrders(po.data || [])
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setModal('add') }
  function openEdit(v) { setForm(v); setModal('edit') }
  function openView(v) { setViewModal(v) }

  async function save() {
    if (!form.name) return
    setSaving(true)
    const { error } = modal === 'add'
      ? await supabase.from('suppliers').insert(form)
      : await supabase.from('suppliers').update(form).eq('id', form.id)
    setSaving(false)
    if (error) { toast.error('Failed to save'); return }
    toast.success(modal === 'add' ? 'Vendor added!' : 'Updated!')
    setModal(null); load()
  }

  async function del(id) {
    if (!window.confirm('Delete this vendor?')) return
    await supabase.from('suppliers').delete().eq('id', id)
    toast.success('Deleted'); load()
  }

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  function getVendorStats(vendorId) {
    const vProducts = products.filter(p => p.supplier_id === vendorId)
    const vPOs = purchaseOrders.filter(po => po.supplier_id === vendorId)
    const received = vPOs.filter(po => po.status === 'received')
    const pending = vPOs.filter(po => po.status === 'pending' || po.status === 'ordered')
    return {
      productCount: vProducts.length,
      totalOrders: vPOs.length,
      totalSpent: received.reduce((s, po) => s + Number(po.total_cost || 0), 0),
      pendingOrders: pending.length,
      pendingValue: pending.reduce((s, po) => s + Number(po.total_cost || 0), 0),
      products: vProducts,
      purchaseOrders: vPOs,
    }
  }

  const filtered = vendors.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.contact_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (v.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const totalSpentAll = vendors.reduce((s, v) => s + getVendorStats(v.id).totalSpent, 0)
  const totalPendingAll = vendors.reduce((s, v) => s + getVendorStats(v.id).pendingOrders, 0)

  const columns = [
    { key: 'name', label: 'Vendor', render: r => (
      <div>
        <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{r.name}</div>
        <div style={{ fontSize: 11, color: '#aaa' }}>{r.contact_name || r.email || '—'}</div>
      </div>
    )},
    { key: 'payment_terms', label: 'Terms', render: r => <Badge color="blue">{r.payment_terms || '—'}</Badge> },
    { key: 'products', label: 'Products', render: r => { const s = getVendorStats(r.id); return <strong>{s.productCount}</strong> }},
    { key: 'orders', label: 'POs', render: r => { const s = getVendorStats(r.id); return <span>{s.totalOrders}</span> }},
    { key: 'spent', label: 'Total purchased', render: r => { const s = getVendorStats(r.id); return <span style={{ fontWeight: 600, color: '#1D9E75' }}>MVR {s.totalSpent.toFixed(2)}</span> }},
    { key: 'pending', label: 'Pending', render: r => { const s = getVendorStats(r.id); return s.pendingOrders > 0 ? <Badge color="amber">{s.pendingOrders} orders</Badge> : <span style={{ color: '#aaa' }}>—</span> }},
    { key: 'actions', label: '', render: r => (
      <div style={{ display: 'flex', gap: 5 }}>
        <Button variant="ghost" size="sm" onClick={() => openView(r)}><Eye size={13} /></Button>
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Edit2 size={13} /></Button>
        <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button>
      </div>
    )},
  ]

  const viewStats = viewModal ? getVendorStats(viewModal.id) : null

  return (
    <div>
      <PageHeader title="Vendors" subtitle={`${vendors.length} suppliers`}
        action={<Button onClick={openAdd}><Plus size={15} /> Add vendor</Button>} />

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total vendors', value: vendors.length, color: '#0d1b2a' },
          { label: 'Total purchased', value: `MVR ${totalSpentAll.toFixed(2)}`, color: '#1D9E75' },
          { label: 'Pending orders', value: totalPendingAll, color: totalPendingAll > 0 ? '#f57f17' : '#1D9E75' },
        ].map((m, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee' }}>
            <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{m.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      <Card>
        <div style={{ marginBottom: 16 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendors…"
            style={{ padding: '9px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: 260, outline: 'none' }} />
        </div>
        {loading ? <Spinner /> : <Table columns={columns} data={filtered} emptyMessage="No vendors yet. Add your first supplier." />}
      </Card>

      {/* Vendor detail view */}
      {viewModal && viewStats && (
        <Modal title={viewModal.name} onClose={() => setViewModal(null)} width={700}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Products supplied', value: viewStats.productCount, color: '#0d1b2a' },
              { label: 'Total POs', value: viewStats.totalOrders, color: '#378ADD' },
              { label: 'Total spent', value: `MVR ${viewStats.totalSpent.toFixed(2)}`, color: '#1D9E75' },
              { label: 'Pending orders', value: viewStats.pendingOrders, color: viewStats.pendingOrders > 0 ? '#f57f17' : '#1D9E75' },
            ].map((m, i) => (
              <div key={i} style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', fontSize: 13 }}>
            {viewModal.contact_name && <div>👤 {viewModal.contact_name}</div>}
            {viewModal.email && <div>📧 {viewModal.email}</div>}
            {viewModal.phone && <div>📞 {viewModal.phone}</div>}
            {viewModal.address && <div>📍 {viewModal.address}</div>}
            {viewModal.payment_terms && <div>🗓 {viewModal.payment_terms}</div>}
          </div>
          {viewModal.notes && <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#555' }}>{viewModal.notes}</div>}

          {viewStats.products.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a', marginBottom: 10 }}>
                <Package size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />Products from this vendor
              </h3>
              <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      {['Product', 'Cost price', 'Stock'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: '1px solid #eee' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {viewStats.products.map((p, i) => (
                      <tr key={p.id} style={{ borderBottom: i < viewStats.products.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 500 }}>{p.name}</td>
                        <td style={{ padding: '9px 12px' }}>MVR {Number(p.cost_price).toFixed(2)}</td>
                        <td style={{ padding: '9px 12px' }}>{p.stock_qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {viewStats.purchaseOrders.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a', marginBottom: 10 }}>
                <ShoppingCart size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />Purchase order history
              </h3>
              <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      {['Date', 'Product', 'Qty', 'Total', 'Status'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: '1px solid #eee' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {viewStats.purchaseOrders.slice(0, 10).map((po, i) => (
                      <tr key={po.id} style={{ borderBottom: i < Math.min(viewStats.purchaseOrders.length, 10) - 1 ? '1px solid #f5f5f5' : 'none' }}>
                        <td style={{ padding: '9px 12px', color: '#888', fontSize: 12 }}>{po.order_date || '—'}</td>
                        <td style={{ padding: '9px 12px', fontWeight: 500 }}>{po.product_name || '—'}</td>
                        <td style={{ padding: '9px 12px' }}>{po.qty}</td>
                        <td style={{ padding: '9px 12px', fontWeight: 600 }}>MVR {Number(po.total_cost || 0).toFixed(2)}</td>
                        <td style={{ padding: '9px 12px' }}>
                          <Badge color={po.status === 'received' ? 'green' : po.status === 'ordered' ? 'blue' : 'amber'}>{po.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="ghost" onClick={() => { openEdit(viewModal); setViewModal(null) }}><Edit2 size={13} /> Edit</Button>
            <Button variant="ghost" onClick={() => setViewModal(null)}>Close</Button>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title={modal === 'add' ? 'Add vendor' : 'Edit vendor'} onClose={() => setModal(null)} width={560}>
          <FormRow>
            <Input label="Vendor / Company name *" value={form.name} onChange={f('name')} placeholder="e.g. LEGO Distributor Maldives" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Input label="Contact name" value={form.contact_name} onChange={f('contact_name')} placeholder="Primary contact" />
            <Input label="Phone" value={form.phone} onChange={f('phone')} placeholder="+960 xxx xxxx" />
          </FormRow>
          <FormRow>
            <Input label="Email" value={form.email} onChange={f('email')} placeholder="vendor@example.com" />
            <Select label="Payment terms" value={form.payment_terms} onChange={f('payment_terms')} options={PAYMENT_TERMS} />
          </FormRow>
          <Input label="Address" value={form.address} onChange={f('address')} placeholder="Street, City, Country" style={{ marginBottom: 12 }} />
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea value={form.notes} onChange={f('notes')} placeholder="Payment instructions, lead times, special terms…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 70, boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : modal === 'add' ? 'Add vendor' : 'Save changes'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
