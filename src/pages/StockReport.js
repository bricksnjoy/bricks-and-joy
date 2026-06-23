import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Spinner, useToast, Toasts } from '../components/UI'
import { ClipboardList, TrendingUp, Package, ShoppingBag, Boxes, AlertTriangle, Truck } from 'lucide-react'
import { getSettings } from '../lib/settings'

const PERIODS = [{ d: 30, label: '30 days' }, { d: 60, label: '60 days' }, { d: 90, label: '90 days' }]
const COVERS = [{ d: 30, label: '1 month' }, { d: 45, label: '6 weeks' }, { d: 60, label: '2 months' }]

export default function StockReport() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [periodDays, setPeriodDays] = useState(30)
  const [coverDays, setCoverDays] = useState(30)
  const [budgetInput, setBudgetInput] = useState('')
  const toast = useToast()

  const currency = getSettings().currency || 'MVR'
  const money = n => `${currency} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  useEffect(() => { load() }, [])
  async function load() {
    setLoading(true)
    const [o, p, s] = await Promise.all([
      supabase.from('orders').select('product_id, product_name, qty, unit_price, total_price, status, order_date'),
      supabase.from('products').select('id, name, cost_price, sell_price, stock_qty, discontinued, low_stock_threshold, category, supplier_id'),
      supabase.from('suppliers').select('id, name'),
    ])
    setOrders(o.data || [])
    setProducts(p.data || [])
    setSuppliers(s.data || [])
    setLoading(false)
  }

  const supplierName = useMemo(() => {
    const m = {}; suppliers.forEach(s => { m[s.id] = s.name }); return m
  }, [suppliers])

  const prodById = useMemo(() => {
    const m = {}; products.forEach(p => { m[p.id] = p }); return m
  }, [products])

  // Average cost of an active product — used to estimate how many NEW products a budget buys
  const avgCost = useMemo(() => {
    const active = products.filter(p => !p.discontinued && Number(p.cost_price) > 0)
    if (!active.length) return 0
    return active.reduce((s, p) => s + Number(p.cost_price), 0) / active.length
  }, [products])

  // Per-product sales + reorder analysis over the selected period
  const rows = useMemo(() => {
    const since = new Date(Date.now() - periodDays * 86400000).toISOString().split('T')[0]
    const agg = {}
    orders.filter(o => o.status !== 'cancelled' && o.product_id && o.order_date >= since).forEach(o => {
      const a = agg[o.product_id] || (agg[o.product_id] = { units: 0, revenue: 0, cost: 0 })
      const p = prodById[o.product_id]
      a.units += Number(o.qty || 0)
      a.revenue += Number(o.total_price || 0)
      a.cost += (p ? Number(p.cost_price || 0) : 0) * Number(o.qty || 0)
    })
    return Object.entries(agg).map(([id, a]) => {
      const p = prodById[id] || {}
      const units = a.units
      const profit = a.revenue - a.cost
      const dailyRate = units / periodDays
      const stock = Number(p.stock_qty || 0)
      const daysCover = dailyRate > 0 ? Math.round(stock / dailyRate) : Infinity
      const reorderQty = dailyRate > 0 ? Math.max(0, Math.ceil(dailyRate * coverDays - stock)) : 0
      const unitCost = Number(p.cost_price || 0)
      return {
        id, name: p.name || 'Unknown', category: p.category || '', supplierId: p.supplier_id || null,
        units, revenue: a.revenue, profit, margin: a.revenue > 0 ? Math.round(profit / a.revenue * 100) : 0,
        stock, daysCover, reorderQty, unitCost, reorderCost: reorderQty * unitCost,
        discontinued: p.discontinued,
      }
    }).filter(r => !r.discontinued).sort((a, b) => b.units - a.units)
  }, [orders, prodById, periodDays, coverDays])

  const summary = useMemo(() => ({
    unitsSold: rows.reduce((s, r) => s + r.units, 0),
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    profit: rows.reduce((s, r) => s + r.profit, 0),
    reorderTotal: rows.reduce((s, r) => s + r.reorderCost, 0),
  }), [rows])

  // Reinvestment plan: fund reorders of best-sellers first within budget, rest → new products
  const plan = useMemo(() => {
    const budget = budgetInput === '' ? summary.profit : (parseFloat(budgetInput) || 0)
    const cands = rows.filter(r => r.reorderQty > 0)
    let remaining = budget
    const funded = []
    for (const r of cands) {
      if (remaining <= 0) break
      if (remaining >= r.reorderCost) { funded.push({ ...r, fundedQty: r.reorderQty, fundedCost: r.reorderCost, full: true }); remaining -= r.reorderCost }
      else { const q = r.unitCost > 0 ? Math.floor(remaining / r.unitCost) : 0; if (q > 0) { funded.push({ ...r, fundedQty: q, fundedCost: q * r.unitCost, full: false }); remaining -= q * r.unitCost } }
    }
    const fundedTotal = funded.reduce((s, r) => s + r.fundedCost, 0)
    const newBudget = Math.max(0, remaining)
    return { budget, fundedTotal, funded, newBudget, estNew: avgCost > 0 ? Math.floor(newBudget / avgCost) : 0, reorderTotal: summary.reorderTotal, fundedCount: funded.length, reorderCount: cands.length }
  }, [rows, budgetInput, summary, avgCost])

  // One-click: draft batch purchase orders from the reorder list (one batch per supplier)
  async function createBatchOrder() {
    const items = rows.filter(r => r.reorderQty > 0)
    if (!items.length) { toast.error('Nothing needs reordering right now'); return }
    setCreating(true)
    // Next batch number (matches Batch Orders page: PO-#### starting above 1000)
    const { data: existing } = await supabase.from('purchase_orders').select('batch_no')
    let max = 1000
    ;(existing || []).forEach(p => { const m = /(\d+)/.exec(p.batch_no || ''); if (m) max = Math.max(max, parseInt(m[1], 10)) })
    // Group by supplier → one batch each
    const groups = {}
    items.forEach(r => { const k = r.supplierId || 'none'; (groups[k] || (groups[k] = [])).push(r) })
    const today = new Date().toISOString().split('T')[0]
    let batchCount = 0
    let payload = []
    Object.entries(groups).forEach(([sid, gItems]) => {
      batchCount++
      const batchNo = `PO-${max + batchCount}`
      const batchId = (window.crypto?.randomUUID?.() || `b${Date.now()}${Math.random().toString(36).slice(2, 8)}`)
      gItems.forEach(r => payload.push({
        supplier_id: sid === 'none' ? null : sid,
        supplier_name: sid === 'none' ? '' : (supplierName[sid] || ''),
        product_id: r.id, product_name: r.name,
        qty: r.reorderQty, unit_cost: r.unitCost,
        status: 'pending', order_date: today,
        batch_id: batchId, batch_no: batchNo,
      }))
    })
    // Insert, gracefully dropping any column the table doesn't have yet
    let { error } = await supabase.from('purchase_orders').insert(payload)
    while (error && /column .* does not exist|could not find/i.test(error.message || '')) {
      const m = (error.message || '').match(/'([a-z_]+)' column/i) || (error.message || '').match(/column "?([a-z_]+)"?/i)
      const col = m && m[1]; if (!col) break
      payload = payload.map(r => { const c = { ...r }; delete c[col]; return c })
      error = (await supabase.from('purchase_orders').insert(payload)).error
    }
    setCreating(false)
    if (error) { toast.error('Could not create batch order: ' + error.message); return }
    toast.success(`Drafted ${batchCount} batch order${batchCount > 1 ? 's' : ''} · ${items.length} item${items.length > 1 ? 's' : ''} — opening Batch Orders…`)
    setTimeout(() => window.dispatchEvent(new CustomEvent('bnj-navigate', { detail: 'purchase-orders' })), 700)
  }

  const reorderCount = rows.filter(r => r.reorderQty > 0).length

  const tabBtn = (active) => ({ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: active ? 700 : 500, background: active ? '#FFA500' : 'transparent', color: active ? '#fff' : '#888' })

  return (
    <div>
      <style>{`
        .sr-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px,1fr)); gap:12px; margin-bottom:18px; }
        .sr-card { border-radius:14px; padding:15px 17px; }
        .sr-card .v { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
        .sr-card .l { font-size:12px; color:#888; font-weight:600; margin-top:3px; }
        .sr-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
        table.sr-table { width:100%; border-collapse:collapse; font-size:13px; min-width:760px; }
        .sr-table th { text-align:left; font-size:11px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.4px; padding:9px 10px; border-bottom:2px solid #f0f0f0; white-space:nowrap; }
        .sr-table th.n, .sr-table td.n { text-align:right; }
        .sr-table td { padding:9px 10px; border-bottom:1px solid #f5f5f5; }
        .sr-tabs { display:inline-flex; background:#f5f5f5; border-radius:10px; padding:3px; gap:2px; }
        @media (max-width:600px){ .sr-card .v { font-size:19px; } }
      `}</style>

      <PageHeader title="Stock Report" subtitle="What sold, what to reorder, and how to reinvest your profit into stock." />

      {loading ? <Spinner /> : (
        <>
          {/* Controls */}
          <Card style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: '#999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>Sales period</div>
                <div className="sr-tabs">{PERIODS.map(p => <button key={p.d} style={tabBtn(periodDays === p.d)} onClick={() => setPeriodDays(p.d)}>{p.label}</button>)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>Reorder to cover</div>
                <div className="sr-tabs">{COVERS.map(c => <button key={c.d} style={tabBtn(coverDays === c.d)} onClick={() => setCoverDays(c.d)}>{c.label}</button>)}</div>
              </div>
            </div>
          </Card>

          {/* Summary */}
          <div className="sr-cards">
            <div className="sr-card" style={{ background: '#EAF2FD' }}><div className="v" style={{ color: '#2f6fc0' }}>{summary.unitsSold.toLocaleString()}</div><div className="l">Units sold ({periodDays}d)</div></div>
            <div className="sr-card" style={{ background: '#E9F7F1' }}><div className="v" style={{ color: '#1D9E75' }}>{money(summary.revenue)}</div><div className="l">Revenue</div></div>
            <div className="sr-card" style={{ background: '#FFF6E2' }}><div className="v" style={{ color: '#b8740a' }}>{money(summary.profit)}</div><div className="l">Profit</div></div>
            <div className="sr-card" style={{ background: '#FDECEC' }}><div className="v" style={{ color: '#E24B4A' }}>{money(summary.reorderTotal)}</div><div className="l">Reorder cost needed</div></div>
          </div>

          {/* Reinvestment planner */}
          <Card style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <TrendingUp size={16} color="#FFA500" />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a' }}>Reinvestment plan</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#999', marginBottom: 14 }}>Put your profit back into stock — restock your best-sellers first, then invest the rest in new products.</div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
              <label style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Budget to reinvest</label>
              <input type="number" value={budgetInput} onChange={e => setBudgetInput(e.target.value)} placeholder={String(Math.round(summary.profit))}
                style={{ border: '1px solid #ddd', borderRadius: 8, padding: '8px 12px', fontSize: 14, fontFamily: 'inherit', width: 160, outline: 'none' }} />
              <span style={{ fontSize: 12, color: '#aaa' }}>defaults to this period's profit ({money(summary.profit)})</span>
            </div>

            <div className="sr-cards" style={{ marginBottom: 16 }}>
              <div className="sr-card" style={{ background: '#f8f7f4' }}><div className="v" style={{ color: '#0d1b2a' }}>{money(plan.budget)}</div><div className="l">Available to reinvest</div></div>
              <div className="sr-card" style={{ background: '#E9F7F1' }}><div className="v" style={{ color: '#1D9E75' }}>{money(plan.fundedTotal)}</div><div className="l">Restock best-sellers ({plan.fundedCount}/{plan.reorderCount})</div></div>
              <div className="sr-card" style={{ background: '#EEF0FF' }}><div className="v" style={{ color: '#5b5bd6' }}>{money(plan.newBudget)}</div><div className="l">Left for new products</div></div>
              <div className="sr-card" style={{ background: '#FFF6E2' }}><div className="v" style={{ color: '#b8740a' }}>~{plan.estNew}</div><div className="l">New products (≈{money(avgCost)} avg)</div></div>
            </div>

            <div style={{ fontSize: 13, color: '#444', lineHeight: 1.7, background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 10, padding: '12px 16px' }}>
              💡 With <strong>{money(plan.budget)}</strong>: reorder <strong>{plan.fundedCount}</strong> best-selling product{plan.fundedCount === 1 ? '' : 's'} for <strong>{money(plan.fundedTotal)}</strong>
              {plan.newBudget > 0
                ? <>, leaving <strong>{money(plan.newBudget)}</strong> to bring in roughly <strong>{plan.estNew} new product{plan.estNew === 1 ? '' : 's'}</strong>.</>
                : plan.reorderCount > plan.fundedCount
                  ? <>. Budget covers part of your reorders — add <strong>{money(plan.reorderTotal - plan.fundedTotal)}</strong> more to fully restock everything.</>
                  : <>.</>}
            </div>
          </Card>

          {/* What sold + reorder table */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>Products sold · last {periodDays} days</div>
              {reorderCount > 0 && (
                <Button onClick={createBatchOrder} disabled={creating}>
                  <Truck size={14} /> {creating ? 'Creating…' : `Create batch order (${reorderCount})`}
                </Button>
              )}
            </div>
            {rows.length === 0 ? (
              <div style={{ fontSize: 13, color: '#bbb', padding: '8px 0' }}>No sales in this period yet.</div>
            ) : (
              <div className="sr-scroll">
                <table className="sr-table">
                  <thead><tr>
                    <th>Product</th><th className="n">Sold</th><th className="n">Revenue</th><th className="n">Profit</th><th className="n">In stock</th><th className="n">Cover</th><th className="n">Reorder</th><th className="n">Reorder cost</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id}>
                        <td><div style={{ fontWeight: 600, color: '#0d1b2a' }}>{r.name}</div>{r.category && <div style={{ fontSize: 11, color: '#aaa' }}>{r.category}</div>}</td>
                        <td className="n" style={{ fontWeight: 700 }}>{r.units}</td>
                        <td className="n">{money(r.revenue)}</td>
                        <td className="n" style={{ color: r.profit >= 0 ? '#1D9E75' : '#E24B4A', fontWeight: 600 }}>{money(r.profit)}<div style={{ fontSize: 10, color: '#bbb' }}>{r.margin}%</div></td>
                        <td className="n" style={{ color: r.stock <= 0 ? '#E24B4A' : '#0d1b2a', fontWeight: 600 }}>{r.stock}</td>
                        <td className="n" style={{ color: r.daysCover === Infinity ? '#bbb' : r.daysCover <= 7 ? '#E24B4A' : r.daysCover <= 21 ? '#f57f17' : '#1D9E75' }}>{r.daysCover === Infinity ? '—' : r.daysCover + 'd'}</td>
                        <td className="n" style={{ fontWeight: 700, color: r.reorderQty > 0 ? '#5b5bd6' : '#ccc' }}>{r.reorderQty > 0 ? '+' + r.reorderQty : '—'}</td>
                        <td className="n">{r.reorderCost > 0 ? money(r.reorderCost) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 12, lineHeight: 1.6 }}>
              <strong>Cover</strong> = days of stock left at the current selling pace. <strong>Reorder</strong> = units to buy so you hold ~{coverDays} days of stock. <strong>Reorder cost</strong> = reorder units × cost price.
            </div>
          </Card>
        </>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
