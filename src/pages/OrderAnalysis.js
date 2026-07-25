import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { localToday } from '../lib/dates'
import { logAudit } from '../lib/audit'
import { PageHeader, Card, Button, Input, Select, Modal, Spinner, useToast, Toasts, Badge, ImageTile } from '../components/UI'
import {
  Plus, Trash2, Calculator, Search, Package, BookOpen, TrendingUp, TrendingDown,
  ArrowLeft, Truck, FileSpreadsheet, AlertTriangle, CheckCircle, Copy, Percent, X
} from 'lucide-react'
import * as XLSX from 'xlsx'

// Extra (landed) costs that apply to the whole order and get shared across the
// products in proportion to what each product costs.
const COST_TYPES = ['Shipping / Freight', 'Customs / Duty', 'Transaction charge', 'Local delivery', 'Other']

const num = v => (v === '' || v == null || isNaN(Number(v)) ? 0 : Number(v))
const mv = n => 'MVR ' + num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const mv0 = n => 'MVR ' + Math.round(num(n)).toLocaleString('en-US')
const pct = n => (isFinite(n) ? `${n.toFixed(1)}%` : '—')
const normName = s => (s || '').toLowerCase().trim()

// Insert that quietly drops columns the database doesn't have yet, so an older
// schema still saves what it can instead of failing outright.
async function insertStrip(table, rows, select) {
  let payload = Array.isArray(rows) ? rows.map(r => ({ ...r })) : { ...rows }
  const run = () => (select ? supabase.from(table).insert(payload).select() : supabase.from(table).insert(payload))
  let res = await run()
  while (res.error && /column .* does not exist|could not find/i.test(res.error.message || '')) {
    const col = (res.error.message.match(/'([a-z_]+)' column/i) || res.error.message.match(/column "?([a-z_]+)"?/i) || [])[1]
    if (!col) break
    const arr = Array.isArray(payload) ? payload : [payload]
    let removed = false
    arr.forEach(p => { if (col in p) { delete p[col]; removed = true } })
    if (!removed) break
    res = await run()
  }
  return res
}

// ── Per-product analysis maths ────────────────────────────────────────────────
// Extra costs are shared out by each line's share of the goods total, so a
// product that costs more of the order carries more of the freight.
function analyse(items, extraCosts, targetMargin, velocityFor) {
  const extrasTotal = (extraCosts || []).reduce((s, c) => s + num(c.amount), 0)
  const goodsTotal = items.reduce((s, i) => s + num(i.qty) * num(i.unit_cost), 0)

  const rows = items.map(i => {
    const qty = num(i.qty)
    const unitCost = num(i.unit_cost)
    const sell = num(i.sell_price)
    const lineCost = qty * unitCost
    const share = goodsTotal > 0 ? lineCost / goodsTotal : (items.length ? 1 / items.length : 0)
    const allocated = extrasTotal * share
    const landedLine = lineCost + allocated
    const landedUnit = qty > 0 ? landedLine / qty : unitCost
    const revenue = qty * sell
    const profitUnit = sell - landedUnit
    const profit = revenue - landedLine
    const margin = sell > 0 ? (profitUnit / sell) * 100 : 0        // profit as a share of the sale
    const markup = landedUnit > 0 ? (profitUnit / landedUnit) * 100 : 0 // mark-up over cost
    const roi = landedLine > 0 ? (profit / landedLine) * 100 : 0
    const breakEven = profitUnit > 0 ? Math.ceil(landedLine / profitUnit) : null

    // Demand side — only meaningful for something we already sell
    const vel = velocityFor(i) || { stock: num(i.current_stock), perDay: 0, perMonth: 0, sold: 0, known: false }
    const stockAfter = num(vel.stock) + qty
    const coverDays = vel.perDay > 0 ? stockAfter / vel.perDay : null
    const monthsToSell = vel.perMonth > 0 ? qty / vel.perMonth : null

    let verdict = 'ok'
    if (sell <= 0) verdict = 'unpriced'
    else if (margin < 0) verdict = 'loss'
    else if (margin < num(targetMargin)) verdict = 'thin'
    else verdict = 'good'

    return {
      ...i, qty, unitCost, sell, lineCost, allocated, landedLine, landedUnit,
      revenue, profitUnit, profit, margin, markup, roi, breakEven,
      stock: num(vel.stock), sold: vel.sold, perMonth: vel.perMonth, known: vel.known,
      stockAfter, coverDays, monthsToSell, verdict,
    }
  })

  const totals = rows.reduce((t, r) => ({
    qty: t.qty + r.qty,
    goods: t.goods + r.lineCost,
    landed: t.landed + r.landedLine,
    revenue: t.revenue + r.revenue,
    profit: t.profit + r.profit,
  }), { qty: 0, goods: 0, landed: 0, revenue: 0, profit: 0 })
  totals.extras = extrasTotal
  totals.margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0
  totals.roi = totals.landed > 0 ? (totals.profit / totals.landed) * 100 : 0
  totals.lines = rows.length

  return { rows, totals }
}

const VERDICT = {
  good:     { color: 'green', label: 'Good margin' },
  thin:     { color: 'amber', label: 'Below target' },
  loss:     { color: 'red',   label: 'Loses money' },
  unpriced: { color: 'gray',  label: 'No sell price' },
}

