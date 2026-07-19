import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertTriangle, CheckCircle, Info, Inbox, Search, Check, ChevronDown, Clock } from 'lucide-react'

// ─── Image tile that auto-matches its background to the photo's edge color ──────
// Renders a container whose background blends with the product image's own
// background (sampled from a top corner pixel). Safely falls back to the CSS
// default if the image can't be read (e.g. cross-origin without CORS).
export function ImageTile({ src, className, style, onClick, title, children }) {
  const [bg, setBg] = useState(null)
  useEffect(() => {
    setBg(null)
    if (!src) return
    let cancelled = false
    const isData = src.startsWith('data:')
    const probe = new Image()
    if (!isData) probe.crossOrigin = 'anonymous'   // data URLs don't taint and can't take a query suffix
    probe.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = probe.naturalWidth || 1
        c.height = probe.naturalHeight || 1
        const ctx = c.getContext('2d')
        ctx.drawImage(probe, 0, 0)
        const p = ctx.getImageData(3, 3, 1, 1).data
        if (!cancelled && p[3] > 10) setBg(`rgb(${p[0]}, ${p[1]}, ${p[2]})`)
      } catch { /* tainted / CORS — keep the CSS default */ }
    }
    // For http(s), add a cache-buster so the probe fetch carries CORS headers
    // instead of reusing the display <img>'s cached (non-CORS) copy. Never alter a data: URL.
    probe.src = isData ? src : src + (src.includes('?') ? '&' : '?') + '_cors=1'
    return () => { cancelled = true }
  }, [src])
  return <div className={className} style={bg ? { ...style, background: bg } : style} onClick={onClick} title={title}>{children}</div>
}


// ─── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 12, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: 23, fontWeight: 800, margin: 0, color: '#0d1b2a', letterSpacing: '-0.5px' }}>{title}</h1>
        {subtitle && <p style={{ margin: '4px 0 0', color: '#aaa', fontSize: 13, fontWeight: 400 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, style = {} }) {
  return (
    <div className="ui-card" style={{
      background: '#fff', borderRadius: 14, border: '1px solid #eee',
      padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', ...style
    }}>
      {children}
    </div>
  )
}

// ─── Metric card ──────────────────────────────────────────────────────────────
export function MetricCard({ label, value, sub, color = '#0d1b2a', icon: Icon }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#fff', borderRadius: 14, border: '1px solid #eee',
        padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14,
        boxShadow: hovered ? '0 6px 24px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.04)',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'box-shadow 0.2s, transform 0.2s',
      }}>
      {Icon && (
        <div style={{ background: '#f8f7f4', borderRadius: 10, padding: 10, flexShrink: 0, transition: 'background 0.2s', ...(hovered ? { background: '#f0efec' } : {}) }}>
          <Icon size={18} color="#FFA500" />
        </div>
      )}
      <div>
        <div style={{ fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color, letterSpacing: '-1px', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────
export function Button({ children, onClick, variant = 'primary', size = 'md', disabled = false, style = {}, title }) {
  const [hovered, setHovered] = useState(false)
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none', borderRadius: 9, fontFamily: 'inherit', fontWeight: 600, transition: 'all 0.15s',
    opacity: disabled ? 0.5 : 1,
    transform: hovered && !disabled ? 'translateY(-1px)' : 'translateY(0)',
  }
  const sizes = { sm: { padding: '5px 10px', fontSize: 12 }, md: { padding: '9px 16px', fontSize: 13 }, lg: { padding: '12px 22px', fontSize: 14 } }
  const variants = {
    primary: { background: hovered ? '#e6940a' : '#FFA500', color: '#fff', boxShadow: hovered ? '0 4px 12px rgba(255,165,0,0.35)' : '0 1px 3px rgba(255,165,0,0.2)' },
    secondary: { background: hovered ? '#e8e8e8' : '#f0f0f0', color: '#333', boxShadow: 'none' },
    danger: { background: hovered ? '#fde0de' : '#fee', color: '#c0392b', border: '1px solid #fcc', boxShadow: 'none' },
    ghost: { background: hovered ? '#f5f5f5' : 'transparent', color: hovered ? '#0d1b2a' : '#666', border: '1px solid #e0e0e0', boxShadow: 'none' }
  }
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────────
export function Input({ label, error, style = {}, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, ...style }}>
      {label && <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>}
      <input {...props} style={{
        padding: '10px 13px', border: `1px solid ${error ? '#e74c3c' : '#e0e0e0'}`, borderRadius: 9,
        fontSize: 13, fontFamily: 'inherit', background: '#fff', color: '#0d1b2a',
        outline: 'none', transition: 'border 0.15s', width: '100%', boxSizing: 'border-box'
      }} />
      {error && <span style={{ fontSize: 11, color: '#e74c3c' }}>{error}</span>}
    </div>
  )
}

