import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, Edit2, Eye, Package, ShoppingCart, Tag, TrendingDown } from 'lucide-react'

const MVR_RATE = 15.4
const EMPTY = { name: '', contact_name: '', email: '', phone: '', address: '', payment_terms: 'Net 30', notes: '' }
const PAYMENT_TERMS = ['Net 7', 'Net 15', 'Net 30', 'Net 60', 'Due on receipt', 'Prepaid']
const PRICE_EMPTY = { product_id: '', custom_name: '', price: '', supplier_sku: '', moq: 1, notes: '' }

export default function Vendors() {
  const [vendors, setVendors] = useState([])
  const [products, setProducts] = useState([])
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [supplierProducts, setSupplierProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [viewModal, setViewModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('vendors') // 'vendors' | 'compare'
  const [compareSearch, setCompareSearch] = useState('')
  const [multiOnly, setMultiOnly] = useState(false)

  // Supplier product price modal
  const [priceModal, setPriceModal] = useState(null) // { mode: 'add'|'edit', id?, vendorId }
  const [priceForm, setPriceForm] = useState(PRICE_EMPTY)
  const [savingPrice, setSavingPrice] = useState(false)

  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [v, p, po, sp] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('id, name, supplier_id, cost_price, stock_qty'),
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('supplier_products').select('*, suppliers(name)').order('price', { ascending: true }),
    ])
    setVendors(v.data || [])
    setProducts(p.data || [])
    setPurchaseOrders(po.data || [])
    setSupplierProducts(sp.data || [])
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

  // ── Supplier product pricing ──
  function openAddPrice(vendorId) { setPriceForm(PRICE_EMPTY); setPriceModal({ mode: 'add', vendorId }) }
  function openEditPrice(sp) {
    setPriceForm({
      product_id: sp.product_id || '',
      custom_name: sp.product_id ? '' : (sp.product_name || ''),
      price: sp.price,
      supplier_sku: sp.supplier_sku || '',
      moq: sp.moq || 1,
      notes: sp.notes || '',
    })
    setPriceModal({ mode: 'edit', id: sp.id, vendorId: sp.supplier_id })
  }

  const pf = k => e => setPriceForm(p => ({ ...p, [k]: e.target.value }))

  async function savePrice() {
    if (!priceForm.price || (!priceForm.product_id && !priceForm.custom_name.trim())) {
      toast.error('Pick a product (or enter a name) and a price')
      return
    }
    setSavingPrice(true)
    const productName = priceForm.product_id
      ? (products.find(pr => pr.id === priceForm.product_id)?.name || '')
      : priceForm.custom_name.trim()
    const payload = {
      supplier_id: priceModal.vendorId,
      product_id: priceForm.product_id || null,
      product_name: productName,
      price: parseFloat(priceForm.price),
      supplier_sku: priceForm.supplier_sku || null,
      moq: priceForm.moq ? parseInt(priceForm.moq) : 1,
      notes: priceForm.notes || null,
    }
    const { error } = priceModal.mode === 'edit'
      ? await supabase.from('supplier_products').update(payload).eq('id', priceModal.id)
      : await supabase.from('supplier_products').insert(payload)
    setSavingPrice(false)
    if (error) { toast.error('Failed to save price'); return }
    toast.success(priceModal.mode === 'edit' ? 'Price updated!' : 'Price added!')
    setPriceModal(null); load()
  }

  async function delPrice(id) {
    if (!window.confirm('Remove this price entry?')) return
    await supabase.from('supplier_products').delete().eq('id', id)
    toast.success('Removed'); load()
  }

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
      priceList: supplierProducts.filter(sp => sp.supplier_id === vendorId),
    }
  }

  // ── Build price-comparison groups (same product offered by multiple vendors) ──
  const groupsMap = {}
  supplierProducts.forEach(sp => {
    const key = sp.product_id ? `id:${sp.product_id}` : `name:${(sp.product_name || '').toLowerCase().trim()}`
    if (!groupsMap[key]) groupsMap[key] = { key, name: sp.product_name || 'Unnamed product', offers: [] }
    groupsMap[key].offers.push(sp)
  })
  Object.values(groupsMap).forEach(g => g.offers.sort((a, b) => Number(a.price) - Number(b.price)))

  const compareGroups = Object.values(groupsMap)
    .filter(g => g.name.toLowerCase().includes(compareSearch.toLowerCase()))
    .filter(g => !multiOnly || g.offers.length > 1)
    .sort((a, b) => b.offers.length - a.offers.length || a.name.localeCompare(b.name))

  const multiSupplierCount = Object.values(groupsMap).filter(g => g.offers.length > 1).length

  function getCompareInfo(sp) {
    const key = sp.product_id ? `id:${sp.product_id}` : `name:${(sp.product_name || '').toLowerCase().trim()}`
    const g = groupsMap[key]
    if (!g || g.offers.length < 2) return null
    const cheapest = g.offers[0]
    if (cheapest.id === sp.id) return { cheapest: true, count: g.offers.length }
    const diff = ((sp.price - cheapest.price) / cheapest.price) * 100
    return { cheapest: false, diff, cheapestSupplier: cheapest.suppliers?.name }
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
    { key: 'prices', label: 'Prices listed', render: r => { const s = getVendorStats(r.id); return <span>{s.priceList.length}</span> }},
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

  const productOptions = [
    { value: '', label: '— Select from inventory —' },
    ...products.map(p => ({ value: p.id, label: p.name })),
    { value: '__custom__', label: '+ Product not in inventory (type name)' },
  ]

  return (
    <div>
      <style>{`
        .vd-tabs { display: flex; gap: 8px; margin-bottom: 18px; }
        .vd-tab { padding: 8px 16px; border-radius: 8px; border: 1px solid #ddd; background: #fff; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; color: #888; }
        .vd-tab.active { background: #FFA500; color: #fff; border-color: #FFA500; }
      `}</style>

      <PageHeader title="Vendors" subtitle={`${vendors.length} suppliers`}
        action={tab === 'vendors' ? <Button onClick={openAdd}><Plus size={15} /> Add vendor</Button> : null} />

      <div className="vd-tabs">
        <button className={`vd-tab ${tab === 'vendors' ? 'active' : ''}`} onClick={() => setTab('vendors')}>Vendors</button>
        <button className={`vd-tab ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>
          <Tag size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />Price comparison
        </button>
      </div>

      {tab === 'vendors' && (
        <>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
            {[
              { label: 'Total vendors', value: vendors.length, color: '#0d1b2a' },
              { label: 'Total purchased', value: `MVR ${totalSpentAll.toFixed(2)}`, color: '#1D9E75' },
              { label: 'Pending orders', value: totalPendingAll, color: totalPendingAll > 0 ? '#f57f17' : '#1D9E75' },
              { label: 'Products to compare', value: multiSupplierCount, color: multiSupplierCount > 0 ? '#378ADD' : '#0d1b2a' },
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
        </>
      )}

      {tab === 'compare' && (
        <Card>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={compareSearch} onChange={e => setCompareSearch(e.target.value)} placeholder="Search products…"
              style={{ padding: '9px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: 260, outline: 'none' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#666', cursor: 'pointer' }}>
              <input type="checkbox" checked={multiOnly} onChange={e => setMultiOnly(e.target.checked)} />
              Only show products with multiple suppliers
            </label>
          </div>

          {loading ? <Spinner /> : compareGroups.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 13 }}>
              No supplier prices recorded yet. Open a vendor and use "Add price" to record what each supplier charges for a product —
              once two or more suppliers offer the same product, they'll be compared here.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              {compareGroups.map(g => {
                const cheapest = g.offers[0]
                return (
                  <div key={g.key} style={{ border: '1px solid #eee', borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', margin: 0 }}>{g.name}</h3>
                      {g.offers.length > 1
                        ? <Badge color="green">{g.offers.length} suppliers</Badge>
                        : <Badge color="gray">1 supplier</Badge>}
                    </div>
                    {g.offers.map((o, i) => {
                      const diff = i === 0 ? 0 : ((o.price - cheapest.price) / cheapest.price) * 100
                      return (
                        <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: i > 0 ? '1px solid #f5f5f5' : 'none' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#0d1b2a' }}>{o.suppliers?.name || '—'}</div>
                            {o.supplier_sku && <div style={{ fontSize: 11, color: '#aaa' }}>SKU: {o.supplier_sku}</div>}
                            {o.moq > 1 && <div style={{ fontSize: 11, color: '#aaa' }}>MOQ: {o.moq}</div>}
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 800, fontSize: 16, color: i === 0 && g.offers.length > 1 ? '#1D9E75' : '#0d1b2a' }}>MVR {Number(o.price).toFixed(2)}</div>
                            <div style={{ fontSize: 11, color: i === 0 ? '#aaa' : '#c62828' }}>
                              ≈ ${(o.price / MVR_RATE).toFixed(2)}
                              {i === 0 && g.offers.length > 1 && <span style={{ color: '#1D9E75', fontWeight: 600 }}> · Best price</span>}
                              {i > 0 && <span style={{ fontWeight: 600 }}> · +{diff.toFixed(0)}% vs best</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {g.offers.length > 1 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #eee', fontSize: 11, color: '#aaa', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TrendingDown size={12} color="#1D9E75" />
                        Save MVR {(g.offers[g.offers.length - 1].price - cheapest.price).toFixed(2)} by buying from {cheapest.suppliers?.name}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

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

          {/* Products & pricing offered by this vendor */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a', margin: 0 }}>
              <Tag size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />Products & pricing
            </h3>
            <Button variant="ghost" size="sm" onClick={() => openAddPrice(viewModal.id)}><Plus size={13} /> Add price</Button>
          </div>
          {viewStats.priceList.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 13, marginBottom: 16 }}>
              No prices recorded for this vendor yet. Add a price to start comparing it against other suppliers.
            </p>
          ) : (
            <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    {['Product', 'Price (MVR)', 'SKU', 'MOQ', 'vs other suppliers', ''].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: '1px solid #eee' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viewStats.priceList.map((sp, i) => {
                    const cmp = getCompareInfo(sp)
                    return (
                      <tr key={sp.id} style={{ borderBottom: i < viewStats.priceList.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 500 }}>{sp.product_name}</td>
                        <td style={{ padding: '9px 12px', fontWeight: 700 }}>MVR {Number(sp.price).toFixed(2)}</td>
                        <td style={{ padding: '9px 12px', color: '#888' }}>{sp.supplier_sku || '—'}</td>
                        <td style={{ padding: '9px 12px', color: '#888' }}>{sp.moq || 1}</td>
                        <td style={{ padding: '9px 12px' }}>
                          {!cmp ? <span style={{ color: '#aaa' }}>Only supplier</span>
                            : cmp.cheapest ? <Badge color="green">Cheapest of {cmp.count}</Badge>
                            : <span style={{ color: '#c62828', fontSize: 12 }}>+{cmp.diff.toFixed(0)}% vs {cmp.cheapestSupplier}</span>}
                        </td>
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ display: 'flex', gap: 5 }}>
                            <Button variant="ghost" size="sm" onClick={() => openEditPrice(sp)}><Edit2 size={12} /></Button>
                            <Button variant="danger" size="sm" onClick={() => delPrice(sp.id)}><Trash2 size={12} /></Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {viewStats.products.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a', marginBottom: 10 }}>
                <Package size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />Products from this vendor (inventory)
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

      {/* Add/Edit vendor */}
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

      {/* Add/Edit supplier price */}
      {priceModal && (
        <Modal title={priceModal.mode === 'edit' ? 'Edit price' : 'Add product price'} onClose={() => setPriceModal(null)} width={480}>
          <div style={{ marginBottom: 12 }}>
            <Select label="Product *" value={priceForm.product_id || (priceForm.custom_name ? '__custom__' : '')}
              onChange={e => {
                const val = e.target.value
                if (val === '__custom__') setPriceForm(p => ({ ...p, product_id: '', custom_name: p.custom_name || '' }))
                else setPriceForm(p => ({ ...p, product_id: val, custom_name: '' }))
              }}
              options={productOptions} />
          </div>
          {(!priceForm.product_id) && (
            <Input label="Product name" value={priceForm.custom_name} onChange={pf('custom_name')} placeholder="e.g. LEGO Classic Set 11015" style={{ marginBottom: 12 }} />
          )}
          <FormRow>
            <Input label="Price (MVR) *" type="number" step="0.01" min="0" value={priceForm.price} onChange={pf('price')} placeholder="0.00" />
            <Input label="MOQ" type="number" min="1" value={priceForm.moq} onChange={pf('moq')} placeholder="1" />
          </FormRow>
          {parseFloat(priceForm.price) > 0 && (
            <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: '#888' }}>
              ≈ ${(parseFloat(priceForm.price) / MVR_RATE).toFixed(2)} USD
            </div>
          )}
          <Input label="Supplier SKU / part number" value={priceForm.supplier_sku} onChange={pf('supplier_sku')} placeholder="Optional" style={{ marginBottom: 12 }} />
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea value={priceForm.notes} onChange={pf('notes')} placeholder="Lead time, minimum order, bulk discounts…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 60, boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setPriceModal(null)}>Cancel</Button>
            <Button onClick={savePrice} disabled={savingPrice}>{savingPrice ? 'Saving…' : priceModal.mode === 'edit' ? 'Save changes' : 'Add price'}</Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
