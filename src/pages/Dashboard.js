import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, MetricCard, Card, StockBadge, StatusBadge, Spinner } from '../components/UI'
import { Package, ShoppingCart, Users, TrendingUp, AlertTriangle, Truck } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [lowStock, setLowStock] = useState([])
  const [recentOrders, setRecentOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    const [products, orders, customers, expenses, purchaseOrders] = await Promise.all([
      supabase.from('products').select('*'),
      supabase.from('orders').select('*'),
      supabase.from('customers').select('id'),
      supabase.from('expenses').select('amount'),
      supabase.from('purchase_orders').select('*'),
    ])

    const prods = products.data || []
    const ords = orders.data || []
    const delivered = ords.filter(o => o.status === 'delivered')
    const revenue = delivered.reduce((s, o) => s + Number(o.total_price || 0), 0)
    const cogs = delivered.reduce((s, o) => {
      const p = prods.find(p => p.id === o.product_id)
      return s + (p ? o.qty * Number(p.cost_price) : 0)
    }, 0)
    const totalExp = (expenses.data || []).reduce((s, e) => s + Number(e.amount), 0)

    setStats({
      products: prods.length,
      totalStock: prods.reduce((s, p) => s + (p.stock_qty || 0), 0),
      customers: (customers.data || []).length,
      activeOrders: ords.filter(o => o.status === 'pending' || o.status === 'transit').length,
      revenue,
      netProfit: revenue - cogs - totalExp,
      pendingPO: (purchaseOrders.data || []).filter(p => p.status === 'pending' || p.status === 'ordered').length,
    })
    setLowStock(prods.filter(p => p.stock_qty <= (p.low_stock_threshold || 10)).slice(0, 6))
    setRecentOrders(ords.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5))
    setLoading(false)
  }

  if (loading) return <Spinner />

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={today} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
        <MetricCard label="Products" value={stats.products} icon={Package} />
        <MetricCard label="Units in stock" value={stats.totalStock.toLocaleString()} icon={Package} />
        <MetricCard label="Customers" value={stats.customers} icon={Users} />
        <MetricCard label="Active orders" value={stats.activeOrders} icon={ShoppingCart} />
        <MetricCard label="Revenue" value={`$${stats.revenue.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={TrendingUp} />
        <MetricCard label="Net profit" value={`${stats.netProfit >= 0 ? '$' : '-$'}${Math.abs(stats.netProfit).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          color={stats.netProfit >= 0 ? '#2e7d32' : '#c62828'} icon={TrendingUp} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Low stock */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <AlertTriangle size={16} color="#f57f17" />
            <span style={{ fontWeight: 600, fontSize: 14, color: '#0d1b2a' }}>Low stock alerts</span>
          </div>
          {lowStock.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 13, margin: 0 }}>All products adequately stocked.</p>
          ) : lowStock.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 }}>
              <span style={{ color: '#333' }}>{p.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StockBadge qty={p.stock_qty} threshold={p.low_stock_threshold} />
                <span style={{ color: '#aaa', fontSize: 12 }}>{p.stock_qty} left</span>
              </div>
            </div>
          ))}
        </Card>

        {/* Recent orders */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <ShoppingCart size={16} color="#e85d24" />
            <span style={{ fontWeight: 600, fontSize: 14, color: '#0d1b2a' }}>Recent orders</span>
          </div>
          {recentOrders.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 13, margin: 0 }}>No orders yet.</p>
          ) : recentOrders.map(o => (
            <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13 }}>
              <div>
                <div style={{ color: '#333', fontWeight: 500 }}>{o.customer_name}</div>
                <div style={{ color: '#aaa', fontSize: 12 }}>{o.product_name} × {o.qty}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusBadge status={o.status} />
                <span style={{ color: '#666', fontSize: 12 }}>${Number(o.total_price || 0).toFixed(2)}</span>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
