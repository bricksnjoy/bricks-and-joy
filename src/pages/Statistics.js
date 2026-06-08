import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner, MetricCard, Badge } from '../components/UI'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { TrendingUp, ShoppingCart, Package, Users } from 'lucide-react'

const COLORS = ['#FFA500', '#0d1b2a', '#2e7d32', '#1565c0', '#f57f17', '#6a1b9a']

export default function Statistics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [orders, products, customers, expenses] = await Promise.all([
      supabase.from('orders').select('*').order('order_date'),
      supabase.from('products').select('*'),
      supabase.from('customers').select('id'),
      supabase.from('expenses').select('amount'),
    ])

    const ords = orders.data || []
    const prods = products.data || []
    const delivered = ords.filter(o => o.status === 'delivered')

    // Revenue by month
    const revenueByMonth = {}
    delivered.forEach(o => {
      const month = o.order_date?.slice(0, 7) || 'Unknown'
      revenueByMonth[month] = (revenueByMonth[month] || 0) + Number(o.total_price || 0)
    })
    const revenueChart = Object.entries(revenueByMonth).sort().map(([month, revenue]) => ({
      month: new Date(month + '-01').toLocaleDateString('en', { month: 'short', year: '2-digit' }),
      revenue: parseFloat(revenue.toFixed(2))
    }))

    // Sales by product
    const productSales = {}
    delivered.forEach(o => {
      productSales[o.product_name] = (productSales[o.product_name] || 0) + Number(o.total_price || 0)
    })
    const productChart = Object.entries(productSales).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({
      name: name.length > 18 ? name.slice(0, 18) + '…' : name,
      value: parseFloat(value.toFixed(2))
    }))

    // Sales by channel
    const channelSales = {}
    delivered.forEach(o => { channelSales[o.channel] = (channelSales[o.channel] || 0) + Number(o.total_price || 0) })
    const channelChart = Object.entries(channelSales).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))

    // Order status breakdown
    const statusCount = { pending: 0, transit: 0, delivered: 0, cancelled: 0 }
    ords.forEach(o => { statusCount[o.status] = (statusCount[o.status] || 0) + 1 })
    const statusChart = Object.entries(statusCount).filter(([, v]) => v > 0).map(([name, value]) => ({
      name: name === 'transit' ? 'Dispatched' : name.charAt(0).toUpperCase() + name.slice(1), value
    }))

    // Sales by category
    const catSales = {}
    delivered.forEach(o => {
      const p = prods.find(p => p.id === o.product_id)
      const cat = p?.category || 'Other'
      catSales[cat] = (catSales[cat] || 0) + Number(o.total_price || 0)
    })
    const catChart = Object.entries(catSales).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))

    // Top customers
    const custSpend = {}
    delivered.forEach(o => {
      if (o.customer_name) {
        if (!custSpend[o.customer_name]) custSpend[o.customer_name] = { revenue: 0, orders: 0 }
        custSpend[o.customer_name].revenue += Number(o.total_price || 0)
        custSpend[o.customer_name].orders++
      }
    })
    const topCustomers = Object.entries(custSpend).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5)

    const revenue = delivered.reduce((s, o) => s + Number(o.total_price || 0), 0)
    const cogs = delivered.reduce((s, o) => {
      const p = prods.find(p => p.id === o.product_id)
      return s + (p ? o.qty * Number(p.cost_price) : 0)
    }, 0)
    const totalExp = (expenses.data || []).reduce((s, e) => s + Number(e.amount), 0)

    setData({
      revenueChart, productChart, channelChart, statusChart, catChart, topCustomers,
      totalOrders: ords.length,
      deliveredOrders: delivered.length,
      fulfilmentRate: ords.length > 0 ? Math.round(delivered.length / ords.length * 100) : 0,
      revenue,
      netProfit: revenue - cogs - totalExp,
      totalProducts: prods.length,
      totalCustomers: (customers.data || []).length,
      avgOrderValue: delivered.length > 0 ? revenue / delivered.length : 0,
    })
    setLoading(false)
  }

  if (loading) return <Spinner />

  const { revenueChart, productChart, channelChart, statusChart, catChart, topCustomers } = data

  const tooltipStyle = { background: '#fff', border: '1px solid #eee', borderRadius: 8, fontSize: 12 }

  return (
    <div>
      <PageHeader title="Statistics" subtitle="Business performance overview" />

      {/* Key metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 24 }}>
        <MetricCard label="Total orders" value={data.totalOrders} icon={ShoppingCart} />
        <MetricCard label="Fulfilment rate" value={`${data.fulfilmentRate}%`} color={data.fulfilmentRate >= 80 ? '#2e7d32' : '#f57f17'} icon={TrendingUp} />
        <MetricCard label="Avg order value" value={`$${data.avgOrderValue.toFixed(2)}`} icon={TrendingUp} />
        <MetricCard label="Net profit" value={`${data.netProfit >= 0 ? '$' : '-$'}${Math.abs(data.netProfit).toFixed(0)}`} color={data.netProfit >= 0 ? '#2e7d32' : '#c62828'} icon={TrendingUp} />
        <MetricCard label="Products" value={data.totalProducts} icon={Package} />
        <MetricCard label="Customers" value={data.totalCustomers} icon={Users} />
      </div>

      {/* Revenue over time */}
      {revenueChart.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#0d1b2a' }}>Revenue over time</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={revenueChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#999' }} />
              <YAxis tick={{ fontSize: 11, fill: '#999' }} tickFormatter={v => `$${v}`} />
              <Tooltip contentStyle={tooltipStyle} formatter={v => [`$${v}`, 'Revenue']} />
              <Line type="monotone" dataKey="revenue" stroke="#FFA500" strokeWidth={2.5} dot={{ fill: '#FFA500', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Top products */}
        {productChart.length > 0 && (
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#0d1b2a' }}>Top products by revenue</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={productChart} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#999' }} tickFormatter={v => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#666' }} width={100} />
                <Tooltip contentStyle={tooltipStyle} formatter={v => [`$${v}`, 'Revenue']} />
                <Bar dataKey="value" fill="#FFA500" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Sales by category */}
        {catChart.length > 0 && (
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#0d1b2a' }}>Sales by category</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={catChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {catChart.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={v => [`$${v}`, 'Revenue']} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Sales by channel */}
        {channelChart.length > 0 && (
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#0d1b2a' }}>Sales by channel</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={channelChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#999' }} />
                <YAxis tick={{ fontSize: 10, fill: '#999' }} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={tooltipStyle} formatter={v => [`$${v}`, 'Revenue']} />
                <Bar dataKey="value" fill="#0d1b2a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Order status */}
        {statusChart.length > 0 && (
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#0d1b2a' }}>Order status breakdown</h3>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={statusChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
                  {statusChart.map((entry, i) => {
                    const c = { Delivered: '#2e7d32', Dispatched: '#1565c0', Pending: '#f57f17', Cancelled: '#c62828' }
                    return <Cell key={i} fill={c[entry.name] || '#888'} />
                  })}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>

      {/* Top customers */}
      {topCustomers.length > 0 && (
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#0d1b2a' }}>Top customers</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['#', 'Customer', 'Orders', 'Total spent'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 12px', fontSize: 11, color: '#999', borderBottom: '1px solid #eee', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topCustomers.map(([name, stats], i) => (
                <tr key={name} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '10px 12px', color: '#aaa', fontSize: 12 }}>#{i + 1}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{name}</td>
                  <td style={{ padding: '10px 12px', color: '#666' }}>{stats.orders}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: '#2e7d32' }}>${stats.revenue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
