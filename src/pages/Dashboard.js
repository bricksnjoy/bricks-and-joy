import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { StockBadge, StatusBadge, Spinner } from '../components/UI'
import {
  Package, ShoppingCart, Users, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle, DollarSign, Zap, Calendar,
  ArrowUpRight, ArrowDownRight, Activity, Star, UserCheck,
  Wallet, Truck, Sparkles, ChevronRight, Lightbulb
} from 'lucide-react'
import { actionItems, generateInsights, restockPredictions } from '../lib/insights'
import { loyaltyProfile } from '../lib/loyalty'

const AVATAR_COLORS = ['#7F77DD','#1D9E75','#FFA500','#378ADD','#E24B4A','#0F6E56']

const ACTION_ICONS = { wallet: Wallet, truck: Truck, package: Package, users: Users }
const SEV = {
  high: { bg: '#FDECEA', border: '#f8d7d2', color: '#c0392b', dot: '#E24B4A' },
  med:  { bg: '#FFF8E7', border: '#FAEEDA', color: '#854F0B', dot: '#FFA500' },
  low:  { bg: '#E6F1FB', border: '#cfe3f7', color: '#1e4d8c', dot: '#378ADD' },
}
const navTo = page => window.dispatchEvent(new CustomEvent('bnj-navigate', { detail: page }))

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [lowStock, setLowStock] = useState([])
  const [recentOrders, setRecentOrders] = useState([])
  const [recentCustomers, setRecentCustomers] = useState([])
  const [bestSellers, setBestSellers] = useState([])
  const [newCustomers30, setNewCustomers30] = useState([])
  const [actions, setActions] = useState([])
  const [insights, setInsights] = useState([])
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

    const todayStr = new Date().toISOString().split('T')[0]
    const thisMonthStr = new Date().toISOString().slice(0, 7)
    const lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1)
    const lastMonthStr = lastMonthDate.toISOString().slice(0, 7)
    const todaySales = delivered.filter(o => o.order_date === todayStr).reduce((s, o) => s + Number(o.total_price || 0), 0)
    const thisMonthSales = delivered.filter(o => o.order_date?.startsWith(thisMonthStr)).reduce((s, o) => s + Number(o.total_price || 0), 0)
    const lastMonthSales = delivered.filter(o => o.order_date?.startsWith(lastMonthStr)).reduce((s, o) => s + Number(o.total_price || 0), 0)
    const monthChange = lastMonthSales > 0 ? ((thisMonthSales - lastMonthSales) / lastMonthSales * 100).toFixed(0) : null

    // Best sellers — last 30 days delivered orders
    const since30 = new Date(); since30.setDate(since30.getDate() - 30)
    const since30Str = since30.toISOString().split('T')[0]
    const last30Orders = delivered.filter(o => o.order_date >= since30Str)
    const productSales = {}
    last30Orders.forEach(o => {
      const key = o.product_id
      if (!key) return
      if (!productSales[key]) {
        const prod = prods.find(p => p.id === key)
        productSales[key] = { id: key, name: o.product_name || prod?.name || 'Unknown', qty: 0, revenue: 0 }
      }
      productSales[key].qty += Number(o.qty || 1)
      productSales[key].revenue += Number(o.total_price || 0)
    })
    const sellers = Object.values(productSales).sort((a, b) => b.qty - a.qty).slice(0, 5)
    setBestSellers(sellers)

    // New customers last 30 days
    const newCusts = custs.filter(c => c.created_at && c.created_at.split('T')[0] >= since30Str)
    setNewCustomers30(newCusts)

    // Action center + AI insights + restock predictions
    const loyaltyProfiles = custs.map(c => loyaltyProfile(ords.filter(o => o.customer_id === c.id)))
    const restock = restockPredictions(prods, ords)
    setActions(actionItems({ orders: ords, products: prods, customers: custs, loyaltyProfiles }))
    setInsights(generateInsights({ orders: ords, products: prods, customers: custs, restock, loyaltyProfiles }))

    setStats({ products: prods.length, totalStock: prods.reduce((s, p) => s + (p.stock_qty || 0), 0), customers: custs.length, activeOrders: ords.filter(o => o.status === 'pending' || o.status === 'transit').length, deliveredOrders: delivered.length, revenue, netProfit, pendingOrders: ords.filter(o => o.status === 'pending').length, todaySales, thisMonthSales, lastMonthSales, monthChange })
    setLowStock(prods.filter(p => p.stock_qty <= (p.low_stock_threshold || 10)).slice(0, 5))
    setRecentOrders(ords.slice(0, 6))
    setRecentCustomers(custs.slice(0, 4))
    setLoading(false)
  }

  if (loading) return <Spinner />

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const metrics = [
    { label: 'Total Revenue', value: `MVR ${stats.revenue.toFixed(2)}`, icon: DollarSign, color: '#1D9E75', bg: 'linear-gradient(135deg, #E1F5EE, #c8eed8)', accent: '#1D9E75' },
    { label: 'Net Profit', value: `${stats.netProfit >= 0 ? '' : '-'}MVR ${Math.abs(stats.netProfit).toFixed(2)}`, icon: stats.netProfit >= 0 ? TrendingUp : TrendingDown, color: stats.netProfit >= 0 ? '#1D9E75' : '#E24B4A', bg: stats.netProfit >= 0 ? 'linear-gradient(135deg, #E1F5EE, #c8eed8)' : 'linear-gradient(135deg, #FCEBEB, #fad4d4)', accent: stats.netProfit >= 0 ? '#1D9E75' : '#E24B4A' },
    { label: 'Active Orders', value: stats.activeOrders, icon: ShoppingCart, color: '#FFA500', bg: 'linear-gradient(135deg, #FFF8E7, #fce8b2)', accent: '#FFA500' },
    { label: 'Products', value: stats.products, icon: Package, color: '#378ADD', bg: 'linear-gradient(135deg, #E6F1FB, #c5ddf5)', accent: '#378ADD' },
    { label: 'Customers', value: stats.customers, icon: Users, color: '#7F77DD', bg: 'linear-gradient(135deg, #EEEDFE, #d8d5fb)', accent: '#7F77DD' },
    { label: 'Units in Stock', value: stats.totalStock, icon: Activity, color: '#0F6E56', bg: 'linear-gradient(135deg, #E1F5EE, #c8eed8)', accent: '#0F6E56' },
  ]

  const statusGroups = [
    { label: 'Pending', count: recentOrders.filter(o => o.status === 'pending').length, color: '#FFA500', bg: 'rgba(255,165,0,0.12)' },
    { label: 'Dispatched', count: recentOrders.filter(o => o.status === 'transit').length, color: '#29b6f6', bg: 'rgba(41,182,246,0.12)' },
    { label: 'Delivered', count: recentOrders.filter(o => o.status === 'delivered').length, color: '#1D9E75', bg: 'rgba(29,158,117,0.12)' },
    { label: 'Cancelled', count: recentOrders.filter(o => o.status === 'cancelled').length, color: '#E24B4A', bg: 'rgba(226,75,74,0.12)' },
  ]

  return (
    <div style={{ fontFamily: "'Poppins', sans-serif" }}>
      <style>{`
        .dash-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
        .dash-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px; margin-bottom: 14px; }
        .metric-card {
          background: #fff; border-radius: 16px; padding: 20px 22px;
          border: 1px solid #eee; transition: box-shadow 0.2s, transform 0.2s;
          position: relative; overflow: hidden;
        }
        .metric-card::before {
          content: ''; position: absolute; left: 0; top: 0; bottom: 0;
          width: 4px; border-radius: 16px 0 0 16px;
          background: var(--accent);
        }
        .metric-card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.09); transform: translateY(-2px); }
        .order-row { display: flex; justify-content: space-between; align-items: center; padding: 11px 18px; border-bottom: 1px solid #f5f5f5; transition: background 0.12s; }
        .order-row:hover { background: #fafafa; }
        .panel { background: #fff; border-radius: 16px; border: 1px solid #eee; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.03); }
        .panel-header { padding: 15px 18px 13px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; }
        .stat-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; }
        @media (max-width: 768px) {
          .dash-metrics { grid-template-columns: repeat(2, 1fr) !important; }
          .dash-grid { grid-template-columns: 1fr !important; }
          /* Let metric numbers wrap & shrink so they're never cut off */
          .dash-mval { font-size: 18px !important; white-space: normal !important; overflow: visible !important; text-overflow: clip !important; line-height: 1.15 !important; word-break: break-word; }
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: '#0d1b2a', letterSpacing: '-0.6px' }}>{greeting} 👋</h1>
          <p style={{ margin: '4px 0 0', color: '#bbb', fontSize: 12, fontWeight: 500 }}>{today}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#0d1b2a', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D9E75' }} />
            Live
          </div>
        </div>
      </div>

      {/* Action center + AI insights */}
      {(actions.length > 0 || insights.length > 0) && (
        <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: actions.length ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 16 }}>
          {/* Needs attention */}
          {actions.length > 0 && (
            <div className="panel" style={{ animation: 'fadeSlideUp 0.3s ease both' }}>
              <div className="panel-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ background: '#FDECEA', borderRadius: 9, padding: '6px 7px', display: 'flex' }}><AlertTriangle size={14} color="#E24B4A" /></div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Needs attention</span>
                </div>
                <span style={{ background: '#FDECEA', color: '#c0392b', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>{actions.length}</span>
              </div>
              <div>
                {actions.map(a => {
                  const Icon = ACTION_ICONS[a.icon] || AlertTriangle
                  const s = SEV[a.severity]
                  return (
                    <button key={a.key} onClick={() => navTo(a.page)} className="order-row" style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, flex: 1 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Icon size={15} color={s.dot} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a' }}>{a.title}</div>
                          <div style={{ fontSize: 11, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.detail}</div>
                        </div>
                      </div>
                      <ChevronRight size={15} color="#ccc" style={{ flexShrink: 0 }} />
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* AI insights */}
          {insights.length > 0 && (
            <div className="panel" style={{ animation: 'fadeSlideUp 0.3s ease both', animationDelay: '0.05s' }}>
              <div className="panel-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ background: '#EEEDFE', borderRadius: 9, padding: '6px 7px', display: 'flex' }}><Sparkles size={14} color="#7F77DD" /></div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Smart insights</span>
                </div>
                <span style={{ fontSize: 10, color: '#bbb', fontWeight: 600 }}>Auto-generated</span>
              </div>
              <div style={{ padding: '6px 0' }}>
                {insights.slice(0, 5).map((ins, i) => {
                  const c = ins.tone === 'good' ? '#1D9E75' : ins.tone === 'warn' ? '#E24B4A' : '#378ADD'
                  return (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 18px', alignItems: 'flex-start' }}>
                      <Lightbulb size={14} color={c} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 12.5, color: '#444', lineHeight: 1.5 }}>{ins.text}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Metric cards */}
      <div className="dash-metrics">
        {metrics.map((m, i) => (
          <div key={i} className="metric-card" style={{ '--accent': m.accent, animation: `fadeSlideUp 0.3s ease both`, animationDelay: `${i * 0.05}s` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8, fontWeight: 700 }}>{m.label}</div>
                <div className="dash-mval" style={{ fontSize: 24, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-0.8px', lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.value}</div>
              </div>
              <div style={{ background: m.bg, borderRadius: 12, padding: 10, flexShrink: 0, marginLeft: 10 }}>
                <m.icon size={17} color={m.color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Today + This month hero row */}
      <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        {/* Today's sales — featured */}
        <div style={{
          borderRadius: 16, padding: '22px 24px', position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(135deg, #0d1b2a 0%, #1a2f44 100%)',
          boxShadow: '0 6px 24px rgba(13,27,42,0.18)',
          animation: 'fadeSlideUp 0.35s ease both', animationDelay: '0.3s',
        }}>
          <div style={{ position: 'absolute', right: -20, top: -20, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,165,0,0.07)' }} />
          <div style={{ position: 'absolute', right: 20, bottom: -30, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,165,0,0.05)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
            <div style={{ background: 'rgba(255,165,0,0.15)', borderRadius: 8, padding: 6, display: 'flex' }}>
              <Zap size={13} color="#FFA500" />
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Today's Sales</span>
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: stats.todaySales > 0 ? '#FFA500' : 'rgba(255,255,255,0.3)', letterSpacing: '-1px', lineHeight: 1 }}>
            MVR {stats.todaySales.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 8, fontWeight: 500 }}>
            {stats.todaySales > 0 ? 'Great day so far!' : 'No sales recorded yet'}
          </div>
        </div>

        {/* This month */}
        <div style={{
          borderRadius: 16, padding: '22px 24px', position: 'relative', overflow: 'hidden',
          background: '#fff', border: '1px solid #eee',
          animation: 'fadeSlideUp 0.35s ease both', animationDelay: '0.36s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
            <div style={{ background: '#E6F1FB', borderRadius: 8, padding: 6, display: 'flex' }}>
              <Calendar size={13} color="#378ADD" />
            </div>
            <span style={{ fontSize: 11, color: '#bbb', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>This Month</span>
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-1px', lineHeight: 1 }}>
            MVR {(stats.thisMonthSales || 0).toFixed(2)}
          </div>
          {stats.monthChange !== null ? (
            <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 99, background: Number(stats.monthChange) >= 0 ? '#E1F5EE' : '#FCEBEB' }}>
              {Number(stats.monthChange) >= 0
                ? <ArrowUpRight size={13} color="#1D9E75" />
                : <ArrowDownRight size={13} color="#E24B4A" />}
              <span style={{ fontSize: 12, fontWeight: 700, color: Number(stats.monthChange) >= 0 ? '#1D9E75' : '#E24B4A' }}>
                {Math.abs(stats.monthChange)}% vs last month
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#ccc', marginTop: 8 }}>No previous month data</div>
          )}
        </div>
      </div>

      {/* Activity grid */}
      <div className="dash-grid">
        {/* Recent orders */}
        <div className="panel">
          <div className="panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ background: '#FFF8E7', borderRadius: 9, padding: '6px 7px', display: 'flex' }}><ShoppingCart size={14} color="#FFA500" /></div>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Recent Orders</span>
            </div>
            <span style={{ background: '#f5f5f5', color: '#888', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99 }}>{recentOrders.length} total</span>
          </div>
          <div>
            {recentOrders.length === 0 ? (
              <div style={{ padding: '28px 18px', textAlign: 'center', color: '#ccc', fontSize: 13 }}>No orders yet</div>
            ) : recentOrders.map((o, i) => (
              <div key={o.id} className="order-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: AVATAR_COLORS[i % AVATAR_COLORS.length] + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: AVATAR_COLORS[i % AVATAR_COLORS.length], flexShrink: 0 }}>
                    {(o.customer_name || 'W')[0].toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.customer_name || 'Walk-in'}</div>
                    <div style={{ fontSize: 11, color: '#bbb', marginTop: 1 }}>{o.product_name} × {o.qty}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>MVR {Number(o.total_price || 0).toFixed(2)}</div>
                  <div style={{ marginTop: 4 }}><StatusBadge status={o.status} /></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Low stock */}
          <div className="panel">
            <div className="panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{ background: '#FFF8E1', borderRadius: 9, padding: '6px 7px', display: 'flex' }}><AlertTriangle size={14} color="#f57f17" /></div>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Low Stock</span>
              </div>
              {lowStock.length > 0 && (
                <span style={{ background: '#FAEEDA', color: '#854F0B', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>{lowStock.length} items</span>
              )}
            </div>
            <div>
              {lowStock.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px' }}>
                  <CheckCircle size={15} color="#1D9E75" />
                  <span style={{ fontSize: 13, color: '#aaa', fontWeight: 500 }}>All stocked up!</span>
                </div>
              ) : lowStock.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: '#333' }}>{p.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
                    <StockBadge qty={p.stock_qty} threshold={p.low_stock_threshold} />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Best Sellers + Customer Base — last 30 days */}
      <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

        {/* Best Selling Products */}
        <div className="panel" style={{ animation: 'fadeSlideUp 0.35s ease both', animationDelay: '0.18s' }}>
          <div className="panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ background: '#FFF8E7', borderRadius: 9, padding: '6px 7px', display: 'flex' }}>
                <Star size={14} color="#FFA500" />
              </div>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Best Sellers</span>
                <div style={{ fontSize: 10, color: '#bbb', fontWeight: 500, marginTop: 1 }}>Last 30 days by units sold</div>
              </div>
            </div>
            <span style={{ background: '#FFF8E7', color: '#d48a00', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99 }}>{bestSellers.length} products</span>
          </div>
          {bestSellers.length === 0 ? (
            <div style={{ padding: '28px 18px', textAlign: 'center', color: '#ccc', fontSize: 13 }}>No sales in the last 30 days</div>
          ) : (
            <div>
              {bestSellers.map((p, i) => {
                const maxQty = bestSellers[0].qty
                const pct = Math.round((p.qty / maxQty) * 100)
                const rankColors = ['#FFA500', '#7F77DD', '#1D9E75', '#378ADD', '#E24B4A']
                return (
                  <div key={p.id} style={{ padding: '11px 18px', borderBottom: i < bestSellers.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <div style={{ width: 22, height: 22, borderRadius: 7, background: rankColors[i] + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: rankColors[i], flexShrink: 0 }}>
                        {i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0d1b2a' }}>{p.qty} units</div>
                        <div style={{ fontSize: 10, color: '#bbb' }}>MVR {p.revenue.toFixed(0)}</div>
                      </div>
                    </div>
                    <div style={{ height: 4, background: '#f0f0f0', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: rankColors[i], borderRadius: 99, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Customer Base — last 30 days */}
        <div className="panel" style={{ animation: 'fadeSlideUp 0.35s ease both', animationDelay: '0.22s' }}>
          <div className="panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ background: '#EEEDFE', borderRadius: 9, padding: '6px 7px', display: 'flex' }}>
                <UserCheck size={14} color="#7F77DD" />
              </div>
              <div>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Customer Base</span>
                <div style={{ fontSize: 10, color: '#bbb', fontWeight: 500, marginTop: 1 }}>New sign-ups in last 30 days</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ background: '#E8F5E9', color: '#2e7d32', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99 }}>+{newCustomers30.length} new</span>
              <span style={{ background: '#f5f5f5', color: '#888', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99 }}>{stats.customers} total</span>
            </div>
          </div>
          {newCustomers30.length === 0 ? (
            <div style={{ padding: '28px 18px', textAlign: 'center', color: '#ccc', fontSize: 13 }}>No new customers in the last 30 days</div>
          ) : (
            <div>
              {newCustomers30.slice(0, 6).map((c, i) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: i < Math.min(newCustomers30.length, 6) - 1 ? '1px solid #f5f5f5' : 'none', transition: 'background 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: AVATAR_COLORS[i % AVATAR_COLORS.length] + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: AVATAR_COLORS[i % AVATAR_COLORS.length], flexShrink: 0 }}>
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: '#bbb' }}>{c.email || c.phone || '—'}</div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: '#7F77DD', background: '#EEEDFE', padding: '2px 8px', borderRadius: 99, fontWeight: 600 }}>
                      {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              ))}
              {newCustomers30.length > 6 && (
                <div style={{ padding: '10px 18px', fontSize: 12, color: '#bbb', textAlign: 'center' }}>
                  +{newCustomers30.length - 6} more new customers
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Order summary bar */}
      <div style={{
        background: 'linear-gradient(135deg, #0d1b2a 0%, #162538 100%)',
        borderRadius: 16, padding: '20px 26px',
        boxShadow: '0 4px 20px rgba(13,27,42,0.15)',
        display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap',
      }}>
        <div style={{ marginRight: 32 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, marginBottom: 4 }}>Total Orders</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{recentOrders.length}</div>
        </div>
        <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)', marginRight: 32 }} />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {statusGroups.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '10px 16px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, boxShadow: `0 0 6px ${s.color}` }} />
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.count}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600, marginTop: 2 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
