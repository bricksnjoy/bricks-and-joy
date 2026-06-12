import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge, StatusBadge } from '../components/UI'
import { Plus, Trash2, Edit2, Eye, Printer } from 'lucide-react'

const EMPTY = { name: '', email: '', phone: '', address: '', notes: '' }

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [orders, setOrders] = useState([])
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
    const [c, o] = await Promise.all([
      supabase.from('customers').select('*').order('created_at', { ascending: false }),
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
    ])
    setCustomers(c.data || [])
    setOrders(o.data || [])
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setModal('add') }
  function openEdit(c) { setForm(c); setModal('edit') }
  function openView(c) { setViewModal(c) }

  async function save() {
    if (!form.name) return
    setSaving(true)
    const { error } = modal === 'add'
      ? await supabase.from('customers').insert(form)
      : await supabase.from('customers').update(form).eq('id', form.id)
    setSaving(false)
    if (error) { toast.error('Failed to save'); return }
    toast.success(modal === 'add' ? 'Customer added!' : 'Updated!')
    setModal(null); load()
  }

  async function del(id) {
    if (!window.confirm('Delete this customer?')) return
    await supabase.from('customers').delete().eq('id', id)
    toast.success('Deleted'); load()
  }

  function printPayslip(o, customer) {
    const w = window.open('', '_blank', 'width=480,height=640')
    const payStatus = o.payment_status || 'unpaid'
    const payColor = payStatus === 'paid' ? '#1D9E75' : payStatus === 'partial' ? '#f57f17' : '#c62828'
    w.document.write(`
      <html><head><title>Receipt — ${o.invoice_number || 'Order'}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Arial', sans-serif; padding: 30px; color: #0d1b2a; }
        .header { text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #0d1b2a; }
        .logo { font-size: 22px; font-weight: 900; color: #0d1b2a; }
        .sub { font-size: 11px; color: #999; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px; }
        .invoice-num { font-size: 13px; color: #FFA500; font-weight: 700; margin-top: 8px; }
        .section { margin-bottom: 18px; }
        .label { font-size: 10px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
        .value { font-size: 13px; font-weight: 600; }
        .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
        .total-row { display: flex; justify-content: space-between; padding: 12px 0; font-size: 16px; font-weight: 800; border-top: 2px solid #0d1b2a; margin-top: 6px; }
        .badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; background: ${payColor}22; color: ${payColor}; }
        .footer { text-align: center; margin-top: 28px; font-size: 11px; color: #aaa; }
        @media print { body { padding: 16px; } }
      </style></head>
      <body>
        <div class="header">
          <div class="logo">Brick's &amp; Joy</div>
          <div class="sub">Toy Company · Receipt</div>
          <div class="invoice-num">${o.invoice_number || 'No invoice number'}</div>
        </div>
        <div class="section" style="display:flex; gap:30px;">
          <div>
            <div class="label">Customer</div>
            <div class="value">${customer.name}</div>
            ${customer.phone ? `<div style="font-size:12px;color:#888">${customer.phone}</div>` : ''}
          </div>
          <div>
            <div class="label">Date</div>
            <div class="value">${o.order_date || '—'}</div>
          </div>
        </div>
        <div class="section">
          <div class="row" style="font-weight:700;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">
            <span>Item</span><span>Qty × Price</span><span>Total</span>
          </div>
          <div class="row">
            <span>${o.product_name}</span>
            <span>${o.qty} × MVR ${Number(o.unit_price || 0).toFixed(2)}</span>
            <span style="font-weight:700">MVR ${Number(o.total_price || 0).toFixed(2)}</span>
          </div>
          <div class="total-row">
            <span>Total</span>
            <span>MVR ${Number(o.total_price || 0).toFixed(2)}</span>
          </div>
        </div>
        <div class="section" style="display:flex; gap:20px; align-items:center;">
          <div>
            <div class="label">Payment status</div>
            <span class="badge">${payStatus.toUpperCase()}</span>
          </div>
          ${o.payment_method ? `<div><div class="label">Method</div><div class="value">${o.payment_method}</div></div>` : ''}
          ${o.transfer_reference ? `<div><div class="label">Reference</div><div class="value" style="font-family:monospace">${o.transfer_reference}</div></div>` : ''}
        </div>
        ${o.notes ? `<div class="section"><div class="label">Notes</div><div style="font-size:13px;color:#555">${o.notes}</div></div>` : ''}
        <div class="footer">Thank you for shopping at Brick's &amp; Joy! 🧸</div>
        <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }</script>
      </body></html>`)
    w.document.close()
  }

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  // Customer stats
  function getStats(customerId) {
    const custOrders = orders.filter(o => o.customer_id === customerId)
    const delivered = custOrders.filter(o => o.status === 'delivered')
    const unpaid = custOrders.filter(o => (o.payment_status || 'unpaid') === 'unpaid' && o.status !== 'cancelled')
    return {
      totalOrders: custOrders.length,
      deliveredOrders: delivered.length,
      totalSpent: delivered.reduce((s, o) => s + Number(o.total_price || 0), 0),
      unpaidAmount: unpaid.reduce((s, o) => s + Number(o.total_price || 0), 0),
      lastOrder: custOrders[0]?.order_date || null,
      orders: custOrders,
    }
  }

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search)
  )

  const columns = [
    { key: 'name', label: 'Customer', render: r => (
      <div>
        <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{r.name}</div>
        <div style={{ fontSize: 11, color: '#aaa' }}>{r.email || r.phone || '—'}</div>
      </div>
    )},
    { key: 'orders', label: 'Orders', render: r => { const s = getStats(r.id); return <strong>{s.totalOrders}</strong> }},
    { key: 'spent', label: 'Total spent', render: r => { const s = getStats(r.id); return <span style={{ fontWeight: 600, color: '#1D9E75' }}>MVR {s.totalSpent.toFixed(2)}</span> }},
    { key: 'unpaid', label: 'Unpaid', render: r => { const s = getStats(r.id); return s.unpaidAmount > 0 ? <span style={{ fontWeight: 600, color: '#c62828' }}>MVR {s.unpaidAmount.toFixed(2)}</span> : <span style={{ color: '#aaa' }}>—</span> }},
    { key: 'last_order', label: 'Last order', render: r => { const s = getStats(r.id); return <span style={{ color: '#888', fontSize: 12 }}>{s.lastOrder || '—'}</span> }},
    { key: 'actions', label: '', render: r => (
      <div style={{ display: 'flex', gap: 5 }}>
        <Button variant="ghost" size="sm" onClick={() => openView(r)}><Eye size={13} /></Button>
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Edit2 size={13} /></Button>
        <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button>
      </div>
    )},
  ]

  const viewStats = viewModal ? getStats(viewModal.id) : null

  return (
    <div>
      <PageHeader title="Customers" subtitle={`${customers.length} customers`}
        action={<Button onClick={openAdd}><Plus size={15} /> Add customer</Button>} />

      <Card>
        <div style={{ marginBottom: 16 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers…"
            style={{ padding: '9px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: 260, outline: 'none' }} />
        </div>
        {loading ? <Spinner /> : <Table columns={columns} data={filtered} emptyMessage="No customers yet." />}
      </Card>

      {/* Customer detail view */}
      {viewModal && viewStats && (
        <Modal title={viewModal.name} onClose={() => setViewModal(null)} width={720}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Total orders', value: viewStats.totalOrders, color: '#0d1b2a' },
              { label: 'Delivered', value: viewStats.deliveredOrders, color: '#1D9E75' },
              { label: 'Total spent', value: `MVR ${viewStats.totalSpent.toFixed(2)}`, color: '#1D9E75' },
              { label: 'Unpaid', value: viewStats.unpaidAmount > 0 ? `MVR ${viewStats.unpaidAmount.toFixed(2)}` : '✅ Clear', color: viewStats.unpaidAmount > 0 ? '#c62828' : '#1D9E75' },
            ].map((m, i) => (
              <div key={i} style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            {viewModal.email && <div style={{ fontSize: 13 }}>📧 {viewModal.email}</div>}
            {viewModal.phone && <div style={{ fontSize: 13 }}>📞 {viewModal.phone}</div>}
            {viewModal.address && <div style={{ fontSize: 13 }}>📍 {viewModal.address}</div>}
          </div>

          {viewModal.notes && <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#555' }}>{viewModal.notes}</div>}

          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a', marginBottom: 12 }}>Order history</h3>
          {viewStats.orders.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 13 }}>No orders yet.</p>
          ) : (
            <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    {['Invoice', 'Product', 'Qty', 'Total', 'Date', 'Status', 'Payment', ''].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: '1px solid #eee' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viewStats.orders.map((o, i) => (
                    <tr key={o.id} style={{ borderBottom: i < viewStats.orders.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                      <td style={{ padding: '9px 12px', fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>{o.invoice_number || '—'}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 500 }}>{o.product_name}</td>
                      <td style={{ padding: '9px 12px' }}>{o.qty}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 600 }}>MVR {Number(o.total_price || 0).toFixed(2)}</td>
                      <td style={{ padding: '9px 12px', color: '#888', fontSize: 12 }}>{o.order_date}</td>
                      <td style={{ padding: '9px 12px' }}><StatusBadge status={o.status} /></td>
                      <td style={{ padding: '9px 12px' }}>
                        <Badge color={(o.payment_status || 'unpaid') === 'paid' ? 'green' : (o.payment_status || 'unpaid') === 'partial' ? 'amber' : 'red'}>
                          {o.payment_status || 'unpaid'}
                        </Badge>
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <button onClick={() => printPayslip(o, viewModal)}
                          title="Print receipt"
                          style={{ background: 'none', border: '1px solid #ddd', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#555', fontFamily: 'inherit' }}>
                          <Printer size={11} /> Receipt
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="ghost" onClick={() => { openEdit(viewModal); setViewModal(null) }}><Edit2 size={13} /> Edit</Button>
            <Button variant="ghost" onClick={() => setViewModal(null)}>Close</Button>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal title={modal === 'add' ? 'Add customer' : 'Edit customer'} onClose={() => setModal(null)}>
          <FormRow>
            <Input label="Name *" value={form.name} onChange={f('name')} placeholder="Customer or store name" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Input label="Username / Instagram" value={form.email} onChange={f('email')} placeholder="@username" />
            <Input label="Phone" value={form.phone} onChange={f('phone')} placeholder="+960 xxx xxxx" />
          </FormRow>
          <Input label="Address" value={form.address} onChange={f('address')} placeholder="Street, City" style={{ marginBottom: 12 }} />
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea value={form.notes} onChange={f('notes')} placeholder="Any notes about this customer…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 70, boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : modal === 'add' ? 'Add customer' : 'Save changes'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
