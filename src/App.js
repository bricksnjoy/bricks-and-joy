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
import SupplierCatalog from './pages/SupplierCatalog'
import EmailCenter from './pages/EmailCenter'
import {
  LayoutDashboard, ShoppingCart, Package, Users,
  DollarSign, BarChart2, Truck, ChevronDown, ChevronRight,
  LogOut, Building2, FileText, Menu, CalendarDays, Mail, Tag, BookOpen,
  GripVertical, Check, Settings2, MoreVertical
} from 'lucide-react'

// Catalog of every page. The sidebar layout (sections + order) is built from
// DEFAULT_NAV but can be reorganized by the user and is persisted to localStorage.
const ITEMS = {
  dashboard:          { label: 'Dashboard',         icon: LayoutDashboard, render: <Dashboard /> },
  orders:             { label: 'Orders',            icon: ShoppingCart,    render: <Orders /> },
  customers:          { label: 'Customers',         icon: Users,           render: <Customers /> },
  tasks:              { label: 'Tasks & Calendar',  icon: CalendarDays,    render: <TasksCalendar /> },
  email:              { label: 'Email Center',      icon: Mail,            render: <EmailCenter /> },
  inventory:          { label: 'Inventory',         icon: Package,         render: <Inventory /> },
  categories:         { label: 'Categories',        icon: Tag,             render: <Categories /> },
  'purchase-orders':  { label: 'Purchase Orders',   icon: Truck,           render: <PurchaseOrders /> },
  'supplier-catalog': { label: 'Supplier Catalog',  icon: BookOpen,        render: <SupplierCatalog /> },
  'profit-loss':      { label: 'Financial Reports', icon: FileText,        render: <ProfitLoss /> },
  costs:              { label: 'Cost Management',    icon: DollarSign,      render: <CostManagement /> },
  vendors:            { label: 'Vendors',           icon: Building2,       render: <Vendors /> },
  statistics:         { label: 'Analytics',         icon: BarChart2,       render: <Statistics /> },
}

const DEFAULT_NAV = [
  { id: 'main',       section: null,             items: ['dashboard'] },
  { id: 'pos',        section: 'Point of Sale',  items: ['orders', 'customers', 'tasks', 'email'] },
  { id: 'inventory',  section: 'Inventory',      items: ['inventory', 'categories', 'purchase-orders', 'supplier-catalog'] },
  { id: 'accounting', section: 'Accounting',     items: ['profit-loss', 'costs', 'vendors', 'statistics'] },
]

const NAV_KEY = 'bnj_nav_layout_v1'

