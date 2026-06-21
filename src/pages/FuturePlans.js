import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Spinner, useToast, Toasts } from '../components/UI'
import { Plus, Trash2, RotateCcw, TrendingUp, Megaphone, Package, Wallet, ShoppingBag, Boxes } from 'lucide-react'
import { getSettings } from '../lib/settings'

const LS_KEY = 'bnj_future_plans_v1'

// Seeded from the 18-month projection (odd months renew stock & sell; ads ramp up).
const TEMPLATE = [
  { month: '1st month',  sale: true,  stock_renew: 15000, inventory_value: 90000, expected_sales: 60000, remaining: 30000, ads: 840,  ad_details: '14 days & 3$' },
  { month: '2nd month',  sale: false, stock_renew: 0,     inventory_value: 0,     expected_sales: 0,     remaining: 0,     ads: 1120, ad_details: '14 days & 4$' },
  { month: '3rd month',  sale: false, stock_renew: 15000, inventory_value: 90000, expected_sales: 60000, remaining: 30000, ads: 840,  ad_details: '14 days & 3$' },
  { month: '4th month',  sale: true,  stock_renew: 0,     inventory_value: 0,     expected_sales: 0,     remaining: 0,     ads: 1120, ad_details: '14 days & 4$' },
  { month: '5th month',  sale: false, stock_renew: 15000, inventory_value: 90000, expected_sales: 60000, remaining: 30000, ads: 840,  ad_details: '14 days & 3$' },
  { month: '6th month',  sale: false, stock_renew: 0,     inventory_value: 0,     expected_sales: 0,     remaining: 0,     ads: 1120, ad_details: '14 days & 4$' },
  { month: '7th month',  sale: false, stock_renew: 15000, inventory_value: 90000, expected_sales: 60000, remaining: 30000, ads: 1680, ad_details: '21 days & 4$' },
  { month: '8th month',  sale: false, stock_renew: 0,     inventory_value: 0,     expected_sales: 0,     remaining: 0,     ads: 1260, ad_details: '21 days & 3$' },
  { month: '9th month',  sale: false, stock_renew: 15000, inventory_value: 90000, expected_sales: 60000, remaining: 30000, ads: 1680, ad_details: '21 days & 4$' },
  { month: '10th month', sale: false, stock_renew: 0,     inventory_value: 0,     expected_sales: 0,     remaining: 0,     ads: 1260, ad_details: '21 days & 3$' },
  { month: '11th month', sale: false, stock_renew: 15000, inventory_value: 90000, expected_sales: 60000, remaining: 30000, ads: 1680, ad_details: '21 days & 4$' },
  { month: '12th month', sale: false, stock_renew: 0,     inventory_value: 0,     expected_sales: 0,     remaining: 0,     ads: 1260, ad_details: '21 days & 3$' },
  { month: '13th month', sale: false, stock_renew: 15000, inventory_value: 90000, expected_sales: 60000, remaining: 30000, ads: 1680, ad_details: '21 days & 4$' },
  { month: '14th month', sale: false, stock_renew: 0,     inventory_value: 0,     expected_sales: 0,     remaining: 0,     ads: 1260, ad_details: '21 days & 3$' },
  { month: '15th month', sale: false, stock_renew: 15000, inventory_value: 90000, expected_sales: 60000, remaining: 30000, ads: 1800, ad_details: '30 days & 3$' },
  { month: '16th month', sale: false, stock_renew: 0,     inventory_value: 0,     expected_sales: 0,     remaining: 0,     ads: 1800, ad_details: '30 days & 3$' },
  { month: '17th month', sale: false, stock_renew: 15000, inventory_value: 90000, expected_sales: 60000, remaining: 30000, ads: 1800, ad_details: '30 days & 3$' },
  { month: '18th month', sale: false, stock_renew: 0,     inventory_value: 0,     expected_sales: 0,     remaining: 0,     ads: 1800, ad_details: '30 days & 3$' },
]

const cloneTemplate = () => TEMPLATE.map(r => ({ ...r }))
const readLocal = () => { try { const v = JSON.parse(localStorage.getItem(LS_KEY)); return Array.isArray(v) && v.length ? v : null } catch { return null } }
const writeLocal = arr => localStorage.setItem(LS_KEY, JSON.stringify(arr))

const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }

