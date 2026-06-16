import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import { Plus, Trash2, Package, Truck, X, Info, AlertTriangle, CreditCard, Wallet, CheckCircle, Paperclip, Eye, Pencil, LayoutGrid, List, LayoutList } from 'lucide-react'

const AVATAR_COLORS = ['#7F77DD', '#1D9E75', '#FFA500', '#378ADD', '#E24B4A', '#0F6E56']
function avatarColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function Avatar({ name, size = 30 }) {
  const color = avatarColor(name)
  return (
    <div style={{
      width: size, height: size, borderRadius: size > 24 ? 8 : 6, background: color + '18', color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size > 24 ? 13 : 11, fontWeight: 600, flexShrink: 0,
    }}>{(name || '?').charAt(0).toUpperCase()}</div>
  )
}

const COST_TYPES = ['Alibaba transaction charge', 'China local delivery', 'Shipping / Freight', 'Customs / Duty', 'Other']

const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' }
]

export default function PurchaseOrders() {
  const [pos, setPOs] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [payments, setPayments] = useState([]) // supplier_payments
  const [loading, setLoading] = useState(true)
  const [batchModal, setBatchModal] = useState(false)
  const [supplierModal, setSupplierModal] = useState(false)
  const [payModal, setPayModal] = useState(null) // PO object being paid
  const [payForm, setPayForm] = useState({ amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'Bank Transfer', reference: '', notes: '', slips: [] })
  const [paymentsTab, setPaymentsTab] = useState(false)
  const [viewSlips, setViewSlips] = useState(null) // { slips: [...], title } for fullscreen viewer
  const [viewTab, setViewTab] = useState('ongoing') // 'ongoing' | 'history'
  const [listView, setListView] = useState(() => localStorage.getItem('po_list_view') || 'detailed') // 'detailed' | 'compact' | 'table'
  const [editPayModal, setEditPayModal] = useState(null) // payment being edited
  const [editPayForm, setEditPayForm] = useState({ amount: '', payment_date: '', payment_method: 'Bank Transfer', reference: '', notes: '', slips: [], newCosts: [] })
  const [batchForm, setBatchForm] = useState({ supplier_id: '', supplier_name: '', order_date: new Date().toISOString().split('T')[0], expected_date: '', items: [], extraCosts: [] })
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_name: '', email: '', phone: '', address: '' })
  const [saving, setSaving] = useState(false)
  const [supplierCatalog, setSupplierCatalog] = useState([])
  const [itemSearch, setItemSearch] = useState({})
  const [focusedRow, setFocusedRow] = useState(null)
  const [slipModal, setSlipModal] = useState(null) // PO object
  const [slipUploading, setSlipUploading] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [p, s, pr, pay, sp] = await Promise.all([
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('*').order('name'),
      supabase.from('supplier_payments').select('*').order('payment_date', { ascending: false }),
      supabase.from('supplier_products').select('*').order('product_name'),
    ])
    setPOs(p.data || [])
    setSuppliers(s.data || [])
    setProducts(pr.data || [])
    setPayments(pay.data || [])
    setSupplierCatalog(sp.data || [])
    setLoading(false)
  }

  function openBatchAdd() {
    // Auto-suggest low stock items
    const lowStock = products.filter(p => p.stock_qty <= (p.low_stock_threshold || 10))
    const suggestedItems = lowStock.map(p => ({
      product_id: p.id,
      product_name: p.name,
      qty: Math.max(20, (p.low_stock_threshold || 10) * 2 - p.stock_qty),
      unit_cost: Number(p.cost_price) || 0,
      current_stock: p.stock_qty
    }))
    setBatchForm({
      supplier_id: '', supplier_name: '',
      order_date: new Date().toISOString().split('T')[0],
      expected_date: '',
      items: suggestedItems.length > 0 ? suggestedItems : [{ product_id: '', product_name: '', qty: 1, unit_cost: 0, current_stock: 0 }],
      extraCosts: []
    })
    setBatchModal(true)
  }

  function handleSupplierChange(e) {
    const s = suppliers.find(s => s.id === e.target.value)
    setBatchForm(prev => ({ ...prev, supplier_id: e.target.value, supplier_name: s?.name || '' }))
  }

  function updateItem(idx, key, value) {
    const newItems = [...batchForm.items]
    if (key === 'product_id') {
      if (value.startsWith('cat:')) {
        // From supplier catalog
        const catId = value.replace('cat:', '')
        const cp = supplierCatalog.find(p => p.id === catId)
        newItems[idx] = { ...newItems[idx], product_id: value, product_name: cp?.product_name || '', unit_cost: cp?.cost_price || 0, current_stock: '—', image_url: cp?.image_url || '' }
      } else {
        const p = products.find(p => p.id === value)
        newItems[idx] = { ...newItems[idx], product_id: value, product_name: p?.name || '', unit_cost: p?.cost_price || 0, current_stock: p?.stock_qty || 0, image_url: p?.image_url || '' }
      }
    } else {
      newItems[idx] = { ...newItems[idx], [key]: value }
    }
    setBatchForm(prev => ({ ...prev, items: newItems }))
  }

  function addItem() {
    setBatchForm(prev => ({ ...prev, items: [...prev.items, { product_id: '', product_name: '', qty: 1, unit_cost: 0, current_stock: 0 }] }))
  }

  function removeItem(idx) {
    setBatchForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))
  }

  function addCost() {
    setBatchForm(prev => ({ ...prev, extraCosts: [...(prev.extraCosts || []), { type: 'Alibaba transaction charge', label: '', amount: '' }] }))
  }

  function updateCost(idx, key, value) {
    setBatchForm(prev => {
      const next = [...(prev.extraCosts || [])]
      next[idx] = { ...next[idx], [key]: value }
      return { ...prev, extraCosts: next }
    })
  }

  function removeCost(idx) {
    setBatchForm(prev => ({ ...prev, extraCosts: (prev.extraCosts || []).filter((_, i) => i !== idx) }))
  }

  async function saveBatch() {
    const validItems = batchForm.items.filter(i => i.product_id && i.qty > 0)
    if (validItems.length === 0) { toast.error('Add at least one product'); return }
    setSaving(true)

    const batchId = (window.crypto?.randomUUID?.() || `b${Date.now()}${Math.random().toString(36).slice(2, 8)}`)

    const records = validItems.map(item => ({
      supplier_id: batchForm.supplier_id || null,
      supplier_name: batchForm.supplier_name,
      product_id: item.product_id?.startsWith('cat:') ? null : (item.product_id || null),
      product_name: item.product_name,
      qty: parseInt(item.qty),
      unit_cost: parseFloat(item.unit_cost),
      status: 'pending',
      order_date: batchForm.order_date,
      expected_date: batchForm.expected_date || null,
      image_url: item.image_url || null,
      batch_id: batchId,
    }))

    // Extra costs become their own line items (freight, fees, etc.)
    const costRecords = (batchForm.extraCosts || [])
      .filter(c => Number(c.amount) > 0)
      .map(c => ({
        supplier_id: batchForm.supplier_id || null,
        supplier_name: batchForm.supplier_name,
        product_id: null,
        product_name: c.type === 'Other' ? (c.label || 'Other cost') : c.type,
        qty: 1,
        unit_cost: parseFloat(c.amount),
        status: 'pending',
        order_date: batchForm.order_date,
        expected_date: batchForm.expected_date || null,
        cost_type: 'extra',
        batch_id: batchId,
      }))

    const { error } = await supabase.from('purchase_orders').insert([...records, ...costRecords])
    setSaving(false)
    if (error) { toast.error('Failed to save'); return }
    toast.success(`Batch order created! ${validItems.length} item${validItems.length > 1 ? 's' : ''}${costRecords.length ? ` + ${costRecords.length} cost${costRecords.length > 1 ? 's' : ''}` : ''}`)
    setBatchModal(false)
    load()
  }

  // Idempotent: adds each product line to inventory once, marking stock_added=true.
  // Returns number of lines synced.
  async function syncGroupToStock(group) {
    const ids = group.rows.map(r => r.id)
    const { data: currentRows, error: fetchErr } = await supabase
      .from('purchase_orders')
      .select('id, product_id, product_name, qty, unit_cost, total_cost, image_url, cost_type, stock_added')
      .in('id', ids)
    if (fetchErr) { toast.error('Failed to load order lines'); return 0 }

    const productRows = (currentRows || []).filter(r => r.cost_type !== 'extra' && !r.stock_added)
    if (productRows.length === 0) { toast.error('Already added to stock'); return 0 }

    let synced = 0
    for (const row of productRows) {
      let ok = false
      // Unit cost, falling back to total ÷ qty if unit_cost wasn't stored
      const unitCost = Number(row.unit_cost) > 0
        ? Number(row.unit_cost)
        : (Number(row.qty) > 0 ? Number(row.total_cost || 0) / Number(row.qty) : 0)
      if (row.product_id) {
        const { data: prod, error: prodErr } = await supabase.from('products').select('id, stock_qty, name').eq('id', row.product_id).single()
        if (!prodErr && prod) {
          await supabase.from('products').update({ stock_qty: (prod.stock_qty || 0) + Number(row.qty) }).eq('id', prod.id)
          toast.success(`${prod.name}: +${row.qty} units in stock`)
          ok = true
        }
      }
      if (!ok && row.product_name) {
        const { data: found } = await supabase.from('products').select('id, stock_qty, name, cost_price').ilike('name', row.product_name).limit(1)
        const existing = found?.[0]
        if (existing) {
          const upd = { stock_qty: (existing.stock_qty || 0) + Number(row.qty) }
          // Record cost from this purchase if not already set
          if ((!existing.cost_price || Number(existing.cost_price) === 0) && unitCost > 0) {
            upd.cost_price = unitCost
          }
          await supabase.from('products').update(upd).eq('id', existing.id)
          toast.success(`${existing.name}: +${row.qty} added to stock`)
          ok = true
        } else {
          // Pull extra details from matching catalog item if we have it
          const cat = supplierCatalog.find(c => c.product_name?.toLowerCase() === row.product_name?.toLowerCase())
          const cost = unitCost || Number(cat?.cost_price) || 0
          const insertPayload = {
            name: row.product_name,
            category: cat?.category || 'Building & Blocks',
            age_range: cat?.age_range || 'All ages',
            brand: cat?.brand || null,
            pieces: cat?.pieces ?? null,
            sizes: cat?.sizes || null,
            weight: cat?.weight || null,
            dimensions: cat?.dimensions || null,
            description: cat?.description || null,
            tags: cat?.tags || null,
            stock_qty: Number(row.qty),
            low_stock_threshold: 1,
            cost_price: cost,
            sell_price: cat?.sell_price || parseFloat((cost * 1.3).toFixed(2)),
            sku: cat?.sku || null,
            barcode: cat?.barcode || null,
            photo_url: row.image_url || cat?.image_url || null,
          }
          let { error: insErr } = await supabase.from('products').insert(insertPayload)
          // Drop columns the products table may not have yet, then retry
          while (insErr && /column .* does not exist|could not find/i.test(insErr.message || '')) {
            const col = (insErr.message.match(/column "?([a-z_]+)"?/i) || [])[1]
            if (!col || !(col in insertPayload)) break
            delete insertPayload[col]
            const retry = await supabase.from('products').insert(insertPayload); insErr = retry.error
          }
          if (insErr) { toast.error(`Could not add ${row.product_name}: ${insErr.message}`) }
          else { toast.success(`${row.product_name}: created in inventory`); ok = true }
        }
      }
      if (ok) {
        await supabase.from('purchase_orders').update({ stock_added: true }).eq('id', row.id)
        synced++
      }
    }
    return synced
  }

  async function updateBatchStatus(group, newStatus) {
    const ids = group.rows.map(r => r.id)
    const { error: statusErr } = await supabase.from('purchase_orders').update({ status: newStatus }).in('id', ids)
    if (statusErr) { toast.error('Failed to update status'); return }

    if (newStatus === 'received') {
      await syncGroupToStock(group)
      const paid = paidForGroup(group)
      if (paid < group.total) openGroupPayModal(group)
    }
    load()
  }

  async function manualSyncStock(group) {
    await syncGroupToStock(group)
    load()
  }

  async function delGroup(group) {
    if (!window.confirm('Delete this order? This will delete all line items including fees.')) return
    await supabase.from('purchase_orders').delete().in('id', group.rows.map(r => r.id))
    toast.success('Order deleted')
    load()
  }

  function paidForGroup(group) {
    const ids = new Set(group.rows.map(r => r.id))
    return payments.filter(p => ids.has(p.purchase_order_id)).reduce((s, p) => s + Number(p.amount), 0)
  }

  function openGroupPayModal(group) {
    const anchor = group.rows.find(r => r.cost_type !== 'extra') || group.rows[0]
    const paid = paidForGroup(group)
    const outstanding = Math.max(0, group.total - paid)
    setPayForm({ amount: outstanding > 0 ? outstanding.toFixed(2) : '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'Bank Transfer', reference: '', notes: '', slips: [] })
    setPayModal({ ...anchor, total_cost: group.total, _groupTotal: group.total, _groupPaid: paid, _groupIds: group.rows.map(r => r.id) })
  }

  async function markAllReceived() {
    if (!window.confirm('Mark all pending orders as received? This will update stock.')) return
    for (const g of poGroups.filter(g => g.rows[0]?.status === 'pending' || g.rows[0]?.status === 'ordered')) {
      await updateBatchStatus(g, 'received')
    }
    toast.success('All orders received and stock updated')
  }

  async function saveSupplier() {
    if (!supplierForm.name) return
    setSaving(true)
    const { error } = await supabase.from('suppliers').insert(supplierForm)
    setSaving(false)
    if (error) { toast.error('Failed to save supplier'); return }
    toast.success('Supplier added!')
    setSupplierModal(false)
    setSupplierForm({ name: '', contact_name: '', email: '', phone: '', address: '' })
    load()
  }

  const sf = k => e => setSupplierForm(prev => ({ ...prev, [k]: e.target.value }))

  // Read selected payslip files into base64 data URLs and append to the form
  async function addSlipFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const read = f => new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve({ name: f.name, type: f.type, url: reader.result })
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(f)
    })
    const slips = (await Promise.all(files.map(read))).filter(Boolean)
    setPayForm(p => ({ ...p, slips: [...(p.slips || []), ...slips] }))
  }

  async function recordPayment() {
    if (!payForm.amount || Number(payForm.amount) <= 0) { toast.error('Enter a valid amount'); return }
    const base = {
      purchase_order_id: payModal.id,
      supplier_id: payModal.supplier_id || null,
      supplier_name: payModal.supplier_name || '',
      amount: parseFloat(payForm.amount),
      payment_date: payForm.payment_date,
      payment_method: payForm.payment_method,
      reference: payForm.reference || null,
      notes: payForm.notes || null,
    }
    const row = (payForm.slips && payForm.slips.length) ? { ...base, slips: payForm.slips } : base
    let { error } = await supabase.from('supplier_payments').insert(row)
    // The slips column may not exist yet — retry without it so the payment still saves
    if (error && /column .* does not exist|could not find/i.test(error.message || '') && row.slips) {
      ({ error } = await supabase.from('supplier_payments').insert(base))
      if (!error && payForm.slips.length) toast.error('Payment saved, but payslips need the "slips" column (run the migration)')
    }
    if (error) { toast.error('Failed to record payment'); return }
    const recorded = parseFloat(payForm.amount)
    toast.success(`Payment of MVR ${recorded.toFixed(2)} recorded`)
    // Reload data then update the modal's paid/outstanding values so user can add another
    const [p, pay] = await Promise.all([
      supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }),
      supabase.from('supplier_payments').select('*').order('payment_date', { ascending: false }),
    ])
    const freshPOs = p.data || []
    const freshPay = pay.data || []
    setPOs(freshPOs)
    setPayments(freshPay)
    // Recalculate paid for this group
    const newGroupPaid = freshPay.filter(x => payModal._groupIds?.includes(x.purchase_order_id) || x.purchase_order_id === payModal.id).reduce((s, x) => s + Number(x.amount), 0)
    const newOutstanding = Math.max(0, payModal._groupTotal - newGroupPaid)
    setPayModal(prev => ({ ...prev, _groupPaid: newGroupPaid }))
    setPayForm({ amount: newOutstanding > 0 ? newOutstanding.toFixed(2) : '', payment_date: new Date().toISOString().split('T')[0], payment_method: payForm.payment_method, reference: '', notes: '', slips: [] })
  }

  function switchView(v) { setListView(v); localStorage.setItem('po_list_view', v) }

  function openEditPayment(payment) {
    setEditPayForm({
      amount: String(payment.amount ?? ''),
      payment_date: payment.payment_date || new Date().toISOString().split('T')[0],
      payment_method: payment.payment_method || 'Bank Transfer',
      reference: payment.reference || '',
      notes: payment.notes || '',
      slips: Array.isArray(payment.slips) ? payment.slips : [],
      newCosts: [],
    })
    setEditPayModal(payment)
  }

  // Append payslip files to the edit-payment form
  async function addEditSlipFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const read = f => new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve({ name: f.name, type: f.type, url: reader.result })
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(f)
    })
    const slips = (await Promise.all(files.map(read))).filter(Boolean)
    setEditPayForm(p => ({ ...p, slips: [...(p.slips || []), ...slips] }))
  }

  async function saveEditPayment() {
    if (!editPayModal) return
    if (!editPayForm.amount || Number(editPayForm.amount) <= 0) { toast.error('Enter a valid amount'); return }
    setSaving(true)

    // Add any extra cost lines to this order's batch (same transaction)
    const validCosts = (editPayForm.newCosts || []).filter(c => Number(c.amount) > 0)
    if (validCosts.length > 0) {
      const po = pos.find(o => o.id === editPayModal.purchase_order_id)
      const batchId = po?.batch_id || po?.id || editPayModal.purchase_order_id
      const costRecords = validCosts.map(c => ({
        supplier_id: editPayModal.supplier_id || po?.supplier_id || null,
        supplier_name: editPayModal.supplier_name || po?.supplier_name || '',
        product_id: null,
        product_name: c.type === 'Other' ? (c.label || 'Other cost') : c.type,
        qty: 1,
        unit_cost: parseFloat(c.amount),
        status: po?.status || 'received',
        order_date: po?.order_date || new Date().toISOString().split('T')[0],
        expected_date: po?.expected_date || null,
        cost_type: 'extra',
        batch_id: batchId,
      }))
      await supabase.from('purchase_orders').insert(costRecords)
    }

    // Update the payment record itself
    const base = {
      amount: parseFloat(editPayForm.amount),
      payment_date: editPayForm.payment_date,
      payment_method: editPayForm.payment_method,
      reference: editPayForm.reference || null,
      notes: editPayForm.notes || null,
    }
    // Only send slips when they actually changed — re-sending large base64
    // payloads on every save is wasteful and can make the request fail.
    const slipsChanged = JSON.stringify(editPayForm.slips || []) !== JSON.stringify(editPayModal.slips || [])
    const payload = slipsChanged ? { ...base, slips: editPayForm.slips || [] } : base

    let res = await supabase.from('supplier_payments').update(payload).eq('id', editPayModal.id)
    // The slips column may not exist yet — retry without it so the rest still saves
    if (res.error && /column .* does not exist|could not find/i.test(res.error.message || '') && payload.slips) {
      res = await supabase.from('supplier_payments').update(base).eq('id', editPayModal.id)
    }
    setSaving(false)
    if (res.error) { toast.error('Failed to update payment: ' + res.error.message); return }
    toast.success('Payment updated')
    setEditPayModal(null)
    load()
  }

  async function deletePaymentRecord(payment) {
    if (!window.confirm('Delete this payment? The order will become payable again.')) return
    const { error } = await supabase.from('supplier_payments').delete().eq('id', payment.id)
    if (error) { toast.error('Failed to delete payment'); return }
    toast.success('Payment deleted — order is payable again')
    setEditPayModal(null)
    load()
  }

  const [editGroupModal, setEditGroupModal] = useState(null) // group being edited

  // Resolve contact name (primary) and company name (sub) from a supplier_id or supplier_name
  function supplierDisplay(supplierId, fallbackName) {
    const s = suppliers.find(x => x.id === supplierId)
    const company = s?.name || fallbackName || ''
    const contact = s?.contact_name || ''
    return { main: contact || company, sub: contact ? company : '' }
  }

  function openEditGroup(group) {
    const anchor = group.anchor
    const productRows = group.rows.filter(r => r.cost_type !== 'extra')
    const feeRows = group.rows.filter(r => r.cost_type === 'extra')
    setEditGroupModal({
      group,
      batchId: anchor.batch_id || anchor.id,
      supplier_id: anchor.supplier_id || '',
      supplier_name: anchor.supplier_name || '',
      order_date: anchor.order_date || new Date().toISOString().split('T')[0],
      expected_date: anchor.expected_date || '',
      // Editable copies of existing product rows
      existingItems: productRows.map(r => ({ id: r.id, product_name: r.product_name, qty: r.qty, unit_cost: r.unit_cost, image_url: r.image_url, _origQty: r.qty })),
      removedIds: [],
      newItems: [], // new products to add
      extraCosts: feeRows.map(r => {
        const isPreset = COST_TYPES.includes(r.product_name)
        return { _id: r.id, type: isPreset ? r.product_name : 'Other', label: isPreset ? '' : (r.product_name || ''), amount: String(r.unit_cost || '') }
      }),
      removedCostIds: [],
    })
  }

  async function saveEditGroup() {
    if (!editGroupModal) return
    setSaving(true)
    const { batchId, supplier_id, supplier_name, order_date, expected_date, newItems, existingItems, removedIds } = editGroupModal

    // Insert new product rows
    const newRecords = newItems.filter(i => i.product_id && i.qty > 0).map(item => ({
      supplier_id: supplier_id || null,
      supplier_name,
      product_id: item.product_id?.startsWith('cat:') ? null : (item.product_id || null),
      product_name: item.product_name,
      qty: parseInt(item.qty),
      unit_cost: parseFloat(item.unit_cost),
      status: editGroupModal.group.anchor.status || 'pending',
      order_date,
      expected_date: expected_date || null,
      image_url: item.image_url || null,
      batch_id: batchId,
    }))
    if (newRecords.length > 0) {
      const { error } = await supabase.from('purchase_orders').insert(newRecords)
      if (error) { toast.error('Failed to add items: ' + error.message); setSaving(false); return }
    }

    // Update quantities on existing rows (always write to avoid type-coercion mismatches)
    for (const it of existingItems) {
      const qty = Math.max(1, parseInt(it.qty) || 1)
      const unitCost = Number(it.unit_cost || 0)
      const { error: updErr } = await supabase
        .from('purchase_orders')
        .update({ qty, total_cost: qty * unitCost })
        .eq('id', it.id)
      if (updErr) {
        // total_cost may not exist as a column — retry without it
        await supabase.from('purchase_orders').update({ qty }).eq('id', it.id)
      }
    }

    // Remove deleted line items
    if (removedIds.length > 0) {
      await supabase.from('purchase_orders').delete().in('id', removedIds)
    }

    // Extra costs: update existing fee rows, insert new ones, delete removed/zeroed
    const status = editGroupModal.group.anchor.status || 'pending'
    for (const c of (editGroupModal.extraCosts || [])) {
      const amount = parseFloat(c.amount || 0)
      const name = c.type === 'Other' ? (c.label || 'Other cost') : c.type
      if (c._id) {
        if (amount > 0) {
          await supabase.from('purchase_orders').update({ product_name: name, qty: 1, unit_cost: amount }).eq('id', c._id)
        } else {
          await supabase.from('purchase_orders').delete().eq('id', c._id)
        }
      } else if (amount > 0) {
        await supabase.from('purchase_orders').insert({
          supplier_id: supplier_id || null,
          supplier_name,
          product_id: null,
          product_name: name,
          qty: 1,
          unit_cost: amount,
          status,
          order_date,
          expected_date: expected_date || null,
          cost_type: 'extra',
          batch_id: batchId,
        })
      }
    }
    if ((editGroupModal.removedCostIds || []).length > 0) {
      await supabase.from('purchase_orders').delete().in('id', editGroupModal.removedCostIds)
    }

    // Update expected_date on all remaining group rows
    const remainingIds = editGroupModal.group.rows.map(r => r.id).filter(id => !removedIds.includes(id))
    if (remainingIds.length > 0) {
      await supabase.from('purchase_orders').update({ expected_date: expected_date || null }).in('id', remainingIds)
    }

    setSaving(false)
    toast.success('Order updated')
    setEditGroupModal(null)
    load()
  }

  async function uploadSlip(file) {
    if (!file || !slipModal) return
    setSlipUploading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result
      // Store slip on the anchor row ID
      const { error } = await supabase.from('purchase_orders').update({ slip_url: dataUrl }).eq('id', slipModal._anchorId || slipModal.id)
      setSlipUploading(false)
      if (error) { toast.error('Failed to save slip'); return }
      toast.success('Payment slip saved')
      setSlipModal(prev => ({ ...prev, slip_url: dataUrl }))
      load()
    }
    reader.readAsDataURL(file)
  }

  function payStatusBadgeForGroup(group) {
    const total = group.total
    const paid = paidForGroup(group)
    if (paid <= 0) return <span style={{ fontSize: 11, fontWeight: 600, color: '#E24B4A', background: '#fef2f2', padding: '2px 8px', borderRadius: 99 }}>Unpaid</span>
    if (paid >= total - 0.01) return <span style={{ fontSize: 11, fontWeight: 600, color: '#1D9E75', background: '#E1F5EE', padding: '2px 8px', borderRadius: 99 }}>Paid</span>
    return <span style={{ fontSize: 11, fontWeight: 600, color: '#f57f17', background: '#FFF8E1', padding: '2px 8px', borderRadius: 99 }}>Partial</span>
  }

  const totalSpend = pos.filter(p => p.status === 'received').reduce((s, p) => s + Number(p.total_cost || 0), 0)
  const pendingValue = pos.filter(p => p.status === 'pending' || p.status === 'ordered').reduce((s, p) => s + Number(p.total_cost || 0), 0)
  const batchItemsTotal = batchForm.items.reduce((s, i) => s + (parseFloat(i.qty || 0) * parseFloat(i.unit_cost || 0)), 0)
  const batchCostsTotal = (batchForm.extraCosts || []).reduce((s, c) => s + parseFloat(c.amount || 0), 0)
  const batchTotal = batchItemsTotal + batchCostsTotal
  const lowStockProducts = products.filter(p => p.stock_qty <= (p.low_stock_threshold || 10))

  // Group line items that belong to the same batch order
  const poGroups = (() => {
    const map = {}
    const order = []
    pos.forEach(po => {
      const key = po.batch_id || po.id
      if (!map[key]) { map[key] = []; order.push(key) }
      map[key].push(po)
    })
    return order.map(key => {
      const rows = map[key]
      rows.sort((a, b) => (a.cost_type === 'extra' ? 1 : 0) - (b.cost_type === 'extra' ? 1 : 0))
      const anchor = rows.find(r => r.cost_type !== 'extra') || rows[0]
      return { key, rows, anchor, total: rows.reduce((s, r) => s + Number(r.total_cost || 0), 0) }
    })
  })()

  // Ongoing = still being processed; History = received or cancelled
  const ongoingGroups = poGroups.filter(g => g.anchor.status === 'pending' || g.anchor.status === 'ordered')
  const historyGroups = poGroups.filter(g => g.anchor.status === 'received' || g.anchor.status === 'cancelled')
  const displayGroups = viewTab === 'history' ? historyGroups : ongoingGroups

  // Render a single batch order as a clean card
  function renderBatchCard(g) {
    const { anchor, rows } = g
    const productRows = rows.filter(r => r.cost_type !== 'extra')
    const feeRows = rows.filter(r => r.cost_type === 'extra')
    const totalQty = productRows.reduce((s, r) => s + Number(r.qty || 0), 0)
    const slipUrl = rows.find(r => r.slip_url)?.slip_url || null
    const slipAnchorId = rows.find(r => r.slip_url)?.id || anchor.id
    const needsStockSync = anchor.status === 'received' && productRows.some(r => !r.stock_added)
    const sd = supplierDisplay(anchor.supplier_id, anchor.supplier_name)
    const statusColors = {
      pending: { bg: '#FFF8E1', fg: '#b8740a' },
      ordered: { bg: '#EAF2FD', fg: '#2f6fc0' },
      received: { bg: '#E1F5EE', fg: '#1D9E75' },
      cancelled: { bg: '#fef2f2', fg: '#E24B4A' },
    }
    const sc = statusColors[anchor.status] || statusColors.pending

    return (
      <div key={g.key} style={{ border: '1px solid #eee', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: '1px solid #f5f5f5' }}>
          <Avatar name={sd.main} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: '#0d1b2a', fontSize: 14 }}>{sd.main || '—'}</div>
            <div style={{ fontSize: 11, color: '#aaa', fontWeight: 500 }}>
              {sd.sub ? `${sd.sub} · ` : ''}Ordered {anchor.order_date}{anchor.expected_date ? ` · Expected ${anchor.expected_date}` : ''}
            </div>
          </div>
          {/* Status pill with embedded select */}
          <div style={{ position: 'relative', background: sc.bg, borderRadius: 99, padding: '5px 10px' }}>
            <select value={anchor.status} onChange={e => updateBatchStatus(g, e.target.value)}
              style={{ border: 'none', background: 'transparent', fontSize: 12, fontWeight: 700, color: sc.fg, cursor: 'pointer', fontFamily: 'inherit', appearance: 'none', paddingRight: 2 }}>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {payStatusBadgeForGroup(g)}
          <div style={{ textAlign: 'right', minWidth: 110 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0d1b2a' }}>MVR {g.total.toFixed(2)}</div>
            <div style={{ fontSize: 11, color: '#bbb', fontWeight: 600 }}>{totalQty} item{totalQty === 1 ? '' : 's'}</div>
          </div>
        </div>

        {/* Products + fees */}
        <div style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {productRows.map(r => (
              <div key={r.id} title={r.product_name} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 9, padding: '4px 11px 4px 4px' }}>
                {r.image_url
                  ? <img src={r.image_url} alt="" style={{ width: 30, height: 30, objectFit: 'contain', borderRadius: 6, background: '#fff', flexShrink: 0 }} onError={e => e.target.style.display = 'none'} />
                  : <div style={{ width: 30, height: 30, borderRadius: 6, background: '#eee', flexShrink: 0 }} />}
                <span style={{ fontSize: 12.5, fontWeight: 500, color: '#0d1b2a', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#FFA500' }}>×{r.qty}</span>
              </div>
            ))}
          </div>
          {feeRows.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {feeRows.map(f => (
                <span key={f.id} style={{ fontSize: 11, fontWeight: 600, color: '#b8740a', background: '#FFF3D6', padding: '3px 9px', borderRadius: 99 }}>
                  {f.product_name} · MVR {Number(f.unit_cost).toFixed(2)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Action bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid #f5f5f5', background: '#fcfcfc' }}>
          {needsStockSync && (
            <button onClick={() => manualSyncStock(g)} title="Add these items to inventory"
              style={{ background: '#FFF3D6', color: '#b8740a', border: '1px solid #f0d9a8', borderRadius: 8, cursor: 'pointer', padding: '6px 11px', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Truck size={13} /> Add to stock
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={() => setSlipModal({ ...anchor, slip_url: slipUrl, _anchorId: slipAnchorId })}
            style={{ background: slipUrl ? '#E1F5EE' : '#fff', border: `1px solid ${slipUrl ? '#1D9E75' : '#e0e0e0'}`, borderRadius: 8, cursor: 'pointer', padding: '6px 11px', display: 'flex', alignItems: 'center', gap: 5, color: slipUrl ? '#1D9E75' : '#999', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
            {slipUrl ? <Eye size={13} /> : <Paperclip size={13} />}{slipUrl ? 'View slip' : 'Attach slip'}
          </button>
          <button onClick={() => openGroupPayModal(g)}
            style={{ background: '#FFA500', border: 'none', borderRadius: 8, cursor: 'pointer', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 5, color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}>
            <CreditCard size={13} /> Payment
          </button>
          <button onClick={() => openEditGroup(g)} title="Edit order"
            style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, cursor: 'pointer', padding: '6px 9px', display: 'flex', alignItems: 'center', color: '#666' }}>
            <Plus size={14} />
          </button>
          <button onClick={() => delGroup(g)} title="Delete order"
            style={{ background: '#fff', border: '1px solid #f3d6d6', borderRadius: 8, cursor: 'pointer', padding: '6px 9px', display: 'flex', alignItems: 'center', color: '#E24B4A' }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    )
  }

  // Compact mini-card (grid view)
  function renderMiniCard(g) {
    const { anchor, rows } = g
    const productRows = rows.filter(r => r.cost_type !== 'extra')
    const totalQty = productRows.reduce((s, r) => s + Number(r.qty || 0), 0)
    const slipUrl = rows.find(r => r.slip_url)?.slip_url || null
    const slipAnchorId = rows.find(r => r.slip_url)?.id || anchor.id
    const sd = supplierDisplay(anchor.supplier_id, anchor.supplier_name)
    const thumbs = productRows.filter(r => r.image_url).slice(0, 5)
    const statusColors = { pending: { bg: '#FFF8E1', fg: '#b8740a' }, ordered: { bg: '#EAF2FD', fg: '#2f6fc0' }, received: { bg: '#E1F5EE', fg: '#1D9E75' }, cancelled: { bg: '#fef2f2', fg: '#E24B4A' } }
    const sc = statusColors[anchor.status] || statusColors.pending
    return (
      <div key={g.key} style={{ border: '1px solid #eee', borderRadius: 14, padding: 14, background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Avatar name={sd.main} size={30} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: '#0d1b2a', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sd.main || '—'}</div>
            <div style={{ fontSize: 10.5, color: '#aaa' }}>{anchor.order_date}</div>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: sc.fg, background: sc.bg, padding: '3px 9px', borderRadius: 99 }}>{anchor.status}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {thumbs.map(r => (
            <img key={r.id} src={r.image_url} alt="" title={r.product_name} style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 7, border: '1px solid #f0f0f0', background: '#fff' }} onError={e => e.target.style.display = 'none'} />
          ))}
          {productRows.length > thumbs.length && (
            <span style={{ fontSize: 11, color: '#aaa', fontWeight: 600 }}>+{productRows.length - thumbs.length}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0d1b2a' }}>MVR {g.total.toFixed(2)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10.5, color: '#bbb', fontWeight: 600 }}>{totalQty} items</span>
            {payStatusBadgeForGroup(g)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #f5f5f5', paddingTop: 10 }}>
          <button onClick={() => openGroupPayModal(g)} title="Record payment" style={{ flex: 1, background: '#FFA500', border: 'none', borderRadius: 8, cursor: 'pointer', padding: '7px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}><CreditCard size={13} /> Pay</button>
          <button onClick={() => setSlipModal({ ...anchor, slip_url: slipUrl, _anchorId: slipAnchorId })} title={slipUrl ? 'View slip' : 'Attach slip'} style={{ background: slipUrl ? '#E1F5EE' : '#fff', border: `1px solid ${slipUrl ? '#1D9E75' : '#e0e0e0'}`, borderRadius: 8, cursor: 'pointer', padding: '7px 10px', display: 'flex', alignItems: 'center', color: slipUrl ? '#1D9E75' : '#999' }}>{slipUrl ? <Eye size={14} /> : <Paperclip size={14} />}</button>
          <button onClick={() => openEditGroup(g)} title="Edit order" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, cursor: 'pointer', padding: '7px 10px', display: 'flex', alignItems: 'center', color: '#666' }}><Pencil size={14} /></button>
          <button onClick={() => delGroup(g)} title="Delete order" style={{ background: '#fff', border: '1px solid #f3d6d6', borderRadius: 8, cursor: 'pointer', padding: '7px 10px', display: 'flex', alignItems: 'center', color: '#E24B4A' }}><Trash2 size={14} /></button>
        </div>
      </div>
    )
  }

  // Compact table row (table view)
  function renderTableRow(g) {
    const { anchor, rows } = g
    const productRows = rows.filter(r => r.cost_type !== 'extra')
    const feeRows = rows.filter(r => r.cost_type === 'extra')
    const totalQty = productRows.reduce((s, r) => s + Number(r.qty || 0), 0)
    const slipUrl = rows.find(r => r.slip_url)?.slip_url || null
    const slipAnchorId = rows.find(r => r.slip_url)?.id || anchor.id
    const sd = supplierDisplay(anchor.supplier_id, anchor.supplier_name)
    const statusColors = { pending: { bg: '#FFF8E1', fg: '#b8740a' }, ordered: { bg: '#EAF2FD', fg: '#2f6fc0' }, received: { bg: '#E1F5EE', fg: '#1D9E75' }, cancelled: { bg: '#fef2f2', fg: '#E24B4A' } }
    const sc = statusColors[anchor.status] || statusColors.pending
    return (
      <tr key={g.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Avatar name={sd.main} size={28} />
            <div>
              <div style={{ fontWeight: 600, color: '#0d1b2a', fontSize: 13 }}>{sd.main || '—'}</div>
              <div style={{ fontSize: 11, color: '#aaa' }}>{anchor.order_date}</div>
            </div>
          </div>
        </td>
        <td style={{ padding: '10px 12px', verticalAlign: 'middle', color: '#666', fontSize: 12, maxWidth: 240 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {productRows.map(r => `${r.product_name} ×${r.qty}`).join(', ')}{feeRows.length ? ` · +${feeRows.length} cost${feeRows.length > 1 ? 's' : ''}` : ''}
          </span>
        </td>
        <td style={{ padding: '10px 12px', verticalAlign: 'middle', fontWeight: 700 }}>{totalQty}</td>
        <td style={{ padding: '10px 12px', verticalAlign: 'middle', fontWeight: 700, color: '#0d1b2a' }}>MVR {g.total.toFixed(2)}</td>
        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
          <select value={anchor.status} onChange={e => updateBatchStatus(g, e.target.value)}
            style={{ border: 'none', background: sc.bg, color: sc.fg, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 99, padding: '4px 8px' }}>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </td>
        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>{payStatusBadgeForGroup(g)}</td>
        <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={() => openGroupPayModal(g)} title="Record payment" className="icon-btn primary" style={{ background: '#FFA500', border: 'none', borderRadius: 7, cursor: 'pointer', padding: 6, display: 'flex', color: '#fff' }}><CreditCard size={13} /></button>
            <button onClick={() => setSlipModal({ ...anchor, slip_url: slipUrl, _anchorId: slipAnchorId })} title={slipUrl ? 'View slip' : 'Attach slip'} style={{ background: slipUrl ? '#E1F5EE' : '#fff', border: `1px solid ${slipUrl ? '#1D9E75' : '#e0e0e0'}`, borderRadius: 7, cursor: 'pointer', padding: 6, display: 'flex', color: slipUrl ? '#1D9E75' : '#999' }}>{slipUrl ? <Eye size={13} /> : <Paperclip size={13} />}</button>
            <button onClick={() => openEditGroup(g)} title="Edit order" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 7, cursor: 'pointer', padding: 6, display: 'flex', color: '#666' }}><Pencil size={13} /></button>
            <button onClick={() => delGroup(g)} title="Delete order" style={{ background: '#fff', border: '1px solid #f3d6d6', borderRadius: 7, cursor: 'pointer', padding: 6, display: 'flex', color: '#E24B4A' }}><Trash2 size={13} /></button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle={`MVR ${totalSpend.toFixed(2)} received · MVR ${pendingValue.toFixed(2)} pending`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => setSupplierModal(true)}><Plus size={15} /> Supplier</Button>
            <Button onClick={openBatchAdd}><Plus size={15} /> Batch order</Button>
          </div>
        }
      />

      {/* Low stock suggestion banner */}
      {lowStockProducts.length > 0 && (
        <div style={{ background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 12, padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ background: '#FBE6BE', borderRadius: 10, padding: 9, flexShrink: 0, display: 'flex' }}>
            <AlertTriangle size={18} color="#f57f17" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#854F0B', marginBottom: 4 }}>
              {lowStockProducts.length} {lowStockProducts.length === 1 ? 'product needs' : 'products need'} restocking
            </div>
            <div style={{ fontSize: 12, color: '#a16d0a' }}>
              {lowStockProducts.slice(0, 5).map(p => `${p.name} (${p.stock_qty})`).join(' · ')}
              {lowStockProducts.length > 5 && ` and ${lowStockProducts.length - 5} more...`}
            </div>
          </div>
          <Button onClick={openBatchAdd}>Create batch order</Button>
        </div>
      )}

      {/* Suppliers chips */}
      {suppliers.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {suppliers.map(s => {
            const main = s.contact_name || s.name
            return (
            <div key={s.id} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 99, padding: '5px 14px 5px 7px', fontSize: 12, color: '#555', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar name={main} size={22} />
              <div>
                <span style={{ fontWeight: 600, color: '#0d1b2a' }}>{main}</span>
                {s.contact_name && <span style={{ color: '#aaa', marginLeft: 5 }}>{s.name}</span>}
              </div>
              {s.phone && <span style={{ color: '#aaa' }}>· {s.phone}</span>}
            </div>
            )
          })}
        </div>
      )}

      <Card>
        {/* Tabs: Ongoing | History */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 18, borderBottom: '1px solid #f0f0f0' }}>
          {[{ k: 'ongoing', label: 'Ongoing', count: ongoingGroups.length }, { k: 'history', label: 'History', count: historyGroups.length }].map(t => {
            const active = viewTab === t.k
            return (
              <button key={t.k} onClick={() => setViewTab(t.k)} style={{
                background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                padding: '9px 16px', fontSize: 13, fontWeight: 700, marginBottom: -1,
                color: active ? '#FFA500' : '#999',
                borderBottom: active ? '2px solid #FFA500' : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: 7,
              }}>
                {t.label}
                <span style={{ fontSize: 11, fontWeight: 700, background: active ? '#FFF3D6' : '#f0f0f0', color: active ? '#b8740a' : '#aaa', borderRadius: 99, padding: '1px 7px' }}>{t.count}</span>
              </button>
            )
          })}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {viewTab === 'ongoing' && ongoingGroups.length > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllReceived}>
                <Truck size={13} /> Mark all received
              </Button>
            )}
            {/* View switcher */}
            <div style={{ display: 'flex', gap: 2, background: '#f5f5f5', borderRadius: 9, padding: 3 }}>
              {[{ k: 'detailed', icon: LayoutList, title: 'Detailed cards' }, { k: 'compact', icon: LayoutGrid, title: 'Mini-card grid' }, { k: 'table', icon: List, title: 'Compact table' }].map(v => {
                const Icon = v.icon
                const active = listView === v.k
                return (
                  <button key={v.k} onClick={() => switchView(v.k)} title={v.title}
                    style={{ background: active ? '#fff' : 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', padding: '6px 9px', display: 'flex', alignItems: 'center', color: active ? '#FFA500' : '#999', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                    <Icon size={15} />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {loading ? <Spinner /> : poGroups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 0', color: '#c4c4c4', fontSize: 14 }}>
            <Package size={36} color="#e0e0e0" style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 500 }}>No purchase orders yet. Click 'Batch order' to create one.</div>
          </div>
        ) : displayGroups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#c4c4c4', fontSize: 14 }}>
            <Package size={32} color="#e0e0e0" style={{ marginBottom: 10 }} />
            <div style={{ fontWeight: 500 }}>{viewTab === 'history' ? 'No completed orders yet. Received orders appear here.' : 'No ongoing orders. All caught up!'}</div>
          </div>
        ) : listView === 'table' ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['Supplier', 'Products', 'Qty', 'Total', 'Status', 'Payment', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, color: '#bbb', borderBottom: '2px solid #f0f0f0', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {displayGroups.map(g => renderTableRow(g))}
              </tbody>
            </table>
          </div>
        ) : listView === 'compact' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {displayGroups.map(g => renderMiniCard(g))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {displayGroups.map(g => renderBatchCard(g))}
          </div>
        )}
      </Card>

      {/* Batch order modal */}
      {batchModal && (
        <Modal title="Create batch purchase order" subtitle="Order multiple products from a supplier in one go" onClose={() => setBatchModal(false)} width={780}>
          <FormRow>
            <Select label="Supplier" value={batchForm.supplier_id} onChange={handleSupplierChange}
              options={[{ value: '', label: '— Select or type below —' }, ...suppliers.map(s => ({ value: s.id, label: s.contact_name ? `${s.contact_name} (${s.name})` : s.name }))]} />
            <Input label="Order date" type="date" value={batchForm.order_date} onChange={e => setBatchForm(p => ({ ...p, order_date: e.target.value }))} />
            <Input label="Expected delivery" type="date" value={batchForm.expected_date} onChange={e => setBatchForm(p => ({ ...p, expected_date: e.target.value }))} />
          </FormRow>

          {/* Items table */}
          <div style={{ marginTop: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Items ({batchForm.items.length})</span>
              <Button variant="ghost" size="sm" onClick={addItem}><Plus size={13} /> Add item</Button>
            </div>
            <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'visible' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase' }}>Product</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase' }}>Stock</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 80 }}>Qty</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 110 }}>Unit cost</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 110 }}>Total</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {batchForm.items.map((item, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid #f5f5f5' }}>
                      <td style={{ padding: 6 }}>
                        {item.product_id ? (
                          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 8px', border:'1px solid #ddd', borderRadius:6, background:'#fff' }}>
                            {item.image_url && <img src={item.image_url} style={{width:24,height:24,objectFit:'contain',borderRadius:4}} onError={e=>e.target.style.display='none'} />}
                            <span style={{flex:1,fontSize:12,color:'#0d1b2a'}}>{item.product_name}</span>
                            <button onClick={() => updateItem(idx,'product_id','')} style={{background:'none',border:'none',cursor:'pointer',color:'#aaa',padding:0}}><X size={12}/></button>
                          </div>
                        ) : (
                          <div style={{position:'relative'}}>
                            <input
                              value={itemSearch[idx]||''}
                              onChange={e => setItemSearch(p=>({...p,[idx]:e.target.value}))}
                              onFocus={() => setFocusedRow(idx)}
                              onBlur={() => setTimeout(() => setFocusedRow(f => f === idx ? null : f), 180)}
                              placeholder="Search product..."
                              style={{width:'100%',padding:'6px 8px',border:'1px solid #ddd',borderRadius:6,fontSize:12,fontFamily:'inherit',boxSizing:'border-box'}}
                              autoFocus={idx===batchForm.items.length-1}
                            />
                            {(focusedRow === idx || (itemSearch[idx]||'').length > 0) && (() => {
                              const q = (itemSearch[idx]||'').toLowerCase()
                              const suppId = batchForm.supplier_id
                              const catItems = supplierCatalog
                                .filter(p => (!suppId || p.supplier_id === suppId) && (!q || p.product_name?.toLowerCase().includes(q)))
                              const invItems = products
                                .filter(p => !q || p.name?.toLowerCase().includes(q))
                                .slice(0, q ? 20 : 5)
                              const total = catItems.length + invItems.length
                              if (total === 0) return null
                              return (
                                <div style={{position:'absolute',top:'100%',left:0,right:0,marginTop:4,background:'#fff',border:'1px solid #e0e0e0',borderRadius:8,boxShadow:'0 8px 28px rgba(0,0,0,0.16)',zIndex:9999,maxHeight:300,overflowY:'auto'}}>
                                  {catItems.length > 0 && <div style={{padding:'4px 10px',fontSize:10,fontWeight:700,color:'#FFA500',textTransform:'uppercase',letterSpacing:'0.5px',borderBottom:'1px solid #f5f5f5'}}>Supplier Catalog</div>}
                                  {catItems.map(p => (
                                    <div key={'cat:'+p.id} onClick={() => { updateItem(idx,'product_id','cat:'+p.id); setItemSearch(s=>({...s,[idx]:''})) }}
                                      style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',cursor:'pointer',fontSize:12,color:'#0d1b2a',borderBottom:'1px solid #f9f9f9'}}
                                      onMouseEnter={e=>e.currentTarget.style.background='#FFF8E0'}
                                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                                      {p.image_url && <img src={p.image_url} style={{width:22,height:22,objectFit:'contain',borderRadius:4,flexShrink:0}} onError={e=>e.target.style.display='none'} />}
                                      <div style={{flex:1}}>
                                        <div>{p.product_name}</div>
                                        {p.cost_price && <div style={{fontSize:10,color:'#aaa'}}>Cost: MVR {Number(p.cost_price).toFixed(2)}</div>}
                                      </div>
                                      {p.sku && <span style={{fontSize:10,color:'#ccc'}}>{p.sku}</span>}
                                    </div>
                                  ))}
                                  {invItems.length > 0 && <div style={{padding:'4px 10px',fontSize:10,fontWeight:700,color:'#378ADD',textTransform:'uppercase',letterSpacing:'0.5px',borderBottom:'1px solid #f5f5f5',marginTop:catItems.length?4:0}}>Inventory</div>}
                                  {invItems.map(p => (
                                    <div key={p.id} onClick={() => { updateItem(idx,'product_id',p.id); setItemSearch(s=>({...s,[idx]:''})) }}
                                      style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',cursor:'pointer',fontSize:12,color:'#0d1b2a',borderBottom:'1px solid #f9f9f9'}}
                                      onMouseEnter={e=>e.currentTarget.style.background='#f0f7ff'}
                                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                                      <div style={{flex:1}}>
                                        <div>{p.name}</div>
                                        <div style={{fontSize:10,color:'#aaa'}}>Stock: {p.stock_qty}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )
                            })()}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: item.current_stock <= 10 ? '#c62828' : '#888' }}>
                        {item.product_id ? item.current_stock : '—'}
                      </td>
                      <td style={{ padding: 6 }}>
                        <input type="number" min="1" value={item.qty} onChange={e => updateItem(idx, 'qty', e.target.value)}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: 6 }}>
                        <input type="number" step="0.01" min="0" value={item.unit_cost} onChange={e => updateItem(idx, 'unit_cost', e.target.value)}
                          style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>
                        MVR {(parseFloat(item.qty || 0) * parseFloat(item.unit_cost || 0)).toFixed(2)}
                      </td>
                      <td>
                        <button onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', padding: 4 }}>
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#fafafa', borderTop: '2px solid #eee' }}>
                    <td colSpan={4} style={{ padding: '10px', fontWeight: 700, color: '#0d1b2a' }}>Batch total</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: '#FFA500' }}>MVR {batchTotal.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Additional costs */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Additional costs ({(batchForm.extraCosts || []).length})</span>
              <Button variant="ghost" size="sm" onClick={addCost}><Plus size={13} /> Add cost</Button>
            </div>
            {(batchForm.extraCosts || []).length > 0 && (
              <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase' }}>Cost type</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 140 }}>Amount (MVR)</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(batchForm.extraCosts || []).map((c, idx) => (
                      <tr key={idx} style={{ borderTop: '1px solid #f5f5f5' }}>
                        <td style={{ padding: 6 }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select value={c.type} onChange={e => updateCost(idx, 'type', e.target.value)}
                              style={{ flex: c.type === 'Other' ? '0 0 130px' : 1, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: '#fff' }}>
                              {COST_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {c.type === 'Other' && (
                              <input value={c.label} onChange={e => updateCost(idx, 'label', e.target.value)} placeholder="Specify cost..."
                                style={{ flex: 1, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }} />
                            )}
                          </div>
                        </td>
                        <td style={{ padding: 6 }}>
                          <input type="number" step="0.01" min="0" value={c.amount} onChange={e => updateCost(idx, 'amount', e.target.value)} placeholder="0.00"
                            style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', textAlign: 'right', boxSizing: 'border-box' }} />
                        </td>
                        <td>
                          <button onClick={() => removeCost(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', padding: 4 }}>
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Grand total summary */}
          {batchCostsTotal > 0 && (
            <div style={{ background: '#FFF8E0', border: '1px solid #FAEEDA', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', marginBottom: 5 }}><span>Products</span><span>MVR {batchItemsTotal.toFixed(2)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', marginBottom: 8 }}><span>Additional costs</span><span>MVR {batchCostsTotal.toFixed(2)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#0d1b2a', borderTop: '1px solid #FAEEDA', paddingTop: 8 }}><span>Grand total</span><span style={{ color: '#FFA500' }}>MVR {batchTotal.toFixed(2)}</span></div>
            </div>
          )}

          <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={15} color="#aaa" style={{ flexShrink: 0 }} />
            <span>When you mark items as <strong style={{ color: '#555', fontWeight: 600 }}>Received</strong>, stock will be automatically added to inventory.</span>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setBatchModal(false)}>Cancel</Button>
            <Button onClick={saveBatch} disabled={saving}>{saving ? 'Saving…' : `Create batch order (${batchForm.items.filter(i => i.product_id).length} items)`}</Button>
          </div>
        </Modal>
      )}

      {/* Supplier modal */}
      {supplierModal && (
        <Modal title="Add supplier" subtitle="Save a vendor to reuse on future orders" onClose={() => setSupplierModal(false)}>
          <FormRow>
            <Input label="Supplier name *" value={supplierForm.name} onChange={sf('name')} placeholder="e.g. LEGO, Mattel" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Input label="Contact person" value={supplierForm.contact_name} onChange={sf('contact_name')} placeholder="Name" />
            <Input label="Phone" value={supplierForm.phone} onChange={sf('phone')} placeholder="+1 xxx xxx xxxx" />
          </FormRow>
          <FormRow>
            <Input label="Email" type="email" value={supplierForm.email} onChange={sf('email')} placeholder="orders@supplier.com" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <Input label="Address" value={supplierForm.address} onChange={sf('address')} placeholder="City, Country" style={{ marginBottom: 16 }} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setSupplierModal(false)}>Cancel</Button>
            <Button onClick={saveSupplier} disabled={saving}>{saving ? 'Saving…' : 'Add supplier'}</Button>
          </div>
        </Modal>
      )}
      {/* Payment modal */}
      {payModal && (() => {
        const modalTotal = payModal._groupTotal || Number(payModal.total_cost || 0)
        const modalPaid = payModal._groupPaid ?? payments.filter(p => p.purchase_order_id === payModal.id).reduce((s, p) => s + Number(p.amount), 0)
        const groupPayments = payments.filter(p => payModal._groupIds?.includes(p.purchase_order_id) || p.purchase_order_id === payModal.id)
        const sd = supplierDisplay(payModal.supplier_id, payModal.supplier_name)
        return (
        <Modal title="Record Payment" subtitle={`${sd.main}${sd.sub ? ` · ${sd.sub}` : ''} — MVR ${modalTotal.toFixed(2)} total`} onClose={() => setPayModal(null)} width={500}>
          <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: '#bbb', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Outstanding Balance</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#E24B4A' }}>MVR {Math.max(0, modalTotal - modalPaid).toFixed(2)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#bbb', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Already Paid</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1D9E75' }}>MVR {modalPaid.toFixed(2)}</div>
            </div>
          </div>

          {/* Past invoices / payments for this batch */}
          {groupPayments.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Previous payments ({groupPayments.length})</div>
              <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                {groupPayments.map((p, i) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: i < groupPayments.length - 1 ? '1px solid #f5f5f5' : 'none', fontSize: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600, color: '#0d1b2a' }}>MVR {Number(p.amount).toFixed(2)}</div>
                      <div style={{ fontSize: 11, color: '#aaa' }}>{p.payment_date} · {p.payment_method}{p.reference ? ` · ${p.reference}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {Array.isArray(p.slips) && p.slips.length > 0 && (
                        <button onClick={() => setViewSlips({ slips: p.slips, title: `Payslips · MVR ${Number(p.amount).toFixed(2)}` })}
                          title={`View ${p.slips.length} payslip(s)`}
                          style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#f5f5f5', border: 'none', borderRadius: 99, padding: '3px 8px', cursor: 'pointer', color: '#555', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                          <Paperclip size={11} /> {p.slips.length}
                        </button>
                      )}
                      <button onClick={async () => { if (window.confirm('Delete this payment?')) { await supabase.from('supplier_payments').delete().eq('id', p.id); load(); setPayModal(null) } }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E24B4A', padding: 4 }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Add payment</div>
          <FormRow>
            <Input label="Amount (MVR) *" type="number" min="0" step="0.01" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} />
            <Input label="Payment date" type="date" value={payForm.payment_date} onChange={e => setPayForm(p => ({ ...p, payment_date: e.target.value }))} />
          </FormRow>
          <Select label="Payment method" value={payForm.payment_method} onChange={e => setPayForm(p => ({ ...p, payment_method: e.target.value }))}
            options={['Bank Transfer', 'Cash', 'Cheque', 'Online Transfer', 'Other']} style={{ marginBottom: 14 }} />
          <Input label="Reference / Transaction ID" value={payForm.reference} onChange={e => setPayForm(p => ({ ...p, reference: e.target.value }))} placeholder="TXN-12345 (optional)" style={{ marginBottom: 14 }} />
          <Input label="Notes" value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" style={{ marginBottom: 14 }} />

          {/* Payslip uploads — one or more */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Payslips ({(payForm.slips || []).length})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {(payForm.slips || []).map((s, i) => (
                <div key={i} style={{ position: 'relative', width: 64, height: 64, borderRadius: 8, overflow: 'hidden', border: '1px solid #eee', background: '#f8f7f4' }}>
                  {s.type && s.type.startsWith('image/')
                    ? <img src={s.url} alt={s.name} title={s.name} onClick={() => setViewSlips({ slips: payForm.slips, title: 'New payslips' })} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} />
                    : <div title={s.name} onClick={() => setViewSlips({ slips: payForm.slips, title: 'New payslips' })} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', padding: 4, textAlign: 'center' }}>
                        <Paperclip size={16} color="#888" />
                        <span style={{ fontSize: 8, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{s.name}</span>
                      </div>}
                  <button onClick={() => setPayForm(p => ({ ...p, slips: p.slips.filter((_, j) => j !== i) }))}
                    style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                    <X size={10} />
                  </button>
                </div>
              ))}
              <label style={{ width: 64, height: 64, borderRadius: 8, border: '1.5px dashed #ddd', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', color: '#999' }}>
                <Plus size={18} />
                <span style={{ fontSize: 9 }}>Add</span>
                <input type="file" accept="image/*,application/pdf" multiple onChange={e => { addSlipFiles(e.target.files); e.target.value = '' }} style={{ display: 'none' }} />
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setPayModal(null)}>Done</Button>
            <Button onClick={recordPayment}><CreditCard size={13} /> Record Payment</Button>
          </div>
        </Modal>
        )
      })()}

      {/* Payslip viewer */}
      {viewSlips && (
        <Modal title={viewSlips.title || 'Payslips'} subtitle={`${viewSlips.slips.length} file(s)`} onClose={() => setViewSlips(null)} width={560}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {viewSlips.slips.map((s, i) => (
              <div key={i}>
                {s.type && s.type === 'application/pdf'
                  ? <a href={s.url} download={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', border: '1px solid #eee', borderRadius: 10, color: '#0d1b2a', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
                      <Paperclip size={14} /> {s.name || `Payslip ${i + 1}`} <span style={{ color: '#FFA500', marginLeft: 'auto', fontSize: 12 }}>Download</span>
                    </a>
                  : <img src={s.url} alt={s.name || `Payslip ${i + 1}`} style={{ width: '100%', borderRadius: 10, border: '1px solid #eee', objectFit: 'contain' }} />}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Edit payment modal */}
      {editPayModal && (() => {
        const sd = supplierDisplay(editPayModal.supplier_id, editPayModal.supplier_name)
        const costsTotal = (editPayForm.newCosts || []).reduce((s, c) => s + parseFloat(c.amount || 0), 0)
        return (
        <Modal title="Edit Payment" subtitle={`${sd.main}${sd.sub ? ` · ${sd.sub}` : ''}`} onClose={() => setEditPayModal(null)} width={520}>
          <FormRow>
            <Input label="Amount (MVR) *" type="number" min="0" step="0.01" value={editPayForm.amount} onChange={e => setEditPayForm(p => ({ ...p, amount: e.target.value }))} />
            <Input label="Payment date" type="date" value={editPayForm.payment_date} onChange={e => setEditPayForm(p => ({ ...p, payment_date: e.target.value }))} />
          </FormRow>
          <Select label="Payment method" value={editPayForm.payment_method} onChange={e => setEditPayForm(p => ({ ...p, payment_method: e.target.value }))}
            options={['Bank Transfer', 'Cash', 'Cheque', 'Online Transfer', 'Other']} style={{ marginBottom: 14 }} />
          <Input label="Reference / Transaction ID" value={editPayForm.reference} onChange={e => setEditPayForm(p => ({ ...p, reference: e.target.value }))} placeholder="TXN-12345 (optional)" style={{ marginBottom: 14 }} />
          <Input label="Notes" value={editPayForm.notes} onChange={e => setEditPayForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" style={{ marginBottom: 14 }} />

          {/* Payslips */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Payslips ({(editPayForm.slips || []).length})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {(editPayForm.slips || []).map((s, i) => (
                <div key={i} style={{ position: 'relative', width: 64, height: 64, borderRadius: 8, overflow: 'hidden', border: '1px solid #eee', background: '#f8f7f4' }}>
                  {s.type && s.type.startsWith('image/')
                    ? <img src={s.url} alt={s.name} title={s.name} onClick={() => setViewSlips({ slips: editPayForm.slips, title: 'Payslips' })} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} />
                    : <div title={s.name} onClick={() => setViewSlips({ slips: editPayForm.slips, title: 'Payslips' })} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', padding: 4, textAlign: 'center' }}>
                        <Paperclip size={16} color="#888" />
                        <span style={{ fontSize: 8, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{s.name}</span>
                      </div>}
                  <button onClick={() => setEditPayForm(p => ({ ...p, slips: p.slips.filter((_, j) => j !== i) }))}
                    style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                    <X size={10} />
                  </button>
                </div>
              ))}
              <label style={{ width: 64, height: 64, borderRadius: 8, border: '1.5px dashed #ddd', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', color: '#999' }}>
                <Plus size={18} />
                <span style={{ fontSize: 9 }}>Add</span>
                <input type="file" accept="image/*,application/pdf" multiple onChange={e => { addEditSlipFiles(e.target.files); e.target.value = '' }} style={{ display: 'none' }} />
              </label>
            </div>
          </div>

          {/* Add extra costs to the order under this transaction */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Add costs to this order ({(editPayForm.newCosts || []).length})</span>
              <Button variant="ghost" size="sm" onClick={() => setEditPayForm(p => ({ ...p, newCosts: [...(p.newCosts || []), { type: 'Alibaba transaction charge', label: '', amount: '' }] }))}><Plus size={13} /> Add cost</Button>
            </div>
            {(editPayForm.newCosts || []).length > 0 && (
              <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <tbody>
                    {(editPayForm.newCosts || []).map((c, idx) => (
                      <tr key={idx} style={{ borderTop: idx ? '1px solid #f5f5f5' : 'none' }}>
                        <td style={{ padding: 6 }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select value={c.type} onChange={e => setEditPayForm(p => ({ ...p, newCosts: p.newCosts.map((x, i) => i === idx ? { ...x, type: e.target.value } : x) }))}
                              style={{ flex: c.type === 'Other' ? '0 0 130px' : 1, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: '#fff' }}>
                              {COST_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {c.type === 'Other' && (
                              <input value={c.label} onChange={e => setEditPayForm(p => ({ ...p, newCosts: p.newCosts.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) }))} placeholder="Specify..."
                                style={{ flex: 1, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }} />
                            )}
                          </div>
                        </td>
                        <td style={{ padding: 6, width: 120 }}>
                          <input type="number" step="0.01" min="0" value={c.amount} onChange={e => setEditPayForm(p => ({ ...p, newCosts: p.newCosts.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x) }))} placeholder="0.00"
                            style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', textAlign: 'right', boxSizing: 'border-box' }} />
                        </td>
                        <td style={{ width: 34 }}>
                          <button onClick={() => setEditPayForm(p => ({ ...p, newCosts: p.newCosts.filter((_, i) => i !== idx) }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', padding: 4 }}><X size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {costsTotal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 12 }}>
                <span style={{ color: '#888' }}>Costs to add: <strong style={{ color: '#0d1b2a' }}>MVR {costsTotal.toFixed(2)}</strong></span>
                <button onClick={() => setEditPayForm(p => ({ ...p, amount: (parseFloat(p.amount || 0) + costsTotal).toFixed(2) }))}
                  style={{ background: '#FFF3D6', color: '#b8740a', border: 'none', borderRadius: 7, cursor: 'pointer', padding: '5px 10px', fontSize: 11, fontWeight: 700, fontFamily: 'inherit' }}>
                  + Add to payment amount
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
            <Button variant="danger" onClick={() => deletePaymentRecord(editPayModal)}><Trash2 size={13} /> Delete</Button>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="ghost" onClick={() => setEditPayModal(null)}>Cancel</Button>
              <Button onClick={saveEditPayment} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </div>
        </Modal>
        )
      })()}

      {/* Payments history panel */}
      {payments.length > 0 && (
        <Card style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ background: '#E1F5EE', borderRadius: 8, padding: 7 }}><Wallet size={14} color="#1D9E75" /></div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a' }}>Payment History</div>
                <div style={{ fontSize: 11, color: '#bbb' }}>Total paid: MVR {payments.reduce((s, p) => s + Number(p.amount), 0).toFixed(2)}</div>
              </div>
            </div>
            <button onClick={() => setPaymentsTab(p => !p)} style={{ fontSize: 12, color: '#FFA500', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
              {paymentsTab ? 'Hide' : `Show all (${payments.length})`}
            </button>
          </div>
          {paymentsTab && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>{['Date','Supplier','PO Product','Amount','Method','Reference','Slip',''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '7px 12px', fontSize: 11, color: '#bbb', borderBottom: '1px solid #f0f0f0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {payments.map((p, i) => {
                  const po = pos.find(o => o.id === p.purchase_order_id)
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '9px 12px', color: '#888', fontSize: 12 }}>{p.payment_date}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 500 }}>{(() => { const sd = supplierDisplay(p.supplier_id, p.supplier_name); return <div><div>{sd.main}</div>{sd.sub && <div style={{fontSize:11,color:'#aaa'}}>{sd.sub}</div>}</div> })()}</td>
                      <td style={{ padding: '9px 12px', color: '#666', fontSize: 12 }}>{po?.product_name || '—'}</td>
                      <td style={{ padding: '9px 12px', fontWeight: 700, color: '#1D9E75' }}>MVR {Number(p.amount).toFixed(2)}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12 }}><span style={{ background: '#f5f5f5', padding: '2px 8px', borderRadius: 99, fontWeight: 500 }}>{p.payment_method}</span></td>
                      <td style={{ padding: '9px 12px', color: '#aaa', fontSize: 11 }}>{p.reference || '—'}</td>
                      <td style={{ padding: '9px 12px' }}>
                        {Array.isArray(p.slips) && p.slips.length > 0 ? (
                          <button onClick={() => setViewSlips({ slips: p.slips, title: `Payslips · MVR ${Number(p.amount).toFixed(2)}` })}
                            title={`View ${p.slips.length} payslip(s)`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#E1F5EE', border: '1px solid #bfe6d6', borderRadius: 99, padding: '3px 9px', cursor: 'pointer', color: '#1D9E75', fontSize: 11, fontWeight: 600, fontFamily: 'inherit' }}>
                            <Paperclip size={11} /> {p.slips.length}
                          </button>
                        ) : <span style={{ color: '#ddd', fontSize: 12 }}>—</span>}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                          <button onClick={() => openEditPayment(p)} title="Edit payment / add costs"
                            style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 7, cursor: 'pointer', padding: 6, display: 'flex', color: '#666' }}>
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => deletePaymentRecord(p)} title="Delete payment"
                            style={{ background: '#fff', border: '1px solid #f3d6d6', borderRadius: 7, cursor: 'pointer', padding: 6, display: 'flex', color: '#E24B4A' }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* Slip modal */}
      {slipModal && (
        <Modal title="Payment Slip" subtitle={`${slipModal.product_name} — ${slipModal.supplier_name || ''}`} onClose={() => setSlipModal(null)} width={520}>
          {slipModal.slip_url ? (
            <div>
              <img src={slipModal.slip_url} alt="Payment slip" style={{ width: '100%', borderRadius: 10, border: '1px solid #eee', marginBottom: 16, maxHeight: 400, objectFit: 'contain' }} />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                <Button variant="ghost" onClick={() => { const a = document.createElement('a'); a.href = slipModal.slip_url; a.download = 'slip.jpg'; a.click() }}>Download</Button>
                <div style={{ display: 'flex', gap: 10 }}>
                  <label style={{ cursor: 'pointer' }}>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => uploadSlip(e.target.files[0])} />
                    <Button variant="ghost" as="span">Replace</Button>
                  </label>
                  <Button variant="danger" onClick={async () => { await supabase.from('purchase_orders').update({ slip_url: null }).eq('id', slipModal.id); toast.success('Slip removed'); setSlipModal(null); load() }}>Remove</Button>
                </div>
              </div>
            </div>
          ) : (
            <label
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#FFA500' }}
              onDragLeave={e => e.currentTarget.style.borderColor = '#e0e0e0'}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#e0e0e0'; uploadSlip(e.dataTransfer.files[0]) }}
              style={{ display: 'block', border: '2px dashed #e0e0e0', borderRadius: 12, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s' }}>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => uploadSlip(e.target.files[0])} />
              <Paperclip size={32} color="#ccc" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: '#555', marginBottom: 6 }}>{slipUploading ? 'Uploading…' : 'Drag & drop or click to upload'}</div>
              <div style={{ fontSize: 12, color: '#aaa' }}>Payment receipt, bank slip, or invoice image</div>
            </label>
          )}
        </Modal>
      )}

      {/* Edit batch order modal */}
      {editGroupModal && (
        <Modal title="Edit batch order" subtitle="Add more products to this order" onClose={() => setEditGroupModal(null)} width={780}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: '#999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Supplier</label>
              <div style={{ padding: '8px 12px', border: '1px solid #eee', borderRadius: 8, fontSize: 13, color: '#0d1b2a', fontWeight: 600, background: '#fafafa' }}>
                {(() => { const sd = supplierDisplay(editGroupModal.supplier_id, editGroupModal.supplier_name); return sd.sub ? `${sd.main} (${sd.sub})` : sd.main })()}
              </div>
            </div>
            <Input label="Expected delivery" type="date" value={editGroupModal.expected_date}
              onChange={e => setEditGroupModal(p => ({ ...p, expected_date: e.target.value }))} />
          </div>

          {/* Existing products (editable qty + remove) */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>
              Existing items ({editGroupModal.existingItems.length})
            </div>
            {editGroupModal.existingItems.length > 0 ? (
            <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase' }}>Product</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 90 }}>Qty</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 110 }}>Unit cost</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 100 }}>Total</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {editGroupModal.existingItems.map((it, idx) => (
                    <tr key={it.id} style={{ borderTop: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '7px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          {it.image_url && <img src={it.image_url} style={{ width: 24, height: 24, objectFit: 'contain', borderRadius: 4 }} onError={e => e.target.style.display='none'} />}
                          <span style={{ fontWeight: 500, color: '#0d1b2a' }}>{it.product_name}</span>
                        </div>
                      </td>
                      <td style={{ padding: 6 }}>
                        <input type="number" min="1" value={it.qty}
                          onChange={e => setEditGroupModal(p => ({ ...p, existingItems: p.existingItems.map((x,i) => i===idx ? {...x, qty: e.target.value} : x) }))}
                          style={{ width:'100%', padding:'6px 8px', border:'1px solid #ddd', borderRadius:6, fontSize:12, fontFamily:'inherit', textAlign:'right' }} />
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: '#555' }}>MVR {Number(it.unit_cost).toFixed(2)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>MVR {(parseFloat(it.qty||0) * Number(it.unit_cost||0)).toFixed(2)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button onClick={() => setEditGroupModal(p => ({ ...p, existingItems: p.existingItems.filter((_,i) => i!==idx), removedIds: [...p.removedIds, it.id] }))}
                          title="Remove item" style={{ background:'none', border:'none', cursor:'pointer', color:'#c62828', padding:4 }}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '14px 0', color: '#E24B4A', fontSize: 12, background: '#fef6f6', borderRadius: 8 }}>All items removed — add new items below or deleting will empty this order</div>
            )}
          </div>

          {/* New items to add */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#378ADD', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Add new items ({editGroupModal.newItems.length})</span>
              <Button variant="ghost" size="sm" onClick={() => setEditGroupModal(p => ({ ...p, newItems: [...p.newItems, { product_id: '', product_name: '', qty: 1, unit_cost: 0, current_stock: 0 }] }))}><Plus size={13} /> Add item</Button>
            </div>
            {editGroupModal.newItems.length > 0 && (
              <div style={{ border: '1px solid #d0e8ff', borderRadius: 10, overflow: 'visible', background: '#f8fbff' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#edf5ff' }}>
                      <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: '#378ADD', fontSize: 11, textTransform: 'uppercase' }}>Product</th>
                      <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#378ADD', fontSize: 11, textTransform: 'uppercase', width: 80 }}>Qty</th>
                      <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#378ADD', fontSize: 11, textTransform: 'uppercase', width: 110 }}>Unit cost</th>
                      <th style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#378ADD', fontSize: 11, textTransform: 'uppercase', width: 100 }}>Total</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editGroupModal.newItems.map((item, idx) => (
                      <tr key={idx} style={{ borderTop: '1px solid #e0eefc' }}>
                        <td style={{ padding: 6 }}>
                          {item.product_id ? (
                            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 8px', border:'1px solid #ddd', borderRadius:6, background:'#fff' }}>
                              {item.image_url && <img src={item.image_url} style={{width:24,height:24,objectFit:'contain',borderRadius:4}} onError={e=>e.target.style.display='none'} />}
                              <span style={{flex:1,fontSize:12,color:'#0d1b2a'}}>{item.product_name}</span>
                              <button onClick={() => setEditGroupModal(p => ({ ...p, newItems: p.newItems.map((x,i) => i===idx ? {...x, product_id:'', product_name:''} : x) }))} style={{background:'none',border:'none',cursor:'pointer',color:'#aaa',padding:0}}><X size={12}/></button>
                            </div>
                          ) : (
                            <div style={{position:'relative'}}>
                              <input
                                value={itemSearch[`edit_${idx}`]||''}
                                onChange={e => setItemSearch(p=>({...p,[`edit_${idx}`]:e.target.value}))}
                                onFocus={() => setFocusedRow(`edit_${idx}`)}
                                onBlur={() => setTimeout(() => setFocusedRow(f => f === `edit_${idx}` ? null : f), 180)}
                                placeholder="Search product..."
                                style={{width:'100%',padding:'6px 8px',border:'1px solid #c8e0fc',borderRadius:6,fontSize:12,fontFamily:'inherit',boxSizing:'border-box',background:'#fff'}}
                                autoFocus={idx===editGroupModal.newItems.length-1}
                              />
                              {(focusedRow === `edit_${idx}` || (itemSearch[`edit_${idx}`]||'').length > 0) && (() => {
                                const q = (itemSearch[`edit_${idx}`]||'').toLowerCase()
                                const suppId = editGroupModal.supplier_id
                                const catItems = supplierCatalog.filter(p => (!suppId || p.supplier_id === suppId) && (!q || p.product_name?.toLowerCase().includes(q)))
                                const invItems = products.filter(p => !q || p.name?.toLowerCase().includes(q)).slice(0, q ? 20 : 5)
                                if (catItems.length + invItems.length === 0) return null
                                return (
                                  <div style={{position:'absolute',top:'100%',left:0,right:0,marginTop:4,background:'#fff',border:'1px solid #e0e0e0',borderRadius:8,boxShadow:'0 8px 28px rgba(0,0,0,0.16)',zIndex:9999,maxHeight:280,overflowY:'auto'}}>
                                    {catItems.length > 0 && <div style={{padding:'4px 10px',fontSize:10,fontWeight:700,color:'#FFA500',textTransform:'uppercase',letterSpacing:'0.5px',borderBottom:'1px solid #f5f5f5'}}>Supplier Catalog</div>}
                                    {catItems.map(p => (
                                      <div key={'cat:'+p.id} onClick={() => {
                                        setEditGroupModal(prev => ({ ...prev, newItems: prev.newItems.map((x,i) => i===idx ? {...x, product_id:'cat:'+p.id, product_name: p.product_name, unit_cost: p.cost_price || 0, image_url: p.image_url || ''} : x) }))
                                        setItemSearch(s=>({...s,[`edit_${idx}`]:''}))
                                      }} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',cursor:'pointer',fontSize:12,borderBottom:'1px solid #f9f9f9'}}
                                      onMouseEnter={e=>e.currentTarget.style.background='#FFF8E0'}
                                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                                        {p.image_url && <img src={p.image_url} style={{width:22,height:22,objectFit:'contain',borderRadius:4}} onError={e=>e.target.style.display='none'} />}
                                        <div style={{flex:1}}><div>{p.product_name}</div>{p.cost_price && <div style={{fontSize:10,color:'#aaa'}}>MVR {Number(p.cost_price).toFixed(2)}</div>}</div>
                                      </div>
                                    ))}
                                    {invItems.length > 0 && <div style={{padding:'4px 10px',fontSize:10,fontWeight:700,color:'#378ADD',textTransform:'uppercase',letterSpacing:'0.5px',borderBottom:'1px solid #f5f5f5'}}>Inventory</div>}
                                    {invItems.map(p => (
                                      <div key={p.id} onClick={() => {
                                        setEditGroupModal(prev => ({ ...prev, newItems: prev.newItems.map((x,i) => i===idx ? {...x, product_id: p.id, product_name: p.name, unit_cost: p.cost_price || 0, current_stock: p.stock_qty || 0, image_url: p.image_url || ''} : x) }))
                                        setItemSearch(s=>({...s,[`edit_${idx}`]:''}))
                                      }} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',cursor:'pointer',fontSize:12,borderBottom:'1px solid #f9f9f9'}}
                                      onMouseEnter={e=>e.currentTarget.style.background='#f0f7ff'}
                                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                                        <div style={{flex:1}}><div>{p.name}</div><div style={{fontSize:10,color:'#aaa'}}>Stock: {p.stock_qty}</div></div>
                                      </div>
                                    ))}
                                  </div>
                                )
                              })()}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: 6 }}>
                          <input type="number" min="1" value={item.qty}
                            onChange={e => setEditGroupModal(p => ({ ...p, newItems: p.newItems.map((x,i) => i===idx ? {...x, qty: e.target.value} : x) }))}
                            style={{ width:'100%', padding:'6px 8px', border:'1px solid #c8e0fc', borderRadius:6, fontSize:12, fontFamily:'inherit', textAlign:'right', background:'#fff' }} />
                        </td>
                        <td style={{ padding: 6 }}>
                          <input type="number" step="0.01" min="0" value={item.unit_cost}
                            onChange={e => setEditGroupModal(p => ({ ...p, newItems: p.newItems.map((x,i) => i===idx ? {...x, unit_cost: e.target.value} : x) }))}
                            style={{ width:'100%', padding:'6px 8px', border:'1px solid #c8e0fc', borderRadius:6, fontSize:12, fontFamily:'inherit', textAlign:'right', background:'#fff' }} />
                        </td>
                        <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:600 }}>
                          MVR {(parseFloat(item.qty||0) * parseFloat(item.unit_cost||0)).toFixed(2)}
                        </td>
                        <td>
                          <button onClick={() => setEditGroupModal(p => ({ ...p, newItems: p.newItems.filter((_,i) => i!==idx) }))} style={{ background:'none', border:'none', cursor:'pointer', color:'#c62828', padding:4 }}>
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {editGroupModal.newItems.length === 0 && (
              <div style={{ textAlign: 'center', padding: '18px 0', color: '#bbb', fontSize: 13 }}>Click "Add item" to add more products to this order</div>
            )}
          </div>

          {/* Additional costs (editable) */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Additional costs ({(editGroupModal.extraCosts || []).length})</span>
              <Button variant="ghost" size="sm" onClick={() => setEditGroupModal(p => ({ ...p, extraCosts: [...(p.extraCosts || []), { type: 'Alibaba transaction charge', label: '', amount: '' }] }))}><Plus size={13} /> Add cost</Button>
            </div>
            {(editGroupModal.extraCosts || []).length > 0 && (
              <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase' }}>Cost type</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#999', fontSize: 11, textTransform: 'uppercase', width: 140 }}>Amount (MVR)</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(editGroupModal.extraCosts || []).map((c, idx) => (
                      <tr key={idx} style={{ borderTop: '1px solid #f5f5f5' }}>
                        <td style={{ padding: 6 }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select value={c.type} onChange={e => setEditGroupModal(p => ({ ...p, extraCosts: p.extraCosts.map((x, i) => i === idx ? { ...x, type: e.target.value } : x) }))}
                              style={{ flex: c.type === 'Other' ? '0 0 130px' : 1, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: '#fff' }}>
                              {COST_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {c.type === 'Other' && (
                              <input value={c.label} onChange={e => setEditGroupModal(p => ({ ...p, extraCosts: p.extraCosts.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) }))} placeholder="Specify cost..."
                                style={{ flex: 1, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }} />
                            )}
                          </div>
                        </td>
                        <td style={{ padding: 6 }}>
                          <input type="number" step="0.01" min="0" value={c.amount} onChange={e => setEditGroupModal(p => ({ ...p, extraCosts: p.extraCosts.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x) }))} placeholder="0.00"
                            style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', textAlign: 'right', boxSizing: 'border-box' }} />
                        </td>
                        <td>
                          <button onClick={() => setEditGroupModal(p => ({
                            ...p,
                            extraCosts: p.extraCosts.filter((_, i) => i !== idx),
                            removedCostIds: c._id ? [...(p.removedCostIds || []), c._id] : (p.removedCostIds || []),
                          }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', padding: 4 }}>
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setEditGroupModal(null)}>Cancel</Button>
            <Button onClick={saveEditGroup} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
