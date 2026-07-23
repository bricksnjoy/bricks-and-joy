import React, { useEffect, useState } from 'react'
import { Card, Button, Badge, Spinner } from './UI'
import { TrendingUp, Wallet, Boxes, Package, CheckCircle2, XCircle, Download } from 'lucide-react'
import { loadBusinessData, computeBusiness, exportBusinessExcel, monthLabel, num, getOpening, setOpening } from '../lib/business'

const money = n => `MVR ${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function BsStyles() {
  return <style>{`
    .bs-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
    table.bs { width:100%; border-collapse:collapse; font-size:12.5px; min-width:820px; }
    .bs th { text-align:right; font-size:10.5px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.4px; padding:9px 10px; border-bottom:2px solid #f0f0f0; white-space:nowrap; }
    .bs th:first-child, .bs td:first-child { text-align:left; }
    .bs td { padding:8px 10px; border-bottom:1px solid #f5f5f5; text-align:right; white-space:nowrap; color:#333; }
    .bs tfoot td { border-top:2px solid #eee; font-weight:800; color:#0d1b2a; }
    .bs .neg { color:#E24B4A; } .bs .pos { color:#1D9E75; }
  `}</style>
}
function Row({ label, value, color, bold }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f5f5f5' }}>
    <span style={{ color: '#667' }}>{label}</span><span style={{ fontWeight: bold ? 800 : 600, color: color || '#0d1b2a' }}>{value}</span>
  </div>
}

function useBusiness() {
  const [data, setData] = useState(null)
  useEffect(() => { loadBusinessData().then(setData) }, [])
  return data
}

function DownloadBtn({ data }) {
  return <Button variant="ghost" onClick={() => exportBusinessExcel(data)} style={{ border: '1px solid #e0e0e0' }}><Download size={15} /> Download Excel</Button>
}

// ── Analytics: monthly performance + product & category analysis ─────────────────
export function AnalyticsBusiness() {
  const data = useBusiness()
  if (!data) return <Card style={{ marginTop: 20 }}><Spinner /></Card>
  const c = computeBusiness(data)
  return (
    <div style={{ marginTop: 24 }}>
      <BsStyles />
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><TrendingUp size={17} color="#FFA500" /> Monthly performance</h3>
          <DownloadBtn data={data} />
        </div>
        <div className="bs-scroll">
          <table className="bs">
            <thead><tr><th>Month</th><th>Orders</th><th>Revenue</th><th>Cost of sales</th><th>Advertising</th><th>Other costs</th><th>Loan</th><th>Total exp</th><th>Profit</th></tr></thead>
            <tbody>
              {c.monthly.map(r => (
                <tr key={r.m}><td>{monthLabel(r.m)}</td><td>{r.orders}</td><td>{money(r.revenue)}</td><td>{money(r.cogs)}</td><td>{money(r.ad)}</td><td>{money(r.other)}</td><td>{money(r.loan)}</td><td>{money(r.totalExp)}</td><td className={r.profit >= 0 ? 'pos' : 'neg'}>{money(r.profit)}</td></tr>
              ))}
              {c.monthly.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>No orders or expenses yet.</td></tr>}
            </tbody>
            {c.monthly.length > 0 && <tfoot><tr><td>Total</td><td>{c.totals.orders}</td><td>{money(c.totals.revenue)}</td><td>{money(c.totals.cogs)}</td><td>{money(c.totals.ad)}</td><td>{money(c.totals.other)}</td><td>{money(c.totals.loan)}</td><td>{money(c.totals.totalExp)}</td><td className={c.totals.profit >= 0 ? 'pos' : 'neg'}>{money(c.totals.profit)}</td></tr></tfoot>}
          </table>
        </div>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}><Package size={17} color="#FFA500" /> By category — is the cost covered?</h3>
        <div className="bs-scroll">
          <table className="bs" style={{ minWidth: 640 }}>
            <thead><tr><th>Category</th><th>Products</th><th>Spent on stock</th><th>Revenue</th><th>Profit</th><th>Status</th></tr></thead>
            <tbody>
              {c.categorySummary.map(cat => (
                <tr key={cat.category}><td>{cat.category}</td><td>{cat.items}</td><td>{money(cat.spent)}</td><td>{money(cat.revenue)}</td><td className={cat.profit >= 0 ? 'pos' : 'neg'}>{money(cat.profit)}</td><td>{cat.covered ? <Badge color="green">Covered</Badge> : <Badge color="red">Not yet</Badge>}</td></tr>
              ))}
              {c.categorySummary.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: 20 }}>No products yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}><Package size={17} color="#FFA500" /> Product-wise analysis</h3>
        <p style={{ fontSize: 12, color: '#999', margin: '0 0 14px' }}>"Spent on stock" = cost price × all units bought. "Covered" means sales have earned back what you put into that product.</p>
        <div className="bs-scroll">
          <table className="bs" style={{ minWidth: 780 }}>
            <thead><tr><th>Product</th><th>Category</th><th>Sold</th><th>In stock</th><th>Spent on stock</th><th>Revenue</th><th>Profit</th><th>Covered</th></tr></thead>
            <tbody>
              {c.productAnalysis.map(r => (
                <tr key={r.id}><td style={{ maxWidth: 220, whiteSpace: 'normal' }}>{r.name}</td><td>{r.category}</td><td>{r.soldQty}</td><td>{r.stock}</td><td>{money(r.spent)}</td><td>{money(r.revenue)}</td><td className={r.profit >= 0 ? 'pos' : 'neg'}>{money(r.profit)}</td><td>{r.covered ? <CheckCircle2 size={16} color="#1D9E75" /> : <XCircle size={16} color="#E24B4A" />}</td></tr>
              ))}
              {c.productAnalysis.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#aaa', padding: 20 }}>No product data yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Financial Reports: cashflow + inventory ──────────────────────────────────────
export function FinancialBusiness() {
  const data = useBusiness()
  const [opening, setOpen] = useState(getOpening)
  if (!data) return <Card style={{ marginTop: 20 }}><Spinner /></Card>
  const c = computeBusiness(data)
  const closing = opening + c.totals.revenue - c.totals.totalExp
  const saveOpen = v => { setOpen(v); setOpening(v) }
  return (
    <div style={{ marginTop: 24 }}>
      <BsStyles />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}><DownloadBtn data={data} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }} className="grid-collapse">
        <Card>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}><Wallet size={17} color="#FFA500" /> Cashflow</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f2f2f2' }}>
            <span style={{ color: '#667' }}>Opening balance at bank</span>
            <input type="number" value={opening} onChange={e => saveOpen(parseFloat(e.target.value) || 0)} style={{ width: 130, textAlign: 'right', padding: '6px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
          </div>
          <Row label="Total revenue (cash in)" value={money(c.totals.revenue)} color="#1D9E75" />
          <Row label="Total expenses (cash out)" value={'− ' + money(c.totals.totalExp)} color="#E24B4A" />
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 2px', marginTop: 6, borderTop: '2px solid #eee', fontWeight: 800, fontSize: 16 }}>
            <span>Closing balance at bank</span><span style={{ color: closing >= 0 ? '#2f6fc0' : '#E24B4A' }}>{money(closing)}</span>
          </div>
          <p style={{ fontSize: 11.5, color: '#aaa', marginTop: 10 }}>Set your bank opening balance above; it's saved on this device.</p>
        </Card>
        <Card>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}><Boxes size={17} color="#FFA500" /> Inventory</h3>
          <Row label="Opening inventory value" value={money(c.inventory.openingInv)} />
          <Row label="Purchases during period" value={money(c.inventory.purchasesVal)} />
          <Row label="Cost of goods sold" value={money(c.inventory.cogs)} />
          <Row label="Closing inventory value" value={money(c.inventory.closing)} bold />
          <Row label="Stock turn" value={`${c.inventory.turn.toFixed(2)}×`} />
          <Row label="How long to sell (days)" value={`${Math.round(c.inventory.days)} days`} />
          <p style={{ fontSize: 11.5, color: '#aaa', marginTop: 10 }}>Closing value = current stock × cost price. Opening is derived (closing + COGS − purchases).</p>
        </Card>
      </div>
    </div>
  )
}