// ─── Select ───────────────────────────────────────────────────────────────────
export function Select({ label, options = [], style = {}, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, ...style }}>
      {label && <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</label>}
      <select {...props} style={{
        padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9,
        fontSize: 13, fontFamily: 'inherit', background: '#fff', color: '#0d1b2a',
        outline: 'none', width: '100%', boxSizing: 'border-box', cursor: 'pointer'
      }}>
        {options.map(o => (
          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
        ))}
      </select>
    </div>
  )
}

// ─── SearchSelect ─────────────────────────────────────────────────────────────
// Searchable dropdown for long lists (customers, products…). Options are
// { value, label, sub?, keywords? } — `sub` renders as a gray hint line and both
// `sub` and `keywords` are searchable. Pass `recentValues` (ids, newest first)
// to pin a "Recent" section on top when the search box is empty.
export function SearchSelect({ value, onChange, options = [], placeholder = 'Select…', recentValues = [], recentLabel = 'Recent', emptyText = 'No matches found', triggerStyle = {}, style = {} }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handler(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler) }
  }, [open])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const selected = options.find(o => o.value === value)
  const q = query.trim().toLowerCase()
  const matches = q ? options.filter(o => `${o.label || ''} ${o.sub || ''} ${o.keywords || ''}`.toLowerCase().includes(q)) : options
  // Recents only show while the search box is empty — a typed query returns one flat list
  const recents = q ? [] : recentValues.map(v => options.find(o => o.value === v)).filter(Boolean)
  const rest = recents.length ? matches.filter(o => !recents.some(r => r.value === o.value)) : matches

  function pick(v) {
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); setQuery('') }
    if (e.key === 'Enter') {
      e.preventDefault()
      const first = (recents.length ? recents : rest)[0]
      if (first) pick(first.value)
    }
  }

  const Row = ({ o, recent }) => {
    const active = o.value === value
    return (
      <div key={o.value} onClick={() => pick(o.value)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', cursor: 'pointer', background: active ? '#FFF8E9' : '#fff', borderRadius: 8 }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f7f7f7' }}
        onMouseLeave={e => { e.currentTarget.style.background = active ? '#FFF8E9' : '#fff' }}>
        {recent && <Clock size={12} color="#c9a227" style={{ flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: '#0d1b2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</div>
          {o.sub && <div style={{ fontSize: 11, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.sub}</div>}
        </div>
        {active && <Check size={14} color="#FFA500" style={{ flexShrink: 0 }} />}
      </div>
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <button type="button" onClick={() => { setOpen(o => !o); setQuery('') }}
        style={{
          width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8,
          fontSize: 13, fontFamily: 'inherit', background: '#fff', outline: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', boxSizing: 'border-box',
          color: selected ? '#0d1b2a' : '#888', ...triggerStyle,
        }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
          {selected?.sub && <span style={{ color: '#aaa', fontSize: 12 }}> — {selected.sub}</span>}
        </span>
        <ChevronDown size={14} color="#999" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 60,
          background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12,
          boxShadow: '0 12px 32px rgba(13,27,42,0.16)', overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid #f0f0f0' }}>
            <Search size={14} color="#bbb" style={{ flexShrink: 0 }} />
            {/* 16px font stops iOS Safari from auto-zooming the field on focus */}
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
              placeholder="Type to search…"
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontFamily: 'inherit', background: 'transparent', padding: 0 }} />
            {query && <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus() }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: '#bbb' }}><X size={13} /></button>}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', padding: 4, WebkitOverflowScrolling: 'touch' }}>
            {recents.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#c9a227', textTransform: 'uppercase', letterSpacing: '0.6px', padding: '6px 12px 3px' }}>{recentLabel}</div>
                {recents.map(o => <Row key={`r-${o.value}`} o={o} recent />)}
                {rest.length > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.6px', padding: '8px 12px 3px', borderTop: '1px solid #f5f5f5', marginTop: 4 }}>All</div>}
              </>
            )}
            {rest.map(o => <Row key={o.value} o={o} />)}
            {recents.length === 0 && rest.length === 0 && (
              <div style={{ padding: '18px 12px', textAlign: 'center', fontSize: 12.5, color: '#bbb' }}>{emptyText}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ children, color = 'gray' }) {
  const colors = {
    green: { bg: '#e8f5e9', text: '#2e7d32' },
    red: { bg: '#fdecea', text: '#c62828' },
    amber: { bg: '#fff8e1', text: '#f57f17' },
    blue: { bg: '#e3f2fd', text: '#1565c0' },
    gray: { bg: '#f5f5f5', text: '#616161' },
    purple: { bg: '#f3e5f5', text: '#6a1b9a' },
  }
  const c = colors[color] || colors.gray
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 600, background: c.bg, color: c.text, letterSpacing: '0.2px'
    }}>
      {children}
    </span>
  )
}

