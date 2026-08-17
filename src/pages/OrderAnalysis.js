import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { localDaysAgo, localToday } from '../lib/dates'
import { logAudit } from '../lib/audit'
import { groupAdjacent, familyRuns, familyOf, sizeOf } from '../lib/variants'
import { PageHeader, Card, Button, Input, Select, Modal, Spinner, useToast, Toasts, Badge, ImageTile } from '../components/UI'
import {
  Plus, Trash2, Calculator, Search, Package, BookOpen, TrendingUp, TrendingDown,
  ArrowLeft, Truck, FileSpreadsheet, FileText, AlertTriangle, CheckCircle, Copy, Percent, X, Building2, Layers
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { getSettings } from '../lib/settings'

// What the supplier must do once payment lands, and who carries the loss when it
// goes wrong — spelled out on the order sheet so there is nothing to argue about
// after the goods have shipped.
const ORDER_STEPS = [
  { title: 'Arrange the order and add an extra outer box', body: [
    'Arrange the order with the factory, then tell the factory to add an extra cardboard box around the goods for damage control.',
    'You do not need to send a picture of the extra box — as long as it is there, that is fine.',
  ] },
  { title: 'Send pictures of ALL products and wait for approval', body: [
    'Once you are at the factory, photograph every product and send the pictures to me.',
    'Wait for my approval before going any further.',
    'If I do not approve a product, try to find the correct version. If that is not possible, refund the amount or buy other products for the amount I sent.',
  ] },
  { title: 'Pack everything and send proof', body: [
    'After all products are finalised, pack everything inside one box measuring 1m x 1m x 0.5m.',
    'Send three pictures: inside the box, outside the box, and the label written large on the outside of the box.',
  ] },
]

const ORDER_RESPONSIBILITY = [
  'If these steps are not followed, the supplier is responsible. That includes a short or wrong product count, and any substitute sent in place of the product that was approved. In those cases the supplier must refund or replace the goods at their own cost.',
  'Once these steps have been followed and the products have been approved, responsibility for anything that arises after that point is mine. Thank you for understanding!',
]

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
  // Within a vendor, the sizes of one product sit together — you cannot judge
  // how many 1:18s to buy without seeing what the 1:24 is doing beside it.
  groups.forEach(g => {
    g.rows = groupAdjacent(g.rows)
    g.runs = familyRuns(g.rows)
    g.totals = sum(g.rows)
  })
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
  const [newForm, setNewForm] = useState({ name: '', supplier_id: '', supplier_name: '', target_margin: 40, usd_rate: getSettings().usdRate || 15.42 })
  const [pickModal, setPickModal] = useState(null) // 'catalog' | 'inventory'
  const [pickSearch, setPickSearch] = useState('')
  const [pickVendor, setPickVendor] = useState('all')
  const [pickNeeds, setPickNeeds] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())   // analysis lines ticked for deletion
  const [allItems, setAllItems] = useState([])                // every line, across all analyses
  const toast = useToast()

  const open = analyses.find(a => a.id === openId) || null

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (openId) { localStorage.setItem('bnj_open_analysis', openId); loadItems(openId) }
    else { localStorage.removeItem('bnj_open_analysis'); setItems([]) }
  }, [openId])

  async function load() {
    setLoading(true)
    const [a, s, c, p, o, ai] = await Promise.all([
      supabase.from('order_analyses').select('*').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('supplier_products').select('*').order('product_name'),
      supabase.from('products').select('*').order('name'),
      supabase.from('orders').select('product_id, product_name, qty, status, order_date'),
      // Every line already sitting in some analysis, so a product being thought
      // about isn't also being nagged about — see plannedIds
      supabase.from('order_analysis_items').select('analysis_id, product_id, product_name'),
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
    setAllItems(ai.data || [])
    setLoading(false)
  }

  async function loadItems(id) {
    setItemsLoading(true)
    const { data } = await supabase.from('order_analysis_items').select('*').eq('analysis_id', id).order('sort_order').order('created_at')
    let list = data || []
    // A draft mirrors the supplier catalog's cost: on open, pull the current cost
    // for every catalog-linked line, so a price change in the catalog — however it
    // was made (single edit, bulk import, anything) — shows here. This only ever
    // reads the catalog and writes the analysis; an edit made in the analysis
    // never flows back to the catalog. Planned sell price and quantity are left
    // exactly as they were set. Converted analyses are history and never touched.
    try {
      const { data: aRow } = await supabase.from('order_analyses').select('status, usd_rate').eq('id', id).maybeSingle()
      if (aRow && aRow.status !== 'converted') {
        // This draft's own locked rate (falls back to the Settings rate).
        const draftRate = num(aRow?.usd_rate) || (getSettings().usdRate || 15.42)
        // The rate the catalog's MVR costs are priced at. Dollars = MVR ÷ this.
        const settingsRate = num(getSettings().usdRate) || 15.42
        const ids = [...new Set(list.map(i => i.supplier_product_id).filter(Boolean))]
        if (ids.length) {
          // Pull the dollar cost too so a USD-priced product uses THIS draft's rate,
          // not whatever the catalog's MVR was converted at. Fall back gracefully if
          // the cost_usd column isn't there yet.
          let sps = null
          const r1 = await supabase.from('supplier_products').select('id, cost_price, cost_usd').in('id', ids)
          if (r1.error) sps = (await supabase.from('supplier_products').select('id, cost_price').in('id', ids)).data
          else sps = r1.data
          const costOf = new Map((sps || []).map(s => {
            const recorded = s.cost_usd == null || s.cost_usd === '' ? NaN : Number(s.cost_usd)
            const cp = s.cost_price == null || s.cost_price === '' ? NaN : Number(s.cost_price)
            // Dollars: the recorded figure, else backed out of the Settings rate.
            const usd = isFinite(recorded) ? recorded : (isFinite(cp) && settingsRate > 0 ? cp / settingsRate : NaN)
            // Priced for THIS batch at its own locked rate.
            const target = isFinite(usd) ? Math.round(usd * draftRate * 100) / 100 : (isFinite(cp) ? cp : 0)
            return [s.id, target]
          }))
          const changed = []
          list = list.map(it => {
            if (it.supplier_product_id != null && costOf.has(it.supplier_product_id) && Number(it.unit_cost) !== costOf.get(it.supplier_product_id)) {
              changed.push([it.id, costOf.get(it.supplier_product_id)])
              return { ...it, unit_cost: costOf.get(it.supplier_product_id) }
            }
            return it
          })
          // Persist the reconciled costs (best-effort — display already reflects them).
          changed.forEach(([iid, nc]) => supabase.from('order_analysis_items').update({ unit_cost: nc }).eq('id', iid))
        }
      }
    } catch { /* the reconcile is best-effort; never block showing the analysis */ }
    setItems(list)
    setItemsLoading(false)
  }

  // ── Sales velocity: how fast each product actually moves ────────────────────
  const velocity = useMemo(() => {
    const WINDOW = 60
    const since = localDaysAgo(WINDOW)
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

  // The product's own size — S/M/L, 1:18, 60cm — as opposed to its packed
  // dimensions. Lines added before the column existed have none stored, so it is
  // filled back in from the catalog or inventory record they came from; that way
  // it shows on old analyses without having to re-add anything.
  const sizedItems = useMemo(() => {
    const catById = new Map(catalog.map(c => [c.id, c]))
    const prodById = new Map(products.map(p => [p.id, p]))
    return items.map(i => i.sizes ? i : ({
      ...i,
      sizes: (i.supplier_product_id && catById.get(i.supplier_product_id)?.sizes)
        || (i.product_id && prodById.get(i.product_id)?.sizes) || null,
    }))
  }, [items, catalog, products])

  const { rows, groups, totals } = useMemo(
    () => analyse(sizedItems, open?.extra_costs || [], open?.target_margin ?? 40, velocity, vendorOf),
    [sizedItems, open, velocity, vendorOf]
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

  // Products already being considered in a draft analysis. Once a restock is
  // being worked out there is nothing left to prompt about, so it drops off the
  // "needs reordering" list until that draft is ordered or deleted. Matched by
  // name as well as id, since a line added from a supplier catalog carries no
  // product_id even when we clearly stock the same thing.
  const plannedIds = useMemo(() => {
    const draftIds = new Set(analyses.filter(a => a.status !== 'converted').map(a => a.id))
    // Lines of the analysis being edited come from `items`, which is always
    // current; the others were read once when the page loaded.
    const planned = [
      ...allItems.filter(i => draftIds.has(i.analysis_id) && i.analysis_id !== openId),
      ...(openId && draftIds.has(openId) ? items : []),
    ]
    const ids = new Set(planned.map(i => i.product_id).filter(Boolean))
    const names = new Set(planned.map(i => normName(i.product_name)).filter(Boolean))
    products.forEach(p => { if (names.has(normName(p.name))) ids.add(p.id) })
    return ids
  }, [allItems, analyses, products, items, openId])

  const recommendations = useMemo(() => {
    // The open analysis's own lines may not be in `allItems` yet if they were
    // just added, so exclude those too.
    const inAnalysis = new Set(items.map(i => i.product_id).filter(Boolean))
    return products
      .filter(p => reorderInfo.has(p.id) && !inAnalysis.has(p.id) && !plannedIds.has(p.id))
      .map(p => ({ product: p, ...reorderInfo.get(p.id) }))
      .sort((a, b) => (URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]) || (b.perMonth - a.perMonth))
  }, [products, reorderInfo, items, plannedIds])

  // Pull inventory products straight in at their suggested reorder quantity
  async function addProducts(list) {
    if (!list.length) return
    const records = list.map((p, n) => ({
      analysis_id: open.id, source: 'inventory', product_id: p.id, supplier_product_id: null,
      product_name: p.name, sku: p.sku || null, category: p.category || null, brand: p.brand || null,
      image_url: p.photo_url || null, sizes: p.sizes || null,
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
      usd_rate: num(newForm.usd_rate) || (getSettings().usdRate || 15.42),
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
    const id = open.id
    setAnalyses(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)))
    const { error } = await supabase.from('order_analyses')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { toast.error('Could not save: ' + error.message); return }
    // Changing this batch's dollar rate re-prices its USD-linked lines to the new
    // rate; loadItems recomputes each catalog line from cost_usd × the draft rate.
    if ('usd_rate' in patch) {
      await loadItems(id)
      toast.success(`Batch re-priced at ${num(patch.usd_rate) || getSettings().usdRate} MVR/USD`)
    }
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
      status: 'draft', target_margin: a.target_margin, usd_rate: a.usd_rate, extra_costs: a.extra_costs || [], notes: a.notes,
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
          sizes: c.sizes || inv?.sizes || null,
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
        image_url: p.photo_url || null, sizes: p.sizes || null,
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

  // ── Supplier order sheet ────────────────────────────────────────────────────
  // The sheet to send the supplier: each product's picture, name and quantity as
  // cards plus a matching table, then the steps and who carries the loss when
  // they aren't followed. Laid out as real A4 pages so the header, cards and
  // footer land where they should and every page can carry its number.
  //
  // Produced through the print view, saved as PDF. That is deliberate: building
  // the file directly would mean reading each picture's bytes, and a browser only
  // permits that for images whose host allows it — catalog photos hot-linked from
  // another shop's site came out blank. Printing renders anything the browser can
  // display, so every photo survives.
  function printSupplierOrder() {
    if (!rows.length) { toast.error('Nothing to send'); return }
    const shop = getSettings().businessName || "Brick's & Joy"
    const logo = window.location.origin + '/logo-full.png'
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    const totalUnits = rows.reduce((s, r) => s + num(r.qty), 0)
    const year = new Date().getFullYear()

    // Group by supplier so a multi-vendor analysis still reads as one order each
    const byVendor = {}
    rows.forEach(r => { const k = r.vendorName || 'Products'; (byVendor[k] || (byVendor[k] = [])).push(r) })
    const vendors = Object.keys(byVendor)
    const multi = vendors.length > 1
    // Only give the table a Size column when something actually has one
    const anySize = rows.some(r => r.sizes)

    const cardHtml = r => `
      <div class="card">
        <div class="thumb${r.image_url ? '' : ' empty'}">${r.image_url
          ? `<img src="${esc(r.image_url)}" alt="" />`
          : `<span class="noimg">${esc((r.product_name || '?').slice(0, 1).toUpperCase())}</span>`}</div>
        <div class="cbody">
          <div class="pname">${esc(r.product_name)}</div>
          <div class="qty">×${num(r.qty)}</div>
        </div>
      </div>`

    const vendHead = (v, qty) => `<div class="vend">${esc(v)} <span>${qty} pcs</span></div>`

    const tableHtml = (list, startIdx, showTotal, vTotal) => `
      <table class="tbl">
        <thead><tr><th class="idx">#</th><th>Product</th>${anySize ? '<th class="sz">Size</th>' : ''}<th class="num">Qty</th></tr></thead>
        <tbody>
          ${list.map((r, i) => `<tr><td class="idx">${startIdx + i + 1}</td><td>${esc(r.product_name)}</td>${anySize ? `<td class="sz">${esc(r.sizes || '')}</td>` : ''}<td class="num">${num(r.qty)}</td></tr>`).join('')}
          ${showTotal ? `<tr class="total"><td></td><td>Total${multi ? ' — ' + esc(vTotal.name) : ''}</td>${anySize ? '<td></td>' : ''}<td class="num">${vTotal.qty} pcs</td></tr>` : ''}
        </tbody>
      </table>`

    const stepsHtml = () => `
      <div class="sect">Steps to follow during the order</div>
      <p class="lead">Please follow these steps to avoid any mistakes or confusion later. Begin as soon as my payment reaches you.</p>
      ${ORDER_STEPS.map((s, i) => `
        <div class="step">
          <div class="sno">${i + 1}</div>
          <div class="sbody">
            <div class="stitle">${esc(s.title)}</div>
            ${s.body.map(b => `<p>${esc(b)}</p>`).join('')}
          </div>
        </div>`).join('')}
      <div class="ack">
        <div class="acktitle">Responsibility</div>
        ${ORDER_RESPONSIBILITY.map(p => `<p>${esc(p)}</p>`).join('')}
      </div>`

    // ── Break the content into A4 pages ───────────────────────────────────────
    // Tuned to what an A4 page actually holds: 4 rows of 4 cards, and a table
    // that stops short of the footer so it continues cleanly on the next page.
    const CARDS_PER_PAGE = 16, ROWS_PER_PAGE = 23
    const pages = []
    vendors.forEach(v => {
      const list = byVendor[v]
      const vTotal = { name: v, qty: list.reduce((s, r) => s + num(r.qty), 0) }
      // Pack each page full before starting the next one.
      let ci = 0
      for (let i = 0; i < list.length; i += CARDS_PER_PAGE, ci++) {
        const head = multi && ci === 0 ? vendHead(v, vTotal.qty) : ''
        pages.push({ first: pages.length === 0, vendor: v, html: head + `<div class="grid">${list.slice(i, i + CARDS_PER_PAGE).map(cardHtml).join('')}</div>` })
      }
      for (let i = 0; i < list.length; i += ROWS_PER_PAGE) {
        const last = i + ROWS_PER_PAGE >= list.length
        pages.push({ vendor: v, html: tableHtml(list.slice(i, i + ROWS_PER_PAGE), i, last, vTotal) })
      }
    })
    pages.push({ vendor: null, html: stepsHtml() })

    const totalPages = pages.length
    const bigHead = `
      <div class="head big">
        <img class="logo" src="${logo}" alt="${esc(shop)}" onerror="this.style.display='none';var f=document.getElementById('bnjName');if(f)f.style.display='block'" />
        <div id="bnjName" class="fallback">${esc(shop)}</div>
        <div class="htext">
          <div class="doc">Order request</div>
          <div class="oname">${esc(open.name || 'Order')}</div>
          <div class="osub">${localToday()} · ${rows.length} product${rows.length === 1 ? '' : 's'} · ${totalUnits} pcs</div>
        </div>
      </div>`
    const smallHead = v => `
      <div class="head sm">
        <img class="logo sm" src="${logo}" alt="" onerror="this.style.display='none'" />
        <div class="hsm">${esc(open.name || 'Order')}${v && multi ? ' · ' + esc(v) : ''}</div>
      </div>`

    const body = pages.map((p, i) => `
      <section class="page">
        ${p.first ? bigHead : smallHead(p.vendor)}
        <div class="content">${p.html}</div>
        <div class="foot">
          <span>© ${year} ${esc(shop)}. All rights reserved.</span>
          <span>Page ${i + 1} of ${totalPages}</span>
        </div>
      </section>`).join('')

    // The viewport tag is what makes the phone layout below take effect —
    // without it a mobile browser pretends to be ~980px wide and just shrinks
    // the whole A4 page until it is unreadable.
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Order — ${esc(open.name || shop)}</title>
      <style>
        @page { size: A4; margin: 0; }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:-apple-system,'Segoe UI',Arial,sans-serif; color:#0d1b2a; background:#eceff3;
               -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        .page { width:210mm; min-height:297mm; background:#fff; margin:0 auto 8mm; padding:13mm 14mm 22mm;
                position:relative; page-break-after:always; box-shadow:0 2px 12px rgba(0,0,0,.12); }
        .page:last-child { page-break-after:auto; margin-bottom:0; }

        .head { display:flex; align-items:center; border-bottom:3px solid #FFA500; }
        .head.big { padding-bottom:6mm; margin-bottom:7mm; }
        .logo { width:34mm; height:auto; }
        .fallback { display:none; font-size:20pt; font-weight:800; }
        .htext { margin-left:auto; text-align:right; }
        .doc { font-size:8pt; letter-spacing:2px; text-transform:uppercase; color:#FFA500; font-weight:700; }
        .oname { font-size:16pt; font-weight:800; margin-top:1.5mm; }
        .osub { font-size:9pt; color:#888; margin-top:1.5mm; }
        .head.sm { padding-bottom:3mm; margin-bottom:6mm; border-bottom-width:2px; }
        .logo.sm { width:24mm; }
        .hsm { margin-left:auto; font-size:9pt; color:#888; font-weight:600; }

        .vend { font-size:11pt; font-weight:800; margin-bottom:5mm; display:flex; align-items:center; gap:3mm; }
        .vend span { font-size:8pt; font-weight:700; color:#fff; background:#FFA500; border-radius:99px; padding:1mm 3.5mm; }

        .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:5mm; }
        .card { border:1px solid #e8e8e8; border-radius:3mm; overflow:hidden; page-break-inside:avoid; }
        /* White behind the photo: most product shots are cut out on white, and a
           tinted panel makes those ones look like they have a different background. */
        .thumb { height:30mm; background:#fff; display:flex; align-items:center; justify-content:center; }
        .thumb.empty { background:#f7f5f2; }
        .thumb img { max-width:100%; max-height:100%; object-fit:contain; }
        .noimg { font-size:22pt; font-weight:800; color:#d8d2c8; }
        .cbody { padding:3mm; }
        /* Exactly two lines tall, in mm, so a long name is clipped cleanly at the
           second line instead of leaving a sliver of a third showing. */
        .pname { font-size:8.5pt; font-weight:600; line-height:4mm; height:8mm; overflow:hidden;
                 display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
        .qty { font-size:13pt; font-weight:800; color:#FFA500; margin-top:1mm; }

        .tbl { width:100%; border-collapse:collapse; font-size:10pt; }
        .tbl th { text-align:left; font-size:7.5pt; text-transform:uppercase; letter-spacing:.5px; color:#999;
                  border-bottom:2px solid #eee; padding:2.5mm 3mm; }
        .tbl td { padding:2.6mm 3mm; border-bottom:1px solid #f2f2f2; }
        .tbl .num { text-align:right; font-weight:700; }
        .tbl .sz { width:26mm; color:#8a6a2a; font-weight:600; }
        .tbl .idx { color:#bbb; width:12mm; }
        .tbl tr.total td { border-top:2px solid #ddd; border-bottom:none; font-weight:800; background:#fffaf0; }

        .sect { font-size:15pt; font-weight:800; margin-bottom:3mm; }
        .lead { font-size:10pt; color:#555; margin-bottom:8mm; line-height:1.6; }
        .step { display:flex; gap:5mm; margin-bottom:7mm; page-break-inside:avoid; }
        .sno { flex:0 0 9mm; height:9mm; border-radius:50%; background:#FFA500; color:#fff; font-weight:800;
               font-size:11pt; display:flex; align-items:center; justify-content:center; }
        .stitle { font-size:11pt; font-weight:800; margin-bottom:2mm; }
        .step p { font-size:9.5pt; color:#444; line-height:1.65; margin-bottom:1.5mm; }
        .ack { margin-top:5mm; background:#fffaf0; border:1px solid #f3e2c3; border-radius:2mm; padding:4mm;
        .acktitle { font-weight:800; margin-bottom:2mm; }
        .ack p { margin-bottom:3mm; line-height:1.6; }
               font-size:9pt; color:#8a6a2a; }

        .foot { position:absolute; left:14mm; right:14mm; bottom:9mm; border-top:1px solid #eee;
                padding-top:2.5mm; display:flex; justify-content:space-between; font-size:8pt; color:#999; }

        /* Tapping this is the reliable way to print from a phone. Declared before
           the media query that reveals it, so that rule is the one that wins. */
        .printbar { display:none; position:sticky; top:0; z-index:9; background:#0d1b2a; color:#fff;
                    align-items:center; justify-content:space-between; gap:10px; padding:10px 14px; font-size:13px; }
        .printbar button { background:#FFA500; color:#fff; border:0; border-radius:8px; padding:8px 14px;
                           font-size:13px; font-weight:700; font-family:inherit; }

        /* On a phone the sheet is read before it is printed, so let it use the
           screen's width instead of forcing an A4 page sideways. Screen only —
           printing still lays out as real A4. */
        @media screen and (max-width: 820px) {
          body { background:#fff; }
          .page { width:100%; min-height:0; padding:14px 12px 20px; margin:0 0 10px; box-shadow:none;
                  border-bottom:1px solid #eee; }
          .grid { grid-template-columns:repeat(2,1fr); gap:10px; }
          .logo { width:34mm; } .logo.sm { width:26mm; }
          .foot { position:static; margin-top:14px; }
          .printbar { display:flex; }
        }
        @media print { body { background:#fff; } .page { margin:0; box-shadow:none; } .printbar { display:none !important; } }
      </style></head><body>
      <div class="printbar"><span>Order sheet ready</span><button onclick="window.print()">Print / Save as PDF</button></div>
      ${body}
      <script>
        window.onload = function () {
          var imgs = Array.prototype.slice.call(document.images)
          var pending = imgs.filter(function (i) { return !i.complete }).length
          function go(){ window.focus(); window.print() }
          if (!pending) return go()
          imgs.forEach(function (i) { if (!i.complete) i.onload = i.onerror = function () { if (--pending === 0) go() } })
          setTimeout(go, 6000)
        }
      </script>
      </body></html>`
    // Phones can't print from a hidden frame — iOS and Android only offer print
    // (or Share → Print) for a page you are actually looking at. So open the
    // sheet in its own tab there, with a Print button at the top. This runs
    // straight off the tap, so the pop-up blocker allows it.
    const onPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 820
    if (onPhone) {
      const tab = window.open('', '_blank')
      if (tab) {
        tab.document.write(html); tab.document.close()
        toast.info('Tap "Print / Save as PDF" at the top')
        return
      }
      // Pop-up refused — fall through to the frame and hope the browser obliges
    }

    // On a desktop the frame is smoother: the print dialog opens straight away
    // with no extra tab to close. Kept full page size and merely parked
    // off-screen, so it lays out exactly as it will print.
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed; left:-10000px; top:0; width:210mm; height:297mm; border:0;'
    document.body.appendChild(frame)
    const drop = () => { if (frame.parentNode) frame.remove() }
    frame.contentWindow.onafterprint = () => setTimeout(drop, 500)
    setTimeout(drop, 120000)   // never leave it behind if printing is dismissed
    const doc = frame.contentWindow.document
    doc.open(); doc.write(html); doc.close()
    toast.info('Opening the print view — choose "Save as PDF" as the destination')
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <Spinner />

  // ---------- Detail view ----------
  if (open) {
    const converted = open.status === 'converted'
    const target = num(open.target_margin) || 40
    const batchRate = num(open.usd_rate) || (getSettings().usdRate || 15.42)
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
        {/* Products under consideration is sized here rather than inline, because
            the two screens want opposite things. A phone has no room to spare, so
            it keeps the compact original. A desktop has room but the table is read
            a row at a time — so it gets tall rows and a large photo while the type
            stays small, which is easier to read down a column than big text is. */}
        <style>{`
          .oa-table { font-size: 12.5px; min-width: 1180px; }
          .oa-table th { padding: 10px 12px; font-size: 10.5px; }
          .oa-table td { padding: 10px 12px; }
          .oa-table tfoot td { padding: 12px; }
          .oa-name { font-size: 12.5px; }
          .oa-sub { font-size: 11px; margin-top: 2px; }
          .oa-tiny { font-size: 10px; }
          .oa-demand { font-size: 11.5px; min-width: 190px; line-height: 1.45; }
          .oa-img { width: 38px; height: 38px; border-radius: 8px; }
          .oa-in { width: 82px; padding: 6px 8px; font-size: 12.5px; }
          .oa-in-qty { width: 62px; }
          .oa-check { width: 13px; height: 13px; }
          .oa-vendor { font-size: 13.5px; }
          .oa-vendor-sub { font-size: 11px; }
          .oa-no { width: 26px; height: 26px; font-size: 11px; }
          .oa-kpi-l { font-size: 9.5px; }
          .oa-kpi-v { font-size: 14px; }
          .oa-cellpad { gap: 10px; }
          /* Sizes of one product. The heading names the family once; each row
             then leads with its own size rather than repeating the whole name. */
          .oa-family { font-size: 10px; font-weight: 800; color: #b8740a; text-transform: uppercase;
            letter-spacing: 0.5px; display: flex; align-items: center; gap: 4px; margin-bottom: 3px; }
          .oa-size { display: inline-block; background: #FFF3DB; color: #8a5a00; border: 1px solid #f3e0bb;
            border-radius: 6px; padding: 1px 7px; font-size: 11px; font-weight: 800; white-space: nowrap; }

          @media (min-width: 769px) {
            .oa-table { font-size: 13px; min-width: 1260px; }
            .oa-table th { padding: 12px 14px; font-size: 10.5px; }
            /* The row height is the change that does the work — it gives every
               product its own band to be read in, without enlarging the type. */
            .oa-table td { padding: 24px 14px; }
            /* The totals line is a summary, not a row to be read — it stays tight */
            .oa-table tfoot td { padding: 14px; }
            .oa-name { font-size: 13.5px; }
            .oa-sub { font-size: 11px; margin-top: 4px; }
            .oa-tiny { font-size: 10px; }
            .oa-demand { font-size: 11.5px; min-width: 210px; line-height: 1.6; }
            .oa-img { width: 84px; height: 84px; border-radius: 11px; }
            .oa-in { width: 92px; padding: 9px 10px; font-size: 13px; }
            .oa-in-qty { width: 72px; }
            .oa-check { width: 16px; height: 16px; }
            .oa-vendor { font-size: 15px; }
            .oa-vendor-sub { font-size: 12px; }
            .oa-no { width: 30px; height: 30px; font-size: 12px; }
            .oa-kpi-l { font-size: 10px; }
            .oa-kpi-v { font-size: 16px; }
            .oa-cellpad { gap: 14px; }
            .oa-family { font-size: 10.5px; margin-bottom: 5px; }
            .oa-size { font-size: 12px; padding: 2px 9px; }
          }
        `}</style>
        <Toasts toasts={toast.toasts} />
        <button onClick={() => setOpenId(null)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 13, fontFamily: 'inherit', padding: 0, marginBottom: 14 }}>
          <ArrowLeft size={15} /> All analyses
        </button>

        <PageHeader
          title={open.name}
          subtitle={`${groups.length} vendor${groups.length === 1 ? '' : 's'} · ${rows.length} product${rows.length === 1 ? '' : 's'} · ${converted ? `✓ Completed — ordered as ${open.batch_no}` : 'draft — nothing has been ordered'}`}
          action={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={exportExcel}><FileSpreadsheet size={14} /> Excel</Button>
              <Button variant="ghost" onClick={printSupplierOrder}><FileText size={14} /> Supplier PDF</Button>
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
              <b>Completed.</b> This analysis became batch order{(open.batch_no || '').includes(',') ? 's' : ''} <b>{open.batch_no}</b>. Track and receive {(open.batch_no || '').includes(',') ? 'them' : 'it'} from the Batch Orders page — editing here no longer changes the order.
            </span>
          </Card>
        )}

        {/* Headline numbers */}
        <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
          {[
            { label: 'Total cost', value: mv0(totals.landed), sub: `${mv0(totals.goods)} goods + ${mv0(totals.extras)} extra costs · ≈ $${batchRate > 0 ? (totals.landed / batchRate).toFixed(0) : '—'} USD @ ${batchRate}`, color: '#0d1b2a' },
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
              <Input label="Dollar rate for this batch (MVR per USD)" type="number" step="0.01"
                defaultValue={open.usd_rate ?? (getSettings().usdRate || 15.42)}
                onBlur={e => patchAnalysis({ usd_rate: num(e.target.value) || (getSettings().usdRate || 15.42) })} />
              <div style={{ fontSize: 11, color: '#bbb', marginTop: -4, lineHeight: 1.5 }}>
                Locks the USD→MVR rate for this order so it stays fixed even if the Settings rate changes later.
              </div>
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
                <span className="oa-no" style={{ borderRadius: 8, background: '#0d1b2a', color: '#FFA500', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>{gi + 1}</span>
                <div>
                  <div className="oa-vendor" style={{ fontWeight: 800, color: '#0d1b2a', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Building2 size={15} color="#c4bcb0" /> {g.label}
                  </div>
                  <div className="oa-vendor-sub" style={{ color: '#aaa', marginTop: 2 }}>
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
                    <div className="oa-kpi-l" style={{ color: '#c4bcb0', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700 }}>{l}</div>
                    <div className="oa-kpi-v" style={{ fontWeight: 800, color: c, marginTop: 1 }}>{v}</div>
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
              <table className="data-table oa-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fff' }}>
                    {!converted && (
                      <th style={{ width: 34, paddingLeft: 14, borderBottom: '1px solid #f2f2f2' }}>
                        <input type="checkbox" className="oa-check" title={`Select every product from ${g.label}`}
                          checked={g.rows.every(r => selected.has(r.id))}
                          onChange={() => toggleSelectMany(g.rows.map(r => r.id))} />
                      </th>
                    )}
                    {['Product', 'Qty', 'Unit cost', 'Landed cost', 'Sell price', 'Profit / unit', 'Margin', 'Total cost', 'Total profit', 'ROI', 'Stock & demand', ''].map((h, i) => (
                      <th key={h + i} style={{ textAlign: i === 0 || i === 10 ? 'left' : 'right', fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', borderBottom: '1px solid #f2f2f2' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, ri) => {
                    // Where this row sits in its family, so a set of sizes can be
                    // drawn as one block rather than repeating the same name.
                    const run = (g.runs || []).find(x => ri >= x.start && ri < x.start + x.count)
                    const inFamily = !!run && run.count > 1
                    const firstOfFamily = inFamily && ri === run.start
                    const size = inFamily ? sizeOf(r) : null
                    const v = VERDICT[r.verdict]
                    const marginColor = r.verdict === 'good' ? '#1D9E75' : r.verdict === 'thin' ? '#e6940a' : r.verdict === 'loss' ? '#E24B4A' : '#aaa'
                    const cell = { textAlign: 'right', whiteSpace: 'nowrap', borderTop: '1px solid #f5f5f5' }
                    const editStyle = { border: '1px solid #e6e2da', borderRadius: 7, fontFamily: 'inherit', textAlign: 'right' }
                    const ticked = selected.has(r.id)
                    return (
                      <tr key={r.id} style={{
                        ...(ticked ? { background: '#fffaf0' } : null),
                        // A family reads as one block: the rows after the first
                        // lose their divider so the set holds together.
                        ...(inFamily && !firstOfFamily ? { borderTop: 'none' } : null),
                      }}>
                        {!converted && (
                          <td style={{ ...cell, textAlign: 'center', paddingLeft: 14, ...(inFamily && !firstOfFamily ? { borderTop: 'none' } : null) }}>
                            <input type="checkbox" className="oa-check" checked={ticked} onChange={() => toggleSelect(r.id)} />
                          </td>
                        )}
                        <td style={{ ...cell, textAlign: 'left', minWidth: 250, ...(inFamily && !firstOfFamily ? { borderTop: 'none' } : null) }}>
                          <div className="oa-cellpad" style={{ display: 'flex', alignItems: 'center' }}>
                            <ImageTile src={r.image_url} className="oa-img" style={{ background: '#f7f5f2', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {r.image_url
                                ? <img src={r.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                : <Package size={18} color="#d5cfc6" />}
                            </ImageTile>
                            <div style={{ minWidth: 0 }}>
                              {inFamily ? (
                                <>
                                  {firstOfFamily && (
                                    <div className="oa-family" title={`${run.count} sizes of this product`}>
                                      <Layers size={11} /> {familyOf(r)} · {run.count} sizes
                                    </div>
                                  )}
                                  <div className="oa-name" style={{ fontWeight: 600, color: '#0d1b2a', whiteSpace: 'normal', display: 'flex', alignItems: 'center', gap: 7 }}>
                                    {size ? <span className="oa-size">{size}</span> : null}
                                    <span style={{ color: '#8a8278', fontWeight: 500 }}>{r.product_name}</span>
                                  </div>
                                </>
                              ) : (
                                <div className="oa-name" style={{ fontWeight: 600, color: '#0d1b2a', whiteSpace: 'normal' }}>{r.product_name}</div>
                              )}
                              <div className="oa-sub" style={{ color: '#bbb', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                {/* The product's own size, not its packed dimensions */}
                                {r.sizes && <span className="oa-size">{r.sizes}</span>}
                                {r.sku && <span>{r.sku}</span>}
                                <Badge color={v.color}>{v.label}</Badge>
                                {!r.known && <Badge color="blue">New product</Badge>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={cell}>
                          <input type="number" className="oa-in oa-in-qty" value={r.qty} disabled={converted} style={editStyle}
                            onChange={e => updateItem(r.id, { qty: e.target.value })} onBlur={() => saveItem(r.id)} />
                        </td>
                        <td style={cell}>
                          <input type="number" className="oa-in" value={r.unit_cost} disabled={converted} style={editStyle}
                            onChange={e => updateItem(r.id, { unit_cost: e.target.value })} onBlur={() => saveItem(r.id)} />
                        </td>
                        <td style={{ ...cell, color: '#666' }} title={`Supplier ${mv(r.unitCost)} + ${mv(r.allocated / (r.qty || 1))} share of extra costs`}>
                          {mv(r.landedUnit)}
                        </td>
                        <td style={cell}>
                          <input type="number" className="oa-in" value={r.sell_price} disabled={converted} style={editStyle}
                            onChange={e => updateItem(r.id, { sell_price: e.target.value })} onBlur={() => saveItem(r.id)} />
                        </td>
                        <td style={{ ...cell, color: r.profitUnit >= 0 ? '#1D9E75' : '#E24B4A', fontWeight: 600 }}>{mv(r.profitUnit)}</td>
                        <td style={{ ...cell, fontWeight: 700, color: marginColor }}>
                          {pct(r.margin)}
                          <div className="oa-tiny" style={{ color: '#c4c0b8', fontWeight: 500, marginTop: 2 }}>{pct(r.markup)} mark-up</div>
                        </td>
                        <td style={{ ...cell, color: '#666' }}>{mv0(r.landedLine)}</td>
                        <td style={{ ...cell, fontWeight: 700, color: r.profit >= 0 ? '#1D9E75' : '#E24B4A' }}>{mv0(r.profit)}</td>
                        <td style={{ ...cell, color: r.roi >= 0 ? '#1D9E75' : '#E24B4A' }}>
                          {pct(r.roi)}
                          {r.breakEven != null && <div className="oa-tiny" style={{ color: '#c4c0b8', marginTop: 2 }}>{r.breakEven} to break even</div>}
                        </td>
                        <td className="oa-demand" style={{ ...cell, textAlign: 'left', color: '#888', whiteSpace: 'normal' }}>
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
                            <Trash2 size={15} color="#c0392b" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#fbfaf8', fontWeight: 700 }}>
                    {!converted && <td style={{ borderTop: '2px solid #f0ece6' }} />}
                    <td style={{ borderTop: '2px solid #f0ece6' }}>{g.label} total</td>
                    <td style={{ textAlign: 'right', borderTop: '2px solid #f0ece6' }}>{g.totals.qty}</td>
                    <td colSpan={2} style={{ textAlign: 'right', borderTop: '2px solid #f0ece6', color: '#aaa', fontWeight: 500 }}>
                      incl. {mv0(g.totals.extras)} extra costs
                    </td>
                    <td colSpan={3} style={{ textAlign: 'right', borderTop: '2px solid #f0ece6', color: g.totals.margin >= target ? '#1D9E75' : '#e6940a' }}>
                      {pct(g.totals.margin)} margin
                    </td>
                    <td style={{ textAlign: 'right', borderTop: '2px solid #f0ece6' }}>{mv0(g.totals.landed)}</td>
                    <td style={{ textAlign: 'right', borderTop: '2px solid #f0ece6', color: g.totals.profit >= 0 ? '#1D9E75' : '#E24B4A' }}>{mv0(g.totals.profit)}</td>
                    <td colSpan={3} style={{ textAlign: 'right', borderTop: '2px solid #f0ece6', color: g.totals.roi >= 0 ? '#1D9E75' : '#E24B4A' }}>{pct(g.totals.roi)} ROI</td>
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
        action={<Button onClick={() => { setNewForm({ name: '', supplier_id: '', supplier_name: '', target_margin: 40, usd_rate: getSettings().usdRate || 15.42 }); setNewModal(true) }}><Plus size={15} /> New analysis</Button>}
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

      {[['Drafts', drafts], ['Completed', done]].map(([label, list]) => list.length > 0 && (
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
            <Input label="Dollar rate for this batch (MVR per USD)" type="number" step="0.01" value={newForm.usd_rate}
              onChange={e => setNewForm(f => ({ ...f, usd_rate: e.target.value }))} />
            <div style={{ fontSize: 11.5, color: '#aaa', lineHeight: 1.5 }}>
              Defaults to your Settings rate. Locks the USD→MVR rate for this batch.
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
    ;(async () => {
      const { data } = await supabase.from('order_analysis_items')
        .select('qty, unit_cost, sell_price, supplier_product_id').eq('analysis_id', a.id)
      if (!live) return
      const rows = data || []
      // Draft lines mirror the catalog at THIS batch's dollar rate — the exact same
      // derivation the open view uses — so the card and the detail always agree.
      // Converted analyses keep the prices they were ordered at.
      let costOf = null
      if (a.status !== 'converted') {
        const ids = [...new Set(rows.map(r => r.supplier_product_id).filter(Boolean))]
        if (ids.length) {
          const settingsRate = num(getSettings().usdRate) || 15.42
          const draftRate = num(a.usd_rate) || settingsRate
          let sps = null
          const r1 = await supabase.from('supplier_products').select('id, cost_price, cost_usd').in('id', ids)
          if (r1.error) sps = (await supabase.from('supplier_products').select('id, cost_price').in('id', ids)).data
          else sps = r1.data
          if (!live) return
          costOf = new Map((sps || []).map(s => {
            const recorded = s.cost_usd == null || s.cost_usd === '' ? NaN : Number(s.cost_usd)
            const cp = s.cost_price == null || s.cost_price === '' ? NaN : Number(s.cost_price)
            const usd = isFinite(recorded) ? recorded : (isFinite(cp) && settingsRate > 0 ? cp / settingsRate : NaN)
            return [s.id, isFinite(usd) ? Math.round(usd * draftRate * 100) / 100 : (isFinite(cp) ? cp : 0)]
          }))
        }
      }
      const unitOf = r => (costOf && r.supplier_product_id != null && costOf.has(r.supplier_product_id))
        ? costOf.get(r.supplier_product_id) : num(r.unit_cost)
      const extras = (a.extra_costs || []).reduce((s, c) => s + num(c.amount), 0)
      const goods = rows.reduce((s, r) => s + num(r.qty) * unitOf(r), 0)
      const revenue = rows.reduce((s, r) => s + num(r.qty) * num(r.sell_price), 0)
      const landed = goods + extras
      setStats({ lines: rows.length, landed, revenue, profit: revenue - landed, margin: revenue > 0 ? ((revenue - landed) / revenue) * 100 : 0 })
    })()
    return () => { live = false }
  }, [a.id, a.extra_costs, a.usd_rate, a.status])

  const converted = a.status === 'converted'
  return (
    <div onClick={onOpen} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', transition: 'box-shadow .15s, transform .15s' }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.07)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#0d1b2a', letterSpacing: '-0.2px' }}>{a.name}</div>
          <div style={{ fontSize: 11.5, color: '#bbb', marginTop: 3 }}>
            {a.supplier_name ? `${a.supplier_name} · ` : ''}{(a.created_at || '').slice(0, 10)}{converted && a.batch_no ? ` · ${a.batch_no}` : ''}
          </div>
        </div>
        {converted
          ? <Badge color="green"><CheckCircle size={11} style={{ verticalAlign: -1, marginRight: 3 }} />Completed</Badge>
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
