import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, SearchSelect, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import {
  Plus, Megaphone, Eye, Target, Heart, MessageCircle, Share2, Bookmark,
  MousePointerClick, Users, UserPlus, ShoppingCart, DollarSign, TrendingUp,
  Edit2, Trash2, BarChart3, Package, AlertTriangle, Percent,
} from 'lucide-react'
import { localToday } from '../lib/dates'
import { logAudit } from '../lib/audit'

// Cost Management categories that count as advertising money. The Ads page never
// holds the cash itself — this is how it finds what was actually spent.
const AD_COST_CATEGORIES = ['Meta Ads', 'Promotions', 'Sponsorship']

const PLATFORMS = ['Instagram', 'Facebook', 'TikTok', 'Google', 'Influencer', 'Other']
const OBJECTIVES = ['Sales', 'Awareness', 'Reach', 'Traffic', 'Engagement', 'Leads', 'Followers']
const STATUSES = [
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Running' },
  { value: 'ended', label: 'Ended' },
]
const STATUS_COLOR = { planned: 'gray', active: 'green', ended: 'blue' }
const PLATFORM_COLOR = {
  Instagram: '#C13584', Facebook: '#1877F2', TikTok: '#0d1b2a',
  Google: '#EA4335', Influencer: '#7F77DD', Other: '#8a8278',
}
// A campaign booked from here lands under the category that fits its platform.
const categoryFor = p => (p === 'Instagram' || p === 'Facebook' ? 'Meta Ads' : p === 'Influencer' ? 'Sponsorship' : 'Promotions')

// What gets typed in off the platform's own report
const RESULT_FIELDS = [
  { key: 'impressions', label: 'Impressions', icon: Eye },
  { key: 'reach', label: 'Reach', icon: Target },
  { key: 'likes', label: 'Likes', icon: Heart },
  { key: 'comments', label: 'Comments', icon: MessageCircle },
  { key: 'shares', label: 'Shares', icon: Share2 },
  { key: 'saves', label: 'Saves', icon: Bookmark },
  { key: 'clicks', label: 'Link clicks', icon: MousePointerClick },
  { key: 'profile_visits', label: 'Profile visits', icon: Users },
  { key: 'new_followers', label: 'New followers', icon: UserPlus },
  { key: 'messages', label: 'DMs / enquiries', icon: MessageCircle },
  { key: 'orders_count', label: 'Orders from this', icon: ShoppingCart },
  { key: 'revenue', label: 'Revenue (MVR)', icon: DollarSign },
]

