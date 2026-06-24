import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Spinner, useToast, Toasts } from '../components/UI'
import { Save, AlertTriangle, TrendingDown, Target } from 'lucide-react'
import { getSettings } from '../lib/settings'

const CATEGORIES = ['Giveaway', 'Sample Testing', 'Marketing Ads', 'Instagram Ads', 'Facebook Ads', 'Packaging', 'Shipping', 'Staff / Salary', 'Rent / Warehouse', 'Utilities', 'Returns / Refunds', 'Other']
const LS_KEY = 'bnj_budgets_v1'
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} } }
const writeLocal = obj => localStorage.setItem(LS_KEY, JSON.stringify(obj))
const thisMonth = () => new Date().toISOString().slice(0, 7)

export default function Budget() {
  const [expenses, setExpenses] = useState([])
  const [budgets, setBudgets] = useState({})   // { category: monthlyAmount }
  const [month, setMonth] = useState(thisMonth())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [usingLocal, setUsingLocal] = useState(false)
  const toast = useToast()

  const currency = getSettings().currency || 'MVR'
  const money = n => `${currency} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const { data: exp } = await supabase.from('expenses').select('category, amount, expense_date')
    setExpenses(exp || [])
    const { data: b, error } = await supabase.from('budgets').select('category, amount')
    if (error) { setUsingLocal(true); setBudgets(readLocal()) }
    else {
      const rows = b || []
      const local = readLocal()
      if (rows.length === 0 && Object.keys(local).length) { setUsingLocal(true); setBudgets(local) }
      else { setUsingLocal(false); const m = {}; rows.forEach(r => { m[r.category] = Number(r.amount) }); setBudgets(m) }
    }
    setLoading(false)
  }

  // Actual spend per category for the selected month
  const actualByCat = useMemo(() => {
    const m = {}
    expenses.filter(e => (e.expense_date || '').startsWith(month)).forEach(e => {
      m[e.category || 'Other'] = (m[e.category || 'Other'] || 0) + Number(e.amount || 0)
    })
    return m
  }, [expenses, month])

  // Rows: all preset categories + any extra that has a budget or spend this month
  const categories = useMemo(() => {
    const set = new Set(CATEGORIES)
    Object.keys(budgets).forEach(c => set.add(c))
    Object.keys(actualByCat).forEach(c => set.add(c))
    return [...set]
  }, [budgets, actualByCat])

  const rows = useMemo(() => categories.map(cat => {
    const budget = Number(budgets[cat] || 0)
    const actual = Number(actualByCat[cat] || 0)
    const variance = actual - budget                 // positive = over budget
    const pct = budget > 0 ? Math.round(actual / budget * 100) : (actual > 0 ? 999 : 0)
    return { cat, budget, actual, variance, pct }
  }).sort((a, b) => b.actual - a.actual), [categories, budgets, actualByCat])

  const totals = useMemo(() => ({
    budget: rows.reduce((s, r) => s + r.budget, 0),
    actual: rows.reduce((s, r) => s + r.actual, 0),
  }), [rows])
  const totalVar = totals.actual - totals.budget

  function setBudget(cat, val) {
    setBudgets(b => ({ ...b, [cat]: val === '' ? '' : Number(val) }))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    const clean = {}
    Object.entries(budgets).forEach(([c, v]) => { clean[c] = Number(v) || 0 })
    if (usingLocal) {
      writeLocal(clean); setBudgets(clean)
    } else {
      const records = Object.entries(clean).map(([category, amount]) => ({ category, amount }))
      const { error } = await supabase.from('budgets').upsert(records, { onConflict: 'category' })
      if (error) { setUsingLocal(true); writeLocal(clean); toast.info('Saved on this device — create the budgets table to sync.') }
    }
    setSaving(false); setDirty(false)
    toast.success('Budgets saved')
  }

  const barColor = pct => pct >= 100 ? '#E24B4A' : pct >= 80 ? '#f57f17' : '#1D9E75'
  const overCount = rows.filter(r => r.budget > 0 && r.actual > r.budget).length

  return (
    <div>
      <style>{`
        .bd-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px,1fr)); gap:12px; margin-bottom:18px; }
        .bd-card { border-radius:14px; padding:15px 17px; }
        .bd-card .v { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
        .bd-card .l { font-size:12px; color:#888; font-weight:600; margin-top:3px; }
        .bd-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        table.bd-table { width:100%; border-collapse:collapse; font-size:13px; min-width:720px; }
        .bd-table th { text-align:left; font-size:11px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.4px; padding:9px 10px; border-bottom:2px solid #f0f0f0; white-space:nowrap; }
        .bd-table th.n, .bd-table td.n { text-align:right; }
        .bd-table td { padding:10px 10px; border-bottom:1px solid #f5f5f5; vertical-align:middle; }
        .bd-in { width:120px; border:1px solid #ddd; border-radius:8px; padding:7px 10px; font-size:13px; font-family:inherit; text-align:right; outline:none; }
        .bd-in:focus { border-color:#FFA500; }
        .bd-bar { height:7px; background:#f0f0f0; border-radius:99px; overflow:hidden; margin-top:5px; }
        @media (max-width:600px){ .bd-card .v { font-size:19px; } .bd-in { width:90px; } }
      `}</style>

      <PageHeader title="Budget vs Actual" subtitle="Set a monthly budget per category and track your spending against it."
        action={<Button onClick={save} disabled={!dirty || saving}><Save size={14} /> {saving ? 'Saving…' : dirty ? 'Save budgets' : 'Saved'}</Button>} />

      {loading ? <Spinner /> : (
        <>
          {usingLocal && (
            <div style={{ background: '#EAF2FD', border: '1px solid #cfe0f5', borderRadius: 12, padding: '11px 15px', marginBottom: 16, fontSize: 12.5, color: '#2f6fc0', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Budgets are saved on this device only. Create a <strong>budgets</strong> table in Supabase to sync across devices (ask for the SQL).</span>
            </div>
          )}

          {/* Month + summary */}
          <Card style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: '#999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Month</label>
              <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                style={{ border: '1px solid #ddd', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              {overCount > 0 && <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: '#E24B4A', display: 'inline-flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {overCount} categor{overCount === 1 ? 'y' : 'ies'} over budget</span>}
            </div>
          </Card>

          <div className="bd-cards">
            <div className="bd-card" style={{ background: '#EAF2FD' }}><div className="v" style={{ color: '#2f6fc0' }}>{money(totals.budget)}</div><div className="l">Total monthly budget</div></div>
            <div className="bd-card" style={{ background: '#FFF6E2' }}><div className="v" style={{ color: '#b8740a' }}>{money(totals.actual)}</div><div className="l">Spent this month</div></div>
            <div className="bd-card" style={{ background: totalVar > 0 ? '#FDECEC' : '#E9F7F1' }}>
              <div className="v" style={{ color: totalVar > 0 ? '#E24B4A' : '#1D9E75' }}>{totalVar > 0 ? '+' : ''}{money(totalVar)}</div>
              <div className="l">{totalVar > 0 ? 'Over budget' : 'Under budget'}</div>
            </div>
            <div className="bd-card" style={{ background: '#f5f5f7' }}><div className="v" style={{ color: '#0d1b2a' }}>{totals.budget > 0 ? Math.round(totals.actual / totals.budget * 100) : 0}%</div><div className="l">Budget used</div></div>
          </div>

          {/* Table */}
          <Card>
            <div className="bd-scroll">
              <table className="bd-table">
                <thead><tr>
                  <th>Category</th><th className="n">Monthly budget</th><th className="n">Spent</th><th>Progress</th><th className="n">Variance</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.cat}>
                      <td style={{ fontWeight: 600, color: '#0d1b2a' }}>{r.cat}</td>
                      <td className="n">
                        <input className="bd-in" type="number" min="0" value={budgets[r.cat] ?? ''} placeholder="0" onChange={e => setBudget(r.cat, e.target.value)} />
                      </td>
                      <td className="n" style={{ fontWeight: 600 }}>{money(r.actual)}</td>
                      <td style={{ minWidth: 160 }}>
                        {r.budget > 0 ? (
                          <>
                            <div style={{ fontSize: 11, color: barColor(r.pct), fontWeight: 700 }}>{r.pct > 998 ? '—' : r.pct + '%'}</div>
                            <div className="bd-bar"><div style={{ width: `${Math.min(100, r.pct)}%`, height: '100%', background: barColor(r.pct), transition: 'width 0.3s' }} /></div>
                          </>
                        ) : <span style={{ fontSize: 12, color: '#ccc' }}>no budget set</span>}
                      </td>
                      <td className="n" style={{ fontWeight: 700, color: r.variance > 0 ? '#E24B4A' : r.budget > 0 ? '#1D9E75' : '#bbb' }}>
                        {r.budget > 0 ? `${r.variance > 0 ? '+' : ''}${money(r.variance)}` : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ fontWeight: 800, color: '#0d1b2a', borderTop: '2px solid #eee' }}>Total</td>
                    <td className="n" style={{ fontWeight: 800, borderTop: '2px solid #eee' }}>{money(totals.budget)}</td>
                    <td className="n" style={{ fontWeight: 800, borderTop: '2px solid #eee' }}>{money(totals.actual)}</td>
                    <td style={{ borderTop: '2px solid #eee' }}></td>
                    <td className="n" style={{ fontWeight: 800, color: totalVar > 0 ? '#E24B4A' : '#1D9E75', borderTop: '2px solid #eee' }}>{totalVar > 0 ? '+' : ''}{money(totalVar)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 12, lineHeight: 1.6 }}>
              Set a budget once and it applies every month. <strong>Spent</strong> is your actual expenses for the selected month (from Cost Management). <span style={{ color: '#E24B4A', fontWeight: 600 }}>Red</span> = over budget, <span style={{ color: '#f57f17', fontWeight: 600 }}>amber</span> = nearing the limit.
            </div>
          </Card>
        </>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
