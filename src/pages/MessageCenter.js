import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Modal, Spinner, useToast, Toasts, Badge } from '../components/UI'
import { sendEmailJS, BNJ_EMAIL } from '../lib/email'
import { sendSMS } from '../lib/sms'
import {
  Mail, MessageSquare, Send, Plus, Trash2, Edit2, Phone, AtSign, User, Bike,
  Truck, Users, Megaphone, Search, AlertTriangle, Lightbulb, Calendar,
  CheckCircle, XCircle, ClipboardList, MessageCircle, Instagram, Facebook
} from 'lucide-react'

const BNJ_NAME = "Brick's & Joy"

const BROADCAST_TEMPLATES = [
  { label: 'Upcoming sale', emoji: '🏷️', text: `Hi {name}! 🎉 ${BNJ_NAME} is having a SALE this weekend — up to 30% off your favourite sets. Come grab yours before they're gone!` },
  { label: 'New arrivals', emoji: '✨', text: `Hi {name}! ✨ Fresh stock just landed at ${BNJ_NAME}. New sets are in — be the first to build! Visit us or DM to reserve yours.` },
  { label: 'Restock alert', emoji: '🔁', text: `Hi {name}! The set you've been waiting for is back in stock at ${BNJ_NAME} 🧱 Limited quantity — grab it before it's gone!` },
  { label: 'Announcement', emoji: '📢', text: `Hi {name}! 📢 A quick update from ${BNJ_NAME}: ` },
]

// First name for {name} personalization
function firstName(name) { return (name || '').trim().split(/\s+/)[0] || 'there' }
function personalize(text, name) { return text.replace(/\{name\}/gi, firstName(name)) }

// ── Channel toggle (Email | SMS) ────────────────────────────────────────────
function ChannelToggle({ value, onChange }) {
  const opt = (id, label, Icon) => (
    <button onClick={() => onChange(id)} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none',
      cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
      borderRadius: 8, transition: 'all 0.15s',
      background: value === id ? '#fff' : 'transparent',
      color: value === id ? (id === 'email' ? '#378ADD' : '#1D9E75') : '#888',
      boxShadow: value === id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
    }}>
      <Icon size={14} /> {label}
    </button>
  )
  return (
    <div style={{ display: 'inline-flex', gap: 3, background: '#f0eee9', borderRadius: 10, padding: 3 }}>
      {opt('email', 'Email', Mail)}
      {opt('sms', 'SMS', MessageSquare)}
    </div>
  )
}

