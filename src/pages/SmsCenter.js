import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Modal, Spinner, useToast, Toasts, Badge } from '../components/UI'
import { sendSMS, normalizePhone } from '../lib/sms'
import {
  MessageSquare, Send, Plus, Trash2, Edit2, Phone, User, Bike,
  CheckCircle, AlertTriangle, Lightbulb, Users, Truck, Megaphone, Search
} from 'lucide-react'

const BNJ_NAME = "Brick's & Joy"

// Quick-fill templates for customer broadcasts. {name} is replaced per-recipient.
const BROADCAST_TEMPLATES = [
  { label: 'Upcoming sale', emoji: '🏷️', text: `Hi {name}! 🎉 Brick's & Joy is having a SALE this weekend — up to 30% off your favourite sets. Come grab yours before they're gone! See you there 🧱` },
  { label: 'New arrivals', emoji: '✨', text: `Hi {name}! ✨ Fresh stock just landed at Brick's & Joy. New sets are in — be the first to build! Visit us or DM to reserve yours.` },
  { label: 'Restock alert', emoji: '🔁', text: `Hi {name}! The set you've been waiting for is back in stock at Brick's & Joy 🧱 Limited quantity — grab it before it sells out again!` },
  { label: 'Announcement', emoji: '📢', text: `Hi {name}! 📢 A quick update from Brick's & Joy: ` },
]

