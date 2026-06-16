import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { sendEmailJS, BNJ_EMAIL } from '../lib/email'
import { PageHeader, Card, Button, Input, Modal, Spinner, useToast, Toasts } from '../components/UI'
import {
  Plus, Trash2, Edit2, Mail, CheckCircle, Circle, Sparkles, RefreshCw,
  Package, Megaphone, ShoppingBag, Calendar, AlertTriangle, X, Bot
} from 'lucide-react'
import {
  OCCASION_LIBRARY, generateCampaignPlan, campaignStatus, nextOccurrence,
} from '../lib/campaignEngine'

const LS_KEY = 'bnj_campaigns_v1'
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') } catch { return [] } }
const writeLocal = arr => localStorage.setItem(LS_KEY, JSON.stringify(arr))

const STATUS_STYLE = {
  active: { bg: '#E1F5EE', fg: '#1D9E75' },
  prep: { bg: '#FFF3D6', fg: '#b8740a' },
  scheduled: { bg: '#EAF2FD', fg: '#2f6fc0' },
  none: { bg: '#f5f5f5', fg: '#999' },
}

const fmt = d => d ? new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function checklistProgress(plan) {
  const list = plan?.checklist || []
  const done = list.filter(c => c.done).length
  return { done, total: list.length, pct: list.length ? Math.round(done / list.length * 100) : 0 }
}

function buildEmailBody(camp, st, plan) {
  const items = (plan?.stockUpExisting || []).slice(0, 8).map(p => `• ${p.name}${p.inInventory ? '' : ' (not in inventory yet)'}`).join('\n')
  const newIdeas = (plan?.stockUpNew || []).slice(0, 6).map(s => `• ${s}`).join('\n')
  const next = (plan?.checklist || []).filter(c => !c.done).slice(0, 5).map(c => `☐ ${c.text} (by ${fmt(c.due)})`).join('\n')
  return [
    `${plan?.emoji || ''} ${camp.name} is coming up on ${fmt(st.occ)} — about ${st.daysUntil} days away.`,
    ``,
    plan?.summary || '',
    ``,
    items ? `STOCK UP ON (you already carry):\n${items}` : '',
    newIdeas ? `\nNEW PRODUCTS TO CONSIDER:\n${newIdeas}` : '',
    next ? `\nNEXT STEPS:\n${next}` : '',
    ``,
    `— Brick's & Joy Planning`,
  ].filter(l => l !== undefined).join('\n')
}

