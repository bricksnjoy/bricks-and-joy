import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localToday, toLocalISO } from '../lib/dates'
import { StockBadge, StatusBadge, Spinner } from '../components/UI'
import {
  Package, ShoppingCart, Users, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle, DollarSign, Zap,
  ArrowUpRight, ArrowDownRight, Activity, Star, UserCheck,
  Wallet, Truck, Sparkles, ChevronRight, Lightbulb, Plus
} from 'lucide-react'
import { actionItems, generateInsights, restockPredictions } from '../lib/insights'
import { loyaltyProfile } from '../lib/loyalty'
import { netOf } from '../lib/money'

const AVATAR_COLORS = ['#7F77DD','#1D9E75','#FFA500','#378ADD','#E24B4A','#0F6E56']

const ACTION_ICONS = { wallet: Wallet, truck: Truck, package: Package, users: Users }
const SEV = {
  high: { bg: '#FDECEA', border: '#f8d7d2', color: '#c0392b', dot: '#E24B4A' },
  med:  { bg: '#FFF8E7', border: '#FAEEDA', color: '#854F0B', dot: '#FFA500' },
  low:  { bg: '#E6F1FB', border: '#cfe3f7', color: '#1e4d8c', dot: '#378ADD' },
}
const navTo = page => window.dispatchEvent(new CustomEvent('bnj-navigate', { detail: page }))

// The revenue panel runs on Inter — tighter and more even in numbers than the
// rest of the app's Poppins.
const UI = "'Inter', -apple-system, 'Segoe UI', sans-serif"