export default function MessageCenter() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('broadcast')
  const [sending, setSending] = useState(false)
  const toast = useToast()

  // Broadcast
  const [bcChannel, setBcChannel] = useState('sms')
  const [bcSel, setBcSel] = useState(() => new Set())
  const [bcSubject, setBcSubject] = useState('')
  const [bcBody, setBcBody] = useState('')
  const [bcSearch, setBcSearch] = useState('')

  // Compose modal (delivery note / stock / task / contact message)
  const [compose, setCompose] = useState(null) // { title, channel, subject, body, sel:Set, source, lockChannel }

  // Contacts
  const [contactModal, setContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name: '', email: '', role: '', phone: '' })
  const [editContact, setEditContact] = useState(null)

  // Live chat (JivoChat) in-app inbox
  const [threads, setThreads] = useState([])
  const [activeThread, setActiveThread] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatReady, setChatReady] = useState(true)   // false if tables not created yet
  const [replyText, setReplyText] = useState('')
  const [replySending, setReplySending] = useState(false)
  const [showSetup, setShowSetup] = useState(false)

  async function loadThreads() {
    setChatLoading(true)
    const { data, error } = await supabase.from('chat_threads').select('*').order('last_at', { ascending: false })
    if (error) { setChatReady(false); setChatLoading(false); return }
    setChatReady(true)
    setThreads(data || [])
    setChatLoading(false)
  }

  async function openThread(t) {
    setActiveThread(t)
    setReplyText('')
    const { data } = await supabase.from('chat_messages').select('*').eq('thread_id', t.id).order('created_at', { ascending: true })
    setChatMessages(data || [])
    if (t.unread > 0) {
      await supabase.from('chat_threads').update({ unread: 0 }).eq('id', t.id)
      setThreads(prev => prev.map(x => x.id === t.id ? { ...x, unread: 0 } : x))
    }
  }

  async function sendReply() {
    const text = replyText.trim()
    if (!text || !activeThread) return
    setReplySending(true)
    // Optimistically show our message
    const optimistic = { id: 'tmp-' + Date.now(), thread_id: activeThread.id, direction: 'out', sender_name: 'You', body: text, created_at: new Date().toISOString() }
    setChatMessages(prev => [...prev, optimistic])
    setReplyText('')
    const { data, error } = await supabase.functions.invoke('jivo-send', { body: { thread_id: activeThread.id, text } })
    setReplySending(false)
    if (error || (data && data.ok === false)) {
      toast.error('Could not send: ' + (data?.jivo_response || error?.message || 'check JivoChat setup'))
      setChatMessages(prev => prev.filter(m => m.id !== optimistic.id))
      setReplyText(text)
    }
  }

  const tasks = (() => { try { return JSON.parse(localStorage.getItem('bj_tasks') || '[]') } catch { return [] } })()

  useEffect(() => { load() }, [])

  // Load threads + live-subscribe whenever the Live Chat tab is open.
  useEffect(() => {
    if (activeTab !== 'livechat') return
    loadThreads()
    const ch = supabase
      .channel('chat-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_threads' }, () => loadThreads())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
        const m = payload.new
        setActiveThread(at => {
          if (at && m.thread_id === at.id) setChatMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m])
          return at
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [activeTab])

  async function load() {
    setLoading(true)
    const [o, p, c, ct] = await Promise.all([
      supabase.from('orders').select('*').in('status', ['created', 'pending', 'transit']).order('created_at', { ascending: false }),
      supabase.from('products').select('*'),
      supabase.from('customers').select('*').order('name'),
      supabase.from('email_contacts').select('*').order('name'),
    ])
    setOrders(o.data || [])
    setProducts(p.data || [])
    setCustomers(c.data || [])
    setContacts(ct.data || [])
    setLoading(false)
  }

  const lowStock = products.filter(p => p.stock_qty <= (p.low_stock_threshold ?? 10) && p.stock_qty > 0)
  const outOfStock = products.filter(p => p.stock_qty <= 0)

  // Eligible recipients for a channel (email needs email, sms needs phone)
  const hasChannel = (r, ch) => ch === 'email' ? !!(r.email && r.email.includes('@')) : !!(r.phone && r.phone.trim())

  // Send one message on a channel to a recipient record
  async function deliverOne(channel, r, subject, body) {
    if (channel === 'email') return sendEmailJS(r.email, subject || 'Message from ' + BNJ_NAME, body)
    return sendSMS(r.phone, body)
  }

  // ── Broadcast ────────────────────────────────────────────────────────────
  const bcEligible = customers.filter(c => hasChannel(c, bcChannel))
  const bcFiltered = bcEligible.filter(c =>
    c.name.toLowerCase().includes(bcSearch.toLowerCase()) ||
    (c.phone || '').includes(bcSearch) || (c.email || '').toLowerCase().includes(bcSearch.toLowerCase()))
  function toggleBc(id) { setBcSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  async function sendBroadcast() {
    if (!bcBody.trim()) { toast.error('Message is empty'); return }
    if (bcChannel === 'email' && !bcSubject.trim()) { toast.error('Add a subject for the email'); return }
    const targets = bcEligible.filter(c => bcSel.has(c.id))
    if (targets.length === 0) { toast.error('Select at least one customer'); return }
    if (!window.confirm(`Send this ${bcChannel.toUpperCase()} to ${targets.length} customer${targets.length !== 1 ? 's' : ''}?`)) return
    setSending(true)
    let ok = 0, fail = 0
    for (const c of targets) {
      try { await deliverOne(bcChannel, c, personalize(bcSubject, c.name), personalize(bcBody, c.name)); ok++ } catch { fail++ }
    }
    toast[fail ? 'info' : 'success'](`Sent ${ok}/${targets.length}${fail ? ` · ${fail} failed` : ''}`)
    setSending(false)
  }

  // ── Compose (shared) ───────────────────────────────────────────────────────
  function openCompose(cfg) {
    setCompose({ channel: 'email', subject: '', body: '', sel: new Set(), source: 'contacts', ...cfg })
  }
  const composeRecipients = () => {
    if (!compose) return []
    const list = compose.source === 'customers' ? customers : contacts
    return list.filter(r => hasChannel(r, compose.channel))
  }
  function toggleComposeSel(id) {
    setCompose(c => { const n = new Set(c.sel); n.has(id) ? n.delete(id) : n.add(id); return { ...c, sel: n } })
  }
  async function sendCompose() {
    if (!compose.body.trim()) { toast.error('Message is empty'); return }
    if (compose.channel === 'email' && !compose.subject.trim()) { toast.error('Add a subject'); return }
    const eligible = composeRecipients()
    const targets = eligible.filter(r => compose.sel.has(r.id))
    // Free-typed recipients (comma/semicolon/newline separated)
    if (compose.freeTo && compose.to) {
      compose.to.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).forEach(v => {
        targets.push(compose.channel === 'email' ? { id: 'to:' + v, name: v, email: v } : { id: 'to:' + v, name: v, phone: v })
      })
    }
    if (targets.length === 0) { toast.error('Pick or type at least one recipient'); return }
    setSending(true)
    let ok = 0, fail = 0
    for (const r of targets) {
      try { await deliverOne(compose.channel, r, compose.subject, compose.body); ok++ } catch { fail++ }
    }
    toast[fail ? 'info' : 'success'](`Sent ${ok}/${targets.length}${fail ? ` · ${fail} failed` : ''}`)
    setSending(false)
    if (!fail) setCompose(null)
  }

  // Builders for pre-filled messages
  // Phone shown in notes without the 960 country code (just the local number).
  function localPhone(raw = '') {
    let d = String(raw).replace(/\D/g, '')
    if (d.startsWith('960') && d.length > 7) d = d.slice(3)
    return d
  }

  // Short SMS delivery note — fixed format
  function deliveryNoteSMS(order) {
    const customer = customers.find(c => c.id === order.customer_id) || {}
    const pay = (order.payment_status || 'unpaid').toUpperCase()
    const phone = localPhone(customer.phone)
    const name = customer.name || order.customer_name || 'Walk-in'
    return [
      `Delivery — ${BNJ_NAME}`,
      `Item: ${order.product_name} × ${order.qty}`,
      `Name: ${name}${phone ? ` - ${phone}` : ''}`,
      customer.address ? `Address: ${customer.address}${customer.landmark ? `, ${customer.landmark}` : ''}` : null,
      `Total: MVR ${Number(order.total_price || 0).toFixed(2)} (${pay})`,
      customer.notes ? `Drop: ${customer.notes}` : null,
    ].filter(Boolean).join('\n')
  }

  // Long, detailed email delivery note
  function deliveryNoteEmail(order) {
    const customer = customers.find(c => c.id === order.customer_id) || {}
    const pay = (order.payment_status || 'unpaid').toUpperCase()
    const phone = localPhone(customer.phone)
    const info = [
      `Name:        ${customer.name || order.customer_name || 'Walk-in'}`,
      phone ? `Phone:       ${phone}` : null,
      customer.address ? `Address:     ${customer.address}` : null,
      customer.landmark ? `Landmark:    ${customer.landmark}` : null,
      customer.instagram ? `Instagram:   ${customer.instagram}` : null,
      customer.email ? `Email:       ${customer.email}` : null,
      customer.notes ? `Drop note:   ${customer.notes}` : null,
    ].filter(Boolean).join('\n')
    return `Hi,

You have a new delivery assignment from ${BNJ_NAME}.

━━━━━━━━━━━━━━━━━━━━
ORDER DETAILS
━━━━━━━━━━━━━━━━━━━━
Invoice:     ${order.invoice_number || '—'}
Product:     ${order.product_name}
Quantity:    ${order.qty}
Order date:  ${order.order_date || '—'}${order.delivery_date ? `\nDelivery:    ${order.delivery_date}` : ''}
Status:      ${order.status}
Total:       MVR ${Number(order.total_price || 0).toFixed(2)} (${pay})

━━━━━━━━━━━━━━━━━━━━
CUSTOMER / DELIVERY INFO
━━━━━━━━━━━━━━━━━━━━
${info}${order.notes ? `\n\nOrder notes:\n${order.notes}` : ''}

Please confirm once delivered.

— ${BNJ_NAME} Team`
  }

  function deliverySubject(order) { return `Delivery Assignment — ${order.invoice_number || order.product_name}` }

  function openDelivery(order) {
    // Pre-select the assigned staff if they're a contact (note still sendable to anyone)
    const dp = contacts.find(c => c.name === order.delivery_person)
    const channel = dp && hasChannel(dp, 'sms') && !hasChannel(dp, 'email') ? 'sms' : 'email'
    openCompose({
      title: `Delivery note — ${order.product_name}`,
      kind: 'delivery',
      order,
      channel,
      subject: deliverySubject(order),
      body: channel === 'email' ? deliveryNoteEmail(order) : deliveryNoteSMS(order),
      sel: new Set(dp ? [dp.id] : []),
      source: 'contacts',
    })
  }
  function openStockAlert() {
    const out = outOfStock.map(p => `  - ${p.name} — OUT OF STOCK`).join('\n')
    const low = lowStock.map(p => `  - ${p.name} — ${p.stock_qty} left (min ${p.low_stock_threshold ?? 10})`).join('\n')
    const body = `Stock Alert — ${BNJ_NAME}\n${new Date().toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\nOUT OF STOCK (${outOfStock.length})\n${out || '  None'}\n\nLOW STOCK (${lowStock.length})\n${low || '  None'}\n\nPlease reorder as needed.`
    openCompose({ title: 'Stock alert', channel: 'email', subject: `Low Stock Alert — ${BNJ_NAME}`, body, source: 'contacts' })
  }
  function openTask(task) {
    const body = `Task — ${task.title}\nDue: ${task.date} · ${task.priority} priority${task.notes ? `\n\n${task.notes}` : ''}\n\n— ${BNJ_NAME}`
    openCompose({ title: `Task — ${task.title}`, channel: 'email', subject: `Task Assigned — ${task.title}`, body, source: 'contacts' })
  }
  function openContactMessage(contact) {
    openCompose({
      title: `Message ${contact.name}`,
      channel: hasChannel(contact, 'email') ? 'email' : 'sms',
      subject: '', body: '', source: 'contacts', sel: new Set([contact.id]),
    })
  }
  // Free compose — send to anyone by typing an email/phone, regarding anything
  function openFreeCompose() {
    openCompose({ title: 'New message', channel: 'email', subject: '', body: '', source: 'contacts', freeTo: true, to: '' })
  }

  // ── Contacts CRUD (shared email_contacts) ───────────────────────────────────
  async function saveContact() {
    if (!contactForm.name.trim()) { toast.error('Name is required'); return }
    const trimmed = { name: contactForm.name.trim(), email: (contactForm.email || '').trim(), role: contactForm.role || '', phone: (contactForm.phone || '').trim() }
    if (!trimmed.email && !trimmed.phone) { toast.error('Add an email or a phone'); return }
    const res = editContact
      ? await supabase.from('email_contacts').update(trimmed).eq('id', editContact.id)
      : await supabase.from('email_contacts').insert(trimmed)
    if (res.error) { toast.error('Failed to save'); return }
    toast.success(editContact ? 'Contact updated!' : 'Contact saved!')
    setContactModal(false); setEditContact(null); setContactForm({ name: '', email: '', role: '', phone: '' })
    const { data } = await supabase.from('email_contacts').select('*').order('name')
    setContacts(data || [])
  }
  async function deleteContact(c) {
    if (!window.confirm('Delete this contact?')) return
    await supabase.from('email_contacts').delete().eq('id', c.id)
    setContacts(prev => prev.filter(x => x.id !== c.id))
    toast.success('Deleted')
  }

  const Counter = ({ text, channel }) => channel === 'sms'
    ? <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{text.length} characters · ~{Math.max(1, Math.ceil(text.length / 160))} SMS each</div>
    : <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{text.length} characters</div>

  return (
    <div>
      <style>{`
        @keyframes mcRise { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        .mc-fade { animation: mcRise 0.3s ease backwards; }
        .mc-card { background:#fff; border:1px solid #eee; border-radius:14px; padding:14px 16px; margin-bottom:10px; transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease; animation: mcRise 0.3s ease backwards; }
        .mc-card:hover { border-color:#ffe1b0; box-shadow:0 6px 20px rgba(255,165,0,0.10); transform:translateY(-2px); }
        .mc-tab { padding:9px 16px; border-radius:99px; border:none; cursor:pointer; font-size:13px; font-weight:600; font-family:inherit; display:flex; align-items:center; gap:7px; transition: all 0.18s; }
        .mc-tab:hover { transform:translateY(-1px); }
        .mc-row { transition: background 0.15s ease; }
        .mc-row:hover { background:#faf9f6 !important; }
        .mc-chip { padding:6px 12px; border-radius:99px; border:1px solid #eee; background:#fff; cursor:pointer; font-size:12px; font-family:inherit; color:#555; font-weight:600; transition: all 0.15s; }
        .mc-chip:hover { border-color:#FFA500; color:#FFA500; transform:translateY(-1px); }
        .mc-ta { width:100%; padding:10px 12px; border:1px solid #ddd; border-radius:8px; font-size:13px; font-family:inherit; resize:vertical; box-sizing:border-box; outline:none; }
        .mc-in { width:100%; padding:9px 12px; border:1px solid #ddd; border-radius:8px; font-size:13px; font-family:inherit; outline:none; box-sizing:border-box; }
        /* Live chat inbox */
        .lc-wrap { display:grid; grid-template-columns: 300px 1fr; height:70vh; min-height:460px; }
        .lc-list { border-right:1px solid #f0f0f0; overflow-y:auto; }
        .lc-thread { width:100%; display:flex; align-items:center; gap:11px; padding:11px 14px; border:none; border-bottom:1px solid #f6f6f6; cursor:pointer; font-family:inherit; transition:background 0.12s; }
        .lc-thread:hover { background:#faf9f6; }
        .lc-convo { flex-direction:column; height:100%; min-width:0; }
        .lc-head { display:flex; align-items:center; gap:8px; padding:13px 16px; border-bottom:1px solid #f0f0f0; }
        .lc-back { display:none; background:none; border:none; font-size:26px; line-height:1; color:#FFA500; cursor:pointer; padding:0 4px 0 0; font-family:inherit; }
        .lc-msgs { flex:1; overflow-y:auto; padding:16px; background:#fcfbf9; }
        .lc-reply { display:flex; gap:8px; align-items:flex-end; padding:12px 14px; border-top:1px solid #f0f0f0; }
        .lc-reply .mc-ta { flex:1; }
        .lc-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:40px; }
        @media (max-width: 760px) {
          .lc-wrap { grid-template-columns: 1fr; height:auto; }
          .lc-list { border-right:none; max-height:none; }
          .lc-convo { height:72vh; min-height:440px; border-top:1px solid #f0f0f0; }
          .lc-back { display:block; }
          .lc-empty { display:none !important; }
        }
      `}</style>

      <PageHeader title="Message Center" subtitle="Email & SMS in one place — broadcasts, delivery notes, alerts and staff"
        action={<Button onClick={openFreeCompose}><Mail size={15} /> Compose</Button>} />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
        {[
          ['broadcast', 'Broadcast', Megaphone],
          ['livechat', 'Live Chat', MessageCircle],
          ['deliveries', 'Deliveries', Truck],
          ['stock', 'Stock', AlertTriangle],
          ['tasks', 'Tasks', ClipboardList],
          ['contacts', 'Contacts', Users],
        ].map(([id, label, Icon]) => {
          const active = activeTab === id
          return (
            <button key={id} className="mc-tab" onClick={() => setActiveTab(id)} style={{
              background: active ? 'linear-gradient(135deg, #FFA500, #ff8c00)' : '#fff',
              color: active ? '#fff' : '#555',
              boxShadow: active ? '0 4px 14px rgba(255,165,0,0.32)' : '0 0 0 1px #eee',
            }}>
              <Icon size={14} /> {label}
            </button>
          )
        })}
      </div>

      {loading ? <Spinner /> : <div key={activeTab} className="mc-fade">

        {/* ── BROADCAST ── */}
        {activeTab === 'broadcast' && (
          <>
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <ChannelToggle value={bcChannel} onChange={setBcChannel} />
              <span style={{ fontSize: 12.5, color: '#999' }}>Send a sale or announcement to your customers.</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }} className="mc-grid">
              <style>{`@media (max-width: 820px) { .mc-grid { grid-template-columns: 1fr !important; } }`}</style>
              {/* Recipients */}
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', margin: 0 }}>Customers ({bcSel.size} selected)</h3>
                  <button onClick={() => setBcSel(bcSel.size === bcFiltered.length ? new Set() : new Set(bcFiltered.map(c => c.id)))}
                    style={{ background: 'none', border: 'none', color: '#FFA500', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {bcSel.size === bcFiltered.length && bcFiltered.length > 0 ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div style={{ position: 'relative', marginBottom: 10 }}>
                  <Search size={14} color="#bbb" style={{ position: 'absolute', left: 11, top: 11 }} />
                  <input value={bcSearch} onChange={e => setBcSearch(e.target.value)} placeholder="Search customers…" className="mc-in" style={{ paddingLeft: 32 }} />
                </div>
                {bcEligible.length === 0 ? (
                  <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                    No customers with {bcChannel === 'email' ? 'an email' : 'a phone'}. Add it in the Customers tab.
                  </p>
                ) : (
                  <div style={{ border: '1px solid #eee', borderRadius: 10, maxHeight: 360, overflowY: 'auto' }}>
                    {bcFiltered.map((c, i) => {
                      const checked = bcSel.has(c.id)
                      return (
                        <label key={c.id} className="mc-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i ? '1px solid #f5f5f5' : 'none', cursor: 'pointer', fontSize: 13, background: checked ? '#fff8ec' : 'transparent' }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleBc(c.id)} />
                          <span style={{ fontWeight: 600, color: '#0d1b2a' }}>{c.name}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{bcChannel === 'email' ? c.email : c.phone}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </Card>

              {/* Message */}
              <Card>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 12 }}>Message</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {BROADCAST_TEMPLATES.map(t => (
                    <button key={t.label} className="mc-chip" onClick={() => setBcBody(t.text)}>{t.emoji} {t.label}</button>
                  ))}
                </div>
                {bcChannel === 'email' && (
                  <input value={bcSubject} onChange={e => setBcSubject(e.target.value)} placeholder="Email subject" className="mc-in" style={{ marginBottom: 10 }} />
                )}
                <textarea value={bcBody} onChange={e => setBcBody(e.target.value)} placeholder="Write your message… Tip: use {name} to insert each customer's name." className="mc-ta" style={{ minHeight: 150 }} />
                <Counter text={bcBody} channel={bcChannel} />
                <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 8, padding: '8px 12px', margin: '12px 0', fontSize: 12, color: '#9a7012', display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                  <Lightbulb size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span><strong>{`{name}`}</strong> is replaced with each customer's first name.</span>
                </div>
                <Button onClick={sendBroadcast} disabled={sending || bcSel.size === 0} style={{ width: '100%', justifyContent: 'center' }}>
                  <Send size={14} /> {sending ? 'Sending…' : `Send ${bcChannel.toUpperCase()} to ${bcSel.size}`}
                </Button>
              </Card>
            </div>
          </>
        )}

        {/* ── LIVE CHAT (JivoChat in-app inbox) ── */}
        {activeTab === 'livechat' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#C13584', fontWeight: 600 }}><Instagram size={15} /> Instagram</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#1877F2', fontWeight: 600 }}><Facebook size={15} /> Facebook</span>
                <span style={{ fontSize: 12.5, color: '#999' }}>— all DMs in one inbox.</span>
              </div>
              <Button variant="ghost" onClick={() => setShowSetup(s => !s)}><Lightbulb size={13} /> {showSetup ? 'Hide setup' : 'Setup guide'}</Button>
            </div>

            {showSetup && (
              <Card style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a', marginBottom: 10 }}>One-time setup</div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#555', lineHeight: 1.9 }}>
                  <li>Create a free account at <a href="https://www.jivochat.com" target="_blank" rel="noopener noreferrer" style={{ color: '#378ADD', fontWeight: 600 }}>jivochat.com</a>.</li>
                  <li>In JivoChat → <strong>Channels</strong>, connect <strong>Instagram</strong> (Business account linked to a Facebook Page) and <strong>Facebook</strong> Page.</li>
                  <li>Add a <strong>Bot</strong> channel. Set its webhook URL to your <code>jivo-inbound</code> function and copy the <strong>provider id</strong> + <strong>token</strong>.</li>
                  <li>In Supabase, run <code>integrations/jivochat-setup.sql</code> and set the secrets <code>JIVO_TOKEN</code> and <code>JIVO_PROVIDER_ID</code>, then deploy the <code>jivo-inbound</code> and <code>jivo-send</code> functions.</li>
                  <li>Done — every Instagram &amp; Facebook DM appears below and you can reply right here.</li>
                </ol>
                <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 10, padding: '10px 14px', marginTop: 12, fontSize: 12.5, color: '#8a6d1b' }}>
                  Instagram DMs require an <strong>Instagram Business/Creator</strong> account linked to a Facebook Page (a Meta requirement).
                </div>
              </Card>
            )}

            {!chatReady ? (
              <Card>
                <div style={{ textAlign: 'center', padding: '40px 24px' }}>
                  <MessageCircle size={32} color="#FFA500" style={{ marginBottom: 12 }} />
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1b2a', marginBottom: 6 }}>Inbox not set up yet</div>
                  <div style={{ fontSize: 13, color: '#888', maxWidth: 420, margin: '0 auto 16px', lineHeight: 1.6 }}>
                    Run <code>integrations/jivochat-setup.sql</code> in Supabase to create the chat tables, then connect JivoChat. See the setup guide above.
                  </div>
                  <Button onClick={() => setShowSetup(true)}><Lightbulb size={14} /> Show setup guide</Button>
                </div>
              </Card>
            ) : (
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                <div className="lc-wrap">
                  {/* Thread list */}
                  <div className="lc-list" style={{ display: activeThread ? undefined : 'block' }}>
                    {chatLoading ? <div style={{ padding: 24 }}><Spinner /></div>
                      : threads.length === 0 ? (
                        <div style={{ padding: '40px 18px', textAlign: 'center', color: '#aaa', fontSize: 13 }}>
                          No conversations yet.<br />Instagram &amp; Facebook DMs will appear here.
                        </div>
                      ) : threads.map(t => {
                        const Icon = t.channel === 'instagram' ? Instagram : t.channel === 'facebook' ? Facebook : MessageCircle
                        const tint = t.channel === 'instagram' ? '#C13584' : t.channel === 'facebook' ? '#1877F2' : '#FFA500'
                        const isActive = activeThread?.id === t.id
                        return (
                          <button key={t.id} onClick={() => openThread(t)} className="lc-thread" style={{ background: isActive ? '#fff8ec' : 'transparent' }}>
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                              <div style={{ width: 40, height: 40, borderRadius: '50%', background: tint + '22', color: tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15 }}>
                                {(t.client_name || '?').charAt(0).toUpperCase()}
                              </div>
                              <Icon size={14} color={tint} style={{ position: 'absolute', bottom: -2, right: -2, background: '#fff', borderRadius: '50%', padding: 1 }} />
                            </div>
                            <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                                <span style={{ fontWeight: 700, fontSize: 13.5, color: '#0d1b2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.client_name || 'Customer'}</span>
                                {t.unread > 0 && <span style={{ background: '#FFA500', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 7px', flexShrink: 0 }}>{t.unread}</span>}
                              </div>
                              <div style={{ fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.last_message || ''}</div>
                            </div>
                          </button>
                        )
                      })}
                  </div>

                  {/* Conversation */}
                  <div className="lc-convo" style={{ display: activeThread ? 'flex' : 'none' }}>
                    {activeThread && (
                      <>
                        <div className="lc-head">
                          <button className="lc-back" onClick={() => setActiveThread(null)}>‹</button>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>{activeThread.client_name || 'Customer'}</div>
                          <span style={{ fontSize: 11, color: '#aaa', textTransform: 'capitalize' }}>· {activeThread.channel}</span>
                        </div>
                        <div className="lc-msgs">
                          {chatMessages.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#bbb', fontSize: 12, paddingTop: 30 }}>No messages.</div>
                          ) : chatMessages.map(m => (
                            <div key={m.id} style={{ display: 'flex', justifyContent: m.direction === 'out' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                              <div style={{ maxWidth: '78%', padding: '8px 12px', borderRadius: 14, fontSize: 13, lineHeight: 1.45,
                                background: m.direction === 'out' ? 'linear-gradient(135deg,#FFA500,#ff8c00)' : '#f1f0ec',
                                color: m.direction === 'out' ? '#fff' : '#0d1b2a',
                                borderBottomRightRadius: m.direction === 'out' ? 4 : 14, borderBottomLeftRadius: m.direction === 'out' ? 14 : 4 }}>
                                {m.body}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="lc-reply">
                          <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                            placeholder="Type a reply… (Enter to send)" className="mc-ta" style={{ minHeight: 44, maxHeight: 120 }} />
                          <Button onClick={sendReply} disabled={replySending || !replyText.trim()}><Send size={14} /> {replySending ? '…' : 'Send'}</Button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Empty state when no thread chosen (desktop) */}
                  {!activeThread && (
                    <div className="lc-empty">
                      <MessageCircle size={34} color="#e0ddd5" style={{ marginBottom: 10 }} />
                      <div style={{ fontSize: 13, color: '#bbb' }}>Select a conversation to read &amp; reply.</div>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ── DELIVERIES ── */}
        {activeTab === 'deliveries' && (
          <div>
            <div style={{ background: '#EEF4FF', border: '1px solid #d0e4ff', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#378ADD', display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              <Lightbulb size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Send the auto-generated delivery note to <strong>any staff</strong> by email or SMS. Assigning staff to an order is done in the <strong>Deliveries</strong> tab and doesn't limit who you can message here.</span>
            </div>
            {orders.length === 0 ? (
              <Card><p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No active orders.</p></Card>
            ) : orders.map(o => {
              const customer = customers.find(c => c.id === o.customer_id) || {}
              return (
                <div key={o.id} className="mc-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a', marginBottom: 4 }}>{o.product_name} × {o.qty}</div>
                      <div style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><User size={13} /> {customer.name || o.customer_name || 'Walk-in'}</span>
                        {o.delivery_person && <><span style={{ color: '#ddd' }}>·</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#378ADD' }}><Bike size={13} /> {o.delivery_person}</span></>}
                      </div>
                      <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{o.invoice_number || '—'}{o.delivery_date ? ` · ${o.delivery_date}` : ''}</div>
                    </div>
                    <Button onClick={() => openDelivery(o)}><Send size={13} /> Send note</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── STOCK ── */}
        {activeTab === 'stock' && (
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 14 }}>Stock alert</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, maxWidth: 460 }}>
              <div style={{ background: '#FCEBEB', borderRadius: 12, padding: '14px 16px', border: '1px solid #f5c6c6' }}>
                <div style={{ fontSize: 11, color: '#c62828', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Out of stock</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#c62828' }}>{outOfStock.length}</div>
              </div>
              <div style={{ background: '#FFF8E1', borderRadius: 12, padding: '14px 16px', border: '1px solid #FAEEDA' }}>
                <div style={{ fontSize: 11, color: '#f57f17', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Low stock</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#f57f17' }}>{lowStock.length}</div>
              </div>
            </div>
            <Button onClick={openStockAlert} disabled={outOfStock.length === 0 && lowStock.length === 0} style={{ maxWidth: 460, width: '100%', justifyContent: 'center' }}>
              <AlertTriangle size={14} /> Compose stock alert
            </Button>
            <div style={{ marginTop: 14 }}>
              {[...outOfStock, ...lowStock].slice(0, 12).map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid #f5f5f5', fontSize: 13, maxWidth: 460 }}>
                  <span style={{ color: '#444' }}>{p.name}</span>
                  {p.stock_qty <= 0
                    ? <span style={{ color: '#c62828', fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={12} /> Out</span>
                    : <span style={{ color: '#f57f17', fontWeight: 600, fontSize: 12 }}>{p.stock_qty} left</span>}
                </div>
              ))}
              {outOfStock.length === 0 && lowStock.length === 0 && (
                <p style={{ color: '#1D9E75', fontSize: 13, textAlign: 'center', padding: '14px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><CheckCircle size={15} /> All products well stocked!</p>
              )}
            </div>
          </Card>
        )}

        {/* ── TASKS ── */}
        {activeTab === 'tasks' && (
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 14 }}>Tasks</h3>
            {tasks.length === 0 ? (
              <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '24px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><ClipboardList size={15} /> No pending tasks.</p>
            ) : tasks.map(t => (
              <div key={t.id} className="mc-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 8px', borderTop: '1px solid #f5f5f5', borderRadius: 8, maxWidth: 640 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0d1b2a' }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: '#aaa', display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={11} /> {t.date} · {t.priority}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => openTask(t)}><Send size={12} /> Send</Button>
              </div>
            ))}
          </Card>
        )}

        {/* ── CONTACTS ── */}
        {activeTab === 'contacts' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <Button onClick={() => { setContactForm({ name: '', email: '', role: '', phone: '' }); setEditContact(null); setContactModal(true) }}><Plus size={14} /> Add contact</Button>
            </div>
            <div style={{ background: '#EEF4FF', border: '1px solid #d0e4ff', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: '#378ADD', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <Lightbulb size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>One shared list of staff, directors and delivery people — used for both email and SMS everywhere in the app.</span>
            </div>
            {contacts.length === 0 ? (
              <Card><p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No contacts yet. Add staff, directors and delivery people.</p></Card>
            ) : contacts.map(c => (
              <div key={c.id} className="mc-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>{c.name} {c.role && <span style={{ fontSize: 11, color: '#aaa', fontWeight: 500 }}>· {c.role}</span>}</div>
                    <div style={{ display: 'flex', gap: 14, marginTop: 3, flexWrap: 'wrap' }}>
                      {c.email && <span style={{ fontSize: 12.5, color: '#555', display: 'flex', alignItems: 'center', gap: 5 }}><AtSign size={12} /> {c.email}</span>}
                      {c.phone && <span style={{ fontSize: 12.5, color: '#555', display: 'flex', alignItems: 'center', gap: 5 }}><Phone size={12} /> {c.phone}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="ghost" size="sm" onClick={() => openContactMessage(c)} disabled={!c.email && !c.phone} title="Send message"><Send size={13} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => { setContactForm({ name: c.name, email: c.email || '', role: c.role || '', phone: c.phone || '' }); setEditContact(c); setContactModal(true) }}><Edit2 size={13} /></Button>
                    <Button variant="danger" size="sm" onClick={() => deleteContact(c)}><Trash2 size={13} /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* Contact modal */}
      {contactModal && (
        <Modal title={editContact ? 'Edit contact' : 'Add contact'} subtitle="Used for email & SMS · add an email and/or a phone" onClose={() => { setContactModal(false); setEditContact(null) }} width={480}>
          {[
            { label: 'Name', key: 'name', placeholder: 'e.g. Ahmed Izyan', required: true },
            { label: 'Phone', key: 'phone', placeholder: '+960 xxx xxxx' },
            { label: 'Email', key: 'email', placeholder: 'email@example.com' },
            { label: 'Role', key: 'role', placeholder: 'e.g. Delivery, Director, Staff' },
          ].map(field => (
            <div key={field.key} style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                {field.label}{field.required && <span style={{ color: '#FFA500' }}>*</span>}
              </label>
              <input value={contactForm[field.key] || ''} onChange={e => setContactForm(p => ({ ...p, [field.key]: e.target.value }))} placeholder={field.placeholder} className="mc-in" />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
            <Button variant="ghost" onClick={() => { setContactModal(false); setEditContact(null) }}>Cancel</Button>
            <Button onClick={saveContact}>Save contact</Button>
          </div>
        </Modal>
      )}

      {/* Compose modal (delivery note / stock / task / staff message) */}
      {compose && (() => {
        const eligible = composeRecipients()
        return (
          <Modal title={compose.title || 'Send message'} onClose={() => setCompose(null)} width={580}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <ChannelToggle value={compose.channel} onChange={ch => setCompose(c => {
                if (c.kind === 'delivery' && c.order) {
                  return { ...c, channel: ch, subject: deliverySubject(c.order), body: ch === 'email' ? deliveryNoteEmail(c.order) : deliveryNoteSMS(c.order) }
                }
                return { ...c, channel: ch }
              })} />
              <span style={{ fontSize: 12, color: '#aaa' }}>{eligible.length} {compose.source} can receive {compose.channel === 'email' ? 'email' : 'SMS'}</span>
            </div>

            {compose.freeTo && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>
                  To {compose.channel === 'email' ? '(email addresses)' : '(phone numbers)'}
                </label>
                <input value={compose.to || ''} onChange={e => setCompose(c => ({ ...c, to: e.target.value }))}
                  placeholder={compose.channel === 'email' ? 'name@example.com, another@example.com' : '7-digit numbers, comma separated'} className="mc-in" />
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>Separate multiple with commas. You can also tick saved contacts below.</div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span>Recipients ({[...compose.sel].filter(id => eligible.some(e => e.id === id)).length})</span>
                {eligible.length > 0 && (
                  <button onClick={() => setCompose(c => ({ ...c, sel: c.sel.size >= eligible.length ? new Set() : new Set(eligible.map(e => e.id)) }))}
                    style={{ background: 'none', border: 'none', color: '#FFA500', fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {compose.sel.size >= eligible.length ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </label>
              {eligible.length === 0 ? (
                <p style={{ fontSize: 12, color: '#f57f17', display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={13} /> No {compose.source} have {compose.channel === 'email' ? 'an email' : 'a phone'}.</p>
              ) : (
                <div style={{ border: '1px solid #eee', borderRadius: 10, maxHeight: 170, overflowY: 'auto' }}>
                  {eligible.map((r, i) => {
                    const checked = compose.sel.has(r.id)
                    return (
                      <label key={r.id} className="mc-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '1px solid #f5f5f5' : 'none', cursor: 'pointer', fontSize: 13, background: checked ? '#fff8ec' : 'transparent' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleComposeSel(r.id)} />
                        <span style={{ fontWeight: 600, color: '#0d1b2a' }}>{r.name}</span>
                        {r.role && <span style={{ fontSize: 11, color: '#aaa' }}>{r.role}</span>}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{compose.channel === 'email' ? r.email : r.phone}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            {compose.channel === 'email' && (
              <input value={compose.subject} onChange={e => setCompose(c => ({ ...c, subject: e.target.value }))} placeholder="Email subject" className="mc-in" style={{ marginBottom: 10 }} />
            )}
            <textarea value={compose.body} onChange={e => setCompose(c => ({ ...c, body: e.target.value }))} placeholder="Message…" className="mc-ta" style={{ minHeight: 150 }} />
            <Counter text={compose.body} channel={compose.channel} />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
              <Button variant="ghost" onClick={() => setCompose(null)}>Cancel</Button>
              <Button onClick={sendCompose} disabled={sending}><Send size={13} /> {sending ? 'Sending…' : `Send ${compose.channel.toUpperCase()}`}</Button>
            </div>
          </Modal>
        )
      })()}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
