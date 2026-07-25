import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { localToday } from '../lib/dates'
import { logAudit } from '../lib/audit'
import { PageHeader, Card, Button, Input, Select, Modal, Spinner, useToast, Toasts, Badge, ImageTile } from '../components/UI'
import {
  Plus, Trash2, Calculator, Search, Package, BookOpen, TrendingUp, TrendingDown,
  ArrowLeft, Truck, FileSpreadsheet, AlertTriangle, CheckCircle, Copy, Percent, X, Building2
} from 'lucide-react'
import * as XLSX from 'xlsx'

// Extra (landed) costs that apply to the whole order and get shared across the
// products in proportion to what each product costs.
const COST_TYPES = ['Shipping / Freight', 'Customs / Duty', 'Transaction charge', 'Local delivery', 'Other']

// How long stock takes to reach us, and how long the order should last after it
// lands — matches the Stock Report so both pages suggest the same quantities.
const LEAD_DAYS = 90
const COVER_DAYS = 30

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
// One analysis can hold several orders — one per vendor. Extra costs are shared
// out by each line's share of the goods total, so a product that costs more of
// the order carries more of the freight. A cost tagged to a vendor is shared
// only within that vendor's order; an untagged one spreads across everything.
function analyse(items, extraCosts, targetMargin, velocityFor, vendorOf) {
  const costs = extraCosts || []
  const sharedTotal = costs.filter(c => !c.supplier_id).reduce((s, c) => s + num(c.amount), 0)
  const vendorTotals = {}
  costs.filter(c => c.supplier_id).forEach(c => {
    vendorTotals[c.supplier_id] = (vendorTotals[c.supplier_id] || 0) + num(c.amount)
  })

  const lineCostOf = i => num(i.qty) * num(i.unit_cost)
  const goodsTotal = items.reduce((s, i) => s + lineCostOf(i), 0)
  const goodsByVendor = {}
  items.forEach(i => {
    const key = vendorOf(i).id || 'none'
    goodsByVendor[key] = (goodsByVendor[key] || 0) + lineCostOf(i)
  })
  const countByVendor = {}
  items.forEach(i => { const k = vendorOf(i).id || 'none'; countByVendor[k] = (countByVendor[k] || 0) + 1 })

  const rows = items.map(i => {
    const vendor = vendorOf(i)
    const vKey = vendor.id || 'none'
    const qty = num(i.qty)
    const unitCost = num(i.unit_cost)
    const sell = num(i.sell_price)
    const lineCost = qty * unitCost
    // Share of the costs that spread across the whole analysis…
    const shareAll = goodsTotal > 0 ? lineCost / goodsTotal : (items.length ? 1 / items.length : 0)
    // …plus the share of costs belonging only to this vendor's order
    const vGoods = goodsByVendor[vKey] || 0
    const shareVendor = vGoods > 0 ? lineCost / vGoods : (countByVendor[vKey] ? 1 / countByVendor[vKey] : 0)
    const allocated = sharedTotal * shareAll + (vendorTotals[vKey] || 0) * shareVendor
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
      ...i, vendorId: vendor.id || null, vendorName: vendor.name,
      qty, unitCost, sell, lineCost, allocated, landedLine, landedUnit,
      revenue, profitUnit, profit, margin, markup, roi, breakEven,
      stock: num(vel.stock), sold: vel.sold, perMonth: vel.perMonth, known: vel.known,
      stockAfter, coverDays, monthsToSell, verdict,
    }
  })

  const sum = list => {
    const t = list.reduce((a, r) => ({
      qty: a.qty + r.qty,
      goods: a.goods + r.lineCost,
      extras: a.extras + r.allocated,
      landed: a.landed + r.landedLine,
      revenue: a.revenue + r.revenue,
      profit: a.profit + r.profit,
    }), { qty: 0, goods: 0, extras: 0, landed: 0, revenue: 0, profit: 0 })
    t.margin = t.revenue > 0 ? (t.profit / t.revenue) * 100 : 0
    t.roi = t.landed > 0 ? (t.profit / t.landed) * 100 : 0
    t.lines = list.length
    return t
  }

  // One group per vendor — each becomes its own batch order on conversion
  const groups = Object.values(rows.reduce((acc, r) => {
    const key = r.vendorId || 'none'
    if (!acc[key]) acc[key] = { key, supplierId: r.vendorId, label: r.vendorName, rows: [] }
    acc[key].rows.push(r)
    return acc
  }, {}))
  groups.forEach(g => { g.totals = sum(g.rows) })
  groups.sort((a, b) => (b.totals.landed - a.totals.landed))

  return { rows, groups, totals: sum(rows) }
}

const VERDICT = {
  good:     { color: 'green', label: 'Good margin' },
  thin:     { color: 'amber', label: 'Below target' },
  loss:     { color: 'red',   label: 'Loses money' },
  unpriced: { color: 'gray',  label: 'No sell price' },
}

// Most urgent first when listing what to reorder
const URGENCY_RANK = { out: 0, now: 1, low: 2 }

