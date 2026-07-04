import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner, useToast, Toasts } from '../components/UI'
import { History, Search, ShoppingCart, Package, Truck, Users, RefreshCw } from 'lucide-react'

const ACTION_STYLE = {
  create:  { bg: '#E1F5EE', fg: '#1D9E75', label: 'Created' },
  update:  { bg: '#EAF2FD', fg: '#2f6fc0', label: 'Updated' },
  delete:  { bg: '#FDECEA', fg: '#c0392b', label: 'Deleted' },
  cancel:  { bg: '#FDECEA', fg: '#c0392b', label: 'Cancelled' },
  return:  { bg: '#FFF3D6', fg: '#b8740a', label: 'Return' },
  payment: { bg: '#EEF0FF', fg: '#5b5bd6', label: 'Payment' },
  stock:   { bg: '#FFF3D6', fg: '#b8740a', label: 'Stock' },
}
const ENTITY_ICON = { order: ShoppingCart, product: Package, purchase_order: Truck, customer: Users }
const ENTITY_LABEL = { order: 'Order', product: 'Product', purchase_order: 'Batch order', customer: 'Customer', vendor: 'Vendor', catalog: 'Catalog' }

const fmtWhen = ts => {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleDateString('en', { day: 'numeric', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })
}
// Short human note from the details JSON, e.g. "total MVR 1400 · 2 items"
function detailText(d) {
  if (!d || typeof d !== 'object') return ''
  const bits = []
  if (d.total != null) bits.push(`MVR ${Number(d.total).toFixed(2)}`)
  if (d.items != null) bits.push(`${d.items} item${d.items === 1 ? '' : 's'}`)
  if (d.status) bits.push(String(d.status))
  if (d.method) bits.push(String(d.method))
  if (d.refund != null && Number(d.refund) > 0) bits.push(`refund MVR ${Number(d.refund).toFixed(2)}`)
  if (d.stock != null) bits.push(`stock ${d.stock}`)
  if (d.reason) bits.push(String(d.reason))
  return bits.join(' · ')
}

export default function AuditLog() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [notSetup, setNotSetup] = useState(false)
  const [search, setSearch] = useState('')
  const [entityFilter, setEntityFilter] = useState('all')
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(500)
    if (error) setNotSetup(true)
    else { setNotSetup(false); setRows(data || []) }
    setLoading(false)
  }

  const entities = ['all', ...new Set(rows.map(r => r.entity).filter(Boolean))]
  const filtered = rows.filter(r => {
    if (entityFilter !== 'all' && r.entity !== entityFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (r.entity_label || '').toLowerCase().includes(q) ||
      (r.user_email || '').toLowerCase().includes(q) ||
      (r.action || '').toLowerCase().includes(q)
  })

  // Group rows by calendar day for scannable headers
  const byDay = []
  filtered.forEach(r => {
    const day = (r.at || '').slice(0, 10)
    const last = byDay[byDay.length - 1]
    if (last && last.day === day) last.rows.push(r)
    else byDay.push({ day, rows: [r] })
  })

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Who did what, and when — orders, stock, payments and more"
        action={<button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#fff', border: '1px solid #eee', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', color: '#555' }}><RefreshCw size={13} /> Refresh</button>} />

      {notSetup ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '46px 24px' }}>
            <History size={32} color="#FFA500" style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1b2a', marginBottom: 6 }}>Audit log not set up yet</div>
            <div style={{ fontSize: 13, color: '#888', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
              Run <code style={{ background: '#f5f5f5', padding: '2px 6px', borderRadius: 4 }}>integrations/audit-and-extras-setup.sql</code> once
              in Supabase → SQL Editor. After that, every order, product, payment and stock change is recorded here automatically.
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 340 }}>
              <Search size={14} color="#bbb" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, action or user…"
                style={{ width: '100%', padding: '9px 12px 9px 34px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {entities.map(e => (
                <button key={e} onClick={() => setEntityFilter(e)}
                  style={{ padding: '8px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                    background: entityFilter === e ? '#0d1b2a' : '#f3f1ec', color: entityFilter === e ? '#fff' : '#777' }}>
                  {e === 'all' ? 'All' : (ENTITY_LABEL[e] || e)}
                </button>
              ))}
            </div>
          </div>

          {loading ? <Spinner /> : filtered.length === 0 ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb' }}>
                <History size={30} color="#e0e0e0" style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 13 }}>No activity recorded yet{search ? ` matching "${search}"` : ''}.</div>
              </div>
            </Card>
          ) : byDay.map(g => (
            <div key={g.day} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.6px', margin: '0 4px 8px' }}>
                {new Date(g.day + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {g.rows.map((r, i) => {
                  const st = ACTION_STYLE[r.action] || { bg: '#f5f5f5', fg: '#888', label: r.action || '—' }
                  const Icon = ENTITY_ICON[r.entity] || History
                  const detail = detailText(r.details)
                  return (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: i ? '1px solid #f6f6f6' : 'none' }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, background: st.bg, color: st.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={15} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#0d1b2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 700, color: st.fg }}>{st.label}</span>
                          <span style={{ color: '#bbb' }}> {ENTITY_LABEL[r.entity] || r.entity} </span>
                          <span style={{ fontWeight: 600 }}>{r.entity_label}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 1 }}>
                          {r.user_email || 'unknown user'}{detail ? ` · ${detail}` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: 11.5, color: '#bbb', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtWhen(r.at)}</span>
                    </div>
                  )
                })}
              </Card>
            </div>
          ))}
          {rows.length >= 500 && <div style={{ fontSize: 11.5, color: '#bbb', textAlign: 'center', marginTop: 4 }}>Showing the latest 500 entries.</div>}
        </>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
