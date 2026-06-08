import React, { useState, useEffect, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Orders from './pages/Orders'
import Customers from './pages/Customers'
import PurchaseOrders from './pages/PurchaseOrders'
import ProfitLoss from './pages/ProfitLoss'
import Statistics from './pages/Statistics'
import InstagramDMs from './pages/InstagramDMs'
import {
  LayoutDashboard, Package, ShoppingCart, Users,
  Truck, TrendingUp, BarChart3, LogOut, Instagram
} from 'lucide-react'

export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

function Layout({ children }) {
  const { user, signOut } = useAuth()
  const [expanded, setExpanded] = useState(false)

  const nav = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    { to: '/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/customers', icon: Users, label: 'Customers' },
    { to: '/purchase-orders', icon: Truck, label: 'Purchase Orders' },
    { to: '/profit-loss', icon: TrendingUp, label: 'Profit & Loss' },
    { to: '/statistics', icon: BarChart3, label: 'Statistics' },
    { to: '/instagram', icon: Instagram, label: 'Instagram DMs' },
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f5f8ff', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Slim icon sidebar */}
      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        style={{
          width: expanded ? 220 : 64, background: '#0d1b2a', color: '#fff',
          display: 'flex', flexDirection: 'column', flexShrink: 0,
          position: 'sticky', top: 0, height: '100vh',
          transition: 'width 0.2s ease', overflow: 'hidden',
          borderRight: '1px solid rgba(255,255,255,0.06)', zIndex: 100
        }}>
        {/* Logo */}
        <div style={{ padding: expanded ? '18px 16px' : '18px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', transition: 'padding 0.2s' }}>
          <img src="/logo.png" alt="Brick's & Joy" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'contain', background: '#fff', padding: 2, flexShrink: 0 }} />
          {expanded && (
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Brick's & Joy</div>
              <div style={{ fontSize: 10, color: '#29b6f6', textTransform: 'uppercase', letterSpacing: '1px' }}>Toy Company</div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '10px 0', overflowY: 'auto', overflowX: 'hidden' }}>
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 12,
              padding: expanded ? '10px 16px' : '10px 0',
              justifyContent: expanded ? 'flex-start' : 'center',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.45)',
              background: isActive ? 'rgba(255,165,0,0.12)' : 'transparent',
              textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 600 : 400,
              borderLeft: isActive ? '3px solid #FFA500' : '3px solid transparent',
              transition: 'all 0.15s', whiteSpace: 'nowrap', overflow: 'hidden'
            })}>
              <Icon size={18} style={{ flexShrink: 0 }} />
              {expanded && label}
            </NavLink>
          ))}
        </nav>

        {/* Sign out */}
        <div style={{ padding: expanded ? '14px 16px' : '14px 0', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10, justifyContent: expanded ? 'flex-start' : 'center' }}>
          <button onClick={signOut} style={{
            display: 'flex', alignItems: 'center', gap: 8, background: 'none',
            border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
            fontSize: 13, padding: 0, whiteSpace: 'nowrap'
          }}>
            <LogOut size={16} style={{ flexShrink: 0 }} />
            {expanded && 'Sign out'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: '32px', overflowY: 'auto', maxWidth: '100%' }}>
        {children}
      </main>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'DM Sans, sans-serif', color: '#888' }}>Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

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
          <Route path="/profit-loss" element={<ProtectedRoute><ProfitLoss /></ProtectedRoute>} />
          <Route path="/statistics" element={<ProtectedRoute><Statistics /></ProtectedRoute>} />
          <Route path="/instagram" element={<ProtectedRoute><InstagramDMs /></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
