import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Spinner, useToast, Toasts, Modal } from '../components/UI'
import { Upload, CheckCircle, AlertTriangle, X, Scale, Trash2, Plus, FileSpreadsheet, ChevronDown, Eye } from 'lucide-react'
import { getSettings } from '../lib/settings'

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
  const fileRef = useRef(null)
  const toast = useToast()

  const currency = getSettings().currency || 'MVR'
  const money = n => `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, e, sp] = await Promise.all([
      supabase.from('orders').select('id, customer_name, invoice_number, total_price, payment_status, payment_method, transfer_reference, paid_at, order_date'),
      supabase.from('expenses').select('id, expense_date, category, amount, description'),
      supabase.from('supplier_payments').select('id, supplier_name, amount, payment_date, reference'),
    ])
    setOrders(o.data || [])
    setExpenses(e.data || [])
    setSupplierPayments(sp.data || [])
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

  // Books — money IN (paid orders) and money OUT (expenses + supplier payments)
  const bookIn = useMemo(() => orders
    .filter(o => (o.payment_status === 'paid' || o.payment_status === 'partial') && Number(o.total_price) > 0)
    .map(o => ({
      id: 'order:' + o.id, kind: 'order',
      date: new Date(o.paid_at || o.order_date),
      amount: Number(o.total_price), ref: o.transfer_reference || '',
      label: `${o.customer_name || 'Order'}${o.invoice_number ? ' · ' + o.invoice_number : ''}`,
      method: o.payment_method || '',
    })), [orders])

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
  ], [expenses, supplierPayments])

  const bookById = useMemo(() => {
    const m = {}
    ;[...bookIn, ...bookOut].forEach(b => { m[b.id] = b })
    return m
  }, [bookIn, bookOut])

  // Auto-match: reference first, then amount + date (±5 days). Each book entry used once.
  function autoMatch(txns) {
    const used = new Set(reconciledIds)
    return txns.map(t => {
      const isIn = t.credit > 0
      const amt = isIn ? t.credit : t.debit
      const pool = isIn ? bookIn : bookOut
      let m = t.ref ? pool.find(b => !used.has(b.id) && b.ref && normRef(b.ref) === normRef(t.ref)) : null
      if (!m) m = pool.find(b => !used.has(b.id) && Math.abs(b.amount - amt) < 0.01 && daysApart(b.date, t.date) <= 5)
      if (m) used.add(m.id)
      return { stmt: t, amt, isIn, matchId: m ? m.id : null }
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
    setMatches(ms => ms.map((m, i) => i === idx ? { ...m, matchId } : m))
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
    const credits = matches.filter(m => m.isIn).reduce((s, m) => s + m.amt, 0)
    const debits = matches.filter(m => !m.isIn).reduce((s, m) => s + m.amt, 0)
    const matchedIn = matches.filter(m => m.isIn && m.matchId).reduce((s, m) => s + m.amt, 0)
    const matchedOut = matches.filter(m => !m.isIn && m.matchId).reduce((s, m) => s + m.amt, 0)
    const unmatched = matches.filter(m => !m.matchId)
    const stmtClosing = stmtTxns && stmtTxns.length ? stmtTxns[stmtTxns.length - 1].balance : 0
    return {
      credits, debits, net: credits - debits,
      matchedIn, matchedOut, matchedNet: matchedIn - matchedOut,
      unmatchedCount: unmatched.length,
      unexplained: (credits - debits) - (matchedIn - matchedOut),
      stmtClosing,
      periodEnd: stmtTxns && stmtTxns.length ? stmtTxns[stmtTxns.length - 1].date : null,
      periodStart: stmtTxns && stmtTxns.length ? stmtTxns[0].date : null,
    }
  }, [matches, stmtTxns])

  async function finish() {
    const cleared = matches.filter(m => m.matchId).map(m => m.matchId)
    if (!cleared.length) { toast.error('Nothing matched to reconcile'); return }
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
                <span style={{ color: '#1D9E75', fontWeight: 700 }}>{matches.filter(m => m.matchId).length} matched</span>
                {sum.unmatchedCount > 0 && <span style={{ color: '#b8740a', fontWeight: 700 }}> · {sum.unmatchedCount} need review</span>}
                {fileName && <span style={{ color: '#aaa' }}> · {fileName}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="ghost" onClick={cancelUpload}>Cancel</Button>
                <Button onClick={finish} disabled={saving}>{saving ? 'Saving…' : <><CheckCircle size={14} /> Finish reconciliation</>}</Button>
              </div>
            </div>
            {Math.abs(sum.unexplained) >= 0.01 && (
              <div style={{ marginTop: 12, background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#a16d0a' }}>
                <strong>{money(Math.abs(sum.unexplained))}</strong> of bank movement isn't matched to your books yet. Match the highlighted rows below (or record the missing transaction) to bring this to zero.
              </div>
            )}
          </Card>

          {/* Match table */}
          <Card>
            <div className="rec-scroll">
              <table className="rec-table">
                <thead><tr>
                  <th>Date</th><th>Bank line</th><th style={{ textAlign: 'right' }}>Amount</th><th>Matched to</th>
                </tr></thead>
                <tbody>
                  {matches.map((m, idx) => {
                    const matched = m.matchId ? bookById[m.matchId] : null
                    return (
                      <tr key={idx} className={m.matchId ? '' : 'unmatched'}>
                        <td style={{ whiteSpace: 'nowrap', color: '#666' }}>{fmtDate(m.stmt.date)}</td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{m.stmt.party || m.stmt.type || 'Transaction'}</div>
                          <div style={{ fontSize: 11, color: '#aaa' }}>{m.stmt.type}{m.stmt.ref ? ` · ${m.stmt.ref}` : ''}</div>
                        </td>
                        <td style={{ textAlign: 'right' }} className={m.isIn ? 'rec-in' : 'rec-out'}>
                          {m.isIn ? '+' : '−'}{money(m.amt)}
                        </td>
                        <td>
                          {matched ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span className="rec-pill" style={{ background: '#E1F5EE', color: '#1D9E75' }}><CheckCircle size={12} /> {matched.label}</span>
                              <button onClick={() => setMatch(idx, null)} title="Unmatch" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc' }}><X size={13} /></button>
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span className="rec-pill" style={{ background: '#FFF3D6', color: '#b8740a' }}><AlertTriangle size={12} /> Unmatched</span>
                              <select className="rec-sel" value="" onChange={e => e.target.value && setMatch(idx, e.target.value)}>
                                <option value="">Match to…</option>
                                {candidates(m, idx).map(b => (
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
              </table>
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 12, lineHeight: 1.6 }}>
              Highlighted rows are bank movements not yet found in your books — they're usually unrecorded sales, bank fees, or cash you haven't logged. Match them to an existing record, or add the missing entry in Orders/Cost Management, then re-upload. Click <strong>Finish</strong> to save and mark the matched transactions reconciled.
            </div>
          </Card>
        </>
      )}

      {/* ── View / edit a saved reconciliation ── */}
      {viewRecon && (() => {
        const matchedN = editLines.filter(l => l.matchId).length
        const unmatchedN = editLines.length - matchedN
        const shown = editLines
          .map((l, idx) => ({ l, idx }))
          .filter(({ l }) => reconFilter === 'all' ? true : reconFilter === 'matched' ? !!l.matchId : !l.matchId)
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
                    <tbody>
                      {shown.map(({ l, idx }) => {
                        const matched = l.matchId ? bookById[l.matchId] : null
                        return (
                          <tr key={idx} className={l.matchId ? '' : 'unmatched'}>
                            <td style={{ whiteSpace: 'nowrap', color: '#666' }}>{fmtDate(l.date)}</td>
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
                      {shown.length === 0 && (
                        <tr><td colSpan={4} style={{ textAlign: 'center', color: '#bbb', padding: '22px 0' }}>
                          {reconFilter === 'unmatched' ? 'Nothing left to review — every line is matched. 🎉' : 'No lines here.'}
                        </td></tr>
                      )}
                    </tbody>
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

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
