import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge, StatusBadge } from '../components/UI'
import { Plus, Trash2, Edit2, Eye, Printer, MessageSquare, Crown, Sparkles } from 'lucide-react'
import { loyaltyProfile, TIERS, AT_RISK_DAYS } from '../lib/loyalty'
import { sendSMS } from '../lib/sms'
import { getSettings } from '../lib/settings'

const EMPTY = { name: '', email: '', instagram: '', phone: '', address: '', landmark: '', notes: '' }

function TierBadge({ tier, size = 'md' }) {
  const pad = size === 'sm' ? '2px 8px' : '3px 10px'
  const fs = size === 'sm' ? 10.5 : 11.5
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: pad, borderRadius: 99, fontSize: fs, fontWeight: 700, background: tier.color + '18', color: tier.color, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: fs + 1 }}>{tier.emoji}</span> {tier.label}
    </span>
  )
}

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [viewModal, setViewModal] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState('all') // all | vip | loyal | returning | new | atrisk
  const [rewardModal, setRewardModal] = useState(null) // { customer, profile }
  const [rewardMsg, setRewardMsg] = useState('')
  const [sendingReward, setSendingReward] = useState(false)
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
    const payload = { ...form }
    const run = () => modal === 'add'
      ? supabase.from('customers').insert(payload)
      : supabase.from('customers').update(payload).eq('id', form.id)
    let { error } = await run()
    // Drop any columns the database doesn't have yet (e.g. instagram, landmark) and retry
    while (error && /column .* does not exist|could not find/i.test(error.message || '')) {
      const m = (error.message || '').match(/'([a-z_]+)' column/i) || (error.message || '').match(/column "?([a-z_]+)"?/i)
      const col = m && m[1]
      if (!col || !(col in payload)) break
      delete payload[col]
      const retry = await run(); error = retry.error
    }
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
    const logoUrl = window.location.origin + '/logo.png'
    w.document.write(`
      <html><head><title>Receipt — ${o.invoice_number || 'Order'}</title>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Poppins', Arial, sans-serif; color: #0d1b2a; padding: 36px; max-width: 560px; margin: 0 auto; }
        .doc-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 3px solid #FFA500; margin-bottom: 24px; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand img { width: 54px; height: 54px; object-fit: contain; }
        .brand-name { font-size: 18px; font-weight: 800; color: #0d1b2a; letter-spacing: -0.3px; line-height: 1.2; }
        .brand-tag { font-size: 10px; color: #aaa; text-transform: uppercase; letter-spacing: 1.2px; margin-top: 2px; }
        .doc-type { text-align: right; }
        .doc-type-label { font-size: 11px; font-weight: 700; color: #FFA500; text-transform: uppercase; letter-spacing: 1.5px; }
        .doc-inv { font-size: 20px; font-weight: 900; color: #0d1b2a; letter-spacing: -0.5px; margin-top: 4px; }
        .doc-date { font-size: 12px; color: #aaa; margin-top: 3px; }
        .info-row { display: flex; gap: 32px; margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid #f0f0f0; }
        .info-block .lbl { font-size: 10px; color: #bbb; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 600; }
        .info-block .val { font-size: 14px; font-weight: 700; color: #0d1b2a; }
        .info-block .sub { font-size: 11px; color: #aaa; margin-top: 2px; }
        .items-head { display: flex; justify-content: space-between; font-size: 10px; color: #bbb; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; padding: 0 0 8px; border-bottom: 1px solid #eee; margin-bottom: 4px; }
        .item-row { display: flex; justify-content: space-between; align-items: center; padding: 11px 0; border-bottom: 1px solid #f5f5f5; }
        .item-name { font-size: 14px; font-weight: 600; color: #0d1b2a; }
        .item-qty { font-size: 12px; color: #aaa; margin-top: 2px; }
        .item-total { font-size: 14px; font-weight: 700; color: #0d1b2a; }
        .total-block { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding: 16px 20px; background: #0d1b2a; border-radius: 10px; }
        .total-label { font-size: 11px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 1px; }
        .total-amount { font-size: 24px; font-weight: 900; color: #FFA500; letter-spacing: -0.8px; }
        .pay-section { margin-top: 18px; display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; padding-top: 14px; border-top: 1px solid #f0f0f0; }
        .badge { display: inline-flex; padding: 4px 14px; border-radius: 99px; font-size: 11px; font-weight: 700; background: ${payColor}15; color: ${payColor}; border: 1px solid ${payColor}40; }
        .pay-detail .lbl { font-size: 10px; color: #bbb; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
        .pay-detail .val { font-size: 13px; font-weight: 600; color: #333; }
        .notes { margin-top: 14px; background: #fffbf0; border-left: 3px solid #FFA500; padding: 10px 14px; border-radius: 0 8px 8px 0; }
        .notes .lbl { font-size: 10px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .notes .val { font-size: 12px; color: #555; line-height: 1.6; }
        .doc-footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; }
        .footer-msg { font-size: 11px; color: #ccc; font-style: italic; }
        .footer-brand { font-size: 11px; font-weight: 700; color: #0d1b2a; }
        @media print { body { padding: 20px; } }
      </style></head>
      <body>
        <div class="doc-header">
          <div class="brand">
            <img src="${logoUrl}" alt="Brick's & Joy" onerror="this.style.display='none'" />
            <div>
              <div class="brand-name">Brick's &amp; Joy</div>
              <div class="brand-tag">Official Receipt</div>
            </div>
          </div>
          <div class="doc-type">
            <div class="doc-type-label">Receipt</div>
            <div class="doc-inv">${o.invoice_number || '—'}</div>
            <div class="doc-date">${o.order_date || '—'}</div>
          </div>
        </div>
        <div class="info-row">
          <div class="info-block">
            <div class="lbl">Customer</div>
            <div class="val">${customer.name}</div>
            ${customer.phone ? `<div class="sub">${customer.phone}</div>` : ''}
          </div>
          ${o.channel ? `<div class="info-block"><div class="lbl">Channel</div><div class="val">${o.channel}</div></div>` : ''}
        </div>
        <div class="items-head"><span>Item</span><span>Amount</span></div>
        <div class="item-row">
          <div>
            <div class="item-name">${o.product_name}</div>
            <div class="item-qty">${o.qty} unit${o.qty !== 1 ? 's' : ''} × MVR ${Number(o.unit_price || 0).toFixed(2)}</div>
          </div>
          <div class="item-total">MVR ${Number(o.total_price || 0).toFixed(2)}</div>
        </div>
        ${o.discount > 0 ? `<div class="item-row" style="color:#1D9E75"><span style="font-size:12px">Discount</span><span style="font-weight:700">-MVR ${Number(o.discount).toFixed(2)}</span></div>` : ''}
        <div class="total-block">
          <div class="total-label">Total Amount</div>
          <div class="total-amount">MVR ${Number(o.total_price || 0).toFixed(2)}</div>
        </div>
        <div class="pay-section">
          <span class="badge">${payStatus.toUpperCase()}</span>
          ${o.payment_method ? `<div class="pay-detail"><div class="lbl">Method</div><div class="val">${o.payment_method}</div></div>` : ''}
          ${o.transfer_reference ? `<div class="pay-detail"><div class="lbl">Reference</div><div class="val" style="font-family:monospace">${o.transfer_reference}</div></div>` : ''}
        </div>
        ${o.notes ? `<div class="notes"><div class="lbl">Notes</div><div class="val">${o.notes}</div></div>` : ''}
        <div class="doc-footer">
          <div class="footer-msg">This is a computer generated receipt.</div>
          <div class="footer-brand">Brick's &amp; Joy</div>
        </div>
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
      loyalty: loyaltyProfile(custOrders),
    }
  }

  function openReward(customer, profile) {
    const t = profile.tier
    const footer = getSettings().smsFooter || "— Brick's & Joy"
    const first = (customer.name || 'there').split(' ')[0]
    let msg
    if (profile.atRisk) msg = `Hi ${first}! We miss you at Brick's & Joy 🧱 It's been a while — here's 10% off your next order to welcome you back. ${footer}`
    else if (t.key === 'vip') msg = `Hi ${first}! As one of our top customers 👑 you get early access to new sets + an exclusive bundle deal. Thank you for your loyalty! ${footer}`
    else if (t.key === 'loyal') msg = `Hi ${first}! Thanks for being a loyal customer ⭐ Here's a special discount on your next order as our thank-you. ${footer}`
    else if (t.key === 'returning') msg = `Hi ${first}! Thanks for coming back 🔁 Order one more and get a little something extra on us. ${footer}`
    else msg = `Hi ${first}! Thanks for your order 🌱 We'd love to see you again — here's a treat for your next purchase. ${footer}`
    setRewardMsg(msg)
    setRewardModal({ customer, profile })
  }

  async function sendReward() {
    if (!rewardModal?.customer?.phone) { toast.error('No phone number on file'); return }
    if (!rewardMsg.trim()) { toast.error('Message is empty'); return }
    setSendingReward(true)
    try {
      await sendSMS(rewardModal.customer.phone, rewardMsg)
      toast.success('Reward SMS sent!')
      setRewardModal(null)
    } catch (e) {
      toast.error('SMS failed: ' + e.message)
    }
    setSendingReward(false)
  }

  const filtered = customers.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || '').includes(search)
    if (!matchesSearch) return false
    if (tierFilter === 'all') return true
    const p = getStats(c.id).loyalty
    if (tierFilter === 'atrisk') return p.atRisk
    return p.tier.key === tierFilter
  })

  // Loyalty roll-up across all customers
  const loyaltySummary = (() => {
    const counts = { vip: 0, loyal: 0, returning: 0, new: 0, prospect: 0, atRisk: 0, repeat: 0 }
    customers.forEach(c => {
      const p = getStats(c.id).loyalty
      counts[p.tier.key] = (counts[p.tier.key] || 0) + 1
      if (p.atRisk) counts.atRisk++
      if (p.isRepeat) counts.repeat++
    })
    return counts
  })()

  const TIER_TABS = [
    { key: 'all', label: 'All', count: customers.length, color: '#0d1b2a' },
    { key: 'vip', label: '👑 VIP', count: loyaltySummary.vip, color: '#7F77DD' },
    { key: 'loyal', label: '⭐ Loyal', count: loyaltySummary.loyal, color: '#1D9E75' },
    { key: 'returning', label: '🔁 Returning', count: loyaltySummary.returning, color: '#378ADD' },
    { key: 'new', label: '🌱 New', count: loyaltySummary.new, color: '#FFA500' },
    { key: 'atrisk', label: '⚠️ At risk', count: loyaltySummary.atRisk, color: '#E24B4A' },
  ]

  const columns = [
    { key: 'name', label: 'Customer', render: r => {
      const p = getStats(r.id).loyalty
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: '#0d1b2a', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              {r.name}
              {p.atRisk && <span style={{ fontSize: 10, fontWeight: 700, color: '#E24B4A', background: '#FDECEA', padding: '1px 7px', borderRadius: 99 }}>⚠️ At risk</span>}
            </div>
            <div style={{ fontSize: 11, color: '#aaa' }}>{r.email || r.phone || '—'}</div>
          </div>
        </div>
      )
    }},
    { key: 'tier', label: 'Loyalty', render: r => { const p = getStats(r.id).loyalty; return <TierBadge tier={p.tier} size="sm" /> }},
    { key: 'orders', label: 'Orders', render: r => { const s = getStats(r.id); return <strong>{s.totalOrders}</strong> }},
    { key: 'spent', label: 'Total spent', render: r => { const s = getStats(r.id); return <span style={{ fontWeight: 600, color: '#1D9E75' }}>MVR {s.totalSpent.toFixed(2)}</span> }},
    { key: 'unpaid', label: 'Unpaid', render: r => { const s = getStats(r.id); return s.unpaidAmount > 0 ? <span style={{ fontWeight: 600, color: '#c62828' }}>MVR {s.unpaidAmount.toFixed(2)}</span> : <span style={{ color: '#aaa' }}>—</span> }},
    { key: 'last_order', label: 'Last order', render: r => { const s = getStats(r.id); return <span style={{ color: '#888', fontSize: 12 }}>{s.lastOrder || '—'}</span> }},
    { key: 'actions', label: '', render: r => {
      const p = getStats(r.id).loyalty
      return (
        <div style={{ display: 'flex', gap: 5 }}>
          {r.phone && p.tier.key !== 'prospect' && (
            <Button variant="ghost" size="sm" onClick={() => openReward(r, p)} title="Send reward / win-back SMS"><Sparkles size={13} color="#FFA500" /></Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => openView(r)}><Eye size={13} /></Button>
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Edit2 size={13} /></Button>
          <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button>
        </div>
      )
    }},
  ]

  const viewStats = viewModal ? getStats(viewModal.id) : null

  return (
    <div>
      <PageHeader title="Customers" subtitle={`${customers.length} customers`}
        action={<Button onClick={openAdd}><Plus size={15} /> Add customer</Button>} />

      {/* Loyalty roll-up */}
      {!loading && customers.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
            <Crown size={15} color="#FFA500" />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0d1b2a' }}>Loyalty overview</span>
            <span style={{ fontSize: 12, color: '#aaa' }}>· {loyaltySummary.repeat} repeat buyers</span>
          </div>
          <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {TIERS.filter(t => t.key !== 'prospect').map(t => (
              <div key={t.key} onClick={() => setTierFilter(tierFilter === t.key ? 'all' : t.key)}
                style={{ background: tierFilter === t.key ? t.color + '14' : '#f8f7f4', border: `1px solid ${tierFilter === t.key ? t.color + '55' : 'transparent'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.15s' }}>
                <div style={{ fontSize: 11, color: '#888', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{t.emoji} {t.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: t.color }}>{loyaltySummary[t.key] || 0}</div>
              </div>
            ))}
          </div>
          {loyaltySummary.atRisk > 0 && (
            <div onClick={() => setTierFilter('atrisk')} style={{ marginTop: 12, background: '#FDECEA', border: '1px solid #f8d7d2', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 13, color: '#c0392b', fontWeight: 600 }}>⚠️ {loyaltySummary.atRisk} repeat {loyaltySummary.atRisk === 1 ? 'buyer hasn’t' : 'buyers haven’t'} ordered in {AT_RISK_DAYS}+ days</span>
              <span style={{ fontSize: 12, color: '#e08b80', marginLeft: 'auto', fontWeight: 600 }}>Win them back →</span>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customers…"
            style={{ padding: '9px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', flex: 1, minWidth: 200, outline: 'none' }} />
          <div className="x-scroll" style={{ display: 'flex', background: '#f5f5f5', borderRadius: 10, padding: 3, gap: 2 }}>
            {TIER_TABS.map(tab => (
              <button key={tab.key} onClick={() => setTierFilter(tab.key)} style={{
                padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: tierFilter === tab.key ? 700 : 500, whiteSpace: 'nowrap',
                background: tierFilter === tab.key ? '#fff' : 'transparent',
                color: tierFilter === tab.key ? tab.color : '#999',
                boxShadow: tierFilter === tab.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s',
              }}>{tab.label} <span style={{ opacity: 0.6 }}>{tab.count}</span></button>
            ))}
          </div>
        </div>
        {loading ? <Spinner /> : <Table columns={columns} data={filtered} emptyMessage="No customers match this filter." />}
      </Card>

      {/* Customer detail view */}
      {viewModal && viewStats && (
        <Modal title={viewModal.name} onClose={() => setViewModal(null)} width={860}>
          {/* Loyalty banner */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: viewStats.loyalty.tier.color + '0f', border: `1px solid ${viewStats.loyalty.tier.color}33`, borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <TierBadge tier={viewStats.loyalty.tier} />
              <div style={{ fontSize: 12.5, color: '#555' }}>
                {viewStats.loyalty.tier.perk}
                {viewStats.loyalty.atRisk && <span style={{ color: '#c0392b', fontWeight: 600 }}> · ⚠️ Quiet for {viewStats.loyalty.daysSinceLast} days</span>}
              </div>
            </div>
            {viewModal.phone && viewStats.loyalty.tier.key !== 'prospect' && (
              <Button size="sm" onClick={() => openReward(viewModal, viewStats.loyalty)}><Sparkles size={13} /> {viewStats.loyalty.atRisk ? 'Win back' : 'Send reward'}</Button>
            )}
          </div>
          <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
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
            {viewModal.instagram && <div style={{ fontSize: 13 }}>📷 {viewModal.instagram}</div>}
            {viewModal.phone && <div style={{ fontSize: 13 }}>📞 {viewModal.phone}</div>}
            {viewModal.address && <div style={{ fontSize: 13 }}>📍 {viewModal.address}{viewModal.landmark ? ` · ${viewModal.landmark}` : ''}</div>}
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
                    {['Invoice', 'Product', 'Qty', 'Total', 'Date', 'Status', 'Payment', 'Delivery', 'Slip', ''].map(h => (
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
                        {o.delivery_person
                          ? <span style={{ fontSize: 12, background: '#EEF4FF', color: '#378ADD', padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>🚴 {o.delivery_person}</span>
                          : <span style={{ color: '#ddd' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        {o.transfer_slip_url
                          ? <a href={o.transfer_slip_url} target="_blank" rel="noopener noreferrer"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#E1F5EE', color: '#1D9E75', borderRadius: 6, fontSize: 11, fontWeight: 600, textDecoration: 'none' }}>
                              🧾 View slip
                            </a>
                          : <span style={{ color: '#ddd', fontSize: 11 }}>—</span>
                        }
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
            <Input label="Email" value={form.email} onChange={f('email')} placeholder="email@example.com" />
            <Input label="Phone" value={form.phone} onChange={f('phone')} placeholder="7-digit (960 added automatically)" />
          </FormRow>
          <FormRow>
            <Input label="Instagram username" value={form.instagram} onChange={f('instagram')} placeholder="@username" />
          </FormRow>
          <Input label="Address" value={form.address} onChange={f('address')} placeholder="Street, City" style={{ marginBottom: 12 }} />
          <Input label="Landmark" value={form.landmark} onChange={f('landmark')} placeholder="e.g. near Sifco (optional)" style={{ marginBottom: 12 }} />
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
      {/* Reward / win-back SMS modal */}
      {rewardModal && (
        <Modal title={`${rewardModal.profile.atRisk ? 'Win-back' : 'Reward'} — ${rewardModal.customer.name}`} onClose={() => setRewardModal(null)} width={480}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f8f7f4', borderRadius: 10, padding: '12px 14px', marginBottom: 16, flexWrap: 'wrap' }}>
            <TierBadge tier={rewardModal.profile.tier} />
            <span style={{ fontSize: 12.5, color: '#666' }}>
              {rewardModal.profile.deliveredCount} delivered · MVR {rewardModal.profile.totalSpent.toFixed(0)} spent
              {rewardModal.profile.lastOrder && ` · last ${rewardModal.profile.lastOrder}`}
            </span>
          </div>
          <Input label="Send to" value={rewardModal.customer.phone || ''} disabled style={{ marginBottom: 12 }} />
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Message (editable)</label>
            <textarea value={rewardMsg} onChange={e => setRewardMsg(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 100, boxSizing: 'border-box', outline: 'none' }} />
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{rewardMsg.length} characters · ~{Math.max(1, Math.ceil(rewardMsg.length / 160))} SMS</div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setRewardModal(null)}>Cancel</Button>
            <Button onClick={sendReward} disabled={sendingReward}><MessageSquare size={13} /> {sendingReward ? 'Sending…' : 'Send SMS'}</Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
