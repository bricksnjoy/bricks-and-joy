import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localToday, toLocalISO } from '../lib/dates'
import { logAudit } from '../lib/audit'
import { PageHeader, Card, Button, Input, Select, Modal, Spinner, FormRow, useToast, Toasts, Badge, MetricCard, SearchSelect } from '../components/UI'
import {
  PartyPopper, Plus, Trash2, Edit2, Gift, Lightbulb, CalendarClock, CheckCircle2,
  Eye, Radio, Heart, MessageCircle, Share2, Bookmark, TrendingUp, Wallet, Package,
  Calendar, Sparkles, Megaphone
} from 'lucide-react'

// idea → planned → done
const STATUSES = [
  { value: 'idea',    label: 'Idea',    color: 'purple', icon: Lightbulb,     tint: '#f3e5f5', ink: '#6a1b9a' },
  { value: 'planned', label: 'Planned', color: 'amber',  icon: CalendarClock, tint: '#fff8e1', ink: '#b8740a' },
  { value: 'done',    label: 'Done',    color: 'green',  icon: CheckCircle2,  tint: '#e8f5e9', ink: '#2e7d32' },
]
const statusOf = v => STATUSES.find(s => s.value === v) || STATUSES[0]

const PLATFORMS = ['Instagram', 'TikTok', 'Facebook', 'WhatsApp', 'In-store', 'Other']
const CASH_CATEGORIES = ['Promotions', 'Meta Ads', 'Sponsorship', 'Giveaway', 'Sample Testing', 'Other']

// The result metrics we capture, with the icon shown on the card
const METRICS = [
  { key: 'impressions', label: 'Impressions', icon: Eye },
  { key: 'reach',       label: 'Reach',       icon: Radio },
  { key: 'likes',       label: 'Likes',       icon: Heart },
  { key: 'comments',    label: 'Comments',    icon: MessageCircle },
  { key: 'shares',      label: 'Shares',      icon: Share2 },
  { key: 'saves',       label: 'Saves',       icon: Bookmark },
]

const EMPTY_GA_ROW = { id: null, product_id: '', qty: 1, unit_cost: '', expense_id: null }
const EMPTY_EVENT = {
  name: '', status: 'idea', platform: '', event_date: '', prep_date: '', description: '',
  impressions: '', reach: '', likes: '', comments: '', shares: '', saves: '', results_notes: '',
  cash_amount: '', cash_category: 'Promotions',
}

