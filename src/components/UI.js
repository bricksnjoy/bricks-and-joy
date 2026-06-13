import React, { useState } from 'react'
import { X, AlertTriangle, CheckCircle, Info } from 'lucide-react'

// ─── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0d1b2a', letterSpacing: '-0.5px' }}>{title}</h1>
        {subtitle && <p style={{ margin: '4px 0 0', color: '#888', fontSize: 14 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, style = {} }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, border: '1px solid #eee',
      padding: '20px 24px', ...style
    }}>
      {children}
    </div>
  )
}

// ─── Metric card ──────────────────────────────────────────────────────────────
export function MetricCard({ label, value, sub, color = '#0d1b2a', icon: Icon }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, border: '1px solid #eee',
      padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14
    }}>
      {Icon && (
        <div style={{ background: '#f8f7f4', borderRadius: 8, padding: 10, flexShrink: 0 }}>
          <Icon size={18} color="#FFA500" />
        </div>
      )}
      <div>
        <div style={{ fontSize: 12, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color, letterSpacing: '-0.5px', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────
export function Button({ children, onClick, variant = 'primary', size = 'md', disabled = false, style = {} }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none', borderRadius: 8, fontFamily: 'inherit', fontWeight: 500, transition: 'all 0.15s',
    opacity: disabled ? 0.5 : 1
  }
  const sizes = { sm: { padding: '6px 12px', fontSize: 12 }, md: { padding: '9px 16px', fontSize: 13 }, lg: { padding: '12px 20px', fontSize: 14 } }
  const variants = {
    primary: { background: '#FFA500', color: '#fff' },
    secondary: { background: '#f0f0f0', color: '#333' },
    danger: { background: '#fee', color: '#c0392b', border: '1px solid #fcc' },
    ghost: { background: 'transparent', color: '#666', border: '1px solid #ddd' }
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────────
export function Input({ label, error, style = {}, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      {label && <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</label>}
      <input {...props} style={{
        padding: '9px 12px', border: `1px solid ${error ? '#e74c3c' : '#ddd'}`, borderRadius: 8,
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      {label && <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</label>}
      <select {...props} style={{
        padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8,
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
      display: 'inline-block', padding: '2px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 500, background: c.bg, color: c.text
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
    <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa', fontSize: 14 }}>{emptyMessage}</div>
  )
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={{
                textAlign: 'left', padding: '8px 12px', fontSize: 11, color: '#999',
                borderBottom: '1px solid #eee', fontWeight: 500, textTransform: 'uppercase',
                letterSpacing: '0.4px', whiteSpace: 'nowrap'
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
export function Modal({ title, children, onClose, width = 520, noBackdropClose = false }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20
    }} onClick={e => !noBackdropClose && e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: width,
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #eee' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#0d1b2a' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '20px 24px' }}>{children}</div>
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
  const colors = { success: '#2e7d32', error: '#c62828', info: '#1565c0' }
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2000 }}>
      {toasts.map(t => {
        const Icon = icons[t.type]
        return (
          <div key={t.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, background: '#fff',
            border: `1px solid #eee`, borderRadius: 10, padding: '12px 16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 13, color: '#333', minWidth: 260
          }}>
            <Icon size={16} color={colors[t.type]} />
            {t.message}
          </div>
        )
      })}
    </div>
  )
}

// ─── Loading spinner ──────────────────────────────────────────────────────────
export function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <div style={{
        width: 28, height: 28, border: '3px solid #eee',
        borderTopColor: '#FFA500', borderRadius: '50%',
        animation: 'spin 0.7s linear infinite'
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ─── Form row ─────────────────────────────────────────────────────────────────
export function FormRow({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
      {children}
    </div>
  )
}

// ─── Section title ────────────────────────────────────────────────────────────
export function SectionTitle({ children }) {
  return <h3 style={{ fontSize: 13, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '0 0 14px' }}>{children}</h3>
}