const NEED = {
  out: { color: 'red',   label: 'Out of stock' },
  now: { color: 'amber', label: 'Order now' },
  low: { color: 'blue',  label: 'Running low' },
}

const chipStyle = active => ({
  padding: '5px 11px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 11.5, fontWeight: active ? 700 : 600, whiteSpace: 'nowrap',
  border: `1px solid ${active ? '#FFA500' : '#eee'}`,
  background: active ? '#FFA500' : '#fff',
  color: active ? '#fff' : '#888',
})

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
  const [pickVendor, setPickVendor] = useState('all')
  const [pickNeeds, setPickNeeds] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())   // analysis lines ticked for deletion
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

  // Which vendor an analysis line belongs to. Catalog lines carry their supplier
  // through the catalog record; inventory lines through the product. Falls back
  // to the analysis's default vendor so nothing lands in "No vendor" needlessly.
  const vendorOf = useMemo(() => {
    const catById = new Map(catalog.map(c => [c.id, c]))
    const prodById = new Map(products.map(p => [p.id, p]))
    const supName = id => suppliers.find(s => s.id === id)?.name
    return item => {
      const cat = item.supplier_product_id ? catById.get(item.supplier_product_id) : null
      const prod = item.product_id ? prodById.get(item.product_id) : null
      const id = item.supplier_id || cat?.supplier_id || prod?.supplier_id || open?.supplier_id || null
      const name = (id && (supName(id) || cat?.supplier_name)) || item.supplier_name || cat?.supplier_name || 'No vendor'
      return { id, name }
    }
  }, [catalog, products, suppliers, open])

  const { rows, groups, totals } = useMemo(
    () => analyse(items, open?.extra_costs || [], open?.target_margin ?? 40, velocity, vendorOf),
    [items, open, velocity, vendorOf]
  )

  // ── What actually needs reordering ──────────────────────────────────────────
  // Same lead-time maths as the Stock Report: order enough to cover the wait for
  // the shipment plus a month after it lands. Anything out of stock, past its
  // reorder point, or below its low-stock threshold gets surfaced.
  const reorderInfo = useMemo(() => {
    const m = new Map()
    products.filter(p => !p.discontinued).forEach(p => {
      const v = velocity({ product_id: p.id, product_name: p.name })
      const stock = num(p.stock_qty)
      const threshold = p.low_stock_threshold ?? 10
      const perDay = v.perDay
      const reorderPoint = Math.ceil(perDay * LEAD_DAYS * 1.2)     // lead-time demand + 20% buffer
      let qty = perDay > 0 ? Math.max(0, Math.ceil(perDay * (LEAD_DAYS + COVER_DAYS) - stock)) : 0
      // No recent sales but the shelf is empty/low — top up to about 2× the threshold
      if (qty <= 0 && stock <= threshold) qty = Math.max(threshold * 2 - stock, threshold)
      const urgency = stock <= 0 ? 'out'
        : (perDay > 0 && stock <= reorderPoint) ? 'now'
          : stock <= threshold ? 'low' : null
      if (qty > 0 && urgency) m.set(p.id, { qty, urgency, stock, perMonth: v.perMonth, threshold })
    })
    return m
  }, [products, velocity])

  const recommendations = useMemo(() => {
    const inAnalysis = new Set(items.map(i => i.product_id).filter(Boolean))
    return products
      .filter(p => reorderInfo.has(p.id) && !inAnalysis.has(p.id))
      .map(p => ({ product: p, ...reorderInfo.get(p.id) }))
      .sort((a, b) => (URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]) || (b.perMonth - a.perMonth))
  }, [products, reorderInfo, items])

  // Pull inventory products straight in at their suggested reorder quantity
  async function addProducts(list) {
    if (!list.length) return
    const records = list.map((p, n) => ({
      analysis_id: open.id, source: 'inventory', product_id: p.id, supplier_product_id: null,
      product_name: p.name, sku: p.sku || null, category: p.category || null, brand: p.brand || null,
      image_url: p.photo_url || null,
      qty: reorderInfo.get(p.id)?.qty || 1,
      unit_cost: num(p.cost_price), sell_price: num(p.sell_price),
      current_stock: num(p.stock_qty), sort_order: items.length + n,
    }))
    setSaving(true)
    const { error } = await insertStrip('order_analysis_items', records)
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    loadItems(open.id)
    toast.success(`Added ${records.length} product${records.length > 1 ? 's' : ''} at the suggested quantity`)
  }

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

  // Start an analysis pre-loaded with everything the shelves say needs restocking
  async function startRestockAnalysis() {
    if (!recommendations.length) return
    setSaving(true)
    const { data, error } = await insertStrip('order_analyses', {
      name: `Restock — ${localToday()}`, status: 'draft', target_margin: 40, extra_costs: [],
      notes: `Products that hit their reorder point — quantities cover the ${LEAD_DAYS}-day wait plus ${COVER_DAYS} days after arrival.`,
    }, true)
    if (error || !data?.[0]) { setSaving(false); toast.error('Failed: ' + (error?.message || '')); return }
    const analysis = data[0]
    const { error: itemErr } = await insertStrip('order_analysis_items', recommendations.map((r, n) => ({
      analysis_id: analysis.id, source: 'inventory', product_id: r.product.id,
      product_name: r.product.name, sku: r.product.sku || null, category: r.product.category || null,
      brand: r.product.brand || null, image_url: r.product.photo_url || null,
      qty: r.qty, unit_cost: num(r.product.cost_price), sell_price: num(r.product.sell_price),
      current_stock: num(r.product.stock_qty), sort_order: n,
    })))
    setSaving(false)
    if (itemErr) { toast.error('Failed: ' + itemErr.message); return }
    setAnalyses(prev => [analysis, ...prev])
    setOpenId(analysis.id)
    toast.success(`Analysing ${recommendations.length} restocks`)
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
    setSelected(prev => { const n = new Set(prev); n.delete(it.id); return n })
    const { error } = await supabase.from('order_analysis_items').delete().eq('id', it.id)
    if (error) { toast.error('Failed: ' + error.message); loadItems(open.id) }
  }

  // Bulk delete — used by the tick boxes and by "clear this order"
  async function removeIds(ids, label) {
    if (!ids.length) return
    if (!window.confirm(`Remove ${ids.length} product${ids.length > 1 ? 's' : ''}${label ? ` from ${label}` : ''}?\n\nPlanning only — nothing in accounting or inventory changes.`)) return
    const set = new Set(ids)
    setItems(prev => prev.filter(i => !set.has(i.id)))
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n })
    const { error } = await supabase.from('order_analysis_items').delete().in('id', ids)
    if (error) { toast.error('Failed: ' + error.message); loadItems(open.id); return }
    toast.success(`Removed ${ids.length} product${ids.length > 1 ? 's' : ''}`)
  }

  async function clearItems() {
    if (!items.length) return
    if (!window.confirm(`Remove all ${items.length} products from this analysis?`)) return
    await supabase.from('order_analysis_items').delete().eq('analysis_id', open.id)
    setItems([])
    setSelected(new Set())
    toast.success('Cleared')
  }

  const toggleSelect = id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleSelectMany = ids => setSelected(prev => {
    const n = new Set(prev)
    ids.every(id => n.has(id)) ? ids.forEach(id => n.delete(id)) : ids.forEach(id => n.add(id))
    return n
  })

  function openPicker(kind, opts = {}) {
    setPickModal(kind)
    setPickSearch('')
    // Start on "all" — an analysis can span several vendors, and the tabs keep
    // the list organised without hiding anything.
    setPickVendor('all')
    setPickNeeds(!!opts.needsOnly)
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
        // Start at the suggested reorder quantity when we know it needs restocking
        qty: reorderInfo.get(p.id)?.qty || 1,
        unit_cost: num(p.cost_price), sell_price: num(p.sell_price),
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
    const plural = groups.length > 1
    const msg = `Create ${groups.length} batch order${plural ? 's' : ''} — ${mv0(totals.landed)} in total?\n\n`
      + groups.map((g, i) => `  ${i + 1}. ${g.label} — ${g.totals.lines} product${g.totals.lines > 1 ? 's' : ''}, ${mv0(g.totals.landed)}`).join('\n')
      + `\n\nThis moves ${plural ? 'them' : 'it'} into Batch Orders where ${plural ? 'they count' : 'it counts'} towards accounting.${warn ? `\n\n⚠️ ${warn}` : ''}`
    if (!window.confirm(msg)) return

    setSaving(true)
    // Next human-readable batch number, matching the Batch Orders page
    const { data: existing } = await supabase.from('purchase_orders').select('batch_no')
    let max = 1000
    ;(existing || []).forEach(p => { const m = /(\d+)/.exec(p.batch_no || ''); if (m) max = Math.max(max, parseInt(m[1], 10)) })
    const orderDate = localToday()
    const paidCosts = extras.filter(c => num(c.amount) > 0)

    // Each vendor becomes its own batch order — separate batch number, separate
    // invoice, arrives on its own.
    const batchIds = [], batchNos = []
    for (const g of groups) {
      const batchId = (window.crypto?.randomUUID?.() || `b${Date.now()}${Math.random().toString(36).slice(2, 8)}`)
      max += 1
      const batchNo = `PO-${max}`
      const stamp = { supplier_id: g.supplierId || null, supplier_name: g.label === 'No vendor' ? '' : g.label, status: 'pending', order_date: orderDate, batch_id: batchId, batch_no: batchNo }

      const records = g.rows.map(r => ({
        ...stamp,
        product_id: r.product_id || null,
        product_name: r.product_name,
        qty: r.qty,
        unit_cost: r.unitCost,
        image_url: r.image_url || null,
        notes: `From analysis "${open.name}" — planned sell ${mv(r.sell)} · margin ${pct(r.margin)}`,
      }))
      // A cost tagged to this vendor goes here whole; a shared cost is split
      // between the orders by their share of the goods.
      const costRecords = paidCosts
        .filter(c => !c.supplier_id || c.supplier_id === g.supplierId)
        .map(c => {
          const shared = !c.supplier_id
          const share = shared && totals.goods > 0 ? g.totals.goods / totals.goods : 1
          const amount = num(c.amount) * (shared ? share : 1)
          if (amount <= 0) return null
          return {
            ...stamp,
            product_id: null,
            product_name: (c.type === 'Other' ? (c.label || 'Other cost') : c.type) + (shared && groups.length > 1 ? ' (share)' : ''),
            qty: 1,
            unit_cost: +amount.toFixed(2),
            cost_type: 'extra',
          }
        }).filter(Boolean)

      const { error } = await insertStrip('purchase_orders', [...records, ...costRecords])
      if (error) { setSaving(false); toast.error(`Failed on ${g.label}: ${error.message}`); return }
      batchIds.push(batchId); batchNos.push(batchNo)
      logAudit('create', 'purchase_order', `${batchNo} — ${g.label} from analysis "${open.name}" (${g.rows.length} items)`, { total: g.totals.landed })
    }

    const patch = {
      status: 'converted', batch_id: batchIds.join(','), batch_no: batchNos.join(', '),
      converted_at: new Date().toISOString(),
    }
    await supabase.from('order_analyses').update(patch).eq('id', open.id)
    setAnalyses(prev => prev.map(a => (a.id === open.id ? { ...a, ...patch } : a)))
    setSaving(false)
    toast.success(`${batchNos.length} batch order${batchNos.length > 1 ? 's' : ''} created — ${batchNos.join(', ')}`)
  }

  // ── Excel ───────────────────────────────────────────────────────────────────
  function exportExcel() {
    if (!rows.length) { toast.error('Nothing to export'); return }
    const sheet = rows.map(r => ({
      'Vendor': r.vendorName,
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
      'Vendor': 'TOTAL', 'Order qty': totals.qty, 'Line cost': +totals.goods.toFixed(2),
      'Share of extra costs': +totals.extras.toFixed(2), 'Total landed cost': +totals.landed.toFixed(2),
      'Revenue if all sold': +totals.revenue.toFixed(2), 'Total profit': +totals.profit.toFixed(2),
      'Margin %': +totals.margin.toFixed(1), 'ROI %': +totals.roi.toFixed(1),
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Analysis')
    // One row per order so the vendor split is readable at a glance
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      ...groups.map((g, i) => ({
        'Order': i + 1, 'Vendor': g.label, 'Products': g.totals.lines, 'Units': g.totals.qty,
        'Goods cost': +g.totals.goods.toFixed(2), 'Extra costs': +g.totals.extras.toFixed(2),
        'Total cost': +g.totals.landed.toFixed(2), 'If sold all': +g.totals.revenue.toFixed(2),
        'Total profit': +g.totals.profit.toFixed(2), 'Margin %': +g.totals.margin.toFixed(1), 'ROI %': +g.totals.roi.toFixed(1),
      })),
      {
        'Order': '', 'Vendor': 'ALL ORDERS', 'Products': totals.lines, 'Units': totals.qty,
        'Goods cost': +totals.goods.toFixed(2), 'Extra costs': +totals.extras.toFixed(2),
        'Total cost': +totals.landed.toFixed(2), 'If sold all': +totals.revenue.toFixed(2),
        'Total profit': +totals.profit.toFixed(2), 'Margin %': +totals.margin.toFixed(1), 'ROI %': +totals.roi.toFixed(1),
      },
    ]), 'Orders')
    if (extras.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        extras.map(c => ({
          'Cost': c.type === 'Other' ? c.label : c.type,
          'Applies to': c.supplier_id ? (groups.find(g => g.supplierId === c.supplier_id)?.label || 'Vendor') : 'Shared — all orders',
          'Amount': num(c.amount),
        }))
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
    const alreadyIn = new Set(items.map(i => i.supplier_product_id || i.product_id).filter(Boolean))

    // ── Picker: filtered, then grouped under the vendor each product comes from ──
    const vendorNameOf = x => (pickModal === 'catalog'
      ? (x.supplier_name || suppliers.find(s => s.id === x.supplier_id)?.name)
      : suppliers.find(s => s.id === x.supplier_id)?.name) || 'No vendor'
    const pickSource = pickModal === 'catalog' ? catalog : products.filter(p => !p.discontinued)
    const matchesSearch = x => {
      const q = pickSearch.toLowerCase().trim()
      if (!q) return true
      const name = pickModal === 'catalog' ? x.product_name : x.name
      return name?.toLowerCase().includes(q) || x.sku?.toLowerCase().includes(q) || x.category?.toLowerCase().includes(q)
    }
    const matchesNeeds = x => !pickNeeds || (pickModal === 'inventory' && reorderInfo.has(x.id))
    const searched = pickSource.filter(x => matchesSearch(x) && matchesNeeds(x))
    // Vendor tabs are counted off the searched set so the numbers reflect the search
    const vendorTabs = suppliers
      .map(s => ({ id: s.id, name: s.name, count: searched.filter(x => x.supplier_id === s.id).length }))
      .filter(v => v.count > 0)
      .sort((a, b) => b.count - a.count)
    const looseCount = searched.filter(x => !x.supplier_id || !suppliers.some(s => s.id === x.supplier_id)).length
    const pickFiltered = searched.filter(x => pickVendor === 'all' || x.supplier_id === pickVendor)
    const pickGroups = Object.values(
      pickFiltered.reduce((acc, x) => {
        const key = x.supplier_id || 'none'
        if (!acc[key]) acc[key] = { key, label: vendorNameOf(x), items: [] }
        acc[key].items.push(x)
        return acc
      }, {})
    ).sort((a, b) => {
      // This analysis's own vendor sits at the top, unassigned products at the bottom
      if (a.key === open.supplier_id) return -1
      if (b.key === open.supplier_id) return 1
      if (a.key === 'none') return 1
      if (b.key === 'none') return -1
      return a.label.localeCompare(b.label)
    })
    pickGroups.forEach(g => g.items.sort((a, b) =>
      (pickModal === 'catalog' ? a.product_name : a.name || '').localeCompare(pickModal === 'catalog' ? b.product_name : b.name || '')))
    const needsCount = products.filter(p => !p.discontinued && reorderInfo.has(p.id) && !alreadyIn.has(p.id)).length
    const selectableIn = g => g.items.filter(x => !alreadyIn.has(x.id)).map(x => x.id)

    return (
      <div>
        <Toasts toasts={toast.toasts} />
        <button onClick={() => setOpenId(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 13, fontFamily: 'inherit', padding: 0, marginBottom: 14 }}>
          <ArrowLeft size={15} /> All analyses
        </button>

        <PageHeader
          title={open.name}
          subtitle={`${groups.length} vendor${groups.length === 1 ? '' : 's'} · ${rows.length} product${rows.length === 1 ? '' : 's'} · ${converted ? `ordered as ${open.batch_no}` : 'draft — nothing has been ordered'}`}
          action={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={exportExcel}><FileSpreadsheet size={14} /> Excel</Button>
              <Button variant="ghost" onClick={() => duplicateAnalysis(open)}><Copy size={14} /> Duplicate</Button>
              <Button variant="danger" onClick={() => deleteAnalysis(open)}><Trash2 size={14} /> Delete</Button>
              {!converted && (
                <Button onClick={createBatchOrder} disabled={saving || !rows.length}>
                  <Truck size={14} /> Create {groups.length > 1 ? `${groups.length} batch orders` : 'batch order'}
                </Button>
              )}
            </div>
          }
        />

        {converted && (
          <Card style={{ marginBottom: 18, background: '#f2faf5', border: '1px solid #cfe8db', display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle size={17} color="#1D9E75" />
            <span style={{ fontSize: 13, color: '#2c7a54' }}>
              This analysis became batch order{(open.batch_no || '').includes(',') ? 's' : ''} <b>{open.batch_no}</b>. Track and receive {(open.batch_no || '').includes(',') ? 'them' : 'it'} from the Batch Orders page — editing here no longer changes the order.
            </span>
          </Card>
        )}

        {/* Headline numbers */}
        <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
          {[
            { label: 'Total cost', value: mv0(totals.landed), sub: `${mv0(totals.goods)} goods + ${mv0(totals.extras)} extra costs`, color: '#0d1b2a' },
            { label: 'If sold all', value: mv0(totals.revenue), sub: `${totals.qty} units across ${groups.length} order${groups.length === 1 ? '' : 's'}`, color: '#378ADD' },
            { label: 'Total profit', value: mv0(totals.profit), sub: `${totals.lines} product${totals.lines === 1 ? '' : 's'}`, color: totals.profit >= 0 ? '#1D9E75' : '#E24B4A' },
            { label: 'Total margin', value: pct(totals.margin), sub: `${pct(totals.roi)} return · target ${target}%`, color: totals.margin >= target ? '#1D9E75' : totals.margin >= 0 ? '#e6940a' : '#E24B4A' },
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
              <Select label="Default vendor" value={open.supplier_id || ''}
                onChange={e => {
                  const s = suppliers.find(x => x.id === e.target.value)
                  patchAnalysis({ supplier_id: e.target.value || null, supplier_name: s?.name || '' })
                }}
                options={[{ value: '', label: '— None —' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]} />
              <div style={{ fontSize: 11, color: '#bbb', marginTop: -4, lineHeight: 1.5 }}>
                Only used for products with no vendor of their own — every product keeps its own supplier and gets its own order.
              </div>
              <Input label="Target margin %" type="number" defaultValue={target}
                onBlur={e => patchAnalysis({ target_margin: num(e.target.value) || 40 })} />
              <Input label="Notes" defaultValue={open.notes || ''} placeholder="Why this order, what to watch…"
                onBlur={e => patchAnalysis({ notes: e.target.value })} />
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0d1b2a' }}>Extra costs</div>
                <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 2 }}>Shipping, duty and fees — tag one to a vendor, or leave it shared across every order</div>
              </div>
              <Button size="sm" variant="ghost" onClick={addExtra}><Plus size={13} /> Add</Button>
            </div>
            {extras.length === 0 && <div style={{ fontSize: 12.5, color: '#bbb', padding: '8px 0' }}>No extra costs yet — landed cost equals the supplier price.</div>}
            {extras.map((c, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <select value={c.type} onChange={e => updateExtra(idx, 'type', e.target.value)}
                  style={{ flex: '1 1 130px', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }}>
                  {COST_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                {c.type === 'Other' && (
                  <input value={c.label || ''} onChange={e => updateExtra(idx, 'label', e.target.value)} placeholder="What is it?"
                    style={{ flex: '1 1 110px', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit' }} />
                )}
                <select value={c.supplier_id || ''} onChange={e => updateExtra(idx, 'supplier_id', e.target.value || null)}
                  title="Which order does this cost belong to?"
                  style={{ flex: '1 1 130px', padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: c.supplier_id ? '#0d1b2a' : '#999' }}>
                  <option value="">Shared — all orders</option>
                  {groups.map(g => <option key={g.key} value={g.supplierId || ''} disabled={!g.supplierId}>{g.label}</option>)}
                </select>
                <input type="number" value={c.amount} onChange={e => updateExtra(idx, 'amount', e.target.value)} placeholder="MVR"
                  style={{ width: 100, padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit' }} />
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

        {/* Suggested restocks — what your own shelves say you should be buying */}
        {!converted && recommendations.length > 0 && (
          <Card style={{ marginBottom: 18, background: '#fffdf8', border: '1px solid #f4e7cd' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0d1b2a', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} color="#e6940a" /> {recommendations.length} product{recommendations.length > 1 ? 's' : ''} you should probably reorder
                </div>
                <div style={{ fontSize: 11.5, color: '#a9a094', marginTop: 3 }}>
                  Out of stock, past the reorder point, or running low — quantities cover the {LEAD_DAYS}-day wait plus {COVER_DAYS} days after arrival.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="ghost" onClick={() => openPicker('inventory', { needsOnly: true })}>Browse all</Button>
                <Button size="sm" onClick={() => addProducts(recommendations.slice(0, 12).map(r => r.product))} disabled={saving}>
                  <Plus size={13} /> Add {Math.min(recommendations.length, 12)}
                </Button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {recommendations.slice(0, 10).map(r => (
                <button key={r.product.id} onClick={() => addProducts([r.product])} disabled={saving}
                  title={`${r.stock} in stock · sells ${r.perMonth.toFixed(1)}/month · suggest ordering ${r.qty}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px 7px 8px', borderRadius: 99, border: '1px solid #f0e4cd', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', overflow: 'hidden', background: '#f7f5f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {r.product.photo_url
                      ? <img src={r.product.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <Package size={11} color="#d5cfc6" />}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#0d1b2a', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product.name}</span>
                  <Badge color={NEED[r.urgency].color}>{r.urgency === 'out' ? 'Out' : r.urgency === 'now' ? 'Order now' : 'Low'}</Badge>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#FFA500' }}>+{r.qty}</span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* Products — one order per vendor */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>
              {groups.length > 1 ? `${groups.length} orders in this analysis` : 'Products under consideration'}
            </div>
            {groups.length > 1 && (
              <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 2 }}>Each vendor becomes its own batch order when you confirm</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button size="sm" variant="ghost" onClick={() => openPicker('catalog')}><BookOpen size={13} /> From supplier catalog</Button>
            <Button size="sm" variant="ghost" onClick={() => openPicker('inventory')}><Package size={13} /> From inventory</Button>
            {items.length > 0 && <Button size="sm" variant="danger" onClick={clearItems}><Trash2 size={13} /> Clear all</Button>}
          </div>
        </div>

        {/* Selection bar — appears once anything is ticked */}
        {selected.size > 0 && !converted && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#854F0B' }}>{selected.size} selected</span>
            <Button size="sm" variant="danger" onClick={() => removeIds([...selected])}>
              <Trash2 size={13} /> Delete selected
            </Button>
            <button onClick={() => setSelected(new Set())}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 12, fontFamily: 'inherit' }}>Clear selection</button>
          </div>
        )}

        {itemsLoading ? <Spinner /> : rows.length === 0 ? (
          <Card style={{ padding: '48px 20px', textAlign: 'center', color: '#bbb' }}>
            <Calculator size={30} color="#e0dcd4" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 13.5 }}>Nothing to analyse yet.</div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>Pull products in from the supplier catalog, or add ones you already stock.</div>
          </Card>
        ) : groups.map((g, gi) => (
          <Card key={g.key} style={{ padding: 0, overflow: 'hidden', marginBottom: 14 }}>
            {/* Order header — vendor and what this one order costs and returns */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '13px 18px', background: '#fbfaf8', borderBottom: '1px solid #f0ece6', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: '#0d1b2a', color: '#FFA500', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{gi + 1}</span>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#0d1b2a', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Building2 size={14} color="#c4bcb0" /> {g.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                    Order {gi + 1} of {groups.length} · {g.totals.lines} product{g.totals.lines === 1 ? '' : 's'} · {g.totals.qty} units
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                {[
                  ['Cost', mv0(g.totals.landed), '#0d1b2a'],
                  ['If sold all', mv0(g.totals.revenue), '#378ADD'],
                  ['Profit', mv0(g.totals.profit), g.totals.profit >= 0 ? '#1D9E75' : '#E24B4A'],
                  ['Margin', pct(g.totals.margin), g.totals.margin >= target ? '#1D9E75' : g.totals.margin >= 0 ? '#e6940a' : '#E24B4A'],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9.5, color: '#c4bcb0', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700 }}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: c, marginTop: 1 }}>{v}</div>
                  </div>
                ))}
                {!converted && (
                  <Button size="sm" variant="danger" title={`Remove every product in the ${g.label} order`}
                    onClick={() => removeIds(g.rows.map(r => r.id), `the ${g.label} order`)}>
                    <Trash2 size={13} /> Clear order
                  </Button>
                )}
              </div>
            </div>

            <div className="x-scroll-wrap">
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 1180 }}>
                <thead>
                  <tr style={{ background: '#fff' }}>
                    {!converted && (
                      <th style={{ padding: '10px 0 10px 14px', width: 30, borderBottom: '1px solid #f2f2f2' }}>
                        <input type="checkbox" title={`Select every product from ${g.label}`}
                          checked={g.rows.every(r => selected.has(r.id))}
                          onChange={() => toggleSelectMany(g.rows.map(r => r.id))} />
                      </th>
                    )}
                    {['Product', 'Qty', 'Unit cost', 'Landed cost', 'Sell price', 'Profit / unit', 'Margin', 'Total cost', 'Total profit', 'ROI', 'Stock & demand', ''].map((h, i) => (
                      <th key={h + i} style={{ padding: '10px 12px', textAlign: i === 0 || i === 10 ? 'left' : 'right', fontSize: 10.5, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', borderBottom: '1px solid #f2f2f2' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map(r => {
                    const v = VERDICT[r.verdict]
                    const marginColor = r.verdict === 'good' ? '#1D9E75' : r.verdict === 'thin' ? '#e6940a' : r.verdict === 'loss' ? '#E24B4A' : '#aaa'
                    const cell = { padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', borderTop: '1px solid #f5f5f5' }
                    const editStyle = { width: 82, padding: '6px 8px', border: '1px solid #e6e2da', borderRadius: 7, fontSize: 12.5, fontFamily: 'inherit', textAlign: 'right' }
                    const ticked = selected.has(r.id)
                    return (
                      <tr key={r.id} style={ticked ? { background: '#fffaf0' } : undefined}>
                        {!converted && (
                          <td style={{ ...cell, textAlign: 'center', padding: '10px 0 10px 14px' }}>
                            <input type="checkbox" checked={ticked} onChange={() => toggleSelect(r.id)} />
                          </td>
                        )}
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
                    {!converted && <td style={{ borderTop: '2px solid #f0ece6' }} />}
                    <td style={{ padding: '12px', borderTop: '2px solid #f0ece6' }}>{g.label} total</td>
                    <td style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6' }}>{g.totals.qty}</td>
                    <td colSpan={2} style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6', color: '#aaa', fontWeight: 500, fontSize: 11.5 }}>
                      incl. {mv0(g.totals.extras)} extra costs
                    </td>
                    <td colSpan={3} style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6', color: g.totals.margin >= target ? '#1D9E75' : '#e6940a' }}>
                      {pct(g.totals.margin)} margin
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6' }}>{mv0(g.totals.landed)}</td>
                    <td style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6', color: g.totals.profit >= 0 ? '#1D9E75' : '#E24B4A' }}>{mv0(g.totals.profit)}</td>
                    <td colSpan={3} style={{ padding: '12px', textAlign: 'right', borderTop: '2px solid #f0ece6', color: g.totals.roi >= 0 ? '#1D9E75' : '#E24B4A' }}>{pct(g.totals.roi)} ROI</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        ))}

        {/* Everything added up, across every order in this analysis */}
        {groups.length > 1 && (
          <Card style={{ background: '#0d1b2a', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.2px' }}>All {groups.length} orders together</div>
              <div style={{ fontSize: 11.5, color: '#8fa0b0', marginTop: 3 }}>
                {totals.lines} products · {totals.qty} units · {mv0(totals.goods)} goods + {mv0(totals.extras)} extra costs
              </div>
            </div>
            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
              {[
                ['Total cost', mv0(totals.landed), '#fff'],
                ['If sold all', mv0(totals.revenue), '#7ab8f5'],
                ['Total profit', mv0(totals.profit), totals.profit >= 0 ? '#4fd39d' : '#ff8a87'],
                ['Total margin', pct(totals.margin), totals.margin >= target ? '#4fd39d' : '#ffc266'],
              ].map(([l, v, c]) => (
                <div key={l} style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9.5, color: '#7a8b9b', textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 700 }}>{l}</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: c, marginTop: 2, letterSpacing: '-0.5px' }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

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
            {/* Vendor tabs — products are listed under the vendor they come from */}
            <div className="x-scroll" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => setPickVendor('all')} style={chipStyle(pickVendor === 'all')}>
                All vendors <span style={{ opacity: 0.65 }}>{searched.length}</span>
              </button>
              {vendorTabs.map(v => (
                <button key={v.id} onClick={() => setPickVendor(v.id)} style={chipStyle(pickVendor === v.id)}>
                  {v.name} <span style={{ opacity: 0.65 }}>{v.count}</span>
                </button>
              ))}
              {looseCount > 0 && (
                <button onClick={() => setPickVendor('none')} style={chipStyle(pickVendor === 'none')}>
                  No vendor <span style={{ opacity: 0.65 }}>{looseCount}</span>
                </button>
              )}
              {pickModal === 'inventory' && (
                <button onClick={() => setPickNeeds(n => !n)}
                  style={{ ...chipStyle(pickNeeds), marginLeft: 'auto', background: pickNeeds ? '#E24B4A' : '#fff', borderColor: pickNeeds ? '#E24B4A' : '#f0d9d7', color: pickNeeds ? '#fff' : '#c0392b' }}>
                  <AlertTriangle size={11} style={{ verticalAlign: -1 }} /> Needs reordering {needsCount > 0 && <span style={{ opacity: 0.8 }}>{needsCount}</span>}
                </button>
              )}
            </div>

            <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 10 }}>
              {pickGroups.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#bbb', fontSize: 13 }}>Nothing found.</div>}
              {pickGroups.map(g => {
                const ids = selectableIn(g)
                const allOn = ids.length > 0 && ids.every(id => picked.has(id))
                return (
                  <div key={g.key}>
                    <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 12px', background: '#f8f7f4', borderBottom: '1px solid #f0ece6' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, color: '#8a8378', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                        <Building2 size={12} color="#c4bcb0" /> {g.label}
                        <span style={{ color: '#c4bcb0', fontWeight: 600 }}>({g.items.length})</span>
                      </span>
                      {ids.length > 0 && (
                        <button onClick={() => setPicked(prev => {
                          const n = new Set(prev)
                          allOn ? ids.forEach(id => n.delete(id)) : ids.forEach(id => n.add(id))
                          return n
                        })}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#FFA500', fontFamily: 'inherit', padding: 0 }}>
                          {allOn ? 'Clear' : 'Select all'}
                        </button>
                      )}
                    </div>
                    {g.items.map(x => {
                      const id = x.id
                      const name = pickModal === 'catalog' ? x.product_name : x.name
                      const img = pickModal === 'catalog' ? x.image_url : x.photo_url
                      const cost = num(x.cost_price), sell = num(x.sell_price)
                      const inAlready = alreadyIn.has(id)
                      const on = picked.has(id)
                      const need = pickModal === 'inventory' ? reorderInfo.get(id) : null
                      return (
                        <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderBottom: '1px solid #f7f7f7', cursor: inAlready ? 'default' : 'pointer', opacity: inAlready ? 0.45 : 1, background: on ? '#fffaf0' : '#fff' }}>
                          <input type="checkbox" checked={on} disabled={inAlready}
                            onChange={() => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} />
                          <div style={{ width: 34, height: 34, borderRadius: 7, background: '#f7f5f2', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                            {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <Package size={14} color="#d5cfc6" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {name}
                              {need && <Badge color={NEED[need.urgency].color}>{NEED[need.urgency].label}</Badge>}
                            </div>
                            <div style={{ fontSize: 11, color: '#bbb' }}>
                              {[x.sku, x.category, pickModal === 'inventory' ? `${num(x.stock_qty)} in stock` : null].filter(Boolean).join(' · ')}
                              {need ? ` · suggest +${need.qty}` : ''}
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

      {recommendations.length > 0 && (
        <Card style={{ marginBottom: 20, background: '#fffdf8', border: '1px solid #f4e7cd', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <AlertTriangle size={17} color="#e6940a" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>
                {recommendations.length} product{recommendations.length > 1 ? 's need' : ' needs'} reordering
              </div>
              <div style={{ fontSize: 12, color: '#a9a094', marginTop: 3 }}>
                {[['out', 'out of stock'], ['now', 'past the reorder point'], ['low', 'running low']]
                  .map(([k, label]) => { const n = recommendations.filter(r => r.urgency === k).length; return n ? `${n} ${label}` : null })
                  .filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
          <Button onClick={startRestockAnalysis} disabled={saving}>
            <Calculator size={14} /> Analyse the restock
          </Button>
        </Card>
      )}

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
            {a.supplier_name ? `${a.supplier_name} · ` : ''}{(a.created_at || '').slice(0, 10)}
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