const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const int = v => { const n = parseInt(v); return isNaN(n) ? 0 : n }
const money = n => `MVR ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const compact = n => Number(n || 0).toLocaleString('en-US')

// whole days between two YYYY-MM-DD dates (b − a)
function daysBetween(a, b) {
  if (!a || !b) return null
  const d = Math.round((new Date(b) - new Date(a)) / 86400000)
  return d
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Events() {
  const [events, setEvents] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [filter, setFilter] = useState('all')

  const [modal, setModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(EMPTY_EVENT)
  const [gaRows, setGaRows] = useState([])
  const [gaOriginal, setGaOriginal] = useState([]) // committed giveaways as loaded, for reconciliation
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => { load(); loadProducts() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('events').select('*').order('event_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
    if (error) {
      // Table not created yet — show a friendly setup card instead of crashing
      if (/relation|does not exist|schema cache/i.test(error.message)) setNeedsSetup(true)
      setEvents([])
    } else {
      setNeedsSetup(false)
      setEvents(data || [])
    }
    setLoading(false)
  }

  async function loadProducts() {
    const { data } = await supabase.from('products').select('id, name, stock_qty, cost_price, low_stock_threshold').order('name')
    setProducts(data || [])
  }

  function openAdd() {
    setForm({ ...EMPTY_EVENT, prep_date: '', event_date: '' })
    setGaRows([])
    setGaOriginal([])
    setEditItem(null)
    setModal(true)
  }

  async function openEdit(ev) {
    setForm({
      name: ev.name || '', status: ev.status || 'idea', platform: ev.platform || '',
      event_date: ev.event_date || '', prep_date: ev.prep_date || '', description: ev.description || '',
      impressions: ev.impressions || '', reach: ev.reach || '', likes: ev.likes || '',
      comments: ev.comments || '', shares: ev.shares || '', saves: ev.saves || '',
      results_notes: ev.results_notes || '',
      cash_amount: ev.cash_amount || '', cash_category: ev.cash_category || 'Promotions',
    })
    setEditItem(ev)
    setModal(true)
    // Load this event's committed giveaways
    const { data } = await supabase.from('event_giveaways').select('*').eq('event_id', ev.id)
    const rows = (data || []).map(r => ({ id: r.id, product_id: r.product_id || '', qty: r.qty, unit_cost: r.unit_cost ?? '', expense_id: r.expense_id }))
    setGaRows(rows)
    setGaOriginal(rows.map(r => ({ ...r })))
  }

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  // ── giveaway rows ────────────────────────────────────────────────────────────
  function setGaRow(idx, patch) { setGaRows(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r)) }
  function pickGaProduct(idx, productId) {
    const prod = products.find(p => p.id === productId)
    setGaRow(idx, { product_id: productId, unit_cost: prod ? Number(prod.cost_price || 0) : '' })
  }
  function addGaRow() { setGaRows(rows => [...rows, { ...EMPTY_GA_ROW }]) }
  function removeGaRow(idx) { setGaRows(rows => rows.filter((_, i) => i !== idx)) }

  const gaValid = gaRows.filter(r => r.product_id && int(r.qty) > 0)
  const gaTotal = gaValid.reduce((s, r) => s + int(r.qty) * num(r.unit_cost), 0)
  const cashTotal = num(form.cash_amount)
  const grandTotal = cashTotal + gaTotal

  // Adjust one product's stock by delta (positive = give back, negative = take out)
  async function adjustStock(productId, delta, reason) {
    if (!productId || !delta) return
    const { data: fresh } = await supabase.from('products').select('stock_qty, name, low_stock_threshold').eq('id', productId).single()
    if (!fresh) return
    const newStock = (Number(fresh.stock_qty) || 0) + delta
    await supabase.from('products').update({ stock_qty: newStock }).eq('id', productId)
    if (delta < 0) {
      if (newStock <= 0) toast.error(`⚠️ ${fresh.name} OUT OF STOCK!`)
      else if (newStock <= (fresh.low_stock_threshold ?? 10)) toast.info(`⚠️ Low stock: ${fresh.name} — ${newStock} left`)
    }
    logAudit('stock', 'product', `${fresh.name} ${delta < 0 ? '−' : '+'}${Math.abs(delta)} (${reason})`, { delta })
  }

  async function saveEvent() {
    if (!form.name.trim()) { toast.error('Give the event a name'); return }
    setSaving(true)
    try {
      const base = {
        name: form.name.trim(), status: form.status, platform: form.platform || null,
        event_date: form.event_date || null, prep_date: form.prep_date || null,
        description: form.description || null,
        impressions: int(form.impressions), reach: int(form.reach), likes: int(form.likes),
        comments: int(form.comments), shares: int(form.shares), saves: int(form.saves),
        results_notes: form.results_notes || null,
        cash_amount: cashTotal, cash_category: form.cash_category,
        product_cost: gaTotal,
      }

      // 1. Upsert the event so we have an id to hang costs off
      let eventId = editItem?.id
      let cashExpenseId = editItem?.cash_expense_id || null
      if (editItem) {
        const { error } = await supabase.from('events').update(base).eq('id', eventId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('events').insert(base).select('id').single()
        if (error) throw error
        eventId = data.id
      }

      const eventLabel = `Event: ${base.name}`

      // 2. Reconcile product giveaways (accounting + inventory) ------------------
      const curById = new Map(gaValid.filter(r => r.id).map(r => [r.id, r]))
      // 2a. removed giveaways → give stock back, delete their expense
      for (const orig of gaOriginal) {
        if (!curById.has(orig.id)) {
          await adjustStock(orig.product_id, int(orig.qty), 'giveaway removed')
          if (orig.expense_id) await supabase.from('expenses').delete().eq('id', orig.expense_id)
          await supabase.from('event_giveaways').delete().eq('id', orig.id)
        }
      }
      // 2b. existing giveaways that changed → adjust stock delta + update expense
      for (const row of gaValid.filter(r => r.id)) {
        const orig = gaOriginal.find(o => o.id === row.id)
        if (!orig) continue
        const prod = products.find(p => p.id === row.product_id)
        const qty = int(row.qty), unit = num(row.unit_cost)
        const sameProduct = orig.product_id === row.product_id
        if (sameProduct) {
          const delta = int(orig.qty) - qty // gave 5, now 3 → +2 back to stock
          if (delta !== 0) await adjustStock(row.product_id, delta, 'giveaway edited')
        } else {
          await adjustStock(orig.product_id, int(orig.qty), 'giveaway product changed')
          await adjustStock(row.product_id, -qty, 'giveaway product changed')
        }
        if (orig.expense_id) {
          await supabase.from('expenses').update({
            description: `${eventLabel} — ${prod?.name || 'Product'} ×${qty}`, amount: +(qty * unit).toFixed(2),
          }).eq('id', orig.expense_id)
        }
        await supabase.from('event_giveaways').update({
          product_id: row.product_id, product_name: prod?.name || null, qty, unit_cost: unit,
        }).eq('id', row.id)
      }
      // 2c. brand-new giveaways → deduct stock, create expense, insert link row
      for (const row of gaValid.filter(r => !r.id)) {
        const prod = products.find(p => p.id === row.product_id)
        const qty = int(row.qty), unit = num(row.unit_cost)
        const { data: exp } = await supabase.from('expenses').insert({
          description: `${eventLabel} — ${prod?.name || 'Product'} ×${qty}`,
          category: 'Giveaway', amount: +(qty * unit).toFixed(2), expense_date: base.event_date || localToday(),
        }).select('id').single()
        await supabase.from('event_giveaways').insert({
          event_id: eventId, product_id: row.product_id, product_name: prod?.name || null,
          qty, unit_cost: unit, expense_id: exp?.id || null,
        })
        await adjustStock(row.product_id, -qty, 'given away')
      }

      // 3. Reconcile the cash cost (one expense row) ----------------------------
      if (cashTotal > 0) {
        const payload = {
          description: `${eventLabel} (cash)`, category: form.cash_category,
          amount: +cashTotal.toFixed(2), expense_date: base.event_date || localToday(),
        }
        if (cashExpenseId) {
          await supabase.from('expenses').update(payload).eq('id', cashExpenseId)
        } else {
          const { data: exp } = await supabase.from('expenses').insert(payload).select('id').single()
          cashExpenseId = exp?.id || null
        }
      } else if (cashExpenseId) {
        await supabase.from('expenses').delete().eq('id', cashExpenseId)
        cashExpenseId = null
      }
      // persist the cash expense link if it changed
      if ((editItem?.cash_expense_id || null) !== cashExpenseId) {
        await supabase.from('events').update({ cash_expense_id: cashExpenseId }).eq('id', eventId)
      }

      logAudit(editItem ? 'update' : 'create', 'event', base.name, { total: grandTotal, giveaways: gaValid.length })
      toast.success(editItem ? 'Event updated!' : 'Event saved!')
      setModal(false)
      load(); loadProducts()
    } catch (err) {
      toast.error('Failed to save: ' + (err.message || err))
    } finally {
      setSaving(false)
    }
  }

  async function del(ev) {
    if (!window.confirm(`Delete "${ev.name}"?\n\nThis also removes its logged costs from Cost Management and adds any given-away products back to stock.`)) return
    const { data: gas } = await supabase.from('event_giveaways').select('*').eq('event_id', ev.id)
    for (const g of gas || []) {
      await adjustStock(g.product_id, int(g.qty), 'event deleted')
      if (g.expense_id) await supabase.from('expenses').delete().eq('id', g.expense_id)
    }
    if (ev.cash_expense_id) await supabase.from('expenses').delete().eq('id', ev.cash_expense_id)
    await supabase.from('events').delete().eq('id', ev.id)
    logAudit('delete', 'event', ev.name)
    toast.success('Event deleted')
    load(); loadProducts()
  }

  // ── derived ──────────────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    all: events.length,
    idea: events.filter(e => e.status === 'idea').length,
    planned: events.filter(e => e.status === 'planned').length,
    done: events.filter(e => e.status === 'done').length,
  }), [events])

  const totalSpent = useMemo(() => events.reduce((s, e) => s + num(e.cash_amount) + num(e.product_cost), 0), [events])
  const upcoming = useMemo(() => {
    const today = localToday()
    return events
      .filter(e => e.status !== 'done' && e.event_date && e.event_date >= today)
      .sort((a, b) => a.event_date.localeCompare(b.event_date))[0]
  }, [events])

  const visible = filter === 'all' ? events : events.filter(e => e.status === filter)

  const productOptions = products.map(p => ({ value: p.id, label: p.name, hint: `${p.stock_qty ?? 0} in stock` }))

  // engagement helpers for a card
  const engagementOf = e => int(e.likes) + int(e.comments) + int(e.shares) + int(e.saves)
  const engRateOf = e => {
    const den = int(e.reach) || int(e.impressions)
    return den ? (engagementOf(e) / den * 100) : null
  }

  return (
    <div>
      <style>{`
        .ev-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:16px; }
        @media (max-width:600px){ .ev-grid { grid-template-columns:1fr; } }
        .ev-chip { padding:7px 14px; border-radius:99px; border:1px solid #e6e2da; background:#fff; font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit; color:#667; transition:all .15s; display:inline-flex; align-items:center; gap:6px; }
        .ev-chip.on { background:#0d1b2a; color:#fff; border-color:#0d1b2a; }
        .ev-metric { display:flex; align-items:center; gap:6px; font-size:12.5px; color:#556; }
        .ev-metric b { color:#0d1b2a; font-weight:700; }
        .gm-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; }
        @media (max-width:520px){ .gm-grid { grid-template-columns:repeat(2,1fr); } }
      `}</style>

      <PageHeader title="Events" subtitle="Giveaways & campaigns — capture ideas, plan them, and track results & cost"
        action={<Button onClick={openAdd} disabled={needsSetup}><Plus size={15} /> New event</Button>} />

      {needsSetup ? (
        <Card>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ background: '#fff8e1', borderRadius: 12, padding: 12, flexShrink: 0 }}><PartyPopper size={22} color="#FFA500" /></div>
            <div>
              <h3 style={{ margin: '2px 0 6px', fontSize: 15, fontWeight: 700, color: '#0d1b2a' }}>One-time setup needed</h3>
              <p style={{ margin: '0 0 10px', fontSize: 13, color: '#667', lineHeight: 1.6 }}>
                The Events feature needs two new database tables. Open your Supabase project → SQL Editor and run the
                <b> events</b> and <b>event_giveaways</b> section from <code>supabase_schema.sql</code>, then refresh this page.
              </p>
              <Button variant="ghost" size="sm" onClick={() => { setNeedsSetup(false); load() }}>I've run it — refresh</Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 22 }}>
            <MetricCard label="Ideas" value={counts.idea} icon={Lightbulb} color="#6a1b9a" sub="Waiting to plan" />
            <MetricCard label="Planned" value={counts.planned} icon={CalendarClock} color="#b8740a"
              sub={upcoming ? `Next: ${fmtDate(upcoming.event_date)}` : 'None scheduled'} />
            <MetricCard label="Done" value={counts.done} icon={CheckCircle2} color="#1D9E75" sub="Executed events" />
            <MetricCard label="Total spent" value={money(totalSpent)} icon={Wallet} color="#E24B4A" sub="Cash + giveaways" />
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            {[{ value: 'all', label: 'All' }, ...STATUSES].map(s => (
              <button key={s.value} className={`ev-chip ${filter === s.value ? 'on' : ''}`} onClick={() => setFilter(s.value)}>
                {s.icon && <s.icon size={13} />} {s.label}
                <span style={{ opacity: 0.6 }}>{counts[s.value] ?? 0}</span>
              </button>
            ))}
          </div>

          {loading ? <Spinner /> : visible.length === 0 ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb' }}>
                <PartyPopper size={34} color="#e0d8c8" style={{ marginBottom: 12 }} />
                <div style={{ fontWeight: 600, fontSize: 14, color: '#999' }}>
                  {filter === 'all' ? 'No events yet — jot down your first idea.' : `No ${statusOf(filter).label.toLowerCase()} events.`}
                </div>
              </div>
            </Card>
          ) : (
            <div className="ev-grid">
              {visible.map(ev => {
                const st = statusOf(ev.status)
                const total = num(ev.cash_amount) + num(ev.product_cost)
                const prep = daysBetween(ev.prep_date, ev.event_date)
                const eng = engagementOf(ev)
                const rate = engRateOf(ev)
                const hasResults = METRICS.some(m => int(ev[m.key]) > 0)
                return (
                  <Card key={ev.id} style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {/* header strip */}
                    <div style={{ background: st.tint, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: st.ink }}>
                        <st.icon size={14} /> {st.label}
                      </span>
                      {ev.platform && <span style={{ fontSize: 11.5, fontWeight: 600, color: st.ink, opacity: 0.85 }}>{ev.platform}</span>}
                    </div>

                    <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 15.5, fontWeight: 700, color: '#0d1b2a', lineHeight: 1.3 }}>{ev.name}</div>
                        {ev.description && <div style={{ fontSize: 12.5, color: '#889', marginTop: 3, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{ev.description}</div>}
                      </div>

                      {/* dates */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: '#667' }}>
                        {ev.event_date && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Calendar size={12} color="#FFA500" /> {fmtDate(ev.event_date)}</span>}
                        {ev.prep_date && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CalendarClock size={12} color="#bbb" /> Prep {fmtDate(ev.prep_date)}{prep != null && prep > 0 ? ` · ${prep}d before` : ''}</span>}
                      </div>

                      {/* results */}
                      {hasResults && (
                        <div style={{ borderTop: '1px solid #f2f2f2', paddingTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 12px' }}>
                          {METRICS.filter(m => int(ev[m.key]) > 0).map(m => (
                            <span key={m.key} className="ev-metric"><m.icon size={13} color="#FFA500" /> <b>{compact(ev[m.key])}</b> {m.label.toLowerCase()}</span>
                          ))}
                          {eng > 0 && (
                            <span className="ev-metric" style={{ gridColumn: '1 / -1', color: '#1D9E75' }}>
                              <TrendingUp size={13} color="#1D9E75" /> <b style={{ color: '#1D9E75' }}>{compact(eng)}</b> engagements{rate != null ? ` · ${rate.toFixed(1)}%` : ''}
                            </span>
                          )}
                        </div>
                      )}

                      {/* cost */}
                      {total > 0 && (
                        <div style={{ borderTop: '1px solid #f2f2f2', paddingTop: 10, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, color: '#667' }}>
                          {num(ev.cash_amount) > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Wallet size={12} color="#E24B4A" /> {money(ev.cash_amount)} cash</span>}
                          {num(ev.product_cost) > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Gift size={12} color="#6a1b9a" /> {money(ev.product_cost)} in products</span>}
                          <span style={{ marginLeft: 'auto', fontWeight: 700, color: '#E24B4A' }}>{money(total)}</span>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 4 }}>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(ev)} style={{ flex: 1, justifyContent: 'center' }}><Edit2 size={13} /> Edit</Button>
                        <Button variant="danger" size="sm" onClick={() => del(ev)}><Trash2 size={13} /></Button>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Create / edit modal ──────────────────────────────────────────────── */}
      {modal && (
        <Modal title={editItem ? 'Edit event' : 'New event'} subtitle="Capture the idea, plan it, then record how it went & what it cost" onClose={() => setModal(false)} width={680}>
          <FormRow>
            <Input label="Event name *" value={form.name} onChange={f('name')} placeholder="e.g. Ramadan Instagram giveaway" style={{ gridColumn: 'span 2' }} />
          </FormRow>

          {/* Status */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Stage</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {STATUSES.map(s => (
                <button key={s.value} onClick={() => setForm(p => ({ ...p, status: s.value }))}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                    border: `1px solid ${form.status === s.value ? s.ink : '#e0e0e0'}`, background: form.status === s.value ? s.tint : '#fff', color: form.status === s.value ? s.ink : '#667' }}>
                  <s.icon size={14} /> {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Platform */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Platform / place</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PLATFORMS.map(p => (
                <button key={p} onClick={() => setForm(prev => ({ ...prev, platform: prev.platform === p ? '' : p }))}
                  style={{ padding: '5px 12px', borderRadius: 99, border: '1px solid #ddd', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', background: form.platform === p ? '#FFA500' : '#fff', color: form.platform === p ? '#fff' : '#555', fontWeight: form.platform === p ? 600 : 500 }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          <FormRow>
            <Input label="Event date" type="date" value={form.event_date} onChange={f('event_date')} />
            <Input label="Start prep on" type="date" value={form.prep_date} onChange={f('prep_date')} />
          </FormRow>
          {form.prep_date && form.event_date && (
            <div style={{ fontSize: 12, color: daysBetween(form.prep_date, form.event_date) >= 0 ? '#1D9E75' : '#E24B4A', margin: '-4px 0 14px' }}>
              {(() => { const d = daysBetween(form.prep_date, form.event_date); return d >= 0 ? `⏳ Start preparing ${d} day${d === 1 ? '' : 's'} before the event` : '⚠️ Prep date is after the event date' })()}
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>
              {form.status === 'idea' ? 'The idea / notes' : 'Description / notes'}
            </label>
            <textarea value={form.description} onChange={f('description')} rows={2}
              placeholder={form.status === 'idea' ? 'What is the idea? What would make it work?' : 'What are you doing for this event?'}
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', color: '#0d1b2a', outline: 'none', resize: 'vertical' }} />
          </div>

          {/* Results — most relevant once done, but always available */}
          <div style={{ background: '#faf9f6', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
              <Sparkles size={15} color="#FFA500" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>Results</span>
              <span style={{ fontSize: 11.5, color: '#aaa' }}>— fill in after the event ran</span>
            </div>
            <div className="gm-grid">
              {METRICS.map(m => (
                <Input key={m.key} label={m.label} type="number" min="0" value={form[m.key]} onChange={f(m.key)} placeholder="0" />
              ))}
            </div>
            {(int(form.likes) + int(form.comments) + int(form.shares) + int(form.saves)) > 0 && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: '#1D9E75', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={14} /> {compact(int(form.likes) + int(form.comments) + int(form.shares) + int(form.saves))} total engagements
                {(() => { const den = int(form.reach) || int(form.impressions); return den ? ` · ${((int(form.likes) + int(form.comments) + int(form.shares) + int(form.saves)) / den * 100).toFixed(1)}% engagement rate` : '' })()}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <textarea value={form.results_notes} onChange={f('results_notes')} rows={2} placeholder="What worked, what to do differently next time…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e6e2da', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', color: '#0d1b2a', outline: 'none', resize: 'vertical', background: '#fff' }} />
            </div>
          </div>

          {/* Cost: cash + product giveaways */}
          <div style={{ border: '1px solid #f0ece6', borderRadius: 12, padding: '14px 16px', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
              <Wallet size={15} color="#E24B4A" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>Cost of this event</span>
            </div>

            <FormRow>
              <Input label="Cash spent (MVR)" type="number" step="0.01" min="0" value={form.cash_amount} onChange={f('cash_amount')} placeholder="0.00" />
              <Select label="Cash goes under" value={form.cash_category} onChange={f('cash_category')} options={CASH_CATEGORIES.map(c => ({ value: c, label: c }))} />
            </FormRow>

            <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', margin: '6px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Gift size={13} color="#6a1b9a" /> Products given away
            </div>
            {gaRows.length === 0 && <div style={{ fontSize: 12.5, color: '#aaa', marginBottom: 8 }}>No products added. Anything you add here is deducted from inventory and logged to Cost Management.</div>}
            {gaRows.map((r, idx) => {
              const prod = products.find(p => p.id === r.product_id)
              const qty = int(r.qty)
              const orig = r.id ? gaOriginal.find(o => o.id === r.id) : null
              const alreadyOut = orig ? int(orig.qty) : 0 // this row's stock already deducted previously
              const short = prod && (qty - alreadyOut) > (Number(prod.stock_qty) || 0)
              return (
                <div key={idx} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <SearchSelect label={idx === 0 ? 'Product' : undefined} value={r.product_id} onChange={v => pickGaProduct(idx, v)}
                      options={productOptions} placeholder="Select a product…" style={{ flex: 1, minWidth: 0 }} />
                    <Input label={idx === 0 ? 'Qty' : undefined} type="number" min="1" value={r.qty} onChange={e => setGaRow(idx, { qty: e.target.value })} style={{ width: 66, flexShrink: 0 }} />
                    <Input label={idx === 0 ? 'Unit cost' : undefined} type="number" step="0.01" min="0" value={r.unit_cost} onChange={e => setGaRow(idx, { unit_cost: e.target.value })} style={{ width: 96, flexShrink: 0 }} />
                    <Button variant="ghost" onClick={() => removeGaRow(idx)} style={{ flexShrink: 0, padding: '10px 10px' }}><Trash2 size={14} color="#E24B4A" /></Button>
                  </div>
                  {short && <div style={{ fontSize: 11, color: '#E24B4A', marginTop: 4 }}>⚠️ Only {prod.stock_qty ?? 0} in stock — this will take it below zero</div>}
                </div>
              )
            })}
            <Button variant="ghost" size="sm" onClick={addGaRow}><Plus size={13} /> Add product</Button>

            {grandTotal > 0 && (
              <div style={{ background: '#faf9f6', borderRadius: 10, padding: '12px 14px', marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, color: '#667' }}>
                  {gaValid.length > 0 ? `${gaValid.reduce((s, r) => s + int(r.qty), 0)} item(s) deducted from stock · ` : ''}logged to Cost Management
                </span>
                <span style={{ fontSize: 17, fontWeight: 800, color: '#E24B4A' }}>{money(grandTotal)}</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={saveEvent} disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : editItem ? 'Save changes' : 'Save event'}</Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
