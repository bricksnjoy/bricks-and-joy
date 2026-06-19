import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner, Badge } from '../components/UI'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area, ComposedChart } from 'recharts'
import { TrendingUp, TrendingDown, Package, ShoppingCart, Users, AlertTriangle, BarChart3, PieChart as PieIcon, LineChart as LineIcon, Activity, Trophy, Medal, Award, Flame, ArrowUpRight, ArrowDownRight, ArrowRight, CheckCircle, Minus, Coins, Tag, Rocket, Wallet, Target, RotateCcw } from 'lucide-react'

const COLORS = ['#FFA500','#0d1b2a','#1D9E75','#378ADD','#f57f17','#7F77DD','#c62828','#29b6f6']

// Recommended split of the monthly growth/marketing budget for a growing
// online toy business. Percentages are a sensible starting framework — editable.
const DEFAULT_ALLOC = [
  { key: 'ig',       label: 'Instagram / social ads',     pct: 40, color: '#E1306C', note: 'Your main sales channel — put the most here.' },
  { key: 'ads',      label: 'Other paid ads & boosts',    pct: 15, color: '#378ADD', note: 'Google, influencer shoutouts, occasional boosts.' },
  { key: 'research', label: 'Research & product sampling', pct: 20, color: '#7F77DD', note: 'Order samples & test new sets before buying in bulk.' },
  { key: 'promo',    label: 'Promotions & giveaways',     pct: 10, color: '#FFA500', note: 'Discounts, bundles & giveaways to pull in new buyers.' },
  { key: 'content',  label: 'Content & creatives',        pct: 10, color: '#1D9E75', note: 'Product photos, reels and design.' },
  { key: 'buffer',   label: 'Contingency buffer',         pct: 5,  color: '#9CA3AF', note: 'Set aside for opportunities or cost overruns.' },
]
// Default share of average monthly revenue to reinvest into growth.
const DEFAULT_MKT_RATE = 15

// ─── Chart / section title ──────────────────────────────────────────────────────
function ChartTitle({ icon: Icon, color = '#0d1b2a', gap = 16, children }) {
  return (
    <h3 style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, fontWeight: 700, color: '#0d1b2a', margin: `0 0 ${gap}px`, letterSpacing: '-0.2px' }}>
      {Icon && (
        <span style={{ display: 'inline-flex', background: color + '14', borderRadius: 8, padding: 6 }}>
          <Icon size={15} color={color} />
        </span>
      )}
      {children}
    </h3>
  )
}

// ─── Rank indicator (top-3 medals, then number) ─────────────────────────────────
function RankIcon({ i }) {
  const medals = [
    { icon: Trophy, color: '#FFA500' },
    { icon: Medal, color: '#9CA3AF' },
    { icon: Award, color: '#CD7F32' },
  ]
  if (i < 3) {
    const M = medals[i].icon
    return <M size={15} color={medals[i].color} style={{ flexShrink: 0 }} />
  }
  return <span style={{ color: '#bbb', fontWeight: 600, fontSize: 12 }}>#{i + 1}</span>
}