export default function SmsCenter() {
  const [orders, setOrders] = useState([])
  const [customers, setCustomers] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('broadcast')

  // Compose (single)
  const [composeTo, setComposeTo] = useState('')
  const [composeMsg, setComposeMsg] = useState('')

  // Customer broadcast
  const [custSel, setCustSel] = useState(() => new Set())
  const [custMsg, setCustMsg] = useState('')
  const [custSearch, setCustSearch] = useState('')

  // Delivery note
  const [deliveryModal, setDeliveryModal] = useState(null) // { order }
  const [deliveryMsg, setDeliveryMsg] = useState('')
  const [deliverySel, setDeliverySel] = useState(() => new Set()) // contact ids
  const [deliveryCustomer, setDeliveryCustomer] = useState(false) // also text the customer

  // Contacts (shared with Email Center via email_contacts)
  const [contactModal, setContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name: '', email: '', role: '', phone: '' })
  const [editContact, setEditContact] = useState(null)
  const [contactSmsSel, setContactSmsSel] = useState(() => new Set())
  const [contactMsg, setContactMsg] = useState('')

  const [sending, setSending] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, c, ct] = await Promise.all([
      supabase.from('orders').select('*').in('status', ['pending', 'transit']).order('created_at', { ascending: false }),
      supabase.from('customers').select('*').order('name'),
      supabase.from('email_contacts').select('*').order('name'),
    ])
    setOrders(o.data || [])
    setCustomers(c.data || [])
    setContacts(ct.data || [])
    setLoading(false)
  }

  const customersWithPhone = customers.filter(c => c.phone && c.phone.trim())
  const contactsWithPhone = contacts.filter(c => c.phone && c.phone.trim())

  // ── Compose (single SMS) ───────────────────────────────────────────────────
  async function sendCompose() {
    if (!composeTo.trim()) { toast.error('Enter a phone number'); return }
    if (!composeMsg.trim()) { toast.error('Message is empty'); return }
    setSending(true)
    try {
      await sendSMS(composeTo, composeMsg)
      toast.success('SMS sent!')
      setComposeTo(''); setComposeMsg('')
    } catch (e) { toast.error('SMS failed: ' + e.message) }
    setSending(false)
  }

  // ── Customer broadcast ──────────────────────────────────────────────────────
  function toggleCust(id) { setCustSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  const filteredCustomers = customersWithPhone.filter(c =>
    c.name.toLowerCase().includes(custSearch.toLowerCase()) || (c.phone || '').includes(custSearch)
  )

  // Replace {name} token with the recipient's name (first word) for a personal touch.
  function personalize(template, name) {
    const first = (name || '').trim().split(/\s+/)[0] || 'there'
    return template.replace(/\{name\}/gi, first)
  }

  async function sendBroadcast() {
    if (!custMsg.trim()) { toast.error('Message is empty'); return }
    const targets = customersWithPhone.filter(c => custSel.has(c.id))
    if (targets.length === 0) { toast.error('Select at least one customer'); return }
    if (!window.confirm(`Send this SMS to ${targets.length} customer${targets.length !== 1 ? 's' : ''}?`)) return
    setSending(true)
    let ok = 0, fail = 0
    for (const c of targets) {
      try { await sendSMS(c.phone, personalize(custMsg, c.name)); ok++ } catch { fail++ }
    }
    toast[fail ? 'info' : 'success'](`Sent ${ok}/${targets.length}${fail ? ` · ${fail} failed` : ''}`)
    setSending(false)
  }

  // ── Delivery note ───────────────────────────────────────────────────────────
  function buildDeliveryNote(order) {
    const customer = customers.find(c => c.id === order.customer_id) || {}
    const payStatus = (order.payment_status || 'unpaid').toUpperCase()
    const lines = [
      `Delivery — ${BNJ_NAME}`,
      `Item: ${order.product_name} × ${order.qty}`,
      '',
      `Customer: ${customer.name || order.customer_name || 'Walk-in'}`,
      (customer.phone) ? `Phone: ${customer.phone}` : null,
      (customer.address) ? `Address: ${customer.address}` : null,
      order.order_date ? `Date: ${order.order_date}` : null,
      `Total: MVR ${Number(order.total_price || 0).toFixed(2)} (${payStatus})`,
      order.notes ? `Notes: ${order.notes}` : null,
      customer.notes ? `Cust. notes: ${customer.notes}` : null,
    ].filter(Boolean)
    return lines.join('\n')
  }

  function openDelivery(order) {
    setDeliveryModal({ order })
    setDeliveryMsg(buildDeliveryNote(order))
    // Pre-select the assigned delivery person if they're a saved contact with a phone.
    const dp = contactsWithPhone.find(c => c.name === order.delivery_person)
    setDeliverySel(new Set(dp ? [dp.id] : []))
    setDeliveryCustomer(false)
  }
  function toggleDeliverySel(id) { setDeliverySel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  async function sendDeliveryNote() {
    if (!deliveryMsg.trim()) { toast.error('Message is empty'); return }
    const order = deliveryModal.order
    const customer = customers.find(c => c.id === order.customer_id) || {}
    const recipients = []
    for (const c of contactsWithPhone) if (deliverySel.has(c.id)) recipients.push({ name: c.name, phone: c.phone })
    if (deliveryCustomer && customer.phone) recipients.push({ name: customer.name, phone: customer.phone })
    if (recipients.length === 0) { toast.error('Pick at least one recipient'); return }
    setSending(true)
    let ok = 0, fail = 0
    for (const r of recipients) {
      try { await sendSMS(r.phone, deliveryMsg); ok++ } catch { fail++ }
    }
    toast[fail ? 'info' : 'success'](`Delivery note sent ${ok}/${recipients.length}${fail ? ` · ${fail} failed` : ''}`)
    setSending(false)
    if (!fail) setDeliveryModal(null)
  }

  // ── Contacts (shared email_contacts table) ──────────────────────────────────
  async function saveContact() {
    if (!contactForm.name.trim()) { toast.error('Name is required'); return }
    if (!contactForm.phone.trim()) { toast.error('Phone is required for SMS'); return }
    const trimmed = { name: contactForm.name.trim(), email: (contactForm.email || '').trim(), role: contactForm.role || '', phone: contactForm.phone.trim() }
    if (editContact) {
      const { error } = await supabase.from('email_contacts').update(trimmed).eq('id', editContact.id)
      if (error) { toast.error('Failed to update'); return }
      toast.success('Contact updated!')
    } else {
      const { error } = await supabase.from('email_contacts').insert(trimmed)
      if (error) { toast.error('Failed to save'); return }
      toast.success('Contact saved!')
    }
    setContactModal(false); setEditContact(null); setContactForm({ name: '', email: '', role: '', phone: '' })
    const { data } = await supabase.from('email_contacts').select('*').order('name')
    setContacts(data || [])
  }

  async function deleteContact(contact) {
    if (!window.confirm('Delete this contact? It will also be removed from the Email Center.')) return
    await supabase.from('email_contacts').delete().eq('id', contact.id)
    setContacts(c => c.filter(x => x.id !== contact.id))
    toast.success('Deleted')
  }

  function toggleContactSms(id) { setContactSmsSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  async function sendContactBlast() {
    if (!contactMsg.trim()) { toast.error('Message is empty'); return }
    const targets = contactsWithPhone.filter(c => contactSmsSel.has(c.id))
    if (targets.length === 0) { toast.error('Select at least one contact'); return }
    setSending(true)
    let ok = 0, fail = 0
    for (const c of targets) { try { await sendSMS(c.phone, contactMsg); ok++ } catch { fail++ } }
    toast[fail ? 'info' : 'success'](`Sent ${ok}/${targets.length}${fail ? ` · ${fail} failed` : ''}`)
    setSending(false)
  }

  const TAB_STYLE = (id) => ({
    padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13,
    fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
    background: activeTab === id ? '#FFA500' : '#fff',
    color: activeTab === id ? '#fff' : '#555',
    boxShadow: activeTab === id ? 'none' : '0 0 0 1px #eee',
  })

  // Small reusable character/segment counter
  const Counter = ({ text }) => (
    <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
      {text.length} characters · ~{Math.max(1, Math.ceil(text.length / 160))} SMS each
    </div>
  )

  return (
    <div>
      <style>{`
        .sms-card { background:#fff; border:1px solid #eee; border-radius:12px; padding:14px 16px; margin-bottom:10px; transition: box-shadow 0.15s, border-color 0.15s; }
        .sms-card:hover { border-color:#e3e3e3; box-shadow:0 2px 10px rgba(0,0,0,0.05); }
      `}</style>
      <PageHeader title="SMS Center" subtitle="Broadcast sales & announcements to customers, and send delivery notes to staff" />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[['broadcast', 'Customers', Megaphone], ['deliveries', 'Deliveries', Truck], ['contacts', 'Staff & Contacts', Users], ['compose', 'Quick SMS', MessageSquare]].map(([id, label, Icon]) => (
          <button key={id} style={TAB_STYLE(id)} onClick={() => setActiveTab(id)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : <>

        {/* ── CUSTOMER BROADCAST ── */}
        {activeTab === 'broadcast' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }} className="sms-broadcast-grid">
            <style>{`@media (max-width: 820px) { .sms-broadcast-grid { grid-template-columns: 1fr !important; } }`}</style>
            {/* Recipients */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', margin: 0 }}>Customers ({custSel.size} selected)</h3>
                <button onClick={() => setCustSel(custSel.size === filteredCustomers.length ? new Set() : new Set(filteredCustomers.map(c => c.id)))}
                  style={{ background: 'none', border: 'none', color: '#FFA500', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {custSel.size === filteredCustomers.length && filteredCustomers.length > 0 ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <Search size={14} color="#bbb" style={{ position: 'absolute', left: 11, top: 11 }} />
                <input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Search customers…"
                  style={{ width: '100%', padding: '9px 12px 9px 32px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {customersWithPhone.length === 0 ? (
                <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No customers with phone numbers yet. Add phone numbers in the Customers tab.</p>
              ) : (
                <div style={{ border: '1px solid #eee', borderRadius: 10, maxHeight: 380, overflowY: 'auto' }}>
                  {filteredCustomers.map((c, i) => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '1px solid #f5f5f5' : 'none', cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={custSel.has(c.id)} onChange={() => toggleCust(c.id)} />
                      <span style={{ fontWeight: 600, color: '#0d1b2a' }}>{c.name}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{c.phone}</span>
                    </label>
                  ))}
                  {filteredCustomers.length === 0 && <p style={{ color: '#aaa', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>No matches.</p>}
                </div>
              )}
            </Card>

            {/* Message */}
            <Card>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 12 }}>Message</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {BROADCAST_TEMPLATES.map(t => (
                  <button key={t.label} onClick={() => setCustMsg(t.text)}
                    style={{ padding: '6px 11px', borderRadius: 99, border: '1px solid #eee', background: '#fff', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', color: '#555', fontWeight: 600 }}>
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
              <textarea value={custMsg} onChange={e => setCustMsg(e.target.value)} placeholder="Write your announcement… Tip: use {name} to insert each customer's name."
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 160, boxSizing: 'border-box', outline: 'none' }} />
              <Counter text={custMsg} />
              <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 8, padding: '8px 12px', margin: '12px 0', fontSize: 12, color: '#9a7012', display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                <Lightbulb size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span><strong>{`{name}`}</strong> is replaced with each customer's first name automatically.</span>
              </div>
              <Button onClick={sendBroadcast} disabled={sending || custSel.size === 0} style={{ width: '100%', justifyContent: 'center' }}>
                <Send size={14} /> {sending ? 'Sending…' : `Send to ${custSel.size} customer${custSel.size !== 1 ? 's' : ''}`}
              </Button>
            </Card>
          </div>
        )}

        {/* ── DELIVERIES ── */}
        {activeTab === 'deliveries' && (
          <div>
            <div style={{ background: '#EEF4FF', border: '1px solid #d0e4ff', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#378ADD', display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              <Lightbulb size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Click <strong>Send delivery note</strong> on any order — the SMS is auto-generated from the order and customer details. Pick which staff, directors or delivery person should receive it.</span>
            </div>
            {orders.filter(o => o.delivery_person).length === 0 && (
              <Card><p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No active orders with delivery persons assigned.</p></Card>
            )}
            {orders.filter(o => o.delivery_person).map(o => {
              const customer = customers.find(c => c.id === o.customer_id) || {}
              const dp = contactsWithPhone.find(c => c.name === o.delivery_person)
              return (
                <div key={o.id} className="sms-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a', marginBottom: 4 }}>{o.product_name} × {o.qty}</div>
                      <div style={{ fontSize: 13, color: '#555', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><User size={13} /> {customer.name || o.customer_name || 'Walk-in'}</span>
                        <span style={{ color: '#ddd' }}>·</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#378ADD' }}><Bike size={13} /> {o.delivery_person}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{o.invoice_number || '—'} · {o.order_date}</div>
                      {dp
                        ? <div style={{ fontSize: 11, color: '#1D9E75', marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}><CheckCircle size={12} /> {o.delivery_person} has a phone saved ({dp.phone})</div>
                        : <div style={{ fontSize: 11, color: '#f57f17', marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={12} /> {o.delivery_person} not in contacts — add a phone in Staff & Contacts to text them</div>}
                    </div>
                    <Button onClick={() => openDelivery(o)}><MessageSquare size={13} /> Send delivery note</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── CONTACTS ── */}
        {activeTab === 'contacts' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }} className="sms-broadcast-grid">
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                <Button onClick={() => { setContactForm({ name: '', email: '', role: '', phone: '' }); setEditContact(null); setContactModal(true) }}>
                  <Plus size={14} /> Add contact
                </Button>
              </div>
              <div style={{ background: '#EEF4FF', border: '1px solid #d0e4ff', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: '#378ADD', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Lightbulb size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>These are the same contacts used in the Email Center — staff, directors and delivery persons. Tick contacts on the right to text them.</span>
              </div>
              {contacts.length === 0 ? (
                <Card><p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No contacts yet. Add staff, directors and delivery persons.</p></Card>
              ) : contacts.map((c) => (
                <div key={c.id} className="sms-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>{c.name}</div>
                      {c.role && <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{c.role}</div>}
                      {c.phone
                        ? <div style={{ fontSize: 12, color: '#555', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}><Phone size={12} /> {c.phone}</div>
                        : <div style={{ fontSize: 11, color: '#f57f17', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}><AlertTriangle size={12} /> No phone — can't SMS</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="ghost" size="sm" onClick={() => { setContactForm({ name: c.name, email: c.email || '', role: c.role || '', phone: c.phone || '' }); setEditContact(c); setContactModal(true) }}><Edit2 size={13} /></Button>
                      <Button variant="danger" size="sm" onClick={() => deleteContact(c)}><Trash2 size={13} /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick blast to staff/directors */}
            <Card>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 4 }}>Text staff & directors</h3>
              <p style={{ fontSize: 12, color: '#aaa', margin: '0 0 12px' }}>Send the same message to selected contacts.</p>
              {contactsWithPhone.length === 0 ? (
                <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No contacts with phone numbers.</p>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>Recipients ({contactSmsSel.size})</label>
                    <button onClick={() => setContactSmsSel(contactSmsSel.size === contactsWithPhone.length ? new Set() : new Set(contactsWithPhone.map(c => c.id)))}
                      style={{ background: 'none', border: 'none', color: '#FFA500', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {contactSmsSel.size === contactsWithPhone.length ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <div style={{ border: '1px solid #eee', borderRadius: 10, maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
                    {contactsWithPhone.map((c, i) => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '1px solid #f5f5f5' : 'none', cursor: 'pointer', fontSize: 13 }}>
                        <input type="checkbox" checked={contactSmsSel.has(c.id)} onChange={() => toggleContactSms(c.id)} />
                        <span style={{ fontWeight: 600, color: '#0d1b2a' }}>{c.name}</span>
                        {c.role && <span style={{ fontSize: 11, color: '#aaa' }}>{c.role}</span>}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{c.phone}</span>
                      </label>
                    ))}
                  </div>
                  <textarea value={contactMsg} onChange={e => setContactMsg(e.target.value)} placeholder="Type your message…"
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 100, boxSizing: 'border-box', outline: 'none' }} />
                  <Counter text={contactMsg} />
                  <Button onClick={sendContactBlast} disabled={sending || contactSmsSel.size === 0} style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>
                    <Send size={14} /> {sending ? 'Sending…' : `Send to ${contactSmsSel.size}`}
                  </Button>
                </>
              )}
            </Card>
          </div>
        )}

        {/* ── QUICK SMS ── */}
        {activeTab === 'compose' && (
          <Card style={{ maxWidth: 560 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 16 }}>Quick SMS</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>To</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={composeTo} onChange={e => setComposeTo(e.target.value)} placeholder="7-digit or with 960"
                  style={{ flex: 1, padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                <select onChange={e => { if (e.target.value) setComposeTo(e.target.value) }} defaultValue=""
                  style={{ padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none', maxWidth: 200 }}>
                  <option value="">From contacts / customers…</option>
                  {contactsWithPhone.length > 0 && <optgroup label="Staff & Contacts">
                    {contactsWithPhone.map(c => <option key={c.id} value={c.phone}>{c.name} — {c.phone}</option>)}
                  </optgroup>}
                  {customersWithPhone.length > 0 && <optgroup label="Customers">
                    {customersWithPhone.map(c => <option key={c.id} value={c.phone}>{c.name} — {c.phone}</option>)}
                  </optgroup>}
                </select>
              </div>
              {composeTo && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>Will send to {normalizePhone(composeTo)}</div>}
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Message</label>
              <textarea value={composeMsg} onChange={e => setComposeMsg(e.target.value)} placeholder="Type your SMS…" rows={6}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
              <Counter text={composeMsg} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <Button onClick={sendCompose} disabled={sending || !composeTo || !composeMsg}><Send size={14} /> {sending ? 'Sending…' : 'Send SMS'}</Button>
            </div>
          </Card>
        )}
      </>}

      {/* Contact modal */}
      {contactModal && (
        <Modal title={editContact ? 'Edit contact' : 'Add contact'} subtitle="Shared with the Email Center · phone required for SMS" onClose={() => { setContactModal(false); setEditContact(null); setContactForm({ name: '', email: '', role: '', phone: '' }) }} width={480}>
          {[
            { label: 'Name', key: 'name', placeholder: 'e.g. Ahmed Izyan', required: true },
            { label: 'Phone', key: 'phone', placeholder: '+960 xxx xxxx', required: true },
            { label: 'Role', key: 'role', placeholder: 'e.g. Delivery, Director, Staff' },
            { label: 'Email', key: 'email', placeholder: 'email@example.com (optional)' },
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

      {/* Delivery note modal */}
      {deliveryModal && (() => {
        const order = deliveryModal.order
        const customer = customers.find(c => c.id === order.customer_id) || {}
        return (
          <Modal title="Send delivery note" subtitle={`${order.product_name} × ${order.qty} · ${order.invoice_number || 'no invoice'}`} onClose={() => setDeliveryModal(null)} width={560}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>Recipients</label>
              {contactsWithPhone.length === 0 && !customer.phone && (
                <p style={{ fontSize: 12, color: '#f57f17' }}>No contacts or customer phone available. Add a phone in Staff & Contacts.</p>
              )}
              <div style={{ border: '1px solid #eee', borderRadius: 10, maxHeight: 180, overflowY: 'auto' }}>
                {customer.phone && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', fontSize: 13, background: '#fffdf6' }}>
                    <input type="checkbox" checked={deliveryCustomer} onChange={() => setDeliveryCustomer(v => !v)} />
                    <span style={{ fontWeight: 600, color: '#0d1b2a' }}>{customer.name || order.customer_name}</span>
                    <span style={{ fontSize: 11, color: '#FFA500', fontWeight: 600 }}>Customer</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{customer.phone}</span>
                  </label>
                )}
                {contactsWithPhone.map((c, i) => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: (i || customer.phone) ? '1px solid #f5f5f5' : 'none', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={deliverySel.has(c.id)} onChange={() => toggleDeliverySel(c.id)} />
                    <span style={{ fontWeight: 600, color: '#0d1b2a' }}>{c.name}</span>
                    {c.name === order.delivery_person && <span style={{ fontSize: 11, color: '#378ADD', fontWeight: 600 }}>Delivery person</span>}
                    {c.role && c.name !== order.delivery_person && <span style={{ fontSize: 11, color: '#aaa' }}>{c.role}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{c.phone}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>Message (auto-generated)</span>
                <button onClick={() => setDeliveryMsg(buildDeliveryNote(order))} style={{ background: 'none', border: 'none', color: '#FFA500', fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>
              </label>
              <textarea value={deliveryMsg} onChange={e => setDeliveryMsg(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 170, boxSizing: 'border-box', outline: 'none' }} />
              <Counter text={deliveryMsg} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
              <Button variant="ghost" onClick={() => setDeliveryModal(null)}>Cancel</Button>
              <Button onClick={sendDeliveryNote} disabled={sending}><Send size={13} /> {sending ? 'Sending…' : 'Send delivery note'}</Button>
            </div>
          </Modal>
        )
      })()}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
