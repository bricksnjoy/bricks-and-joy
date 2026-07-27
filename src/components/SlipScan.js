import React, { useState } from 'react'
import { ScanLine, X } from 'lucide-react'
import { readSlip } from '../lib/slipOcr'

const money = n => `MVR ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Reads a transfer slip and hands what it found to the caller to apply.
//
// `apply(found)` must return a snapshot of the fields it is about to overwrite,
// so a misread can be undone in one click rather than saved by accident.
export function useSlipScan() {
  const [ocr, setOcr] = useState(null)   // { busy, progress, found, before }

  async function scan(file, apply) {
    if (!file) return null
    setOcr({ busy: true, progress: 0 })
    try {
      const found = await readSlip(file, p => setOcr(o => (o ? { ...o, progress: p } : o)))
      if (!found || !(found.amount || found.date || found.reference)) {
        setOcr({ busy: false, empty: true })
        return null
      }
      const before = apply(found) || null
      setOcr({ busy: false, found, before })
      return found
    } catch (err) {
      setOcr({ busy: false, error: err.message || String(err) })
      return null
    }
  }

  // restore(before) puts the fields back the way they were
  function undo(restore) {
    if (ocr?.before) restore(ocr.before)
    setOcr(null)
  }

  return { ocr, setOcr, scan, undo, clear: () => setOcr(null) }
}

// The bar that shows what was read, with a one-click Undo
export function SlipNote({ ocr, onUndo, onDismiss }) {
  if (!ocr) return null

  if (ocr.busy) {
    return (
      <div style={{ background: '#f8f7f4', border: '1px solid #eee', borderRadius: 9, padding: '10px 13px', marginBottom: 14, fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 9 }}>
        <ScanLine size={14} color="#FFA500" />
        Reading the slip… {ocr.progress ? `${Math.round(ocr.progress * 100)}%` : ''}
      </div>
    )
  }
  if (ocr.empty || ocr.error) {
    return (
      <div style={{ background: '#fffaf2', border: '1px solid #f3e4c8', borderRadius: 9, padding: '10px 13px', marginBottom: 14, fontSize: 12, color: '#8a6a2a', display: 'flex', alignItems: 'center', gap: 9 }}>
        <ScanLine size={14} color="#e6940a" />
        {ocr.error ? `Could not read the slip: ${ocr.error}` : "Couldn't make out this slip — type the details in yourself."}
        <button onClick={onDismiss} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}><X size={13} color="#c9b48c" /></button>
      </div>
    )
  }

  const f = ocr.found || {}
  const bits = [
    f.amount != null && ['Amount', money(f.amount)],
    f.date && ['Date', f.date + (f.time ? ` ${f.time}` : '')],
    f.reference && ['Reference', f.reference],
    f.counterparty && ['With', f.counterparty],
    f.account && ['Account', f.account],
  ].filter(Boolean)
  if (!bits.length) return null

  return (
    <div style={{ background: '#f2faf5', border: '1px solid #cfe8db', borderRadius: 9, padding: '11px 13px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ScanLine size={14} color="#1D9E75" />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#2c7a54' }}>Read from the slip — check it</span>
        {onUndo && <button onClick={onUndo} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 11.5, fontFamily: 'inherit', textDecoration: 'underline' }}>Undo</button>}
        <button onClick={onDismiss} title="Looks right" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', marginLeft: onUndo ? 0 : 'auto' }}><X size={13} color="#bbb" /></button>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 7 }}>
        {bits.map(([k, v]) => (
          <span key={k} style={{ fontSize: 11.5, color: '#4a6b59' }}>
            <span style={{ color: '#8fae9e' }}>{k}</span> <b>{v}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

// Small "read the slip that's already attached" button
export function RescanButton({ onClick, busy, label = 'Read attached slip' }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', border: '1px solid #e0e0e0', borderRadius: 8, background: '#fff', cursor: busy ? 'default' : 'pointer', fontSize: 11.5, fontWeight: 600, color: '#666', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
      <ScanLine size={12} /> {busy ? 'Reading…' : label}
    </button>
  )
}
