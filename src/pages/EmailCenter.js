import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Modal, Spinner, useToast, Toasts, Badge } from '../components/UI'
import { Mail, Send, Plus, Trash2, AlertTriangle, Package, ClipboardList, Truck, Edit2 } from 'lucide-react'

const BNJ_EMAIL = 'bricknjoy@gmail.com'

// Save/load contacts from localStorage
function getContacts() { try { return JSON.parse(localStorage.getItem('bj_email_contacts') || '[]') } catch { return [] } }
function saveContacts(c) { localStorage.setItem('bj_email_contacts', JSON.stringify(c)) }

export default function EmailCenter() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [contacts, setContacts] = useState(getContacts())
  const [contactModal, setContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name: '', email: '', role: '', phone: '', address: '' })
  const [editContact, setEditContact] = useState(null)
  const [composeModal, setComposeModal] = useState(null) // { type, prefill }
  const [composeForm, setComposeForm] = useState({ to: '', subject: '', body: '' })
  const [activeTab, setActiveTab] = useState('compose')
  const toast = useToast()

  const tasks = (() => { try { return JSON.parse(localStorage.getItem('bj_tasks') || '[]') } catch { return [] } })()
  const deliveryStaff = (() => { try { return JSON.parse(localStorage.getItem('deliveryStaff') || '[]') } catch { return [] } })()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, p] = await Promise.all([
      supabase.from('orders').select('*').in('status', ['pending', 'transit']).order('created_at', { ascending: false }),
      supabase.from('products').select('*'),
    ])
    setOrders(o.data || [])
    setProducts(p.data || [])
    setLoading(false)
  }

  const lowStockProducts = products.filter(p => p.stock_qty <= (p.low_stock_threshold || 10) && p.stock_qty > 0)
  const outOfStockProducts = products.filter(p => p.stock_qty <= 0)

  // Open mailto link
  function sendEmail(to, subject, body, cc = BNJ_EMAIL) {
    const ccParam = cc && cc !== to ? `&cc=${encodeURIComponent(cc)}` : ''
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${ccParam}`
    window.open(url, '_blank')
    toast.success('Email client opened!')
  }

  // Save contact
  function saveContact() {
    if (!contactForm.name || !contactForm.email) return
    let updated
    if (editContact !== null) {
      updated = contacts.map((c, i) => i === editContact ? contactForm : c)
    } else {
      updated = [...contacts, contactForm]
    }
    saveContacts(updated)
    setContacts(updated)
    setContactModal(false)
    setEditContact(null)
    setContactForm({ name: '', email: '', role: '', phone: '', address: '' })
    toast.success(editContact !== null ? 'Contact updated!' : 'Contact saved!')
  }

  function deleteContact(i) {
    if (!window.confirm('Delete this contact?')) return
    const updated = contacts.filter((_, idx) => idx !== i)
    saveContacts(updated)
    setContacts(updated)
    toast.success('Deleted')
  }

  // Pre-built email templates
  function emailDelivery(order) {
    const contact = contacts.find(c => c.name === order.delivery_person) || {}
    const to = contact.email || ''
    const subject = `Delivery Assignment — ${order.invoice_number || 'Order'}`
    const body = `Hi ${order.delivery_person || 'Delivery Person'},

You have a new delivery assignment from Brick's & Joy.

━━━━━━━━━━━━━━━━━━━━
ORDER DETAILS
━━━━━━━━━━━━━━━━━━━━
Invoice:       ${order.invoice_number || '—'}
Customer:      ${order.customer_name || 'Walk-in'}
Product:       ${order.product_name}
Quantity:      ${order.qty}
Order Date:    ${order.order_date}
Status:        ${order.status}

━━━━━━━━━━━━━━━━━━━━
DELIVERY INFO
━━━━━━━━━━━━━━━━━━━━
${contact.address ? `Address:  ${contact.address}` : 'Address:  [Please add delivery address]'}
${contact.phone ? `Phone:    ${contact.phone}` : 'Phone:    [Customer phone]'}

${order.notes ? `Notes:\n${order.notes}` : ''}

Please confirm once delivered.

— Brick's & Joy Team`
    setComposeForm({ to, subject, body })
    setComposeModal('delivery')
  }

  function emailLowStock() {
    const subject = `⚠️ Low Stock Alert — Brick's & Joy`
    const outLines = outOfStockProducts.map(p => `  ❌ ${p.name} — OUT OF STOCK (was ${p.stock_qty})`).join('\n')
    const lowLines = lowStockProducts.map(p => `  ⚠️ ${p.name} — ${p.stock_qty} left (threshold: ${p.low_stock_threshold || 10})`).join('\n')
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
    const subject = `📋 Task Assigned — ${task.title}`
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
      <style>{`.email-card { background:#fff; border:1px solid #eee; border-radius:12px; padding:14px 16px; margin-bottom:10px; }`}</style>
      <PageHeader title="Email Center" subtitle="Send delivery assignments, stock alerts, tasks and custom emails" />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[['compose', 'Compose', Mail], ['deliveries', 'Deliveries', Truck], ['stock', 'Stock Alerts', AlertTriangle], ['tasks', 'Tasks', ClipboardList], ['contacts', 'Contacts', Plus]].map(([id, label, Icon]) => (
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
                  <option value="">📋 From contacts</option>
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
              <Button onClick={() => sendEmail(composeForm.to, composeForm.subject, composeForm.body)} disabled={!composeForm.to || !composeForm.subject}>
                <Send size={14} /> Send via email app
              </Button>
            </div>
          </Card>
        )}

        {/* ── DELIVERIES ── */}
        {activeTab === 'deliveries' && (
          <div>
            <div style={{ background: '#EEF4FF', border: '1px solid #d0e4ff', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#378ADD' }}>
              💡 Click <strong>Send delivery email</strong> on any order — it'll open pre-filled with the delivery person's details saved in Contacts.
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
                      <div style={{ fontSize: 13, color: '#555' }}>👤 {o.customer_name || 'Walk-in'} · 🚴 {o.delivery_person}</div>
                      <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{o.invoice_number || '—'} · {o.order_date}</div>
                      {!contact && <div style={{ fontSize: 11, color: '#f57f17', marginTop: 4 }}>⚠️ {o.delivery_person} not in contacts — add them to pre-fill email address</div>}
                      {contact && <div style={{ fontSize: 11, color: '#1D9E75', marginTop: 4 }}>✅ Contact found: {contact.email}</div>}
                    </div>
                    <Button onClick={() => { emailDelivery(o); setActiveTab('compose') }}>
                      <Mail size={13} /> Send email
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
                <div style={{ fontSize: 28, fontWeight: 800, color: '#c62828' }}>{outOfStockProducts.length}</div>
              </div>
              <div style={{ background: '#FFF8E1', borderRadius: 12, padding: '16px 20px', border: '1px solid #FAEEDA' }}>
                <div style={{ fontSize: 11, color: '#f57f17', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Low stock</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#f57f17' }}>{lowStockProducts.length}</div>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <Button onClick={() => { emailLowStock(); setActiveTab('compose') }}>
                <AlertTriangle size={14} /> Send stock alert to {BNJ_EMAIL}
              </Button>
            </div>
            {[...outOfStockProducts, ...lowStockProducts].map(p => (
              <div key={p.id} className="email-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: p.stock_qty <= 0 ? '#c62828' : '#f57f17', marginTop: 2, fontWeight: 600 }}>
                    {p.stock_qty <= 0 ? '❌ Out of stock' : `⚠️ ${p.stock_qty} left (threshold: ${p.low_stock_threshold || 10})`}
                  </div>
                </div>
                <Badge color={p.stock_qty <= 0 ? 'red' : 'amber'}>{p.stock_qty <= 0 ? 'Out of stock' : 'Low stock'}</Badge>
              </div>
            ))}
            {outOfStockProducts.length === 0 && lowStockProducts.length === 0 && (
              <Card><p style={{ color: '#1D9E75', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>✅ All products are well stocked!</p></Card>
            )}
          </div>
        )}

        {/* ── TASKS ── */}
        {activeTab === 'tasks' && (
          <div>
            <div style={{ background: '#EEF4FF', border: '1px solid #d0e4ff', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#378ADD' }}>
              💡 Click <strong>Send task email</strong> — it opens pre-filled. Enter the recipient's email in the To field or pick from Contacts.
            </div>
            {tasks.length === 0 ? (
              <Card><p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No pending tasks.</p></Card>
            ) : tasks.map(t => (
              <div key={t.id} className="email-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a', marginBottom: 4 }}>{t.title}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>📅 {t.date} · {t.priority} priority</div>
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
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
                    <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>📧 {c.email}</div>
                    {c.role && <div style={{ fontSize: 12, color: '#aaa', marginTop: 1 }}>{c.role}</div>}
                    {c.phone && <div style={{ fontSize: 12, color: '#aaa' }}>📞 {c.phone}</div>}
                    {c.address && <div style={{ fontSize: 12, color: '#aaa' }}>📍 {c.address}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="ghost" size="sm" onClick={() => sendEmail(c.email, '', '')}><Mail size={13} /></Button>
                    <Button variant="ghost" size="sm" onClick={() => { setContactForm(c); setEditContact(i); setContactModal(true) }}><Edit2 size={13} /></Button>
                    <Button variant="danger" size="sm" onClick={() => deleteContact(i)}><Trash2 size={13} /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>}

      {/* Contact modal */}
      {contactModal && (
        <Modal title={editContact !== null ? 'Edit contact' : 'Add contact'} onClose={() => setContactModal(false)} width={480}>
          {[
            { label: 'Name *', key: 'name', placeholder: 'e.g. Ahmed Izyan' },
            { label: 'Email *', key: 'email', placeholder: 'email@example.com' },
            { label: 'Role', key: 'role', placeholder: 'e.g. Delivery, Supplier, Staff' },
            { label: 'Phone', key: 'phone', placeholder: '+960 xxx xxxx' },
            { label: 'Address / delivery area', key: 'address', placeholder: 'e.g. Male, Hulhumale' },
          ].map(field => (
            <div key={field.key} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>{field.label}</label>
              <input value={contactForm[field.key]} onChange={e => setContactForm(p => ({ ...p, [field.key]: e.target.value }))} placeholder={field.placeholder}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="ghost" onClick={() => setContactModal(false)}>Cancel</Button>
            <Button onClick={saveContact} disabled={!contactForm.name || !contactForm.email}>Save contact</Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
