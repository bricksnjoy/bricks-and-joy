import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Building2, DollarSign, Package, Save, RotateCcw, X, Monitor, ShoppingCart, MessageSquare, ChevronDown, Mail, Send } from 'lucide-react'
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../lib/settings'
import { supabase } from '../lib/supabase'
import { useToast, Toasts } from '../components/UI'

const CHANNELS = ['Retail store', 'Online', 'Wholesale', 'Pop-up / Market', 'Instagram', 'Phone']
const PAY_METHODS = ['Cash', 'BML Transfer', 'Bank Transfer', 'Card', 'Other']
const DATE_FORMATS = [
  { value: 'YYYY-MM-DD', label: '2026-06-19  (ISO)' },
  { value: 'DD/MM/YYYY', label: '19/06/2026  (Day first)' },
  { value: 'MM/DD/YYYY', label: '06/19/2026  (US)' },
]

// ── small helpers ──────────────────────────────────────────────────────────────
function SectionHead({ icon: Icon, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid #f0f0f0' }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: '#FFF3DF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={14} color="#FFA500" />
      </div>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0d1b2a' }}>{title}</span>
    </div>
  )
}

function Field({ label, hint, half, children }) {
  return (
    <div style={{ gridColumn: half ? undefined : 'span 2' }}>
      <label style={{ fontSize: 11, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

const inp = { width: '100%', padding: '9px 12px', border: '1px solid #e6e6e6', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fafafa', boxSizing: 'border-box', transition: 'border-color 0.15s, box-shadow 0.15s' }

function TInput({ value, onChange, ...rest }) {
  return <input style={inp} value={value} onChange={onChange} {...rest}
    onFocus={e => { e.target.style.borderColor = '#FFA500'; e.target.style.boxShadow = '0 0 0 3px rgba(255,165,0,0.10)'; e.target.style.background = '#fff' }}
    onBlur={e => { e.target.style.borderColor = '#e6e6e6'; e.target.style.boxShadow = ''; e.target.style.background = '#fafafa' }} />
}

function TSelect({ value, onChange, options }) {
  return (
    <div style={{ position: 'relative' }}>
      <select value={value} onChange={onChange}
        style={{ ...inp, appearance: 'none', WebkitAppearance: 'none', paddingRight: 30, cursor: 'pointer' }}>
        {options.map(o => typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={14} color="#aaa" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
    </div>
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 2 }}>
      <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer', flexShrink: 0 }}>
        <input type="checkbox" checked={checked} onChange={onChange} style={{ opacity: 0, width: 0, height: 0 }} />
        <span style={{ position: 'absolute', inset: 0, background: checked ? '#FFA500' : '#ddd', borderRadius: 99, transition: 'background 0.2s' }}>
          <span style={{ position: 'absolute', width: 16, height: 16, left: checked ? 21 : 3, top: 3, background: '#fff', borderRadius: '50%', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
        </span>
      </label>
      <span style={{ fontSize: 13, color: checked ? '#1D9E75' : '#aaa', fontWeight: 600 }}>{label}</span>
    </div>
  )
}

function PillGroup({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', background: '#f5f5f5', borderRadius: 9, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          flex: 1, padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12, fontWeight: value === o.value ? 700 : 500,
          background: value === o.value ? '#fff' : 'transparent',
          color: value === o.value ? '#0d1b2a' : '#999',
          boxShadow: value === o.value ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
          transition: 'all 0.15s', whiteSpace: 'nowrap',
        }}>{o.label}</button>
      ))}
    </div>
  )
}

// ── Monthly email report (server-side; config stored in Supabase so the
// scheduled Edge Function can read it) ───────────────────────────────────────
function MonthlyReportSettings({ toast }) {
  const [cfg, setCfg] = useState(null)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    supabase.from('report_settings').select('*').eq('id', 1).maybeSingle().then(({ data, error }) => {
      if (error) setMissing(true)
      setCfg(data || { id: 1, recipients: '', include_financial: true, include_restock: true, include_sales: true })
    })
  }, [])

  const upd = (k, v) => setCfg(c => ({ ...c, [k]: v }))

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('report_settings').upsert({ id: 1, ...cfg, updated_at: new Date().toISOString() })
    setSaving(false)
    if (error) { setMissing(true); toast.error('Could not save — create the report_settings table first.') }
    else { setMissing(false); toast.success('Report settings saved') }
  }

  async function sendNow() {
    setSending(true)
    try {
      const { data, error } = await supabase.functions.invoke('monthly-report', { body: { test: true } })
      if (error) throw error
      if (data?.ok) toast.success('Test report sent to ' + (data.sent_to || []).join(', '))
      else toast.error('Send failed: ' + (data?.error?.message || JSON.stringify(data?.error) || 'check function setup'))
    } catch (e) {
      toast.error('Function not reachable yet — deploy monthly-report & set RESEND_API_KEY.')
    }
    setSending(false)
  }

  if (!cfg) return null
  return (
    <div style={{ background: '#fafafa', borderRadius: 14, padding: 18, border: '1px solid #f0f0f0' }}>
      <SectionHead icon={Mail} title="Monthly Email Report" />
      {missing && (
        <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#a16d0a', lineHeight: 1.6 }}>
          Setup needed: create the <strong>report_settings</strong> table, deploy the <strong>monthly-report</strong> Edge Function, and set <strong>RESEND_API_KEY</strong>. (Ask for the exact commands.)
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
        <Field label="Send report to" hint="Comma-separate multiple email addresses">
          <TInput value={cfg.recipients || ''} onChange={e => upd('recipients', e.target.value)} placeholder="you@gmail.com, partner@gmail.com" />
        </Field>
        <Field label="Include in the email">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Toggle checked={cfg.include_financial !== false} onChange={e => upd('include_financial', e.target.checked)} label="Financial summary (revenue, profit, expenses)" />
            <Toggle checked={cfg.include_restock !== false} onChange={e => upd('include_restock', e.target.checked)} label="Restock smart alerts" />
            <Toggle checked={cfg.include_sales !== false} onChange={e => upd('include_sales', e.target.checked)} label="Sales highlights (orders, top products & customers)" />
          </div>
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={save} disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FFA500', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>
            <Save size={13} /> {saving ? 'Saving…' : 'Save recipients'}
          </button>
          <button onClick={sendNow} disabled={sending}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', color: '#0d1b2a', border: '1px solid #ddd', borderRadius: 9, padding: '9px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>
            <Send size={13} /> {sending ? 'Sending…' : 'Send test now'}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: '#aaa', lineHeight: 1.6 }}>
          The report is sent automatically each month by a scheduled server function. "Send test now" emails the current month-to-date so you can preview it.
        </div>
      </div>
    </div>
  )
}

