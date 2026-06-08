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
import {
  LayoutDashboard, Package, ShoppingCart, Users,
  Truck, TrendingUp, BarChart3, LogOut, Menu, X
} from 'lucide-react'

export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

function Layout({ children }) {
  const { user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  const nav = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/inventory', icon: Package, label: 'Inventory' },
    { to: '/orders', icon: ShoppingCart, label: 'Orders' },
    { to: '/customers', icon: Users, label: 'Customers' },
    { to: '/purchase-orders', icon: Truck, label: 'Purchase Orders' },
    { to: '/profit-loss', icon: TrendingUp, label: 'Profit & Loss' },
    { to: '/statistics', icon: BarChart3, label: 'Statistics' },
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f5f8ff', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Sidebar */}
      <aside style={{
        width: 230, background: '#0d1b2a', color: '#fff', display: 'flex',
        flexDirection: 'column', padding: '0', flexShrink: 0,
        position: 'sticky', top: 0, height: '100vh',
        borderRight: '1px solid rgba(255,255,255,0.06)'
      }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/logo.png" alt="Bricks & Joy" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'contain', background: '#fff', padding: 2 }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: '-0.3px', lineHeight: 1.2 }}>Brick's & Joy</div>
              <div style={{ fontSize: 10, color: '#29b6f6', marginTop: 2, textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: 600 }}>Toy Company</div>
            </div>
          </div>
        </div>
        <nav style={{ flex: 1, padding: '12px 0', overflowY: 'auto' }}>
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
              background: isActive ? 'rgba(255,165,0,0.12)' : 'transparent',
              textDecoration: 'none', fontSize: 13, fontWeight: isActive ? 500 : 400,
              borderLeft: isActive ? '3px solid #FFA500' : '3px solid transparent',
              transition: 'all 0.15s'
            })}>
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </div>
          <button onClick={signOut} style={{
            display: 'flex', alignItems: 'center', gap: 8, background: 'none',
            border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13, padding: 0
          }}>
            <LogOut size={14} /> Sign out
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
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
