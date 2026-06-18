import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner, useToast, Toasts, StatusBadge, MetricCard } from '../components/UI'
import { Truck, User, Bike, CalendarDays, Package, CheckCircle, Search, Instagram, LayoutGrid, List, Award, Save } from 'lucide-react'

// Deliveries is a record-keeping tab: attach a staff member and a delivery date
// to each order. Changes stay local until Save is clicked.
export default function Deliveries() {
  const [orders, setOrders] = useState([])
  const [contacts, setContacts] = useState([])
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('unassigned') // unassigned | assigned | delivered | all
  const [view, setView] = useState('cards') // list | cards
  const [savingId, setSavingId] = useState(null)
  const [dateColMissing, setDateColMissing] = useState(false)
  // drafts: { [orderId]: { delivery_person?, delivery_date? } } — unsaved local edits
  const [drafts, setDrafts] = useState({})
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, c, cu, p] = await Promise.all([
      supabase.from('orders').select('*').neq('status', 'cancelled').order('created_at', { ascending: false }),
      supabase.from('email_contacts').select('*').order('name'),
      supabase.from('customers').select('*'),
      supabase.from('products').select('id, name, photo_url'),
    ])
    setOrders(o.data || [])
    setContacts(c.data || [])
    setCustomers(cu.data || [])
    setProducts(p.data || [])
    setDrafts({}) // clear drafts after reload
    setLoading(false)
  }

  // Update only the local draft — does NOT touch the DB.
  function draftChange(orderId, patch) {
    setDrafts(prev => ({ ...prev, [orderId]: { ...(prev[orderId] || {}), ...patch } }))
  }

  // Persist the draft for one order and merge it back into orders state.
  async function saveDelivery(orderId) {
    const draft = drafts[orderId]
    if (!draft) return
    setSavingId(orderId)
    const patch = { ...draft }
    let { error } = await supabase.from('orders').update(patch).eq('id', orderId)
    if (error && /delivery_date/i.test(error.message || '') && 'delivery_date' in patch) {
      setDateColMissing(true)
      const { delivery_date, ...rest } = patch
      if (Object.keys(rest).length) { const r = await supabase.from('orders').update(rest).eq('id', orderId); error = r.error }
      else error = null
    }
    if (error) {
      toast.error('Could not save: ' + error.message)
    } else {
      // Merge saved values back into the orders list immediately
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...patch } : o))
      // Clear only this order's draft
      setDrafts(prev => { const n = { ...prev }; delete n[orderId]; return n })
      toast.success('Saved!')
    }
    setSavingId(null)
  }

  const customer = o => customers.find(c => c.id === o.customer_id)
  const customerName = o => customer(o)?.name || o.customer_name || 'Walk-in'
  const customerInsta = o => customer(o)?.instagram || ''
  const productPhoto = o => products.find(p => p.id === o.product_id)?.photo_url || ''
  const orderDate = o => o.order_date || (o.created_at ? o.created_at.split('T')[0] : '')
  // Use the unsaved draft if present (even when cleared to empty), else the
  // saved value, else fall back to the order's creation date.
  const effectiveDate = o => {
    const d = drafts[o.id]
    if (d && 'delivery_date' in d) return d.delivery_date || ''
    return o.delivery_date || orderDate(o)
  }
  const draftStaff = o => drafts[o.id]?.delivery_person !== undefined ? drafts[o.id].delivery_person : (o.delivery_person || '')
  const isDirty = o => !!drafts[o.id] && Object.keys(drafts[o.id]).length > 0
  const contactNames = contacts.map(c => c.name)

  const filtered = orders.filter(o => {
    const matchSearch = !search ||
      (o.product_name || '').toLowerCase().includes(search.toLowerCase()) ||
      customerName(o).toLowerCase().includes(search.toLowerCase()) ||
      customerInsta(o).toLowerCase().includes(search.toLowerCase()) ||
      (o.invoice_number || '').toLowerCase().includes(search.toLowerCase())
    let matchFilter = true
    // unassigned = no staff (regardless of status, including delivered-without-staff)
    // assigned   = has staff AND not yet delivered
    // delivered  = status === 'delivered'
    if (filter === 'unassigned') matchFilter = !o.delivery_person
    else if (filter === 'assigned') matchFilter = !!o.delivery_person && o.status !== 'delivered'
    else if (filter === 'delivered') matchFilter = o.status === 'delivered'
    return matchSearch && matchFilter
  })

  // assigned = has staff AND not yet delivered (delivered ones drop out of this count)
  const assignedCount = orders.filter(o => o.delivery_person && o.status !== 'delivered').length
  const unassignedCount = orders.filter(o => !o.delivery_person).length
  const deliveredCount = orders.filter(o => o.status === 'delivered').length
  const today = new Date().toISOString().split('T')[0]
  const todayCount = orders.filter(o => effectiveDate(o) === today).length

  // Deliveries handled by each staff member (assigned total + completed).
  const staffReport = (() => {
    const map = {}
    orders.forEach(o => {
      const name = (o.delivery_person || '').trim()
      if (!name) return
      if (!map[name]) map[name] = { name, total: 0, delivered: 0 }
      map[name].total += 1
      if (o.status === 'delivered') map[name].delivered += 1
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  })()

  const FILTERS = [
    ['unassigned', `Unassigned (${unassignedCount})`],
    ['assigned', `Assigned (${assignedCount})`],
    ['delivered', 'Delivered'],
    ['all', 'All'],
  ]

  const StaffInput = ({ o, width = 150 }) => (
    <input className="dlv-input" list="dlv-staff" value={draftStaff(o)}
      placeholder="Assign staff…" style={{ width, borderColor: isDirty(o) ? '#FFA500' : undefined }}
      onChange={e => draftChange(o.id, { delivery_person: e.target.value })} />
  )
  const DateInput = ({ o, width = 150 }) => (
    <input className="dlv-input" type="date" value={effectiveDate(o)} style={{ width, borderColor: isDirty(o) ? '#FFA500' : undefined }}
      onChange={e => draftChange(o.id, { delivery_date: e.target.value || null })} />
  )
  const SaveBtn = ({ o }) => isDirty(o)
    ? <button onClick={() => saveDelivery(o.id)} disabled={savingId === o.id}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 16px', border: 'none', borderRadius: 8, background: '#FFA500', color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', boxShadow: '0 2px 8px rgba(255,165,0,0.35)', transition: 'opacity 0.15s' }}>
        <Save size={13} /> {savingId === o.id ? 'Saving…' : 'Save'}
      </button>
    : (o.delivery_person ? <CheckCircle size={16} color="#1D9E75" /> : null)

  return (
    <div>
      <style>{`
        .dlv-row { transition: background 0.15s ease; }
        .dlv-row:hover { background: #faf9f6; }
        .dlv-input { padding: 7px 10px; border: 1px solid #e2e0da; border-radius: 8px; font-size: 13px; font-family: inherit; outline: none; background: #fff; transition: border 0.15s, box-shadow 0.15s; box-sizing: border-box; }
        .dlv-input:focus { border-color: #FFA500; box-shadow: 0 0 0 3px rgba(255,165,0,0.12); }
        .dlv-pill { display:flex; gap:6px; flex-wrap:wrap; }
        .dlv-fbtn { padding:7px 14px; border-radius:99px; border:none; cursor:pointer; font-size:12.5px; font-weight:600; font-family:inherit; transition: all 0.15s; }
        .dlv-cards { display:grid; grid-template-columns: 1fr; gap:16px; }
        .dlv-card { display:flex; gap:20px; border:1px solid #eee; border-radius:16px; padding:16px; background:#fff; transition: box-shadow 0.18s, transform 0.18s; animation: dlvFade 0.3s ease both; }
        .dlv-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.07); transform: translateY(-1px); }
        .dlv-photo { width:340px; height:340px; flex-shrink:0; border-radius:12px; overflow:hidden; background:#fff; border:1px solid #f0eee8; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; }
        .dlv-photo img { width:100%; height:100%; object-fit:contain; border-radius:6px; }
        .dlv-cardbody { flex:1; min-width:0; display:flex; flex-direction:column; gap:10px; }
        @keyframes dlvFade { from { opacity:0; transform: translateY(6px) } to { opacity:1; transform:none } }
        @media (max-width: 860px) {
          .dlv-card { flex-direction:column; gap:14px; }
          .dlv-photo { width:100%; height:auto; aspect-ratio:1/1; max-width:340px; align-self:center; }
        }
        /* Phone-only: bigger photo, smaller text */
        @media (max-width: 600px) {
          .dlv-photo { max-width:100% !important; }
          .dlv-cust { font-size:17px !important; }
        }
      `}</style>

      <PageHeader title="Deliveries" subtitle="Assign a staff member and date to each order — for your records" />

      {dateColMissing && (
        <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#8a6d1b' }}>
          Staff is being saved, but delivery dates can’t be stored yet. Run this once in Supabase → SQL editor:
          <code style={{ display: 'block', marginTop: 6, background: '#fff', padding: '7px 10px', borderRadius: 6, fontFamily: 'monospace', color: '#a15c00' }}>alter table orders add column if not exists delivery_date date;</code>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
        <MetricCard label="Orders" value={orders.length} icon={Package} />
        <MetricCard label="Assigned" value={assignedCount} sub={`${orders.filter(o => !o.delivery_person).length} unassigned`} color="#378ADD" icon={Bike} />
        <MetricCard label="Delivered" value={deliveredCount} color="#1D9E75" icon={CheckCircle} />
        <MetricCard label="Scheduled today" value={todayCount} color="#FFA500" icon={CalendarDays} />
      </div>

      {/* Deliveries handled by each staff member */}
      {staffReport.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Award size={16} color="#FFA500" />
            <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Deliveries by staff</span>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {staffReport.map(s => (
              <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#faf9f6', border: '1px solid #f0eee8', borderRadius: 12, padding: '10px 16px' }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#FFA500,#ff8c00)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
                  {s.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0d1b2a' }}>{s.name}</div>
                  <div style={{ fontSize: 11.5, color: '#888' }}>
                    <span style={{ color: '#1D9E75', fontWeight: 600 }}>{s.delivered} delivered</span> · {s.total} assigned
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 320 }}>
            <Search size={14} color="#bbb" style={{ position: 'absolute', left: 11, top: 10 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orders, customers, @insta…"
              style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="dlv-pill">
              {FILTERS.map(([id, label]) => (
                <button key={id} className="dlv-fbtn" onClick={() => setFilter(id)} style={{
                  background: filter === id ? '#FFA500' : '#f3f1ec', color: filter === id ? '#fff' : '#777',
                  boxShadow: filter === id ? '0 3px 10px rgba(255,165,0,0.28)' : 'none',
                }}>{label}</button>
              ))}
            </div>
            <div className="dlv-pill" style={{ background: '#f3f1ec', borderRadius: 99, padding: 3 }}>
              {[['list', List], ['cards', LayoutGrid]].map(([id, Icon]) => (
                <button key={id} className="dlv-fbtn" onClick={() => setView(id)} style={{
                  background: view === id ? '#0d1b2a' : 'transparent', color: view === id ? '#fff' : '#888',
                  padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 5,
                }}><Icon size={14} /></button>
              ))}
            </div>
          </div>
        </div>

        {loading ? <Spinner /> : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '46px 0', color: '#c4c4c4' }}>
            <div style={{ width: 58, height: 58, borderRadius: 16, background: 'linear-gradient(135deg,#fff3df,#ffe9c7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <Truck size={26} color="#FFA500" />
            </div>
            <div style={{ fontWeight: 600, color: '#999' }}>No orders to show.</div>
          </div>
        ) : view === 'cards' ? (
          <div className="dlv-cards">
            {filtered.map(o => {
              const photo = productPhoto(o)
              const insta = customerInsta(o)
              return (
                <div key={o.id} className="dlv-card">
                  <div className="dlv-photo">
                    {photo ? <img src={photo} alt={o.product_name} /> : <Package size={56} color="#d8d4c8" />}
                  </div>
                  <div className="dlv-cardbody">
                    <div>
                      <div className="dlv-cust" style={{ fontSize: 19, fontWeight: 700, color: '#0d1b2a' }}>{customerName(o)}</div>
                      {insta && <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#C13584', fontSize: 13, marginTop: 2 }}><Instagram size={13} /> @{insta.replace(/^@/, '')}</div>}
                    </div>
                    <div style={{ fontSize: 14, color: '#555', fontWeight: 600 }}>{o.product_name} × {o.qty}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace' }}>{o.invoice_number || '—'}</span>
                      <StatusBadge status={o.status} />
                    </div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
                      <label style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>
                        <span style={{ display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery staff</span>
                        <StaffInput o={o} width={180} />
                      </label>
                      <label style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>
                        <span style={{ display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Delivery date</span>
                        <DateInput o={o} width={170} />
                      </label>
                    </div>
                    <div><SaveBtn o={o} /></div>
                  </div>
                </div>
              )
            })}
            <datalist id="dlv-staff">{contactNames.map(n => <option key={n} value={n} />)}</datalist>
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
                {filtered.map(o => {
                  const insta = customerInsta(o)
                  return (
                    <tr key={o.id} className="dlv-row" style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{o.product_name} × {o.qty}</div>
                        <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>{o.invoice_number || '—'}</div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#555' }}><User size={13} /> {customerName(o)}</div>
                        {insta && <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#C13584', fontSize: 11.5, marginTop: 2 }}><Instagram size={11} /> @{insta.replace(/^@/, '')}</div>}
                      </td>
                      <td style={{ padding: '10px 12px' }}><StatusBadge status={o.status} /></td>
                      <td style={{ padding: '10px 12px' }}><StaffInput o={o} /></td>
                      <td style={{ padding: '10px 12px' }}><DateInput o={o} /></td>
                      <td style={{ padding: '10px 12px', width: 80 }}>
                        <SaveBtn o={o} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <datalist id="dlv-staff">{contactNames.map(n => <option key={n} value={n} />)}</datalist>
          </div>
        )}
      </Card>

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
