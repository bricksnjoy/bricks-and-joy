import React, { useState } from 'react'
import { PageHeader, Card, Button, useToast, Toasts } from '../components/UI'
import { Building2, DollarSign, Package, Save, RotateCcw } from 'lucide-react'
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../lib/settings'

function Section({ icon: Icon, title, children }) {
  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: '#FFF3DF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={16} color="#FFA500" />
        </div>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#0d1b2a' }}>{title}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {children}
      </div>
    </Card>
  )
}

function Field({ label, hint, span, children }) {
  return (
    <div style={{ gridColumn: span === 2 ? 'span 2' : undefined }}>
      <label style={{ fontSize: 12, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

const inputStyle = { width: '100%', padding: '9px 12px', border: '1px solid #e6e6e6', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fafafa', boxSizing: 'border-box', transition: 'border-color 0.15s, box-shadow 0.15s' }

export default function Settings() {
  const [form, setForm] = useState(() => getSettings())
  const [dirty, setDirty] = useState(false)
  const toast = useToast()

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setDirty(true) }
  const f = k => e => set(k, e.target.value)

  function handleSave() {
    saveSettings(form)
    setDirty(false)
    toast.success('Settings saved!')
  }

  function handleReset() {
    if (!window.confirm('Reset all settings to defaults?')) return
    setForm({ ...DEFAULT_SETTINGS })
    saveSettings({ ...DEFAULT_SETTINGS })
    setDirty(false)
    toast.success('Settings reset to defaults.')
  }

  return (
    <div>
      <style>{`
        .sett-input:focus { border-color: #FFA500 !important; box-shadow: 0 0 0 3px rgba(255,165,0,0.10) !important; background: #fff !important; }
        .sett-toggle { position: relative; display: inline-block; width: 42px; height: 24px; }
        .sett-toggle input { opacity: 0; width: 0; height: 0; }
        .sett-slider { position: absolute; inset: 0; background: #ddd; border-radius: 99px; cursor: pointer; transition: background 0.2s; }
        .sett-slider:before { content:''; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform 0.2s; box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
        .sett-toggle input:checked + .sett-slider { background: #FFA500; }
        .sett-toggle input:checked + .sett-slider:before { transform: translateX(18px); }
        @media (max-width: 600px) {
          .sett-grid { grid-template-columns: 1fr !important; }
          .sett-grid [style*="span 2"] { grid-column: span 1 !important; }
        }
      `}</style>

      <PageHeader
        title="Settings"
        subtitle="Business configuration and defaults"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={handleReset}><RotateCcw size={13} /> Reset</Button>
            <Button onClick={handleSave} disabled={!dirty}><Save size={13} /> {dirty ? 'Save changes' : 'Saved'}</Button>
          </div>
        }
      />

      {/* Company Profile */}
      <Section icon={Building2} title="Company Profile">
        <div style={{ display: 'contents' }} className="sett-grid">
          <Field label="Business name" span={2}>
            <input className="sett-input" style={inputStyle} value={form.businessName} onChange={f('businessName')} placeholder="Brick's & Joy" />
          </Field>
          <Field label="Tagline">
            <input className="sett-input" style={inputStyle} value={form.tagline} onChange={f('tagline')} placeholder="e.g. Premium LEGO & Building Sets" />
          </Field>
          <Field label="Instagram handle">
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e6e6e6', borderRadius: 9, background: '#fafafa', overflow: 'hidden' }}>
              <span style={{ padding: '9px 10px', fontSize: 13, color: '#aaa', borderRight: '1px solid #f0f0f0', background: '#f5f5f5', flexShrink: 0 }}>@</span>
              <input className="sett-input" style={{ ...inputStyle, border: 'none', borderRadius: 0, background: 'transparent' }} value={form.instagram} onChange={f('instagram')} placeholder="bricksandjoy" />
            </div>
          </Field>
          <Field label="Phone">
            <input className="sett-input" style={inputStyle} value={form.phone} onChange={f('phone')} placeholder="+960 XXX XXXX" />
          </Field>
          <Field label="Email">
            <input className="sett-input" style={inputStyle} type="email" value={form.email} onChange={f('email')} placeholder="hello@bricksandjoy.mv" />
          </Field>
          <Field label="Address" span={2}>
            <input className="sett-input" style={inputStyle} value={form.address} onChange={f('address')} placeholder="Male', Maldives" />
          </Field>
          <Field label="Business hours" span={2}>
            <input className="sett-input" style={inputStyle} value={form.businessHours} onChange={f('businessHours')} placeholder="e.g. Sun–Thu 9am–6pm, Fri closed" />
          </Field>
        </div>
      </Section>

      {/* Financial */}
      <Section icon={DollarSign} title="Financial">
        <div style={{ display: 'contents' }} className="sett-grid">
          <Field label="Currency" hint="Used as the prefix throughout the app (e.g. MVR, USD)">
            <input className="sett-input" style={{ ...inputStyle, maxWidth: 120 }} value={form.currency} onChange={f('currency')} placeholder="MVR" maxLength={5} />
          </Field>
          <Field label="Tax / GST label">
            <input className="sett-input" style={{ ...inputStyle, maxWidth: 120 }} value={form.taxLabel} onChange={f('taxLabel')} placeholder="GST" maxLength={10} />
          </Field>
          <Field label="Tax rate (%)" hint="Set to 0 to disable tax calculations">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="sett-input" style={{ ...inputStyle, maxWidth: 100 }} type="number" min="0" max="100" step="0.1" value={form.taxRate} onChange={e => set('taxRate', parseFloat(e.target.value) || 0)} />
              <span style={{ fontSize: 13, color: '#aaa' }}>%</span>
            </div>
          </Field>
          <Field label="Tax included in price?" hint="Toggle on if prices already include tax">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
              <label className="sett-toggle">
                <input type="checkbox" checked={form.taxIncluded} onChange={e => set('taxIncluded', e.target.checked)} />
                <span className="sett-slider" />
              </label>
              <span style={{ fontSize: 13, color: form.taxIncluded ? '#1D9E75' : '#aaa', fontWeight: 600 }}>{form.taxIncluded ? 'Yes — tax inclusive' : 'No — add on top'}</span>
            </div>
          </Field>
          {form.taxRate > 0 && (
            <div style={{ gridColumn: 'span 2', background: '#f8f7f4', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#555' }}>
              Example: MVR 100 product → {form.taxIncluded
                ? `tax portion = MVR ${(100 - 100 / (1 + form.taxRate / 100)).toFixed(2)} (${form.taxLabel} already inside price)`
                : `total with ${form.taxLabel} = MVR ${(100 * (1 + form.taxRate / 100)).toFixed(2)}`}
            </div>
          )}
        </div>
      </Section>

      {/* Inventory Defaults */}
      <Section icon={Package} title="Inventory Defaults">
        <div style={{ display: 'contents' }} className="sett-grid">
          <Field label="Default low-stock threshold" hint="Alert triggers when stock drops to or below this number">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="sett-input" style={{ ...inputStyle, maxWidth: 100 }} type="number" min="1" max="999" value={form.lowStockThreshold} onChange={e => set('lowStockThreshold', parseInt(e.target.value) || 10)} />
              <span style={{ fontSize: 13, color: '#aaa' }}>units</span>
            </div>
          </Field>
          <Field label="Invoice number prefix" hint="Invoices will be named like INV-123456">
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e6e6e6', borderRadius: 9, background: '#fafafa', overflow: 'hidden', maxWidth: 220 }}>
              <input className="sett-input" style={{ ...inputStyle, border: 'none', borderRadius: 0, background: 'transparent', maxWidth: 120 }} value={form.invoicePrefix} onChange={f('invoicePrefix')} placeholder="INV" maxLength={10} />
              <span style={{ padding: '9px 10px', fontSize: 12, color: '#bbb', borderLeft: '1px solid #f0f0f0', background: '#f5f5f5', flexShrink: 0 }}>-123456</span>
            </div>
          </Field>
        </div>
      </Section>

      {/* Unsaved changes banner */}
      {dirty && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#0d1b2a', color: '#fff', borderRadius: 12, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 8px 28px rgba(0,0,0,0.22)', zIndex: 999, fontSize: 13, fontFamily: 'inherit', animation: 'fadeSlideUp 0.2s ease' }}>
          <span>Unsaved changes</span>
          <button onClick={handleSave} style={{ background: '#FFA500', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>Save</button>
        </div>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
