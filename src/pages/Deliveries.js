import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner, useToast, Toasts, StatusBadge, MetricCard } from '../components/UI'
import { Truck, User, Bike, CalendarDays, Package, CheckCircle, Search } from 'lucide-react'

// Deliveries is a record-keeping tab: attach a staff member and a delivery date
// to each order. It does NOT limit who you can email/SMS — that's handled
// independently in the Message Center.
export default function Deliveries() {
  const [orders, setOrders] = useState([])
  const [contacts, setContacts] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | unassigned | assigned
  const [savingId, setSavingId] = useState(null)
  const [dateColMissing, setDateColMissing] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, c, cu] = await Promise.all([
      supabase.from('orders').select('*').neq('status', 'cancelled').order('created_at', { ascending: false }),
      supabase.from('email_contacts').select('*').order('name'),
      supabase.from('customers').select('*'),
    ])
    setOrders(o.data || [])
    setContacts(c.data || [])
    setCustomers(cu.data || [])
    setLoading(false)
  }

  // Update an order locally + persist. Falls back gracefully if the optional
  // delivery_date column hasn't been added to the database yet.
  async function saveDelivery(orderId, patch) {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...patch } : o))
    setSavingId(orderId)
    let { error } = await supabase.from('orders').update(patch).eq('id', orderId)
    if (error && /delivery_date/i.test(error.message || '') && 'delivery_date' in patch) {
      setDateColMissing(true)
      const { delivery_date, ...rest } = patch
      if (Object.keys(rest).length) { const r = await supabase.from('orders').update(rest).eq('id', orderId); error = r.error }
      else error = null
    }
    setSavingId(null)
    if (error) { toast.error('Could not save: ' + error.message); load() }
  }

  const customerName = o => customers.find(c => c.id === o.customer_id)?.name || o.customer_name || 'Walk-in'
  const contactNames = contacts.map(c => c.name)

  const filtered = orders.filter(o => {
    const matchSearch = !search ||
      (o.product_name || '').toLowerCase().includes(search.toLowerCase()) ||
      customerName(o).toLowerCase().includes(search.toLowerCase()) ||
      (o.invoice_number || '').toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all' || (filter === 'unassigned' ? !o.delivery_person : !!o.delivery_person)
    return matchSearch && matchFilter
  })

  const assignedCount = orders.filter(o => o.delivery_person).length
  const today = new Date().toISOString().split('T')[0]
  const todayCount = orders.filter(o => o.delivery_date === today).length

  const FILTERS = [['all', 'All'], ['unassigned', 'Unassigned'], ['assigned', 'Assigned']]

  return (
    <div>
      <style>{`
        .dlv-row { transition: background 0.15s ease; }
        .dlv-row:hover { background: #faf9f6; }
        .dlv-input { padding: 7px 10px; border: 1px solid #e2e0da; border-radius: 8px; font-size: 13px; font-family: inherit; outline: none; background: #fff; transition: border 0.15s, box-shadow 0.15s; }
        .dlv-input:focus { border-color: #FFA500; box-shadow: 0 0 0 3px rgba(255,165,0,0.12); }
        .dlv-pill { display:flex; gap:6px; }
        .dlv-fbtn { padding:7px 14px; border-radius:99px; border:none; cursor:pointer; font-size:12.5px; font-weight:600; font-family:inherit; transition: all 0.15s; }
      `}</style>

      <PageHeader title="Deliveries" subtitle="Assign a staff member and date to each order — for your records" />

      {dateColMissing && (
        <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#8a6d1b' }}>
          Staff is being saved, but delivery dates can’t be stored yet. Run this once in Supabase → SQL editor:
          <code style={{ display: 'block', marginTop: 6, background: '#fff', padding: '7px 10px', borderRadius: 6, fontFamily: 'monospace', color: '#a15c00' }}>alter table orders add column if not exists delivery_date date;</code>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        <MetricCard label="Orders" value={orders.length} icon={Package} />
        <MetricCard label="Assigned" value={assignedCount} sub={`${orders.length - assignedCount} unassigned`} color="#1D9E75" icon={Bike} />
        <MetricCard label="Scheduled today" value={todayCount} color="#FFA500" icon={CalendarDays} />
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 320 }}>
            <Search size={14} color="#bbb" style={{ position: 'absolute', left: 11, top: 10 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orders, customers…"
              style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div className="dlv-pill">
            {FILTERS.map(([id, label]) => (
              <button key={id} className="dlv-fbtn" onClick={() => setFilter(id)} style={{
                background: filter === id ? '#FFA500' : '#f3f1ec', color: filter === id ? '#fff' : '#777',
                boxShadow: filter === id ? '0 3px 10px rgba(255,165,0,0.28)' : 'none',
              }}>{label}</button>
            ))}
          </div>
        </div>

        {loading ? <Spinner /> : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '46px 0', color: '#c4c4c4' }}>
            <div style={{ width: 58, height: 58, borderRadius: 16, background: 'linear-gradient(135deg,#fff3df,#ffe9c7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <Truck size={26} color="#FFA500" />
            </div>
            <div style={{ fontWeight: 600, color: '#999' }}>No orders to show.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
              <thead>
                <tr>
                  {['Order', 'Customer', 'Status', 'Delivery staff', 'Delivery date', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, color: '#bbb', borderBottom: '2px solid #f0f0f0', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => (
                  <tr key={o.id} className="dlv-row" style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{o.product_name} × {o.qty}</div>
                      <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>{o.invoice_number || '—'}</div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#555' }}><User size={13} /> {customerName(o)}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={o.status} /></td>
                    <td style={{ padding: '10px 12px' }}>
                      <input className="dlv-input" list="dlv-staff" value={o.delivery_person || ''}
                        placeholder="Assign staff…" style={{ width: 150 }}
                        onChange={e => setOrders(prev => prev.map(x => x.id === o.id ? { ...x, delivery_person: e.target.value } : x))}
                        onBlur={e => saveDelivery(o.id, { delivery_person: e.target.value.trim() })} />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <input className="dlv-input" type="date" value={o.delivery_date || ''} style={{ width: 150 }}
                        onChange={e => saveDelivery(o.id, { delivery_date: e.target.value || null })} />
                    </td>
                    <td style={{ padding: '10px 12px', width: 30 }}>
                      {savingId === o.id
                        ? <span style={{ fontSize: 11, color: '#FFA500' }}>Saving…</span>
                        : o.delivery_person && <CheckCircle size={15} color="#1D9E75" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="dlv-staff">
              {contactNames.map(n => <option key={n} value={n} />)}
            </datalist>
          </div>
        )}
      </Card>

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
