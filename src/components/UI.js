import React, { useState, useEffect } from 'react'
import { X, AlertTriangle, CheckCircle, Info, Inbox } from 'lucide-react'

// ─── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
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
    <div style={{
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
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(13,27,42,0.55)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
      animation: 'backdropIn 0.2s ease both',
    }} onClick={e => !noBackdropClose && e.target === e.currentTarget && onClose()}>
      <div className="modal-enter" style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: width,
        maxHeight: '92vh', overflow: 'auto', boxShadow: '0 30px 80px rgba(13,27,42,0.28)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 28px', borderBottom: '1px solid #f0f0f0' }}>
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
        <div style={{ padding: '26px 28px' }}>{children}</div>
      </div>
    </div>
  )
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
    <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2000 }}>
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
