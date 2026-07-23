import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, Edit2, Eye, Package, ShoppingCart, User, Mail, Phone, MapPin, CalendarDays, Search, Building2, TrendingUp, Download, Layers } from 'lucide-react'

const EMPTY = { name: '', contact_name: '', email: '', phone: '', address: '', payment_terms: 'Net 30', currency: 'MVR', notes: '' }
const PAYMENT_TERMS = ['Net 7', 'Net 15', 'Net 30', 'Net 60', 'Due on receipt', 'Prepaid']

const AVATAR_COLORS = ['#7F77DD', '#1D9E75', '#FFA500', '#378ADD', '#E24B4A', '#0F6E56']
function avatarColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function Avatar({ name }) {
  const color = avatarColor(name)
  return (
    <div style={{
      width: 30, height: 30, borderRadius: 8, background: color + '18', color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, fontWeight: 600, flexShrink: 0,
    }}>{(name || '?').charAt(0).toUpperCase()}</div>
  )
}

export default function Vendors() {
  const [vendors, setVendors] = useState([])
  const [products, setProducts] = useState([])
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [payments, setPayments] = useState([])
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
    const [v, p, po, sp] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('id, name, supplier_id, cost_price, stock_qty'),
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('supplier_payments').select('*'),
    ])
    setVendors(v.data || [])
    setProducts(p.data || [])
    setPurchaseOrders(po.data || [])
    setPayments(sp.data || [])
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setModal('add') }
  function openEdit(v) { setForm(v); setModal('edit') }
  function openView(v) { setViewModal(v) }

  async function save() {
    if (!form.name) { toast.error('Vendor name is required'); return }
    setSaving(true)
    let payload = {
      name: form.name,
      contact_name: form.contact_name || null,
      email: form.email || null,
      phone: form.phone || null,
      address: form.address || null,
      payment_terms: form.payment_terms || null,
      notes: form.notes || null,
    }
    const run = () => modal === 'add'
      ? supabase.from('suppliers').insert(payload)
      : supabase.from('suppliers').update(payload).eq('id', form.id)
    let { error } = await run()
    // Drop any column the table doesn't have yet, then retry
    while (error && /column .* does not exist|could not find/i.test(error.message || '')) {
      const col = (error.message.match(/'([a-z_]+)' column/i) || error.message.match(/column "?([a-z_]+)"?/i) || [])[1]
      if (!col || !(col in payload)) break
      delete payload[col]
      ;({ error } = await run())
    }
    setSaving(false)
    if (error) { toast.error('Failed to save: ' + error.message); return }
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

  // Group a vendor's purchase orders into batches (one batch = one batch order).
  // Numbered chronologically: oldest is Batch 1.
  function batchesFor(vendorId) {
    const vPOs = purchaseOrders.filter(po => po.supplier_id === vendorId)
    const map = new Map()
    vPOs.forEach(po => {
      const key = po.batch_no || `d:${po.order_date || (po.created_at || '').slice(0, 10)}`
      if (!map.has(key)) map.set(key, { key, batch_no: po.batch_no || '', date: po.order_date || (po.created_at || '').slice(0, 10), items: [], total: 0, statuses: new Set() })
      const g = map.get(key)
      g.items.push(po); g.total += Number(po.total_cost || 0); g.statuses.add(po.status)
    })
    const vPays = payments.filter(p => p.supplier_id === vendorId)
    const arr = [...map.values()].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    arr.forEach((b, i) => {
      b.seq = i + 1
      b.label = b.batch_no ? `Batch ${b.batch_no}` : `Batch ${i + 1}`
      b.status = b.statuses.has('pending') ? 'pending' : b.statuses.has('ordered') ? 'ordered' : 'received'
      b.units = b.items.reduce((s, po) => s + (parseInt(po.qty) || 0), 0)
      // payments attributed by matching batch number, or by a linked purchase-order id
      const itemIds = new Set(b.items.map(po => po.id))
      b.paid = vPays.filter(p => (b.batch_no && p.batch_no === b.batch_no) || (p.purchase_order_id && itemIds.has(p.purchase_order_id)))
        .reduce((s, p) => s + Number(p.amount || 0), 0)
      b.outstanding = Math.max(0, b.total - b.paid)
    })
    return arr
  }

  function downloadCSV(filename, headers, rows) {
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  }
  const slug = s => String(s || 'vendor').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  function downloadBatch(vendor, b) {
    const rows = b.items.map(po => [po.product_name || '', po.qty || 0, Number(po.unit_cost || 0).toFixed(2), Number(po.total_cost || 0).toFixed(2), po.status || '', po.order_date || ''])
    rows.push([])
    rows.push(['TOTAL', '', '', b.total.toFixed(2), '', ''])
    rows.push(['PAID', '', '', b.paid.toFixed(2), '', ''])
    rows.push(['OUTSTANDING', '', '', b.outstanding.toFixed(2), '', ''])
    downloadCSV(`${slug(vendor.name)}-${b.label.replace(/\s+/g, '')}.csv`,
      ['Product', 'Qty', 'Unit cost (MVR)', 'Total (MVR)', 'Status', 'Date'], rows)
  }
  function downloadAllBatches(vendor, batches) {
    const rows = []
    batches.forEach(b => b.items.forEach(po => rows.push([b.label, b.date || '', po.product_name || '', po.qty || 0, Number(po.unit_cost || 0).toFixed(2), Number(po.total_cost || 0).toFixed(2), po.status || '', b.paid.toFixed(2), b.outstanding.toFixed(2)])))
    downloadCSV(`${slug(vendor.name)}-batch-history.csv`, ['Batch', 'Date', 'Product', 'Qty', 'Unit cost (MVR)', 'Total (MVR)', 'Status', 'Batch paid (MVR)', 'Batch outstanding (MVR)'], rows)
  }

  const filtered = vendors.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.contact_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (v.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const totalSpentAll = vendors.reduce((s, v) => s + getVendorStats(v.id).totalSpent, 0)
  const totalPendingAll = vendors.reduce((s, v) => s + getVendorStats(v.id).pendingOrders, 0)

  const columns = [
    { key: 'name', label: 'Vendor', render: r => {
      const main = r.contact_name || r.name
      const sub = r.contact_name ? r.name : (r.email || '')
      return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Avatar name={main} />
        <div>
          <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{main}</div>
          <div style={{ fontSize: 11, color: '#aaa' }}>{sub || '—'}</div>
        </div>
      </div>
    )}},
    { key: 'payment_terms', label: 'Terms', render: r => <Badge color="blue">{r.payment_terms || '—'}</Badge> },
    { key: 'products', label: 'Products', render: r => { const s = getVendorStats(r.id); return <strong>{s.productCount}</strong> }},
    { key: 'orders', label: 'POs', render: r => { const s = getVendorStats(r.id); return <span>{s.totalOrders}</span> }},
    { key: 'spent', label: 'Total purchased', render: r => { const s = getVendorStats(r.id); return <span style={{ fontWeight: 600, color: '#1D9E75' }}>MVR {s.totalSpent.toFixed(2)}</span> }},
    { key: 'pending', label: 'Pending', render: r => { const s = getVendorStats(r.id); return s.pendingOrders > 0 ? <Badge color="amber">{s.pendingOrders} orders</Badge> : <span style={{ color: '#aaa' }}>—</span> }},
    { key: 'actions', label: '', render: r => {
      const batches = batchesFor(r.id)
      return (
      <div style={{ display: 'flex', gap: 5 }}>
        {batches.length > 0 && <Button variant="ghost" size="sm" title="Download batch history" onClick={() => downloadAllBatches(r, batches)}><Download size={13} /></Button>}
        <Button variant="ghost" size="sm" onClick={() => openView(r)}><Eye size={13} /></Button>
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Edit2 size={13} /></Button>
        <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button>
      </div>
    )}},
  ]

  const viewStats = viewModal ? getVendorStats(viewModal.id) : null

  return (
    <div>
      <PageHeader title="Vendors" subtitle={`${vendors.length} suppliers`}
        action={<Button onClick={openAdd}><Plus size={15} /> Add vendor</Button>} />

      {/* Summary */}
      <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total vendors', value: vendors.length, color: '#0d1b2a', icon: Building2 },
          { label: 'Total purchased', value: `MVR ${totalSpentAll.toFixed(2)}`, color: '#1D9E75', icon: TrendingUp },
          { label: 'Pending orders', value: totalPendingAll, color: totalPendingAll > 0 ? '#f57f17' : '#1D9E75', icon: ShoppingCart },
        ].map((m, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', border: '1px solid #eee', display: 'flex', alignItems: 'flex-start', gap: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ background: '#f8f7f4', borderRadius: 10, padding: 10, flexShrink: 0 }}>
              <m.icon size={18} color="#FFA500" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, fontWeight: 600 }}>{m.label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: m.color, letterSpacing: '-0.5px', lineHeight: 1 }}>{m.value}</div>
            </div>
          </div>
        ))}
      </div>

      <Card>
        <div style={{ marginBottom: 16, position: 'relative', width: 280 }}>
          <Search size={15} color="#bbb" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vendors…"
            style={{ padding: '9px 14px 9px 34px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', width: '100%', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        {loading ? <Spinner /> : <Table columns={columns} data={filtered} emptyMessage="No vendors yet. Add your first supplier." />}
      </Card>

      {/* Vendor detail view */}
      {viewModal && viewStats && (
        <Modal title={viewModal.contact_name || viewModal.name} subtitle={viewModal.contact_name ? viewModal.name : (viewModal.email || 'Vendor details')} onClose={() => setViewModal(null)} width={700}>
          <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Products supplied', value: viewStats.productCount, color: '#0d1b2a' },
              { label: 'Total POs', value: viewStats.totalOrders, color: '#378ADD' },
              { label: 'Total spent', value: `MVR ${viewStats.totalSpent.toFixed(2)}`, color: '#1D9E75' },
              { label: 'Pending orders', value: viewStats.pendingOrders, color: viewStats.pendingOrders > 0 ? '#f57f17' : '#1D9E75' },
            ].map((m, i) => (
              <div key={i} style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 18, marginBottom: 16, flexWrap: 'wrap', fontSize: 13, color: '#555' }}>
            {viewModal.contact_name && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><User size={14} color="#aaa" /> {viewModal.contact_name}</div>}
            {viewModal.email && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Mail size={14} color="#aaa" /> {viewModal.email}</div>}
            {viewModal.phone && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={14} color="#aaa" /> {viewModal.phone}</div>}
            {viewModal.address && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={14} color="#aaa" /> {viewModal.address}</div>}
            {viewModal.payment_terms && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CalendarDays size={14} color="#aaa" /> {viewModal.payment_terms}</div>}
          </div>
          {viewModal.notes && <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#555' }}>{viewModal.notes}</div>}

          {viewStats.products.length > 0 && (
            <>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: '#0d1b2a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                <Package size={14} color="#FFA500" />Products from this vendor
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

          {(() => {
            const batches = batchesFor(viewModal.id)
            if (!batches.length) return null
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 600, color: '#0d1b2a', margin: 0, display: 'flex', alignItems: 'center', gap: 7, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    <Layers size={14} color="#FFA500" /> Batch history ({batches.length})
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => downloadAllBatches(viewModal, batches)}><Download size={13} /> Download all batches</Button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {batches.slice().reverse().map(b => (
                    <div key={b.key} style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', background: '#faf9f6', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 800, color: '#0d1b2a', fontSize: 13.5 }}>{b.label}</span>
                          <span style={{ fontSize: 12, color: '#888' }}>{b.date || '—'}</span>
                          <Badge color={b.status === 'received' ? 'green' : b.status === 'ordered' ? 'blue' : 'amber'}>{b.status}</Badge>
                          <span style={{ fontSize: 12, color: '#888' }}>{b.items.length} product{b.items.length === 1 ? '' : 's'} · {b.units} unit{b.units === 1 ? '' : 's'}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontWeight: 700, color: '#0d1b2a' }}>MVR {b.total.toFixed(2)}</span>
                            <div style={{ fontSize: 11, fontWeight: 600 }}>
                              <span style={{ color: '#1D9E75' }}>Paid {b.paid.toFixed(2)}</span>
                              {b.outstanding > 0.005
                                ? <span style={{ color: '#E24B4A' }}> · Owe {b.outstanding.toFixed(2)}</span>
                                : <span style={{ color: '#1D9E75' }}> · ✓ settled</span>}
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => downloadBatch(viewModal, b)}><Download size={13} /></Button>
                        </div>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <tbody>
                          {b.items.map((po, i) => (
                            <tr key={po.id} style={{ borderTop: '1px solid #f5f5f5' }}>
                              <td style={{ padding: '8px 14px', fontWeight: 500 }}>{po.product_name || '—'}</td>
                              <td style={{ padding: '8px 14px', textAlign: 'right', color: '#888' }}>× {po.qty}</td>
                              <td style={{ padding: '8px 14px', textAlign: 'right', color: '#888' }}>@ MVR {Number(po.unit_cost || 0).toFixed(2)}</td>
                              <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 600 }}>MVR {Number(po.total_cost || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </>
            )
          })()}

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
