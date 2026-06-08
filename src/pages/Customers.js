import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Table, Modal, Spinner, FormRow, useToast, Toasts } from '../components/UI'
import { Plus, Trash2, Edit2 } from 'lucide-react'

const EMPTY = { name: '', email: '', phone: '', address: '', notes: '' }

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [orderCounts, setOrderCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [c, o] = await Promise.all([
      supabase.from('customers').select('*').order('created_at', { ascending: false }),
      supabase.from('orders').select('customer_id, total_price, status'),
    ])
    setCustomers(c.data || [])
    // Aggregate order stats per customer
    const counts = {}
    ;(o.data || []).forEach(ord => {
      if (!ord.customer_id) return
      if (!counts[ord.customer_id]) counts[ord.customer_id] = { total: 0, revenue: 0 }
      counts[ord.customer_id].total++
      if (ord.status === 'delivered') counts[ord.customer_id].revenue += Number(ord.total_price || 0)
    })
    setOrderCounts(counts)
    setLoading(false)
  }

  function openAdd() { setForm(EMPTY); setModal('add') }
  function openEdit(c) { setForm(c); setModal('edit') }

  async function save() {
    if (!form.name) return
    setSaving(true)
    const { error } = modal === 'add'
      ? await supabase.from('customers').insert(form)
      : await supabase.from('customers').update(form).eq('id', form.id)
    setSaving(false)
    if (error) { toast.error('Failed to save'); return }
    toast.success(modal === 'add' ? 'Customer added!' : 'Customer updated!')
    setModal(null)
    load()
  }

  async function del(id) {
    if (!window.confirm('Delete this customer?')) return
    await supabase.from('customers').delete().eq('id', id)
    toast.success('Customer deleted')
    load()
  }

  const f = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }))

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search)
  )

  const columns = [
    { key: 'name', label: 'Name', render: r => <span style={{ fontWeight: 500, color: '#0d1b2a' }}>{r.name}</span> },
    { key: 'email', label: 'Email', render: r => <span style={{ color: '#888' }}>{r.email || '—'}</span> },
    { key: 'phone', label: 'Phone', render: r => <span style={{ color: '#888' }}>{r.phone || '—'}</span> },
    { key: 'orders', label: 'Orders', render: r => (orderCounts[r.id]?.total || 0) },
    { key: 'revenue', label: 'Total spent', render: r => <span style={{ fontWeight: 500 }}>${(orderCounts[r.id]?.revenue || 0).toFixed(2)}</span> },
    { key: 'address', label: 'Address', render: r => <span style={{ color: '#aaa', fontSize: 12 }}>{r.address || '—'}</span> },
    { key: 'actions', label: '', render: r => (
      <div style={{ display: 'flex', gap: 6 }}>
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Edit2 size={13} /></Button>
        <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button>
      </div>
    )},
  ]

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

      {modal && (
        <Modal title={modal === 'add' ? 'Add customer' : 'Edit customer'} onClose={() => setModal(null)}>
          <FormRow>
            <Input label="Name *" value={form.name} onChange={f('name')} placeholder="Customer or store name" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Input label="Email" type="email" value={form.email} onChange={f('email')} placeholder="email@example.com" />
            <Input label="Phone" value={form.phone} onChange={f('phone')} placeholder="+960 xxx xxxx" />
          </FormRow>
          <Input label="Address" value={form.address} onChange={f('address')} placeholder="Street, City" style={{ marginBottom: 12 }} />
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 4 }}>Notes</label>
            <textarea value={form.notes} onChange={f('notes')} placeholder="Any notes about this customer…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 80, boxSizing: 'border-box', outline: 'none' }} />
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