// ─── Status badge helper ──────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  const map = {
    created: ['Order created', 'purple'],
    pending: ['Pending', 'amber'],
    transit: ['Dispatched', 'blue'],
    delivered: ['Delivered', 'green'],
    cancelled: ['Cancelled', 'red'],
    received: ['Received', 'green'],
    ordered: ['Ordered', 'blue'],
  }
  const [label, color] = map[status] || [status, 'gray']
  return <Badge color={color}>{label}</Badge>
}

// ─── Stock badge ──────────────────────────────────────────────────────────────
export function StockBadge({ qty, threshold = 10 }) {
  if (qty <= 0) return <Badge color="red">Out of stock</Badge>
  if (qty <= threshold) return <Badge color="amber">Low stock</Badge>
  return <Badge color="green">In stock</Badge>
}

// ─── Table ────────────────────────────────────────────────────────────────────
export function Table({ columns, data, emptyMessage = 'No data yet.' }) {
  if (!data.length) return (
    <div style={{ textAlign: 'center', padding: '56px 0', color: '#c4c4c4', fontSize: 14 }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16, background: '#f8f7f4',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
      }}>
        <Inbox size={26} color="#cfcfcf" />
      </div>
      <div style={{ fontWeight: 500 }}>{emptyMessage}</div>
    </div>
  )
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={{
                textAlign: 'left', padding: '8px 12px', fontSize: 10, color: '#bbb',
                borderBottom: '2px solid #f0f0f0', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.6px', whiteSpace: 'nowrap'
              }}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={row.id || i} style={{ borderBottom: '1px solid #f5f5f5' }}>
              {columns.map(col => (
                <td key={col.key} style={{ padding: '11px 12px', color: '#333', verticalAlign: 'middle' }}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ title, subtitle, children, onClose, width = 640, noBackdropClose = false }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  // Rendered through a portal to <body> so the fixed overlay is always positioned
  // relative to the viewport — never trapped by an ancestor that has a CSS
  // transform/filter (e.g. the animated .page-content wrapper), which would
  // otherwise make `position: fixed` resolve against that ancestor instead.
  return createPortal((
    <div className="modal-overlay" style={{
      position: 'fixed', inset: 0, background: 'rgba(13,27,42,0.55)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
      animation: 'backdropIn 0.2s ease both',
    }} onClick={e => !noBackdropClose && e.target === e.currentTarget && onClose()}>
      <div className="modal-enter modal-card" style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: width, minWidth: 0,
        maxHeight: '92vh', overflowY: 'auto', overflowX: 'hidden', boxShadow: '0 30px 80px rgba(13,27,42,0.28)',
      }}>
        <div className="modal-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 28px', borderBottom: '1px solid #f0f0f0' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0d1b2a', letterSpacing: '-0.3px' }}>{title}</h2>
            {subtitle && <p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#aaa', fontWeight: 400 }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#bbb', padding: 7,
            borderRadius: 9, transition: 'all 0.15s', display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f5'; e.currentTarget.style.color = '#333' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#bbb' }}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body" style={{ padding: '26px 28px' }}>{children}</div>
      </div>
    </div>
  ), document.body)
}

// ─── Toast ────────────────────────────────────────────────────────────────────
export function useToast() {
  const [toasts, setToasts] = useState([])
  const add = (message, type = 'success') => {
    const id = Date.now()
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }
  return { toasts, success: m => add(m, 'success'), error: m => add(m, 'error'), info: m => add(m, 'info') }
}

export function Toasts({ toasts }) {
  const icons = { success: CheckCircle, error: AlertTriangle, info: Info }
  const colors = { success: '#1D9E75', error: '#c62828', info: '#1565c0' }
  const bgs = { success: '#f0fdf8', error: '#fef2f2', info: '#eff6ff' }
  const borders = { success: '#a7f3d8', error: '#fecaca', info: '#bfdbfe' }
  return (
    <div className="toast-wrap" style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2000 }}>
      {toasts.map(t => {
        const Icon = icons[t.type]
        return (
          <div key={t.id} className="toast-enter" style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: bgs[t.type] || '#fff',
            border: `1px solid ${borders[t.type] || '#eee'}`,
            borderRadius: 12, padding: '12px 16px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.1)', fontSize: 13, color: '#333', minWidth: 260,
          }}>
            <Icon size={15} color={colors[t.type]} />
            <span style={{ fontWeight: 500 }}>{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Loading spinner ──────────────────────────────────────────────────────────
export function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 30, height: 30, border: '3px solid #f0f0f0',
        borderTopColor: '#FFA500', borderRadius: '50%',
        animation: 'spin 0.7s linear infinite'
      }} />
      <span style={{ fontSize: 12, color: '#ccc', fontWeight: 500 }}>Loading…</span>
    </div>
  )
}

// ─── Form row ─────────────────────────────────────────────────────────────────
export function FormRow({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
      {children}
    </div>
  )
}

// ─── Section title ────────────────────────────────────────────────────────────
export function SectionTitle({ children }) {
  return <h3 style={{ fontSize: 11, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.8px', margin: '0 0 14px' }}>{children}</h3>
}