export default function Statistics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  // Growth Plan state
  const [alloc, setAlloc] = useState(DEFAULT_ALLOC)
  const [mktRate, setMktRate] = useState(DEFAULT_MKT_RATE)   // % of avg monthly revenue
  const [budgetOverride, setBudgetOverride] = useState('')   // '' = use recommended

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [orders, products, customers, expenses] = await Promise.all([
      supabase.from('orders').select('*').order('order_date'),
      supabase.from('products').select('*'),
      supabase.from('customers').select('id, name'),
      supabase.from('expenses').select('amount, category, expense_date'),
    ])
    const ords = orders.data || []
    const prods = products.data || []
    const custs = customers.data || []
    const exps = expenses.data || []
    const delivered = ords.filter(o => o.status === 'delivered')

    // Revenue by month
    const revByMonth = {}
    const ordByMonth = {}
    delivered.forEach(o => {
      const m = o.order_date?.slice(0, 7) || 'Unknown'
      revByMonth[m] = (revByMonth[m] || 0) + Number(o.total_price || 0)
      ordByMonth[m] = (ordByMonth[m] || 0) + 1
    })
    const revenueChart = Object.entries(revByMonth).sort().map(([month, revenue]) => ({
      month: new Date(month + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' }),
      revenue: parseFloat(revenue.toFixed(2)),
      orders: ordByMonth[month] || 0,
    }))

    // Product performance (with profit = revenue − COGS)
    const prodById = Object.fromEntries(prods.map(p => [p.id, p]))
    const productPerf = {}
    ords.forEach(o => {
      if (!productPerf[o.product_name]) productPerf[o.product_name] = { name: o.product_name, revenue: 0, units: 0, orders: 0, cancelled: 0, cogs: 0 }
      if (o.status === 'delivered') {
        productPerf[o.product_name].revenue += Number(o.total_price || 0)
        productPerf[o.product_name].units += o.qty
        const p = prodById[o.product_id]
        productPerf[o.product_name].cogs += p ? o.qty * Number(p.cost_price || 0) : 0
      }
      if (o.status === 'cancelled') productPerf[o.product_name].cancelled++
      productPerf[o.product_name].orders++
    })
    const productChart = Object.values(productPerf).map(p => ({
      ...p,
      profit: p.revenue - p.cogs,
      margin: p.revenue > 0 ? (p.revenue - p.cogs) / p.revenue * 100 : 0,
    })).sort((a, b) => b.revenue - a.revenue)

    // Channel performance
    const chanPerf = {}
    delivered.forEach(o => { chanPerf[o.channel] = (chanPerf[o.channel] || 0) + Number(o.total_price || 0) })
    const channelChart = Object.entries(chanPerf).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))

    // Smarter forecasting — blends a linear trend with compounding growth
    // momentum, and adds a confidence band from historical volatility.
    const months = Object.keys(revByMonth).sort()
    const forecastData = []
    let forecastMeta = null
    const r2 = v => parseFloat(Number(v).toFixed(2))
    if (months.length >= 2) {
      const n = months.length
      const yVals = months.map(m => revByMonth[m])
      // 1) Linear regression (overall direction)
      const xVals = months.map((_, i) => i)
      const xMean = xVals.reduce((a, b) => a + b, 0) / n
      const yMean = yVals.reduce((a, b) => a + b, 0) / n
      const denom = xVals.reduce((s, x) => s + (x - xMean) ** 2, 0) || 1
      const slope = xVals.reduce((s, x, i) => s + (x - xMean) * (yVals[i] - yMean), 0) / denom
      const intercept = yMean - slope * xMean
      // 2) Compounding growth momentum — geometric mean of recent MoM ratios
      const recent = yVals.slice(-6)
      const ratios = []
      for (let i = 1; i < recent.length; i++) if (recent[i - 1] > 0) ratios.push(recent[i] / recent[i - 1])
      const g = ratios.length ? Math.pow(ratios.reduce((a, b) => a * b, 1), 1 / ratios.length) : 1
      // 3) Volatility — stddev of MoM % changes → drives the confidence band
      const pct = []
      for (let i = 1; i < n; i++) if (yVals[i - 1] > 0) pct.push((yVals[i] - yVals[i - 1]) / yVals[i - 1])
      const pMean = pct.length ? pct.reduce((a, b) => a + b, 0) / pct.length : 0
      const vol = pct.length ? Math.sqrt(pct.reduce((s, x) => s + (x - pMean) ** 2, 0) / pct.length) : 0.2
      const last = yVals[n - 1]
      months.forEach(m => forecastData.push({ month: new Date(m + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' }), actual: r2(revByMonth[m]) }))
      const proj = []
      for (let i = 1; i <= 3; i++) {
        const lastDate = new Date(months[n - 1] + '-01'); lastDate.setMonth(lastDate.getMonth() + i)
        const lin = Math.max(0, intercept + slope * (n - 1 + i))
        const grow = Math.max(0, last * Math.pow(g, i))
        const expected = lin * 0.5 + grow * 0.5            // blend trend + momentum
        const band = Math.min(0.6, vol * Math.sqrt(i))     // widens further out, capped
        proj.push(expected)
        forecastData.push({
          month: lastDate.toLocaleDateString('en', { month: 'short', year: '2-digit' }),
          expected: r2(expected), low: r2(expected * (1 - band)), high: r2(expected * (1 + band)),
        })
      }
      forecastMeta = {
        momentum: (g - 1) * 100,
        nextMonth: proj[0] || 0,
        proj3: proj.reduce((a, b) => a + b, 0),
        avgMonthly: yMean,
        confidence: vol < 0.2 ? 'High' : vol < 0.45 ? 'Medium' : 'Low',
        volatility: vol,
      }
    }

    // Product forecast — which products will sell most next month based on trend
    const productTrend = {}
    months.slice(-3).forEach(m => {
      ords.filter(o => o.status === 'delivered' && o.order_date?.startsWith(m)).forEach(o => {
        if (!productTrend[o.product_name]) productTrend[o.product_name] = { name: o.product_name, recent: 0, older: 0 }
        const isRecent = m === months[months.length - 1]
        if (isRecent) productTrend[o.product_name].recent += o.qty
        else productTrend[o.product_name].older += o.qty
      })
    })
    const hotProducts = Object.values(productTrend).map(p => ({
      ...p,
      trend: p.older > 0 ? ((p.recent - p.older / 2) / (p.older / 2) * 100).toFixed(0) : 100,
    })).sort((a, b) => b.recent - a.recent)

    // Top customers
    const custSpend = {}
    delivered.forEach(o => {
      if (o.customer_name) {
        if (!custSpend[o.customer_name]) custSpend[o.customer_name] = { revenue: 0, orders: 0 }
        custSpend[o.customer_name].revenue += Number(o.total_price || 0)
        custSpend[o.customer_name].orders++
      }
    })
    const topCustomers = Object.entries(custSpend).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8)

    // Expense by category
    const expByCat = {}
    exps.forEach(e => { expByCat[e.category] = (expByCat[e.category] || 0) + Number(e.amount) })
    const expChart = Object.entries(expByCat).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))

    // Attach category from products to each delivered order
    const deliveredWithCat = delivered.map(o => ({
      ...o,
      _category: prods.find(p => p.id === o.product_id)?.category || 'Uncategorised'
    }))

    // Status breakdown
    const statusCount = {}
    ords.forEach(o => { statusCount[o.status] = (statusCount[o.status] || 0) + 1 })

    // KPIs
    const revenue = delivered.reduce((s, o) => s + Number(o.total_price || 0), 0)
    const cogs = delivered.reduce((s, o) => { const p = prods.find(p => p.id === o.product_id); return s + (p ? o.qty * Number(p.cost_price) : 0) }, 0)
    const totalExp = exps.reduce((s, e) => s + Number(e.amount), 0)
    const netProfit = revenue - cogs - totalExp
    const avgOrderValue = delivered.length > 0 ? revenue / delivered.length : 0
    const returnRate = ords.length > 0 ? (statusCount['cancelled'] || 0) / ords.length * 100 : 0

    const monthsCount = Object.keys(revByMonth).length || 1
    const avgMonthlyRevenue = revenue / monthsCount
    const netMargin = revenue > 0 ? netProfit / revenue * 100 : 0

    setData({ revenueChart, productChart, channelChart, forecastData, forecastMeta, hotProducts, topCustomers, expChart, statusCount, revenue, cogs, netProfit, netMargin, avgMonthlyRevenue, avgOrderValue, returnRate, totalOrders: ords.length, deliveredOrders: delivered.length, fulfilmentRate: ords.length > 0 ? (delivered.length / ords.length * 100).toFixed(0) : 0, totalCustomers: custs.length, lowStockCount: prods.filter(p => p.stock_qty <= (p.low_stock_threshold || 10)).length, _allDelivered: deliveredWithCat, _catPeriod: 'all' })
    setLoading(false)
  }

  if (loading) return <Spinner />
  const t = data
  const tt = { background: '#fff', border: '1px solid #eee', borderRadius: 8, fontSize: 12 }

  const tabs = [['overview','Overview',BarChart3],['products','Products',Package],['categories','By Category',Tag],['forecast','Forecast',LineIcon],['plan','Growth Plan',Rocket],['customers','Customers',Users],['costs','Cost Analysis',Coins]]

  return (
    <div style={{ fontFamily: "'Poppins', sans-serif" }}>
      <style>{`
        .stat-tabs { display: flex; gap: 0; background: #f0f0f0; border-radius: 10px; padding: 4px; margin-bottom: 22px; flex-wrap: wrap; }
        .stat-tab { display: inline-flex; align-items: center; gap: 7px; padding: 8px 16px; border-radius: 7px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit; transition: all 0.15s; }
        .stat-tab:hover { color: #0d1b2a; }
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
        .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .kpi-card { background: #fff; border-radius: 14px; padding: 16px 18px; border: 1px solid #eee; position: relative; overflow: hidden; display: flex; justify-content: space-between; align-items: flex-start; transition: box-shadow 0.2s, transform 0.2s; }
        .kpi-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--accent); }
        .kpi-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.08); transform: translateY(-2px); }
        .stat-row { transition: background 0.12s; }
        .stat-row:hover { background: #fafafa; }
        @keyframes statFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 768px) { .kpi-grid { grid-template-columns: repeat(2,1fr)!important; } .chart-grid { grid-template-columns: 1fr!important; } }
      `}</style>

      <PageHeader title="Statistics & Analytics" subtitle="Performance, forecasting and business insights" />

      <div className="stat-tabs">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} className="stat-tab" onClick={() => setActiveTab(id)}
            style={{ background: activeTab === id ? '#fff' : 'transparent', color: activeTab === id ? '#0d1b2a' : '#888', boxShadow: activeTab === id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', fontWeight: activeTab === id ? 600 : 500 }}>
            <Icon size={14} color={activeTab === id ? '#FFA500' : '#aaa'} />
            {label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeTab === 'overview' && (
        <>
          <div className="kpi-grid">
            {[
              { label: 'Revenue', val: `MVR ${t.revenue.toFixed(2)}`, sub: `${t.deliveredOrders} delivered`, color: '#1D9E75', icon: TrendingUp },
              { label: 'Net profit', val: `${t.netProfit >= 0 ? 'MVR ' : '-MVR '}${Math.abs(t.netProfit).toFixed(2)}`, color: t.netProfit >= 0 ? '#1D9E75' : '#c62828', icon: t.netProfit >= 0 ? TrendingUp : TrendingDown },
              { label: 'Avg order value', val: `MVR ${t.avgOrderValue.toFixed(2)}`, color: '#FFA500', icon: ShoppingCart },
              { label: 'Fulfilment rate', val: `${t.fulfilmentRate}%`, color: parseInt(t.fulfilmentRate) >= 80 ? '#1D9E75' : '#f57f17', icon: Package },
              { label: 'Total orders', val: t.totalOrders, color: '#0d1b2a', icon: ShoppingCart },
              { label: 'Customers', val: t.totalCustomers, color: '#7F77DD', icon: Users },
              { label: 'Cancellation rate', val: `${t.returnRate.toFixed(1)}%`, color: t.returnRate > 10 ? '#c62828' : '#1D9E75', icon: TrendingDown },
              { label: 'Low stock items', val: t.lowStockCount, color: t.lowStockCount > 0 ? '#f57f17' : '#1D9E75', icon: AlertTriangle },
            ].map((m, i) => (
              <div key={i} className="kpi-card" style={{ '--accent': m.color, animation: 'statFadeUp 0.3s ease both', animationDelay: `${i * 0.04}s` }}>
                <div>
                  <div style={{ fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5, fontWeight: 600 }}>{m.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: m.color, letterSpacing: '-0.5px' }}>{m.val}</div>
                  {m.sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{m.sub}</div>}
                </div>
                <div style={{ background: m.color + '14', borderRadius: 9, padding: 8 }}><m.icon size={16} color={m.color} /></div>
              </div>
            ))}
          </div>

          {t.revenueChart.length > 0 && (
            <Card style={{ marginBottom: 20 }}>
              <ChartTitle icon={Activity} color="#FFA500">Revenue over time</ChartTitle>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={t.revenueChart}>
                  <defs><linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#FFA500" stopOpacity={0.2}/><stop offset="95%" stopColor="#FFA500" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#999' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#999' }} tickFormatter={v => `MVR ${v}`} />
                  <Tooltip contentStyle={tt} formatter={v => [`MVR ${v}`, 'Revenue']} />
                  <Area type="monotone" dataKey="revenue" stroke="#FFA500" strokeWidth={2.5} fill="url(#revGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          )}

          <div className="chart-grid">
            {t.channelChart.length > 0 && (
              <Card>
                <ChartTitle icon={BarChart3} color="#0d1b2a">Sales by channel</ChartTitle>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={t.channelChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#999' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#999' }} tickFormatter={v => `MVR ${v}`} />
                    <Tooltip contentStyle={tt} formatter={v => [`MVR ${v}`, 'Revenue']} />
                    <Bar dataKey="value" fill="#0d1b2a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}
            <Card>
              <ChartTitle icon={PieIcon} color="#378ADD">Order status</ChartTitle>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={Object.entries(t.statusCount).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}>
                    {Object.keys(t.statusCount).map((k, i) => {
                      const c = { delivered: '#1D9E75', transit: '#378ADD', pending: '#f57f17', cancelled: '#c62828' }
                      return <Cell key={i} fill={c[k] || '#888'} />
                    })}
                  </Pie>
                  <Tooltip contentStyle={tt} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      )}

      {/* ── PRODUCTS ── */}
      {activeTab === 'products' && (
        <>
          {t.productChart.length > 0 && (
            <Card style={{ marginBottom: 20 }}>
              <ChartTitle icon={BarChart3} color="#FFA500">Product revenue ranking</ChartTitle>
              <ResponsiveContainer width="100%" height={Math.max(200, t.productChart.length * 40)}>
                <BarChart data={t.productChart} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#999' }} tickFormatter={v => `MVR ${v}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#555' }} width={140} />
                  <Tooltip contentStyle={tt} formatter={v => [`MVR ${v}`, 'Revenue']} />
                  <Bar dataKey="revenue" fill="#FFA500" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Profit summary cards */}
          {(() => {
            const totRev = t.productChart.reduce((s, p) => s + p.revenue, 0)
            const totProfit = t.productChart.reduce((s, p) => s + p.profit, 0)
            const avgMargin = totRev > 0 ? totProfit / totRev * 100 : 0
            const best = [...t.productChart].filter(p => p.revenue > 0).sort((a, b) => b.margin - a.margin)[0]
            const cards = [
              { label: 'Product revenue', val: `MVR ${totRev.toFixed(2)}`, color: '#1D9E75', icon: TrendingUp },
              { label: 'Gross profit', val: `MVR ${totProfit.toFixed(2)}`, sub: 'Revenue − cost of goods', color: totProfit >= 0 ? '#1D9E75' : '#c62828', icon: Coins },
              { label: 'Avg margin', val: `${avgMargin.toFixed(1)}%`, color: avgMargin >= 30 ? '#1D9E75' : avgMargin >= 15 ? '#f57f17' : '#c62828', icon: Activity },
              { label: 'Best margin', val: best ? `${best.margin.toFixed(0)}%` : '—', sub: best ? best.name : '', color: '#7F77DD', icon: Trophy },
            ]
            return (
              <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {cards.map((m, i) => (
                  <div key={i} className="kpi-card" style={{ '--accent': m.color }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5, fontWeight: 600 }}>{m.label}</div>
                      <div style={{ fontSize: 19, fontWeight: 700, color: m.color, letterSpacing: '-0.5px' }}>{m.val}</div>
                      {m.sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.sub}</div>}
                    </div>
                    <div style={{ background: m.color + '14', borderRadius: 9, padding: 8 }}><m.icon size={16} color={m.color} /></div>
                  </div>
                ))}
              </div>
            )
          })()}

          <Card>
            <ChartTitle icon={Package} color="#0d1b2a">Product performance & profit</ChartTitle>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>{['Product','Revenue','Cost (COGS)','Profit','Margin','Units','Cancelled'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, color: '#999', borderBottom: '1px solid #eee', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {t.productChart.map((p, i) => (
                    <tr key={p.name} className="stat-row" style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          <RankIcon i={i} />
                          {p.name}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#1D9E75' }}>MVR {p.revenue.toFixed(2)}</td>
                      <td style={{ padding: '10px 12px', color: '#888' }}>MVR {p.cogs.toFixed(2)}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: p.profit >= 0 ? '#0d1b2a' : '#c62828' }}>MVR {p.profit.toFixed(2)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: p.margin >= 30 ? '#1D9E75' : p.margin >= 15 ? '#f57f17' : '#c62828' }}>{p.margin.toFixed(0)}%</span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>{p.units}</td>
                      <td style={{ padding: '10px 12px', color: p.cancelled > 0 ? '#c62828' : '#aaa' }}>{p.cancelled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11.5, color: '#aaa', marginTop: 10 }}>Profit = delivered revenue − cost of goods (unit cost × units sold). Set each product’s cost price in Inventory for accurate margins.</p>
          </Card>
        </>
      )}

      {/* ── CATEGORIES ── */}
      {activeTab === 'categories' && (() => {
        const [catPeriod, setCatPeriod] = [data._catPeriod || 'all', v => setData(d => ({ ...d, _catPeriod: v }))]
        const since30 = new Date(); since30.setDate(since30.getDate() - 30)
        const since30Str = since30.toISOString().split('T')[0]
        const thisMonth = new Date().toISOString().slice(0, 7)
        const delivered = data._allDelivered || []
        const filtered = catPeriod === 'month' ? delivered.filter(o => o.order_date?.startsWith(thisMonth))
          : catPeriod === '30d' ? delivered.filter(o => o.order_date >= since30Str)
          : delivered
        const catMap = {}
        filtered.forEach(o => {
          const cat = o._category || 'Uncategorised'
          if (!catMap[cat]) catMap[cat] = { name: cat, revenue: 0, units: 0, orders: 0 }
          catMap[cat].revenue += Number(o.total_price || 0)
          catMap[cat].units += Number(o.qty || 1)
          catMap[cat].orders++
        })
        const cats = Object.values(catMap).sort((a, b) => b.revenue - a.revenue)
        const totalRev = cats.reduce((s, c) => s + c.revenue, 0)
        const CAT_COLORS = ['#FFA500','#7F77DD','#1D9E75','#378ADD','#E24B4A','#0F6E56','#f57f17','#29b6f6']
        return (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {[['all','All time'],['30d','Last 30 days'],['month','This month']].map(([v, l]) => (
                <button key={v} onClick={() => setData(d => ({ ...d, _catPeriod: v }))}
                  style={{ padding: '6px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                    background: catPeriod === v ? '#0d1b2a' : '#f0f0f0', color: catPeriod === v ? '#fff' : '#666' }}>
                  {l}
                </button>
              ))}
            </div>

            {cats.length === 0 ? (
              <Card><p style={{ textAlign: 'center', color: '#ccc', padding: '40px 0', fontSize: 13 }}>No sales data for this period</p></Card>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
                  {cats.slice(0, 4).map((c, i) => (
                    <div key={c.name} className="kpi-card" style={{ '--accent': CAT_COLORS[i % CAT_COLORS.length] }}>
                      <div>
                        <div style={{ fontSize: 10, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: CAT_COLORS[i % CAT_COLORS.length] }}>MVR {c.revenue.toFixed(0)}</div>
                        <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{c.units} units · {c.orders} orders</div>
                      </div>
                      <div style={{ background: CAT_COLORS[i % CAT_COLORS.length] + '14', borderRadius: 9, padding: 8 }}><Tag size={16} color={CAT_COLORS[i % CAT_COLORS.length]} /></div>
                    </div>
                  ))}
                </div>

                <Card>
                  <ChartTitle icon={Tag} color="#FFA500">Revenue by category</ChartTitle>
                  {cats.map((c, i) => {
                    const pct = totalRev > 0 ? (c.revenue / totalRev * 100) : 0
                    return (
                      <div key={c.name} style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: CAT_COLORS[i % CAT_COLORS.length], flexShrink: 0 }} />
                            <span style={{ fontSize: 13, fontWeight: 500, color: '#0d1b2a' }}>{c.name}</span>
                            <span style={{ fontSize: 11, color: '#bbb' }}>{c.units} units</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>MVR {c.revenue.toFixed(2)}</span>
                            <span style={{ fontSize: 11, color: '#aaa', marginLeft: 8 }}>{pct.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div style={{ height: 6, background: '#f0f0f0', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: CAT_COLORS[i % CAT_COLORS.length], borderRadius: 99, transition: 'width 0.6s ease' }} />
                        </div>
                      </div>
                    )
                  })}
                </Card>
              </>
            )}
          </>
        )
      })()}

      {/* ── FORECAST ── */}
      {activeTab === 'forecast' && (
        <>
          <div style={{ background: '#E1F5EE', border: '1px solid #c8eed8', borderRadius: 12, padding: '14px 18px', marginBottom: 20, fontSize: 13, color: '#0F6E56', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ background: 'rgba(15,110,86,0.12)', borderRadius: 8, padding: 6, display: 'flex', flexShrink: 0 }}><LineIcon size={15} color="#0F6E56" /></div>
            <span><strong style={{ fontWeight: 600 }}>Smarter forecast:</strong> we blend your long-term trend with recent month-over-month momentum, then add a confidence band from how steady your sales have been. The shaded area is the likely range (best ↔ worst case).</span>
          </div>

          {/* Forecast momentum cards */}
          {t.forecastMeta && (
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {[
                { label: 'Monthly momentum', val: `${t.forecastMeta.momentum >= 0 ? '+' : ''}${t.forecastMeta.momentum.toFixed(1)}%`, sub: 'avg growth per month', color: t.forecastMeta.momentum >= 0 ? '#1D9E75' : '#c62828', icon: t.forecastMeta.momentum >= 0 ? TrendingUp : TrendingDown },
                { label: 'Next month (est.)', val: `MVR ${t.forecastMeta.nextMonth.toFixed(0)}`, color: '#378ADD', icon: LineIcon },
                { label: 'Next 3 months', val: `MVR ${t.forecastMeta.proj3.toFixed(0)}`, sub: 'projected revenue', color: '#FFA500', icon: BarChart3 },
                { label: 'Confidence', val: t.forecastMeta.confidence, sub: `±${(t.forecastMeta.volatility * 100).toFixed(0)}% swing`, color: t.forecastMeta.confidence === 'High' ? '#1D9E75' : t.forecastMeta.confidence === 'Medium' ? '#f57f17' : '#c62828', icon: Activity },
              ].map((m, i) => (
                <div key={i} className="kpi-card" style={{ '--accent': m.color }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5, fontWeight: 600 }}>{m.label}</div>
                    <div style={{ fontSize: 19, fontWeight: 700, color: m.color, letterSpacing: '-0.5px' }}>{m.val}</div>
                    {m.sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{m.sub}</div>}
                  </div>
                  <div style={{ background: m.color + '14', borderRadius: 9, padding: 8 }}><m.icon size={16} color={m.color} /></div>
                </div>
              ))}
            </div>
          )}

          {t.forecastData.length > 0 && (
            <Card style={{ marginBottom: 20 }}>
              <ChartTitle icon={LineIcon} color="#378ADD" gap={4}>Revenue forecast — next 3 months</ChartTitle>
              <p style={{ fontSize: 12, color: '#999', marginBottom: 16, marginTop: 0 }}>Orange = actual · Blue dashed = expected · Shaded = likely range</p>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={t.forecastData}>
                  <defs><linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#378ADD" stopOpacity={0.18}/><stop offset="95%" stopColor="#378ADD" stopOpacity={0.02}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#999' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#999' }} tickFormatter={v => `MVR ${v}`} />
                  <Tooltip contentStyle={tt} formatter={(v, name) => [`MVR ${v}`, name === 'actual' ? 'Actual' : name === 'expected' ? 'Expected' : name === 'high' ? 'Best case' : 'Worst case']} />
                  <Area type="monotone" dataKey="high" stroke="none" fill="url(#bandGrad)" connectNulls={false} />
                  <Area type="monotone" dataKey="low" stroke="none" fill="#fff" connectNulls={false} />
                  <Line type="monotone" dataKey="actual" stroke="#FFA500" strokeWidth={2.5} dot={{ fill: '#FFA500', r: 4 }} connectNulls={false} />
                  <Line type="monotone" dataKey="expected" stroke="#378ADD" strokeWidth={2.5} strokeDasharray="6 3" dot={{ fill: '#378ADD', r: 4 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>
          )}

          {t.hotProducts.length > 0 && (
            <Card>
              <ChartTitle icon={Flame} color="#E24B4A" gap={4}>Trending products</ChartTitle>
              <p style={{ fontSize: 12, color: '#999', marginBottom: 16, marginTop: 0 }}>Based on recent vs previous sales velocity</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>{['Product', 'Recent units', 'Trend', 'Recommendation'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, color: '#999', borderBottom: '1px solid #eee', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {t.hotProducts.map((p, i) => {
                    const trendNum = parseInt(p.trend)
                    const isHot = trendNum > 20
                    const isCold = trendNum < -20
                    return (
                      <tr key={p.name} className="stat-row" style={{ borderBottom: '1px solid #f5f5f5' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{p.name}</td>
                        <td style={{ padding: '10px 12px' }}>{p.recent} units</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: isHot ? '#1D9E75' : isCold ? '#E24B4A' : '#f57f17', fontWeight: 600 }}>
                            {isHot ? <ArrowUpRight size={14} /> : isCold ? <ArrowDownRight size={14} /> : <ArrowRight size={14} />}
                            {trendNum > 0 ? '+' : ''}{trendNum}%
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: '#555' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {isHot ? <CheckCircle size={14} color="#1D9E75" /> : isCold ? <AlertTriangle size={14} color="#f57f17" /> : <Minus size={14} color="#aaa" />}
                            {isHot ? 'Stock up — high demand' : isCold ? 'Slow moving — consider promotion' : 'Stable demand'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          )}

          {t.forecastData.length === 0 && <Card><p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>Add more orders over multiple months to enable forecasting.</p></Card>}
        </>
      )}

      {/* ── GROWTH PLAN ── */}
      {activeTab === 'plan' && (() => {
        const amr = t.avgMonthlyRevenue || 0
        const recommended = Math.round(amr * mktRate / 100)
        const budget = budgetOverride !== '' && !isNaN(parseFloat(budgetOverride)) ? Math.max(0, parseFloat(budgetOverride)) : recommended
        const totalPct = alloc.reduce((s, a) => s + Number(a.pct || 0), 0)
        const setPct = (key, v) => setAlloc(a => a.map(x => x.key === key ? { ...x, pct: v === '' ? '' : Math.max(0, Math.min(100, Number(v))) } : x))
        const milestones = [
          { name: 'Grow', mult: 1.5, color: '#1D9E75', actions: ['Add 1–2 new product lines', 'Raise ad budget toward 18% of revenue', 'Start a simple loyalty / repeat-buyer offer'] },
          { name: 'Scale', mult: 3, color: '#378ADD', actions: ['Negotiate bulk / wholesale pricing with suppliers', 'Bring on part-time help for packing & delivery', 'Add a second sales channel (marketplace / website)'] },
          { name: 'Expand', mult: 6, color: '#7F77DD', actions: ['Consider a pop-up or small physical shop', 'Broaden the catalog & pre-order popular sets', 'Automate delivery dispatch & invoicing'] },
        ]
        return (
          <>
            <div style={{ background: '#FFF4E5', border: '1px solid #FAE2C0', borderRadius: 12, padding: '14px 18px', marginBottom: 20, fontSize: 13, color: '#9a5b00', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ background: 'rgba(255,165,0,0.16)', borderRadius: 8, padding: 6, display: 'flex', flexShrink: 0 }}><Rocket size={15} color="#FFA500" /></div>
              <span><strong style={{ fontWeight: 600 }}>Your growth plan:</strong> set aside a slice of revenue each month for marketing, research & sampling, then follow the roadmap as you hit revenue milestones. Everything below is editable.</span>
            </div>

            {/* Budget basis */}
            <Card style={{ marginBottom: 20 }}>
              <ChartTitle icon={Wallet} color="#1D9E75">Monthly growth budget</ChartTitle>
              <div className="chart-grid" style={{ marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 6 }}>Reinvest this % of average monthly revenue</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                    <input type="range" min="5" max="30" value={mktRate} onChange={e => setMktRate(Number(e.target.value))} style={{ flex: 1, minWidth: 140, accentColor: '#FFA500' }} />
                    <span style={{ fontWeight: 800, fontSize: 18, color: '#0d1b2a', minWidth: 48 }}>{mktRate}%</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 6 }}>Or set a fixed monthly budget (MVR)</div>
                  <input type="number" value={budgetOverride} onChange={e => setBudgetOverride(e.target.value)} placeholder={`Recommended: ${recommended}`}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 9, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div style={{ background: 'linear-gradient(135deg,#0d1b2a,#1a2f44)', borderRadius: 14, padding: '20px 22px', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>Growth budget / month</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: '#FFA500', letterSpacing: '-1px', margin: '4px 0' }}>MVR {budget.toFixed(0)}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Avg monthly revenue: MVR {amr.toFixed(0)} · Net margin: {t.netMargin.toFixed(0)}%</div>
                </div>
              </div>
            </Card>

            {/* Allocation */}
            <Card style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
                <ChartTitle icon={Target} color="#FFA500" gap={0}>Where the budget goes</ChartTitle>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: totalPct === 100 ? '#1D9E75' : '#c62828' }}>Total: {totalPct}%</span>
                  <button onClick={() => { setAlloc(DEFAULT_ALLOC); setMktRate(DEFAULT_MKT_RATE); setBudgetOverride('') }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f0f0f0', border: 'none', borderRadius: 8, padding: '6px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', color: '#666' }}>
                    <RotateCcw size={12} /> Reset
                  </button>
                </div>
              </div>
              {totalPct !== 100 && <p style={{ fontSize: 12, color: '#c62828', margin: '0 0 14px' }}>Tip: percentages add up to {totalPct}% — adjust to total 100% for a clean split.</p>}
              <div style={{ marginTop: 10 }}>
                {alloc.map(a => {
                  const mvr = budget * Number(a.pct || 0) / 100
                  return (
                    <div key={a.key} style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                          <div style={{ width: 11, height: 11, borderRadius: 3, background: a.color, flexShrink: 0 }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0d1b2a' }}>{a.label}</div>
                            <div style={{ fontSize: 11.5, color: '#aaa' }}>{a.note}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <input type="number" value={a.pct} onChange={e => setPct(a.key, e.target.value)}
                              style={{ width: 52, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', textAlign: 'right', outline: 'none' }} />
                            <span style={{ fontSize: 12, color: '#aaa' }}>%</span>
                          </div>
                          <div style={{ fontWeight: 800, fontSize: 14, color: '#0d1b2a', minWidth: 96, textAlign: 'right' }}>MVR {mvr.toFixed(0)}/mo</div>
                        </div>
                      </div>
                      <div style={{ height: 7, background: '#f0f0f0', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, Number(a.pct || 0))}%`, background: a.color, borderRadius: 99, transition: 'width 0.4s ease' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>

            {/* Expansion roadmap */}
            <Card>
              <ChartTitle icon={Rocket} color="#7F77DD">Expansion roadmap</ChartTitle>
              <p style={{ fontSize: 12.5, color: '#999', margin: '0 0 18px' }}>
                You're currently averaging <strong style={{ color: '#0d1b2a' }}>MVR {amr.toFixed(0)}/month</strong>. Here's what to focus on as you grow.
              </p>
              {amr <= 0 ? (
                <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>Deliver some orders first — the roadmap scales to your real numbers.</p>
              ) : milestones.map((m, i) => {
                const target = amr * m.mult
                const progress = Math.min(100, amr / target * 100)
                return (
                  <div key={m.name} style={{ display: 'flex', gap: 14, marginBottom: i < milestones.length - 1 ? 22 : 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: m.color + '18', color: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{i + 1}</div>
                      {i < milestones.length - 1 && <div style={{ width: 2, flex: 1, background: '#eee', marginTop: 4 }} />}
                    </div>
                    <div style={{ flex: 1, paddingBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 15, color: '#0d1b2a' }}>{m.name}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: m.color }}>at MVR {target.toFixed(0)}/mo</span>
                      </div>
                      <div style={{ height: 6, background: '#f0f0f0', borderRadius: 99, overflow: 'hidden', margin: '8px 0 10px' }}>
                        <div style={{ height: '100%', width: `${progress}%`, background: m.color, borderRadius: 99 }} />
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18, color: '#555', fontSize: 12.5, lineHeight: 1.7 }}>
                        {m.actions.map((a, j) => <li key={j}>{a}</li>)}
                      </ul>
                    </div>
                  </div>
                )
              })}
            </Card>
          </>
        )
      })()}

      {/* ── CUSTOMERS ── */}
      {activeTab === 'customers' && (
        <>
          <Card style={{ marginBottom: 20 }}>
            <ChartTitle icon={Trophy} color="#FFA500">Top customers by revenue</ChartTitle>
            {t.topCustomers.length === 0 ? <p style={{ color: '#aaa', fontSize: 13 }}>No customer order data yet.</p>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr>{['#','Customer','Orders','Total revenue','Avg order'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, color: '#999', borderBottom: '1px solid #eee', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                  ))}</tr></thead>
                  <tbody>
                    {t.topCustomers.map(([name, stats], i) => (
                      <tr key={name} className="stat-row" style={{ borderBottom: '1px solid #f5f5f5' }}>
                        <td style={{ padding: '10px 12px', color: '#aaa' }}>
                          {i < 3 ? <RankIcon i={i} /> : `#${i + 1}`}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{name}</td>
                        <td style={{ padding: '10px 12px' }}>{stats.orders}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: '#1D9E75' }}>MVR {stats.revenue.toFixed(2)}</td>
                        <td style={{ padding: '10px 12px', color: '#888' }}>MVR {(stats.revenue / stats.orders).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </Card>
        </>
      )}

      {/* ── COST ANALYSIS ── */}
      {activeTab === 'costs' && (
        <div className="chart-grid">
          {t.expChart.length > 0 ? (
            <>
              <Card>
                <ChartTitle icon={PieIcon} color="#E24B4A">Cost breakdown</ChartTitle>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={t.expChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                      {t.expChart.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={tt} formatter={v => [`MVR ${v}`, 'Amount']} />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
              <Card>
                <ChartTitle icon={BarChart3} color="#1D9E75">Cost vs Revenue</ChartTitle>
                {(() => {
                  const totalExp = t.expChart.reduce((s, e) => s + e.value, 0)
                  const gross = t.revenue - totalExp
                  return (
                    <div>
                      {[
                        { label: 'Revenue', value: t.revenue, color: '#1D9E75', pct: 100 },
                        { label: 'Total costs', value: totalExp, color: '#c62828', pct: t.revenue > 0 ? totalExp / t.revenue * 100 : 0 },
                        { label: 'Net profit', value: gross, color: gross >= 0 ? '#0d1b2a' : '#c62828', pct: t.revenue > 0 ? Math.abs(gross) / t.revenue * 100 : 0 },
                      ].map(item => (
                        <div key={item.label} style={{ marginBottom: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                            <span style={{ fontWeight: 600 }}>{item.label}</span>
                            <span style={{ color: item.color, fontWeight: 700 }}>MVR {item.value.toFixed(2)}</span>
                          </div>
                          <div style={{ height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, item.pct)}%`, height: '100%', background: item.color, borderRadius: 4 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </Card>
            </>
          ) : <Card style={{ gridColumn: 'span 2' }}><p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>No cost data yet. Add costs in Cost Management.</p></Card>}
        </div>
      )}
    </div>
  )
}