export default function OrderAnalysis() {
  const [analyses, setAnalyses] = useState([])
  const [openId, setOpenId] = useState(() => localStorage.getItem('bnj_open_analysis') || null)
  const [items, setItems] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [catalog, setCatalog] = useState([])
  const [products, setProducts] = useState([])
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newModal, setNewModal] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', supplier_id: '', supplier_name: '', target_margin: 40 })
  const [pickModal, setPickModal] = useState(null) // 'catalog' | 'inventory'
  const [pickSearch, setPickSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const toast = useToast()

  const open = analyses.find(a => a.id === openId) || null

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (openId) { localStorage.setItem('bnj_open_analysis', openId); loadItems(openId) }
    else { localStorage.removeItem('bnj_open_analysis'); setItems([]) }
  }, [openId])

  async function load() {
    setLoading(true)
    const [a, s, c, p, o] = await Promise.all([
      supabase.from('order_analyses').select('*').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('supplier_products').select('*').order('product_name'),
      supabase.from('products').select('*').order('name'),
      supabase.from('orders').select('product_id, product_name, qty, status, order_date'),
    ])
    if (a.error) {
      toast.error('Analysis tables not found — run the SQL in supabase_schema.sql')
    }
    setAnalyses(a.data || [])
    // A stashed id can point at an analysis that was since deleted — drop it so
    // the list view isn't stuck behind a phantom "open" analysis.
    setOpenId(prev => (prev && !(a.data || []).some(x => x.id === prev) ? null : prev))
    setSuppliers(s.data || [])
    setCatalog(c.data || [])
    setProducts(p.data || [])
    setOrders(o.data || [])
    setLoading(false)
  }

  async function loadItems(id) {
    setItemsLoading(true)
    const { data } = await supabase.from('order_analysis_items').select('*').eq('analysis_id', id).order('sort_order').order('created_at')
    setItems(data || [])
    setItemsLoading(false)
  }

  // ── Sales velocity: how fast each product actually moves ────────────────────
  const velocity = useMemo(() => {
    const WINDOW = 60
    const since = new Date(Date.now() - WINDOW * 86400000).toISOString().slice(0, 10)
    const byId = {}, byName = {}
    orders.filter(o => o.status === 'delivered' && (o.order_date || '') >= since).forEach(o => {
      const q = num(o.qty)
      if (o.product_id) byId[o.product_id] = (byId[o.product_id] || 0) + q
      const n = normName(o.product_name)
      if (n) byName[n] = (byName[n] || 0) + q
    })
    const prodById = new Map(products.map(p => [p.id, p]))
    const prodByName = new Map(products.map(p => [normName(p.name), p]))
    return item => {
      // A catalog product may not be in inventory yet — match on name as a fallback
      const p = (item.product_id && prodById.get(item.product_id)) || prodByName.get(normName(item.product_name))
      const sold = (p && byId[p.id]) || byName[normName(item.product_name)] || 0
      const perDay = sold / WINDOW
      return {
        stock: p ? num(p.stock_qty) : num(item.current_stock),
        sold, perDay, perMonth: perDay * 30,
        known: !!p,
      }
    }
  }, [orders, products])

  const { rows, totals } = useMemo(
    () => analyse(items, open?.extra_costs || [], open?.target_margin ?? 40, velocity),
    [items, open, velocity]
  )

  // ── Analysis CRUD ───────────────────────────────────────────────────────────
  async function createAnalysis() {
    const supplier = suppliers.find(s => s.id === newForm.supplier_id)
    const payload = {
      name: newForm.name.trim() || `Analysis ${localToday()}`,
      supplier_id: newForm.supplier_id || null,
      supplier_name: supplier?.name || '',
      status: 'draft',
      target_margin: num(newForm.target_margin) || 40,
      extra_costs: [],
    }
    setSaving(true)
    const { data, error } = await insertStrip('order_analyses', payload, true)
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    const created = data?.[0]
    setAnalyses(prev => [created, ...prev])
    setNewModal(false)
    setOpenId(created.id)
    toast.success('Analysis created — add products to compare')
  }

  async function patchAnalysis(patch) {
    if (!open) return
    setAnalyses(prev => prev.map(a => (a.id === open.id ? { ...a, ...patch } : a)))
    const { error } = await supabase.from('order_analyses')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', open.id)
    if (error) toast.error('Could not save: ' + error.message)
  }

  async function deleteAnalysis(a) {
    if (!window.confirm(`Delete the analysis "${a.name}"?\n\nThis is planning only — nothing in accounting or inventory is affected.`)) return
    await supabase.from('order_analysis_items').delete().eq('analysis_id', a.id)
    const { error } = await supabase.from('order_analyses').delete().eq('id', a.id)
    if (error) { toast.error('Failed: ' + error.message); return }
    setAnalyses(prev => prev.filter(x => x.id !== a.id))
    if (openId === a.id) setOpenId(null)
    toast.success('Analysis deleted')
  }

  async function duplicateAnalysis(a) {
    setSaving(true)
    const { data, error } = await insertStrip('order_analyses', {
      name: `${a.name} (copy)`, supplier_id: a.supplier_id, supplier_name: a.supplier_name,
      status: 'draft', target_margin: a.target_margin, extra_costs: a.extra_costs || [], notes: a.notes,
    }, true)
    if (error || !data?.[0]) { setSaving(false); toast.error('Failed to copy'); return }
    const copy = data[0]
    const { data: src } = await supabase.from('order_analysis_items').select('*').eq('analysis_id', a.id)
    if (src?.length) {
      await insertStrip('order_analysis_items', src.map(({ id, created_at, analysis_id, ...rest }) => ({ ...rest, analysis_id: copy.id })))
    }
    setSaving(false)
    setAnalyses(prev => [copy, ...prev])
    setOpenId(copy.id)
    toast.success('Copied')
  }

  // ── Items ───────────────────────────────────────────────────────────────────
  function updateItem(id, patch) {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)))
  }

  async function saveItem(id) {
    const it = items.find(i => i.id === id)
    if (!it) return
    const { error } = await supabase.from('order_analysis_items').update({
      qty: parseInt(it.qty) || 0,
      unit_cost: num(it.unit_cost),
      sell_price: num(it.sell_price),
      notes: it.notes || null,
    }).eq('id', id)
    if (error) toast.error('Could not save: ' + error.message)
  }

  async function removeItem(it) {
    setItems(prev => prev.filter(i => i.id !== it.id))
    const { error } = await supabase.from('order_analysis_items').delete().eq('id', it.id)
    if (error) { toast.error('Failed: ' + error.message); loadItems(open.id) }
  }

  async function clearItems() {
    if (!items.length) return
    if (!window.confirm(`Remove all ${items.length} products from this analysis?`)) return
    await supabase.from('order_analysis_items').delete().eq('analysis_id', open.id)
    setItems([])
    toast.success('Cleared')
  }

  function openPicker(kind) {
    setPickModal(kind)
    setPickSearch('')
    setPicked(new Set())
  }

  async function addPicked() {
    const already = new Set(items.map(i => i.supplier_product_id || i.product_id).filter(Boolean))
    let records = []
    if (pickModal === 'catalog') {
      records = catalog.filter(c => picked.has(c.id) && !already.has(c.id)).map((c, n) => {
        const inv = products.find(p => normName(p.name) === normName(c.product_name))
        return {
          analysis_id: open.id, source: 'catalog', supplier_product_id: c.id,
          product_id: inv?.id || null, product_name: c.product_name, sku: c.sku || null,
          category: c.category || null, brand: c.brand || null, image_url: c.image_url || null,
          qty: 1, unit_cost: num(c.cost_price),
          // Start from what we already sell it for, else the catalog's suggestion
          sell_price: num(inv?.sell_price) || num(c.sell_price),
          current_stock: inv ? num(inv.stock_qty) : null,
          sort_order: items.length + n,
        }
      })
    } else {
      records = products.filter(p => picked.has(p.id) && !already.has(p.id)).map((p, n) => ({
        analysis_id: open.id, source: 'inventory', product_id: p.id, supplier_product_id: null,
        product_name: p.name, sku: p.sku || null, category: p.category || null, brand: p.brand || null,
        image_url: p.photo_url || null,
        qty: 1, unit_cost: num(p.cost_price), sell_price: num(p.sell_price),
        current_stock: num(p.stock_qty), sort_order: items.length + n,
      }))
    }
    if (!records.length) { toast.error('Nothing new selected'); return }
    setSaving(true)
    const { error } = await insertStrip('order_analysis_items', records)
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    setPickModal(null)
    loadItems(open.id)
    toast.success(`Added ${records.length} product${records.length > 1 ? 's' : ''}`)
  }

  // ── Extra costs ─────────────────────────────────────────────────────────────
  const extras = open?.extra_costs || []
  const setExtras = next => patchAnalysis({ extra_costs: next })
  const addExtra = () => setExtras([...extras, { type: 'Shipping / Freight', label: '', amount: '' }])
  const updateExtra = (idx, key, value) => setExtras(extras.map((c, i) => (i === idx ? { ...c, [key]: value } : c)))
  const removeExtra = idx => setExtras(extras.filter((_, i) => i !== idx))

  // ── Convert to a real batch order ───────────────────────────────────────────
  // This is the only point where anything leaves the analysis sandbox and
  // becomes a purchase order that accounting can see.
  async function createBatchOrder() {
    if (!rows.length) { toast.error('Add products first'); return }
    const losers = rows.filter(r => r.verdict === 'loss').length
    const unpriced = rows.filter(r => r.verdict === 'unpriced').length
    const warn = [
      losers ? `${losers} product${losers > 1 ? 's lose' : ' loses'} money at the planned sell price` : '',
      unpriced ? `${unpriced} product${unpriced > 1 ? 's have' : ' has'} no sell price yet` : '',
    ].filter(Boolean).join('\n')
    const msg = `Create a batch order for ${rows.length} product${rows.length > 1 ? 's' : ''} — ${mv0(totals.landed)} total?\n\n`
      + `This moves it into Batch Orders where it counts towards accounting.${warn ? `\n\n⚠️ ${warn}` : ''}`
    if (!window.confirm(msg)) return

    setSaving(true)
    const batchId = (window.crypto?.randomUUID?.() || `b${Date.now()}${Math.random().toString(36).slice(2, 8)}`)
    // Next human-readable batch number, matching the Batch Orders page
    const { data: existing } = await supabase.from('purchase_orders').select('batch_no')
    let max = 1000
    ;(existing || []).forEach(p => { const m = /(\d+)/.exec(p.batch_no || ''); if (m) max = Math.max(max, parseInt(m[1], 10)) })
    const batchNo = `PO-${max + 1}`
    const orderDate = localToday()

    const records = rows.map(r => ({
      supplier_id: open.supplier_id || null,
      supplier_name: open.supplier_name || '',
      product_id: r.product_id || null,
      product_name: r.product_name,
      qty: r.qty,
      unit_cost: r.unitCost,
      status: 'pending',
      order_date: orderDate,
      image_url: r.image_url || null,
      batch_id: batchId,
      batch_no: batchNo,
      notes: `From analysis "${open.name}" — planned sell ${mv(r.sell)} · margin ${pct(r.margin)}`,
    }))
    const costRecords = extras.filter(c => num(c.amount) > 0).map(c => ({
      supplier_id: open.supplier_id || null,
      supplier_name: open.supplier_name || '',
      product_id: null,
      product_name: c.type === 'Other' ? (c.label || 'Other cost') : c.type,
      qty: 1,
      unit_cost: num(c.amount),
      status: 'pending',
      order_date: orderDate,
      cost_type: 'extra',
      batch_id: batchId,
      batch_no: batchNo,
    }))

    const { error } = await insertStrip('purchase_orders', [...records, ...costRecords])
    if (error) { setSaving(false); toast.error('Failed: ' + error.message); return }

    await supabase.from('order_analyses').update({
      status: 'converted', batch_id: batchId, batch_no: batchNo, converted_at: new Date().toISOString(),
    }).eq('id', open.id)
    setAnalyses(prev => prev.map(a => (a.id === open.id ? { ...a, status: 'converted', batch_id: batchId, batch_no: batchNo } : a)))
    setSaving(false)
    logAudit('create', 'purchase_order', `${batchNo} from analysis "${open.name}" (${rows.length} items)`, { total: totals.landed })
    toast.success(`Batch order ${batchNo} created — open Batch Orders to track it`)
  }

  // ── Excel ───────────────────────────────────────────────────────────────────
  function exportExcel() {
    if (!rows.length) { toast.error('Nothing to export'); return }
    const sheet = rows.map(r => ({
      'Product': r.product_name,
      'SKU': r.sku || '',
      'Category': r.category || '',
      'In inventory': r.known ? 'Yes' : 'New product',
      'Current stock': r.stock,
      'Sold (60 days)': r.sold,
      'Sold / month': +r.perMonth.toFixed(1),
      'Order qty': r.qty,
      'Unit cost': +r.unitCost.toFixed(2),
      'Line cost': +r.lineCost.toFixed(2),
      'Share of extra costs': +r.allocated.toFixed(2),
      'Landed unit cost': +r.landedUnit.toFixed(2),
      'Total landed cost': +r.landedLine.toFixed(2),
      'Sell price': +r.sell.toFixed(2),
      'Profit per unit': +r.profitUnit.toFixed(2),
      'Margin %': +r.margin.toFixed(1),
      'Mark-up %': +r.markup.toFixed(1),
      'Revenue if all sold': +r.revenue.toFixed(2),
      'Total profit': +r.profit.toFixed(2),
      'ROI %': +r.roi.toFixed(1),
      'Break-even units': r.breakEven ?? '',
      'Stock after arrival': r.stockAfter,
      'Days of cover': r.coverDays ? Math.round(r.coverDays) : '',
      'Months to sell out': r.monthsToSell ? +r.monthsToSell.toFixed(1) : '',
      'Verdict': VERDICT[r.verdict].label,
      'Notes': r.notes || '',
    }))
    sheet.push({})
    sheet.push({
      'Product': 'TOTAL', 'Order qty': totals.qty, 'Line cost': +totals.goods.toFixed(2),
      'Share of extra costs': +totals.extras.toFixed(2), 'Total landed cost': +totals.landed.toFixed(2),
      'Revenue if all sold': +totals.revenue.toFixed(2), 'Total profit': +totals.profit.toFixed(2),
      'Margin %': +totals.margin.toFixed(1), 'ROI %': +totals.roi.toFixed(1),
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Analysis')
    if (extras.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        extras.map(c => ({ 'Cost': c.type === 'Other' ? c.label : c.type, 'Amount': num(c.amount) }))
      ), 'Extra costs')
    }
    XLSX.writeFile(wb, `order-analysis-${(open.name || 'draft').replace(/[^\w]+/g, '_')}-${localToday()}.xlsx`)
    toast.success('Downloaded')
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <Spinner />

  // ---------- Detail view ----------
  if (open) {
    const converted = open.status === 'converted'
    const target = num(open.target_margin) || 40
    const pickList = (pickModal === 'catalog' ? catalog : products).filter(x => {
      const name = pickModal === 'catalog' ? x.product_name : x.name
      const q = pickSearch.toLowerCase()
      return !q || name?.toLowerCase().includes(q) || x.sku?.toLowerCase().includes(q) || x.category?.toLowerCase().includes(q)
    })
    const alreadyIn = new Set(items.map(i => i.supplier_product_id || i.product_id).filter(Boolean))

    return (
      <div>
        <Toasts toasts={toast.toasts} />
        <button onClick={() => setOpenId(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 13, fontFamily: 'inherit', padding: 0, marginBottom: 14 }}>
          <ArrowLeft size={15} /> All analyses
        </button>

        <PageHeader
          title={open.name}
          subtitle={`${open.supplier_name || 'No supplier set'} · ${rows.length} product${rows.length === 1 ? '' : 's'} · ${converted ? `converted to ${open.batch_no}` : 'draft — nothing has been ordered'}`}
          action={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={exportExcel}><FileSpreadsheet size={14} /> Excel</Button>
              <Button variant="ghost" onClick={() => duplicateAnalysis(open)}><Copy size={14} /> Duplicate</Button>
              <Button variant="danger" onClick={() => deleteAnalysis(open)}><Trash2 size={14} /> Delete</Button>
              {!converted && (
                <Button onClick={createBatchOrder} disabled={saving || !rows.length}>
                  <Truck size={14} /> Create batch order
                </Button>
              )}
            </div>
          }
        />

        {converted && (
          <Card style={{ marginBottom: 18, background: '#f2faf5', border: '1px solid #cfe8db', display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle size={17} color="#1D9E75" />
            <span style={{ fontSize: 13, color: '#2c7a54' }}>
              This analysis became batch order <b>{open.batch_no}</b>. Track and receive it from the Batch Orders page — editing here no longer changes the order.
            </span>
          </Card>
        )}

        {/* Headline numbers */}
        <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
          {[
            { label: 'Cash needed', value: mv0(totals.landed), sub: `${mv0(totals.goods)} goods + ${mv0(totals.extras)} costs`, color: '#0d1b2a' },
            { label: 'Revenue if all sold', value: mv0(totals.revenue), sub: `${totals.qty} units`, color: '#378ADD' },
            { label: 'Projected profit', value: mv0(totals.profit), sub: `${pct(totals.margin)} blended margin`, color: totals.profit >= 0 ? '#1D9E75' : '#E24B4A' },
            { label: 'Return on the money', value: pct(totals.roi), sub: `Target margin ${target}%`, color: totals.roi >= 0 ? '#1D9E75' : '#E24B4A' },
          ].map(m => (
            <div key={m.label} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ fontSize: 10.5, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700, marginBottom: 5 }}>{m.label}</div>
              <div style={{ fontSize: 23, fontWeight: 800, color: m.color, letterSpacing: '-0.8px', lineHeight: 1.1 }}>{m.value}</div>
              <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 4 }}>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* Settings + extra costs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 14, marginBottom: 18 }} className="grid-collapse">
          <Card>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0d1b2a', marginBottom: 12 }}>Analysis settings</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Input label="Name" defaultValue={open.name} onBlur={e => patchAnalysis({ name: e.target.value })} />
              <Select label="Supplier" value={open.supplier_id || ''}
                onChange={e => {
                  const s = suppliers.find(x => x.id === e.target.value)
                  patchAnalysis({ supplier_id: e.target.value || null, supplier_name: s?.name || '' })
                }}
                options={[{ value: '', label: '— Select supplier —' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]} />
              <Input label="Target margin %" type="number" defaultValue={target}
                onBlur={e => patchAnalysis({ target_margin: num(e.target.value) || 40 })} />
              <Input label="Notes" defaultValue={open.notes || ''} placeholder="Why this order, what to watch…"
                onBlur={e => patchAnalysis({ notes: e.target.value })} />
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0d1b2a' }}>Extra costs on this order</div>
                <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 2 }}>Shipping, duty and fees — shared across products by what each one costs</div>
              </div>
              <Button size="sm" variant="ghost" onClick={addExtra}><Plus size={13} /> Add</Button>
            </div>
            {extras.length === 0 && <div style={{ fontSize: 12.5, color: '#bbb', padding: '8px 0' }}>No extra costs yet — landed cost equals the supplier price.</div>}
            {extras.map((c, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <select value={c.type} onChange={e => updateExtra(idx, 'type', e.target.value)}
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }}>
                  {COST_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                {c.type === 'Other' && (
                  <input value={c.label || ''} onChange={e => updateExtra(idx, 'label', e.target.value)} placeholder="What is it?"
                    style={{ flex: 1, padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit' }} />
                )}
                <input type="number" value={c.amount} onChange={e => updateExtra(idx, 'amount', e.target.value)} placeholder="MVR"
                  style={{ width: 110, padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit' }} />
                <button onClick={() => removeExtra(idx)} title="Remove"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, display: 'flex' }}>
                  <X size={15} color="#c0392b" />
                </button>
              </div>
            ))}
            {extras.length > 0 && (
              <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
                <span style={{ color: '#888' }}>Total extra costs</span><span>{mv(totals.extras)}</span>
              </div>
            )}
          </Card>
        </div>

        {/* Products */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 20px', borderBottom: '1px solid #f2f2f2', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>Products under consideration</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" onClick={() => openPicker('catalog')}><BookOpen size={13} /> From supplier catalog</Button>
              <Button size="sm" variant="ghost" onClick={() => openPicker('inventory')}><Package size={13} /> From inventory</Button>
              {items.length > 0 && <Button size="sm" variant="danger" onClick={clearItems}><Trash2 size={13} /> Clear all</Button>}
            </div>
          </div>

          {itemsLoading ? <Spinner /> : rows.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: '#bbb' }}>
              <Calculator size={30} color="#e0dcd4" style={{ marginBottom: 10 }} />
              <div style={{ fontSize: 13.5 }}>Nothing to analyse yet.</div>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>Pull products in from the supplier catalog, or add ones you already stock.</div>
            </div>
          ) : (
            <div className="x-scroll-wrap">
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1180 }}>
                <thead>
                  <tr style={{ background: '#fbfaf8' }}>
                    {['Product', 'Qty', 'Unit cost', 'Landed cost', 'Sell price', 'Profit / unit', 'Margin', 'Total cost', 'Total profit', 'ROI', 'Stock & demand', ''].map((h, i) => (
                      <th key={h + i} style={{ padding: '10px 12px', textAlign: i === 0 || i === 10 ? 'left' : 'right', fontSize: 10.5, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const v = VERDICT[r.verdict]
                    const marginColor = r.verdict === 'good' ? '#1D9E75' : r.verdict === 'thin' ? '#e6940a' : r.verdict === 'loss' ? '#E24B4A' : '#aaa'
                    const cell = { padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', borderTop: '1px solid #f5f5f5' }
                    const editStyle = { width: 82, padding: '6px 8px', border: '1px solid #e6e2da', borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit', textAlign: 'right' }
                    return (
                      <tr key={r.id}>
                        <td style={{ ...cell, textAlign: 'left', minWidth: 230 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <ImageTile src={r.image_url} style={{ width: 38, height: 38, borderRadius: 8, background: '#f7f5f2', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {r.image_url
                                ? <img src={r.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                : <Package size={15} color="#d5cfc6" />}
                            </ImageTile>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: '#0d1b2a', whiteSpace: 'normal' }}>{r.product_name}</div>
                              <div style={{ fontSize: 11, color: '#bbb', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                {r.sku && <span>{r.sku}</span>}
                                <Badge color={v.color}>{v.label}</Badge>
                                {!r.known && <Badge color="blue">New product</Badge>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={cell}>
                          <input type="number" value={r.qty} disabled={converted} style={{ ...editStyle, width: 62 }}
                            onChange={e => updateItem(r.id, { qty: e.target.value })} onBlur={() => saveItem(r.id)} />
                        </td>
                        <td style={cell}>
                          <input type="number" value={r.unit_cost} disabled={converted} style={editStyle}
                            onChange={e => updateItem(r.id, { unit_cost: e.target.value })} onBlur={() => saveItem(r.id)} />
                        </td>
                        <td style={{ ...cell, color: '#666' }} title={`Supplier ${mv(r.unitCost)} + ${mv(r.allocated / (r.qty || 1))} share of extra costs`}>
                          {mv(r.landedUnit)}
                        </td>
                        <td style={cell}>
                          <input type="number" value={r.sell_price} disabled={converted} style={editStyle}
                            onChange={e => updateItem(r.id, { sell_price: e.target.value })} onBlur={() => saveItem(r.id)} />
                        </td>
                        <td style={{ ...cell, color: r.profitUnit >= 0 ? '#1D9E75' : '#E24B4A', fontWeight: 600 }}>{mv(r.profitUnit)}</td>
                        <td style={{ ...cell, fontWeight: 700, color: marginColor }}>
                          {pct(r.margin)}
                          <div style={{ fontSize: 10, color: '#c4c0b8', fontWeight: 500 }}>{pct(r.markup)} mark-up</div>
                        </td>
                        <td style={{ ...cell, color: '#666' }}>{mv0(r.landedLine)}</td>
                        <td style={{ ...cell, fontWeight: 700, color: r.profit >= 0 ? '#1D9E75' : '#E24B4A' }}>{mv0(r.profit)}</td>
                        <td style={{ ...cell, color: r.roi >= 0 ? '#1D9E75' : '#E24B4A' }}>
                          {pct(r.roi)}
                          {r.breakEven != null && <div style={{ fontSize: 10, color: '#c4c0b8' }}>{r.breakEven} to break even</div>}
                        </td>
                        <td style={{ ...cell, textAlign: 'left', fontSize: 11.5, color: '#888', minWidth: 190, whiteSpace: 'normal' }}>
                          {r.known ? (
                            <>
                              <div>{r.stock} in stock · sells {r.perMonth.toFixed(1)}/month</div>
                              <div style={{ color: r.coverDays && r.coverDays > 270 ? '#e6940a' : '#bbb' }}>
                                {r.coverDays
                                  ? `${Math.round(r.coverDays)} days of cover after arrival`
                                  : 'No sales in the last 60 days'}
                                {r.monthsToSell ? ` · ~${r.monthsToSell.toFixed(1)} months to sell this batch` : ''}
                              </div>
                            </>
                          ) : (
                            <span style={{ color: '#bbb' }}>Not stocked yet — no sales history to judge demand</span>
                          )}
                        </td>
                        <td style={{ ...cell, textAlign: 'right' }}>
                          <button onClick={() => removeItem(r)} title="Remove from analysis"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, display: 'flex' }}>
                            <Trash2 size={14} color="#c0392b" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#fbfaf8', fontWeight: 700 }}>
                    <td style={{ padding: '12px', borderTop: '2px solid #f0ece6' }}>Total</td>
                    <td style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6' }}>{totals.qty}</td>
                    <td colSpan={2} style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6', color: '#aaa', fontWeight: 500, fontSize: 11.5 }}>
                      incl. {mv0(totals.extras)} extra costs
                    </td>
                    <td colSpan={3} style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6', color: totals.margin >= target ? '#1D9E75' : '#e6940a' }}>
                      {pct(totals.margin)} blended margin
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6' }}>{mv0(totals.landed)}</td>
                    <td style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6', color: totals.profit >= 0 ? '#1D9E75' : '#E24B4A' }}>{mv0(totals.profit)}</td>
                    <td colSpan={3} style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6', color: '#1D9E75' }}>{pct(totals.roi)} ROI</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        {rows.some(r => r.verdict === 'loss' || r.verdict === 'thin') && (
          <Card style={{ marginTop: 16, background: '#fffaf2', border: '1px solid #f3e4c8' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertTriangle size={17} color="#e6940a" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12.5, color: '#8a6a2a', lineHeight: 1.6 }}>
                <b>Worth a second look before ordering:</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {rows.filter(r => r.verdict === 'loss').map(r => (
                    <li key={r.id}>{r.product_name} — loses {mv(Math.abs(r.profitUnit))} per unit. Raise the price to at least {mv(r.landedUnit)} to break even.</li>
                  ))}
                  {rows.filter(r => r.verdict === 'thin').map(r => (
                    <li key={r.id}>{r.product_name} — {pct(r.margin)} margin, below your {target}% target. {mv(r.landedUnit / (1 - target / 100))} would hit it.</li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        )}

        {/* Product picker */}
        {pickModal && (
          <Modal title={pickModal === 'catalog' ? 'Add from supplier catalog' : 'Add from inventory'}
            subtitle={pickModal === 'catalog' ? 'Products your suppliers offer' : 'Products you already stock — re-order and check the numbers still work'}
            onClose={() => setPickModal(null)} width={720}>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Search size={15} color="#bbb" style={{ position: 'absolute', left: 12, top: 11 }} />
              <input value={pickSearch} onChange={e => setPickSearch(e.target.value)} placeholder="Search by name, SKU or category…" autoFocus
                style={{ width: '100%', padding: '10px 12px 10px 34px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 10 }}>
              {pickList.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#bbb', fontSize: 13 }}>Nothing found.</div>}
              {pickList.map(x => {
                const id = x.id
                const name = pickModal === 'catalog' ? x.product_name : x.name
                const img = pickModal === 'catalog' ? x.image_url : x.photo_url
                const cost = num(x.cost_price), sell = num(x.sell_price)
                const inAlready = alreadyIn.has(id)
                const on = picked.has(id)
                return (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderBottom: '1px solid #f7f7f7', cursor: inAlready ? 'default' : 'pointer', opacity: inAlready ? 0.45 : 1, background: on ? '#fffaf0' : '#fff' }}>
                    <input type="checkbox" checked={on} disabled={inAlready}
                      onChange={() => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} />
                    <div style={{ width: 34, height: 34, borderRadius: 7, background: '#f7f5f2', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <Package size={14} color="#d5cfc6" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a' }}>{name}</div>
                      <div style={{ fontSize: 11, color: '#bbb' }}>
                        {[x.sku, x.category, pickModal === 'catalog' ? x.supplier_name : `${num(x.stock_qty)} in stock`].filter(Boolean).join(' · ')}
                        {inAlready ? ' · already added' : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11.5, color: '#888', whiteSpace: 'nowrap' }}>
                      <div>cost {cost ? mv(cost) : '—'}</div>
                      <div style={{ color: '#bbb' }}>sell {sell ? mv(sell) : '—'}</div>
                    </div>
                  </label>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <span style={{ fontSize: 12.5, color: '#888' }}>{picked.size} selected</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="ghost" onClick={() => setPickModal(null)}>Cancel</Button>
                <Button onClick={addPicked} disabled={saving || picked.size === 0}><Plus size={14} /> Add to analysis</Button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // ---------- List view ----------
  const drafts = analyses.filter(a => a.status !== 'converted')
  const done = analyses.filter(a => a.status === 'converted')

  return (
    <div>
      <Toasts toasts={toast.toasts} />
      <PageHeader
        title="Order Analysis"
        subtitle="Work out the numbers before you commit — nothing here reaches accounting until you create the batch order"
        action={<Button onClick={() => { setNewForm({ name: '', supplier_id: '', supplier_name: '', target_margin: 40 }); setNewModal(true) }}><Plus size={15} /> New analysis</Button>}
      />

      <Card style={{ marginBottom: 20, background: '#fbfaf8', border: '1px solid #f0ece6' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12.5, color: '#888' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><BookOpen size={14} color="#bbb" /> Supplier catalog</span>
          <span style={{ color: '#ddd' }}>→</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#FFA500' }}><Calculator size={14} color="#FFA500" /> Order analysis</span>
          <span style={{ color: '#ddd' }}>→</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Truck size={14} color="#bbb" /> Batch order</span>
          <span style={{ color: '#ddd' }}>→</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Package size={14} color="#bbb" /> Inventory</span>
        </div>
      </Card>

      {analyses.length === 0 && (
        <Card style={{ textAlign: 'center', padding: '56px 24px' }}>
          <Calculator size={34} color="#e0dcd4" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0d1b2a', marginBottom: 6 }}>No analyses yet</div>
          <div style={{ fontSize: 13, color: '#aaa', maxWidth: 430, margin: '0 auto 18px', lineHeight: 1.6 }}>
            Pick a few products from a supplier catalog, check the profit margin, landed cost and how fast they'd sell — then turn the good ones into a batch order.
          </div>
          <Button onClick={() => setNewModal(true)}><Plus size={15} /> Start an analysis</Button>
        </Card>
      )}

      {[['Drafts', drafts], ['Ordered', done]].map(([label, list]) => list.length > 0 && (
        <div key={label} style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#ccc', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>{label}</div>
          <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {list.map(a => <AnalysisCard key={a.id} a={a} onOpen={() => setOpenId(a.id)} onDelete={() => deleteAnalysis(a)} />)}
          </div>
        </div>
      ))}

      {newModal && (
        <Modal title="New order analysis" subtitle="A sandbox to compare products before ordering" onClose={() => setNewModal(false)} width={480}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input label="Name" value={newForm.name} placeholder={`Analysis ${localToday()}`}
              onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} />
            <Select label="Supplier" value={newForm.supplier_id}
              onChange={e => setNewForm(f => ({ ...f, supplier_id: e.target.value }))}
              options={[{ value: '', label: '— Select supplier —' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]} />
            <Input label="Target margin %" type="number" value={newForm.target_margin}
              onChange={e => setNewForm(f => ({ ...f, target_margin: e.target.value }))} />
            <div style={{ fontSize: 11.5, color: '#aaa', lineHeight: 1.5 }}>
              <Percent size={11} style={{ verticalAlign: -1 }} /> Anything below this margin gets flagged so you can re-price or skip it.
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <Button variant="ghost" onClick={() => setNewModal(false)}>Cancel</Button>
            <Button onClick={createAnalysis} disabled={saving}>Create</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Summary card in the list view ─────────────────────────────────────────────
function AnalysisCard({ a, onOpen, onDelete }) {
  const [stats, setStats] = useState(null)
  useEffect(() => {
    let live = true
    supabase.from('order_analysis_items').select('qty, unit_cost, sell_price').eq('analysis_id', a.id).then(({ data }) => {
      if (!live) return
      const rows = data || []
      const extras = (a.extra_costs || []).reduce((s, c) => s + num(c.amount), 0)
      const goods = rows.reduce((s, r) => s + num(r.qty) * num(r.unit_cost), 0)
      const revenue = rows.reduce((s, r) => s + num(r.qty) * num(r.sell_price), 0)
      const landed = goods + extras
      setStats({ lines: rows.length, landed, revenue, profit: revenue - landed, margin: revenue > 0 ? ((revenue - landed) / revenue) * 100 : 0 })
    })
    return () => { live = false }
  }, [a.id, a.extra_costs])

  const converted = a.status === 'converted'
  return (
    <div onClick={onOpen} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', transition: 'box-shadow .15s, transform .15s' }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.07)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#0d1b2a', letterSpacing: '-0.2px' }}>{a.name}</div>
          <div style={{ fontSize: 11.5, color: '#bbb', marginTop: 3 }}>
            {a.supplier_name || 'No supplier'} · {(a.created_at || '').slice(0, 10)}
          </div>
        </div>
        {converted
          ? <Badge color="green">{a.batch_no || 'Ordered'}</Badge>
          : <Badge color="amber">Draft</Badge>}
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '10px 0', borderTop: '1px solid #f5f5f5' }}>
          {[
            ['Products', stats.lines],
            ['Cost', mv0(stats.landed)],
            ['Profit', mv0(stats.profit)],
          ].map(([l, v]) => (
            <div key={l}>
              <div style={{ fontSize: 10, color: '#ccc', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>{l}</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: l === 'Profit' ? (stats.profit >= 0 ? '#1D9E75' : '#E24B4A') : '#0d1b2a', marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ fontSize: 11.5, color: stats && stats.margin >= num(a.target_margin || 40) ? '#1D9E75' : '#e6940a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          {stats ? <>{stats.margin >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {pct(stats.margin)} margin</> : ' '}
        </span>
        <button onClick={e => { e.stopPropagation(); onDelete() }} title="Delete analysis"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
          <Trash2 size={14} color="#d5cfc6" />
        </button>
      </div>
    </div>
  )
}
