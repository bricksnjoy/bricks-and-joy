import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { StockBadge, StatusBadge, Spinner } from '../components/UI'
import { Package, ShoppingCart, Users, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, DollarSign } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [lowStock, setLowStock] = useState([])
  const [recentOrders, setRecentOrders] = useState([])
  const [recentCustomers, setRecentCustomers] = useState([])
  const [bestSellers, setBestSellers] = useState([])
  const [reorderSuggestions, setReorderSuggestions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    setLoading(true)
    const [products, orders, customers, expenses] = await Promise.all([
      supabase.from('products').select('*'),
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('*').order('created_at', { ascending: false }),
      supabase.from('expenses').select('amount'),
    ])
    const prods = products.data || []
    const ords = orders.data || []
    const custs = customers.data || []
    const delivered = ords.filter(o => o.status === 'delivered')
    const revenue = delivered.reduce((s, o) => s + Number(o.total_price || 0), 0)
    const cogs = delivered.reduce((s, o) => {
      const p = prods.find(p => p.id === o.product_id)
      return s + (p ? o.qty * Number(p.cost_price) : 0)
    }, 0)
    const totalExp = (expenses.data || []).reduce((s, e) => s + Number(e.amount), 0)
    const netProfit = revenue - cogs - totalExp

    // Today & this week
    const todayStr = new Date().toISOString().split('T')[0]
    const thisMonthStr = new Date().toISOString().slice(0, 7)
    const lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1)
    const lastMonthStr = lastMonthDate.toISOString().slice(0, 7)
    const todaySales = delivered.filter(o => o.order_date === todayStr).reduce((s, o) => s + Number(o.total_price || 0), 0)
    const thisMonthSales = delivered.filter(o => o.order_date?.startsWith(thisMonthStr)).reduce((s, o) => s + Number(o.total_price || 0), 0)
    const lastMonthSales = delivered.filter(o => o.order_date?.startsWith(lastMonthStr)).reduce((s, o) => s + Number(o.total_price || 0), 0)
    const monthChange = lastMonthSales > 0 ? ((thisMonthSales - lastMonthSales) / lastMonthSales * 100).toFixed(0) : null

    setStats({ products: prods.length, totalStock: prods.reduce((s, p) => s + (p.stock_qty || 0), 0), customers: custs.length, activeOrders: ords.filter(o => o.status === 'pending' || o.status === 'transit').length, deliveredOrders: delivered.length, revenue, netProfit, pendingOrders: ords.filter(o => o.status === 'pending').length, todaySales, thisMonthSales, lastMonthSales, monthChange })
    setLowStock(prods.filter(p => p.stock_qty <= (p.low_stock_threshold || 10)).slice(0, 5))
    setRecentOrders(ords.slice(0, 6))

    // Recent customers — only those added in the last 30 days
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const recentCusts = custs.filter(c => c.created_at && new Date(c.created_at) >= thirtyDaysAgo).slice(0, 5)
    setRecentCustomers(recentCusts)

    // Best sellers — last 30 days, by qty sold
    const salesByProduct = {}
    delivered.filter(o => new Date(o.order_date) >= thirtyDaysAgo).forEach(o => {
      if (!o.product_id) return
      salesByProduct[o.product_id] = (salesByProduct[o.product_id] || 0) + Number(o.qty || 0)
    })
    const bestSellers = Object.entries(salesByProduct)
      .map(([pid, qty]) => ({ product: prods.find(p => p.id === pid), qtySold: qty }))
      .filter(b => b.product)
      .sort((a, b) => b.qtySold - a.qtySold)
      .slice(0, 3)
    setBestSellers(bestSellers)

    // Reorder suggestions — based on sales velocity vs current stock
    // Velocity = units sold per day over last 30 days; reorder if stock covers < 14 days
    const reorder = Object.entries(salesByProduct)
      .map(([pid, qtySold]) => {
        const product = prods.find(p => p.id === pid)
        if (!product) return null
        const dailyVelocity = qtySold / 30
        const daysOfStockLeft = dailyVelocity > 0 ? product.stock_qty / dailyVelocity : Infinity
        const suggestedQty = Math.ceil(dailyVelocity * 21 - product.stock_qty) // cover 21 days
        return { product, dailyVelocity, daysOfStockLeft, suggestedQty, qtySold }
      })
      .filter(r => r && r.daysOfStockLeft < 14 && r.suggestedQty > 0)
      .sort((a, b) => a.daysOfStockLeft - b.daysOfStockLeft)
      .slice(0, 5)
    setReorderSuggestions(reorder)

    setLoading(false)
  }

  if (loading) return <Spinner />

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const metrics = [
    { label: 'Revenue', value: `MVR ${(stats.revenue).toFixed(2)}`, icon: DollarSign, color: '#1D9E75', bg: '#E1F5EE' },
    { label: 'Net profit', value: `${stats.netProfit >= 0 ? 'MVR ' : '-MVR '}${Math.abs(stats.netProfit).toFixed(2)}`, icon: stats.netProfit >= 0 ? TrendingUp : TrendingDown, color: stats.netProfit >= 0 ? '#1D9E75' : '#E24B4A', bg: stats.netProfit >= 0 ? '#E1F5EE' : '#FCEBEB' },
    { label: 'Active orders', value: stats.activeOrders, icon: ShoppingCart, color: '#FFA500', bg: '#FFF8E7' },
    { label: 'Products', value: stats.products, icon: Package, color: '#378ADD', bg: '#E6F1FB' },
    { label: 'Customers', value: stats.customers, icon: Users, color: '#7F77DD', bg: '#EEEDFE' },
    { label: 'In stock', value: stats.totalStock, icon: Package, color: '#0F6E56', bg: '#E1F5EE' },
  ]

  return (
    <div style={{ fontFamily: "'Poppins', sans-serif" }}>
      <style>{`
        .dash-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 24px; }
        .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
        .dash-summary { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
        .metric-card { background: #fff; border-radius: 14px; padding: 18px 20px; border: 1px solid #eee; }
        @media (max-width: 768px) {
          .dash-metrics { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
          .dash-grid { grid-template-columns: 1fr !important; }
          .dash-summary { gap: 14px !important; }
          .metric-card { padding: 14px 16px !important; }
        }
        @media (max-width: 380px) {
          .dash-metrics { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: '#0d1b2a', letterSpacing: '-0.5px' }}>Good morning! 👋</h1>
        <p style={{ margin: '4px 0 0', color: '#999', fontSize: 13 }}>{today}</p>
      </div>

      {/* Metrics grid */}
      <div className="dash-metrics">
        {metrics.map((m, i) => (
          <div key={i} className="metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, fontWeight: 500 }}>{m.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: m.color, letterSpacing: '-1px', lineHeight: 1 }}>{m.value}</div>
              </div>
              <div style={{ background: m.bg, borderRadius: 10, padding: 8, flexShrink: 0 }}>
                <m.icon size={18} color={m.color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Today & This week */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 22px', border: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Today's sales</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: stats.todaySales > 0 ? '#1D9E75' : '#aaa' }}>MVR {stats.todaySales.toFixed(2)}</div>
          </div>
          <div style={{ fontSize: 28 }}>{stats.todaySales > 0 ? '🔥' : '💤'}</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 14, padding: '18px 22px', border: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>This month</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#0d1b2a' }}>MVR {(stats.thisMonthSales || 0).toFixed(2)}</div>
            {stats.monthChange !== null && (
              <div style={{ fontSize: 12, marginTop: 4, color: Number(stats.monthChange) >= 0 ? '#1D9E75' : '#c62828', fontWeight: 600 }}>
                {Number(stats.monthChange) >= 0 ? '▲' : '▼'} {Math.abs(stats.monthChange)}% vs last month
              </div>
            )}
          </div>
          <div style={{ fontSize: 28 }}>📅</div>
        </div>
      </div>

      {/* Activity grid */}
      <div className="dash-grid">
        {/* Recent orders */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ background: '#FFF8E7', borderRadius: 8, padding: 6 }}><ShoppingCart size={15} color="#FFA500" /></div>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Recent orders</span>
            </div>
            <span style={{ fontSize: 11, color: '#aaa' }}>{recentOrders.length} orders</span>
          </div>
          <div>
            {recentOrders.length === 0 ? (
              <p style={{ color: '#aaa', fontSize: 13, padding: '16px 18px', margin: 0 }}>No orders yet.</p>
            ) : recentOrders.map(o => (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid #fafafa' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.customer_name || 'Walk-in'}</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{o.product_name} × {o.qty}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>MVR {Number(o.total_price || 0).toFixed(2)}</div>
                  <div style={{ marginTop: 3 }}><StatusBadge status={o.status} /></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Low stock */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ background: '#FFF8E1', borderRadius: 8, padding: 6 }}><AlertTriangle size={15} color="#f57f17" /></div>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Low stock</span>
              </div>
              {lowStock.length > 0 && <span style={{ background: '#FAEEDA', color: '#854F0B', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99 }}>{lowStock.length}</span>}
            </div>
            <div>
              {lowStock.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px' }}>
                  <CheckCircle size={15} color="#1D9E75" />
                  <span style={{ fontSize: 13, color: '#aaa' }}>All stocked up!</span>
                </div>
              ) : lowStock.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 18px', borderBottom: '1px solid #fafafa' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                    <StockBadge qty={p.stock_qty} threshold={p.low_stock_threshold} />
                    <span style={{ fontSize: 11, color: '#aaa' }}>{p.stock_qty}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent customers */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #f5f5f5', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ background: '#EEEDFE', borderRadius: 8, padding: 6 }}><Users size={15} color="#7F77DD" /></div>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>New customers (last 30 days)</span>
            </div>
            <div>
              {recentCustomers.length === 0 ? (
                <p style={{ color: '#aaa', fontSize: 13, padding: '12px 18px', margin: 0 }}>No new customers in the last 30 days.</p>
              ) : recentCustomers.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', borderBottom: '1px solid #fafafa' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#EEEDFE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#7F77DD', flexShrink: 0 }}>
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: '#aaa' }}>{c.email || c.phone || '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Best sellers & Reorder suggestions */}
      {(bestSellers.length > 0 || reorderSuggestions.length > 0) && (
        <div className="dash-grid">
          {/* Best sellers */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #f5f5f5', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ background: '#FFF8E7', borderRadius: 8, padding: 6 }}>🔥</div>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Best sellers (30 days)</span>
            </div>
            <div>
              {bestSellers.length === 0 ? (
                <p style={{ color: '#aaa', fontSize: 13, padding: '12px 18px', margin: 0 }}>No sales data yet.</p>
              ) : bestSellers.map((b, i) => (
                <div key={b.product.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid #fafafa' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: i === 0 ? '#FFF8E1' : '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.product.name}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#FFA500', flexShrink: 0, marginLeft: 8 }}>{b.qtySold} sold</div>
                </div>
              ))}
            </div>
          </div>

          {/* Reorder suggestions */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #f5f5f5', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ background: '#E6F1FB', borderRadius: 8, padding: 6 }}><Package size={15} color="#378ADD" /></div>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Reorder suggestions</span>
              </div>
              {reorderSuggestions.length > 0 && <span style={{ background: '#FAEEDA', color: '#854F0B', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99 }}>{reorderSuggestions.length}</span>}
            </div>
            <div>
              {reorderSuggestions.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px' }}>
                  <CheckCircle size={15} color="#1D9E75" />
                  <span style={{ fontSize: 13, color: '#aaa' }}>Stock levels look healthy for current sales pace.</span>
                </div>
              ) : reorderSuggestions.map(r => (
                <div key={r.product.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid #fafafa' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product.name}</div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>
                      {r.product.stock_qty} left · {r.daysOfStockLeft === Infinity ? '—' : `~${Math.floor(r.daysOfStockLeft)}d of stock`} · selling {r.dailyVelocity.toFixed(1)}/day
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#378ADD' }}>Order {r.suggestedQty}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Order summary bar */}
      <div style={{ background: '#0d1b2a', borderRadius: 14, padding: '18px 22px' }}>
        <div className="dash-summary">
          <div style={{ color: '#fff' }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Total orders</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{recentOrders.length}</div>
          </div>
          {[
            { label: 'Pending', count: recentOrders.filter(o => o.status === 'pending').length, color: '#FFA500' },
            { label: 'Dispatched', count: recentOrders.filter(o => o.status === 'transit').length, color: '#29b6f6' },
            { label: 'Delivered', count: recentOrders.filter(o => o.status === 'delivered').length, color: '#1D9E75' },
            { label: 'Cancelled', count: recentOrders.filter(o => o.status === 'cancelled').length, color: '#E24B4A' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.count}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
