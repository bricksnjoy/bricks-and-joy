import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner, Badge } from '../components/UI'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts'
import { TrendingUp, TrendingDown, Package, ShoppingCart, Users, AlertTriangle, BarChart3, PieChart as PieIcon, LineChart as LineIcon, Activity, Trophy, Medal, Award, Flame, ArrowUpRight, ArrowDownRight, ArrowRight, CheckCircle, Minus, Coins } from 'lucide-react'

const COLORS = ['#FFA500','#0d1b2a','#1D9E75','#378ADD','#f57f17','#7F77DD','#c62828','#29b6f6']

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

    // Product performance
    const productPerf = {}
    ords.forEach(o => {
      if (!productPerf[o.product_name]) productPerf[o.product_name] = { name: o.product_name, revenue: 0, units: 0, orders: 0, cancelled: 0 }
      if (o.status === 'delivered') { productPerf[o.product_name].revenue += Number(o.total_price || 0); productPerf[o.product_name].units += o.qty }
      if (o.status === 'cancelled') productPerf[o.product_name].cancelled++
      productPerf[o.product_name].orders++
    })
    const productChart = Object.values(productPerf).sort((a, b) => b.revenue - a.revenue)

    // Channel performance
    const chanPerf = {}
    delivered.forEach(o => { chanPerf[o.channel] = (chanPerf[o.channel] || 0) + Number(o.total_price || 0) })
    const channelChart = Object.entries(chanPerf).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))

    // Forecasting — linear regression on monthly revenue
    const months = Object.keys(revByMonth).sort()
    const forecastData = []
    if (months.length >= 2) {
      const n = months.length
      const xVals = months.map((_, i) => i)
      const yVals = months.map(m => revByMonth[m])
      const xMean = xVals.reduce((a, b) => a + b, 0) / n
      const yMean = yVals.reduce((a, b) => a + b, 0) / n
      const slope = xVals.reduce((s, x, i) => s + (x - xMean) * (yVals[i] - yMean), 0) / xVals.reduce((s, x) => s + (x - xMean) ** 2, 0)
      const intercept = yMean - slope * xMean
      // Historical
      months.forEach((m, i) => {
        forecastData.push({ month: new Date(m + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' }), actual: parseFloat(revByMonth[m].toFixed(2)), forecast: null })
      })
      // Next 3 months forecast
      for (let i = 1; i <= 3; i++) {
        const lastDate = new Date(months[months.length - 1] + '-01')
        lastDate.setMonth(lastDate.getMonth() + i)
        const futureMonth = lastDate.toLocaleDateString('en', { month: 'short', year: '2-digit' })
        const predicted = Math.max(0, intercept + slope * (n - 1 + i))
        forecastData.push({ month: futureMonth, actual: null, forecast: parseFloat(predicted.toFixed(2)) })
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

    setData({ revenueChart, productChart, channelChart, forecastData, hotProducts, topCustomers, expChart, statusCount, revenue, netProfit, avgOrderValue, returnRate, totalOrders: ords.length, deliveredOrders: delivered.length, fulfilmentRate: ords.length > 0 ? (delivered.length / ords.length * 100).toFixed(0) : 0, totalCustomers: custs.length, lowStockCount: prods.filter(p => p.stock_qty <= (p.low_stock_threshold || 10)).length })
    setLoading(false)
  }

  if (loading) return <Spinner />
  const t = data
  const tt = { background: '#fff', border: '1px solid #eee', borderRadius: 8, fontSize: 12 }

  const tabs = [['overview','Overview',BarChart3],['products','Products',Package],['forecast','Forecast',LineIcon],['customers','Customers',Users],['costs','Cost Analysis',Coins]]

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

          <Card>
            <ChartTitle icon={Package} color="#0d1b2a">Product performance table</ChartTitle>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>{['Product','Revenue','Units sold','Orders','Cancelled'].map(h => (
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
                      <td style={{ padding: '10px 12px' }}>{p.units}</td>
                      <td style={{ padding: '10px 12px' }}>{p.orders}</td>
                      <td style={{ padding: '10px 12px', color: p.cancelled > 0 ? '#c62828' : '#aaa' }}>{p.cancelled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ── FORECAST ── */}
      {activeTab === 'forecast' && (
        <>
          <div style={{ background: '#E1F5EE', border: '1px solid #c8eed8', borderRadius: 12, padding: '14px 18px', marginBottom: 20, fontSize: 13, color: '#0F6E56', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ background: 'rgba(15,110,86,0.12)', borderRadius: 8, padding: 6, display: 'flex', flexShrink: 0 }}><LineIcon size={15} color="#0F6E56" /></div>
            <span><strong style={{ fontWeight: 600 }}>How forecasting works:</strong> We use linear regression on your monthly revenue trend to project the next 3 months. The more data you have, the more accurate the forecast.</span>
          </div>

          {t.forecastData.length > 0 && (
            <Card style={{ marginBottom: 20 }}>
              <ChartTitle icon={LineIcon} color="#378ADD" gap={4}>Revenue forecast — next 3 months</ChartTitle>
              <p style={{ fontSize: 12, color: '#999', marginBottom: 16, marginTop: 0 }}>Solid line = actual · Dashed = forecast</p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={t.forecastData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#999' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#999' }} tickFormatter={v => `MVR ${v}`} />
                  <Tooltip contentStyle={tt} formatter={(v, name) => [`MVR ${v}`, name === 'actual' ? 'Actual' : 'Forecast']} />
                  <Legend />
                  <Line type="monotone" dataKey="actual" stroke="#FFA500" strokeWidth={2.5} dot={{ fill: '#FFA500', r: 4 }} connectNulls={false} />
                  <Line type="monotone" dataKey="forecast" stroke="#378ADD" strokeWidth={2.5} strokeDasharray="6 3" dot={{ fill: '#378ADD', r: 4 }} connectNulls={false} />
                </LineChart>
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
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: '#0d1b2a' }}>Cost vs Revenue</h3>
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