export default function Settings({ onClose }) {
  const [form, setForm] = useState(() => getSettings())
  const [dirty, setDirty] = useState(false)
  const toast = useToast()

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setDirty(true) }
  const f = k => e => set(k, e.target.value)
  const fb = k => e => set(k, e.target.checked)

  function handleSave() {
    saveSettings(form)
    setDirty(false)
    toast.success('Settings saved!')
  }

  function handleReset() {
    if (!window.confirm('Reset all settings to defaults?')) return
    const d = { ...DEFAULT_SETTINGS }
    setForm(d); saveSettings(d); setDirty(false)
    toast.success('Reset to defaults.')
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', justifyContent: 'flex-end' }}>
      <style>{`
        .sett-drawer { animation: settSlide 0.25s cubic-bezier(0.4,0,0.2,1) both; }
        @keyframes settSlide { from { transform: translateX(100%); opacity: 0.6 } to { transform: translateX(0); opacity: 1 } }
        .sett-overlay-bg { animation: settFade 0.2s ease both; }
        @keyframes settFade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>

      {/* Backdrop */}
      <div className="sett-overlay-bg" onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(13,27,42,0.45)', backdropFilter: 'blur(2px)' }} />

      {/* Drawer */}
      <div className="sett-drawer" style={{ position: 'relative', width: 'min(480px, 100vw)', height: '100%', background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 48px rgba(0,0,0,0.14)', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-0.3px' }}>Settings</div>
            <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 1 }}>Business configuration & app defaults</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {dirty && (
              <button onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FFA500', color: '#fff', border: 'none', borderRadius: 9, padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>
                <Save size={13} /> Save
              </button>
            )}
            <button onClick={onClose} style={{ width: 34, height: 34, border: '1px solid #eee', borderRadius: 9, background: '#fafafa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '22px', flex: 1, display: 'flex', flexDirection: 'column', gap: 22 }}>

          {/* ── Company Profile ── */}
          <div style={{ background: '#fafafa', borderRadius: 14, padding: 18, border: '1px solid #f0f0f0' }}>
            <SectionHead icon={Building2} title="Company Profile" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Business name">
                <TInput value={form.businessName} onChange={f('businessName')} placeholder="Brick's & Joy" />
              </Field>
              <Field label="Tagline">
                <TInput value={form.tagline} onChange={f('tagline')} placeholder="Premium LEGO & Building Sets" />
              </Field>
              <Field label="Phone" half>
                <TInput value={form.phone} onChange={f('phone')} placeholder="+960 XXX XXXX" />
              </Field>
              <Field label="Email" half>
                <TInput value={form.email} onChange={f('email')} type="email" placeholder="hello@bricksandjoy.mv" />
              </Field>
              <Field label="Address">
                <TInput value={form.address} onChange={f('address')} placeholder="Male', Maldives" />
              </Field>
              <Field label="Instagram handle" half>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e6e6e6', borderRadius: 9, background: '#fafafa', overflow: 'hidden' }}>
                  <span style={{ padding: '9px 10px', fontSize: 12, color: '#aaa', borderRight: '1px solid #f0f0f0', flexShrink: 0 }}>@</span>
                  <TInput value={form.instagram} onChange={f('instagram')} placeholder="bricksandjoy" style={{ ...inp, border: 'none', borderRadius: 0, background: 'transparent' }} />
                </div>
              </Field>
              <Field label="Business hours" half>
                <TInput value={form.businessHours} onChange={f('businessHours')} placeholder="Sun–Thu 9am–6pm" />
              </Field>
            </div>
          </div>

          {/* ── Financial ── */}
          <div style={{ background: '#fafafa', borderRadius: 14, padding: 18, border: '1px solid #f0f0f0' }}>
            <SectionHead icon={DollarSign} title="Financial" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Currency symbol" half hint="Used throughout the app">
                <TInput value={form.currency} onChange={f('currency')} placeholder="MVR" maxLength={5} />
              </Field>
              <Field label="Tax / GST label" half>
                <TInput value={form.taxLabel} onChange={f('taxLabel')} placeholder="GST" maxLength={10} />
              </Field>
              <Field label="Tax rate (%)" half hint="Set 0 to disable">
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <TInput value={form.taxRate} onChange={e => set('taxRate', parseFloat(e.target.value) || 0)} type="number" min="0" max="100" step="0.1" />
                  <span style={{ fontSize: 13, color: '#aaa', flexShrink: 0 }}>%</span>
                </div>
              </Field>
              <Field label="Tax included in price?" half>
                <Toggle checked={form.taxIncluded} onChange={fb('taxIncluded')} label={form.taxIncluded ? 'Tax-inclusive' : 'Add on top'} />
              </Field>
              {form.taxRate > 0 && (
                <div style={{ gridColumn: 'span 2', background: '#f0f7ff', border: '1px solid #dbeafe', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#1e4d8c' }}>
                  Example: {form.currency} 100 → {form.taxIncluded
                    ? `tax inside = ${form.currency} ${(100 - 100 / (1 + form.taxRate / 100)).toFixed(2)}`
                    : `with ${form.taxLabel} = ${form.currency} ${(100 * (1 + form.taxRate / 100)).toFixed(2)}`}
                </div>
              )}
            </div>
          </div>

          {/* ── Display Preferences ── */}
          <div style={{ background: '#fafafa', borderRadius: 14, padding: 18, border: '1px solid #f0f0f0' }}>
            <SectionHead icon={Monitor} title="Display Preferences" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Date format">
                <TSelect value={form.dateFormat} onChange={f('dateFormat')} options={DATE_FORMATS} />
              </Field>
              <Field label="Default order view" half>
                <PillGroup value={form.defaultOrderView} onChange={v => set('defaultOrderView', v)}
                  options={[{ value: 'cards', label: 'Cards' }, { value: 'list', label: 'List' }]} />
              </Field>
              <Field label="Default orders filter">
                <TSelect value={form.defaultOrderFilter} onChange={f('defaultOrderFilter')} options={[
                  { value: 'created', label: 'Created' },
                  { value: 'transit', label: 'Dispatched' },
                  { value: 'delivered', label: 'Delivered' },
                  { value: 'all', label: 'All' },
                ]} />
              </Field>
            </div>
          </div>

          {/* ── Order Defaults ── */}
          <div style={{ background: '#fafafa', borderRadius: 14, padding: 18, border: '1px solid #f0f0f0' }}>
            <SectionHead icon={ShoppingCart} title="Order Defaults" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Default sales channel" half>
                <TSelect value={form.defaultChannel} onChange={f('defaultChannel')} options={CHANNELS} />
              </Field>
              <Field label="Default payment method" half>
                <TSelect value={form.defaultPaymentMethod} onChange={f('defaultPaymentMethod')} options={PAY_METHODS} />
              </Field>
              <Field label="Invoice number prefix" hint="Invoices will look like INV-123456">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TInput value={form.invoicePrefix} onChange={f('invoicePrefix')} placeholder="INV" maxLength={10} />
                  <span style={{ fontSize: 12, color: '#bbb', flexShrink: 0, fontFamily: 'monospace' }}>-123456</span>
                </div>
              </Field>
            </div>
          </div>

          {/* ── Inventory ── */}
          <div style={{ background: '#fafafa', borderRadius: 14, padding: 18, border: '1px solid #f0f0f0' }}>
            <SectionHead icon={Package} title="Inventory" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Default low-stock alert threshold" hint="Alert fires when stock ≤ this number">
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <TInput value={form.lowStockThreshold} onChange={e => set('lowStockThreshold', parseInt(e.target.value) || 10)} type="number" min="1" max="999" />
                  <span style={{ fontSize: 13, color: '#aaa', flexShrink: 0 }}>units</span>
                </div>
              </Field>
            </div>
          </div>

          {/* ── Communication ── */}
          <div style={{ background: '#fafafa', borderRadius: 14, padding: 18, border: '1px solid #f0f0f0' }}>
            <SectionHead icon={MessageSquare} title="Communication" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
              <Field label="SMS signature / footer" hint="Appended to all outgoing SMS messages">
                <TInput value={form.smsFooter} onChange={f('smsFooter')} placeholder="— Brick's & Joy" />
              </Field>
            </div>
          </div>

          {/* ── Monthly Email Report ── */}
          <MonthlyReportSettings toast={toast} />

        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', position: 'sticky', bottom: 0 }}>
          <button onClick={handleReset} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid #ddd', borderRadius: 9, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, color: '#888', fontWeight: 600 }}>
            <RotateCcw size={12} /> Reset to defaults
          </button>
          <button onClick={handleSave} disabled={!dirty}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: dirty ? '#FFA500' : '#f0f0f0', color: dirty ? '#fff' : '#bbb', border: 'none', borderRadius: 9, padding: '9px 20px', cursor: dirty ? 'pointer' : 'default', fontWeight: 700, fontSize: 13.5, fontFamily: 'inherit', transition: 'all 0.15s' }}>
            <Save size={14} /> {dirty ? 'Save changes' : 'All saved'}
          </button>
        </div>
      </div>

      <Toasts toasts={toast.toasts} />
    </div>,
    document.body
  )
}
