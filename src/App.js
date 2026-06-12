import React, { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import Inventory from './pages/Inventory'
import Customers from './pages/Customers'
import CostManagement from './pages/CostManagement'
import ProfitLoss from './pages/ProfitLoss'
import Statistics from './pages/Statistics'
import PurchaseOrders from './pages/PurchaseOrders'
import Vendors from './pages/Vendors'
import TasksCalendar from './pages/TasksCalendar'
import {
  LayoutDashboard, ShoppingCart, Package, Users,
  DollarSign, BarChart2, Truck, ChevronDown, ChevronRight,
  LogOut, Building2, FileText, Menu, CalendarDays
} from 'lucide-react'

const NAV = [
  {
    section: null,
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ]
  },
  {
    section: 'POS & Inventory',
    items: [
      { id: 'orders', label: 'Orders', icon: ShoppingCart },
      { id: 'inventory', label: 'Inventory', icon: Package },
      { id: 'purchase-orders', label: 'Purchase Orders', icon: Truck },
      { id: 'customers', label: 'Customers', icon: Users },
      { id: 'tasks', label: 'Tasks & Calendar', icon: CalendarDays },
    ]
  },
  {
    section: 'Accounting',
    items: [
      { id: 'profit-loss', label: 'Financial Reports', icon: FileText },
      { id: 'costs', label: 'Cost Management', icon: DollarSign },
      { id: 'vendors', label: 'Vendors', icon: Building2 },
      { id: 'statistics', label: 'Analytics', icon: BarChart2 },
    ]
  },
]

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState({})

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Poppins, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <img src="/logo.png" alt="Brick's & Joy" style={{ width: 60, height: 60, objectFit: 'contain', marginBottom: 16 }} />
        <div style={{ width: 28, height: 28, border: '3px solid #FFA500', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )
  if (!session) return <Login />

  function navigate(id) {
    setPage(id)
    setSidebarOpen(false)
  }

  function toggleSection(section) {
    setCollapsed(p => ({ ...p, [section]: !p[section] }))
  }

  const pages = {
    dashboard: <Dashboard />,
    orders: <Orders />,
    inventory: <Inventory />,
    'purchase-orders': <PurchaseOrders />,
    customers: <Customers />,
    tasks: <TasksCalendar />,
    'profit-loss': <ProfitLoss />,
    costs: <CostManagement />,
    vendors: <Vendors />,
    statistics: <Statistics />,
  }

  const allItems = NAV.flatMap(g => g.items)
  const currentItem = allItems.find(i => i.id === page)

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Poppins', sans-serif", background: '#f8f7f4', overflow: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 99px; }
        @keyframes spin { to { transform: rotate(360deg) } }
        .nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-radius: 10px; cursor: pointer; font-size: 13.5px; font-weight: 500; color: #555; transition: all 0.15s; border: none; background: none; width: 100%; text-align: left; font-family: inherit; }
        .nav-item:hover { background: #f0efec; color: #0d1b2a; }
        .nav-item.active { background: #FFA500; color: #fff; font-weight: 700; }
        .nav-item.active svg { color: #fff; }
        .sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 99; }
        @media (max-width: 768px) {
          .sidebar { transform: translateX(-100%); transition: transform 0.25s ease; position: fixed !important; z-index: 100; height: 100vh; }
          .sidebar.open { transform: translateX(0); }
          .sidebar-overlay.open { display: block; }
          .main-content { margin-left: 0 !important; }
        }
      `}</style>

      {/* Sidebar overlay (mobile) */}
      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}
        style={{ width: 230, background: '#fff', borderRight: '1px solid #eee', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto', position: 'relative' }}>

        {/* Logo */}
        <div style={{ padding: '20px 18px 14px', borderBottom: '1px solid #f5f5f5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/logo.png" alt="Brick's & Joy" style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }}
              onError={e => { e.target.style.display = 'none' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-0.3px' }}>Brick's & Joy</div>
              <div style={{ fontSize: 10, color: '#FFA500', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>Business Manager</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '12px 12px', flex: 1 }}>
          {NAV.map((group, gi) => (
            <div key={gi} style={{ marginBottom: group.section ? 8 : 4 }}>
              {/* Section header */}
              {group.section && (
                <button onClick={() => toggleSection(group.section)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '5px 6px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '1px' }}>{group.section}</span>
                  {collapsed[group.section]
                    ? <ChevronRight size={12} color="#bbb" />
                    : <ChevronDown size={12} color="#bbb" />}
                </button>
              )}
              {/* Nav items */}
              {!collapsed[group.section] && group.items.map(item => (
                <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>
                  <item.icon size={16} color={page === item.id ? '#fff' : '#999'} style={{ flexShrink: 0 }} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <div style={{ padding: '12px', borderTop: '1px solid #f5f5f5' }}>
          <button className="nav-item" onClick={() => supabase.auth.signOut()} style={{ color: '#c62828' }}>
            <LogOut size={15} color="#c62828" /> Sign out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', marginLeft: 0 }}>
        {/* Top bar */}
        <div style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button onClick={() => setSidebarOpen(true)}
            style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
            className="mobile-menu-btn">
            <Menu size={20} color="#0d1b2a" />
          </button>
          <style>{`@media (max-width: 768px) { .mobile-menu-btn { display: flex !important; } }`}</style>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#0d1b2a' }}>
            {currentItem?.label || 'Dashboard'}
          </span>
        </div>

        {/* Page */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {pages[page] || <Dashboard />}
        </div>
      </div>
    </div>
  )
}
