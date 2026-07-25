import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Spinner, useToast, Toasts, Modal } from '../components/UI'
import { Upload, CheckCircle, AlertTriangle, X, Trash2, Plus, FileSpreadsheet, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { getSettings } from '../lib/settings'

// Common reasons a real bank movement will never appear in the books
const IGNORE_REASONS = [
  'Bank charge / fee',
  'Interest received',
  'Transfer between own accounts',
  'Owner drawing',
  'Owner top-up',
  'Reversed / duplicate',
]

const LS_KEY = 'bnj_reconciliations_v1'
const readLocal = () => { try { const v = JSON.parse(localStorage.getItem(LS_KEY)); return Array.isArray(v) ? v : [] } catch { return [] } }
const writeLocal = arr => localStorage.setItem(LS_KEY, JSON.stringify(arr))

const parseNum = v => {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(/[, ]/g, ''))
  return isNaN(n) ? 0 : n
}
// "21-06-2026 21-22-46" or "21/06/2026" → Date (local midnight)
function parseStmtDate(s, serialFallback) {
  if (s) {
    const m = String(s).trim().match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
    if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  }
  // ODS/XLSX numeric serial fallback (1899-12-30 epoch)
  const n = parseNum(serialFallback)
  if (n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86400 * 1000))
  return null
}
const normRef = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const dayMs = 86400000
const daysApart = (a, b) => (!a || !b) ? 999 : Math.abs(Math.round((a - b) / dayMs))
const ymd = d => d ? new Date(d).toISOString().split('T')[0] : ''
const fmtDate = d => d ? new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function Reconciliation() {
  const [orders, setOrders] = useState([])
  const [expenses, setExpenses] = useState([])
  const [supplierPayments, setSupplierPayments] = useState([])
  const [loans, setLoans] = useState([])
  const [loanPays, setLoanPays] = useState([])
  const [history, setHistory] = useState([])
  const [usingLocal, setUsingLocal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [account, setAccount] = useState(() => localStorage.getItem('bnj_recon_last_account') || 'BML Business')
  const [stmtTxns, setStmtTxns] = useState(null)   // parsed statement rows
  const [matches, setMatches] = useState([])        // [{ stmt, amt, isIn, matchId }]
  const [fileName, setFileName] = useState('')
  // View / edit a saved reconciliation
  const [viewRecon, setViewRecon] = useState(null)  // the history record being viewed
  const [editLines, setEditLines] = useState([])    // working copy of its lines
  const [reconFilter, setReconFilter] = useState('all') // all | matched | unmatched
  const [savingEdit, setSavingEdit] = useState(false)
  // Opens on what still needs you, not on the whole statement
  const [workFilter, setWorkFilter] = useState('review') // review | all | matched | ignored
  const [search, setSearch] = useState('')
  const [expenseModal, setExpenseModal] = useState(null) // record a missing expense from a line
  const fileRef = useRef(null)
  const toast = useToast()

  const currency = getSettings().currency || 'MVR'
  const money = n => `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, e, sp, ln, lp] = await Promise.all([
      supabase.from('orders').select('id, customer_name, invoice_number, total_price, payment_status, payment_method, transfer_reference, paid_at, order_date'),
      supabase.from('expenses').select('id, expense_date, category, amount, description'),
      supabase.from('supplier_payments').select('id, supplier_name, amount, payment_date, reference'),
      supabase.from('loans').select('*'),
      supabase.from('loan_payments').select('*'),
    ])
    setOrders(o.data || [])
    setExpenses(e.data || [])
    setSupplierPayments(sp.data || [])
    setLoans(ln.data || [])
    setLoanPays(lp.data || [])
    // reconciliation history — supabase table with localStorage fallback
    const r = await supabase.from('reconciliations').select('*').order('created_at', { ascending: false })
    if (r.error) { setUsingLocal(true); setHistory(readLocal()) }
    else {
      const rows = r.data || []
      const local = readLocal()
      if (rows.length === 0 && local.length > 0) { setUsingLocal(true); setHistory(local) }
      else { setUsingLocal(false); setHistory(rows) }
    }
    setLoading(false)
  }

  // IDs already cleared in a saved reconciliation — excluded from new matching.
  const reconciledIds = useMemo(() => {
    const set = new Set()
    history.forEach(h => (h.cleared || []).forEach(id => set.add(id)))
    return set
  }, [history])

  // Books — money IN (paid orders + loans drawn down) and money OUT
  // (expenses + supplier payments + loan repayments)
  const bookIn = useMemo(() => [
    ...orders
      .filter(o => (o.payment_status === 'paid' || o.payment_status === 'partial') && Number(o.total_price) > 0)
      .map(o => ({
        id: 'order:' + o.id, kind: 'order',
        date: new Date(o.paid_at || o.order_date),
        amount: Number(o.total_price), ref: o.transfer_reference || '',
        label: `${o.customer_name || 'Order'}${o.invoice_number ? ' · ' + o.invoice_number : ''}`,
        method: o.payment_method || '',
      })),
    ...loans.filter(l => Number(l.amount) > 0).map(l => ({
      id: 'loan:' + l.id, kind: 'loan',
      date: new Date(l.received_date || l.taken_on),
      amount: Number(l.amount), ref: l.reference || '',
      label: `Loan received · ${l.lender || 'lender'}`,
    })),
  ], [orders, loans])

  const bookOut = useMemo(() => [
    ...expenses.map(e => ({
      id: 'expense:' + e.id, kind: 'expense',
      date: new Date(e.expense_date), amount: Number(e.amount), ref: '',
      label: `${e.category || 'Expense'}${e.description ? ' · ' + e.description : ''}`,
    })),
    ...supplierPayments.map(p => ({
      id: 'spay:' + p.id, kind: 'spay',
      date: new Date(p.payment_date), amount: Number(p.amount), ref: p.reference || '',
      label: `Supplier payment · ${p.supplier_name || ''}`,
    })),
    ...loanPays.map(p => {
      const l = loans.find(x => x.id === p.loan_id)
      return {
        id: 'lpay:' + p.id, kind: 'lpay',
        date: new Date(p.paid_on), amount: Number(p.amount), ref: p.reference || '',
        label: `Loan repayment · ${l?.lender || 'lender'}`,
      }
    }),
  ], [expenses, supplierPayments, loanPays, loans])

  // Categories already in use, so a new expense lands under a familiar heading
  const expenseCategories = useMemo(() => {
    const used = [...new Set(expenses.map(e => e.category).filter(Boolean))].sort()
    const base = ['Bank charges', 'Utilities', 'Rent', 'Salaries', 'Transport', 'Marketing', 'Supplies', 'Other']
    return [...new Set([...used, ...base])]
  }, [expenses])

  const bookById = useMemo(() => {
    const m = {}
    ;[...bookIn, ...bookOut].forEach(b => { m[b.id] = b })
    return m
  }, [bookIn, bookOut])

  // Auto-match, strongest evidence first: the exact reference, then the exact
  // amount on the same day, then the exact amount within five days. Each book
  // entry can only be used once. `why` explains the match so it can be trusted
  // or overruled at a glance.
  function autoMatch(txns, keep = []) {
    const used = new Set(reconciledIds)
    keep.forEach(k => { if (k?.matchId) used.add(k.matchId) })
    return txns.map((t, i) => {
      const prev = keep[i]
      // Anything already decided by hand is left exactly as it was
      if (prev && (prev.manual || prev.ignored)) return prev
      const isIn = t.credit > 0
      const amt = isIn ? t.credit : t.debit
      const pool = isIn ? bookIn : bookOut
      let m = null, why = '', confidence = ''
      if (t.ref) {
        m = pool.find(b => !used.has(b.id) && b.ref && normRef(b.ref) === normRef(t.ref))
        if (m) { why = `Reference ${t.ref}`; confidence = 'high' }
      }
      if (!m) {
        m = pool.find(b => !used.has(b.id) && Math.abs(b.amount - amt) < 0.01 && daysApart(b.date, t.date) === 0)
        if (m) { why = 'Same amount, same day'; confidence = 'high' }
      }
      if (!m) {
        m = pool.find(b => !used.has(b.id) && Math.abs(b.amount - amt) < 0.01 && daysApart(b.date, t.date) <= 5)
        if (m) { why = `Same amount, ${daysApart(m.date, t.date)} day${daysApart(m.date, t.date) === 1 ? '' : 's'} apart`; confidence = 'medium' }
      }
      if (m) used.add(m.id)
      return { stmt: t, amt, isIn, matchId: m ? m.id : null, why, confidence, ignored: false, reason: '', manual: false }
    })
  }

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const txns = []
      for (const r of rows) {
        if (!r || r.length < 10) continue
        const debit = parseNum(r[8]), credit = parseNum(r[9])
        if (!debit && !credit) continue   // skips blanks and any header row
        const date = parseStmtDate(r[5], r[0])
        txns.push({
          date, type: String(r[2] || '').trim(),
          ref: String(r[4] || '').trim() || String(r[3] || '').trim(),
          party: String(r[6] || '').trim(),
          debit, credit, balance: parseNum(r[10]),
        })
      }
      if (!txns.length) { toast.error('No transactions found in that file'); return }
      txns.sort((a, b) => (a.date || 0) - (b.date || 0))
      setStmtTxns(txns)
      setMatches(autoMatch(txns))
      const matchedN = autoMatch(txns).filter(m => m.matchId).length
      toast.success(`Read ${txns.length} lines · auto-matched ${matchedN}`)
    } catch (err) {
      toast.error('Could not read file: ' + (err.message || err))
    }
  }

  function setMatch(idx, matchId) {
    setMatches(ms => ms.map((m, i) => i === idx
      ? { ...m, matchId, manual: true, ignored: false, reason: '', why: matchId ? 'Matched by hand' : '', confidence: matchId ? 'manual' : '' }
      : m))
  }

  // Bank movements that are real but will never appear in the books — bank
  // charges, interest, a transfer between your own accounts. Marking one
  // explained stops it counting as an exception without inventing a record.
  function ignoreLine(idx, reason) {
    setMatches(ms => ms.map((m, i) => i === idx
      ? { ...m, matchId: null, ignored: true, manual: true, reason: reason || 'Not in the books', why: '', confidence: '' }
      : m))
  }
  const unignore = idx => setMatches(ms => ms.map((m, i) => i === idx ? { ...m, ignored: false, reason: '', manual: false } : m))

  function rerunAutoMatch() {
    if (!stmtTxns) return
    const next = autoMatch(stmtTxns, matches)
    setMatches(next)
    toast.success(`Auto-matched ${next.filter(m => m.matchId).length} of ${next.length} lines`)
  }

  function clearAllMatches() {
    if (!window.confirm('Clear every match and note on this statement and start again?')) return
    setMatches(autoMatch(stmtTxns, []))
  }

  // Candidate book entries for a manual match dropdown (same direction, not used elsewhere)
  function candidates(row, idx) {
    const usedElsewhere = new Set(matches.filter((m, i) => i !== idx && m.matchId).map(m => m.matchId))
    const pool = (row.isIn ? bookIn : bookOut).filter(b => !reconciledIds.has(b.id) && !usedElsewhere.has(b.id))
    // sort by closeness in amount then date
    return pool.sort((a, b) => Math.abs(a.amount - row.amt) - Math.abs(b.amount - row.amt) || daysApart(a.date, row.stmt.date) - daysApart(b.date, row.stmt.date)).slice(0, 40)
  }

  // Summary
  const sum = useMemo(() => {
    const tot = f => matches.filter(f).reduce((s, m) => s + m.amt, 0)
    const credits = tot(m => m.isIn)
    const debits = tot(m => !m.isIn)
    const matchedIn = tot(m => m.isIn && m.matchId)
    const matchedOut = tot(m => !m.isIn && m.matchId)
    // An ignored line is explained too — it just has no counterpart in the books
    const ignoredIn = tot(m => m.isIn && m.ignored)
    const ignoredOut = tot(m => !m.isIn && m.ignored)
    const needsReview = matches.filter(m => !m.matchId && !m.ignored)
    const stmtClosing = stmtTxns && stmtTxns.length ? stmtTxns[stmtTxns.length - 1].balance : 0
    return {
      credits, debits, net: credits - debits,
      matchedIn, matchedOut, matchedNet: matchedIn - matchedOut,
      ignoredIn, ignoredOut, ignoredCount: matches.filter(m => m.ignored).length,
      matchedCount: matches.filter(m => m.matchId).length,
      unmatchedCount: needsReview.length,
      needsReviewIn: tot(m => m.isIn && !m.matchId && !m.ignored),
      needsReviewOut: tot(m => !m.isIn && !m.matchId && !m.ignored),
      unexplained: (credits - debits) - ((matchedIn + ignoredIn) - (matchedOut + ignoredOut)),
      // How far through the review you are
      progress: matches.length ? Math.round(((matches.length - needsReview.length) / matches.length) * 100) : 0,
      stmtClosing,
      periodEnd: stmtTxns && stmtTxns.length ? stmtTxns[stmtTxns.length - 1].date : null,
      periodStart: stmtTxns && stmtTxns.length ? stmtTxns[0].date : null,
    }
  }, [matches, stmtTxns])

  // The rows actually shown, after the filter chips and the search box
  const workRows = useMemo(() => {
    const q = search.toLowerCase().trim()
    return matches
      .map((m, idx) => ({ m, idx }))
      .filter(({ m }) => workFilter === 'all' ? true
        : workFilter === 'matched' ? !!m.matchId
          : workFilter === 'ignored' ? !!m.ignored
            : !m.matchId && !m.ignored)
      .filter(({ m }) => !q
        || (m.stmt.party || '').toLowerCase().includes(q)
        || (m.stmt.type || '').toLowerCase().includes(q)
        || (m.stmt.ref || '').toLowerCase().includes(q)
        || String(m.amt).includes(q))
  }, [matches, workFilter, search])

  // Rows grouped under the day they happened, oldest first, with that day's
  // running totals — a statement reads far better by date than as one long list.
  const workDays = useMemo(() => {
    const byDay = new Map()
    workRows.forEach(r => {
      const key = ymd(r.m.stmt.date) || 'No date'
      if (!byDay.has(key)) byDay.set(key, { key, date: r.m.stmt.date, rows: [], in: 0, out: 0, review: 0 })
      const g = byDay.get(key)
      g.rows.push(r)
      if (r.m.isIn) g.in += r.m.amt; else g.out += r.m.amt
      if (!r.m.matchId && !r.m.ignored) g.review += 1
    })
    return [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [workRows])

  // Everything still unaccounted for, by day — the shortlist to work through
  const unexplainedDays = useMemo(() => {
    const byDay = new Map()
    matches.forEach((m, idx) => {
      if (m.matchId || m.ignored) return
      const key = ymd(m.stmt.date) || 'No date'
      if (!byDay.has(key)) byDay.set(key, { key, rows: [], in: 0, out: 0 })
      const g = byDay.get(key)
      g.rows.push({ m, idx })
      if (m.isIn) g.in += m.amt; else g.out += m.amt
    })
    return [...byDay.values()].sort((a, b) => a.key.localeCompare(b.key))
  }, [matches])

  async function finish() {
    const cleared = matches.filter(m => m.matchId).map(m => m.matchId)
    if (!cleared.length && !sum.ignoredCount) { toast.error('Nothing matched to reconcile'); return }
    if (sum.unmatchedCount > 0 && !window.confirm(
      `${sum.unmatchedCount} line${sum.unmatchedCount > 1 ? 's are' : ' is'} still unreviewed, leaving ${money(Math.abs(sum.unexplained))} unexplained.\n\nFinish anyway? You can come back and match them later.`
    )) return
    setSaving(true)
    const rec = {
      account,
      period_start: ymd(sum.periodStart),
      period_end: ymd(sum.periodEnd),
      statement_in: sum.credits,
      statement_out: sum.debits,
      closing_balance: sum.stmtClosing,
      matched_count: cleared.length,
      unmatched_count: sum.unmatchedCount,
      cleared,
      // Full line detail so the reconciliation can be reviewed & edited later
      lines: matches.map(m => ({
        date: ymd(m.stmt.date), party: m.stmt.party || '', type: m.stmt.type || '',
        ref: m.stmt.ref || '', amount: m.amt, isIn: m.isIn, matchId: m.matchId || null,
        ignored: !!m.ignored, reason: m.reason || '', why: m.why || '',
      })),
      created_at: new Date().toISOString(),
    }
    localStorage.setItem('bnj_recon_last_account', account)
    if (usingLocal) {
      const arr = [{ id: 'local-' + Date.now(), ...rec }, ...history]
      writeLocal(arr); setHistory(arr)
    } else {
      let { error } = await supabase.from('reconciliations').insert(rec)
      // Older table without the `lines` column — save without the detail
      if (error && /lines/i.test(error.message || '')) {
        const { lines: _l, ...noLines } = rec
        error = (await supabase.from('reconciliations').insert(noLines)).error
        if (!error) toast.info('Saved. Run integrations/reconciliation-setup.sql to also store line details for later review.')
      }
      if (error) {
        setUsingLocal(true)
        const arr = [{ id: 'local-' + Date.now(), ...rec }, ...readLocal()]
        writeLocal(arr); setHistory(arr)
        toast.info('Saved on this device — create the reconciliations table in Supabase to sync.')
      } else { await load() }
    }
    setSaving(false)
    setStmtTxns(null); setMatches([]); setFileName('')
    toast.success(`Reconciled ${cleared.length} transaction${cleared.length === 1 ? '' : 's'}`)
  }

  async function deleteRecon(rec) {
    if (!window.confirm('Delete this reconciliation? Its transactions become un-reconciled.')) return
    if (usingLocal || String(rec.id).startsWith('local-')) {
      const arr = history.filter(h => h.id !== rec.id); writeLocal(arr); setHistory(arr)
    } else {
      await supabase.from('reconciliations').delete().eq('id', rec.id)
      setHistory(h => h.filter(x => x.id !== rec.id))
    }
    toast.success('Reconciliation removed')
  }

  function cancelUpload() { setStmtTxns(null); setMatches([]); setFileName('') }

  // ── Record a missing expense straight from an unmatched bank line ───────────
  // An unmatched debit is nearly always something real that was never logged —
  // a bank charge, fuel, a salary. This writes it into the books and matches it
  // on the spot, instead of sending you off to another page and back.
  function openAddExpense(idx) {
    const m = matches[idx]
    setExpenseModal({
      idx,
      amount: m.amt,
      expense_date: ymd(m.stmt.date) || ymd(new Date()),
      category: expenseCategories[0] || 'Bank charges',
      description: m.stmt.party || m.stmt.type || 'From bank statement',
    })
  }

  async function saveExpenseFromLine() {
    const f = expenseModal
    if (!f) return
    setSaving(true)
    const row = {
      description: f.description || 'From bank statement',
      category: f.category || 'Other',
      amount: Number(f.amount) || 0,
      expense_date: f.expense_date,
    }
    const { data, error } = await supabase.from('expenses').insert(row).select()
    setSaving(false)
    if (error) { toast.error('Could not save: ' + error.message); return }
    const created = data?.[0]
    if (created) {
      setExpenses(prev => [...prev, created])
      // Match the bank line to the record we just made
      setMatches(ms => ms.map((m, i) => i === f.idx
        ? { ...m, matchId: 'expense:' + created.id, manual: true, ignored: false, reason: '', why: 'Recorded from this line', confidence: 'manual' }
        : m))
    }
    setExpenseModal(null)
    toast.success('Expense recorded and matched')
  }

  // ── Export the working reconciliation ───────────────────────────────────────
  function exportWorking() {
    if (!matches.length) { toast.error('Nothing to export'); return }
    const rows = matches.map(m => {
      const b = m.matchId ? bookById[m.matchId] : null
      return {
        'Date': ymd(m.stmt.date),
        'Type': m.stmt.type || '',
        'Party': m.stmt.party || '',
        'Reference': m.stmt.ref || '',
        'Money in': m.isIn ? +m.amt.toFixed(2) : '',
        'Money out': m.isIn ? '' : +m.amt.toFixed(2),
        'Status': m.matchId ? 'Matched' : m.ignored ? 'Explained' : 'Needs review',
        'Matched to': b ? b.label : (m.ignored ? m.reason : ''),
        'Why': m.why || '',
      }
    })
    rows.push({})
    rows.push({
      'Party': 'TOTAL', 'Money in': +sum.credits.toFixed(2), 'Money out': +sum.debits.toFixed(2),
      'Status': `${sum.matchedCount} matched · ${sum.ignoredCount} explained · ${sum.unmatchedCount} to review`,
      'Matched to': `Unexplained ${sum.unexplained.toFixed(2)}`,
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Reconciliation')
    XLSX.writeFile(wb, `reconciliation-${account.replace(/[^\w]+/g, '_')}-${ymd(sum.periodEnd) || ymd(new Date())}.xlsx`)
    toast.success('Downloaded')
  }

  // ── View / edit a saved reconciliation ──────────────────────────────────────
  function openRecon(h) {
    setViewRecon(h)
    setEditLines(Array.isArray(h.lines) ? h.lines.map(l => ({ ...l })) : [])
    setReconFilter('all')
  }

  // Book ids cleared by OTHER reconciliations (this record's own matches stay available)
  const reconciledElsewhere = useMemo(() => {
    if (!viewRecon) return reconciledIds
    const set = new Set()
    history.forEach(h => { if (h.id !== viewRecon.id) (h.cleared || []).forEach(id => set.add(id)) })
    return set
  }, [history, viewRecon, reconciledIds])

  function reconCandidates(line, idx) {
    const usedHere = new Set(editLines.filter((l, i) => i !== idx && l.matchId).map(l => l.matchId))
    const pool = (line.isIn ? bookIn : bookOut).filter(b => !reconciledElsewhere.has(b.id) && !usedHere.has(b.id))
    const lineDate = line.date ? new Date(line.date) : null
    return pool.sort((a, b) =>
      Math.abs(a.amount - line.amount) - Math.abs(b.amount - line.amount) ||
      daysApart(a.date, lineDate) - daysApart(b.date, lineDate)
    ).slice(0, 40)
  }

  async function saveReconEdits() {
    if (!viewRecon) return
    setSavingEdit(true)
    const cleared = editLines.filter(l => l.matchId).map(l => l.matchId)
    const changes = {
      cleared,
      lines: editLines,
      matched_count: cleared.length,
      unmatched_count: editLines.filter(l => !l.matchId).length,
    }
    if (usingLocal || String(viewRecon.id).startsWith('local-')) {
      const arr = history.map(h => h.id === viewRecon.id ? { ...h, ...changes } : h)
      writeLocal(arr); setHistory(arr)
    } else {
      let { error } = await supabase.from('reconciliations').update(changes).eq('id', viewRecon.id)
      if (error && /lines/i.test(error.message || '')) {
        const { lines: _l, ...noLines } = changes
        error = (await supabase.from('reconciliations').update(noLines).eq('id', viewRecon.id)).error
      }
      if (error) { toast.error('Could not save: ' + error.message); setSavingEdit(false); return }
      setHistory(hs => hs.map(h => h.id === viewRecon.id ? { ...h, ...changes } : h))
    }
    setSavingEdit(false)
    setViewRecon(null)
    toast.success('Reconciliation updated')
  }

  return (
    <div>
      <style>{`
        .rec-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px,1fr)); gap:12px; margin-bottom:18px; }
        .rec-card { border-radius:14px; padding:15px 17px; }
        .rec-card .v { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
        .rec-card .l { font-size:12px; color:#888; font-weight:600; margin-top:3px; }
        .rec-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        table.rec-table { width:100%; border-collapse:collapse; font-size:13px; min-width:720px; }
        .rec-table th { text-align:left; font-size:11px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.4px; padding:9px 10px; border-bottom:2px solid #f0f0f0; white-space:nowrap; }
        .rec-table td { padding:9px 10px; border-bottom:1px solid #f5f5f5; vertical-align:middle; }
        .rec-table tr.unmatched td { background:#FFFBF2; }
        .rec-table tr.rec-day td { background:#f8f7f4; border-bottom:1px solid #efece6; padding:7px 10px;
          font-size:11px; font-weight:800; color:#8a8378; text-transform:uppercase; letter-spacing:0.5px; white-space:nowrap; }
        .rec-in { color:#1D9E75; font-weight:700; }
        .rec-out { color:#E24B4A; font-weight:700; }
        .rec-pill { font-size:11px; font-weight:700; padding:3px 9px; border-radius:99px; display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
        .rec-sel { border:1px solid #ddd; border-radius:8px; padding:6px 8px; font-size:12px; font-family:inherit; max-width:230px; background:#fff; outline:none; }
        @media (max-width:600px){ .rec-card .v { font-size:19px; } }
      `}</style>

      <PageHeader
        title="Reconciliation"
        subtitle="Upload your monthly bank statement (CSV) — it auto-matches each line to your recorded orders, expenses and supplier payments."
        action={stmtTxns
          ? <Button variant="ghost" onClick={cancelUpload}><X size={14} /> Discard</Button>
          : <Button onClick={() => fileRef.current.click()}><Upload size={15} /> Upload statement</Button>}
      />
      <input ref={fileRef} type="file" accept=".csv,.ods,.xlsx,.xls" style={{ display: 'none' }} onChange={handleUpload} />

      {usingLocal && (
        <div style={{ background: '#EAF2FD', border: '1px solid #cfe0f5', borderRadius: 12, padding: '11px 15px', marginBottom: 16, fontSize: 12.5, color: '#2f6fc0', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Reconciliations are saved on this device only. Create a <strong>reconciliations</strong> table in Supabase to sync across devices (ask for the SQL).</span>
        </div>
      )}

      {loading ? <Spinner /> : !stmtTxns ? (
        <>
          {/* Upload prompt */}
          <Card style={{ marginBottom: 18 }}>
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: 'linear-gradient(135deg,#fff3df,#ffe9c7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <FileSpreadsheet size={28} color="#FFA500" />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0d1b2a', marginBottom: 6 }}>Upload this month's bank statement</div>
              <div style={{ fontSize: 13, color: '#888', maxWidth: 460, margin: '0 auto 18px', lineHeight: 1.6 }}>
                Export your statement from internet banking as a CSV and upload it here. We'll automatically match each line to your books, then you just review the few exceptions.
              </div>
              <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center', marginBottom: 18 }}>
                <label style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>Account</label>
                <input value={account} onChange={e => setAccount(e.target.value)} list="rec-accts"
                  style={{ border: '1px solid #ddd', borderRadius: 8, padding: '7px 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                <datalist id="rec-accts">
                  {[...new Set(history.map(h => h.account).filter(Boolean))].map(a => <option key={a} value={a} />)}
                </datalist>
              </div>
              <div><Button onClick={() => fileRef.current.click()}><Upload size={15} /> Choose statement file</Button></div>
            </div>
          </Card>

          {/* History */}
          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a', marginBottom: 12 }}>Past reconciliations</div>
            {history.length === 0
              ? <div style={{ fontSize: 13, color: '#bbb', padding: '8px 0' }}>None yet — upload a statement to start.</div>
              : (
                <div className="rec-scroll">
                  <table className="rec-table">
                    <thead><tr>
                      <th>Account</th><th>Period</th><th className="num" style={{ textAlign: 'right' }}>Money in</th><th className="num" style={{ textAlign: 'right' }}>Money out</th><th className="num" style={{ textAlign: 'right' }}>Closing</th><th>Matched</th><th></th>
                    </tr></thead>
                    <tbody>
                      {history.map(h => (
                        <tr key={h.id} onClick={() => openRecon(h)} style={{ cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#faf9f6'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <td style={{ fontWeight: 600 }}>{h.account || '—'}</td>
                          <td style={{ color: '#666' }}>{fmtDate(h.period_start)} – {fmtDate(h.period_end)}</td>
                          <td style={{ textAlign: 'right', color: '#1D9E75', fontWeight: 600 }}>{money(h.statement_in)}</td>
                          <td style={{ textAlign: 'right', color: '#E24B4A', fontWeight: 600 }}>{money(h.statement_out)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(h.closing_balance)}</td>
                          <td style={{ color: '#666' }}>
                            {h.matched_count} cleared
                            {h.unmatched_count > 0 && <span className="rec-pill" style={{ background: '#FFF3D6', color: '#b8740a', marginLeft: 8 }}><AlertTriangle size={11} /> {h.unmatched_count} unreviewed</span>}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                            <button onClick={() => openRecon(h)} title="View & edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#378ADD', padding: 5 }}><Eye size={14} /></button>
                            <button onClick={() => deleteRecon(h)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', padding: 5 }}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        </>
      ) : (
        <>
          {/* Summary cards */}
          <div className="rec-cards">
            <div className="rec-card" style={{ background: '#E9F7F1' }}>
              <div className="v" style={{ color: '#1D9E75' }}>{money(sum.credits)}</div><div className="l">Money in (statement)</div>
            </div>
            <div className="rec-card" style={{ background: '#FDECEC' }}>
              <div className="v" style={{ color: '#E24B4A' }}>{money(sum.debits)}</div><div className="l">Money out (statement)</div>
            </div>
            <div className="rec-card" style={{ background: '#EAF2FD' }}>
              <div className="v" style={{ color: '#2f6fc0' }}>{money(sum.stmtClosing)}</div><div className="l">Closing balance</div>
            </div>
            <div className="rec-card" style={{ background: Math.abs(sum.unexplained) < 0.01 ? '#E9F7F1' : '#FFF6E2' }}>
              <div className="v" style={{ color: Math.abs(sum.unexplained) < 0.01 ? '#1D9E75' : '#b8740a' }}>{money(sum.unexplained)}</div>
              <div className="l">Unexplained difference</div>
            </div>
          </div>

          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13, color: '#555' }}>
                <strong>{account}</strong> · {fmtDate(sum.periodStart)} – {fmtDate(sum.periodEnd)} · {matches.length} lines ·{' '}
                <span style={{ color: '#1D9E75', fontWeight: 700 }}>{sum.matchedCount} matched</span>
                {sum.ignoredCount > 0 && <span style={{ color: '#7F77DD', fontWeight: 700 }}> · {sum.ignoredCount} explained</span>}
                {sum.unmatchedCount > 0 && <span style={{ color: '#b8740a', fontWeight: 700 }}> · {sum.unmatchedCount} need review</span>}
                {fileName && <span style={{ color: '#aaa' }}> · {fileName}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="ghost" onClick={exportWorking}><FileSpreadsheet size={14} /> Excel</Button>
                <Button variant="ghost" onClick={rerunAutoMatch} title="Match again, keeping anything you set by hand"><RefreshCw size={14} /> Re-match</Button>
                <Button variant="ghost" onClick={clearAllMatches}>Start over</Button>
                <Button variant="ghost" onClick={cancelUpload}>Cancel</Button>
                <Button onClick={finish} disabled={saving}>{saving ? 'Saving…' : <><CheckCircle size={14} /> Finish reconciliation</>}</Button>
              </div>
            </div>

            {/* how far through the review you are */}
            <div style={{ marginTop: 14 }}>
              <div style={{ height: 7, background: '#f2f0ec', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ width: `${sum.progress}%`, height: '100%', borderRadius: 99, transition: 'width .3s', background: sum.progress >= 100 ? '#1D9E75' : 'linear-gradient(90deg,#FFA500,#ff8c00)' }} />
              </div>
              <div style={{ fontSize: 11.5, color: '#bbb', marginTop: 5 }}>
                {sum.progress}% reviewed — {sum.matchedCount + sum.ignoredCount} of {matches.length} lines accounted for
              </div>
            </div>

            {Math.abs(sum.unexplained) >= 0.01 && (
              <div style={{ marginTop: 12, background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#a16d0a', lineHeight: 1.6 }}>
                <strong>{money(Math.abs(sum.unexplained))}</strong> of bank movement isn't accounted for yet
                {sum.needsReviewIn > 0 && <> — {money(sum.needsReviewIn)} coming in</>}
                {sum.needsReviewIn > 0 && sum.needsReviewOut > 0 && ' and'}
                {sum.needsReviewOut > 0 && <> {money(sum.needsReviewOut)} going out</>}.
                Match the highlighted rows, record the missing expense, or mark them explained to bring this to zero.
              </div>
            )}
          </Card>

          {/* Still unexplained — the shortlist, day by day */}
          {sum.unmatchedCount > 0 && (
            <Card style={{ marginBottom: 16, background: '#fffdf8', border: '1px solid #f4e7cd' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <AlertTriangle size={14} color="#e6940a" />
                    {sum.unmatchedCount} bank line{sum.unmatchedCount > 1 ? 's' : ''} still unexplained
                  </div>
                  <div style={{ fontSize: 11.5, color: '#a9a094', marginTop: 3 }}>
                    Money the bank moved that your books don't know about — across {unexplainedDays.length} day{unexplainedDays.length > 1 ? 's' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 22 }}>
                  {sum.needsReviewOut > 0 && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 9.5, color: '#c4bcb0', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700 }}>Went out</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#E24B4A' }}>{money(sum.needsReviewOut)}</div>
                    </div>
                  )}
                  {sum.needsReviewIn > 0 && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 9.5, color: '#c4bcb0', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700 }}>Came in</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#1D9E75' }}>{money(sum.needsReviewIn)}</div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {unexplainedDays.map(d => (
                  <div key={d.key}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: '#8a8378', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{fmtDate(d.key)}</span>
                      <span style={{ flex: 1, height: 1, background: '#f0e8d8' }} />
                      {d.out > 0 && <span style={{ fontSize: 11, color: '#E24B4A', fontWeight: 700 }}>−{money(d.out)}</span>}
                      {d.in > 0 && <span style={{ fontSize: 11, color: '#1D9E75', fontWeight: 700 }}>+{money(d.in)}</span>}
                    </div>
                    {d.rows.map(({ m, idx }) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #f2eee6', borderRadius: 9, padding: '8px 12px', marginBottom: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#0d1b2a', flex: '1 1 160px', minWidth: 0 }}>
                          {m.stmt.party || m.stmt.type || 'Transaction'}
                          {m.stmt.ref && <span style={{ color: '#c4bcb0', fontWeight: 400 }}> · {m.stmt.ref}</span>}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: m.isIn ? '#1D9E75' : '#E24B4A', whiteSpace: 'nowrap' }}>
                          {m.isIn ? '+' : '−'}{money(m.amt)}
                        </span>
                        {!m.isIn && (
                          <Button size="sm" variant="ghost" onClick={() => openAddExpense(idx)}><Plus size={11} /> Record expense</Button>
                        )}
                        <select className="rec-sel" style={{ maxWidth: 170 }} value=""
                          onChange={e => e.target.value && setMatch(idx, e.target.value)}>
                          <option value="">Match to…</option>
                          {candidates(m, idx).map(b => (
                            <option key={b.id} value={b.id}>{money(b.amount)} · {fmtDate(b.date)} · {b.label}</option>
                          ))}
                        </select>
                        <select className="rec-sel" style={{ maxWidth: 140 }} value=""
                          onChange={e => { if (e.target.value) ignoreLine(idx, e.target.value === '__other' ? (window.prompt('What is this line?') || 'Not in the books') : e.target.value) }}>
                          <option value="">Explain…</option>
                          {IGNORE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                          <option value="__other">Something else…</option>
                        </select>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Match table */}
          <Card>
            {/* filter + search */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              {[
                ['review', `Needs review (${sum.unmatchedCount})`, '#b8740a'],
                ['all', `All (${matches.length})`, '#0d1b2a'],
                ['matched', `Matched (${sum.matchedCount})`, '#1D9E75'],
                ['ignored', `Explained (${sum.ignoredCount})`, '#7F77DD'],
              ].map(([k, label, colour]) => (
                <button key={k} onClick={() => setWorkFilter(k)}
                  style={{ padding: '7px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                    background: workFilter === k ? colour : '#f3f1ec', color: workFilter === k ? '#fff' : '#777' }}>
                  {label}
                </button>
              ))}
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search party, reference or amount…"
                style={{ marginLeft: 'auto', minWidth: 220, flex: '0 1 300px', border: '1px solid #e0e0e0', borderRadius: 9, padding: '8px 12px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
            </div>

            <div className="rec-scroll">
              <table className="rec-table">
                <thead><tr>
                  <th>Date</th><th>Bank line</th><th style={{ textAlign: 'right' }}>Amount</th><th>Matched to</th>
                </tr></thead>
                {workRows.length === 0 && (
                  <tbody><tr><td colSpan={4} style={{ textAlign: 'center', color: '#bbb', padding: '26px 0' }}>
                    {workFilter === 'review' ? 'Nothing left to review — every line is accounted for. 🎉' : 'No lines here.'}
                  </td></tr></tbody>
                )}
                {workDays.map(day => (
                <tbody key={day.key}>
                  {/* one heading per day, with what moved that day */}
                  <tr className="rec-day">
                    <td colSpan={2}>
                      {fmtDate(day.key)}
                      <span style={{ color: '#c4bcb0', fontWeight: 500 }}> · {day.rows.length} line{day.rows.length > 1 ? 's' : ''}</span>
                      {day.review > 0 && <span style={{ color: '#b8740a', fontWeight: 700 }}> · {day.review} to review</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {day.in > 0 && <span style={{ color: '#1D9E75', fontWeight: 700 }}>+{money(day.in)}</span>}
                      {day.in > 0 && day.out > 0 && <span style={{ color: '#ddd' }}> / </span>}
                      {day.out > 0 && <span style={{ color: '#E24B4A', fontWeight: 700 }}>−{money(day.out)}</span>}
                    </td>
                    <td />
                  </tr>
                  {day.rows.map(({ m, idx }) => {
                    const matched = m.matchId ? bookById[m.matchId] : null
                    return (
                      <tr key={idx} className={m.matchId || m.ignored ? '' : 'unmatched'}>
                        <td style={{ whiteSpace: 'nowrap', color: '#bbb', fontSize: 11.5 }}>{fmtDate(m.stmt.date)}</td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{m.stmt.party || m.stmt.type || 'Transaction'}</div>
                          <div style={{ fontSize: 11, color: '#aaa' }}>{m.stmt.type}{m.stmt.ref ? ` · ${m.stmt.ref}` : ''}</div>
                        </td>
                        <td style={{ textAlign: 'right' }} className={m.isIn ? 'rec-in' : 'rec-out'}>
                          {m.isIn ? '+' : '−'}{money(m.amt)}
                        </td>
                        <td>
                          {matched ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span className="rec-pill" style={{ background: '#E1F5EE', color: '#1D9E75' }}><CheckCircle size={12} /> {matched.label}</span>
                              {m.why && (
                                <span className="rec-pill" title="Why this was matched"
                                  style={{ background: m.confidence === 'medium' ? '#FFF3D6' : '#f3f1ec', color: m.confidence === 'medium' ? '#b8740a' : '#999' }}>
                                  {m.why}
                                </span>
                              )}
                              <button onClick={() => setMatch(idx, null)} title="Unmatch" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc' }}><X size={13} /></button>
                            </span>
                          ) : m.ignored ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span className="rec-pill" style={{ background: '#EFEDFB', color: '#7F77DD' }}><EyeOff size={12} /> {m.reason}</span>
                              <button onClick={() => unignore(idx)} title="Put it back for review" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc' }}><X size={13} /></button>
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span className="rec-pill" style={{ background: '#FFF3D6', color: '#b8740a' }}><AlertTriangle size={12} /> Needs review</span>
                              <select className="rec-sel" value="" onChange={e => e.target.value && setMatch(idx, e.target.value)}>
                                <option value="">Match to…</option>
                                {candidates(m, idx).map(b => (
                                  <option key={b.id} value={b.id}>{money(b.amount)} · {fmtDate(b.date)} · {b.label}</option>
                                ))}
                              </select>
                              {!m.isIn && (
                                <button onClick={() => openAddExpense(idx)} title="Write this into the books as an expense"
                                  style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: 8, cursor: 'pointer', color: '#666', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', padding: '5px 9px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Plus size={11} /> Record expense
                                </button>
                              )}
                              <select className="rec-sel" style={{ maxWidth: 150 }} value=""
                                onChange={e => { if (e.target.value) ignoreLine(idx, e.target.value === '__other' ? (window.prompt('What is this line?') || 'Not in the books') : e.target.value) }}>
                                <option value="">Explain…</option>
                                {IGNORE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                                <option value="__other">Something else…</option>
                              </select>
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                ))}
              </table>
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 12, lineHeight: 1.6 }}>
              Highlighted rows are bank movements not yet found in your books — usually unrecorded sales, bank fees, or cash you haven't logged.
              Match one to an existing record, <strong>Record expense</strong> to write it into the books there and then, or <strong>Explain</strong> it
              if it will never appear (bank charges, a transfer between your own accounts). Click <strong>Finish</strong> to save.
            </div>
          </Card>
        </>
      )}

      {/* ── View / edit a saved reconciliation ── */}
      {viewRecon && (() => {
        const matchedN = editLines.filter(l => l.matchId).length
        const unmatchedN = editLines.filter(l => !l.matchId && !l.ignored).length
        const shown = editLines
          .map((l, idx) => ({ l, idx }))
          .filter(({ l }) => reconFilter === 'all' ? true : reconFilter === 'matched' ? !!l.matchId : (!l.matchId && !l.ignored))
        // Same day-by-day grouping as the working view
        const shownDays = (() => {
          const byDay = new Map()
          shown.forEach(r => {
            const key = r.l.date || 'No date'
            if (!byDay.has(key)) byDay.set(key, { key, rows: [], in: 0, out: 0 })
            const g = byDay.get(key)
            g.rows.push(r)
            if (r.l.isIn) g.in += Number(r.l.amount) || 0; else g.out += Number(r.l.amount) || 0
          })
          return [...byDay.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)))
        })()
        const dirty = JSON.stringify(editLines) !== JSON.stringify(viewRecon.lines || [])
        return (
          <Modal title={`${viewRecon.account || 'Reconciliation'} — ${fmtDate(viewRecon.period_start)} to ${fmtDate(viewRecon.period_end)}`}
            subtitle={`In ${money(viewRecon.statement_in)} · Out ${money(viewRecon.statement_out)} · Closing ${money(viewRecon.closing_balance)}`}
            onClose={() => setViewRecon(null)} width={860}>
            {editLines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: '#999', fontSize: 13, lineHeight: 1.7 }}>
                This reconciliation was saved before line details were stored, so only the summary is available.<br />
                {viewRecon.matched_count} transaction{viewRecon.matched_count === 1 ? '' : 's'} cleared{viewRecon.unmatched_count ? ` · ${viewRecon.unmatched_count} left unreviewed` : ''}.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  {[
                    ['all', `All (${editLines.length})`],
                    ['matched', `Matched (${matchedN})`],
                    ['unmatched', `Unreviewed (${unmatchedN})`],
                  ].map(([k, label]) => (
                    <button key={k} onClick={() => setReconFilter(k)}
                      style={{ padding: '7px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                        background: reconFilter === k ? (k === 'unmatched' ? '#b8740a' : '#0d1b2a') : '#f3f1ec',
                        color: reconFilter === k ? '#fff' : '#777' }}>
                      {label}
                    </button>
                  ))}
                  {unmatchedN > 0 && reconFilter !== 'unmatched' && (
                    <span style={{ fontSize: 12, color: '#b8740a', fontWeight: 600 }}>· {unmatchedN} line{unmatchedN === 1 ? '' : 's'} still need review</span>
                  )}
                </div>
                <div className="rec-scroll" style={{ maxHeight: '48vh', overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 12 }}>
                  <table className="rec-table" style={{ minWidth: 640 }}>
                    <thead><tr>
                      <th>Date</th><th>Bank line</th><th style={{ textAlign: 'right' }}>Amount</th><th>Matched to</th>
                    </tr></thead>
                    {shownDays.map(day => (
                    <tbody key={day.key}>
                      <tr className="rec-day">
                        <td colSpan={2}>{fmtDate(day.key)}<span style={{ color: '#c4bcb0', fontWeight: 500 }}> · {day.rows.length} line{day.rows.length > 1 ? 's' : ''}</span></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {day.in > 0 && <span style={{ color: '#1D9E75', fontWeight: 700 }}>+{money(day.in)}</span>}
                          {day.in > 0 && day.out > 0 && <span style={{ color: '#ddd' }}> / </span>}
                          {day.out > 0 && <span style={{ color: '#E24B4A', fontWeight: 700 }}>−{money(day.out)}</span>}
                        </td>
                        <td />
                      </tr>
                      {day.rows.map(({ l, idx }) => {
                        const matched = l.matchId ? bookById[l.matchId] : null
                        return (
                          <tr key={idx} className={l.matchId || l.ignored ? '' : 'unmatched'}>
                            <td style={{ whiteSpace: 'nowrap', color: '#bbb', fontSize: 11.5 }}>{fmtDate(l.date)}</td>
                            <td>
                              <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{l.party || l.type || 'Transaction'}</div>
                              <div style={{ fontSize: 11, color: '#aaa' }}>{l.type}{l.ref ? ` · ${l.ref}` : ''}</div>
                            </td>
                            <td style={{ textAlign: 'right' }} className={l.isIn ? 'rec-in' : 'rec-out'}>
                              {l.isIn ? '+' : '−'}{money(l.amount)}
                            </td>
                            <td>
                              {matched ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                  <span className="rec-pill" style={{ background: '#E1F5EE', color: '#1D9E75' }}><CheckCircle size={12} /> {matched.label}</span>
                                  <button onClick={() => setEditLines(ls => ls.map((x, i) => i === idx ? { ...x, matchId: null } : x))} title="Unmatch"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc' }}><X size={13} /></button>
                                </span>
                              ) : l.matchId ? (
                                // matched to a book entry that no longer exists
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                  <span className="rec-pill" style={{ background: '#f5f5f5', color: '#999' }}>Matched (record deleted)</span>
                                  <button onClick={() => setEditLines(ls => ls.map((x, i) => i === idx ? { ...x, matchId: null } : x))} title="Unmatch"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc' }}><X size={13} /></button>
                                </span>
                              ) : l.ignored ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                  <span className="rec-pill" style={{ background: '#EFEDFB', color: '#7F77DD' }}><EyeOff size={12} /> {l.reason || 'Explained'}</span>
                                  <button onClick={() => setEditLines(ls => ls.map((x, i) => i === idx ? { ...x, ignored: false, reason: '' } : x))} title="Put it back for review"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc' }}><X size={13} /></button>
                                </span>
                              ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                  <span className="rec-pill" style={{ background: '#FFF3D6', color: '#b8740a' }}><AlertTriangle size={12} /> Unreviewed</span>
                                  <select className="rec-sel" value="" onChange={e => { const v = e.target.value; if (v) setEditLines(ls => ls.map((x, i) => i === idx ? { ...x, matchId: v } : x)) }}>
                                    <option value="">Match to…</option>
                                    {reconCandidates(l, idx).map(b => (
                                      <option key={b.id} value={b.id}>{money(b.amount)} · {fmtDate(b.date)} · {b.label}</option>
                                    ))}
                                  </select>
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    ))}
                    {shown.length === 0 && (
                      <tbody><tr><td colSpan={4} style={{ textAlign: 'center', color: '#bbb', padding: '22px 0' }}>
                        {reconFilter === 'unmatched' ? 'Nothing left to review — every line is matched. 🎉' : 'No lines here.'}
                      </td></tr></tbody>
                    )}
                  </table>
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
                  <Button variant="ghost" onClick={() => setViewRecon(null)}>Close</Button>
                  <Button onClick={saveReconEdits} disabled={savingEdit || !dirty}>
                    {savingEdit ? 'Saving…' : dirty ? <><CheckCircle size={14} /> Save changes</> : 'No changes'}
                  </Button>
                </div>
              </>
            )}
          </Modal>
        )
      })()}

      {/* ── Record a missing expense straight from a bank line ── */}
      {expenseModal && (
        <Modal title="Record this as an expense"
          subtitle="Writes it into your books and matches this bank line to it"
          onClose={() => setExpenseModal(null)} width={480}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Description</label>
              <input value={expenseModal.description} onChange={e => setExpenseModal(f => ({ ...f, description: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Category</label>
              <select value={expenseModal.category} onChange={e => setExpenseModal(f => ({ ...f, category: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fff' }}>
                {expenseCategories.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Amount</label>
                <input type="number" value={expenseModal.amount} onChange={e => setExpenseModal(f => ({ ...f, amount: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>Date</label>
                <input type="date" value={expenseModal.expense_date} onChange={e => setExpenseModal(f => ({ ...f, expense_date: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit' }} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
            <Button variant="ghost" onClick={() => setExpenseModal(null)}>Cancel</Button>
            <Button onClick={saveExpenseFromLine} disabled={saving || !Number(expenseModal.amount)}>
              {saving ? 'Saving…' : 'Record & match'}
            </Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
