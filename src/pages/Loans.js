import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localToday } from '../lib/dates'
import { readSlip } from '../lib/slipOcr'
import { PageHeader, Card, Button, Input, Select, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import {
  Plus, Trash2, Landmark, CreditCard, Paperclip, ChevronDown, ChevronRight,
  Calendar, FileText, X, Edit2, AlertTriangle, Percent, Wallet, Scale, Eye, ScanLine
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
const LENDER_TYPES = ['Family', 'Friend', 'Bank', 'Investor', 'Business', 'Other']
const EMPTY_LENDER = { name: '', type: 'Family', amount: '', phone: '' }
const PAYMENT_DAY = 28          // payments go out on the 28th
const RECONCILE_DAY = 29        // and are checked the next morning

const EMPTY_LOAN = {
  lender: '', lenders: [{ ...EMPTY_LENDER }], reference: '', amount: '', purpose: '',
  taken_on: localToday(), received_date: localToday(),
  tenure_months: 12, grace_months: 0, profit_rate: '', rate_type: 'flat',
  monthly_auto: true, monthly_payment: '', payment_day: PAYMENT_DAY,
  notes: '', slips: [], received_slips: [],
}

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// The nth instalment falls on the payment day of the month that many months
// after the grace period ends — so a loan received on the 23rd with no grace
// has its first payment on the 28th of the following month.
function dueDateFor(startISO, graceMonths, n, day) {
  if (!startISO) return null
  const d = new Date(startISO + 'T00:00:00')
  if (isNaN(d)) return null
  const base = new Date(d.getFullYear(), d.getMonth() + (graceMonths || 0) + n, 1)
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
  base.setDate(Math.min(day || PAYMENT_DAY, lastDay))
  return iso(base)
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

// ── The monthly schedule ──────────────────────────────────────────────────────
// Each month's figure is what is still owed spread over the months left to run,
// so paying extra one month lowers every month after it, and paying short
// raises them. Payments belong to the month they were made in — a payment made
// on the 30th still counts for that month's 28th.
function buildSchedule(loan, payments) {
  const { months, totalPayable } = loanMaths(loan)
  const start = loan.received_date || loan.taken_on
  const grace = Math.max(0, parseInt(loan.grace_months) || 0)
  const day = parseInt(loan.payment_day) || PAYMENT_DAY
  if (!months || !start) return { rows: [], monthly: 0, extraPaid: 0 }

  const dues = []
  for (let i = 1; i <= months; i++) dues.push(dueDateFor(start, grace, i, day))

  const sorted = [...payments].sort((a, b) => (a.paid_on || '').localeCompare(b.paid_on || ''))
  const today = localToday()
  // Whether the loan is actually cleared — judged on money really paid, not on
  // the projected balance, which always winds down to zero on the last row.
  const totalPaid = payments.reduce((s, p) => s + num(p.amount), 0)
  const settled = totalPayable > 0 && totalPaid >= totalPayable - 0.005
  const rows = []
  let balance = totalPayable
  let idx = 0

  for (let i = 0; i < months; i++) {
    const monthsLeft = months - i
    const due = Math.max(0, balance / monthsLeft)
    // Everything paid before the next instalment falls due belongs to this month
    const cutoff = dues[i + 1] || '9999-12-31'
    const mine = []
    while (idx < sorted.length && (sorted[idx].paid_on || '9999-12-31') < cutoff) { mine.push(sorted[idx]); idx++ }
    const paid = mine.reduce((s, p) => s + num(p.amount), 0)
    const openingBalance = balance
    // A month that hasn't fallen due yet is assumed to be paid in full, so the
    // schedule stays flat at total ÷ tenure until something actually changes.
    // Pay extra and the balance drops further, lowering every month after it;
    // miss a month that has already fallen due and the shortfall stays owed,
    // raising the months that follow.
    const notYetDue = !dues[i] || dues[i] >= today
    const consumed = notYetDue ? Math.max(paid, due) : paid
    balance = Math.max(0, balance - consumed)

    let status
    if (settled) status = 'paid'
    else if (due > 0 && paid >= due - 0.005) status = 'paid'
    else if (paid > 0) status = 'partial'
    else if (dues[i] && dues[i] < today) status = 'overdue'
    else status = 'upcoming'

    rows.push({
      n: i + 1, due: dues[i], amount: due, paid, payments: mine, status,
      openingBalance, closingBalance: balance,
      // How much of this month's payment went beyond what was asked for
      extra: Math.max(0, paid - due),
    })
  }

  // Anything still sitting in `balance` after the last month is arrears
  const nextMonthly = rows.find(r => r.status === 'upcoming' || r.status === 'overdue')?.amount || 0
  return { rows, monthly: nextMonthly, remainingBalance: balance }
}

const STATUS = {
  paid:     { color: 'green', label: 'Paid' },
  partial:  { color: 'amber', label: 'Part paid' },
  overdue:  { color: 'red',   label: 'Overdue' },
  upcoming: { color: 'gray',  label: 'Upcoming' },
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
  const dropped = []
  const run = () => (where ? supabase.from(table).update(body).eq('id', where) : supabase.from(table).insert(body))
  let res = await run()
  while (res.error && /column .* does not exist|could not find/i.test(res.error.message || '')) {
    const col = (res.error.message.match(/'([a-z_]+)' column/i) || res.error.message.match(/column "?([a-z_]+)"?/i) || [])[1]
    if (!col || !(col in body)) break
    dropped.push(col)
    delete body[col]
    res = await run()
  }
  return { ...res, dropped }
}

function Slips({ slips = [], onRemove, onView, size = 62 }) {
  if (!slips.length) return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {slips.map((s, i) => (
        <div key={i} style={{ position: 'relative', border: '1px solid #eee', borderRadius: 7, overflow: 'hidden', width: size, height: size, background: '#faf9f7', cursor: 'pointer', flexShrink: 0 }}
          title={s.name} onClick={() => onView?.(s)}>
          {(s.type || '').startsWith('image/')
            ? <img src={s.url} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
                <FileText size={size > 45 ? 17 : 13} color="#bbb" /><span style={{ fontSize: 8, color: '#bbb' }}>PDF</span>
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

// Shows what the slip reader made out, and lets a bad read be undone whole
function OcrNote({ ocr, onUndo, onDismiss }) {
  if (!ocr) return null
  if (ocr.busy) {
    return (
      <div style={{ background: '#f8f7f4', border: '1px solid #eee', borderRadius: 9, padding: '10px 13px', marginBottom: 14, fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 9 }}>
        <ScanLine size={14} color="#FFA500" />
        Reading the slip… {ocr.progress ? `${Math.round(ocr.progress * 100)}%` : ''}
      </div>
    )
  }
  const f = ocr.found || {}
  const bits = [
    f.amount != null && ['Amount', money(f.amount)],
    f.date && ['Date', f.date],
    f.reference && ['Reference', f.reference],
    f.account && ['Account', f.account],
  ].filter(Boolean)
  if (!bits.length) return null
  return (
    <div style={{ background: '#f2faf5', border: '1px solid #cfe8db', borderRadius: 9, padding: '11px 13px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ScanLine size={14} color="#1D9E75" />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#2c7a54' }}>Filled in from the slip — check it</span>
        <button onClick={onUndo} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 11.5, fontFamily: 'inherit', textDecoration: 'underline' }}>Undo</button>
        <button onClick={onDismiss} title="Looks right" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}><X size={13} color="#bbb" /></button>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 7 }}>
        {bits.map(([k, v]) => (
          <span key={k} style={{ fontSize: 11.5, color: '#4a6b59' }}>
            <span style={{ color: '#8fae9e' }}>{k}</span> <b>{v}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

function Attach({ label, slips, onAdd, onRemove, onView, uploading }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>{label}</label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1px dashed #ddd', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, color: '#888' }}>
        <Paperclip size={13} /> {uploading ? 'Uploading…' : 'Attach file'}
        <input type="file" accept="image/*,application/pdf" multiple onChange={e => { onAdd(e.target.files); e.target.value = '' }} style={{ display: 'none' }} />
      </label>
      <div style={{ marginTop: 8 }}><Slips slips={slips} onRemove={onRemove} onView={onView} /></div>
    </div>
  )
}

export default function Loans() {
  const [loans, setLoans] = useState([])
  const [pays, setPays] = useState([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [missingCols, setMissingCols] = useState([])
  const [expanded, setExpanded] = useState(() => new Set())
  const [loanModal, setLoanModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN)
  const [payModal, setPayModal] = useState(null)
  const [detail, setDetail] = useState(null)     // { loan, inst } — that month's payments
  const [payForm, setPayForm] = useState({ amount: '', paid_on: localToday(), paid_time: '', method: 'Bank transfer', account: '', reference: '', notes: '', slips: [], due_date: null })
  const [viewSlip, setViewSlip] = useState(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [ocr, setOcr] = useState(null)   // { busy, progress, found, before, target }
  const toast = useToast()

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('loans').select('*').order('taken_on', { ascending: false })
    if (error && /relation|does not exist|schema cache/i.test(error.message)) { setNeedsSetup(true); setLoading(false); return }
    const rows = data || []
    setLoans(rows)
    // Tell the owner plainly when the newer columns haven't been added yet,
    // rather than silently showing an empty schedule.
    const sample = rows[0]
    if (sample) {
      const need = ['tenure_months', 'received_date', 'grace_months', 'profit_rate', 'slips', 'received_slips', 'payment_day', 'lenders']
      setMissingCols(need.filter(c => !(c in sample)))
    }
    const { data: lp } = await supabase.from('loan_payments').select('*')
    setPays(lp || [])
    setLoading(false)
  }

  // Accounts already used, so the next payment can be picked from a list
  const knownAccounts = useMemo(
    () => [...new Set(pays.map(p => (p.account || '').trim()).filter(Boolean))].sort(),
    [pays]
  )

  const rows = useMemo(() => loans.map(l => {
    const mine = pays.filter(p => p.loan_id === l.id)
    const paid = mine.reduce((s, p) => s + num(p.amount), 0)
    const m = loanMaths(l)
    const schedule = buildSchedule(l, mine)
    const profitPaid = mine.reduce((s, p) => s + num(p.profit), 0)
    const overdue = schedule.rows.filter(r => r.status === 'overdue')
    const nextDue = schedule.rows.find(r => r.status !== 'paid')
    // Older loans kept a single name in `lender`; show it the same way
    const lenderList = Array.isArray(l.lenders) && l.lenders.length
      ? l.lenders
      : (l.lender ? [{ name: l.lender, type: 'Bank', amount: num(l.amount), phone: '' }] : [])
    return {
      ...l, lenderList, payments: mine, paid, ...m, schedule,
      remaining: Math.max(0, m.totalPayable - paid),
      progress: m.totalPayable > 0 ? Math.min(100, (paid / m.totalPayable) * 100) : 0,
      profitPaid, overdue, nextDue,
      // What the next month actually comes to after any over/under payment
      monthly: schedule.monthly || num(l.monthly_payment) || m.suggestedMonthly,
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
    overdue: t.overdue + l.overdue.reduce((s, r) => s + Math.max(0, r.amount - r.paid), 0),
  }), { amount: 0, payable: 0, profit: 0, monthly: 0, paid: 0, remaining: 0, overdue: 0 })

  // ── Reconciliation (the 29th) ───────────────────────────────────────────────
  const today = localToday()
  const dayOfMonth = parseInt(today.slice(8, 10), 10)
  const dueThisCycle = rows.flatMap(l => l.closed ? [] : l.schedule.rows
    .filter(r => r.due && r.due.slice(0, 7) === today.slice(0, 7) && r.status !== 'paid')
    .map(r => ({ loan: l, inst: r })))
  const reconcileTime = dayOfMonth >= RECONCILE_DAY

  // ── Loan add / edit ─────────────────────────────────────────────────────────
  // Short, sequential loan number — L-01, L-02 … — so you never have to invent one.
  function nextLoanNo() {
    let max = 0
    loans.forEach(l => { const m = /^L-(\d+)$/.exec((l.reference || '').trim()); if (m) max = Math.max(max, parseInt(m[1], 10)) })
    return `L-${String(max + 1).padStart(2, '0')}`
  }

  function openAdd() {
    setEditing(null)
    setLoanForm({ ...EMPTY_LOAN, lenders: [{ ...EMPTY_LENDER }], reference: nextLoanNo() })
    setLoanModal(true)
  }
  function openEdit(l) {
    setEditing(l)
    setLoanForm({
      lender: l.lender || '',
      // Older loans stored one lender as plain text — show it as a single row
      lenders: Array.isArray(l.lenders) && l.lenders.length
        ? l.lenders
        : [{ ...EMPTY_LENDER, name: l.lender || '', type: 'Bank', amount: l.amount ?? '' }],
      reference: l.reference || '', amount: l.amount ?? '', purpose: l.purpose || '',
      taken_on: l.taken_on || localToday(), received_date: l.received_date || l.taken_on || localToday(),
      tenure_months: l.tenure_months ?? 12, grace_months: l.grace_months ?? 0,
      profit_rate: l.profit_rate ?? '', rate_type: l.rate_type || 'flat',
      monthly_auto: l.monthly_auto !== false,
      monthly_payment: l.monthly_payment ?? '', payment_day: l.payment_day ?? PAYMENT_DAY,
      notes: l.notes || '',
      slips: Array.isArray(l.slips) ? l.slips : [],
      received_slips: Array.isArray(l.received_slips) ? l.received_slips : [],
    })
    setLoanModal(true)
  }

  // ── Lender rows ─────────────────────────────────────────────────────────────
  const formLenders = loanForm.lenders || []
  const setLenders = next => setLoanForm(f => ({ ...f, lenders: next }))
  const addLender = () => setLenders([...formLenders, { ...EMPTY_LENDER }])
  const updateLender = (i, key, value) => setLenders(formLenders.map((x, n) => (n === i ? { ...x, [key]: value } : x)))
  const removeLender = i => setLenders(formLenders.length > 1 ? formLenders.filter((_, n) => n !== i) : [{ ...EMPTY_LENDER }])
  const lendersTotal = formLenders.reduce((s, x) => s + num(x.amount), 0)
  const namedLenders = formLenders.filter(x => (x.name || '').trim())

  const formMaths = loanMaths(loanForm)
  // Auto mode keeps the monthly figure in step with amount, months and rate;
  // manual mode leaves whatever was typed alone.
  const effectiveMonthly = loanForm.monthly_auto ? formMaths.suggestedMonthly : num(loanForm.monthly_payment)

  async function saveLoan() {
    if (!loanForm.amount) { toast.error('Enter the amount'); return }
    setSaving(true)
    const cleanLenders = namedLenders.map(x => ({
      name: x.name.trim(), type: x.type || 'Other',
      amount: num(x.amount), phone: (x.phone || '').trim(),
    }))
    const payload = {
      lenders: cleanLenders,
      // Keep the plain-text name in step — every report and the ledger read it
      lender: cleanLenders.map(x => x.name).join(', ') || null,
      reference: loanForm.reference?.trim() || nextLoanNo(),
      amount: num(loanForm.amount),
      purpose: loanForm.purpose || null,
      taken_on: loanForm.taken_on || null,
      received_date: loanForm.received_date || null,
      tenure_months: parseInt(loanForm.tenure_months) || null,
      grace_months: parseInt(loanForm.grace_months) || 0,
      profit_rate: num(loanForm.profit_rate),
      rate_type: loanForm.rate_type || 'flat',
      total_payable: formMaths.totalPayable,
      monthly_auto: !!loanForm.monthly_auto,
      monthly_payment: effectiveMonthly,
      payment_day: parseInt(loanForm.payment_day) || PAYMENT_DAY,
      notes: loanForm.notes || null,
      slips: loanForm.slips || [],
      received_slips: loanForm.received_slips || [],
    }
    const { error, dropped } = await writeStrip('loans', payload, editing?.id)
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    if (dropped?.length) toast.error(`Saved, but your database is missing: ${dropped.join(', ')} — run the loans SQL`)
    else toast.success(editing ? 'Loan updated' : 'Loan added')
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
    setPayForm({
      amount: instalment ? Math.max(0, instalment.amount - instalment.paid).toFixed(2) : (loan.monthly || 0).toFixed(2),
      paid_on: localToday(), paid_time: '', method: 'Bank transfer',
      account: knownAccounts[0] || '', reference: '', notes: '', slips: [],
      due_date: instalment?.due || null,
    })
    setPayModal({ loan, instalment })
  }

  // Reopen an existing payment with its details so it can be corrected
  function editPayment(loan, instalment, p) {
    setPayForm({
      amount: num(p.amount), paid_on: p.paid_on || localToday(), paid_time: p.paid_time || '',
      method: p.method || 'Bank transfer', account: p.account || '',
      reference: p.reference || '', notes: p.notes || '',
      slips: Array.isArray(p.slips) ? p.slips : [], due_date: p.due_date || instalment?.due || null,
    })
    setDetail(null)
    setPayModal({ loan, instalment, payment: p })
  }

  async function savePayment() {
    if (!payForm.amount) { toast.error('Enter the amount'); return }
    const loan = payModal.loan
    const amount = num(payForm.amount)
    // Split by the loan's own profit ratio so accounting can tell the finance
    // cost apart from paying the money back.
    const profitShare = loan.totalPayable > 0 ? loan.profit / loan.totalPayable : 0
    setSaving(true)
    const { error, dropped } = await writeStrip('loan_payments', {
      loan_id: loan.id,
      amount,
      profit: +(amount * profitShare).toFixed(2),
      principal: +(amount * (1 - profitShare)).toFixed(2),
      paid_on: payForm.paid_on,
      paid_time: payForm.paid_time || null,
      due_date: payForm.due_date,
      method: payForm.method,
      account: payForm.account || null,
      reference: payForm.reference || null,
      notes: payForm.notes || null,
      slips: payForm.slips || [],
    }, payModal.payment?.id)
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    if (dropped?.length) toast.error(`Saved, but missing columns: ${dropped.join(', ')} — run the loans SQL`)
    else toast.success(payModal.payment ? 'Payment updated' : 'Payment recorded')
    setPayModal(null); load()
  }

  async function delPayment(p) {
    if (!window.confirm(`Delete the ${money(p.amount)} payment from ${p.paid_on}?`)) return
    await supabase.from('loan_payments').delete().eq('id', p.id)
    toast.success('Payment deleted'); load()
  }

  async function attach(target, fileList) {
    if (!fileList?.length) return
    const originals = Array.from(fileList)
    setUploading(true)
    const files = await readFiles(fileList)
    setUploading(false)
    if (!files.length) { toast.error('Could not read the file'); return }
    if (target === 'pay') setPayForm(f => ({ ...f, slips: [...(f.slips || []), ...files] }))
    else setLoanForm(f => ({ ...f, [target]: [...(f[target] || []), ...files] }))
    // Read the slip and offer what it says, rather than making you retype it
    const image = originals.find(f => (f.type || '').startsWith('image/'))
    if (image) scanSlip(image, target)
  }

  // ── Read a slip ─────────────────────────────────────────────────────────────
  // Everything found is filled in but flagged, so a misread is obvious and can
  // be undone in one click instead of being saved by accident.
  async function scanSlip(file, target) {
    setOcr({ busy: true, progress: 0, target })
    try {
      const found = await readSlip(file, p => setOcr(o => (o ? { ...o, progress: p } : o)))
      if (!found || (!found.amount && !found.date && !found.reference && !found.account)) {
        setOcr(null)
        toast.info("Couldn't make out the slip — type the details in yourself")
        return
      }
      if (target === 'pay') {
        setPayForm(f => {
          const before = { amount: f.amount, paid_on: f.paid_on, paid_time: f.paid_time, reference: f.reference, account: f.account }
          setOcr(o => ({ ...o, busy: false, found, before, filled: true, target: 'pay' }))
          return {
            ...f,
            amount: found.amount != null ? String(found.amount) : f.amount,
            paid_on: found.date || f.paid_on,
            paid_time: found.time || f.paid_time,
            reference: found.reference || f.reference,
            account: found.account || f.account,
          }
        })
      } else {
        setLoanForm(f => {
          const before = { amount: f.amount, received_date: f.received_date }
          setOcr(o => ({ ...o, busy: false, found, before, filled: true, target }))
          return {
            ...f,
            amount: found.amount != null ? String(found.amount) : f.amount,
            received_date: found.date || f.received_date,
          }
        })
      }
    } catch (err) {
      setOcr(null)
      toast.error('Could not read the slip: ' + (err.message || err))
    }
  }

  function undoOcr() {
    if (!ocr?.before) return
    if (ocr.target === 'pay') setPayForm(f => ({ ...f, ...ocr.before }))
    else setLoanForm(f => ({ ...f, ...ocr.before }))
    setOcr(null)
  }

  const toggleExpand = id => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div>
      <style>{`
        table.ln { width:100%; border-collapse:collapse; font-size:12.5px; min-width:820px; }
        .ln th { text-align:right; font-size:10px; font-weight:700; color:#aaa; text-transform:uppercase; letter-spacing:0.4px; padding:8px 10px; border-bottom:1px solid #f0f0f0; white-space:nowrap; }
        .ln th:first-child, .ln td:first-child { text-align:left; }
        .ln td { padding:9px 10px; border-bottom:1px solid #f7f7f7; text-align:right; white-space:nowrap; vertical-align:middle; }
        .ln tr.od td { background:#fffaf9; }
        .ln tr.pd td { background:#fbfdfc; }
      `}</style>
      <PageHeader title="Loans" subtitle={`Payments on the ${PAYMENT_DAY}th, reconciled on the ${RECONCILE_DAY}th — feeding straight into the accounts`}
        action={<Button onClick={openAdd} disabled={needsSetup}><Plus size={15} /> Add loan</Button>} />

      {missingCols.length > 0 && (
        <Card style={{ marginBottom: 16, background: '#fffaf2', border: '1px solid #f3e4c8', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={17} color="#e6940a" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: '#8a6a2a', lineHeight: 1.6 }}>
            <b>Your database is missing {missingCols.length} loan column{missingCols.length > 1 ? 's' : ''}</b> ({missingCols.join(', ')}),
            so tenure, grace period and slips can't be saved and the monthly schedule stays empty.
            Run the loans <code>alter table</code> block from <code>supabase_schema.sql</code> in the Supabase SQL editor, then reload.
          </div>
        </Card>
      )}

      {/* summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }} className="grid-collapse">
        {[
          ['Borrowed', money0(totals.amount), '#2f6fc0', '#EAF2FD', `${rows.length} loan${rows.length === 1 ? '' : 's'}`],
          ['Total payable', money0(totals.payable), '#7F77DD', '#EFEDFB', `incl. ${money0(totals.profit)} profit`],
          ['Paid so far', money0(totals.paid), '#1D9E75', '#E9F7F1', null],
          ['Outstanding', money0(totals.remaining), '#E24B4A', '#FDECEC', totals.overdue > 0 ? `${money0(totals.overdue)} overdue` : null],
          ['Next month', money0(totals.monthly), '#b8740a', '#FFF6E2', `due on the ${PAYMENT_DAY}th`],
        ].map(([label, value, color, bg, sub]) => (
          <div key={label} style={{ background: bg, borderRadius: 14, padding: '15px 17px' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color, letterSpacing: '-0.5px' }}>{value}</div>
            <div style={{ fontSize: 11.5, color: '#888', fontWeight: 600, marginTop: 3 }}>{label}</div>
            {sub && <div style={{ fontSize: 10.5, color: '#aaa', marginTop: 2 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* reconciliation — what should have gone out on the payment day */}
      {dueThisCycle.length > 0 && (
        <Card style={{ marginBottom: 18, background: reconcileTime ? '#fdf2f2' : '#fbfaf8', border: `1px solid ${reconcileTime ? '#f4d4d2' : '#f0ece6'}` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Scale size={17} color={reconcileTime ? '#E24B4A' : '#bbb'} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>
                {reconcileTime
                  ? `Reconciliation — ${dueThisCycle.length} payment${dueThisCycle.length > 1 ? 's' : ''} still unmatched this month`
                  : `${dueThisCycle.length} payment${dueThisCycle.length > 1 ? 's' : ''} due on the ${PAYMENT_DAY}th`}
              </div>
              <div style={{ fontSize: 11.5, color: '#a9a094', marginTop: 3, marginBottom: 10 }}>
                {reconcileTime
                  ? `It's the ${dayOfMonth}th — anything below hasn't been recorded against this month's instalment yet.`
                  : `Checked automatically on the ${RECONCILE_DAY}th.`}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dueThisCycle.map(({ loan, inst }) => (
                  <div key={loan.id + inst.n} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #f0f0f0', borderRadius: 9, padding: '8px 12px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 12.5, color: '#0d1b2a' }}>{loan.lender || 'Loan'}</span>
                    <span style={{ fontSize: 11.5, color: '#999' }}>instalment {inst.n} · due {inst.due}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: '#E24B4A' }}>{money(Math.max(0, inst.amount - inst.paid))}</span>
                    {inst.paid > 0 && <span style={{ fontSize: 11.5, color: '#1D9E75' }}>{money(inst.paid)} already in</span>}
                    <Button size="sm" style={{ marginLeft: 'auto' }} onClick={() => openPay(loan, inst)}><CreditCard size={12} /> Record</Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

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
                    <span style={{ fontSize: 15, fontWeight: 800, color: '#0d1b2a' }}>
                      {l.lenderList.length ? l.lenderList[0].name : (l.lender || 'Lender not set')}
                      {l.lenderList.length > 1 && <span style={{ fontWeight: 600, color: '#999', fontSize: 13 }}> +{l.lenderList.length - 1}</span>}
                    </span>
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
                      Next {money0(Math.max(0, l.nextDue.amount - l.nextDue.paid))} due {l.nextDue.due}
                    </span>}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                {[
                  ['Borrowed', money0(l.principal), '#0d1b2a'],
                  ['Payable', money0(l.totalPayable), '#7F77DD'],
                  ['Next month', money0(l.monthly), '#b8740a'],
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
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#bbb', marginTop: 5, flexWrap: 'wrap', gap: 8 }}>
                <span>{l.progress.toFixed(0)}% repaid · {l.schedule.rows.filter(r => r.status === 'paid').length}/{l.schedule.rows.length} instalments</span>
                {l.profit > 0 && <span>Profit cost {money0(l.profit)} · {money0(l.profitPaid)} paid</span>}
              </div>
            </div>

            {/* detail */}
            {isOpen && (
              <div style={{ borderTop: '1px solid #f2f2f2', background: '#fcfbf9', padding: '14px 20px 18px' }}>
                {l.lenderList.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 7 }}>
                      Who lent it{l.lenderList.length > 1 ? ` (${l.lenderList.length} people)` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {l.lenderList.map((x, i) => (
                        <div key={i} style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, padding: '9px 13px', minWidth: 150 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>{x.name}</span>
                            {x.type && <Badge color={x.type === 'Bank' ? 'blue' : x.type === 'Family' ? 'purple' : 'gray'}>{x.type}</Badge>}
                          </div>
                          <div style={{ fontSize: 11.5, color: '#999', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {num(x.amount) > 0 && <span style={{ fontWeight: 700, color: '#2f6fc0' }}>{money(x.amount)}</span>}
                            {x.phone && <a href={`tel:${x.phone}`} style={{ color: '#999', textDecoration: 'none' }}>{x.phone}</a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginBottom: 16 }}>
                  {Array.isArray(l.received_slips) && l.received_slips.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Slip for money received</div>
                      <Slips slips={l.received_slips} onView={setViewSlip} />
                    </div>
                  )}
                  {Array.isArray(l.slips) && l.slips.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Loan documents</div>
                      <Slips slips={l.slips} onView={setViewSlip} />
                    </div>
                  )}
                </div>
                {l.notes && <div style={{ fontSize: 12.5, color: '#888', marginBottom: 14, lineHeight: 1.6 }}>{l.notes}</div>}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0d1b2a' }}>Monthly schedule</div>
                    <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
                      Each month is what's still owed spread over the months left — pay extra and every month after it drops.
                    </div>
                  </div>
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
                      <thead><tr>
                        <th>#</th><th>Due date</th><th>Amount due</th><th>Paid</th><th>Balance left</th>
                        <th>Status</th><th>Paid on</th><th>Account</th><th>Slip</th><th></th>
                      </tr></thead>
                      <tbody>
                        {l.schedule.rows.map(r => {
                          const st = STATUS[r.status]
                          const slips = r.payments.flatMap(p => (Array.isArray(p.slips) ? p.slips : []))
                          return (
                            <tr key={r.n} className={r.status === 'overdue' ? 'od' : r.status === 'paid' ? 'pd' : ''}>
                              <td style={{ color: '#bbb', fontWeight: 700 }}>{r.n}</td>
                              <td style={{ textAlign: 'right' }}>{r.due}</td>
                              <td>{money(r.amount)}</td>
                              <td style={{ color: r.paid > 0 ? '#1D9E75' : '#ccc', fontWeight: r.paid > 0 ? 700 : 400 }}>
                                {r.paid > 0 ? money(r.paid) : '—'}
                                {r.extra > 0.005 && <div style={{ fontSize: 9.5, color: '#7F77DD', fontWeight: 600 }}>+{money0(r.extra)} extra</div>}
                              </td>
                              <td style={{ color: '#999' }}>{money(r.closingBalance)}</td>
                              <td><Badge color={st.color}>{st.label}</Badge></td>
                              <td style={{ color: '#999' }}>{r.payments.map(p => p.paid_on).filter(Boolean).join(', ') || '—'}</td>
                              <td style={{ color: '#999', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {[...new Set(r.payments.map(p => p.account).filter(Boolean))].join(', ') || '—'}
                              </td>
                              <td>
                                {slips.length > 0
                                  ? <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Slips slips={slips} onView={setViewSlip} size={34} /></div>
                                  : <span style={{ color: '#ddd' }}>—</span>}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {r.payments.length > 0 && (
                                  <Button size="sm" variant="ghost" title="View / edit this month's payment"
                                    onClick={() => setDetail({ loan: l, inst: r })}>
                                    <Eye size={12} /> Details
                                  </Button>
                                )}
                                {r.status !== 'paid' && !l.closed && (
                                  <Button size="sm" variant="ghost" style={{ marginLeft: 4 }} onClick={() => openPay(l, r)}>Pay</Button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
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
          <OcrNote ocr={ocr && ocr.target !== 'pay' ? ocr : null} onUndo={undoOcr} onDismiss={() => setOcr(null)} />
          {/* who lent it — one row per person, so a loan can be split between several */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7, gap: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Who lent it *</label>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#bbb' }}>
                Loan no.
                <input value={loanForm.reference} onChange={e => setLoanForm(f => ({ ...f, reference: e.target.value }))}
                  title="Generated for you — type over it if the lender has their own reference"
                  style={{ width: 82, padding: '4px 8px', border: '1px solid #eee', borderRadius: 7, fontSize: 11.5, fontFamily: 'inherit', fontWeight: 700, color: '#666', background: '#faf9f7', textAlign: 'center' }} />
              </span>
            </div>

            {formLenders.map((x, i) => (
              <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={x.name} onChange={e => updateLender(i, 'name', e.target.value)} placeholder="Name"
                  style={{ flex: '2 1 130px', minWidth: 0, padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit' }} />
                <select value={x.type} onChange={e => updateLender(i, 'type', e.target.value)}
                  style={{ flex: '1 1 96px', minWidth: 0, padding: '9px 8px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }}>
                  {LENDER_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <input type="number" value={x.amount} onChange={e => updateLender(i, 'amount', e.target.value)} placeholder="Amount"
                  style={{ flex: '1 1 92px', minWidth: 0, padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit' }} />
                <input value={x.phone} onChange={e => updateLender(i, 'phone', e.target.value)} placeholder="Phone" inputMode="tel"
                  style={{ flex: '1 1 96px', minWidth: 0, padding: '9px 11px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit' }} />
                <button type="button" onClick={() => removeLender(i)} title="Remove"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, display: 'flex', flexShrink: 0 }}>
                  <X size={14} color="#d5cfc6" />
                </button>
              </div>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
              <Button size="sm" variant="ghost" onClick={addLender}><Plus size={12} /> Add another lender</Button>
              {lendersTotal > 0 && (
                <span style={{ fontSize: 11.5, color: '#999' }}>
                  Lenders add up to <b style={{ color: '#0d1b2a' }}>{money(lendersTotal)}</b>
                  {num(loanForm.amount) > 0 && Math.abs(lendersTotal - num(loanForm.amount)) < 0.01
                    ? <span style={{ color: '#1D9E75', fontWeight: 700 }}> ✓ matches</span>
                    : <button type="button" onClick={() => setLoanForm(f => ({ ...f, amount: lendersTotal }))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#FFA500', fontWeight: 700, fontSize: 11.5, fontFamily: 'inherit', textDecoration: 'underline', padding: '0 0 0 6px' }}>
                        use as loan amount
                      </button>}
                </span>
              )}
            </div>
          </div>

          <FormRow>
            <Input label="Amount (MVR) *" type="number" value={loanForm.amount} onChange={e => setLoanForm(f => ({ ...f, amount: e.target.value }))} />
            <Input label="Received date" type="date" value={loanForm.received_date} onChange={e => setLoanForm(f => ({ ...f, received_date: e.target.value }))} />
          </FormRow>
          <FormRow>
            <Input label="Tenure (months)" type="number" value={loanForm.tenure_months} onChange={e => setLoanForm(f => ({ ...f, tenure_months: e.target.value }))} />
            <Input label="Grace period (months)" type="number" value={loanForm.grace_months} onChange={e => setLoanForm(f => ({ ...f, grace_months: e.target.value }))} />
          </FormRow>
          <FormRow>
            <Input label="Profit / interest rate (% a year)" type="number" value={loanForm.profit_rate} onChange={e => setLoanForm(f => ({ ...f, profit_rate: e.target.value }))} placeholder="0 for no profit" />
            <Select label="How the rate works" value={loanForm.rate_type} options={RATE_TYPES}
              onChange={e => setLoanForm(f => ({ ...f, rate_type: e.target.value }))} />
          </FormRow>

          {/* live working-out so the numbers are obvious before saving */}
          <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 15px', margin: '4px 0 14px', fontSize: 12.5, color: '#666', lineHeight: 1.7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total payable</span><b style={{ color: '#0d1b2a' }}>{money(formMaths.totalPayable)}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Profit / interest cost</span><b style={{ color: '#7F77DD' }}>{money(formMaths.profit)}</b></div>
            {loanForm.received_date && parseInt(loanForm.tenure_months) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#999' }}>
                <span>First payment due</span>
                <span>{dueDateFor(loanForm.received_date, parseInt(loanForm.grace_months) || 0, 1, parseInt(loanForm.payment_day) || PAYMENT_DAY)}</span>
              </div>
            )}
          </div>

          {/* monthly: auto from the numbers above, or typed by hand */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
              <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Monthly payment (MVR)</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {[[true, 'Auto'], [false, 'Manual']].map(([mode, label]) => (
                  <button key={label} type="button"
                    onClick={() => setLoanForm(f => ({
                      ...f, monthly_auto: mode,
                      // Switching to manual starts from whatever auto was showing
                      monthly_payment: mode ? f.monthly_payment : (num(f.monthly_payment) || formMaths.suggestedMonthly.toFixed(2)),
                    }))}
                    style={{
                      padding: '4px 12px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5,
                      fontWeight: loanForm.monthly_auto === mode ? 700 : 600,
                      border: `1px solid ${loanForm.monthly_auto === mode ? '#FFA500' : '#e6e2da'}`,
                      background: loanForm.monthly_auto === mode ? '#FFA500' : '#fff',
                      color: loanForm.monthly_auto === mode ? '#fff' : '#999',
                    }}>{label}</button>
                ))}
              </div>
            </div>
            <input
              type="number" disabled={loanForm.monthly_auto}
              value={loanForm.monthly_auto ? (formMaths.suggestedMonthly ? formMaths.suggestedMonthly.toFixed(2) : '') : loanForm.monthly_payment}
              onChange={e => setLoanForm(f => ({ ...f, monthly_payment: e.target.value }))}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 13px', borderRadius: 9, fontSize: 13, fontFamily: 'inherit',
                border: '1px solid #e0e0e0', background: loanForm.monthly_auto ? '#f8f7f4' : '#fff',
                color: loanForm.monthly_auto ? '#666' : '#0d1b2a', fontWeight: loanForm.monthly_auto ? 700 : 400,
              }} />
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 5, lineHeight: 1.5 }}>
              {loanForm.monthly_auto
                ? `Worked out from the amount, tenure and rate — ${money(formMaths.totalPayable)} ÷ ${loanForm.tenure_months || 0} months. It re-adjusts by itself if you over- or under-pay a month.`
                : 'You set the figure. The schedule still re-spreads what is left if a month is over- or under-paid.'}
            </div>
          </div>

          <FormRow>
            <Input label="Payment day of month" type="number" value={loanForm.payment_day}
              onChange={e => setLoanForm(f => ({ ...f, payment_day: e.target.value }))} />
            <Input label="Agreement date" type="date" value={loanForm.taken_on} onChange={e => setLoanForm(f => ({ ...f, taken_on: e.target.value }))} />
          </FormRow>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>What did you use it for?</label>
            <textarea value={loanForm.purpose} onChange={e => setLoanForm(f => ({ ...f, purpose: e.target.value }))} rows={2} placeholder="e.g. Stock purchase for Eid, new shelves"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
          <Input label="Notes" value={loanForm.notes} onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))} style={{ marginBottom: 16 }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }} className="grid-collapse">
            <Attach label="Loan documents" slips={loanForm.slips} uploading={uploading} onView={setViewSlip}
              onAdd={fl => attach('slips', fl)} onRemove={i => setLoanForm(f => ({ ...f, slips: f.slips.filter((_, x) => x !== i) }))} />
            <Attach label="Slip — money received" slips={loanForm.received_slips} uploading={uploading} onView={setViewSlip}
              onAdd={fl => attach('received_slips', fl)} onRemove={i => setLoanForm(f => ({ ...f, received_slips: f.received_slips.filter((_, x) => x !== i) }))} />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setLoanModal(false)}>Cancel</Button>
            <Button onClick={saveLoan} disabled={saving || !loanForm.amount}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add loan'}</Button>
          </div>
        </Modal>
      )}

      {/* ── Record a payment ── */}
      {payModal && (
        <Modal title={payModal.payment ? 'Edit payment' : 'Record a payment'}
          subtitle={payModal.instalment
            ? `Instalment ${payModal.instalment.n} · due ${payModal.instalment.due} · ${payModal.loan.lender || 'loan'}`
            : (payModal.loan.purpose || payModal.loan.lender || 'Loan repayment')}
          onClose={() => setPayModal(null)}>
          <OcrNote ocr={ocr} onUndo={undoOcr} onDismiss={() => setOcr(null)} />
          <FormRow>
            <Input label="Amount (MVR) *" type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
              <Input label="Paid on" type="date" value={payForm.paid_on} onChange={e => setPayForm(f => ({ ...f, paid_on: e.target.value }))} />
              <Input label="Time" type="time" value={payForm.paid_time} onChange={e => setPayForm(f => ({ ...f, paid_time: e.target.value }))} />
            </div>
          </FormRow>
          <FormRow>
            <Select label="Method" value={payForm.method} options={METHODS} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Which account did you send from</label>
              <input list="bnj-loan-accounts" value={payForm.account} placeholder="e.g. BML 7730000819195"
                onChange={e => setPayForm(f => ({ ...f, account: e.target.value }))}
                style={{ padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }} />
              <datalist id="bnj-loan-accounts">{knownAccounts.map(a => <option key={a} value={a} />)}</datalist>
            </div>
          </FormRow>
          <FormRow>
            <Input label="Reference" value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} placeholder="transaction no." />
            <Input label="Note (optional)" value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} />
          </FormRow>

          {payModal.instalment && (
            <div style={{ background: '#f8f7f4', borderRadius: 9, padding: '10px 13px', margin: '14px 0', fontSize: 12, color: '#888', lineHeight: 1.6 }}>
              This month asks for <b style={{ color: '#0d1b2a' }}>{money(payModal.instalment.amount)}</b>.
              {num(payForm.amount) > payModal.instalment.amount + 0.005 && (
                <> Paying <b style={{ color: '#7F77DD' }}>{money(num(payForm.amount) - payModal.instalment.amount)}</b> extra drops every month after this one.</>
              )}
              {num(payForm.amount) > 0 && num(payForm.amount) < payModal.instalment.amount - 0.005 && (
                <> Paying <b style={{ color: '#E24B4A' }}>{money(payModal.instalment.amount - num(payForm.amount))}</b> short pushes the shortfall onto the months that follow.</>
              )}
            </div>
          )}

          {payModal.loan.profit > 0 && (
            <div style={{ background: '#f8f7f4', borderRadius: 9, padding: '10px 13px', marginBottom: 14, fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Percent size={13} color="#7F77DD" />
              Split as {money(num(payForm.amount) * (1 - payModal.loan.profit / payModal.loan.totalPayable))} principal
              + {money(num(payForm.amount) * (payModal.loan.profit / payModal.loan.totalPayable))} profit — the profit half counts as a finance cost in the accounts.
            </div>
          )}

          <div style={{ marginBottom: 18 }}>
            <Attach label="Payment slip" slips={payForm.slips} uploading={uploading} onView={setViewSlip}
              onAdd={fl => attach('pay', fl)} onRemove={i => setPayForm(f => ({ ...f, slips: f.slips.filter((_, x) => x !== i) }))} />
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              <ScanLine size={11} /> Attach the transfer receipt and the amount, date, time and reference are read off it.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
            {payModal.payment && (
              <Button variant="danger" style={{ marginRight: 'auto' }}
                onClick={() => { const p = payModal.payment; setPayModal(null); delPayment(p) }}>
                <Trash2 size={13} /> Delete
              </Button>
            )}
            <Button variant="ghost" onClick={() => setPayModal(null)}>Cancel</Button>
            <Button onClick={savePayment} disabled={saving || !payForm.amount}>
              {saving ? 'Saving…' : payModal.payment ? 'Save changes' : 'Record payment'}
            </Button>
          </div>
        </Modal>
      )}

      {/* ── That month's payments, in full ── */}
      {detail && (
        <Modal title={`Instalment ${detail.inst.n}`}
          subtitle={`Due ${detail.inst.due} · ${money(detail.inst.amount)} asked · ${money(detail.inst.paid)} paid`}
          onClose={() => setDetail(null)} width={560}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {detail.inst.payments.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, border: '1px solid #f0f0f0', borderRadius: 10, padding: '12px 14px' }}>
                {Array.isArray(p.slips) && p.slips.length > 0
                  ? <Slips slips={p.slips} onView={setViewSlip} size={72} />
                  : <div style={{ width: 72, height: 72, borderRadius: 7, background: '#faf9f7', border: '1px dashed #eee', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, flexShrink: 0 }}>
                      <Paperclip size={15} color="#ddd" /><span style={{ fontSize: 9, color: '#ccc' }}>No slip</span>
                    </div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: 15, color: '#1D9E75' }}>{money(p.amount)}</span>
                    <span style={{ fontSize: 12.5, color: '#666' }}>{p.paid_on}{p.paid_time ? ` · ${p.paid_time}` : ''}</span>
                    {p.method && <Badge color="gray">{p.method}</Badge>}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#999', marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {p.account && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Wallet size={11} color="#c4bcb0" /> {p.account}</span>}
                    {p.reference && <span>Ref {p.reference}</span>}
                    {p.due_date && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Calendar size={11} color="#c4bcb0" /> for {p.due_date}</span>}
                  </div>
                  {num(p.profit) > 0 && (
                    <div style={{ fontSize: 11.5, color: '#7F77DD', marginTop: 5 }}>
                      {money(p.principal)} principal + {money(p.profit)} profit
                    </div>
                  )}
                  {p.notes && <div style={{ fontSize: 11.5, color: '#bbb', marginTop: 5, fontStyle: 'italic' }}>{p.notes}</div>}
                  <div style={{ marginTop: 9, display: 'flex', gap: 6 }}>
                    <Button size="sm" variant="ghost" onClick={() => editPayment(detail.loan, detail.inst, p)}><Edit2 size={12} /> Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => { setDetail(null); delPayment(p) }}><Trash2 size={12} /> Delete</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            {detail.inst.status !== 'paid' && !detail.loan.closed && (
              <Button onClick={() => { const d = detail; setDetail(null); openPay(d.loan, d.inst) }}>
                <CreditCard size={13} /> Add another payment
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
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
