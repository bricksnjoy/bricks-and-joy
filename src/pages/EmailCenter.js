import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Modal, Spinner, useToast, Toasts, Badge } from '../components/UI'
import { Mail, Send, Plus, Trash2, AlertTriangle, Package, ClipboardList, Truck, Edit2, CheckCircle, User, Bike, Calendar, XCircle, Lightbulb, Users, AtSign, Phone, MessageSquare } from 'lucide-react'
import { sendSMS } from '../lib/sms'

const EMAILJS_SERVICE = 'service_pt7xkma'
const EMAILJS_TEMPLATE = 'template_9zgrhkb'
const EMAILJS_PUBLIC_KEY = 'kLZVT1yzwlXV3hua6'
const BNJ_EMAIL = 'bricknjoy@gmail.com'

function getContacts() { try { return JSON.parse(localStorage.getItem('bj_email_contacts') || '[]') } catch { return [] } }
// localStorage kept only as migration fallback — contacts now live in Supabase email_contacts table

async function sendEmailJS(to, subject, message, replyTo = BNJ_EMAIL) {
  const res = await fetch(`https://api.emailjs.com/api/v1.0/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE,
      template_id: EMAILJS_TEMPLATE,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        to_email: to,
        subject,
        message,
        reply_to: replyTo,
        name: "Brick's & Joy",
        email: BNJ_EMAIL,
      }
    })
  })
  if (!res.ok) throw new Error(await res.text())
}
export default function EmailCenter() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [contacts, setContacts] = useState([])
  const [customers, setCustomers] = useState([])
  const [contactModal, setContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name: '', email: '', role: '', phone: '' })
  const [editContact, setEditContact] = useState(null)
  const [composeModal, setComposeModal] = useState(null) // { type, prefill }
  const [composeForm, setComposeForm] = useState({ to: '', subject: '', body: '' })
  const [activeTab, setActiveTab] = useState('compose')
  const [smsModal, setSmsModal] = useState(null) // { mode: 'one' | 'all' }
  const [smsTo, setSmsTo] = useState('')
  const [smsMsg, setSmsMsg] = useState('')
  const [smsSel, setSmsSel] = useState(() => new Set())
  const [smsSending, setSmsSending] = useState(false)
  const [sending, setSending] = useState(false)
  const toast = useToast()

  const tasks = (() => { try { return JSON.parse(localStorage.getItem('bj_tasks') || '[]') } catch { return [] } })()
  const deliveryStaff = (() => { try { return JSON.parse(localStorage.getItem('deliveryStaff') || '[]') } catch { return [] } })()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, p, c, ct] = await Promise.all([
      supabase.from('orders').select('*').in('status', ['pending', 'transit']).order('created_at', { ascending: false }),
      supabase.from('products').select('*'),
      supabase.from('customers').select('*'),
      supabase.from('email_contacts').select('*').order('name'),
    ])
    setOrders(o.data || [])
    setProducts(p.data || [])
    setCustomers(c.data || [])
    // Migrate any localStorage contacts to Supabase on first load
    const dbContacts = ct.data || []
    if (dbContacts.length === 0) {
      const legacy = getContacts()
      if (legacy.length > 0) {
        await supabase.from('email_contacts').insert(legacy.map(c => ({ name: c.name, email: c.email, role: c.role || '', phone: c.phone || '' })))
        const { data } = await supabase.from('email_contacts').select('*').order('name')
        setContacts(data || legacy)
        localStorage.removeItem('bj_email_contacts')
      } else {
        setContacts([])
      }
    } else {
      setContacts(dbContacts)
    }
    setLoading(false)
  }

  const lowStockProducts = products.filter(p => p.stock_qty <= (p.low_stock_threshold || 10) && p.stock_qty > 0)
  const outOfStockProducts = products.filter(p => p.stock_qty <= 0)

  // Send via EmailJS
  async function sendEmail(to, subject, body) {
    if (!to || !subject) { toast.error('To and subject are required'); return }
    setSending(true)
    try {
      await sendEmailJS(to, subject, body)
      toast.success(`Email sent to ${to}!`)
      setComposeModal(null)
      setComposeForm({ to: '', subject: '', body: '' })
    } catch (err) {
      console.error(err)
      toast.error('Failed to send. Check EmailJS setup.')
    }
    setSending(false)
  }

  // Save contact to Supabase
  async function saveContact() {
    if (!contactForm.name.trim()) { toast.error('Name is required'); return }
    if (!contactForm.email.trim()) { toast.error('Email is required'); return }
    const trimmed = { name: contactForm.name.trim(), email: contactForm.email.trim(), role: contactForm.role || '', phone: contactForm.phone || '' }
    if (editContact) {
      const { error } = await supabase.from('email_contacts').update(trimmed).eq('id', editContact.id)
      if (error) { toast.error('Failed to update'); return }
      toast.success('Contact updated!')
    } else {
      const { error } = await supabase.from('email_contacts').insert(trimmed)
      if (error) { toast.error('Failed to save'); return }
      toast.success('Contact saved!')
    }
    setContactModal(false)
    setEditContact(null)
    setContactForm({ name: '', email: '', role: '', phone: '' })
    const { data } = await supabase.from('email_contacts').select('*').order('name')
    setContacts(data || [])
  }

  async function deleteContact(contact) {
    if (!window.confirm('Delete this contact?')) return
    await supabase.from('email_contacts').delete().eq('id', contact.id)
    setContacts(c => c.filter(x => x.id !== contact.id))
    toast.success('Deleted')
  }

  // ── SMS (Message Owl) ──────────────────────────────────────────────────────
  function openSmsOne(c) { setSmsModal({ mode: 'one' }); setSmsTo(c.phone || ''); setSmsMsg('') }
  function openSmsBroadcast() { setSmsModal({ mode: 'all' }); setSmsSel(new Set()); setSmsMsg('') }
  function toggleSmsSel(id) { setSmsSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  async function sendSmsBlast() {
    if (!smsMsg.trim()) { toast.error('Message is empty'); return }
    setSmsSending(true)
    try {
      if (smsModal.mode === 'one') {
        if (!smsTo) { toast.error('Enter a phone number'); setSmsSending(false); return }
        await sendSMS(smsTo, smsMsg)
        toast.success('SMS sent!')
      } else {
        const targets = contacts.filter(c => smsSel.has(c.id) && c.phone)
        if (targets.length === 0) { toast.error('Select at least one contact with a phone'); setSmsSending(false); return }
        let ok = 0, fail = 0
        for (const c of targets) { try { await sendSMS(c.phone, smsMsg); ok++ } catch { fail++ } }
        toast[fail ? 'info' : 'success'](`Sent ${ok}/${targets.length}${fail ? ` · ${fail} failed` : ''}`)
      }
      setSmsModal(null)
    } catch (e) { toast.error('SMS failed: ' + e.message) }
    setSmsSending(false)
  }

  // Pre-built email templates
  function emailDelivery(order) {
    const contact = contacts.find(c => c.name === order.delivery_person) || {}
    const customer = customers.find(c => c.id === order.customer_id) || {}
    const to = contact.email || ''
    const subject = `Delivery Assignment — ${order.invoice_number || 'Order'}`
    const body = `Hi ${order.delivery_person || 'Delivery Person'},

You have a new delivery assignment from Brick's & Joy.

━━━━━━━━━━━━━━━━━━━━
ORDER DETAILS
━━━━━━━━━━━━━━━━━━━━
Invoice:       ${order.invoice_number || '—'}
Product:       ${order.product_name}
Quantity:      ${order.qty}
Order Date:    ${order.order_date}
Status:        ${order.status}

━━━━━━━━━━━━━━━━━━━━
CUSTOMER / DELIVERY INFO
━━━━━━━━━━━━━━━━━━━━
Name:      ${customer.name || order.customer_name || 'Walk-in'}
Phone:     ${customer.phone || '—'}
Address:   ${customer.address || '—'}
Instagram: ${customer.email || '—'}
${customer.notes ? `Notes:     ${customer.notes}` : ''}
${order.notes ? `\nOrder notes:\n${order.notes}` : ''}

Please confirm once delivered.

— Brick's & Joy Team`
    setComposeForm({ to, subject, body })
    setComposeModal('delivery')
  }

  function emailLowStock() {
    const subject = `Low Stock Alert — Brick's & Joy`
    const outLines = outOfStockProducts.map(p => `  - ${p.name} — OUT OF STOCK (was ${p.stock_qty})`).join('\n')
    const lowLines = lowStockProducts.map(p => `  - ${p.name} — ${p.stock_qty} left (threshold: ${p.low_stock_threshold || 10})`).join('\n')
    const body = `Stock Alert — Brick's & Joy
${new Date().toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

━━━━━━━━━━━━━━━━━━━━
OUT OF STOCK (${outOfStockProducts.length})
━━━━━━━━━━━━━━━━━━━━
${outLines || '  None'}

━━━━━━━━━━━━━━━━━━━━
LOW STOCK (${lowStockProducts.length})
━━━━━━━━━━━━━━━━━━━━
${lowLines || '  None'}

Please reorder as needed.

— Brick's & Joy System`
    setComposeForm({ to: BNJ_EMAIL, subject, body })
    setComposeModal('stock')
  }

  function emailTask(task) {
    const subject = `Task Assigned — ${task.title}`
    const body = `Hi,

A task has been assigned to you from Brick's & Joy.

━━━━━━━━━━━━━━━━━━━━
TASK DETAILS
━━━━━━━━━━━━━━━━━━━━
Task:      ${task.title}
Due date:  ${task.date}
Priority:  ${task.priority}
${task.notes ? `\nNotes:\n${task.notes}` : ''}

Please complete this by the due date.

— Brick's & Joy Team`
    setComposeForm({ to: '', subject, body })
    setComposeModal('task')
  }

  function openCompose() {
    setComposeForm({ to: '', subject: '', body: '' })
    setComposeModal('custom')
  }

  const TAB_STYLE = (id) => ({
    padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
    fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
    background: activeTab === id ? '#FFA500' : '#fff',
    color: activeTab === id ? '#fff' : '#555',
    boxShadow: activeTab === id ? 'none' : '0 0 0 1px #eee',
  })

  return (
    <div>
      <style>{`
        .email-card { background:#fff; border:1px solid #eee; border-radius:12px; padding:14px 16px; margin-bottom:10px; transition: box-shadow 0.15s, border-color 0.15s; }
        .email-card:hover { border-color:#e3e3e3; box-shadow:0 2px 10px rgba(0,0,0,0.05); }
      `}</style>
      <PageHeader title="Email Center" subtitle="Send delivery assignments, stock alerts, tasks and custom emails" />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[['compose', 'Compose', Mail], ['deliveries', 'Deliveries', Truck], ['stock', 'Stock Alerts', AlertTriangle], ['tasks', 'Tasks', ClipboardList], ['contacts', 'Contacts', Users]].map(([id, label, Icon]) => (
          <button key={id} style={TAB_STYLE(id)} onClick={() => setActiveTab(id)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : <>

        {/* ── COMPOSE ── */}
        {activeTab === 'compose' && (
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 16 }}>New email</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>To</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={composeForm.to} onChange={e => setComposeForm(p => ({ ...p, to: e.target.value }))} placeholder="email@example.com"
                  style={{ flex: 1, padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                <select onChange={e => { if (e.target.value) setComposeForm(p => ({ ...p, to: e.target.value })) }}
                  style={{ padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none' }}>
                  <option value="">From contacts…</option>
                  {contacts.map((c, i) => <option key={i} value={c.email}>{c.name} — {c.email}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Subject</label>
              <input value={composeForm.subject} onChange={e => setComposeForm(p => ({ ...p, subject: e.target.value }))} placeholder="Subject"
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Message</label>
              <textarea value={composeForm.body} onChange={e => setComposeForm(p => ({ ...p, body: e.target.value }))} placeholder="Write your message…" rows={10}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: '#aaa' }}>A copy will be sent to {BNJ_EMAIL}</div>
              <Button onClick={() => sendEmail(composeForm.to, composeForm.subject, composeForm.body)} disabled={!composeForm.to || !composeForm.subject || sending}>
                <Send size={14} /> {sending ? 'Sending…' : 'Send email'}
              </Button>
            </div>
          </Card>
        )}

        {/* ── DELIVERIES ── */}
        {activeTab === 'deliveries' && (
          <div>
            <div style={{ background: '#EEF4FF', border: '1px solid #d0e4ff', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#378ADD', display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              <Lightbulb size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Click <strong>Send delivery email</strong> on any order — it'll open pre-filled with the delivery person's details saved in Contacts.</span>
            </div>
            {orders.filter(o => o.delivery_person).length === 0 && (
              <Card><p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No active orders with delivery persons assigned.</p></Card>
            )}
            {orders.filter(o => o.delivery_person).map(o => {
              const contact = contacts.find(c => c.name === o.delivery_person)
              return (
                <div key={o.id} className="email-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a', marginBottom: 4 }}>{o.product_name} × {o.qty}</div>
                      <div style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><User size={13} /> {o.customer_name || 'Walk-in'}</span>
                        <span style={{ color: '#ddd' }}>·</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#378ADD' }}><Bike size={13} /> {o.delivery_person}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{o.invoice_number || '—'} · {o.order_date}</div>
                      {!contact && <div style={{ fontSize: 11, color: '#f57f17', marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={12} /> {o.delivery_person} not in contacts — add them to pre-fill email address</div>}
                      {contact && <div style={{ fontSize: 11, color: '#1D9E75', marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}><CheckCircle size={12} /> Contact found: {contact.email}</div>}
                    </div>
                    <Button onClick={() => { emailDelivery(o); setActiveTab('compose') }} disabled={!contact?.email}>
                      <Mail size={13} /> {contact?.email ? 'Send email' : 'Add contact email first'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── STOCK ALERTS ── */}
        {activeTab === 'stock' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
              <div style={{ background: '#FCEBEB', borderRadius: 12, padding: '16px 20px', border: '1px solid #f5c6c6' }}>
                <div style={{ fontSize: 11, color: '#c62828', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Out of stock</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#c62828', letterSpacing: '-0.5px' }}>{outOfStockProducts.length}</div>
              </div>
              <div style={{ background: '#FFF8E1', borderRadius: 12, padding: '16px 20px', border: '1px solid #FAEEDA' }}>
                <div style={{ fontSize: 11, color: '#f57f17', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Low stock</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#f57f17', letterSpacing: '-0.5px' }}>{lowStockProducts.length}</div>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <Button onClick={async () => {
                const subject = `Low Stock Alert — Brick's & Joy`
                const outLines = outOfStockProducts.map(p => `  - ${p.name} — OUT OF STOCK`).join('\n')
                const lowLines = lowStockProducts.map(p => `  - ${p.name} — ${p.stock_qty} left (threshold: ${p.low_stock_threshold || 10})`).join('\n')
                const body = `Stock Alert — Brick's & Joy\n${new Date().toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\nOUT OF STOCK (${outOfStockProducts.length})\n${outLines || '  None'}\n\nLOW STOCK (${lowStockProducts.length})\n${lowLines || '  None'}\n\nPlease reorder as needed.\n\n— Brick's & Joy System`
                await sendEmail(BNJ_EMAIL, subject, body)
              }} disabled={sending}>
                <AlertTriangle size={14} /> {sending ? 'Sending…' : `Send stock alert to ${BNJ_EMAIL}`}
              </Button>
            </div>
            {[...outOfStockProducts, ...lowStockProducts].map(p => (
              <div key={p.id} className="email-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: p.stock_qty <= 0 ? '#c62828' : '#f57f17', marginTop: 3, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {p.stock_qty <= 0
                      ? <><XCircle size={12} /> Out of stock</>
                      : <><AlertTriangle size={12} /> {p.stock_qty} left (threshold: {p.low_stock_threshold || 10})</>}
                  </div>
                </div>
                <Badge color={p.stock_qty <= 0 ? 'red' : 'amber'}>{p.stock_qty <= 0 ? 'Out of stock' : 'Low stock'}</Badge>
              </div>
            ))}
            {outOfStockProducts.length === 0 && lowStockProducts.length === 0 && (
              <Card><p style={{ color: '#1D9E75', fontSize: 13, textAlign: 'center', padding: '30px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><CheckCircle size={16} /> All products are well stocked!</p></Card>
            )}
          </div>
        )}

        {/* ── TASKS ── */}
        {activeTab === 'tasks' && (
          <div>
            <div style={{ background: '#EEF4FF', border: '1px solid #d0e4ff', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#378ADD', display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              <Lightbulb size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Click <strong>Send task email</strong> — it opens pre-filled. Enter the recipient's email in the To field or pick from Contacts.</span>
            </div>
            {tasks.length === 0 ? (
              <Card><p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No pending tasks.</p></Card>
            ) : tasks.map(t => (
              <div key={t.id} className="email-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a', marginBottom: 4 }}>{t.title}</div>
                    <div style={{ fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}><Calendar size={12} /> {t.date} · {t.priority} priority</div>
                    {t.notes && <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{t.notes}</div>}
                  </div>
                  <Button onClick={() => { emailTask(t); setActiveTab('compose') }}>
                    <Mail size={13} /> Send email
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── CONTACTS ── */}
        {activeTab === 'contacts' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
              <Button variant="ghost" onClick={openSmsBroadcast} disabled={contacts.filter(c => c.phone).length === 0}><MessageSquare size={14} /> SMS broadcast</Button>
              <Button onClick={() => { setContactForm({ name: '', email: '', role: '', phone: '', address: '' }); setEditContact(null); setContactModal(true) }}>
                <Plus size={14} /> Add contact
              </Button>
            </div>
            {contacts.length === 0 ? (
              <Card><p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No contacts yet. Add delivery persons, suppliers, staff.</p></Card>
            ) : contacts.map((c, i) => (
              <div key={i} className="email-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>{c.name}</div>
                    <div style={{ fontSize: 13, color: '#555', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}><AtSign size={12} /> {c.email}</div>
                    {c.role && <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{c.role}</div>}
                    {c.phone && <div style={{ fontSize: 12, color: '#aaa', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}><Phone size={12} /> {c.phone}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="ghost" size="sm" onClick={() => { setComposeForm({ to: c.email, subject: '', body: '' }); setActiveTab('compose') }}><Mail size={13} /></Button>
                    {c.phone && <Button variant="ghost" size="sm" onClick={() => openSmsOne(c)} title="Send SMS"><MessageSquare size={13} /></Button>}
                    <Button variant="ghost" size="sm" onClick={() => { setContactForm({ name: c.name, email: c.email, role: c.role || '', phone: c.phone || '' }); setEditContact(c); setContactModal(true) }}><Edit2 size={13} /></Button>
                    <Button variant="danger" size="sm" onClick={() => deleteContact(c)}><Trash2 size={13} /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>}

      {/* Contact modal */}
      {contactModal && (
        <Modal title={editContact ? 'Edit contact' : 'Add contact'} subtitle="Name and email are required" onClose={() => { setContactModal(false); setEditContact(null); setContactForm({ name: '', email: '', role: '', phone: '' }) }} width={480}>
          {[
            { label: 'Name', key: 'name', placeholder: 'e.g. Ahmed Izyan', required: true },
            { label: 'Email', key: 'email', placeholder: 'email@example.com', required: true },
            { label: 'Role', key: 'role', placeholder: 'e.g. Delivery, Supplier, Staff' },
            { label: 'Phone', key: 'phone', placeholder: '+960 xxx xxxx' },
          ].map(field => (
            <div key={field.key} style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                {field.label}
                {field.required && <span style={{ color: '#FFA500' }}>*</span>}
              </label>
              <input
                value={contactForm[field.key] || ''}
                onChange={e => setContactForm(p => ({ ...p, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                style={{ width: '100%', padding: '10px 13px', border: `1px solid ${field.required && !contactForm[field.key] ? '#ffd0a0' : '#e0e0e0'}`, borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', transition: 'border 0.15s' }}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
            <Button variant="ghost" onClick={() => { setContactModal(false); setEditContact(null); setContactForm({ name: '', email: '', role: '', phone: '' }) }}>Cancel</Button>
            <Button onClick={saveContact}>Save contact</Button>
          </div>
        </Modal>
      )}

      {/* ── SMS MODAL ── */}
      {smsModal && (
        <Modal title={smsModal.mode === 'all' ? 'SMS broadcast' : 'Send SMS'} subtitle={smsModal.mode === 'all' ? 'Text multiple staff / directors at once' : undefined} onClose={() => setSmsModal(null)} width={500}>
          {smsModal.mode === 'one' ? (
            <Input label="Phone number" value={smsTo} onChange={e => setSmsTo(e.target.value)} placeholder="7-digit or with 960" style={{ marginBottom: 12 }} />
          ) : (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Recipients ({smsSel.size})</label>
                <button onClick={() => setSmsSel(new Set(contacts.filter(c => c.phone).map(c => c.id)))} style={{ background: 'none', border: 'none', color: '#FFA500', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Select all</button>
              </div>
              <div style={{ border: '1px solid #eee', borderRadius: 10, maxHeight: 200, overflowY: 'auto' }}>
                {contacts.filter(c => c.phone).map((c, i) => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '1px solid #f5f5f5' : 'none', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={smsSel.has(c.id)} onChange={() => toggleSmsSel(c.id)} />
                    <span style={{ fontWeight: 600, color: '#0d1b2a' }}>{c.name}</span>
                    {c.role && <span style={{ fontSize: 11, color: '#aaa' }}>{c.role}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{c.phone}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Message</label>
            <textarea value={smsMsg} onChange={e => setSmsMsg(e.target.value)} placeholder="Type your SMS…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 90, boxSizing: 'border-box', outline: 'none' }} />
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>{smsMsg.length} characters · ~{Math.max(1, Math.ceil(smsMsg.length / 160))} SMS each</div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
            <Button variant="ghost" onClick={() => setSmsModal(null)}>Cancel</Button>
            <Button onClick={sendSmsBlast} disabled={smsSending}><MessageSquare size={13} /> {smsSending ? 'Sending…' : 'Send SMS'}</Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
