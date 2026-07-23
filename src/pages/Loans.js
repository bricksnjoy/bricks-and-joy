import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localToday } from '../lib/dates'
import { PageHeader, Card, Button, Input, Modal, Spinner, FormRow, useToast, Toasts } from '../components/UI'
import { Plus, Trash2, Landmark, CreditCard } from 'lucide-react'

const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const money = n => `MVR ${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function Loans() {
  const [loans, setLoans] = useState([])
  const [pays, setPays] = useState([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loanModal, setLoanModal] = useState(false)
  const [loanForm, setLoanForm] = useState({ lender: '', amount: '', purpose: '', monthly_payment: '', taken_on: localToday(), notes: '' })
  const [payModal, setPayModal] = useState(null)
  const [payForm, setPayForm] = useState({ amount: '', paid_on: localToday(), notes: '' })
  const [saving, setSaving] = useState(false)
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
    const paid = pays.filter(p => p.loan_id === l.id).reduce((s, p) => s + num(p.amount), 0)
    return { ...l, paid, remaining: Math.max(0, num(l.amount) - paid) }
  }), [loans, pays])
  const totals = rows.reduce((t, l) => ({ amount: t.amount + num(l.amount), monthly: t.monthly + num(l.monthly_payment), paid: t.paid + l.paid, remaining: t.remaining + l.remaining }), { amount: 0, monthly: 0, paid: 0, remaining: 0 })

  async function saveLoan() {
    if (!loanForm.amount) { toast.error('Enter the amount'); return }
    setSaving(true)
    const { error } = await supabase.from('loans').insert({
      lender: loanForm.lender || null, amount: num(loanForm.amount), purpose: loanForm.purpose || null,
      monthly_payment: num(loanForm.monthly_payment), taken_on: loanForm.taken_on, notes: loanForm.notes || null,
    })
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Loan added'); setLoanModal(false)
    setLoanForm({ lender: '', amount: '', purpose: '', monthly_payment: '', taken_on: localToday(), notes: '' }); load()
  }
  async function savePayment() {
    if (!payForm.amount) { toast.error('Enter the amount'); return }
    setSaving(true)
    const { error } = await supabase.from('loan_payments').insert({ loan_id: payModal.id, amount: num(payForm.amount), paid_on: payForm.paid_on, notes: payForm.notes || null })
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Payment recorded'); setPayModal(null); setPayForm({ amount: '', paid_on: localToday(), notes: '' }); load()
  }
  async function delLoan(l) { if (!window.confirm(`Delete "${l.purpose || l.lender || 'loan'}" and its payments?`)) return; await supabase.from('loans').delete().eq('id', l.id); toast.success('Deleted'); load() }

  return (
    <div>
      <style>{`
        table.ln { width:100%; border-collapse:collapse; font-size:13px; min-width:720px; }
        .ln th { text-align:right; font-size:10.5px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.4px; padding:9px 10px; border-bottom:2px solid #f0f0f0; white-space:nowrap; }
        .ln th:first-child, .ln td:first-child { text-align:left; }
        .ln td { padding:10px; border-bottom:1px solid #f5f5f5; text-align:right; white-space:nowrap; }
        .ln tfoot td { border-top:2px solid #eee; font-weight:800; color:#0d1b2a; }
        .ln .pos { color:#1D9E75; } .ln .neg { color:#E24B4A; }
      `}</style>
      <PageHeader title="Loans" subtitle="What you took, what it was for, and how much is left"
        action={<Button onClick={() => setLoanModal(true)} disabled={needsSetup}><Plus size={15} /> Add loan</Button>} />

      {/* summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }} className="grid-collapse">
        <div style={{ background: '#EAF2FD', borderRadius: 14, padding: '16px 18px' }}><div style={{ fontSize: 22, fontWeight: 800, color: '#2f6fc0' }}>{money(totals.amount)}</div><div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginTop: 3 }}>Total borrowed</div></div>
        <div style={{ background: '#E9F7F1', borderRadius: 14, padding: '16px 18px' }}><div style={{ fontSize: 22, fontWeight: 800, color: '#1D9E75' }}>{money(totals.paid)}</div><div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginTop: 3 }}>Paid so far</div></div>
        <div style={{ background: '#FDECEC', borderRadius: 14, padding: '16px 18px' }}><div style={{ fontSize: 22, fontWeight: 800, color: '#E24B4A' }}>{money(totals.remaining)}</div><div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginTop: 3 }}>Remaining</div></div>
        <div style={{ background: '#FFF6E2', borderRadius: 14, padding: '16px 18px' }}><div style={{ fontSize: 22, fontWeight: 800, color: '#b8740a' }}>{money(totals.monthly)}</div><div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginTop: 3 }}>Monthly payments</div></div>
      </div>

      <Card>
        {needsSetup ? (
          <p style={{ color: '#667', fontSize: 14, lineHeight: 1.6 }}>The loans tables aren't set up yet in your database. If this persists, let me know and I'll create them.</p>
        ) : loading ? <Spinner /> : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb' }}>
            <Landmark size={34} color="#e0d8c8" style={{ marginBottom: 10 }} />
            <div style={{ fontWeight: 600, color: '#999' }}>No loans yet. Add one to track it.</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ln">
              <thead><tr><th>Lender</th><th>Used for</th><th>Taken on</th><th>Amount</th><th>Monthly</th><th>Paid</th><th>Left</th><th></th></tr></thead>
              <tbody>
                {rows.map(l => (
                  <tr key={l.id}>
                    <td>{l.lender || '—'}</td>
                    <td style={{ maxWidth: 240, whiteSpace: 'normal' }}>{l.purpose || '—'}</td>
                    <td>{l.taken_on || '—'}</td>
                    <td>{money(l.amount)}</td>
                    <td>{money(l.monthly_payment)}</td>
                    <td className="pos">{money(l.paid)}</td>
                    <td className={l.remaining > 0 ? 'neg' : 'pos'}>{money(l.remaining)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Button variant="ghost" size="sm" onClick={() => { setPayForm({ amount: l.monthly_payment || '', paid_on: localToday(), notes: '' }); setPayModal(l) }}><CreditCard size={13} /> Pay</Button>
                      <Button variant="danger" size="sm" onClick={() => delLoan(l)} style={{ marginLeft: 4 }}><Trash2 size={13} /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total</td><td>{money(totals.amount)}</td><td>{money(totals.monthly)}</td><td className="pos">{money(totals.paid)}</td><td className={totals.remaining > 0 ? 'neg' : 'pos'}>{money(totals.remaining)}</td><td></td></tr></tfoot>
            </table>
          </div>
        )}
      </Card>

      {loanModal && (
        <Modal title="Add a loan" subtitle="Track what you took and what it was for" onClose={() => setLoanModal(false)}>
          <FormRow>
            <Input label="Lender / source" value={loanForm.lender} onChange={e => setLoanForm(f => ({ ...f, lender: e.target.value }))} placeholder="e.g. BML, family" />
            <Input label="Amount (MVR) *" type="number" value={loanForm.amount} onChange={e => setLoanForm(f => ({ ...f, amount: e.target.value }))} />
          </FormRow>
          <FormRow>
            <Input label="Monthly payment (MVR)" type="number" value={loanForm.monthly_payment} onChange={e => setLoanForm(f => ({ ...f, monthly_payment: e.target.value }))} />
            <Input label="Taken on" type="date" value={loanForm.taken_on} onChange={e => setLoanForm(f => ({ ...f, taken_on: e.target.value }))} />
          </FormRow>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>What did you use it for?</label>
            <textarea value={loanForm.purpose} onChange={e => setLoanForm(f => ({ ...f, purpose: e.target.value }))} rows={2} placeholder="e.g. Stock purchase for Eid, new shelves"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setLoanModal(false)}>Cancel</Button>
            <Button onClick={saveLoan} disabled={saving || !loanForm.amount}>{saving ? 'Saving…' : 'Add loan'}</Button>
          </div>
        </Modal>
      )}
      {payModal && (
        <Modal title="Record a payment" subtitle={payModal.purpose || payModal.lender || 'Loan repayment'} onClose={() => setPayModal(null)}>
          <FormRow>
            <Input label="Amount (MVR) *" type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} />
            <Input label="Paid on" type="date" value={payForm.paid_on} onChange={e => setPayForm(f => ({ ...f, paid_on: e.target.value }))} />
          </FormRow>
          <Input label="Note (optional)" value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} style={{ marginBottom: 16 }} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setPayModal(null)}>Cancel</Button>
            <Button onClick={savePayment} disabled={saving || !payForm.amount}>{saving ? 'Saving…' : 'Record payment'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