// Merge a saved layout with defaults so newly added pages always appear and
// removed pages are dropped.
function normalizeNav(saved) {
  if (!Array.isArray(saved) || !saved.length) return DEFAULT_NAV
  const known = new Set(Object.keys(ITEMS))
  const seen = new Set()
  const next = saved
    .filter(s => s && Array.isArray(s.items))
    .map(s => ({
      ...s,
      items: s.items.filter(i => { if (known.has(i) && !seen.has(i)) { seen.add(i); return true } return false })
    }))
  // append any item not present anywhere into its default section (or the last)
  for (const def of DEFAULT_NAV) {
    for (const i of def.items) {
      if (seen.has(i)) continue
      seen.add(i)
      let target = next.find(s => s.id === def.id)
      if (!target) { target = { ...def, items: [] }; next.push(target) }
      target.items.push(i)
    }
  }
  return next.filter(s => s.items.length || s.section)
}

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState({})
  const [editMode, setEditMode] = useState(false)
  const [nav, setNav] = useState(() => {
    try { return normalizeNav(JSON.parse(localStorage.getItem(NAV_KEY))) } catch { return DEFAULT_NAV }
  })
  const [drag, setDrag] = useState(null) // { type:'item'|'section', id }
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  function persist(next) {
    setNav(next)
    try { localStorage.setItem(NAV_KEY, JSON.stringify(next)) } catch {}
  }

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Poppins, sans-serif', background: '#f8f7f4' }}>
      <div style={{ textAlign: 'center' }}>
        <img src="/logo.png" alt="Brick's & Joy" style={{ width: 64, height: 64, objectFit: 'contain', marginBottom: 20, filter: 'drop-shadow(0 4px 12px rgba(255,165,0,0.3))', animation: 'bob 1.6s ease-in-out infinite' }} onError={e => e.target.style.display='none'} />
        <div style={{ width: 30, height: 30, border: '3px solid #f0ece6', borderTopColor: '#FFA500', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }`}</style>
      </div>
    </div>
  )
  if (!session) return <Login />

  function navigate(id) {
    if (editMode) return
    setPage(id)
    setSidebarOpen(false)
  }

  function toggleSection(section) {
    if (editMode) return
    setCollapsed(p => ({ ...p, [section]: !p[section] }))
  }

  // --- drag & drop reorder ---
  function moveItem(dragId, overSectionId, overItemId) {
    let next = nav.map(s => ({ ...s, items: s.items.filter(i => i !== dragId) }))
    const sIdx = next.findIndex(s => s.id === overSectionId)
    if (sIdx < 0) return
    const items = [...next[sIdx].items]
    let at = items.length
    if (overItemId && overItemId !== dragId) {
      const oi = items.indexOf(overItemId)
      if (oi >= 0) at = oi
    }
    items.splice(at, 0, dragId)
    next[sIdx] = { ...next[sIdx], items }
    persist(next)
  }

  function moveSection(dragId, overId) {
    if (dragId === overId) return
    const next = [...nav]
    const from = next.findIndex(s => s.id === dragId)
    const to = next.findIndex(s => s.id === overId)
    if (from < 0 || to < 0) return
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    persist(next)
  }

  const currentItem = ITEMS[page]

  return (
    <div className="app-shell" style={{ display: 'flex', fontFamily: "'Poppins', sans-serif", background: '#f8f7f4', overflow: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 99px; }
        ::-webkit-scrollbar-thumb:hover { background: #ccc; }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes wobble { 0%,100%{transform:rotate(-1.2deg)} 50%{transform:rotate(1.2deg)} }

        .nav-item {
          display: flex; align-items: center; gap: 10px; padding: 9px 12px;
          border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 500;
          color: #667; transition: all 0.15s; border: none; background: none;
          width: 100%; text-align: left; font-family: inherit; letter-spacing: 0;
          position: relative;
        }
        .nav-item:hover { background: #f5f4f1; color: #0d1b2a; transform: translateX(2px); }
        .nav-item.active {
          background: linear-gradient(135deg, #FFA500, #ff8c00);
          color: #fff; font-weight: 700;
          box-shadow: 0 3px 10px rgba(255,165,0,0.3);
        }
        .nav-item.active svg { color: #fff !important; }
        .nav-item.editing { cursor: grab; background: #fbfaf8; border: 1px dashed #e4ddd2; animation: wobble 0.4s ease-in-out infinite; }
        .nav-item.dragging { opacity: 0.4; }
        .sec-header.editing { cursor: grab; }
        .sec-header.editing:hover { background: #f5f4f1; }

        .sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(13,27,42,0.4); z-index: 99; backdrop-filter: blur(2px); }
        .app-shell { height: 100vh; height: 100dvh; }
        .sidebar { padding-top: env(safe-area-inset-top); }
        .app-header { padding-left: calc(22px + env(safe-area-inset-left)); padding-right: calc(22px + env(safe-area-inset-right)); }
        @media (max-width: 768px) {
          .sidebar { transform: translateX(-100%); transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1); position: fixed !important; z-index: 100; height: 100vh; height: 100dvh; }
          .sidebar.open { transform: translateX(0); }
          .sidebar-overlay.open { display: block; }
          .main-content { margin-left: 0 !important; }
          .app-header { padding-top: calc(13px + env(safe-area-inset-top)); padding-left: calc(14px + env(safe-area-inset-left)); padding-right: calc(14px + env(safe-area-inset-right)); }
          .page-content { padding: 14px 14px calc(16px + env(safe-area-inset-bottom)) !important; }
        }
        /* 'backwards' (not 'both') so the entry transform is NOT retained after the
           animation — a lingering transform creates a containing block that breaks
           position:fixed for descendants (modals, toasts). */
        .page-content { animation: fadeSlideUp 0.25s ease backwards; }
      `}</style>

      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}
        style={{ width: 234, background: '#fff', borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto', position: 'relative', boxShadow: '2px 0 12px rgba(0,0,0,0.04)' }}>

        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'center' }}>
          <img src="/logo-full.png" alt="Brick's & Joy" style={{ width: '90%', maxWidth: 190, height: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 4px 10px rgba(255,165,0,0.22))' }} />
        </div>

        {/* Nav */}
        <nav style={{ padding: '10px 10px', flex: 1 }}>
          {nav.map((group) => (
            <div key={group.id} style={{ marginBottom: group.section ? 6 : 2 }}
              onDragOver={editMode ? (e => { e.preventDefault() }) : undefined}
              onDrop={editMode && drag?.type === 'item' ? (e => { e.preventDefault(); moveItem(drag.id, group.id, null); setDrag(null) }) : undefined}
            >
              {group.section && (
                <button className={`sec-header ${editMode ? 'editing' : ''}`}
                  draggable={editMode}
                  onDragStart={editMode ? (e => { setDrag({ type: 'section', id: group.id }); e.dataTransfer.effectAllowed = 'move' }) : undefined}
                  onDragOver={editMode && drag?.type === 'section' ? (e => { e.preventDefault() }) : undefined}
                  onDrop={editMode && drag?.type === 'section' ? (e => { e.preventDefault(); e.stopPropagation(); moveSection(drag.id, group.id); setDrag(null) }) : undefined}
                  onClick={() => toggleSection(group.section)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 8px', background: 'none', border: 'none', cursor: editMode ? 'grab' : 'pointer', fontFamily: 'inherit', marginBottom: 2, borderRadius: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: editMode ? '#FFA500' : '#ccc', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    {editMode && <GripVertical size={11} color="#FFA500" />}
                    {group.section}
                  </span>
                  {!editMode && (collapsed[group.section]
                    ? <ChevronRight size={11} color="#ccc" />
                    : <ChevronDown size={11} color="#ccc" />)}
                </button>
              )}
              {(editMode || !collapsed[group.section]) && group.items.map(id => {
                const item = ITEMS[id]
                if (!item) return null
                return (
                  <button key={id}
                    className={`nav-item ${page === id && !editMode ? 'active' : ''} ${editMode ? 'editing' : ''} ${drag?.id === id ? 'dragging' : ''}`}
                    draggable={editMode}
                    onDragStart={editMode ? (e => { setDrag({ type: 'item', id }); e.dataTransfer.effectAllowed = 'move' }) : undefined}
                    onDragOver={editMode && drag?.type === 'item' ? (e => { e.preventDefault() }) : undefined}
                    onDrop={editMode && drag?.type === 'item' ? (e => { e.preventDefault(); e.stopPropagation(); moveItem(drag.id, group.id, id); setDrag(null) }) : undefined}
                    onClick={() => navigate(id)}>
                    {editMode && <GripVertical size={13} color="#d8cdbb" style={{ flexShrink: 0 }} />}
                    <item.icon size={15} color={page === id && !editMode ? '#fff' : '#aaa'} style={{ flexShrink: 0 }} />
                    {item.label}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Footer: Sign out + kebab menu */}
        <div style={{ padding: '10px', borderTop: '1px solid #f5f5f5', position: 'relative' }}>
          {editMode ? (
            <>
              <button className="nav-item" onClick={() => { setEditMode(false); setDrag(null) }}
                style={{ color: '#1D9E75', fontWeight: 700 }}>
                <Check size={15} color="#1D9E75" /> Done organizing
              </button>
              <button className="nav-item" onClick={() => persist(DEFAULT_NAV)} style={{ color: '#999', fontSize: 12, paddingLeft: 12 }}>
                Reset to default
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="nav-item" onClick={() => supabase.auth.signOut()} style={{ color: '#e74c3c', gap: 10, flex: 1 }}>
                <LogOut size={14} color="#e74c3c" /> Sign out
              </button>
              <button onClick={() => setMenuOpen(o => !o)} title="More"
                style={{ background: menuOpen ? '#f5f4f1' : 'none', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: 9, display: 'flex', flexShrink: 0, transition: 'background 0.15s' }}>
                <MoreVertical size={17} color="#888" />
              </button>
            </div>
          )}

          {/* Popover */}
          {menuOpen && !editMode && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', right: 10, bottom: 56, zIndex: 41, background: '#fff', borderRadius: 12, border: '1px solid #eee', boxShadow: '0 8px 26px rgba(13,27,42,0.16)', padding: 6, minWidth: 180, animation: 'fadeSlideUp 0.16s ease both' }}>
                <button className="nav-item" onClick={() => { setEditMode(true); setMenuOpen(false); setDrag(null) }}
                  style={{ color: '#0d1b2a', fontWeight: 600 }}>
                  <Settings2 size={15} color="#FFA500" /> Reorganize menu
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', marginLeft: 0 }}>
        <div className="app-header" style={{
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

        <div key={page} className="page-content" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '22px 26px' }}>
          {ITEMS[page]?.render || <Dashboard />}
        </div>
      </div>
    </div>
  )
}
