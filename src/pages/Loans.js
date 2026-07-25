import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localToday } from '../lib/dates'
import { PageHeader, Card, Button, Input, Select, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import {
  Plus, Trash2, Landmark, CreditCard, Paperclip, ChevronDown, ChevronRight,
  Calendar, FileText, X, Edit2, CheckCircle, Clock, AlertTriangle, Percent
} from 'lucide-react'

const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const money = n => `MVR ${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const money0 = n => `MVR ${Math.round(num(n)).toLocaleString('en-US')}`

const RATE_TYPES = [
  { value: 'flat', label: 'Flat rate — profit on the full amount' },
  { value: 'reducing', label: 'Reducing balance — profit on what is left' },
  { value: 'none', label: 'No profit / interest' },
]
const METHODS = ['Bank transfer', 'Cash', 'Cheque', 'Standing order', 'Other']

const EMPTY_LOAN = {
  lender: '', reference: '', amount: '', purpose: '',
  taken_on: localToday(), received_date: localToday(),
  tenure_months: 12, grace_months: 0, profit_rate: '', rate_type: 'flat',
  monthly_payment: '', notes: '', slips: [],
}

// Add whole months to an ISO date, clamping the day so 31 Jan + 1 month lands on
// the last day of February rather than spilling into March.
function addMonths(iso, n) {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d)) return null
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return d.toISOString().slice(0, 10)
}

// What the loan costs in total, and what one month comes to.
export function loanMaths(l) {
  const principal = num(l.amount)
  const months = Math.max(0, parseInt(l.tenure_months) || 0)
  const rate = num(l.profit_rate)
  const type = l.rate_type || 'flat'
  let totalPayable = principal
  if (months > 0 && rate > 0) {
    if (type === 'flat') {
      totalPayable = principal + principal * (rate / 100) * (months / 12)
    } else if (type === 'reducing') {
      const i = rate / 100 / 12
      const inst = i > 0 ? (principal * i) / (1 - Math.pow(1 + i, -months)) : principal / months
      totalPayable = inst * months
    }
  }
  const profit = Math.max(0, totalPayable - principal)
  const suggestedMonthly = months > 0 ? totalPayable / months : 0
  return { principal, months, rate, type, totalPayable, profit, suggestedMonthly }
}

// The monthly instalments, with any recorded payments applied oldest-first.
// A payment can cover several instalments, or only part of one.
function buildSchedule(loan, payments) {
  const { months, totalPayable } = loanMaths(loan)
  const monthly = num(loan.monthly_payment) || (months > 0 ? totalPayable / months : 0)
  const start = loan.received_date || loan.taken_on
  const grace = Math.max(0, parseInt(loan.grace_months) || 0)
  if (!months || !start) return { rows: [], monthly, overpaid: 0 }

  const rows = []
  let allocated = 0
  for (let i = 1; i <= months; i++) {
    // Payments begin the month after the grace period ends
    const due = addMonths(start, grace + i)
    // The last instalment absorbs the rounding so the schedule sums to the total
    const amount = i === months ? Math.max(0, totalPayable - allocated) : monthly
    allocated += amount
    rows.push({ n: i, due, amount, paid: 0, payments: [] })
  }

  const sorted = [...payments].sort((a, b) => (a.paid_on || '').localeCompare(b.paid_on || ''))
  let idx = 0
  let overpaid = 0
  for (const p of sorted) {
    let remaining = num(p.amount)
    while (remaining > 0.005 && idx < rows.length) {
      const inst = rows[idx]
      const need = inst.amount - inst.paid
      const take = Math.min(need, remaining)
      inst.paid += take
      remaining -= take
      inst.payments.push({ ...p, applied: take })
      if (inst.paid >= inst.amount - 0.005) idx++
      else break
    }
    if (remaining > 0.005) overpaid += remaining
  }

  const today = localToday()
  rows.forEach(r => {
    if (r.paid >= r.amount - 0.005) r.status = 'paid'
    else if (r.paid > 0) r.status = 'partial'
    else if (r.due && r.due < today) r.status = 'overdue'
    else r.status = 'upcoming'
  })
  return { rows, monthly, overpaid }
}

const STATUS = {
  paid:     { color: 'green', label: 'Paid', Icon: CheckCircle },
  partial:  { color: 'amber', label: 'Part paid', Icon: Clock },
  overdue:  { color: 'red',   label: 'Overdue', Icon: AlertTriangle },
  upcoming: { color: 'gray',  label: 'Upcoming', Icon: Calendar },
}

// Upload to storage, falling back to an inline data URL when the bucket isn't
// reachable — either way the slip is viewable from the loan.
async function readFiles(fileList) {
  const files = Array.from(fileList || [])
  const out = []
  for (const f of files) {
    const name = `loan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${f.name.split('.').pop()}`
    const { error } = await supabase.storage.from('uploads').upload(name, f, { upsert: true })
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(name)
      out.push({ name: f.name, type: f.type, url: publicUrl })
    } else {
      const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f) })
      if (url) out.push({ name: f.name, type: f.type, url })
    }
  }
  return out
}

// Save, quietly dropping any column the database doesn't have yet.
async function writeStrip(table, payload, where) {
  let body = { ...payload }
  const run = () => (where ? supabase.from(table).update(body).eq('id', where) : supabase.from(table).insert(body))
  let res = await run()
  while (res.error && /column .* does not exist|could not find/i.test(res.error.message || '')) {
    const col = (res.error.message.match(/'([a-z_]+)' column/i) || res.error.message.match(/column "?([a-z_]+)"?/i) || [])[1]
    if (!col || !(col in body)) break
    delete body[col]
    res = await run()
  }
  return res
}

function SlipStrip({ slips = [], onRemove, onView }) {
  if (!slips.length) return null
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {slips.map((s, i) => (
        <div key={i} style={{ position: 'relative', border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', width: 62, height: 62, background: '#faf9f7', cursor: 'pointer' }}
          title={s.name} onClick={() => onView?.(s)}>
          {(s.type || '').startsWith('image/')
            ? <img src={s.url} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 3 }}>
                <FileText size={17} color="#bbb" /><span style={{ fontSize: 8, color: '#bbb' }}>PDF</span>
              </div>}
          {onRemove && (
            <button onClick={e => { e.stopPropagation(); onRemove(i) }}
              style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
              <X size={9} color="#fff" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export default function Loans() {
  const [loans, setLoans] = useState([])
  const [pays, setPays] = useState([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const [loanModal, setLoanModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN)
  const [payModal, setPayModal] = useState(null)     // { loan, instalment? }
  const [payForm, setPayForm] = useState({ amount: '', paid_on: localToday(), method: 'Bank transfer', reference: '', notes: '', slips: [], due_date: null })
  const [viewSlip, setViewSlip] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('loans').select('*').order('taken_on', { ascending: false })
    if (error && /relation|does not exist|schema cache/i.test(error.message)) { setNeedsSetup(true); setLoading(false); return }
    setLoans(data || [])
    const { data: lp } = await supabase.from('loan_payments').select('*')
    setPays(lp || [])
    setLoading(false)
  }

  const rows = useMemo(() => loans.map(l => {
    const mine = pays.filter(p => p.loan_id === l.id)
    const paid = mine.reduce((s, p) => s + num(p.amount), 0)
    const m = loanMaths(l)
    const schedule = buildSchedule(l, mine)
    const profitPaid = mine.reduce((s, p) => s + num(p.profit), 0)
    const overdue = schedule.rows.filter(r => r.status === 'overdue')
    const nextDue = schedule.rows.find(r => r.status !== 'paid')
    return {
      ...l, payments: mine, paid, ...m, schedule,
      remaining: Math.max(0, m.totalPayable - paid),
      progress: m.totalPayable > 0 ? Math.min(100, (paid / m.totalPayable) * 100) : 0,
      profitPaid, overdue, nextDue,
      monthly: num(l.monthly_payment) || m.suggestedMonthly,
      closed: l.status === 'closed' || (m.totalPayable > 0 && paid >= m.totalPayable - 0.5),
    }
  }), [loans, pays])

  const totals = rows.reduce((t, l) => ({
    amount: t.amount + l.principal,
    payable: t.payable + l.totalPayable,
    profit: t.profit + l.profit,
    monthly: t.monthly + (l.closed ? 0 : l.monthly),
    paid: t.paid + l.paid,
    remaining: t.remaining + (l.closed ? 0 : l.remaining),
    overdue: t.overdue + l.overdue.reduce((s, r) => s + (r.amount - r.paid), 0),
  }), { amount: 0, payable: 0, profit: 0, monthly: 0, paid: 0, remaining: 0, overdue: 0 })

  // ── Loan add / edit ─────────────────────────────────────────────────────────
  function openAdd() { setEditing(null); setLoanForm({ ...EMPTY_LOAN }); setLoanModal(true) }
  function openEdit(l) {
    setEditing(l)
    setLoanForm({
      lender: l.lender || '', reference: l.reference || '', amount: l.amount ?? '', purpose: l.purpose || '',
      taken_on: l.taken_on || localToday(), received_date: l.received_date || l.taken_on || localToday(),
      tenure_months: l.tenure_months ?? 12, grace_months: l.grace_months ?? 0,
      profit_rate: l.profit_rate ?? '', rate_type: l.rate_type || 'flat',
      monthly_payment: l.monthly_payment ?? '', notes: l.notes || '',
      slips: Array.isArray(l.slips) ? l.slips : [],
    })
    setLoanModal(true)
  }

  const formMaths = loanMaths(loanForm)

  async function saveLoan() {
    if (!loanForm.amount) { toast.error('Enter the amount'); return }
    setSaving(true)
    const payload = {
      lender: loanForm.lender || null,
      reference: loanForm.reference || null,
      amount: num(loanForm.amount),
      purpose: loanForm.purpose || null,
      taken_on: loanForm.taken_on || null,
      received_date: loanForm.received_date || null,
      tenure_months: parseInt(loanForm.tenure_months) || null,
      grace_months: parseInt(loanForm.grace_months) || 0,
      profit_rate: num(loanForm.profit_rate),
      rate_type: loanForm.rate_type || 'flat',
      total_payable: formMaths.totalPayable,
      monthly_payment: num(loanForm.monthly_payment) || formMaths.suggestedMonthly,
      notes: loanForm.notes || null,
      slips: loanForm.slips || [],
    }
    const { error } = await writeStrip('loans', payload, editing?.id)
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success(editing ? 'Loan updated' : 'Loan added')
    setLoanModal(false)
    load()
  }

  async function delLoan(l) {
    if (!window.confirm(`Delete "${l.purpose || l.lender || 'loan'}" and every payment recorded against it?`)) return
    await supabase.from('loan_payments').delete().eq('loan_id', l.id)
    await supabase.from('loans').delete().eq('id', l.id)
    toast.success('Deleted'); load()
  }

  async function toggleClosed(l) {
    const next = l.status === 'closed' ? 'active' : 'closed'
    await writeStrip('loans', { status: next }, l.id)
    toast.success(next === 'closed' ? 'Marked as settled' : 'Reopened')
    load()
  }

  // ── Payments ────────────────────────────────────────────────────────────────
  function openPay(loan, instalment) {
    // Split the payment into profit and principal using the loan's own ratio, so
    // accounting can tell the finance cost apart from paying the money back.
    setPayForm({
      amount: instalment ? (instalment.amount - instalment.paid).toFixed(2) : (loan.monthly || '').toString(),
      paid_on: localToday(), method: 'Bank transfer', reference: '', notes: '', slips: [],
      due_date: instalment?.due || null,
    })
    setPayModal({ loan, instalment })
  }

  async function savePayment() {
    if (!payForm.amount) { toast.error('Enter the amount'); return }
    const loan = payModal.loan
    const amount = num(payForm.amount)
    const profitShare = loan.totalPayable > 0 ? loan.profit / loan.totalPayable : 0
    setSaving(true)
    const { error } = await writeStrip('loan_payments', {
      loan_id: loan.id,
      amount,
      profit: +(amount * profitShare).toFixed(2),
      principal: +(amount * (1 - profitShare)).toFixed(2),
      paid_on: payForm.paid_on,
      due_date: payForm.due_date,
      method: payForm.method,
      reference: payForm.reference || null,
      notes: payForm.notes || null,
      slips: payForm.slips || [],
    })
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Payment recorded'); setPayModal(null); load()
  }

  async function delPayment(p) {
    if (!window.confirm(`Delete the ${money(p.amount)} payment from ${p.paid_on}?`)) return
    await supabase.from('loan_payments').delete().eq('id', p.id)
    toast.success('Payment deleted'); load()
  }

  async function attach(target, fileList) {
    if (!fileList?.length) return
    setUploading(true)
    const files = await readFiles(fileList)
    setUploading(false)
    if (!files.length) { toast.error('Could not read the file'); return }
    if (target === 'loan') setLoanForm(f => ({ ...f, slips: [...(f.slips || []), ...files] }))
    else setPayForm(f => ({ ...f, slips: [...(f.slips || []), ...files] }))
  }

  const toggleExpand = id => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div>
      <style>{`
        table.ln { width:100%; border-collapse:collapse; font-size:12.5px; min-width:640px; }
        .ln th { text-align:right; font-size:10px; font-weight:700; color:#aaa; text-transform:uppercase; letter-spacing:0.4px; padding:8px 10px; border-bottom:1px solid #f0f0f0; white-space:nowrap; }
        .ln th:first-child, .ln td:first-child { text-align:left; }
        .ln td { padding:9px 10px; border-bottom:1px solid #f7f7f7; text-align:right; white-space:nowrap; }
        .ln tr.od td { background:#fffaf9; }
      `}</style>
      <PageHeader title="Loans" subtitle="Tenure, grace period, monthly payments and slips — all feeding the accounts"
        action={<Button onClick={openAdd} disabled={needsSetup}><Plus size={15} /> Add loan</Button>} />

      {/* summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 22 }} className="grid-collapse">
        {[
          ['Borrowed', money0(totals.amount), '#2f6fc0', '#EAF2FD', `${rows.length} loan${rows.length === 1 ? '' : 's'}`],
          ['Total payable', money0(totals.payable), '#7F77DD', '#EFEDFB', `incl. ${money0(totals.profit)} profit`],
          ['Paid so far', money0(totals.paid), '#1D9E75', '#E9F7F1', null],
          ['Outstanding', money0(totals.remaining), '#E24B4A', '#FDECEC', totals.overdue > 0 ? `${money0(totals.overdue)} overdue` : null],
          ['Monthly commitment', money0(totals.monthly), '#b8740a', '#FFF6E2', 'across active loans'],
        ].map(([label, value, color, bg, sub]) => (
          <div key={label} style={{ background: bg, borderRadius: 14, padding: '15px 17px' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color, letterSpacing: '-0.5px' }}>{value}</div>
            <div style={{ fontSize: 11.5, color: '#888', fontWeight: 600, marginTop: 3 }}>{label}</div>
            {sub && <div style={{ fontSize: 10.5, color: '#aaa', marginTop: 2 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {needsSetup ? (
        <Card><p style={{ color: '#667', fontSize: 14, lineHeight: 1.6 }}>The loans tables aren't set up yet in your database. If this persists, let me know and I'll create them.</p></Card>
      ) : loading ? <Spinner /> : rows.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '46px 20px', color: '#bbb' }}>
          <Landmark size={34} color="#e0d8c8" style={{ marginBottom: 10 }} />
          <div style={{ fontWeight: 600, color: '#999' }}>No loans yet. Add one to track it.</div>
        </Card>
      ) : rows.map(l => {
        const isOpen = expanded.has(l.id)
        return (
          <Card key={l.id} style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
            {/* header */}
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
                <button onClick={() => toggleExpand(l.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, marginTop: 1 }}>
                  {isOpen ? <ChevronDown size={17} color="#bbb" /> : <ChevronRight size={17} color="#bbb" />}
                </button>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: '#0d1b2a' }}>{l.lender || 'Lender not set'}</span>
                    {l.closed ? <Badge color="green">Settled</Badge>
                      : l.overdue.length > 0 ? <Badge color="red">{l.overdue.length} overdue</Badge>
                        : <Badge color="blue">Active</Badge>}
                    {l.rate > 0 && <Badge color="purple">{l.rate}% {l.type === 'reducing' ? 'reducing' : 'flat'}</Badge>}
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 3 }}>
                    {[l.purpose, l.reference && `Ref ${l.reference}`].filter(Boolean).join(' · ') || 'No purpose recorded'}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#bbb', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {l.received_date && <span>Received {l.received_date}</span>}
                    {l.months > 0 && <span>{l.months} months</span>}
                    {num(l.grace_months) > 0 && <span>{l.grace_months}-month grace</span>}
                    {l.nextDue && !l.closed && <span style={{ color: l.nextDue.status === 'overdue' ? '#E24B4A' : '#bbb', fontWeight: l.nextDue.status === 'overdue' ? 700 : 400 }}>
                      Next {money0(l.nextDue.amount - l.nextDue.paid)} due {l.nextDue.due}
                    </span>}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                {[
                  ['Borrowed', money0(l.principal), '#0d1b2a'],
                  ['Payable', money0(l.totalPayable), '#7F77DD'],
                  ['Monthly', money0(l.monthly), '#b8740a'],
                  ['Paid', money0(l.paid), '#1D9E75'],
                  ['Left', money0(l.remaining), l.remaining > 0 ? '#E24B4A' : '#1D9E75'],
                ].map(([lab, v, c]) => (
                  <div key={lab} style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9.5, color: '#c4bcb0', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700 }}>{lab}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: c, marginTop: 1 }}>{v}</div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 5 }}>
                  {!l.closed && <Button size="sm" onClick={() => openPay(l, l.nextDue)}><CreditCard size={13} /> Pay</Button>}
                  <Button size="sm" variant="ghost" onClick={() => openEdit(l)} title="Edit loan"><Edit2 size={13} /></Button>
                  <Button size="sm" variant="danger" onClick={() => delLoan(l)} title="Delete loan"><Trash2 size={13} /></Button>
                </div>
              </div>
            </div>

            {/* progress */}
            <div style={{ padding: '0 20px 16px' }}>
              <div style={{ height: 7, background: '#f2f0ec', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${l.progress}%`, height: '100%', background: l.progress >= 100 ? '#1D9E75' : 'linear-gradient(90deg,#FFA500,#ff8c00)', borderRadius: 99, transition: 'width .3s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#bbb', marginTop: 5 }}>
                <span>{l.progress.toFixed(0)}% repaid · {l.schedule.rows.filter(r => r.status === 'paid').length}/{l.schedule.rows.length} instalments</span>
                {l.profit > 0 && <span>Profit cost {money0(l.profit)} · {money0(l.profitPaid)} paid</span>}
              </div>
            </div>

            {/* schedule */}
            {isOpen && (
              <div style={{ borderTop: '1px solid #f2f2f2', background: '#fcfbf9', padding: '14px 20px 18px' }}>
                {Array.isArray(l.slips) && l.slips.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Loan documents</div>
                    <SlipStrip slips={l.slips} onView={setViewSlip} />
                  </div>
                )}
                {l.notes && <div style={{ fontSize: 12.5, color: '#888', marginBottom: 14, lineHeight: 1.6 }}>{l.notes}</div>}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0d1b2a' }}>Monthly schedule</div>
                  <Button size="sm" variant="ghost" onClick={() => toggleClosed(l)}>
                    {l.status === 'closed' ? 'Reopen loan' : 'Mark as settled'}
                  </Button>
                </div>

                {l.schedule.rows.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: '#bbb', padding: '10px 0' }}>
                    Set a tenure and a received date on this loan to see the monthly schedule.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="ln">
                      <thead><tr><th>#</th><th>Due date</th><th>Amount due</th><th>Paid</th><th>Status</th><th>Paid on</th><th>Slip</th><th></th></tr></thead>
                      <tbody>
                        {l.schedule.rows.map(r => {
                          const st = STATUS[r.status]
                          const slips = r.payments.flatMap(p => (Array.isArray(p.slips) ? p.slips : []))
                          return (
                            <tr key={r.n} className={r.status === 'overdue' ? 'od' : ''}>
                              <td style={{ color: '#bbb', fontWeight: 700 }}>{r.n}</td>
                              <td style={{ textAlign: 'right' }}>{r.due}</td>
                              <td>{money(r.amount)}</td>
                              <td style={{ color: r.paid > 0 ? '#1D9E75' : '#ccc' }}>{r.paid > 0 ? money(r.paid) : '—'}</td>
                              <td><Badge color={st.color}>{st.label}</Badge></td>
                              <td style={{ color: '#999' }}>{r.payments.map(p => p.paid_on).filter(Boolean).join(', ') || '—'}</td>
                              <td>
                                {slips.length > 0
                                  ? <button onClick={() => setViewSlip(slips[0])} title={`${slips.length} slip${slips.length > 1 ? 's' : ''}`}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#378ADD', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontFamily: 'inherit' }}>
                                      <Paperclip size={12} /> {slips.length}
                                    </button>
                                  : <span style={{ color: '#ddd' }}>—</span>}
                              </td>
                              <td>
                                {r.status !== 'paid' && !l.closed && (
                                  <Button size="sm" variant="ghost" onClick={() => openPay(l, r)}>Pay</Button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* what was actually paid, so a slip can be found or a mistake undone */}
                {l.payments.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0d1b2a', marginBottom: 8 }}>Payments recorded ({l.payments.length})</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {[...l.payments].sort((a, b) => (b.paid_on || '').localeCompare(a.paid_on || '')).map(p => (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #f0f0f0', borderRadius: 9, padding: '9px 12px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: '#1D9E75' }}>{money(p.amount)}</span>
                          <span style={{ fontSize: 12, color: '#999' }}>{p.paid_on}</span>
                          {p.method && <span style={{ fontSize: 11.5, color: '#bbb' }}>{p.method}</span>}
                          {p.reference && <span style={{ fontSize: 11.5, color: '#bbb' }}>Ref {p.reference}</span>}
                          {num(p.profit) > 0 && <span style={{ fontSize: 11, color: '#7F77DD' }}>{money0(p.principal)} principal + {money0(p.profit)} profit</span>}
                          {p.notes && <span style={{ fontSize: 11.5, color: '#bbb', fontStyle: 'italic' }}>{p.notes}</span>}
                          {Array.isArray(p.slips) && p.slips.length > 0 && (
                            <button onClick={() => setViewSlip(p.slips[0])}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#378ADD', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontFamily: 'inherit' }}>
                              <Paperclip size={12} /> View slip
                            </button>
                          )}
                          <button onClick={() => delPayment(p)} title="Delete payment"
                            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 3, display: 'flex' }}>
                            <Trash2 size={13} color="#d5cfc6" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        )
      })}

      {/* ── Add / edit loan ── */}
      {loanModal && (
        <Modal title={editing ? 'Edit loan' : 'Add a loan'} subtitle="Who lent it, for how long, and what it costs" onClose={() => setLoanModal(false)} width={640}>
          <FormRow>
            <Input label="Who lent it *" value={loanForm.lender} onChange={e => setLoanForm(f => ({ ...f, lender: e.target.value }))} placeholder="e.g. BML, MIB, family" />
            <Input label="Loan / account number" value={loanForm.reference} onChange={e => setLoanForm(f => ({ ...f, reference: e.target.value }))} placeholder="optional" />
          </FormRow>
          <FormRow>
            <Input label="Amount (MVR) *" type="number" value={loanForm.amount} onChange={e => setLoanForm(f => ({ ...f, amount: e.target.value }))} />
            <Input label="Received date" type="date" value={loanForm.received_date} onChange={e => setLoanForm(f => ({ ...f, received_date: e.target.value }))} />
          </FormRow>
          <FormRow>
            <Input label="Tenure (months)" type="number" value={loanForm.tenure_months} onChange={e => setLoanForm(f => ({ ...f, tenure_months: e.target.value }))} />
            <Input label="Grace period (months)" type="number" value={loanForm.grace_months} onChange={e => setLoanForm(f => ({ ...f, grace_months: e.target.value }))} />
          </FormRow>
          <FormRow>
            <Input label="Profit / interest rate (% a year)" type="number" value={loanForm.profit_rate} onChange={e => setLoanForm(f => ({ ...f, profit_rate: e.target.value }))} placeholder="0" />
            <Select label="How the rate works" value={loanForm.rate_type} options={RATE_TYPES}
              onChange={e => setLoanForm(f => ({ ...f, rate_type: e.target.value }))} />
          </FormRow>

          {/* live working-out so the numbers are obvious before saving */}
          <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 15px', margin: '4px 0 14px', fontSize: 12.5, color: '#666', lineHeight: 1.7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total payable</span><b style={{ color: '#0d1b2a' }}>{money(formMaths.totalPayable)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Profit / interest cost</span><b style={{ color: '#7F77DD' }}>{money(formMaths.profit)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Suggested monthly</span><b style={{ color: '#b8740a' }}>{money(formMaths.suggestedMonthly)}</b></div>
            {loanForm.received_date && parseInt(loanForm.tenure_months) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#999' }}>
                <span>First payment due</span><span>{addMonths(loanForm.received_date, (parseInt(loanForm.grace_months) || 0) + 1)}</span>
              </div>
            )}
          </div>

          <FormRow>
            <Input label="Monthly payment (MVR)" type="number" value={loanForm.monthly_payment}
              placeholder={formMaths.suggestedMonthly ? formMaths.suggestedMonthly.toFixed(2) : ''}
              onChange={e => setLoanForm(f => ({ ...f, monthly_payment: e.target.value }))} />
            <Input label="Agreement date" type="date" value={loanForm.taken_on} onChange={e => setLoanForm(f => ({ ...f, taken_on: e.target.value }))} />
          </FormRow>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>What did you use it for?</label>
            <textarea value={loanForm.purpose} onChange={e => setLoanForm(f => ({ ...f, purpose: e.target.value }))} rows={2} placeholder="e.g. Stock purchase for Eid, new shelves"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
          <Input label="Notes" value={loanForm.notes} onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))} style={{ marginBottom: 14 }} />

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Loan documents</label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1px dashed #ddd', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, color: '#888' }}>
              <Paperclip size={13} /> {uploading ? 'Uploading…' : 'Attach agreement / offer letter'}
              <input type="file" accept="image/*,application/pdf" multiple onChange={e => { attach('loan', e.target.files); e.target.value = '' }} style={{ display: 'none' }} />
            </label>
            <SlipStrip slips={loanForm.slips} onView={setViewSlip} onRemove={i => setLoanForm(f => ({ ...f, slips: f.slips.filter((_, x) => x !== i) }))} />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setLoanModal(false)}>Cancel</Button>
            <Button onClick={saveLoan} disabled={saving || !loanForm.amount}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add loan'}</Button>
          </div>
        </Modal>
      )}

      {/* ── Record a payment ── */}
      {payModal && (
        <Modal title="Record a payment"
          subtitle={payModal.instalment
            ? `Instalment ${payModal.instalment.n} · due ${payModal.instalment.due} · ${payModal.loan.lender || 'loan'}`
            : (payModal.loan.purpose || payModal.loan.lender || 'Loan repayment')}
          onClose={() => setPayModal(null)}>
          <FormRow>
            <Input label="Amount (MVR) *" type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            <Input label="Paid on" type="date" value={payForm.paid_on} onChange={e => setPayForm(f => ({ ...f, paid_on: e.target.value }))} />
          </FormRow>
          <FormRow>
            <Select label="Method" value={payForm.method} options={METHODS} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))} />
            <Input label="Reference" value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} placeholder="transaction no." />
          </FormRow>
          <Input label="Note (optional)" value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} style={{ marginBottom: 14 }} />

          {payModal.loan.profit > 0 && (
            <div style={{ background: '#f8f7f4', borderRadius: 9, padding: '10px 13px', marginBottom: 14, fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Percent size={13} color="#7F77DD" />
              Split as {money(num(payForm.amount) * (1 - payModal.loan.profit / payModal.loan.totalPayable))} principal
              + {money(num(payForm.amount) * (payModal.loan.profit / payModal.loan.totalPayable))} profit — the profit half counts as a finance cost in the accounts.
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Payment slip</label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1px dashed #ddd', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, color: '#888' }}>
              <Paperclip size={13} /> {uploading ? 'Uploading…' : 'Attach slip / receipt'}
              <input type="file" accept="image/*,application/pdf" multiple onChange={e => { attach('pay', e.target.files); e.target.value = '' }} style={{ display: 'none' }} />
            </label>
            <SlipStrip slips={payForm.slips} onView={setViewSlip} onRemove={i => setPayForm(f => ({ ...f, slips: f.slips.filter((_, x) => x !== i) }))} />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setPayModal(null)}>Cancel</Button>
            <Button onClick={savePayment} disabled={saving || !payForm.amount}>{saving ? 'Saving…' : 'Record payment'}</Button>
          </div>
        </Modal>
      )}

      {/* slip lightbox */}
      {viewSlip && (
        <div onClick={() => setViewSlip(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(13,27,42,0.82)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {(viewSlip.type || '').startsWith('image/')
            ? <img src={viewSlip.url} alt={viewSlip.name} style={{ maxWidth: '92%', maxHeight: '92%', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} />
            : <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 26, textAlign: 'center' }}>
                <FileText size={34} color="#bbb" style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{viewSlip.name}</div>
                <a href={viewSlip.url} target="_blank" rel="noreferrer" style={{ color: '#FFA500', fontWeight: 700, fontSize: 13 }}>Open document</a>
              </div>}
        </div>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
