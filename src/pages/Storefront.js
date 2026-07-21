import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Spinner, useToast, Toasts, Badge } from '../components/UI'
import { DEFAULT_SETTINGS, mergeSettings } from '../shop/core'
import {
  Globe, ExternalLink, Copy, Check, Eye, ShoppingBag, Baby, Grid3x3, ShoppingCart,
  Settings2, Ticket, Plus, Trash2, Rocket, EyeOff
} from 'lucide-react'

const TABS = [
  { key: 'preview', label: 'Preview & links', icon: Eye },
  { key: 'settings', label: 'Content & settings', icon: Settings2 },
  { key: 'coupons', label: 'Coupons', icon: Ticket },
]

export default function Storefront() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://bricksandjoy.com'
  const [tab, setTab] = useState('preview')
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState('')
  const [coupons, setCoupons] = useState([])
  const [cForm, setCForm] = useState({ code: '', discount_type: 'percent', discount_value: '', min_order: '', expires_on: '' })
  const toast = useToast()

  useEffect(() => { load(); loadCoupons() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('site_settings').select('data').eq('id', 1).single()
    setSettings(mergeSettings(data?.data))
    setLoading(false)
  }
  async function loadCoupons() {
    const { data } = await supabase.from('coupons').select('*').order('created_at', { ascending: false })
    setCoupons(data || [])
  }

  async function saveSettings(next = settings, quiet = false) {
    setSaving(true)
    const { error } = await supabase.from('site_settings').upsert({ id: 1, data: next, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    setSaving(false)
    if (error) { toast.error('Failed to save: ' + error.message); return false }
    if (!quiet) toast.success('Website updated!')
    return true
  }

  async function toggleLive() {
    const next = { ...settings, live: !settings.live }
    setSettings(next)
    const ok = await saveSettings(next, true)
    if (ok) toast.success(next.live ? '🎉 Your website is now LIVE!' : 'Website hidden (coming-soon page shown)')
  }

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }))
  const setPromo = (i, v) => setSettings(s => { const promos = [...(s.promos || [])]; promos[i] = v; return { ...s, promos } })
  const setShip = (i, k, v) => setSettings(s => { const shipping = (s.shipping || []).map((r, idx) => idx === i ? { ...r, [k]: k === 'fee' ? v : v } : r); return { ...s, shipping } })
  const addShip = () => setSettings(s => ({ ...s, shipping: [...(s.shipping || []), { label: '', fee: 0 }] }))
  const rmShip = i => setSettings(s => ({ ...s, shipping: (s.shipping || []).filter((_, idx) => idx !== i) }))

  const copy = (text, key) => navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(''), 1600) }).catch(() => {})
  const preview = p => `${origin}${p}${p.includes('?') ? '&' : '?'}preview=on`

  async function addCoupon() {
    if (!cForm.code.trim() || !cForm.discount_value) { toast.error('Enter a code and value'); return }
    const payload = {
      code: cForm.code.trim().toUpperCase(), discount_type: cForm.discount_type,
      discount_value: parseFloat(cForm.discount_value) || 0,
      min_order: parseFloat(cForm.min_order) || 0, expires_on: cForm.expires_on || null, active: true,
    }
    const { error } = await supabase.from('coupons').insert(payload)
    if (error) { toast.error(/duplicate/i.test(error.message) ? 'That code already exists' : 'Failed: ' + error.message); return }
    toast.success('Coupon created!')
    setCForm({ code: '', discount_type: 'percent', discount_value: '', min_order: '', expires_on: '' })
    loadCoupons()
  }
  async function toggleCoupon(c) { await supabase.from('coupons').update({ active: !c.active }).eq('id', c.id); loadCoupons() }
  async function delCoupon(c) { if (!window.confirm(`Delete coupon ${c.code}?`)) return; await supabase.from('coupons').delete().eq('id', c.id); loadCoupons() }

  const LinkRow = ({ label, url, hint, primary }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: '1px solid #eee', borderRadius: 12, background: primary ? '#FFF8EC' : '#fff', marginBottom: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0d1b2a' }}>{label}</div>
        <div style={{ fontSize: 12, color: '#8a8278', wordBreak: 'break-all' }}>{url}</div>
        {hint && <div style={{ fontSize: 11.5, color: '#b8ab97', marginTop: 2 }}>{hint}</div>}
      </div>
      <Button variant="ghost" size="sm" onClick={() => copy(url, url)}>{copied === url ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</Button>
      <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><Button size="sm"><ExternalLink size={13} /> Open</Button></a>
    </div>
  )

  const pages = [
    { icon: ShoppingBag, label: 'Homepage', path: '/' },
    { icon: Baby, label: 'Shop by Age', path: '/shop-by-age' },
    { icon: Grid3x3, label: 'All Toys (listing + filters)', path: '/products' },
    { icon: ShoppingCart, label: 'Cart', path: '/cart' },
  ]

  return (
    <div>
      <PageHeader title="Website" subtitle="Control your public shop — content, delivery, coupons & when to go live"
        action={
          <Button onClick={toggleLive} disabled={saving} style={settings.live ? { background: '#E24B4A' } : undefined}>
            {settings.live ? <><EyeOff size={15} /> Hide website</> : <><Rocket size={15} /> Publish website</>}
          </Button>
        } />

      {/* status banner */}
      <Card style={{ marginBottom: 16, background: settings.live ? '#f0fdf6' : '#fff8e1', border: `1px solid ${settings.live ? '#b6ecd0' : '#ffe6b8'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Globe size={22} color={settings.live ? '#2e7d32' : '#FFA500'} />
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 800 }}>{settings.live ? 'Your shop is LIVE 🎉' : 'Shop is hidden while you build'}</div>
            <div style={{ fontSize: 12.5, color: '#667' }}>{settings.live ? 'Anyone visiting your site can shop now.' : 'The public sees “coming soon”. Use the preview links to check progress.'}</div>
          </div>
        </div>
      </Card>

      {/* tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, border: `1px solid ${tab === t.key ? '#0d1b2a' : '#e0e0e0'}`, background: tab === t.key ? '#0d1b2a' : '#fff', color: tab === t.key ? '#fff' : '#667' }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : tab === 'preview' ? (
        <>
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 7 }}><Eye size={16} color="#FFA500" /> Staff preview</h3>
            <p style={{ fontSize: 12.5, color: '#8a8278', margin: '0 0 14px' }}>Open a link once on a device and it stays unlocked there — even the plain address shows you the real site afterward.</p>
            <LinkRow primary label="Open the live preview" url={preview('/')} hint="Unlocks the full site on this device" />
            {pages.map(pg => <LinkRow key={pg.path} label={pg.label} url={preview(pg.path)} />)}
            <p style={{ fontSize: 12, color: '#b8ab97', margin: '6px 0 0' }}>Turn your own preview off with <code>{origin}/?preview=off</code></p>
          </Card>
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 7 }}><Globe size={16} color="#FFA500" /> Public addresses</h3>
            <LinkRow label="Your shop (customers)" url={origin + '/'} hint={settings.live ? 'Live now' : 'Currently shows “coming soon”'} />
            <LinkRow label="Back office (staff login)" url={origin + '/backoffice'} />
          </Card>
        </>
      ) : tab === 'settings' ? (
        <Card>
          <Section title="Homepage banner">
            <Input label="Headline" value={settings.hero_title} onChange={e => set('hero_title', e.target.value)} />
            <div style={{ marginTop: 12 }}>
              <label style={lbl}>Sub-text</label>
              <textarea value={settings.hero_subtitle} onChange={e => set('hero_subtitle', e.target.value)} rows={2} style={ta} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Input label="Announcement bar (top strip — leave blank to hide)" value={settings.announcement} onChange={e => set('announcement', e.target.value)} placeholder="e.g. Ramadan sale — 15% off everything!" />
            </div>
          </Section>

          <Section title="Promo badges (3 shown under the banner)">
            {[0, 1, 2].map(i => (
              <Input key={i} label={`Badge ${i + 1}`} value={(settings.promos || [])[i] || ''} onChange={e => setPromo(i, e.target.value)} style={{ marginBottom: 8 }} />
            ))}
          </Section>

          <Section title="Delivery & gift wrapping">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <Input label="Gift wrap fee (MVR)" type="number" value={settings.gift_wrap_fee} onChange={e => set('gift_wrap_fee', e.target.value)} style={{ width: 170 }} />
              <Input label="Free delivery over (MVR, 0 = off)" type="number" value={settings.free_delivery_over} onChange={e => set('free_delivery_over', e.target.value)} style={{ width: 220 }} />
            </div>
            <label style={lbl}>Delivery zones & fees</label>
            {(settings.shipping || []).map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <Input value={r.label} onChange={e => setShip(i, 'label', e.target.value)} placeholder="Zone name" style={{ flex: 1 }} />
                <Input type="number" value={r.fee} onChange={e => setShip(i, 'fee', parseFloat(e.target.value) || 0)} placeholder="Fee" style={{ width: 110 }} />
                <Button variant="ghost" size="sm" onClick={() => rmShip(i)}><Trash2 size={14} color="#E24B4A" /></Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={addShip} style={{ marginTop: 10 }}><Plus size={13} /> Add zone</Button>
          </Section>

          <Section title="Social links">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Input label="Instagram URL" value={settings.instagram} onChange={e => set('instagram', e.target.value)} placeholder="https://instagram.com/…" style={{ flex: 1, minWidth: 200 }} />
              <Input label="WhatsApp number" value={settings.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="9607xxxxxx" style={{ flex: 1, minWidth: 160 }} />
            </div>
          </Section>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <Button onClick={() => saveSettings()} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px' }}>Create a coupon</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Input label="Code" value={cForm.code} onChange={e => setCForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="WELCOME10" style={{ width: 150 }} />
              <Select label="Type" value={cForm.discount_type} onChange={e => setCForm(f => ({ ...f, discount_type: e.target.value }))} options={[{ value: 'percent', label: '% off' }, { value: 'amount', label: 'MVR off' }]} style={{ width: 120 }} />
              <Input label="Value" type="number" value={cForm.discount_value} onChange={e => setCForm(f => ({ ...f, discount_value: e.target.value }))} placeholder={cForm.discount_type === 'percent' ? '10' : '50'} style={{ width: 100 }} />
              <Input label="Min order (MVR)" type="number" value={cForm.min_order} onChange={e => setCForm(f => ({ ...f, min_order: e.target.value }))} placeholder="0" style={{ width: 130 }} />
              <Input label="Expires (optional)" type="date" value={cForm.expires_on} onChange={e => setCForm(f => ({ ...f, expires_on: e.target.value }))} style={{ width: 160 }} />
              <Button onClick={addCoupon}><Plus size={14} /> Add</Button>
            </div>
          </Card>
          <Card>
            <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 14px' }}>Your coupons</h3>
            {coupons.length === 0 ? <p style={{ color: '#aaa', fontSize: 13 }}>No coupons yet.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {coupons.map(c => {
                  const expired = c.expires_on && c.expires_on < new Date().toISOString().slice(0, 10)
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', border: '1px solid #eee', borderRadius: 11, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontFamily: 'monospace', fontSize: 14, letterSpacing: '0.5px' }}>{c.code}</span>
                      <span style={{ fontSize: 13, color: '#556' }}>{c.discount_type === 'percent' ? `${c.discount_value}% off` : `MVR ${c.discount_value} off`}{Number(c.min_order) > 0 ? ` · min MVR ${c.min_order}` : ''}</span>
                      {expired ? <Badge color="gray">Expired</Badge> : c.active ? <Badge color="green">Active</Badge> : <Badge color="red">Off</Badge>}
                      {c.expires_on && <span style={{ fontSize: 11.5, color: '#aaa' }}>till {c.expires_on}</span>}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <Button variant="ghost" size="sm" onClick={() => toggleCoupon(c)}>{c.active ? 'Turn off' : 'Turn on'}</Button>
                        <Button variant="danger" size="sm" onClick={() => delCoupon(c)}><Trash2 size={13} /></Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}

const lbl = { fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }
const ta = { width: '100%', boxSizing: 'border-box', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', color: '#0d1b2a', outline: 'none', resize: 'vertical' }
function Section({ title, children }) {
  return (
    <div style={{ paddingBottom: 18, marginBottom: 18, borderBottom: '1px solid #f2f2f2' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#b8740a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}
