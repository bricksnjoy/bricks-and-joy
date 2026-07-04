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
import MessageCenter from './pages/MessageCenter'
import Deliveries from './pages/Deliveries'
import Invoices from './pages/Invoices'
import Planning from './pages/Planning'
import FuturePlans from './pages/FuturePlans'
import Reconciliation from './pages/Reconciliation'
import Budget from './pages/Budget'
import StockReport from './pages/StockReport'
import HelpGuide from './pages/HelpGuide'
import Settings from './pages/Settings'
import AuditLog from './pages/AuditLog'
import {
  LayoutDashboard, ShoppingCart, Package, Users,
  DollarSign, BarChart2, Truck, ChevronDown, ChevronRight,
  LogOut, Building2, FileText, Menu, CalendarDays, Tag, BookOpen,
  GripVertical, Check, Settings2, MoreVertical, Sparkles, MessageSquare, LifeBuoy, TrendingUp, Scale, ClipboardList, Target, Settings as SettingsIcon, History
} from 'lucide-react'

// Catalog of every page. The sidebar layout (sections + order) is built from
// DEFAULT_NAV but can be reorganized by the user and is persisted to localStorage.
const ITEMS = {
  dashboard:          { label: 'Dashboard',         icon: LayoutDashboard, render: <Dashboard /> },
  orders:             { label: 'Orders',            icon: ShoppingCart,    render: <Orders /> },
  invoices:           { label: 'Invoices',          icon: FileText,        render: <Invoices /> },
  customers:          { label: 'Customers',         icon: Users,           render: <Customers /> },
  deliveries:         { label: 'Deliveries',        icon: Truck,           render: <Deliveries /> },
  tasks:              { label: 'Tasks & Calendar',  icon: CalendarDays,    render: <TasksCalendar /> },
  messages:           { label: 'Message Center',    icon: MessageSquare,   render: <MessageCenter /> },
  planning:           { label: 'Planning',          icon: Sparkles,        render: <Planning /> },
  inventory:          { label: 'Inventory',         icon: Package,         render: <Inventory /> },
  categories:         { label: 'Categories',        icon: Tag,             render: <Categories /> },
  'purchase-orders':  { label: 'Batch Orders',      icon: Truck,           render: <PurchaseOrders /> },
  'supplier-catalog': { label: 'Supplier Catalog',  icon: BookOpen,        render: <SupplierCatalog /> },
  'stock-report':     { label: 'Stock Report',      icon: ClipboardList,   render: <StockReport /> },
  'future-plans':     { label: 'Future Plans',      icon: TrendingUp,      render: <FuturePlans /> },
  'profit-loss':      { label: 'Financial Reports', icon: FileText,        render: <ProfitLoss /> },
  reconciliation:     { label: 'Reconciliation',    icon: Scale,           render: <Reconciliation /> },
  budget:             { label: 'Budget vs Actual',  icon: Target,          render: <Budget /> },
  costs:              { label: 'Cost Management',    icon: DollarSign,      render: <CostManagement /> },
  vendors:            { label: 'Vendors',           icon: Building2,       render: <Vendors /> },
  statistics:         { label: 'Analytics',         icon: BarChart2,       render: <Statistics /> },
  'audit-log':        { label: 'Audit Log',         icon: History,         render: <AuditLog /> },
}

const DEFAULT_NAV = [
  { id: 'main',       section: null,             items: ['dashboard'] },
  { id: 'pos',        section: 'Point of Sale',  items: ['orders', 'invoices', 'customers', 'deliveries', 'tasks', 'messages', 'planning'] },
  { id: 'inventory',  section: 'Inventory',      items: ['inventory', 'categories', 'purchase-orders', 'supplier-catalog', 'stock-report'] },
  { id: 'accounting', section: 'Accounting',     items: ['future-plans', 'profit-loss', 'reconciliation', 'budget', 'costs', 'vendors', 'statistics', 'audit-log'] },
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
  const [helpOpen, setHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // Lets any page request navigation (e.g. Dashboard action center) without prop drilling
  useEffect(() => {
    const handler = e => { if (e.detail && ITEMS[e.detail]) { setPage(e.detail); setSidebarOpen(false) } }
    window.addEventListener('bnj-navigate', handler)
    return () => window.removeEventListener('bnj-navigate', handler)
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

          /* Multi-column grids that lack their own breakpoint collapse to 2 cols */
          .grid-collapse { grid-template-columns: 1fr 1fr !important; }
          /* Shared component spacing tightened for small screens */
          .ui-card { padding: 16px 15px !important; border-radius: 12px !important; }
          .page-header { margin-bottom: 18px !important; }
          .page-header h1 { font-size: 20px !important; }
          .modal-overlay { padding: 10px !important; }
          .modal-head { padding: 15px 16px !important; }
          .modal-body { padding: 16px !important; }
          .modal-card { border-radius: 16px !important; max-height: 94vh !important; }
          /* Nothing inside a modal may force the card wider than the screen */
          .modal-body img, .modal-body video, .modal-body canvas { max-width: 100% !important; height: auto; }
          .modal-body input, .modal-body select, .modal-body textarea { max-width: 100%; }
          .data-table { font-size: 12px !important; min-width: max-content; }
          .data-table th, .data-table td { padding: 8px 9px !important; }
          /* Toasts span the width so they never run off-screen */
          .toast-wrap { left: 12px !important; right: 12px !important; bottom: 12px !important; }
          .toast-wrap > div { min-width: 0 !important; }
        }
        @media (max-width: 480px) {
          /* On phones everything stacks to a single column */
          .grid-collapse { grid-template-columns: 1fr !important; }
          .modal-body { padding: 14px !important; }
          .modal-head { padding: 13px 14px !important; }
          .modal-head h2 { font-size: 16px !important; }
        }
        /* Utilities for narrow screens */
        .x-scroll-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        @media (max-width: 768px) {
          .x-wrap { flex-wrap: wrap !important; }
          .x-scroll { overflow-x: auto !important; flex-wrap: nowrap !important; max-width: 100%; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
          .x-scroll::-webkit-scrollbar { display: none; }
          .x-scroll > * { flex-shrink: 0 !important; }
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
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 8px', background: 'none', border: 'none', cursor: editMode ? 'grab' : 'default', fontFamily: 'inherit', marginBottom: 2, borderRadius: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: editMode ? '#FFA500' : '#ccc', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    {editMode && <GripVertical size={11} color="#FFA500" />}
                    {group.section}
                  </span>
                </button>
              )}
              {group.items.map(id => {
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
                <button className="nav-item" onClick={() => { setHelpOpen(true); setMenuOpen(false) }}
                  style={{ color: '#0d1b2a', fontWeight: 600 }}>
                  <LifeBuoy size={15} color="#FFA500" /> How-to guide
                </button>
                <button className="nav-item" onClick={() => { setSettingsOpen(true); setMenuOpen(false) }}
                  style={{ color: '#0d1b2a', fontWeight: 600 }}>
                  <SettingsIcon size={15} color="#FFA500" /> Settings
                </button>
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

      {helpOpen && <HelpGuide onClose={() => setHelpOpen(false)} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