export default function FuturePlans() {
  const [rows, setRows] = useState(() => readLocal() || cloneTemplate())
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  const currency = getSettings().currency || 'MVR'
  const money = n => `${currency} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  useEffect(() => { load() }, [])
  // Persist whenever the plan changes
  useEffect(() => { writeLocal(rows) }, [rows])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('products').select('stock_qty, sell_price, cost_price, discontinued')
    setProducts(data || [])
    setLoading(false)
  }

  // Live value of stock you hold right now
  const live = useMemo(() => {
    const active = products.filter(p => !p.discontinued)
    const retail = active.reduce((s, p) => s + num(p.stock_qty) * num(p.sell_price), 0)
    const cost = active.reduce((s, p) => s + num(p.stock_qty) * num(p.cost_price), 0)
    const units = active.reduce((s, p) => s + num(p.stock_qty), 0)
    return { retail, cost, profit: retail - cost, units }
  }, [products])

  // Projection totals
  const totals = useMemo(() => rows.reduce((t, r) => ({
    stock_renew: t.stock_renew + num(r.stock_renew),
    inventory_value: t.inventory_value + num(r.inventory_value),
    expected_sales: t.expected_sales + num(r.expected_sales),
    remaining: t.remaining + num(r.remaining),
    ads: t.ads + num(r.ads),
  }), { stock_renew: 0, inventory_value: 0, expected_sales: 0, remaining: 0, ads: 0 }), [rows])

  // Projected profit = what you sell minus what you spend on stock & ads
  const projectedNet = totals.expected_sales - totals.stock_renew - totals.ads

  function update(idx, key, value) {
    setRows(rs => rs.map((r, i) => i === idx ? { ...r, [key]: value } : r))
  }
  function addRow() {
    setRows(rs => [...rs, { month: `${rs.length + 1}th month`, sale: false, stock_renew: 0, inventory_value: 0, expected_sales: 0, remaining: 0, ads: 0, ad_details: '' }])
  }
  function removeRow(idx) {
    setRows(rs => rs.filter((_, i) => i !== idx))
  }
  function resetTemplate() {
    if (!window.confirm('Reset the plan back to the 18-month template? Your edits will be lost.')) return
    setRows(cloneTemplate())
    toast.success('Reset to template')
  }

  const summaryCards = [
    { label: 'Projected sales (18 mo)', value: money(totals.expected_sales), icon: ShoppingBag, color: '#1D9E75', bg: '#E9F7F1' },
    { label: 'Stock renewal spend', value: money(totals.stock_renew), icon: Package, color: '#2f6fc0', bg: '#EAF2FD' },
    { label: 'Total ad spend', value: money(totals.ads), icon: Megaphone, color: '#b8740a', bg: '#FFF6E2' },
    { label: 'Projected net', value: money(projectedNet), icon: TrendingUp, color: projectedNet >= 0 ? '#1D9E75' : '#E24B4A', bg: projectedNet >= 0 ? '#E9F7F1' : '#FDECEC' },
  ]

  return (
    <div>
      <style>{`
        .fp-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:18px; }
        .fp-card { border-radius:14px; padding:16px 18px; display:flex; flex-direction:column; gap:8px; }
        .fp-card .fp-ic { width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; }
        .fp-card .fp-val { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
        .fp-card .fp-lab { font-size:12px; color:#888; font-weight:600; }
        .fp-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px; }
        table.fp-table { width:100%; border-collapse:collapse; font-size:13px; min-width:880px; }
        .fp-table th { text-align:left; font-size:11px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.5px; padding:10px 10px; border-bottom:2px solid #f0f0f0; white-space:nowrap; }
        .fp-table th.num, .fp-table td.num { text-align:right; }
        .fp-table td { padding:6px 8px; border-bottom:1px solid #f5f5f5; vertical-align:middle; }
        .fp-table tr.sale-row td { background:#FFFBF2; }
        .fp-in { width:100%; border:1px solid transparent; border-radius:7px; padding:7px 9px; font-size:13px; font-family:inherit; background:transparent; outline:none; transition:border 0.12s, background 0.12s; box-sizing:border-box; }
        .fp-in:hover { background:#fafafa; }
        .fp-in:focus { border-color:#FFA500; background:#fff; }
        .fp-in.num { text-align:right; }
        .fp-month { font-weight:600; color:#0d1b2a; min-width:120px; }
        .fp-table tfoot td { padding:12px 10px; border-top:2px solid #eee; font-weight:800; color:#0d1b2a; font-size:13.5px; }
        .fp-del { background:none; border:none; cursor:pointer; color:#ccc; padding:6px; border-radius:7px; display:flex; align-items:center; transition:all 0.12s; }
        .fp-del:hover { color:#E24B4A; background:#fdecec; }
        .fp-sale-toggle { width:30px; height:18px; border-radius:99px; position:relative; transition:background 0.18s; cursor:pointer; border:none; padding:0; }
        .fp-sale-toggle .knob { position:absolute; top:2px; width:14px; height:14px; border-radius:50%; background:#fff; transition:left 0.18s; box-shadow:0 1px 2px rgba(0,0,0,0.25); }
        @media (max-width: 600px) { .fp-card .fp-val { font-size:19px; } }
      `}</style>

      <PageHeader
        title="Future Plans"
        subtitle="Your month-by-month business projection — stock, sales, ads & profit. Tap any cell to edit; it saves automatically."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={resetTemplate}><RotateCcw size={14} /> Reset</Button>
            <Button onClick={addRow}><Plus size={15} /> Add month</Button>
          </div>
        }
      />

      {/* Live inventory value — "how much you'd get selling everything you hold now" */}
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Boxes size={16} color="#FFA500" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>If you sell everything in stock right now</span>
        </div>
        <div style={{ fontSize: 12.5, color: '#999', marginBottom: 14 }}>Based on current inventory × sell price{loading ? ' · loading…' : ''}</div>
        <div className="fp-cards" style={{ marginBottom: 0 }}>
          <div className="fp-card" style={{ background: '#E9F7F1' }}>
            <div className="fp-ic" style={{ background: '#1D9E7522' }}><Wallet size={18} color="#1D9E75" /></div>
            <div className="fp-val" style={{ color: '#1D9E75' }}>{money(live.retail)}</div>
            <div className="fp-lab">Sell-through value (you'd receive)</div>
          </div>
          <div className="fp-card" style={{ background: '#EAF2FD' }}>
            <div className="fp-ic" style={{ background: '#2f6fc022' }}><Package size={18} color="#2f6fc0" /></div>
            <div className="fp-val" style={{ color: '#2f6fc0' }}>{money(live.cost)}</div>
            <div className="fp-lab">What it cost you</div>
          </div>
          <div className="fp-card" style={{ background: '#FFF6E2' }}>
            <div className="fp-ic" style={{ background: '#b8740a22' }}><TrendingUp size={18} color="#b8740a" /></div>
            <div className="fp-val" style={{ color: '#b8740a' }}>{money(live.profit)}</div>
            <div className="fp-lab">Potential profit</div>
          </div>
          <div className="fp-card" style={{ background: '#f5f5f7' }}>
            <div className="fp-ic" style={{ background: '#88888822' }}><Boxes size={18} color="#666" /></div>
            <div className="fp-val" style={{ color: '#0d1b2a' }}>{live.units.toLocaleString()}</div>
            <div className="fp-lab">Units in stock</div>
          </div>
        </div>
      </Card>

      {/* Projection summary */}
      <div className="fp-cards">
        {summaryCards.map((c, i) => (
          <div key={i} className="fp-card" style={{ background: c.bg }}>
            <div className="fp-ic" style={{ background: c.color + '22' }}><c.icon size={18} color={c.color} /></div>
            <div className="fp-val" style={{ color: c.color }}>{c.value}</div>
            <div className="fp-lab">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Editable projection table */}
      <Card>
        <div className="fp-scroll">
          <table className="fp-table">
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'center' }}>Sale</th>
                <th className="num">Stock renew</th>
                <th className="num">Inventory value</th>
                <th className="num">Expected sales</th>
                <th className="num">Remaining</th>
                <th className="num">Ads</th>
                <th>Ad details</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className={r.sale ? 'sale-row' : ''}>
                  <td>
                    <input className="fp-in fp-month" value={r.month} onChange={e => update(idx, 'month', e.target.value)} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="fp-sale-toggle" onClick={() => update(idx, 'sale', !r.sale)}
                      title={r.sale ? 'Sale month' : 'No sale'}
                      style={{ background: r.sale ? '#FFA500' : '#ddd' }}>
                      <span className="knob" style={{ left: r.sale ? 14 : 2 }} />
                    </button>
                  </td>
                  <td className="num"><input className="fp-in num" type="number" value={r.stock_renew} onChange={e => update(idx, 'stock_renew', e.target.value)} /></td>
                  <td className="num"><input className="fp-in num" type="number" value={r.inventory_value} onChange={e => update(idx, 'inventory_value', e.target.value)} /></td>
                  <td className="num"><input className="fp-in num" type="number" value={r.expected_sales} onChange={e => update(idx, 'expected_sales', e.target.value)} /></td>
                  <td className="num"><input className="fp-in num" type="number" value={r.remaining} onChange={e => update(idx, 'remaining', e.target.value)} /></td>
                  <td className="num"><input className="fp-in num" type="number" value={r.ads} onChange={e => update(idx, 'ads', e.target.value)} /></td>
                  <td><input className="fp-in" value={r.ad_details} onChange={e => update(idx, 'ad_details', e.target.value)} placeholder="e.g. 14 days & 3$" /></td>
                  <td><button className="fp-del" onClick={() => removeRow(idx)} title="Remove month"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td></td>
                <td className="num">{money(totals.stock_renew)}</td>
                <td className="num">{money(totals.inventory_value)}</td>
                <td className="num">{money(totals.expected_sales)}</td>
                <td className="num">{money(totals.remaining)}</td>
                <td className="num">{money(totals.ads)}</td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style={{ fontSize: 12, color: '#aaa', marginTop: 12, lineHeight: 1.6 }}>
          <strong style={{ color: '#888' }}>Projected net</strong> = expected sales − stock renewal − ad spend = <strong style={{ color: projectedNet >= 0 ? '#1D9E75' : '#E24B4A' }}>{money(projectedNet)}</strong> over {rows.length} months.
          The plan is saved in this browser automatically.
        </div>
      </Card>

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