export default function Planning() {
  const [campaigns, setCampaigns] = useState([])
  const [catalog, setCatalog] = useState([])
  const [inventoryNames, setInventoryNames] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [usingLocal, setUsingLocal] = useState(false)
  const [addModal, setAddModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', date: '', lead_days: 90, notify_email: BNJ_EMAIL })
  const [planModal, setPlanModal] = useState(null) // campaign being viewed
  const [saving, setSaving] = useState(false)
  const notifiedRef = useRef(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [c, cat, prod] = await Promise.all([
      supabase.from('campaigns').select('*').order('occasion_date'),
      supabase.from('supplier_products').select('product_name,category,tags,description,supplier_name,cost_price'),
      supabase.from('products').select('name'),
    ])
    setCatalog(cat.data || [])
    setInventoryNames(new Set((prod.data || []).map(p => (p.name || '').toLowerCase().trim()).filter(Boolean)))
    if (c.error) { setUsingLocal(true); setCampaigns(readLocal()) }
    else { setUsingLocal(false); setCampaigns(c.data || []) }
    setLoading(false)
  }

  // Fire prep reminders once per session for any campaign that has entered its
  // prep window and hasn't been emailed yet this cycle. (Background email also
  // runs server-side via the Supabase scheduled function once deployed.)
  useEffect(() => {
    if (loading || notifiedRef.current) return
    notifiedRef.current = true
    ;(async () => {
      for (const c of campaigns) {
        const st = campaignStatus(c.occasion_date, c.lead_days || 90)
        const year = st.occ?.getFullYear()
        if (st.key === 'prep' && c.notify_email && c.last_notified_year !== year) {
          try {
            await sendEmailJS(c.notify_email, `⏰ Time to prep for ${c.name}!`, buildEmailBody(c, st, c.plan))
            await patch(c, { last_notified_year: year })
            toast.info(`Prep reminder emailed for ${c.name}`)
          } catch { /* email is best-effort on the client */ }
        }
      }
    })()
  }, [loading])

  const isLocalRec = c => usingLocal || String(c.id).startsWith('local-')

  async function patch(camp, changes) {
    const next = { ...camp, ...changes }
    if (isLocalRec(camp)) {
      setCampaigns(cs => { const arr = cs.map(c => c.id === camp.id ? next : c); writeLocal(arr); return arr })
    } else {
      await supabase.from('campaigns').update(changes).eq('id', camp.id)
      setCampaigns(cs => cs.map(c => c.id === camp.id ? next : c))
    }
    if (planModal && planModal.id === camp.id) setPlanModal(next)
    return next
  }

  function openAdd() {
    setEditing(null)
    setForm({ name: '', date: '', lead_days: 90, notify_email: BNJ_EMAIL })
    setAddModal(true)
  }

  function openEdit(camp) {
    setEditing(camp)
    setForm({ name: camp.name, date: nextOccurrence(camp.occasion_date) ? camp.occasion_date : '', lead_days: camp.lead_days || 90, notify_email: camp.notify_email || BNJ_EMAIL })
    setAddModal(true)
  }

  // Auto-fill the date when the name matches a known occasion
  function onNameChange(name) {
    setForm(f => {
      const match = OCCASION_LIBRARY.find(o => o.name.toLowerCase() === name.toLowerCase() || o.aliases.some(a => name.toLowerCase().includes(a)))
      let date = f.date
      if (match && !f.date) {
        const y = new Date().getFullYear()
        date = `${y}-${match.md}`
      }
      return { ...f, name, date }
    })
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Give the occasion a name'); return }
    if (!form.date) { toast.error('Pick the date'); return }
    setSaving(true)
    const leadDays = Number(form.lead_days) || 90
    const plan = generateCampaignPlan({ name: form.name.trim(), dateISO: form.date, leadDays }, catalog, inventoryNames)
    // Preserve checklist completion when editing
    if (editing?.plan?.checklist) {
      const doneByText = new Set(editing.plan.checklist.filter(c => c.done).map(c => c.text))
      plan.checklist = plan.checklist.map(c => doneByText.has(c.text) ? { ...c, done: true } : c)
    }
    const rec = {
      name: form.name.trim(),
      occasion_date: form.date,
      emoji: plan.emoji,
      lead_days: leadDays,
      notify_email: form.notify_email || BNJ_EMAIL,
      recurring: true,
      plan,
    }
    if (editing) {
      await patch(editing, rec)
      toast.success('Plan updated')
    } else if (usingLocal) {
      const arr = [...campaigns, { id: 'local-' + Date.now(), created_at: new Date().toISOString(), last_notified_year: null, ...rec }]
      writeLocal(arr); setCampaigns(arr)
      toast.success('Campaign planned!')
    } else {
      const { error } = await supabase.from('campaigns').insert({ ...rec, last_notified_year: null })
      if (error) {
        // Table not there yet → fall back to local so it still works
        setUsingLocal(true)
        const arr = [...readLocal(), { id: 'local-' + Date.now(), created_at: new Date().toISOString(), last_notified_year: null, ...rec }]
        writeLocal(arr); setCampaigns(arr)
        toast.info('Saved locally — run the campaigns table SQL to sync & enable background email')
      } else {
        toast.success('Campaign planned!')
        load()
      }
    }
    setSaving(false)
    setAddModal(false)
  }

  async function regenerate(camp) {
    const plan = generateCampaignPlan({ name: camp.name, dateISO: camp.occasion_date, leadDays: camp.lead_days || 90 }, catalog, inventoryNames)
    const doneByText = new Set((camp.plan?.checklist || []).filter(c => c.done).map(c => c.text))
    plan.checklist = plan.checklist.map(c => doneByText.has(c.text) ? { ...c, done: true } : c)
    await patch(camp, { plan, emoji: plan.emoji })
    toast.success('Plan regenerated from your latest catalog')
  }

  async function remove(camp) {
    if (!window.confirm(`Delete the ${camp.name} plan?`)) return
    if (isLocalRec(camp)) {
      setCampaigns(cs => { const arr = cs.filter(c => c.id !== camp.id); writeLocal(arr); return arr })
    } else {
      await supabase.from('campaigns').delete().eq('id', camp.id)
      setCampaigns(cs => cs.filter(c => c.id !== camp.id))
    }
    toast.success('Deleted')
  }

  async function toggleTask(camp, taskId) {
    const checklist = (camp.plan?.checklist || []).map(c => c.id === taskId ? { ...c, done: !c.done } : c)
    await patch(camp, { plan: { ...camp.plan, checklist } })
  }

  async function emailPlan(camp) {
    const st = campaignStatus(camp.occasion_date, camp.lead_days || 90)
    try {
      await sendEmailJS(camp.notify_email || BNJ_EMAIL, `${camp.emoji || ''} ${camp.name} campaign plan`, buildEmailBody(camp, st, camp.plan))
      toast.success(`Plan emailed to ${camp.notify_email || BNJ_EMAIL}`)
    } catch (e) {
      toast.error('Could not send email')
    }
  }

  // Sort by soonest occurrence
  const sorted = [...campaigns].sort((a, b) => {
    const da = nextOccurrence(a.occasion_date), db = nextOccurrence(b.occasion_date)
    return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity)
  })
  const prepNow = sorted.filter(c => campaignStatus(c.occasion_date, c.lead_days || 90).key === 'prep')

  return (
    <div>
      <PageHeader
        title="Planning"
        subtitle="Plan seasonal sales campaigns — auto-generated, with reminders 3 months ahead"
        action={<Button onClick={openAdd}><Plus size={15} /> Add occasion</Button>}
      />

      {usingLocal && (
        <div style={{ background: '#EAF2FD', border: '1px solid #cfe0f5', borderRadius: 12, padding: '12px 16px', marginBottom: 18, fontSize: 12.5, color: '#2f6fc0', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>Plans are saved in this browser only. Create the <strong>campaigns</strong> table in Supabase to sync across devices and enable automatic background reminder emails.</span>
        </div>
      )}

      {prepNow.length > 0 && (
        <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Sparkles size={16} color="#f57f17" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#854F0B' }}>Time to prepare!</span>
          </div>
          <div style={{ fontSize: 12.5, color: '#a16d0a' }}>
            {prepNow.map(c => {
              const st = campaignStatus(c.occasion_date, c.lead_days || 90)
              return `${c.emoji || ''} ${c.name} in ${st.daysUntil} days`
            }).join('  ·  ')}
          </div>
        </div>
      )}

      {loading ? <Spinner /> : sorted.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '52px 0', color: '#bbb' }}>
            <Sparkles size={34} color="#e0e0e0" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: '#888', marginBottom: 4 }}>No campaigns planned yet</div>
            <div style={{ fontSize: 12.5, marginBottom: 16 }}>Add an occasion like Valentine's Day or Eid — we'll build the whole plan for you.</div>
            <Button onClick={openAdd}><Plus size={14} /> Add your first occasion</Button>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 16 }}>
          {sorted.map(camp => {
            const st = campaignStatus(camp.occasion_date, camp.lead_days || 90)
            const ss = STATUS_STYLE[st.key] || STATUS_STYLE.none
            const prog = checklistProgress(camp.plan)
            return (
              <Card key={camp.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ fontSize: 30, lineHeight: 1, flexShrink: 0 }}>{camp.emoji || '🗓️'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-0.3px' }}>{camp.name}</div>
                    <div style={{ fontSize: 12, color: '#999', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Calendar size={12} /> {fmt(st.occ)}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: ss.fg, background: ss.bg, padding: '3px 9px', borderRadius: 99, whiteSpace: 'nowrap' }}>{st.label}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: '#FFA500', letterSpacing: '-1px' }}>{st.daysUntil}</span>
                  <span style={{ fontSize: 12, color: '#aaa', fontWeight: 600 }}>days to go · prep from {fmt(st.prepDate)}</span>
                </div>

                {/* checklist progress */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#aaa', marginBottom: 4 }}>
                    <span>Checklist</span><span>{prog.done}/{prog.total}</span>
                  </div>
                  <div style={{ height: 7, background: '#f0f0f0', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ width: `${prog.pct}%`, height: '100%', background: prog.pct === 100 ? '#1D9E75' : '#FFA500', transition: 'width 0.3s' }} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={() => setPlanModal(camp)} style={{ flex: 1 }}><Sparkles size={13} /> View plan</Button>
                  <Button size="sm" variant="ghost" onClick={() => emailPlan(camp)} title="Email this plan"><Mail size={13} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(camp)} title="Edit"><Edit2 size={13} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(camp)} title="Delete" style={{ color: '#E24B4A' }}><Trash2 size={13} /></Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add / edit occasion */}
      {addModal && (
        <Modal title={editing ? 'Edit occasion' : 'Add occasion'} subtitle="We'll generate the campaign plan automatically" onClose={() => setAddModal(false)} width={520}>
          <Input label="Occasion name *" value={form.name} onChange={e => onNameChange(e.target.value)} placeholder="e.g. Valentine's Day, Eid, Christmas" list="occasion-suggestions" style={{ marginBottom: 14 }} />
          <datalist id="occasion-suggestions">
            {OCCASION_LIBRARY.map(o => <option key={o.id} value={o.name} />)}
          </datalist>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <Input label="Date *" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            <Input label="Start prep (days before)" type="number" min="1" value={form.lead_days} onChange={e => setForm(f => ({ ...f, lead_days: e.target.value }))} />
          </div>
          <Input label="Notify email" type="email" value={form.notify_email} onChange={e => setForm(f => ({ ...f, notify_email: e.target.value }))} placeholder={BNJ_EMAIL} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 12, color: '#aaa', display: 'flex', gap: 6, alignItems: 'center', marginBottom: 18 }}>
            <RefreshCw size={12} /> Repeats every year — reminders roll forward automatically.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setAddModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Generating…' : editing ? 'Save changes' : 'Generate plan'}</Button>
          </div>
        </Modal>
      )}

      {/* Plan detail */}
      {planModal && (() => {
        const camp = planModal
        const plan = camp.plan || {}
        const st = campaignStatus(camp.occasion_date, camp.lead_days || 90)
        const prog = checklistProgress(plan)
        return (
          <Modal title={`${camp.emoji || ''} ${camp.name}`} subtitle={`${fmt(st.occ)} · ${st.daysUntil} days away · prep from ${fmt(st.prepDate)}`} onClose={() => setPlanModal(null)} width={720}>
            {/* summary */}
            <div style={{ background: '#FFF8E0', border: '1px solid #FAEEDA', borderRadius: 12, padding: '14px 16px', marginBottom: 18, display: 'flex', gap: 10 }}>
              <Bot size={18} color="#FFA500" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, color: '#7a5b13', lineHeight: 1.55 }}>{plan.summary}</div>
            </div>

            <Section icon={Package} title={`Stock up — products you already carry (${(plan.stockUpExisting || []).length})`}>
              {(plan.stockUpExisting || []).length === 0
                ? <Empty text="No matching products in your catalog yet — see suggestions below." />
                : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {plan.stockUpExisting.map((p, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fafafa', border: '1px solid #eee', borderRadius: 99, padding: '5px 11px', fontSize: 12.5, color: '#0d1b2a' }}>
                        {p.name}
                        {p.cost ? <span style={{ color: '#bbb' }}>· MVR {Number(p.cost).toFixed(0)}</span> : null}
                        {!p.inInventory && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#E24B4A', background: '#fef2f2', padding: '1px 6px', borderRadius: 99, textTransform: 'uppercase' }}>not in inventory</span>}
                      </span>
                    ))}
                  </div>}
            </Section>

            <Section icon={ShoppingBag} title="New products to consider bringing">
              <ul style={ulStyle}>{(plan.stockUpNew || []).map((s, i) => <li key={i} style={liStyle}>{s}</li>)}</ul>
            </Section>

            <Section icon={Sparkles} title="Package & bundle ideas">
              <ul style={ulStyle}>{(plan.packages || []).map((s, i) => <li key={i} style={liStyle}>{s}</li>)}</ul>
            </Section>

            <Section icon={Megaphone} title="Marketing & posts to bring in customers">
              <ul style={ulStyle}>{(plan.marketing || []).map((s, i) => <li key={i} style={liStyle}>{s}</li>)}</ul>
            </Section>

            {/* checklist */}
            <div style={{ marginTop: 8, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Checklist · {prog.done}/{prog.total} done</span>
              </div>
              <div style={{ border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
                {(plan.checklist || []).map((c, i) => (
                  <button key={c.id} onClick={() => toggleTask(camp, c.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', padding: '11px 14px', background: c.done ? '#fbfdfb' : '#fff', border: 'none', borderTop: i ? '1px solid #f5f5f5' : 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                    {c.done ? <CheckCircle size={17} color="#1D9E75" style={{ flexShrink: 0 }} /> : <Circle size={17} color="#ccc" style={{ flexShrink: 0 }} />}
                    <span style={{ flex: 1, fontSize: 13, color: c.done ? '#aaa' : '#0d1b2a', textDecoration: c.done ? 'line-through' : 'none' }}>{c.text}</span>
                    <span style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap' }}>by {fmt(c.due)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              <Button variant="ghost" onClick={() => regenerate(camp)} title="Rebuild from your latest catalog"><RefreshCw size={13} /> Regenerate</Button>
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="ghost" onClick={() => emailPlan(camp)}><Mail size={13} /> Email plan</Button>
                <Button onClick={() => setPlanModal(null)}>Done</Button>
              </div>
            </div>
          </Modal>
        )
      })()}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}

const ulStyle = { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }
const liStyle = { fontSize: 13, color: '#444', lineHeight: 1.5 }

function Section({ icon: Icon, title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <Icon size={15} color="#FFA500" />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Empty({ text }) {
  return <div style={{ fontSize: 12.5, color: '#bbb', fontStyle: 'italic' }}>{text}</div>
}
