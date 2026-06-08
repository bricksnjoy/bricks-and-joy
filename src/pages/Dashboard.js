import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { StockBadge, StatusBadge, Spinner } from '../components/UI'
import { Package, ShoppingCart, Users, TrendingUp, TrendingDown, AlertTriangle, Clock, CheckCircle, DollarSign } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [lowStock, setLowStock] = useState([])
  const [recentOrders, setRecentOrders] = useState([])
  const [recentCustomers, setRecentCustomers] = useState([])
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

    setStats({
      products: prods.length,
      totalStock: prods.reduce((s, p) => s + (p.stock_qty || 0), 0),
      customers: custs.length,
      activeOrders: ords.filter(o => o.status === 'pending' || o.status === 'transit').length,
      deliveredOrders: delivered.length,
      revenue, netProfit,
      pendingOrders: ords.filter(o => o.status === 'pending').length,
    })
    setLowStock(prods.filter(p => p.stock_qty <= (p.low_stock_threshold || 10)).slice(0, 5))
    setRecentOrders(ords.slice(0, 6))
    setRecentCustomers(custs.slice(0, 4))
    setLoading(false)
  }

  if (loading) return <Spinner />

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const metrics = [
    { label: 'Total revenue', value: `$${stats.revenue.toFixed(2)}`, icon: DollarSign, color: '#1D9E75', bg: '#E1F5EE', trend: '+' },
    { label: 'Net profit', value: `${stats.netProfit >= 0 ? '$' : '-$'}${Math.abs(stats.netProfit).toFixed(2)}`, icon: stats.netProfit >= 0 ? TrendingUp : TrendingDown, color: stats.netProfit >= 0 ? '#1D9E75' : '#E24B4A', bg: stats.netProfit >= 0 ? '#E1F5EE' : '#FCEBEB' },
    { label: 'Active orders', value: stats.activeOrders, icon: ShoppingCart, color: '#FFA500', bg: '#FFF8E7' },
    { label: 'Products', value: stats.products, icon: Package, color: '#378ADD', bg: '#E6F1FB' },
    { label: 'Customers', value: stats.customers, icon: Users, color: '#7F77DD', bg: '#EEEDFE' },
    { label: 'Units in stock', value: stats.totalStock, icon: Package, color: '#0F6E56', bg: '#E1F5EE' },
  ]

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, color: '#0d1b2a', letterSpacing: '-0.5px' }}>Good morning! 👋</h1>
        <p style={{ margin: '4px 0 0', color: '#999', fontSize: 14 }}>{today}</p>
      </div>

      {/* Big bold metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16, marginBottom: 32 }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 16, padding: '20px 22px', border: '1px solid #eee', position: 'relative', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 12, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, fontWeight: 500 }}>{m.label}</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: m.color, letterSpacing: '-1px', lineHeight: 1 }}>{m.value}</div>
              </div>
              <div style={{ background: m.bg, borderRadius: 12, padding: 10, flexShrink: 0 }}>
                <m.icon size={20} color={m.color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Activity feed */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>

        {/* Recent orders */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ background: '#FFF8E7', borderRadius: 8, padding: 6 }}><ShoppingCart size={16} color="#FFA500" /></div>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#0d1b2a' }}>Recent orders</span>
            </div>
            <span style={{ fontSize: 12, color: '#aaa' }}>{recentOrders.length} total</span>
          </div>
          <div style={{ padding: '8px 0' }}>
            {recentOrders.length === 0 ? (
              <p style={{ color: '#aaa', fontSize: 13, padding: '16px 20px', margin: 0 }}>No orders yet.</p>
            ) : recentOrders.map(o => (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #fafafa' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{o.customer_name || 'Walk-in'}</div>
                  <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{o.product_name} × {o.qty}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>${Number(o.total_price || 0).toFixed(2)}</div>
                  <div style={{ marginTop: 4 }}><StatusBadge status={o.status} /></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Low stock alerts */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ background: '#FFF8E1', borderRadius: 8, padding: 6 }}><AlertTriangle size={16} color="#f57f17" /></div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0d1b2a' }}>Low stock</span>
              </div>
              {lowStock.length > 0 && <span style={{ background: '#FAEEDA', color: '#854F0B', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99 }}>{lowStock.length} items</span>}
            </div>
            <div style={{ padding: '8px 0' }}>
              {lowStock.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px' }}>
                  <CheckCircle size={16} color="#1D9E75" />
                  <span style={{ fontSize: 13, color: '#aaa' }}>All products well stocked!</span>
                </div>
              ) : lowStock.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #fafafa' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a2e' }}>{p.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StockBadge qty={p.stock_qty} threshold={p.low_stock_threshold} />
                    <span style={{ fontSize: 12, color: '#aaa' }}>{p.stock_qty} left</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent customers */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #f5f5f5', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ background: '#EEEDFE', borderRadius: 8, padding: 6 }}><Users size={16} color="#7F77DD" /></div>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#0d1b2a' }}>Recent customers</span>
            </div>
            <div style={{ padding: '8px 0' }}>
              {recentCustomers.length === 0 ? (
                <p style={{ color: '#aaa', fontSize: 13, padding: '12px 20px', margin: 0 }}>No customers yet.</p>
              ) : recentCustomers.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: '1px solid #fafafa' }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#EEEDFE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#7F77DD', flexShrink: 0 }}>
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: '#aaa' }}>{c.email || c.phone || 'No contact info'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Order summary bar */}
      <div style={{ background: '#0d1b2a', borderRadius: 16, padding: '20px 24px', display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ color: '#fff' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Order summary</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{recentOrders.length} total orders</div>
        </div>
        {[
          { label: 'Pending', count: recentOrders.filter(o => o.status === 'pending').length, color: '#FFA500' },
          { label: 'Dispatched', count: recentOrders.filter(o => o.status === 'transit').length, color: '#29b6f6' },
          { label: 'Delivered', count: recentOrders.filter(o => o.status === 'delivered').length, color: '#1D9E75' },
          { label: 'Cancelled', count: recentOrders.filter(o => o.status === 'cancelled').length, color: '#E24B4A' },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.count}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
