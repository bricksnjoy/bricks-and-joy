import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localToday } from '../lib/dates'
import { logAudit } from '../lib/audit'
import { PageHeader, Card, Button, Input, Select, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Wallet, Plus, Banknote, Scale, TrendingUp, TrendingDown, AlertTriangle, Trash2, ArrowRight } from 'lucide-react'

const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const money = n => `MVR ${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const money0 = n => `MVR ${Math.round(num(n)).toLocaleString('en-US')}`

// What counts as cash coming in: a sale actually settled in cash.
const isCashSale = o =>
  /cash/i.test(o.payment_method || '') &&
  (o.payment_status === 'paid' || o.payment_status === 'partial') &&
  o.status !== 'cancelled'

export default function Cash() {
  const [orders, setOrders] = useState([])
  const [expenses, setExpenses] = useState([])
  const [moves, setMoves] = useState([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [modal, setModal] = useState(null)   // 'banked' | 'count' | 'adjustment'
  const [form, setForm] = useState({ amount: '', occurred_on: localToday(), reference: '', note: '' })
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, e, m] = await Promise.all([
      supabase.from('orders').select('id, total_price, payment_method, payment_status, status, order_date, paid_at, customer_name, invoice_number'),
      supabase.from('expenses').select('id, amount, category, description, expense_date, paid_from'),
      supabase.from('cash_movements').select('*').order('occurred_on', { ascending: false }),
    ])
    if (m.error && /relation|does not exist|schema cache/i.test(m.error.message || '')) setNeedsSetup(true)
    setOrders(o.data || [])
    setExpenses(e.data || [])
    setMoves(m.data || [])
    setLoading(false)
  }

  // ── What should be in the drawer ────────────────────────────────────────────
  // Cash sales, less cash costs, less anything banked, plus or minus corrections.
  // A count doesn't move money — it records what was actually there.
  const position = useMemo(() => {
    const salesRows = orders.filter(isCashSale)
    const sales = salesRows.reduce((s, o) => s + num(o.total_price), 0)
    const costRows = expenses.filter(e => (e.paid_from || 'bank') === 'cash')
    const costs = costRows.reduce((s, e) => s + num(e.amount), 0)
    const banked = moves.filter(m => m.kind === 'banked').reduce((s, m) => s + num(m.amount), 0)
    const adjust = moves.filter(m => m.kind === 'adjustment').reduce((s, m) => s + num(m.amount), 0)
    const lastCount = moves.filter(m => m.kind === 'count')
      .sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)))[0] || null
    return {
      sales, salesCount: salesRows.length, costs, costCount: costRows.length,
      banked, adjust, lastCount,
      expected: sales - costs - banked + adjust,
    }
  }, [orders, expenses, moves])

  // Every cash event on one timeline, newest first
  const ledger = useMemo(() => {
    const rows = [
      ...orders.filter(isCashSale).map(o => ({
        id: 'o' + o.id, date: o.order_date, dir: 'in', amount: num(o.total_price),
        label: `Cash sale · ${o.customer_name || 'Walk-in'}`, sub: o.invoice_number || '',
      })),
      ...expenses.filter(e => (e.paid_from || 'bank') === 'cash').map(e => ({
        id: 'e' + e.id, date: e.expense_date, dir: 'out', amount: num(e.amount),
        label: `${e.category || 'Cost'} · ${e.description || ''}`, sub: 'paid in cash',
      })),
      ...moves.map(m => ({
        id: 'm' + m.id, date: m.occurred_on, kind: m.kind,
        dir: m.kind === 'banked' ? 'out' : m.kind === 'adjustment' ? (num(m.amount) >= 0 ? 'in' : 'out') : 'none',
        amount: Math.abs(num(m.amount)),
        label: m.kind === 'banked' ? 'Banked into BML'
          : m.kind === 'count' ? 'Cash counted'
            : 'Correction',
        sub: m.kind === 'count'
          ? `counted ${money(m.amount)} against ${money(m.expected)}`
          : [m.reference && `Ref ${m.reference}`, m.note].filter(Boolean).join(' · '),
        variance: m.kind === 'count' ? num(m.variance) : null,
        raw: m,
      })),
    ]
    return rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  }, [orders, expenses, moves])

  function open(kind) {
    setForm({
      amount: kind === 'count' ? position.expected.toFixed(2) : '',
      occurred_on: localToday(), reference: '', note: '',
    })
    setModal(kind)
  }

  async function save() {
    const amount = num(form.amount)
    if (modal !== 'count' && amount === 0) { toast.error('Enter an amount'); return }
    setSaving(true)
    const row = {
      kind: modal,
      amount: modal === 'adjustment' ? amount : Math.abs(amount),
      occurred_on: form.occurred_on,
      reference: form.reference || null,
      note: form.note || null,
    }
    if (modal === 'count') {
      // A count is a measurement, not a movement — record the gap and let the
      // owner decide whether to correct it.
      row.expected = +position.expected.toFixed(2)
      row.variance = +(amount - position.expected).toFixed(2)
    }
    const { error } = await supabase.from('cash_movements').insert(row)
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    logAudit('create', 'cash', `${modal} ${money(amount)}`, { kind: modal, amount })
    toast.success(modal === 'banked' ? 'Banked — it will match the deposit on your next statement'
      : modal === 'count' ? 'Count recorded' : 'Correction recorded')
    setModal(null); load()
  }

  async function del(m) {
    if (!window.confirm(`Delete this ${m.kind} entry?`)) return
    await supabase.from('cash_movements').delete().eq('id', m.id)
    toast.success('Deleted'); load()
  }

  // Turn a count's shortfall into a correction, so the expected figure matches
  // what is really there instead of drifting further each month.
  async function applyVariance(m) {
    const v = num(m.variance)
    if (!v) return
    if (!window.confirm(`Record a correction of ${money(v)} so the expected cash matches the ${money(m.amount)} you counted on ${m.occurred_on}?`)) return
    const { error } = await supabase.from('cash_movements').insert({
      kind: 'adjustment', amount: v, occurred_on: m.occurred_on,
      note: `Correction after the count on ${m.occurred_on}`,
    })
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Correction recorded'); load()
  }

  if (loading) return <Spinner />

  const lc = position.lastCount
  const drift = lc ? num(lc.variance) : 0

  return (
    <div>
      <PageHeader title="Cash in hand"
        subtitle="What should be in the drawer, what is actually there, and what you have banked"
        action={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => open('count')} disabled={needsSetup}><Scale size={14} /> Count the drawer</Button>
            <Button onClick={() => open('banked')} disabled={needsSetup}><Banknote size={15} /> Bank cash</Button>
          </div>
        } />

      {needsSetup && (
        <Card style={{ marginBottom: 16, background: '#fffaf2', border: '1px solid #f3e4c8' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, color: '#8a6a2a', lineHeight: 1.6 }}>
            <AlertTriangle size={16} color="#e6940a" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>The <code>cash_movements</code> table isn't in your database yet, so banking and counts can't be saved. Run the cash block from <code>supabase_schema.sql</code>.</span>
          </div>
        </Card>
      )}

      {/* Position */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }} className="grid-collapse">
        {[
          ['In the drawer now', money0(position.expected), position.expected >= 0 ? '#0d1b2a' : '#E24B4A', '#f5f5f7', 'what the books say'],
          ['Cash sales', money0(position.sales), '#1D9E75', '#E9F7F1', `${position.salesCount} order${position.salesCount === 1 ? '' : 's'}`],
          ['Paid out in cash', money0(position.costs), '#E24B4A', '#FDECEC', `${position.costCount} cost${position.costCount === 1 ? '' : 's'}`],
          ['Banked', money0(position.banked), '#2f6fc0', '#EAF2FD', 'moved into BML'],
        ].map(([label, value, color, bg, sub]) => (
          <div key={label} style={{ background: bg, borderRadius: 14, padding: '15px 17px' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color, letterSpacing: '-0.5px' }}>{value}</div>
            <div style={{ fontSize: 11.5, color: '#888', fontWeight: 600, marginTop: 3 }}>{label}</div>
            <div style={{ fontSize: 10.5, color: '#aaa', marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Last count */}
      {lc && (
        <Card style={{ marginBottom: 18, background: Math.abs(drift) < 0.01 ? '#f2faf5' : '#fffaf2', border: `1px solid ${Math.abs(drift) < 0.01 ? '#cfe8db' : '#f3e4c8'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Scale size={17} color={Math.abs(drift) < 0.01 ? '#1D9E75' : '#e6940a'} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>
                {Math.abs(drift) < 0.01
                  ? `Counted on ${lc.occurred_on} and it matched exactly`
                  : `Counted on ${lc.occurred_on} — ${money(Math.abs(drift))} ${drift > 0 ? 'more' : 'less'} than expected`}
              </div>
              <div style={{ fontSize: 11.5, color: '#a9a094', marginTop: 3 }}>
                Counted {money(lc.amount)} against {money(lc.expected)} in the books
                {drift < 0 && ' — usually a sale taken in cash but never recorded, or change given wrong'}
                {drift > 0 && ' — usually a cash sale recorded twice, or money put in from elsewhere'}
              </div>
            </div>
            {Math.abs(drift) >= 0.01 && (
              <Button size="sm" variant="ghost" onClick={() => applyVariance(lc)}>Record the difference</Button>
            )}
          </div>
        </Card>
      )}

      {/* Ledger */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '15px 20px', borderBottom: '1px solid #f2f2f2', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>Cash movements</div>
            <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 2 }}>
              Sales settled in cash, costs paid from the drawer, and what you have banked
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => open('adjustment')} disabled={needsSetup}><Plus size={13} /> Correction</Button>
        </div>

        {ledger.length === 0 ? (
          <div style={{ padding: '46px 20px', textAlign: 'center', color: '#bbb' }}>
            <Wallet size={30} color="#e0dcd4" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 13.5 }}>No cash movements yet.</div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>A sale recorded as paid by Cash, or a cost marked as paid from cash, will show here.</div>
          </div>
        ) : (
          <div className="x-scroll-wrap">
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#fbfaf8' }}>
                  {['Date', 'What', 'In', 'Out', ''].map((h, i) => (
                    <th key={h + i} style={{ padding: '9px 12px', textAlign: i > 1 ? 'right' : 'left', fontSize: 10.5, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.slice(0, 200).map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '10px 12px', color: '#999', whiteSpace: 'nowrap' }}>{r.date || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{r.label}</div>
                      {r.sub && <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>{r.sub}</div>}
                      {r.variance != null && Math.abs(r.variance) >= 0.01 && (
                        <Badge color={r.variance < 0 ? 'red' : 'amber'}>{r.variance > 0 ? '+' : ''}{money(r.variance)}</Badge>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#1D9E75', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {r.dir === 'in' ? '+' + money(r.amount) : ''}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#E24B4A', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {r.dir === 'out' ? '−' + money(r.amount) : ''}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {r.raw && (
                        <button onClick={() => del(r.raw)} title="Delete"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'inline-flex' }}>
                          <Trash2 size={13} color="#d5cfc6" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Bank / count / correct */}
      {modal && (
        <Modal
          title={modal === 'banked' ? 'Bank the cash' : modal === 'count' ? 'Count the drawer' : 'Record a correction'}
          subtitle={modal === 'banked' ? 'Moves it out of the drawer and into BML'
            : modal === 'count' ? 'What is physically there right now'
              : 'Use this to fix the expected figure when you know why it is out'}
          onClose={() => setModal(null)} width={480}>

          {modal === 'count' && (
            <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 15px', marginBottom: 14, fontSize: 12.5, color: '#666', display: 'flex', justifyContent: 'space-between' }}>
              <span>The books expect</span><b style={{ color: '#0d1b2a' }}>{money(position.expected)}</b>
            </div>
          )}

          <FormRow>
            <Input label={modal === 'count' ? 'Counted (MVR) *' : 'Amount (MVR) *'} type="number" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            <Input label="Date" type="date" value={form.occurred_on}
              onChange={e => setForm(f => ({ ...f, occurred_on: e.target.value }))} />
          </FormRow>

          {modal === 'banked' && (
            <>
              <Input label="Deposit reference" value={form.reference} placeholder="from the deposit slip — lets it match your statement"
                onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 11.5, color: '#aaa', marginBottom: 14, lineHeight: 1.6 }}>
                This becomes a “Cash banked” line in Reconciliation. With the reference filled in it matches your statement's deposit on its own.
              </div>
            </>
          )}
          <Input label="Note" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={{ marginBottom: 14 }} />

          {modal === 'count' && num(form.amount) !== 0 && (
            <div style={{ background: Math.abs(num(form.amount) - position.expected) < 0.01 ? '#f2faf5' : '#fffaf2',
              border: `1px solid ${Math.abs(num(form.amount) - position.expected) < 0.01 ? '#cfe8db' : '#f3e4c8'}`,
              borderRadius: 9, padding: '10px 13px', marginBottom: 14, fontSize: 12.5,
              color: Math.abs(num(form.amount) - position.expected) < 0.01 ? '#2c7a54' : '#8a6a2a' }}>
              {Math.abs(num(form.amount) - position.expected) < 0.01
                ? '✓ Matches the books exactly.'
                : `${money(Math.abs(num(form.amount) - position.expected))} ${num(form.amount) > position.expected ? 'more' : 'less'} than the books expect.`}
            </div>
          )}
          {modal === 'adjustment' && (
            <div style={{ fontSize: 11.5, color: '#aaa', marginBottom: 14, lineHeight: 1.6 }}>
              A positive figure adds to the drawer, a negative one takes away. Corrections are visible in the ledger, so nothing disappears quietly.
            </div>
          )}

          {modal === 'banked' && num(form.amount) > position.expected + 0.01 && (
            <div style={{ background: '#fffaf2', border: '1px solid #f3e4c8', borderRadius: 9, padding: '10px 13px', marginBottom: 14, fontSize: 12.5, color: '#8a6a2a' }}>
              That is more than the {money(position.expected)} the books say is in the drawer.
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : modal === 'banked' ? <><ArrowRight size={13} /> Bank it</> : modal === 'count' ? 'Record the count' : 'Record correction'}
            </Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
