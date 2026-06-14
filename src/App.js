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
import Categories from './pages/Categories'
import EmailCenter from './pages/EmailCenter'
import {
  LayoutDashboard, ShoppingCart, Package, Users,
  DollarSign, BarChart2, Truck, ChevronDown, ChevronRight,
  LogOut, Building2, FileText, Menu, CalendarDays, Mail, X, Tag
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
      { id: 'categories', label: 'Categories', icon: Tag },
      { id: 'purchase-orders', label: 'Purchase Orders', icon: Truck },
      { id: 'customers', label: 'Customers', icon: Users },
      { id: 'tasks', label: 'Tasks & Calendar', icon: CalendarDays },
      { id: 'email', label: 'Email Center', icon: Mail },
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
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Poppins, sans-serif', background: '#f8f7f4' }}>
      <div style={{ textAlign: 'center' }}>
        <img src="/logo.png" alt="Brick's & Joy" style={{ width: 64, height: 64, objectFit: 'contain', marginBottom: 20, filter: 'drop-shadow(0 4px 12px rgba(255,165,0,0.3))' }} onError={e => e.target.style.display='none'} />
        <div style={{ width: 30, height: 30, border: '3px solid #f0ece6', borderTopColor: '#FFA500', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
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
    email: <EmailCenter />,
    categories: <Categories />,
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
        ::-webkit-scrollbar-thumb:hover { background: #ccc; }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .nav-item {
          display: flex; align-items: center; gap: 10px; padding: 9px 12px;
          border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 500;
          color: #667; transition: all 0.15s; border: none; background: none;
          width: 100%; text-align: left; font-family: inherit; letter-spacing: 0;
        }
        .nav-item:hover { background: #f5f4f1; color: #0d1b2a; }
        .nav-item.active {
          background: linear-gradient(135deg, #FFA500, #ff8c00);
          color: #fff; font-weight: 700;
          box-shadow: 0 3px 10px rgba(255,165,0,0.3);
        }
        .nav-item.active svg { color: #fff !important; }

        .sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(13,27,42,0.4); z-index: 99; backdrop-filter: blur(2px); }
        @media (max-width: 768px) {
          .sidebar { transform: translateX(-100%); transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1); position: fixed !important; z-index: 100; height: 100vh; }
          .sidebar.open { transform: translateX(0); }
          .sidebar-overlay.open { display: block; }
          .main-content { margin-left: 0 !important; }
        }
        .page-content { animation: fadeSlideUp 0.25s ease both; }
      `}</style>

      {/* Sidebar overlay (mobile) */}
      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}
        style={{ width: 234, background: '#fff', borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto', position: 'relative', boxShadow: '2px 0 12px rgba(0,0,0,0.04)' }}>

        {/* Logo */}
        <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid #f5f5f5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <img src="/logo.png" alt="Brick's & Joy" style={{ width: 38, height: 38, objectFit: 'contain', flexShrink: 0, filter: 'drop-shadow(0 2px 6px rgba(255,165,0,0.25))' }}
              onError={e => { e.target.style.display = 'none' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-0.3px', lineHeight: 1.2 }}>Brick's & Joy</div>
              <div style={{ fontSize: 10, color: '#FFA500', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', marginTop: 2 }}>Business Manager</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '10px 10px', flex: 1 }}>
          {NAV.map((group, gi) => (
            <div key={gi} style={{ marginBottom: group.section ? 6 : 2 }}>
              {group.section && (
                <button onClick={() => toggleSection(group.section)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 2, borderRadius: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#ccc', textTransform: 'uppercase', letterSpacing: '1px' }}>{group.section}</span>
                  {collapsed[group.section]
                    ? <ChevronRight size={11} color="#ccc" />
                    : <ChevronDown size={11} color="#ccc" />}
                </button>
              )}
              {!collapsed[group.section] && group.items.map(item => (
                <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>
                  <item.icon size={15} color={page === item.id ? '#fff' : '#aaa'} style={{ flexShrink: 0 }} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <div style={{ padding: '10px', borderTop: '1px solid #f5f5f5' }}>
          <button className="nav-item" onClick={() => supabase.auth.signOut()} style={{ color: '#e74c3c', gap: 10 }}>
            <LogOut size={14} color="#e74c3c" /> Sign out
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', marginLeft: 0 }}>
        {/* Top bar */}
        <div style={{
          background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '13px 22px',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <button onClick={() => setSidebarOpen(true)}
            style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 8 }}
            className="mobile-menu-btn">
            <Menu size={19} color="#0d1b2a" />
          </button>
          <style>{`@media (max-width: 768px) { .mobile-menu-btn { display: flex !important; } }`}</style>
          {currentItem && <currentItem.icon size={16} color="#FFA500" />}
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', letterSpacing: '-0.2px' }}>
            {currentItem?.label || 'Dashboard'}
          </span>
        </div>

        {/* Page */}
        <div key={page} className="page-content" style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
          {pages[page] || <Dashboard />}
        </div>
      </div>
    </div>
  )
}