const RANGES = [
  { key: '7d', label: '7 Days', days: 7 },
  { key: '1m', label: '1 Month', days: 30 },
  { key: '3m', label: '3 Months', days: 90 },
  { key: '6m', label: '6 Months', days: 180 },
]
const mvK = n => {
  const v = Math.round(Number(n) || 0)
  if (Math.abs(v) >= 1000) { const k = v / 1000; return `${k % 1 === 0 ? k : k.toFixed(1)}k` }
  return String(v)
}
const mvFull = n => `MVR ${Math.round(Number(n) || 0).toLocaleString('en-US')}`
const axisCeil = v => { v = Number(v) || 0; if (v <= 0) return 10; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10; return m * p }
const dayLabel = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const dayLong = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// ── Revenue line chart — hover reads the exact day under the cursor ────────────
function TrendLine({ data, valueKey, seriesLabel, format }) {
  const wrapRef = useRef(null)
  const [w, setW] = useState(800)
  const [hi, setHi] = useState(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(e => setW(e[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Shorter on a phone, so the chart and the cards under it share the screen
  const height = w < 420 ? 165 : w < 700 ? 195 : 230
  const small = w < 520
  const vals = data.map(d => Number(d[valueKey]) || 0)
  const top = axisCeil(Math.max(1, ...vals))
  const ticks = [1, 0.8, 0.6, 0.4, 0.2, 0].map(f => top * f)
  const n = data.length
  const x = i => (n <= 1 ? w / 2 : (i / (n - 1)) * w)
  const y = v => height - (Math.max(0, v) / top) * height
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(n - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`

  // Which day is under the pointer — mouse on a desktop, finger on a phone
  const pick = clientX => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setHi(Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1)))))
  }
  const onMove = e => pick(e.clientX)
  const onTouch = e => { const t = e.touches && e.touches[0]; if (t) pick(t.clientX) }
  const d = hi != null ? data[hi] : null
  // As many dates along the bottom as the width can hold without them touching
  const maxLabels = Math.max(2, Math.min(7, Math.floor(w / (small ? 66 : 90))))
  const labelIdx = [...new Set(Array.from({ length: maxLabels }, (_, k) => Math.round((k / (maxLabels - 1)) * (n - 1))))]
  const gridId = `rvGrad-${valueKey}`

  return (
    <div style={{ display: 'flex', gap: small ? 7 : 12, fontFamily: UI }}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height, fontSize: small ? 10 : 11, color: '#b4b0a8', minWidth: small ? 24 : 30, textAlign: 'right', flexShrink: 0 }}>
        {ticks.map((t, i) => <div key={i} style={{ height: 0, transform: 'translateY(-5px)' }}>{mvK(t)}</div>)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div ref={wrapRef} style={{ position: 'relative', height, touchAction: 'pan-y' }}
          onMouseMove={onMove} onMouseLeave={() => setHi(null)}
          onTouchStart={onTouch} onTouchMove={onTouch} onTouchEnd={() => setHi(null)}>
          {/* dashed grid */}
          {ticks.map((t, i) => (
            <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: (i / (ticks.length - 1)) * height, borderTop: '1px dashed #ece8e0' }} />
          ))}

          <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <defs>
              <linearGradient id={gridId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0d1b2a" stopOpacity="0.10" />
                <stop offset="100%" stopColor="#0d1b2a" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gridId})`} />
            <path d={line} fill="none" stroke="#9d968c" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
            {hi != null && (
              <>
                <line x1={x(hi)} y1={-6} x2={x(hi)} y2={height} stroke="#8a8278" strokeWidth="1" />
                <circle cx={x(hi)} cy={y(vals[hi])} r="4.5" fill="#0d1b2a" stroke="#fff" strokeWidth="2" />
              </>
            )}
          </svg>

          {/* the day under the cursor */}
          {d && (
            <div style={{
              position: 'absolute', left: x(hi), top: Math.max(4, y(vals[hi]) - 62),
              // Flip to whichever side has room, so the card never leaves the chart
              transform: x(hi) > w * 0.55 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
              background: '#fff', border: '1px solid #efeae1', borderRadius: 12,
              boxShadow: '0 12px 32px rgba(30,20,10,0.14)', padding: small ? '8px 11px' : '10px 13px',
              maxWidth: Math.max(120, w * 0.6), pointerEvents: 'none', zIndex: 4,
            }}>
              <div style={{ fontSize: small ? 11 : 12, color: '#8a8278', marginBottom: 5, whiteSpace: 'nowrap' }}>{dayLong(d.dt)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: small ? 12 : 13, whiteSpace: 'nowrap' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#5c5750', flexShrink: 0 }} />
                <span style={{ color: '#5c5750' }}>{seriesLabel}</span>
                <b style={{ marginLeft: 10, color: '#0d1b2a' }}>{format(d[valueKey])}</b>
              </div>
            </div>
          )}
        </div>

        {/* dates, with the hovered one called out */}
        <div style={{ position: 'relative', height: 26, marginTop: 8 }}>
          {labelIdx.map(i => hi !== i && (
            <span key={i} style={{ position: 'absolute', left: x(i), transform: `translateX(${i === n - 1 ? '-100%' : i === 0 ? '0' : '-50%'})`, fontSize: small ? 10.5 : 11.5, color: '#b4b0a8', whiteSpace: 'nowrap' }}>
              {dayLabel(data[i].dt)}
            </span>
          ))}
          {d && (
            <span style={{
              position: 'absolute',
              // Kept inside the plot at either end rather than hanging off it
              left: Math.min(Math.max(x(hi), 26), w - 26), transform: 'translateX(-50%)',
              background: '#0d1b2a', color: '#fff', fontSize: small ? 10.5 : 11.5, fontWeight: 600,
              padding: small ? '4px 10px' : '5px 12px', borderRadius: 99, whiteSpace: 'nowrap',
            }}>{dayLabel(d.dt)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [lowStock, setLowStock] = useState([])
  const [recentOrders, setRecentOrders] = useState([])
  const [recentCustomers, setRecentCustomers] = useState([])
  const [bestSellers, setBestSellers] = useState([])
  const [newCustomers30, setNewCustomers30] = useState([])
  const [actions, setActions] = useState([])
  const [insights, setInsights] = useState([])
  const [daily, setDaily] = useState([])
  const [range, setRange] = useState('1m')
  const [loading, setLoading] = useState(true)
  // Needs attention and Smart insights sit behind the two header buttons; what
  // has already been read is remembered so the badge only counts what is new.
  const [showActions, setShowActions] = useState(false)
  const [showInsights, setShowInsights] = useState(false)
  const [seen, setSeen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bnj_dash_seen') || '{}') } catch { return {} }
  })
  function markSeen(kind, keys) {
    const next = { ...seen, [kind]: keys }
    setSeen(next)
    try { localStorage.setItem('bnj_dash_seen', JSON.stringify(next)) } catch { /* private mode */ }
  }
  const newActions = actions.filter(a => !(seen.actions || []).includes(a.key)).length
  const newInsights = insights.filter(i => !(seen.insights || []).includes(i.text)).length
  // Shortcut to the Orders page's new-order form
  function newOrder() {
    try { sessionStorage.setItem('bnj_new_order', '1') } catch { /* private mode */ }
    navTo('orders')
  }

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    setLoading(true)
    const [products, orders, customers, expenses] = await Promise.all([
      supabase.from('products').select('*'),
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('*').order('created_at', { ascending: false }),
      supabase.from('expenses').select('amount, category, expense_date'),
    ])
    const prods = products.data || []
    const ords = orders.data || []
    const custs = customers.data || []
    const delivered = ords.filter(o => o.status === 'delivered')
    // Count revenue for all paid orders (even if not yet delivered) + all delivered orders
    const revenueOrders = ords.filter(o => o.status !== 'cancelled' && (o.status === 'delivered' || o.payment_status === 'paid'))
    const revenue = revenueOrders.reduce((s, o) => s + netOf(o), 0)
    const cogs = delivered.reduce((s, o) => {
      const p = prods.find(p => p.id === o.product_id)
      return s + (p ? (Number(o.qty) || 0) * Number(p.cost_price || 0) : 0)
    }, 0)
    const totalExp = (expenses.data || []).reduce((s, e) => s + Number(e.amount || 0), 0)
    const netProfit = revenue - cogs - totalExp

    const todayStr = localToday()
    const thisMonthStr = todayStr.slice(0, 7)
    const lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1)
    const lastMonthStr = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`
    const todaySales = revenueOrders.filter(o => o.order_date === todayStr).reduce((s, o) => s + netOf(o), 0)
    const thisMonthSales = revenueOrders.filter(o => o.order_date?.startsWith(thisMonthStr)).reduce((s, o) => s + netOf(o), 0)
    const lastMonthSales = revenueOrders.filter(o => o.order_date?.startsWith(lastMonthStr)).reduce((s, o) => s + netOf(o), 0)
    const monthChange = lastMonthSales > 0 ? ((thisMonthSales - lastMonthSales) / lastMonthSales * 100).toFixed(0) : null

    // One row per day for the last year, so the revenue panel can slice any
    // range and read a single day under the cursor without going back to the DB.
    const revByDay = {}
    revenueOrders.forEach(o => {
      const k = o.order_date
      if (!k) return
      if (!revByDay[k]) revByDay[k] = { revenue: 0, orders: 0 }
      revByDay[k].revenue += netOf(o)
      revByDay[k].orders += 1
    })
    const custByDay = {}
    custs.forEach(c => { const k = (c.created_at || '').slice(0, 10); if (k) custByDay[k] = (custByDay[k] || 0) + 1 })
    const dayRows = []
    for (let i = 364; i >= 0; i--) {
      const dt = new Date(); dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() - i)
      const k = toLocalISO(dt)
      const e = revByDay[k] || { revenue: 0, orders: 0 }
      dayRows.push({ date: k, dt, revenue: e.revenue, orders: e.orders, customers: custByDay[k] || 0, aov: e.orders ? e.revenue / e.orders : 0 })
    }
    setDaily(dayRows)

    // Best sellers — last 30 days delivered orders
    const since30 = new Date(); since30.setDate(since30.getDate() - 30)
    const since30Str = toLocalISO(since30)
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
      productSales[key].revenue += netOf(o)
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

    setStats({ products: prods.length, totalStock: prods.reduce((s, p) => s + (p.stock_qty || 0), 0), customers: custs.length, totalOrders: ords.length, activeOrders: ords.filter(o => o.status === 'pending' || o.status === 'transit').length, deliveredOrders: delivered.length, revenue, netProfit, pendingOrders: ords.filter(o => o.status === 'pending').length, todaySales, thisMonthSales, lastMonthSales, monthChange })
    setLowStock(prods.filter(p => p.stock_qty <= (p.low_stock_threshold ?? 10)).slice(0, 5))
    setRecentOrders(ords.slice(0, 6))
    setRecentCustomers(custs.slice(0, 4))
    setLoading(false)
  }

  // The selected range, and the range before it for the comparison figures.
  const rev = useMemo(() => {
    const days = (RANGES.find(r => r.key === range) || RANGES[1]).days
    const cur = daily.slice(-days)
    const prev = daily.slice(-days * 2, -days)
    const sum = (rows, k) => rows.reduce((s, d) => s + (Number(d[k]) || 0), 0)
    const fold = rows => {
      const revenue = sum(rows, 'revenue'), orders = sum(rows, 'orders')
      return { revenue, orders, customers: sum(rows, 'customers'), aov: orders ? revenue / orders : 0 }
    }
    const c = fold(cur), p = fold(prev)
    return { data: cur, days, total: c.revenue, delta: p.revenue > 0 ? ((c.revenue - p.revenue) / p.revenue) * 100 : null }
  }, [daily, range])

  if (loading) return <Spinner />

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // The four headline totals
  const topCards = [
    { label: 'Total Revenue', value: mvFull(stats.revenue), icon: DollarSign, color: '#1D9E75', bg: '#E7F6EF' },
    { label: 'Total Orders', value: stats.totalOrders.toLocaleString('en-US'), icon: ShoppingCart, color: '#FFA500', bg: '#FFF6E3' },
    { label: 'Total Customers', value: stats.customers.toLocaleString('en-US'), icon: Users, color: '#7F77DD', bg: '#EEEDFE' },
    { label: 'Units in Stock', value: stats.totalStock.toLocaleString('en-US'), icon: Activity, color: '#0F6E56', bg: '#E7F6EF' },
  ]

  // The figures the headline cards and the revenue panel don't already carry
  const metrics = [
    { label: 'Net Profit', value: `${stats.netProfit >= 0 ? '' : '-'}MVR ${Math.abs(stats.netProfit).toFixed(0)}`, icon: stats.netProfit >= 0 ? TrendingUp : TrendingDown, color: stats.netProfit >= 0 ? '#1D9E75' : '#E24B4A', bg: stats.netProfit >= 0 ? '#E7F6EF' : '#FCEBEB' },
    { label: "Today's Sales", value: `MVR ${stats.todaySales.toFixed(0)}`, icon: Zap, color: '#FFA500', bg: '#FFF6E3' },
    { label: 'Active Orders', value: stats.activeOrders, icon: ShoppingCart, color: '#FFA500', bg: '#FFF6E3' },
    { label: 'Products', value: stats.products, icon: Package, color: '#378ADD', bg: '#E6F1FB' },
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

        /* ── Revenue panel ─────────────────────────────────────────── */
        .rv-panel { font-family: ${UI}; background: #fff; border: 1px solid #ece7de; border-radius: 16px; overflow: hidden; margin-bottom: 14px; }
        .rv-top { padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .rv-ranges { display: inline-flex; background: #f6f4f0; border-radius: 10px; padding: 3px; gap: 2px; }
        .rv-ranges button { border: none; background: none; font-family: inherit; font-size: 13px; font-weight: 500; color: #7d766c; padding: 7px 15px; border-radius: 8px; cursor: pointer; transition: all .15s; white-space: nowrap; }
        .rv-ranges button:hover { color: #0d1b2a; }
        .rv-ranges button.on { background: #fff; color: #0d1b2a; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.09); }
        .rv-tiles { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid #f2eee7; border-bottom: 1px solid #f2eee7; }
        .rv-tile { text-align: left; font-family: inherit; background: none; border: none; border-left: 1px solid #f2eee7; padding: 15px 18px 17px; cursor: pointer; transition: background .15s; }
        .rv-tile:first-child { border-left: none; }
        .rv-tile:hover { background: #faf9f6; }
        .rv-tile.on { background: #f6f4f0; }
        .rv-tlabel { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #8a8278; font-weight: 500; white-space: nowrap; }
        .rv-trow { display: flex; align-items: center; gap: 10px; margin-top: 9px; flex-wrap: wrap; }
        .rv-tval { font-size: 25px; font-weight: 600; color: #0d1b2a; letter-spacing: -0.8px; line-height: 1; }
        .rv-chip { display: inline-flex; align-items: center; gap: 2px; font-size: 11.5px; font-weight: 600; padding: 3px 8px; border-radius: 99px; }
        .dash-iconbtn { position: relative; background: #fff; border: 1px solid #eee; border-radius: 10px; width: 38px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all .15s; }
        .dash-iconbtn:hover { border-color: #ddd; box-shadow: 0 3px 12px rgba(0,0,0,0.06); }
        .dash-iconbtn.on { background: #0d1b2a; border-color: #0d1b2a; }
        .dash-badge { position: absolute; top: -6px; right: -6px; min-width: 17px; height: 17px; padding: 0 4px; box-sizing: border-box; border-radius: 99px; background: #E24B4A; color: #fff; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; font-family: ${UI}; }
        .dash-newbtn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: #FFA500; color: #fff; border: none; border-radius: 10px; padding: 9px 16px; font-family: ${UI}; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s; box-shadow: 0 4px 14px rgba(255,165,0,0.32); white-space: nowrap; }
        .dash-newbtn:hover { background: #f09a00; transform: translateY(-1px); }
        /* Comfortable touch targets on a phone */
        @media (max-width: 620px) {
          .dash-iconbtn { width: 42px; height: 40px; }
          .dash-newbtn { padding: 11px 16px; flex: 1; }
        }
        /* Stat cards fit themselves to the width rather than to a fixed count,
           so a phone gets two across and a desktop four without special cases. */
        .rv-mini { font-family: ${UI}; display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 12px; margin-bottom: 14px; }
        .rv-top4 { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
        .rv-minicard { background: #fff; border: 1px solid #ece7de; border-radius: 14px; padding: 14px 16px; display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
        /* A number is never cut off — it shrinks and wraps before it does that */
        .rv-minival { font-size: 19px; font-weight: 600; color: #0d1b2a; letter-spacing: -0.4px; line-height: 1.2; min-width: 0; overflow-wrap: anywhere; }
        .rv-tlabel { min-width: 0; }
        @media (max-width: 900px) {
          .rv-tiles { grid-template-columns: repeat(2, 1fr); }
          .rv-tile:nth-child(3) { border-left: none; }
          .rv-tile:nth-child(n+3) { border-top: 1px solid #f2eee7; }
          .rv-tval { font-size: 21px; }
        }
        @media (max-width: 768px) {
          .dash-metrics { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
          .dash-grid { grid-template-columns: minmax(0,1fr) !important; }
          /* Let metric numbers wrap & shrink so they're never cut off */
          .dash-mval { font-size: 18px !important; white-space: normal !important; overflow: visible !important; text-overflow: clip !important; line-height: 1.15 !important; word-break: break-word; }
        }
        @media (max-width: 620px) {
          .rv-mini { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
          .rv-top4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .rv-minicard { padding: 12px 13px; flex-direction: column; gap: 8px; }
          /* The icon moves above the figure so the figure gets the full width */
          .rv-minicard > span { order: -1; }
          .rv-minival { font-size: 17px !important; }
          .rv-tlabel { font-size: 11.5px; }
          .rv-panel { border-radius: 14px; }
          .rv-top { padding: 13px 14px; }
          .rv-ranges { width: 100%; }
          .rv-ranges button { flex: 1; padding: 8px 4px; font-size: 12px; }
          .rv-tiles { grid-template-columns: repeat(2, minmax(0,1fr)); }
          .rv-tile { padding: 12px 13px 14px; }
        }
        @media (max-width: 380px) {
          .rv-mini, .rv-top4 { grid-template-columns: minmax(0, 1fr); }
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: '#0d1b2a', letterSpacing: '-0.6px' }}>{greeting}</h1>
          <p style={{ margin: '4px 0 0', color: '#bbb', fontSize: 12, fontWeight: 500 }}>{today}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#0d1b2a', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#1D9E75' }} />
            Live
          </div>
          <button className={`dash-iconbtn${showActions ? ' on' : ''}`} title="Needs attention"
            onClick={() => { const n = !showActions; setShowActions(n); if (n) markSeen('actions', actions.map(a => a.key)) }}>
            <AlertTriangle size={16} color={showActions ? '#fff' : '#E24B4A'} />
            {newActions > 0 && !showActions && <span className="dash-badge">{newActions}</span>}
          </button>
          <button className={`dash-iconbtn${showInsights ? ' on' : ''}`} title="Smart insights"
            onClick={() => { const n = !showInsights; setShowInsights(n); if (n) markSeen('insights', insights.map(i => i.text)) }}>
            <Sparkles size={16} color={showInsights ? '#fff' : '#7F77DD'} />
            {newInsights > 0 && !showInsights && <span className="dash-badge">{newInsights}</span>}
          </button>
          <button className="dash-newbtn" onClick={newOrder}><Plus size={15} /> New order</button>
        </div>
      </div>

      {/* Headline totals */}
      <div className="rv-mini rv-top4">
        {topCards.map((m, i) => (
          <div key={i} className="rv-minicard" style={{ animation: 'fadeSlideUp 0.3s ease both', animationDelay: `${i * 0.05}s` }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="rv-tlabel" style={{ marginBottom: 7 }}>{m.label}</div>
              <div className="rv-minival" style={{ fontSize: 21 }}>{m.value}</div>
            </div>
            <span style={{ background: m.bg, borderRadius: 10, padding: 8, display: 'flex', flexShrink: 0 }}>
              <m.icon size={15} color={m.color} />
            </span>
          </div>
        ))}
      </div>

      {/* Action center + AI insights — opened from the two header buttons */}
      {((showActions && actions.length > 0) || (showInsights && insights.length > 0)) && (
        <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: (showActions && actions.length && showInsights && insights.length) ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 16 }}>
          {/* Needs attention */}
          {showActions && actions.length > 0 && (
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
          {showInsights && insights.length > 0 && (
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

      {/* ── Revenue ─────────────────────────────────────────────────────── */}
      <div className="rv-panel">
        <div className="rv-top">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#8a8278', fontWeight: 500 }}>Revenue</span>
            <span style={{ fontSize: 24, fontWeight: 600, color: '#0d1b2a', letterSpacing: '-0.7px' }}>{mvFull(rev.total)}</span>
            {rev.delta != null && (
              <span className="rv-chip" style={{ background: rev.delta >= 0 ? '#E7F6EF' : '#FCEBEB', color: rev.delta >= 0 ? '#1D8A5B' : '#D0453F' }}>
                {rev.delta >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                {Math.abs(rev.delta).toFixed(1)}%
              </span>
            )}
          </div>
          <div className="rv-ranges">
            {RANGES.map(r => (
              <button key={r.key} className={range === r.key ? 'on' : ''} onClick={() => setRange(r.key)}>{r.label}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: '4px 22px 16px' }}>
          {rev.data.length === 0
            ? <div style={{ padding: '70px 0', textAlign: 'center', color: '#c4bcb0', fontSize: 13, fontFamily: UI }}>No data for this period yet</div>
            : <TrendLine data={rev.data} valueKey="revenue" seriesLabel="Revenue" format={mvFull} />}
        </div>
      </div>

      {/* Everything the revenue panel doesn't already cover */}
      <div className="rv-mini">
        {metrics.map((m, i) => (
          <div key={i} className="rv-minicard" style={{ animation: 'fadeSlideUp 0.3s ease both', animationDelay: `${0.05 + i * 0.04}s` }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="rv-tlabel" style={{ marginBottom: 7 }}>{m.label}</div>
              <div className="rv-minival">{m.value}</div>
            </div>
            <span style={{ background: m.bg, borderRadius: 10, padding: 8, display: 'flex', flexShrink: 0 }}>
              <m.icon size={15} color={m.color} />
            </span>
          </div>
        ))}
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>MVR {netOf(o).toFixed(2)}</div>
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
                    {(c.name || '?').charAt(0).toUpperCase()}
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
