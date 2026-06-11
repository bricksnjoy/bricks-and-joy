import React, { useState, useEffect, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Orders from './pages/Orders'
import Customers from './pages/Customers'
import PurchaseOrders from './pages/PurchaseOrders'
import CostManagement from './pages/CostManagement'
import ProfitLoss from './pages/ProfitLoss'
import Statistics from './pages/Statistics'
import {
  LayoutDashboard, Package, ShoppingCart, Users,
  Truck, TrendingUp, BarChart3, LogOut, Receipt, BookOpen, Menu, X
} from 'lucide-react'

export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

function Layout({ children }) {
  const { user, signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const nav = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    { to: '/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/customers', icon: Users, label: 'Customers' },
    { to: '/purchase-orders', icon: Truck, label: 'Purchase Orders' },
    { to: '/costs', icon: Receipt, label: 'Cost Management' },
    { to: '/accounting', icon: BookOpen, label: 'Accounting' },
    { to: '/statistics', icon: BarChart3, label: 'Statistics' },
  ]

  const SidebarContent = ({ mobile = false }) => (
    <>
      <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="Brick's & Joy" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'contain', background: '#fff', padding: 2, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Brick's & Joy</div>
            <div style={{ fontSize: 10, color: '#29b6f6', textTransform: 'uppercase', letterSpacing: '1px' }}>Toy Company</div>
          </div>
        </div>
        {mobile && <button onClick={() => setMobileOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 4 }}><X size={20} /></button>}
      </div>
      <nav style={{ flex: 1, padding: '10px 0', overflowY: 'auto' }}>
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'}
            onClick={() => mobile && setMobileOpen(false)}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
              background: isActive ? 'rgba(255,165,0,0.12)' : 'transparent',
              textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 400,
              borderLeft: isActive ? '3px solid #FFA500' : '3px solid transparent',
              transition: 'all 0.15s', whiteSpace: 'nowrap'
            })}>
            <Icon size={18} style={{ flexShrink: 0 }} />{label}
          </NavLink>
        ))}
      </nav>
      <div style={{ padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
        <button onClick={signOut} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}>
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f5f8ff', fontFamily: "'Poppins', sans-serif" }}>
      {/* Desktop sidebar */}
      <aside onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)} className="desktop-sidebar"
        style={{ width: expanded ? 220 : 64, background: '#0d1b2a', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0, height: '100vh', transition: 'width 0.2s ease', overflow: 'hidden', zIndex: 100 }}>
        <div style={{ padding: expanded ? '16px' : '16px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10, transition: 'padding 0.2s', overflow: 'hidden' }}>
          <img src="/logo.png" alt="Brick's & Joy" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'contain', background: '#fff', padding: 2, flexShrink: 0 }} />
          {expanded && <div><div style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>Brick's & Joy</div><div style={{ fontSize: 10, color: '#29b6f6', textTransform: 'uppercase', letterSpacing: '1px' }}>Toy Company</div></div>}
        </div>
        <nav style={{ flex: 1, padding: '10px 0', overflowY: 'auto', overflowX: 'hidden' }}>
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 12,
                padding: expanded ? '11px 16px' : '11px 0',
                justifyContent: expanded ? 'flex-start' : 'center',
                color: isActive ? '#fff' : 'rgba(255,255,255,0.45)',
                background: isActive ? 'rgba(255,165,0,0.12)' : 'transparent',
                textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 400,
                borderLeft: isActive ? '3px solid #FFA500' : '3px solid transparent',
                transition: 'all 0.15s', whiteSpace: 'nowrap', overflow: 'hidden'
              })}>
              <Icon size={18} style={{ flexShrink: 0 }} />{expanded && label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: expanded ? '14px 16px' : '14px 0', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: expanded ? 'flex-start' : 'center' }}>
          <button onClick={signOut} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            <LogOut size={16} style={{ flexShrink: 0 }} />{expanded && 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }}>
          <div style={{ background: '#0d1b2a', width: 260, height: '100%', display: 'flex', flexDirection: 'column', boxShadow: '4px 0 20px rgba(0,0,0,0.3)' }}><SidebarContent mobile /></div>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }} onClick={() => setMobileOpen(false)} />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="mobile-topbar" style={{ display: 'none', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#0d1b2a', position: 'sticky', top: 0, zIndex: 99 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/logo.png" alt="Brick's & Joy" style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'contain', background: '#fff', padding: 2 }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Brick's & Joy</span>
          </div>
          <button onClick={() => setMobileOpen(true)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4 }}><Menu size={22} /></button>
        </div>
        <main style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>{children}</main>
        <div className="mobile-bottomnav" style={{ display: 'none', position: 'sticky', bottom: 0, background: '#0d1b2a', borderTop: '1px solid rgba(255,255,255,0.08)', zIndex: 99 }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', padding: '8px 0' }}>
            {nav.slice(0, 5).map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} end={to === '/'}
                style={({ isActive }) => ({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 8px', color: isActive ? '#FFA500' : 'rgba(255,255,255,0.4)', textDecoration: 'none', fontSize: 10, fontWeight: isActive ? 600 : 400, minWidth: 50, textAlign: 'center' })}>
                <Icon size={20} />{label.split(' ')[0]}
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 769px) { .desktop-sidebar { display: flex !important; } .mobile-topbar { display: none !important; } .mobile-bottomnav { display: none !important; } }
        @media (max-width: 768px) { .desktop-sidebar { display: none !important; } .mobile-topbar { display: flex !important; } .mobile-bottomnav { display: flex !important; } }
      `}</style>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Poppins, sans-serif', flexDirection: 'column', gap: 12 }}><img src="/logo.png" alt="logo" style={{ width: 48, borderRadius: 10 }} /><span style={{ fontSize: 13, color: '#888' }}>Loading…</span></div>
  if (!user) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setUser(session?.user ?? null); setLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setUser(session?.user ?? null) })
    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => { await supabase.auth.signOut(); setUser(null) }

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
          <Route path="/purchase-orders" element={<ProtectedRoute><PurchaseOrders /></ProtectedRoute>} />
          <Route path="/costs" element={<ProtectedRoute><CostManagement /></ProtectedRoute>} />
          <Route path="/accounting" element={<ProtectedRoute><ProfitLoss /></ProtectedRoute>} />
          <Route path="/statistics" element={<ProtectedRoute><Statistics /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