const PERIODS = [
  { key: 'all', label: 'All time' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
]

const num = v => Number(v) || 0
const mvr = n => `MVR ${num(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const int = n => num(n).toLocaleString('en-US')
const EMPTY = {
  name: '', platform: 'Instagram', objective: 'Sales', status: 'active',
  start_date: localToday(), end_date: '', spend: '', product_id: '',
  audience: '', notes: '', also_cost: true,
}

// A column the database hasn't got yet shouldn't sink the whole write.
function stripMissing(error, payload) {
  const m = /column "?([a-z_]+)"?.*does not exist|Could not find the '([a-z_]+)' column/i.exec(error?.message || '')
  const col = m && (m[1] || m[2])
  if (col && col in payload) { delete payload[col]; return true }
  return false
}

// Everything worth knowing about one campaign, worked out from what was typed in
function derive(c) {
  const spend = num(c.spend)
  const engagements = num(c.likes) + num(c.comments) + num(c.shares) + num(c.saves)
  return {
    spend, engagements,
    cpm: num(c.impressions) > 0 ? (spend / num(c.impressions)) * 1000 : null,
    cpc: num(c.clicks) > 0 ? spend / num(c.clicks) : null,
    ctr: num(c.impressions) > 0 ? (num(c.clicks) / num(c.impressions)) * 100 : null,
    costPerFollower: num(c.new_followers) > 0 ? spend / num(c.new_followers) : null,
    engagementRate: num(c.reach) > 0 ? (engagements / num(c.reach)) * 100 : null,
    roas: spend > 0 ? num(c.revenue) / spend : null,
    profit: num(c.revenue) - spend,
  }
}

export default function Ads() {
  const [campaigns, setCampaigns] = useState([])
  const [products, setProducts] = useState([])
  const [adCosts, setAdCosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [missingTable, setMissingTable] = useState(false)
  const [period, setPeriod] = useState('all')

  const [modal, setModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(EMPTY)

  const [resultFor, setResultFor] = useState(null)
  const [resultForm, setResultForm] = useState({})

  const toast = useToast()
  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [c, p, e] = await Promise.all([
      supabase.from('ad_campaigns').select('*').order('start_date', { ascending: false }),
      supabase.from('products').select('id, name, photo_url, sell_price').order('name'),
      supabase.from('expenses').select('id, description, category, amount, expense_date').in('category', AD_COST_CATEGORIES),
    ])
    if (c.error) setMissingTable(true)
    setCampaigns(c.data || [])
    setProducts(p.data || [])
    setAdCosts(e.data || [])
    setLoading(false)
  }

  // ── Period filter ───────────────────────────────────────────────────────────
  const inPeriod = useMemo(() => {
    if (period === 'all') return () => true
    if (period === 'month') { const m = localToday().slice(0, 7); return d => (d || '').startsWith(m) }
    const days = parseInt(period, 10)
    const from = new Date(); from.setDate(from.getDate() - days)
    const fromStr = from.toISOString().slice(0, 10)
    return d => (d || '') >= fromStr
  }, [period])

  const shown = useMemo(() => campaigns.filter(c => inPeriod(c.start_date)), [campaigns, inPeriod])
  const costsInPeriod = useMemo(() => adCosts.filter(e => inPeriod(e.expense_date)), [adCosts, inPeriod])

  // ── The totals across the top ───────────────────────────────────────────────
  const totals = useMemo(() => {
    const recorded = costsInPeriod.reduce((s, e) => s + num(e.amount), 0)
    const allocated = shown.reduce((s, c) => s + num(c.spend), 0)
    const sum = k => shown.reduce((s, c) => s + num(c[k]), 0)
    const revenue = sum('revenue')
    return {
      recorded, allocated, unallocated: recorded - allocated,
      impressions: sum('impressions'), reach: sum('reach'),
      likes: sum('likes'), followers: sum('new_followers'),
      clicks: sum('clicks'), orders: sum('orders_count'), revenue,
      roas: allocated > 0 ? revenue / allocated : null,
    }
  }, [shown, costsInPeriod])

  // How the money splits across platforms — the distribution view
  const byPlatform = useMemo(() => {
    const map = {}
    shown.forEach(c => {
      const k = c.platform || 'Other'
      if (!map[k]) map[k] = { platform: k, spend: 0, revenue: 0, count: 0 }
      map[k].spend += num(c.spend); map[k].revenue += num(c.revenue); map[k].count += 1
    })
    return Object.values(map).sort((a, b) => b.spend - a.spend)
  }, [shown])

  // ── Create / edit ───────────────────────────────────────────────────────────
  function openAdd() { setEditItem(null); setForm({ ...EMPTY }); setModal(true) }
  function openEdit(c) {
    setEditItem(c)
    setForm({
      name: c.name || '', platform: c.platform || 'Instagram', objective: c.objective || 'Sales',
      status: c.status || 'active', start_date: c.start_date || localToday(), end_date: c.end_date || '',
      spend: c.spend ?? '', product_id: c.product_id || '', audience: c.audience || '',
      notes: c.notes || '', also_cost: false,
    })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Give the campaign a name'); return }
    if (form.end_date && form.end_date < form.start_date) { toast.error('The end date is before the start date'); return }
    setSaving(true)
    const prod = products.find(p => p.id === form.product_id)
    const payload = {
      name: form.name.trim(), platform: form.platform, objective: form.objective,
      status: form.status, start_date: form.start_date, end_date: form.end_date || null,
      spend: parseFloat(form.spend) || 0,
      product_id: form.product_id || null, product_name: prod?.name || null,
      audience: form.audience.trim() || null, notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    }

    // Booking the cost at the same time keeps Cost Management the one place the
    // money is recorded — the campaign just points at it.
    if (!editItem && form.also_cost && payload.spend > 0) {
      const exp = {
        description: `Ad: ${payload.name}${prod ? ` — ${prod.name}` : ''}`,
        category: categoryFor(payload.platform),
        amount: payload.spend,
        expense_date: payload.start_date,
        paid_from: 'bank',
      }
      let { data: expRow, error: expErr } = await supabase.from('expenses').insert(exp).select().maybeSingle()
      while (expErr && stripMissing(expErr, exp)) {
        const retry = await supabase.from('expenses').insert(exp).select().maybeSingle()
        expRow = retry.data; expErr = retry.error
      }
      if (expErr) { setSaving(false); toast.error('Could not record the cost: ' + expErr.message); return }
      if (expRow?.id) payload.expense_id = expRow.id
    }

    const run = pl => (editItem
      ? supabase.from('ad_campaigns').update(pl).eq('id', editItem.id)
      : supabase.from('ad_campaigns').insert(pl))
    let { error } = await run(payload)
    while (error && stripMissing(error, payload)) { error = (await run(payload)).error }
    setSaving(false)
    if (error) { toast.error('Failed to save: ' + error.message); return }
    logAudit(editItem ? 'update' : 'create', 'ad_campaign', payload.name, { spend: payload.spend, platform: payload.platform })
    toast.success(editItem ? 'Campaign updated' : 'Campaign created')
    setModal(false); load()
  }

  async function remove(c) {
    if (!window.confirm(`Delete "${c.name}"? The cost in Cost Management stays.`)) return
    await supabase.from('ad_campaigns').delete().eq('id', c.id)
    logAudit('delete', 'ad_campaign', c.name, { spend: num(c.spend) })
    toast.success('Campaign deleted'); load()
  }

  // ── Results ─────────────────────────────────────────────────────────────────
  function openResults(c) {
    setResultFor(c)
    const f = {}
    RESULT_FIELDS.forEach(r => { f[r.key] = c[r.key] ?? '' })
    setResultForm(f)
  }
  async function saveResults() {
    setSaving(true)
    const payload = { updated_at: new Date().toISOString() }
    RESULT_FIELDS.forEach(r => { payload[r.key] = r.key === 'revenue' ? (parseFloat(resultForm[r.key]) || 0) : (parseInt(resultForm[r.key], 10) || 0) })
    let { error } = await supabase.from('ad_campaigns').update(payload).eq('id', resultFor.id)
    while (error && stripMissing(error, payload)) { error = (await supabase.from('ad_campaigns').update(payload).eq('id', resultFor.id)).error }
    setSaving(false)
    if (error) { toast.error('Failed to save: ' + error.message); return }
    logAudit('update', 'ad_campaign', `${resultFor.name} — results`, { reach: payload.reach, revenue: payload.revenue })
    toast.success('Results saved'); setResultFor(null); load()
  }

  if (loading) return <Spinner />

  if (missingTable) return (
    <div>
      <PageHeader title="Ads & Campaigns" subtitle="Where the advertising money goes, and what it brought back" />
      <Card style={{ textAlign: 'center', padding: '46px 24px' }}>
        <AlertTriangle size={32} color="#e6940a" style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0d1b2a', marginBottom: 6 }}>One setup step left</div>
        <div style={{ fontSize: 13, color: '#8a8278', maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>
          Run <b>integrations/ads-setup.sql</b> in Supabase → SQL Editor to create the
          <code style={{ background: '#f5f2ec', padding: '1px 6px', borderRadius: 5, margin: '0 4px' }}>ad_campaigns</code>
          table, then reload this page.
        </div>
      </Card>
    </div>
  )

  const spendMax = Math.max(1, ...byPlatform.map(p => p.spend))

  return (
    <div>
      <Toasts toasts={toast.toasts} />
      <PageHeader
        title="Ads & Campaigns"
        subtitle="Where the advertising money goes, and what it brought back"
        action={<Button onClick={openAdd}><Plus size={15} /> New campaign</Button>}
      />

      <style>{`
        .ads-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
        .ads-stat { background: #fff; border: 1px solid #eee; border-radius: 14px; padding: 15px 17px; }
        .ads-lbl { font-size: 10.5px; font-weight: 700; letter-spacing: .7px; text-transform: uppercase; color: #a9a094; }
        .ads-val { font-size: 21px; font-weight: 800; color: #0d1b2a; letter-spacing: -.5px; margin-top: 7px; }
        .ads-sub { font-size: 11.5px; color: #a9a094; margin-top: 3px; }
        .ads-res { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; margin-top: 12px; }
        .ads-res div { background: #faf9f6; border-radius: 9px; padding: 8px 10px; }
        .ads-res b { display: block; font-size: 14px; color: #0d1b2a; margin-top: 2px; }
        .ads-card { background: #fff; border: 1px solid #eee; border-radius: 16px; padding: 18px 20px; margin-bottom: 12px; }
        .ads-metrics { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; padding-top: 12px; border-top: 1px solid #f4f0e9; }
        .ads-metrics span { font-size: 11.5px; color: #8a8278; }
        .ads-metrics b { color: #0d1b2a; }
        .ads-fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        @media (max-width: 900px) {
          .ads-stats { grid-template-columns: repeat(2, 1fr); }
          .ads-fields { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>

      {/* period */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
        {PERIODS.map(p => (
          <button key={p.key} className={`filter-pill${period === p.key ? ' active' : ''}`} onClick={() => setPeriod(p.key)}>{p.label}</button>
        ))}
      </div>

      {/* the money */}
      <div className="ads-stats">
        <div className="ads-stat">
          <div className="ads-lbl">Ad spend recorded</div>
          <div className="ads-val">{mvr(totals.recorded)}</div>
          <div className="ads-sub">From Cost Management</div>
        </div>
        <div className="ads-stat">
          <div className="ads-lbl">Given to campaigns</div>
          <div className="ads-val">{mvr(totals.allocated)}</div>
          <div className="ads-sub">{shown.length} campaign{shown.length === 1 ? '' : 's'}</div>
        </div>
        <div className="ads-stat">
          <div className="ads-lbl">Not yet accounted for</div>
          <div className="ads-val" style={{ color: Math.abs(totals.unallocated) < 1 ? '#1D9E75' : '#e6940a' }}>{mvr(totals.unallocated)}</div>
          <div className="ads-sub">{totals.unallocated > 0 ? 'Spent but not in a campaign' : totals.unallocated < 0 ? 'Campaigns exceed recorded cost' : 'Everything matches'}</div>
        </div>
        <div className="ads-stat">
          <div className="ads-lbl">Return on ad spend</div>
          <div className="ads-val" style={{ color: totals.roas == null ? '#c4bcb0' : totals.roas >= 1 ? '#1D9E75' : '#E24B4A' }}>
            {totals.roas == null ? '—' : `${totals.roas.toFixed(2)}×`}
          </div>
          <div className="ads-sub">{mvr(totals.revenue)} attributed</div>
        </div>
      </div>

      {/* the reach */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
          {[
            ['Impressions', int(totals.impressions), Eye],
            ['Reach', int(totals.reach), Target],
            ['Likes', int(totals.likes), Heart],
            ['New followers', int(totals.followers), UserPlus],
            ['Link clicks', int(totals.clicks), MousePointerClick],
            ['Orders', int(totals.orders), ShoppingCart],
          ].map(([l, v, Ic]) => (
            <div key={l}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#a9a094', fontWeight: 600 }}>
                <Ic size={13} color="#c4bcb0" /> {l}
              </div>
              <div style={{ fontSize: 19, fontWeight: 800, color: '#0d1b2a', marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* how the money splits */}
      {byPlatform.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <BarChart3 size={15} color="#FFA500" />
            <span style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>Where the money went</span>
          </div>
          {byPlatform.map(p => {
            const share = totals.allocated > 0 ? (p.spend / totals.allocated) * 100 : 0
            return (
              <div key={p.platform} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
                  <span style={{ fontWeight: 600, color: '#0d1b2a' }}>
                    {p.platform} <span style={{ color: '#bbb', fontWeight: 500 }}>· {p.count} campaign{p.count === 1 ? '' : 's'}</span>
                  </span>
                  <span style={{ color: '#5c5750' }}>
                    <b>{mvr(p.spend)}</b> <span style={{ color: '#bbb' }}>({share.toFixed(0)}%)</span>
                    {p.revenue > 0 && <span style={{ color: '#1D9E75', marginLeft: 8 }}>→ {mvr(p.revenue)}</span>}
                  </span>
                </div>
                <div style={{ height: 7, background: '#f4f1ea', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(p.spend / spendMax) * 100}%`, background: PLATFORM_COLOR[p.platform] || '#8a8278', borderRadius: 99, transition: 'width .5s ease' }} />
                </div>
              </div>
            )
          })}
        </Card>
      )}

      {/* the campaigns */}
      {shown.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '52px 24px' }}>
          <Megaphone size={32} color="#e0dcd4" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0d1b2a', marginBottom: 6 }}>No campaigns in this period</div>
          <div style={{ fontSize: 13, color: '#aaa', maxWidth: 420, margin: '0 auto 18px', lineHeight: 1.6 }}>
            Set the dates you ran an ad, what it was for and what it cost — then put the platform's numbers against it to see what the money actually did.
          </div>
          <Button onClick={openAdd}><Plus size={15} /> New campaign</Button>
        </Card>
      ) : shown.map(c => {
        const d = derive(c)
        const hasResults = num(c.impressions) + num(c.reach) + num(c.likes) + num(c.new_followers) > 0
        return (
          <div key={c.id} className="ads-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#0d1b2a' }}>{c.name}</span>
                  <Badge color={STATUS_COLOR[c.status] || 'gray'}>{(STATUSES.find(s => s.value === c.status) || {}).label || c.status}</Badge>
                  <span style={{ fontSize: 11, fontWeight: 700, color: PLATFORM_COLOR[c.platform] || '#8a8278', background: (PLATFORM_COLOR[c.platform] || '#8a8278') + '18', padding: '3px 9px', borderRadius: 99 }}>{c.platform}</span>
                </div>
                <div style={{ fontSize: 12, color: '#a9a094', marginTop: 5, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>{c.start_date}{c.end_date ? ` → ${c.end_date}` : ''}</span>
                  {c.objective && <span>· {c.objective}</span>}
                  {c.product_name && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#378ADD' }}><Package size={11} /> {c.product_name}</span>}
                  {c.audience && <span>· {c.audience}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#0d1b2a' }}>{mvr(c.spend)}</div>
                  {d.roas != null && (
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: d.roas >= 1 ? '#1D9E75' : '#E24B4A' }}>{d.roas.toFixed(2)}× return</div>
                  )}
                </div>
                <button className="icon-btn" title="Edit" onClick={() => openEdit(c)}><Edit2 size={14} /></button>
                <button className="icon-btn danger" title="Delete" onClick={() => remove(c)}><Trash2 size={14} /></button>
              </div>
            </div>

            {hasResults ? (
              <>
                <div className="ads-res">
                  {RESULT_FIELDS.filter(r => num(c[r.key]) > 0).map(r => (
                    <div key={r.key}>
                      <span style={{ fontSize: 10.5, color: '#a9a094', fontWeight: 600 }}>{r.label}</span>
                      <b>{r.key === 'revenue' ? mvr(c[r.key]) : int(c[r.key])}</b>
                    </div>
                  ))}
                </div>
                <div className="ads-metrics">
                  {d.cpm != null && <span>CPM <b>{mvr(d.cpm)}</b></span>}
                  {d.cpc != null && <span>Cost per click <b>{mvr(d.cpc)}</b></span>}
                  {d.ctr != null && <span>Click rate <b>{d.ctr.toFixed(2)}%</b></span>}
                  {d.engagementRate != null && <span>Engagement <b>{d.engagementRate.toFixed(1)}%</b></span>}
                  {d.costPerFollower != null && <span>Per follower <b>{mvr(d.costPerFollower)}</b></span>}
                  {num(c.revenue) > 0 && <span>Profit <b style={{ color: d.profit >= 0 ? '#1D9E75' : '#E24B4A' }}>{mvr(d.profit)}</b></span>}
                  <button className="filter-pill" style={{ marginLeft: 'auto' }} onClick={() => openResults(c)}>Update results</button>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f4f0e9', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, color: '#a9a094' }}>No results recorded yet — add the numbers from the platform's report.</span>
                <Button size="sm" onClick={() => openResults(c)}><TrendingUp size={13} /> Add results</Button>
              </div>
            )}
          </div>
        )
      })}

      {/* ── New / edit campaign ─────────────────────────────────────────────── */}
      {modal && (
        <Modal title={editItem ? 'Edit campaign' : 'New campaign'}
          subtitle="The dates you ran it, what it was for and what it cost"
          onClose={() => setModal(false)} width={640}>
          <Input label="Campaign name" value={form.name} placeholder="e.g. August Lego push"
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <FormRow>
            <Select label="Platform" value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
              options={PLATFORMS.map(p => ({ value: p, label: p }))} />
            <Select label="Objective" value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))}
              options={OBJECTIVES.map(o => ({ value: o, label: o }))} />
          </FormRow>
          <FormRow>
            <Input label="Start date" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            <Input label="End date (optional)" type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
          </FormRow>
          <FormRow>
            <Input label="Spend (MVR)" type="number" min="0" step="0.01" value={form.spend} placeholder="700"
              onChange={e => setForm(f => ({ ...f, spend: e.target.value }))} />
            <Select label="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              options={STATUSES} />
          </FormRow>
          <div style={{ marginBottom: 12 }}>
            <SearchSelect label="Product being advertised (optional)" value={form.product_id}
              onChange={v => setForm(f => ({ ...f, product_id: v }))}
              placeholder="— Brand-wide, no single product —"
              options={products.map(p => ({ value: p.id, label: p.name }))} />
          </div>
          <Input label="Audience (optional)" value={form.audience} placeholder="e.g. Malé, parents 25-40"
            onChange={e => setForm(f => ({ ...f, audience: e.target.value }))} />
          <Input label="Notes (optional)" value={form.notes} placeholder="What you were testing"
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />

          {!editItem && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#fffdf6', border: '1px solid #f4e7cd', borderRadius: 10, padding: '12px 14px', marginTop: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.also_cost} style={{ marginTop: 2 }}
                onChange={e => setForm(f => ({ ...f, also_cost: e.target.checked }))} />
              <span style={{ fontSize: 12.5, color: '#8a6a2a', lineHeight: 1.5 }}>
                Also record this as a cost in <b>Cost Management</b> under <b>{categoryFor(form.platform)}</b>, so the money is counted once and shows in the books.
                <span style={{ display: 'block', color: '#a9a094', marginTop: 3 }}>Leave this off if you already entered the cost there.</span>
              </span>
            </label>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editItem ? 'Save changes' : 'Create campaign'}</Button>
          </div>
        </Modal>
      )}

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {resultFor && (
        <Modal title={`Results — ${resultFor.name}`}
          subtitle="Type in the numbers from the platform's report"
          onClose={() => setResultFor(null)} width={640}>
          <div className="ads-fields">
            {RESULT_FIELDS.map(r => (
              <Input key={r.key} label={r.label} type="number" min="0" value={resultForm[r.key] ?? ''}
                placeholder="0" onChange={e => setResultForm(f => ({ ...f, [r.key]: e.target.value }))} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f6f9ff', border: '1px solid #dbe7fb', borderRadius: 10, padding: '11px 14px', marginTop: 14, fontSize: 12.5, color: '#3d6ba8' }}>
            <Percent size={14} />
            CPM, cost per click, engagement rate and return on spend are worked out from these against the {mvr(resultFor.spend)} spend.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <Button variant="ghost" onClick={() => setResultFor(null)}>Cancel</Button>
            <Button onClick={saveResults} disabled={saving}>{saving ? 'Saving…' : 'Save results'}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
