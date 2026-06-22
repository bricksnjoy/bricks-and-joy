import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Modal, Spinner, FormRow, useToast, Toasts, Badge } from '../components/UI'
import {
  Plus, Trash2, Edit2, Eye, Search, Building2, Package, Truck,
  Barcode, QrCode, Upload, Download, FileSpreadsheet, Camera,
  ArrowUpDown, ChevronDown, CheckCircle, AlertTriangle, RefreshCw, X,
  LayoutGrid, List, Percent, MoreVertical
} from 'lucide-react'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

const AVATAR_COLORS = ['#7F77DD','#1D9E75','#FFA500','#378ADD','#E24B4A','#0F6E56']

const CATEGORIES = ['Building & Blocks','Action Figures','Dolls & Plush','Board Games','Outdoor & Sports','Educational','Vehicles & RC','Arts & Crafts','Puzzles','Other']
const AGE_RANGES = ['0–2','3–5','6–8','9–12','12+','All ages']
const UNITS = ['piece','box','set','pack','dozen','kg','litre']

// Header aliases the importer already understands — any Excel column NOT in this
// set is imported into the product's custom_fields under its original name.
const KNOWN_IMPORT_HEADERS = new Set([
  'product name','product','name','item','item name','product title','title',
  'cost price (mvr)','cost price','cost','buying price','purchase price','unit cost','buy price','our price','supplier price',
  'sell price (mvr)','sell price','delivery price','selling price','sale price','retail price','unit price','price','mrp','rate',
  'amount','value',
  'image url','image','photo url','photo','picture url','picture','img url','img',
  'sku','item code','product code','part no','part number','ref',
  'category','cat','type','group','dept','department',
  'brand','make','manufacturer',
  'age range','age','ages','age group',
  'pieces','piece','pcs','piece count','no of pieces',
  'sizes','size','weight','wt',
  'dimensions','dimension','size (cm)','measurements',
  'unit','uom','unit of measure','sold per',
  'description','desc','details','about',
  'tags','tag','labels',
  'notes','note','remarks','remark','comment',
])

// Ensure a select can display a value imported from Excel even when it isn't one
// of the predefined options (e.g. an unusual age range like "14+" or "8-12").
const withValue = (options, val) =>
  val && !options.includes(val) ? [val, ...options] : options

// Fields compared when re-importing a sheet to decide if an existing product is
// unchanged (duplicate), changed (update) or new.
const COMPARE_KEYS = ['category','brand','age_range','pieces','sizes','weight','dimensions','cost_price','sell_price','unit','description','tags','notes','image_url']
const NUMERIC_KEYS = new Set(['cost_price','sell_price','pieces'])
const normVal = v => (v == null ? '' : String(v).trim())
// Returns the set of field keys that differ between an imported row and an
// existing catalog record (numeric fields compared by value).
function diffFields(row, existing) {
  const changed = new Set()
  for (const k of COMPARE_KEYS) {
    const a = normVal(row[k]), b = normVal(existing[k])
    if (NUMERIC_KEYS.has(k)) {
      const na = parseFloat(a) || 0, nb = parseFloat(b) || 0
      if (na !== nb) changed.add(k)
    } else if (a !== b) changed.add(k)
  }
  return changed
}

// Pull the offending column name out of a Postgres / PostgREST error message.
// Handles both: column "x" does not exist  AND  Could not find the 'x' column ... in the schema cache
function missingColumn(msg = '') {
  const m = msg.match(/'([a-z_]+)' column/i) || msg.match(/column "?'?([a-z_]+)'?"?/i)
  return m ? m[1] : null
}

// Custom line-art icons (match Inventory cards)
const BrickIcon = ({ size = 16, color = '#FFA500' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    <path d="M4 9.5l8-4 8 4v6l-8 4-8-4z" /><path d="M4 9.5l8 4 8-4M12 13.5v6" />
    <ellipse cx="8.5" cy="6.6" rx="1.5" ry="0.9" /><ellipse cx="13" cy="4.7" rx="1.5" ry="0.9" />
  </svg>
)
const CakeIcon = ({ size = 15, color = '#378ADD' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    <path d="M4 20h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z" />
    <path d="M4 15c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0" /><path d="M8 8V5M12 8V4.5M16 8V5" />
  </svg>
)
function avatarColor(name=''){let h=0;for(let i=0;i<name.length;i++)h=name.charCodeAt(i)+((h<<5)-h);return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length]}
function Avatar({ name, size=34 }){const c=avatarColor(name);return <div style={{width:size,height:size,borderRadius:size>28?10:7,background:c+'18',color:c,display:'flex',alignItems:'center',justifyContent:'center',fontSize:size>28?14:11,fontWeight:700,flexShrink:0}}>{(name||'?').charAt(0).toUpperCase()}</div>}

function genBarcode(name, id) {
  const prefix = '299'
  const hash = (name + (id || Date.now())).split('').reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0)
  return prefix + Math.abs(hash).toString().padStart(9,'0').slice(0,9)
}

async function renderBarcodeSvg(code) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg')
  JsBarcode(svg, code, { format:'CODE128', width:2, height:50, displayValue:false, margin:0 })
  return new XMLSerializer().serializeToString(svg)
}

async function renderQRDataUrl(code) {
  return QRCode.toDataURL(code, { width:120, margin:1 })
}

export default function SupplierCatalog() {
  const [suppliers, setSuppliers] = useState([])
  const [catalog, setCatalog] = useState([])   // supplier_products rows
  const [loading, setLoading] = useState(true)
  const [activeSupplier, setActiveSupplier] = useState(null) // supplier obj
  const [search, setSearch] = useState('')
  const [compareMode, setCompareMode] = useState(false)
  const [inventoryNames, setInventoryNames] = useState(() => new Set()) // normalized inventory product names
  const [invFilter, setInvFilter] = useState('all') // 'all' | 'missing' | 'present'
  const [addModal, setAddModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const EMPTY_FORM = { product_name:'', sku:'', category:'Building & Blocks', brand:'', age_range:'All ages', pieces:'', sizes:'', weight:'', dimensions:'', cost_price:'', sell_price:'', unit:'piece', notes:'', description:'', tags:'', image_url:'', customFields:[] }
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [viewItem, setViewItem] = useState(null)
  const [view, setView] = useState(() => localStorage.getItem('bnj_cat_view') || 'grid')
  const changeView = v => { setView(v); localStorage.setItem('bnj_cat_view', v) }
  const [importModal, setImportModal] = useState(false)
  const [importRows, setImportRows] = useState([])
  const [importLoading, setImportLoading] = useState(false)
  const [barcodePreview, setBarcodePreview] = useState(null) // { item, svgUrl, qrUrl }
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [poModal, setPoModal] = useState(null) // catalog item to order
  const [poForm, setPoForm] = useState({ qty: 1, unit_cost: '', expected_date: '' })
  const [batchPoModal, setBatchPoModal] = useState(false)
  const [batchPoItems, setBatchPoItems] = useState([])
  const [batchPoDate, setBatchPoDate] = useState('')
  const [batchPoExtras, setBatchPoExtras] = useState([])
  const fileRef = useRef()
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [s, c, pr] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('supplier_products').select('*').order('product_name'),
      supabase.from('products').select('name'),
    ])
    const sup = s.data || []
    setSuppliers(sup)
    setCatalog(c.data || [])
    setInventoryNames(new Set((pr.data || []).map(p => (p.name || '').toLowerCase().trim()).filter(Boolean)))
    // Default to the top supplier on first load
    setActiveSupplier(prev => prev || sup[0] || null)
    setLoading(false)
  }

  // ── Filter ──────────────────────────────────────────────────────────────────
  const inInventory = item => inventoryNames.has((item.product_name || '').toLowerCase().trim())
  const scopedCatalog = catalog.filter(item => {
    const matchSupplier = compareMode ? true : (!activeSupplier || item.supplier_id === activeSupplier.id)
    const matchSearch = !search || item.product_name?.toLowerCase().includes(search.toLowerCase()) || item.sku?.toLowerCase().includes(search.toLowerCase())
    return matchSupplier && matchSearch
  })
  const missingCount = scopedCatalog.filter(i => !inInventory(i)).length
  const visibleCatalog = scopedCatalog.filter(item =>
    invFilter === 'all' ? true : invFilter === 'missing' ? !inInventory(item) : inInventory(item))

  // Dropdown options grow from data: base presets + any value already used by a
  // product (e.g. an age imported from Excel) so it's reusable on every product.
  const ADD_NEW = '__add_new__'
  const uniq = arr => [...new Set(arr.filter(Boolean).map(v => String(v).trim()).filter(Boolean))]
  const dynCategories = uniq([...CATEGORIES, ...catalog.map(c => c.category)])
  const dynAges = uniq([...AGE_RANGES, ...catalog.map(c => c.age_range)])
  const dynUnits = uniq([...UNITS, ...catalog.map(c => c.unit)])
  // When the user picks "➕ Add new…", prompt for a value and use it
  const pickOrAdd = (field, value, label) => {
    if (value === ADD_NEW) {
      const v = window.prompt(`New ${label}:`)
      if (v && v.trim()) setForm(p => ({ ...p, [field]: v.trim() }))
      return
    }
    setForm(p => ({ ...p, [field]: value }))
  }

  // Group by product name for comparison view
  const grouped = {}
  visibleCatalog.forEach(item => {
    const key = item.product_name?.trim().toLowerCase()
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(item)
  })
  const comparedGroups = Object.values(grouped).filter(g => g.length > 1).sort((a,b) => b.length - a.length)
  const singleItems = Object.values(grouped).filter(g => g.length === 1).map(g => g[0])

  // ── Add / Edit ───────────────────────────────────────────────────────────────
  function genSKU(productName, supplierName) {
    const prefix = (supplierName || 'SUP').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase()
    const suffix = (productName || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()
    const num = Math.floor(Math.random() * 900 + 100)
    return `${prefix}-${suffix}${num}`
  }

  function openAdd() {
    setForm({ ...EMPTY_FORM })
    setEditItem(null)
    setAddModal(true)
  }

  function openEdit(item) {
    setForm({
      product_name: item.product_name, sku: item.sku||'', category: item.category||'Building & Blocks',
      brand: item.brand||'', age_range: item.age_range||'All ages', pieces: item.pieces||'',
      sizes: item.sizes||'', weight: item.weight||'', dimensions: item.dimensions||'',
      cost_price: item.cost_price||'', sell_price: item.sell_price||'',
      unit: item.unit||'piece', notes: item.notes||'', description: item.description||'',
      tags: item.tags||'', image_url: item.image_url||'',
      customFields: item.custom_fields && typeof item.custom_fields === 'object'
        ? Object.entries(item.custom_fields).map(([key, value]) => ({ key, value: String(value ?? '') }))
        : []
    })
    setEditItem(item)
    setAddModal(true)
  }

  async function uploadPhoto(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const fileName = `catalog-${Date.now()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('uploads').upload(fileName, file, { upsert: true })
    if (error) {
      const reader = new FileReader()
      reader.onload = ev => { setForm(p => ({ ...p, image_url: ev.target.result })); setUploading(false) }
      reader.readAsDataURL(file); return
    }
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(fileName)
    setForm(p => ({ ...p, image_url: publicUrl }))
    setUploading(false); toast.success('Photo uploaded!')
  }

  async function save() {
    if (!form.product_name.trim()) { toast.error('Product name is required'); return }
    const supplierId = editItem?.supplier_id || activeSupplier?.id
    if (!supplierId) { toast.error('Select a supplier first'); return }
    const supplier = suppliers.find(s => s.id === supplierId)
    const barcode = editItem?.barcode || genBarcode(form.product_name, supplierId)
    const sku = form.sku.trim() || genSKU(form.product_name, supplier?.name)
    setSaving(true)
    const payload = {
      supplier_id: supplierId,
      supplier_name: supplier?.name || '',
      product_name: form.product_name.trim(),
      sku,
      category: form.category.trim() || null,
      brand: form.brand?.trim() || null,
      age_range: form.age_range || null,
      pieces: form.pieces === '' || form.pieces == null ? null : parseInt(form.pieces) || null,
      sizes: form.sizes?.trim() || null,
      weight: form.weight?.trim() || null,
      dimensions: form.dimensions?.trim() || null,
      cost_price: form.cost_price ? parseFloat(form.cost_price) : null,
      sell_price: form.sell_price ? parseFloat(form.sell_price) : null,
      unit: form.unit || 'piece',
      notes: form.notes.trim() || null,
      description: form.description?.trim() || null,
      tags: form.tags?.trim() || null,
      barcode,
      image_url: form.image_url.trim() || null,
    }
    // Custom fields: collapse the editable [{key,value}] list into an object
    const customObj = {}
    ;(form.customFields || []).forEach(({ key, value }) => {
      const k = (key || '').trim()
      if (k) customObj[k] = value
    })
    payload.custom_fields = Object.keys(customObj).length ? customObj : null
    const doSave = pl => editItem
      ? supabase.from('supplier_products').update(pl).eq('id', editItem.id)
      : supabase.from('supplier_products').insert(pl)
    let { error } = await doSave(payload)
    // Gracefully drop any column the DB doesn't have yet
    while (error && /column .* does not exist|could not find/i.test(error.message || '')) {
      const col = missingColumn(error.message)
      if (!col || !(col in payload)) break
      delete payload[col]
      const retry = await doSave(payload); error = retry.error
    }
    setSaving(false)
    if (error) { toast.error('Failed to save: ' + error.message); return }
    toast.success(editItem ? 'Updated!' : 'Product added to catalog!')
    setAddModal(false)
    load()
  }

  async function del(item) {
    if (!window.confirm(`Delete "${item.product_name}" from catalog?`)) return
    await supabase.from('supplier_products').delete().eq('id', item.id)
    toast.success('Deleted')
    load()
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return
    if (!window.confirm(`Delete ${selectedIds.size} product(s)?`)) return
    await supabase.from('supplier_products').delete().in('id', [...selectedIds])
    toast.success(`Deleted ${selectedIds.size} products`)
    setSelectedIds(new Set())
    load()
  }

  function toggleSelect(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSelectAll() {
    if (selectedIds.size === visibleCatalog.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(visibleCatalog.map(i => i.id)))
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  function openBatchPO() {
    const items = catalog.filter(i => selectedIds.has(i.id)).map(i => ({
      ...i,
      qty: 1,
      order_cost: i.cost_price || ''
    }))
    setBatchPoItems(items)
    setBatchPoDate('')
    setBatchPoExtras([])
    setBatchPoModal(true)
  }

  async function saveBatchPO() {
    if (batchPoItems.length === 0) return
    setSaving(true)
    const orderDate = new Date().toISOString().split('T')[0]
    // Single batch_id groups everything into one purchase order — one invoice, arrives once.
    const batchId = (window.crypto?.randomUUID?.() || `b${Date.now()}${Math.random().toString(36).slice(2, 8)}`)
    const records = batchPoItems.map(item => {
      const supplier = suppliers.find(s => s.id === item.supplier_id)
      return {
        supplier_id: item.supplier_id || null,
        supplier_name: item.supplier_name || supplier?.name || '',
        product_id: null,
        product_name: item.product_name,
        qty: parseInt(item.qty) || 1,
        unit_cost: parseFloat(item.order_cost) || 0,
        status: 'pending',
        order_date: orderDate,
        expected_date: batchPoDate || null,
        image_url: item.image_url || null,
        batch_id: batchId,
        notes: `From supplier catalog — SKU: ${item.sku || 'N/A'}`,
      }
    })
    // Extra costs (shipping, fees) become their own grouped line items — one shared payment.
    const supplierName = batchPoItems[0]?.supplier_name || suppliers.find(s => s.id === batchPoItems[0]?.supplier_id)?.name || ''
    const costRecords = (batchPoExtras || [])
      .filter(c => Number(c.amount) > 0)
      .map(c => ({
        supplier_id: batchPoItems[0]?.supplier_id || null,
        supplier_name: supplierName,
        product_id: null,
        product_name: c.type === 'Other' ? (c.label || 'Other cost') : c.type,
        qty: 1,
        unit_cost: parseFloat(c.amount),
        status: 'pending',
        order_date: orderDate,
        expected_date: batchPoDate || null,
        cost_type: 'extra',
        batch_id: batchId,
      }))
    let { error } = await supabase.from('purchase_orders').insert([...records, ...costRecords])
    // Gracefully retry if optional columns (batch_id / cost_type) don't exist yet
    while (error && /column .* does not exist|could not find/i.test(error.message || '')) {
      const col = (error.message.match(/column "?([a-z_]+)"?/i) || [])[1]
      if (!col) break
      ;[...records, ...costRecords].forEach(r => { delete r[col] })
      const retry = await supabase.from('purchase_orders').insert([...records, ...costRecords]); error = retry.error
    }
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success(`Batch order created — ${records.length} item${records.length > 1 ? 's' : ''}${costRecords.length ? ` + ${costRecords.length} cost${costRecords.length > 1 ? 's' : ''}` : ''}`)
    setBatchPoModal(false)
    exitSelectMode()
  }

  function openPO(item) {
    setPoForm({ qty: 1, unit_cost: item.cost_price || '', expected_date: '' })
    setPoModal(item)
  }

  async function createPO() {
    if (!poModal) return
    const supplier = suppliers.find(s => s.id === poModal.supplier_id)
    if (!supplier) { toast.error('Supplier not found'); return }
    setSaving(true)
    const { error } = await supabase.from('purchase_orders').insert({
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      product_id: null,
      product_name: poModal.product_name,
      qty: parseInt(poForm.qty) || 1,
      unit_cost: parseFloat(poForm.unit_cost) || 0,
      status: 'pending',
      expected_date: poForm.expected_date || null,
      image_url: poModal.image_url || null,
      notes: `From supplier catalog — SKU: ${poModal.sku || 'N/A'}`,
    })
    setSaving(false)
    if (error) { toast.error('Failed: ' + error.message); return }
    toast.success('Purchase order created!')
    setPoModal(null)
  }

  // ── Barcode preview ──────────────────────────────────────────────────────────
  async function showBarcode(item) {
    const code = item.barcode || genBarcode(item.product_name, item.id)
    const svgStr = await renderBarcodeSvg(code)
    const svgUrl = 'data:image/svg+xml;base64,' + btoa(svgStr)
    const qrUrl = await renderQRDataUrl(code)
    setBarcodePreview({ item, svgUrl, qrUrl, code })
  }

  function printLabel(preview) {
    const logoUrl = window.location.origin + '/logo-full.png'
    const w = window.open('','_blank','width=360,height=500')
    w.document.write(`<html><head><title>Label</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      *{margin:0;padding:0;box-sizing:border-box}body{font-family:'Poppins',sans-serif;background:#f0f0f0;display:flex;align-items:center;justify-content:center;min-height:100vh}
      .label{background:#fff;border-radius:16px;width:300px;box-shadow:0 6px 24px rgba(0,0,0,0.12);overflow:hidden}
      .top{display:flex;justify-content:space-between;align-items:center;padding:10px 14px 8px;border-bottom:1px solid #f5f5f5}
      .logo{display:flex;align-items:center;gap:8px}.logo img{height:40px;width:auto;max-width:150px;object-fit:contain}
      .brand{font-size:12px;font-weight:600;color:#0d1b2a}.sub{font-size:8px;color:#bbb;text-transform:uppercase;letter-spacing:0.8px}
      .tag{font-size:8px;color:#FFA500;font-weight:600;text-transform:uppercase;letter-spacing:1px}
      .bc{padding:14px 16px 8px;text-align:center}.bc img{max-width:100%;display:block;margin:0 auto}
      .info{padding:10px 16px 14px}
      .name{font-size:14px;font-weight:600;color:#0d1b2a;margin-bottom:2px}
      .supplier{font-size:11px;color:#aaa;margin-bottom:8px}
      .footer{display:flex;justify-content:space-between;align-items:center}
      .price{background:#0d1b2a;color:#FFA500;font-size:14px;font-weight:700;padding:5px 14px;border-radius:8px}
      .code{font-size:9px;color:#ccc;font-family:monospace}
      @media print{body{background:none;min-height:auto}.label{box-shadow:none;border:1px solid #ddd;border-radius:0}}
    </style></head><body>
    <div class="label">
      <div class="top">
        <div class="logo">
          <img src="${logoUrl}" alt="Brick's & Joy" onerror="this.style.display='none'" />
        </div>
        <div class="tag">Supplier Label</div>
      </div>
      <div class="bc"><img src="${preview.svgUrl}" /></div>
      <div class="info">
        <div class="name">${preview.item.product_name}</div>
        <div class="supplier">${preview.item.supplier_name || ''}</div>
        <div class="footer">
          <div class="price">${preview.item.sell_price ? 'MVR ' + Number(preview.item.sell_price).toFixed(2) : 'No price'}</div>
          <div class="code">${preview.code}</div>
        </div>
      </div>
    </div>
    <script>window.onload=()=>window.print()</script></body></html>`)
    w.document.close()
  }

  // ── Excel import ──────────────────────────────────────────────────────────────
  async function handleFileImport(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    setImportLoading(true)
    setImportModal(true)

    const isImage = file.type.startsWith('image/')
    if (isImage) {
      setImportRows([{ _image: true, _file: URL.createObjectURL(file) }])
      setImportLoading(false)
      return
    }

    const buf = await file.arrayBuffer()

    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    // Header row is first row of the sheet (sheetStartRow is 1-indexed)
    const sheetStartRow = ws['!ref'] ? parseInt(ws['!ref'].match(/\d+/)?.[0] || 1) : 1

    // Extract embedded images, map each to its data row via drawing XML anchors
    let rowImageMap = {}
    try {
      const zip = await JSZip.loadAsync(buf)

      // Convert all media files to base64 data URLs (persist across reloads)
      const toDataUrl = blob => new Promise(res => {
        const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob)
      })
      const mediaData = {}
      await Promise.all(
        Object.keys(zip.files)
          .filter(n => /^xl\/media\//i.test(n) && !zip.files[n].dir)
          .map(async n => {
            const blob = await zip.files[n].async('blob')
            mediaData[n.split('/').pop()] = await toDataUrl(blob)
          })
      )

      // Parse rels file: rId → media filename
      // e.g. Id="rId1" Target="../media/image1.png"
      const ridToFile = {}
      const relsFile = zip.files['xl/drawings/_rels/drawing1.xml.rels']
      if (relsFile) {
        const txt = await relsFile.async('string')
        const relMatches = [...txt.matchAll(/Id="(rId\d+)"[^>]*Target="[^"]*\/([^"\/]+)"/g)]
        relMatches.forEach(([,id,fname]) => { ridToFile[id] = fname })
      }

      // Parse drawing XML using pure regex (namespaces stripped by matching `:row>`, `embed=`)
      const drawFile = zip.files['xl/drawings/drawing1.xml']
      if (drawFile) {
        const xml = await drawFile.async('string')
        // Split into per-anchor blocks
        const blocks = xml.split(/<[^:>]+:(?:two|one)CellAnchor[\s>]/)
        blocks.slice(1).forEach(block => {
          // From row: first <*:row> inside <*:from>...</*:from>
          const fromM = block.match(/:from>([\s\S]*?)\/:from>|:from>([\s\S]*?)<[^:]+:to>/)
          const fromBlock = fromM?.[1] || fromM?.[2] || block
          const rowM = fromBlock.match(/:row>(\d+)</)
          // rId: embed="rIdX" or r:embed="rIdX"
          const ridM = block.match(/embed="(rId\d+)"/)
          if (!rowM || !ridM) return
          const xmlRow = parseInt(rowM[1])          // 0-indexed
          const dataIdx = xmlRow - sheetStartRow    // subtract header rows
          const fname = ridToFile[ridM[1]]
          if (fname && mediaData[fname] && dataIdx >= 0 && !rowImageMap[dataIdx]) {
            rowImageMap[dataIdx] = mediaData[fname]
          }
        })
      }

      // Fallback: positional (if drawing XML gave nothing)
      if (Object.keys(rowImageMap).length === 0) {
        Object.keys(zip.files)
          .filter(n => /^xl\/media\/image\d+\./i.test(n))
          .sort((a,b) => parseInt(a.match(/(\d+)\./)?.[1]||0) - parseInt(b.match(/(\d+)\./)?.[1]||0))
          .forEach((path, i) => {
            const fname = path.split('/').pop()
            if (mediaData[fname]) rowImageMap[i] = mediaData[fname]
          })
      }
    } catch (e) {
      console.warn('Image extraction:', e)
    }

    const mapped = rows.map((row, idx) => {
      const get = (...names) => {
        for (const n of names) {
          const k = Object.keys(row).find(k => k.toLowerCase().trim() === n)
          if (k && row[k] !== '' && row[k] !== undefined) return String(row[k]).trim()
        }
        return ''
      }
      const productName = get('product name','product','name','item','item name','product title','title')
      const cost = get('cost price (mvr)','cost price','cost','buying price','purchase price','unit cost','buy price','our price','supplier price')
      const sell = get('sell price (mvr)','sell price','delivery price','selling price','sale price','retail price','unit price','price','mrp','rate')
      const onlyPrice = get('amount','value')
      // Image URL column takes priority (guaranteed correct match); fallback to embedded image by row
      const imageUrl = get('image url','image','photo url','photo','picture url','picture','img url','img')
        || rowImageMap[idx] || ''
      // Any column not understood above is captured as a custom field
      const custom = {}
      Object.keys(row).forEach(k => {
        const norm = k.toLowerCase().trim()
        if (!norm || KNOWN_IMPORT_HEADERS.has(norm)) return
        const val = row[k]
        if (val === '' || val == null) return
        custom[k.trim()] = String(val).trim()
      })
      return {
        product_name: productName,
        sku: (() => { const v = get('sku','item code','product code','part no','part number','ref'); return v && /\D/.test(v) ? v : '' })(),
        category: get('category','cat','type','group','dept','department'),
        brand: get('brand','make','manufacturer'),
        age_range: get('age range','age','ages','age group'),
        pieces: get('pieces','piece','pcs','piece count','no of pieces'),
        sizes: get('sizes','size'),
        weight: get('weight','wt'),
        dimensions: get('dimensions','dimension','size (cm)','measurements'),
        cost_price: cost || '',
        sell_price: sell || onlyPrice || '',
        unit: get('unit','uom','unit of measure','sold per') || 'piece',
        description: get('description','desc','details','about'),
        tags: get('tags','tag','labels'),
        notes: get('notes','note','remarks','remark','comment') || '',
        image_url: imageUrl,
        custom_fields: Object.keys(custom).length ? custom : null,
        _selected: true,
      }
    }).filter(r => r.product_name)

    // Diff against products already saved for this supplier so a re-imported
    // sheet detects duplicates (unchanged → deselected), changes (highlighted &
    // updated) and brand-new rows (added).
    const existing = activeSupplier ? catalog.filter(c => c.supplier_id === activeSupplier.id) : []
    const existingByName = new Map(existing.map(c => [(c.product_name || '').toLowerCase().trim(), c]))
    const annotated = mapped.map(r => {
      const match = existingByName.get((r.product_name || '').toLowerCase().trim())
      if (!match) return { ...r, _status: 'new', _selected: true }
      const changed = diffFields(r, match)
      if (changed.size === 0) return { ...r, _status: 'duplicate', _existingId: match.id, _selected: false }
      return { ...r, _status: 'updated', _existingId: match.id, _changed: [...changed], _selected: true }
    })

    setImportRows(annotated)
    setImportLoading(false)
  }

  async function confirmImport() {
    if (!activeSupplier) { toast.error('Select a supplier first'); return }
    const rows = importRows.filter(r => r._selected && r.product_name)
    if (rows.length === 0) { toast.error('Nothing selected to import'); return }
    setSaving(true)

    // Shared field payload for both insert and update.
    const fields = r => ({
      product_name: r.product_name,
      category: r.category || null,
      brand: r.brand || null,
      age_range: r.age_range || null,
      pieces: r.pieces ? parseInt(r.pieces) || null : null,
      sizes: r.sizes || null,
      weight: r.weight || null,
      dimensions: r.dimensions || null,
      cost_price: r.cost_price ? parseFloat(r.cost_price) : null,
      sell_price: r.sell_price ? parseFloat(r.sell_price) : null,
      unit: r.unit || 'piece',
      description: r.description || null,
      tags: r.tags || null,
      notes: r.notes || null,
      image_url: r.image_url || null,
      custom_fields: r.custom_fields || null,
    })

    const newRows = rows.filter(r => !r._existingId)
    const changedRows = rows.filter(r => r._existingId)

    // INSERT new products
    let error = null
    if (newRows.length) {
      const records = newRows.map(r => ({
        supplier_id: activeSupplier.id,
        supplier_name: activeSupplier.name,
        sku: r.sku || genSKU(r.product_name, activeSupplier.name),
        barcode: genBarcode(r.product_name, activeSupplier.id + r.product_name),
        ...fields(r),
      }))
      let res = await supabase.from('supplier_products').insert(records)
      error = res.error
      while (error && /column .* does not exist|could not find/i.test(error.message || '')) {
        const col = missingColumn(error.message)
        if (!col) break
        records.forEach(rec => { delete rec[col] })
        res = await supabase.from('supplier_products').insert(records); error = res.error
      }
    }

    // UPDATE changed products (one by one, dropping missing columns as needed)
    let updated = 0
    if (!error) {
      for (const r of changedRows) {
        const payload = { ...fields(r), ...(r.sku ? { sku: r.sku } : {}) }
        let res = await supabase.from('supplier_products').update(payload).eq('id', r._existingId)
        let e = res.error
        while (e && /column .* does not exist|could not find/i.test(e.message || '')) {
          const col = missingColumn(e.message)
          if (!col) break
          delete payload[col]
          res = await supabase.from('supplier_products').update(payload).eq('id', r._existingId); e = res.error
        }
        if (e) { error = e; break }
        updated++
      }
    }

    setSaving(false)
    if (error) { toast.error('Import failed: ' + error.message); return }
    const added = newRows.length
    const parts = []
    if (added) parts.push(`${added} added`)
    if (updated) parts.push(`${updated} updated`)
    toast.success(parts.length ? `Import done — ${parts.join(' · ')}` : 'Nothing to import')
    setImportModal(false)
    setImportRows([])
    load()
  }

  // ── UI ───────────────────────────────────────────────────────────────────────
  const supplierCatalogCount = sid => catalog.filter(c => c.supplier_id === sid).length

  // Resolve display names from an item: main = contact name, small = company name
  const supplierNames = item => {
    const s = suppliers.find(x => x.id === item.supplier_id)
    const company = s?.name || item.supplier_name || ''
    const contact = s?.contact_name || ''
    return { main: contact || company, sub: contact ? company : '' }
  }

  const priceColor = (price, allPrices) => {
    if (!price || allPrices.length < 2) return '#0d1b2a'
    const min = Math.min(...allPrices)
    const max = Math.max(...allPrices)
    if (price === min) return '#1D9E75'
    if (price === max) return '#E24B4A'
    return '#f57f17'
  }

  function downloadTemplate() {
    const headers = [
      'Product Name',
      'Cost Price (MVR)',
      'Sell Price (MVR)',
      'Category',
      'Brand',
      'Age Range',
      'Pieces',
      'Sizes',
      'Weight',
      'Dimensions',
      'Unit',
      'Description',
      'Tags',
      'Notes',
      'Image URL',
    ]
    const examples = [
      ['LEGO Classic Bricks', '120.00', '350.00', 'Building & Blocks', 'LEGO', 'All ages', '300', 'Medium', '500g', '30×20×10cm', 'set', 'Creative building set', 'popular, new', 'Best seller', 'https://example.com/image.jpg'],
      ['Hot Wheels Car', '45.00', '150.00', 'Vehicles & RC', 'Hot Wheels', '3–5', '', '', '120g', '', 'piece', 'Die-cast toy car', 'sale', '', ''],
      ['Barbie Doll', '80.00', '220.00', 'Dolls & Plush', 'Mattel', '6–8', '', 'One size', '', '', 'piece', '', 'popular', 'Popular item', ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...examples])
    // Column widths
    ws['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 11 }, { wch: 9 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 9 }, { wch: 28 }, { wch: 16 }, { wch: 22 }, { wch: 40 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Products')

    // Instructions sheet
    const instr = XLSX.utils.aoa_to_sheet([
      ['Brick\'s & Joy — Supplier Catalog Import Template'],
      [''],
      ['COLUMNS:'],
      ['Product Name', 'Required. Full product name.'],
      ['Cost Price (MVR)', 'What you PAY the supplier.'],
      ['Sell Price (MVR)', 'What you CHARGE customers (the "Delivery price" in your sheet).'],
      ['Category', 'e.g. Vehicles & RC, Dolls & Plush, Building & Blocks'],
      ['Brand', 'e.g. LEGO, Mattel, Hot Wheels'],
      ['Age Range', '0–2 / 3–5 / 6–8 / 9–12 / 12+ / All ages'],
      ['Pieces', 'Number of pieces (for building sets).'],
      ['Sizes', 'e.g. Small, Medium, One size.'],
      ['Weight', 'e.g. 500g'],
      ['Dimensions', 'e.g. 30×20×10cm'],
      ['Unit', 'piece / box / set / pack / dozen'],
      ['Description', 'Product description, features, materials.'],
      ['Tags', 'Comma separated, e.g. popular, new arrival.'],
      ['Notes', 'Any extra notes.'],
      ['Image URL', 'Paste a direct image link (https://...) — this ensures the image matches the correct product.'],
      [''],
      ['TIP: You can also paste images directly into the cells in column A — they will be imported in row order.'],
    ])
    instr['!cols'] = [{ wch: 22 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, instr, 'Instructions')

    XLSX.writeFile(wb, 'bricksjoy-supplier-template.xlsx')
    toast.success('Template downloaded!')
  }

  return (
    <div>
      <style>{`
        .sc-grid { display: grid; grid-template-columns: 260px 1fr; gap: 16px; }
        .sc-supplier-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; cursor: pointer; transition: all 0.12s; border: 1px solid transparent; }
        .sc-supplier-item:hover { background: #f8f7f4; }
        .sc-supplier-item.active { background: #fff8f0; border-color: #FFA500; }
        .sc-product-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 12px; align-items: center; padding: 11px 16px; border-bottom: 1px solid #f5f5f5; transition: background 0.1s; }
        .sc-product-row:hover { background: #fafafa; }
        @media (max-width: 768px) { .sc-grid { grid-template-columns: 1fr; } }
      `}</style>

      <PageHeader
        title="Supplier Catalog"
        subtitle="Track which suppliers offer which products and compare prices"
        action={
          <div className="x-wrap" style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => setCompareMode(m => !m)} style={{ background: compareMode ? '#e8f5e9' : undefined, color: compareMode ? '#1D9E75' : undefined }}>
              <ArrowUpDown size={14} /> {compareMode ? 'Exit compare' : 'Price compare'}
            </Button>
            <Button variant="ghost" onClick={() => { if(selectMode) exitSelectMode(); else setSelectMode(true) }}
              style={{ background: selectMode ? '#FFF3E0' : undefined, color: selectMode ? '#FFA500' : undefined }}>
              <CheckCircle size={14} /> {selectMode ? 'Cancel select' : 'Select'}
            </Button>
            <Button variant="ghost" onClick={downloadTemplate}>
              <Download size={14} /> Template
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,image/*" style={{ display:'none' }} onChange={handleFileImport} />
            <Button variant="ghost" onClick={() => fileRef.current.click()}>
              <Upload size={14} /> Import Excel
            </Button>
            {activeSupplier && <Button onClick={openAdd}><Plus size={14} /> Add product</Button>}
          </div>
        }
      />

      {loading ? <Spinner /> : (
        <div className="sc-grid">
          {/* Left: supplier list */}
          <div>
            <Card style={{ padding: '12px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px 10px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Suppliers</span>
                <button onClick={() => { setActiveSupplier(null); setCompareMode(false) }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, transition: 'all 0.15s',
                    background: (!activeSupplier && !compareMode) ? '#FFA500' : '#f0f0f0',
                    color: (!activeSupplier && !compareMode) ? '#fff' : '#888' }}>
                  <Building2 size={12} /> All
                </button>
              </div>

              {suppliers.map(s => {
                const display = s.contact_name || s.name
                return (
                <div key={s.id} onClick={() => { setActiveSupplier(s); setCompareMode(false) }}
                  className={`sc-supplier-item${activeSupplier?.id === s.id ? ' active' : ''}`}>
                  <div style={{ width:38, height:38, borderRadius:10, background: avatarColor(display)+'22', color: avatarColor(display), display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700, flexShrink:0 }}>
                    {(display||'?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#0d1b2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{display}</div>
                    {s.contact_name && <div style={{ fontSize: 11, color: '#999', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>}
                    <div style={{ fontSize: 10.5, color: '#bbb' }}>{supplierCatalogCount(s.id)} products</div>
                  </div>
                </div>
                )
              })}

              {suppliers.length === 0 && (
                <div style={{ padding: '16px 8px', color: '#ccc', fontSize: 12, textAlign: 'center' }}>No suppliers yet — add them in Purchase Orders</div>
              )}
            </Card>
          </div>

          {/* Right: product list / compare */}
          <div>
            {/* Search + compare toggle */}
            <div className="x-wrap" style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 180, position: 'relative' }}>
                <Search size={14} color="#bbb" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)' }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products…"
                  style={{ width:'100%', padding:'9px 12px 9px 34px', border:'1px solid #e0e0e0', borderRadius:9, fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }} />
              </div>
              {compareMode && (
                <div style={{ background: '#E1F5EE', border: '1px solid #a7f3d8', borderRadius: 9, padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#1D9E75', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ArrowUpDown size={13} /> {comparedGroups.length} shared product{comparedGroups.length !== 1 ? 's' : ''} across suppliers
                </div>
              )}
              {!compareMode && (
                <div style={{ display: 'flex', border: '1px solid #e0e0e0', borderRadius: 9, overflow: 'hidden' }}>
                  {[
                    { k: 'all', label: 'All' },
                    { k: 'missing', label: `Not in inventory${missingCount ? ` (${missingCount})` : ''}` },
                    { k: 'present', label: 'In inventory' },
                  ].map((f, i) => (
                    <button key={f.k} onClick={() => setInvFilter(f.k)} title="Filter by inventory status"
                      style={{ padding: '8px 12px', border: 'none', borderLeft: i ? '1px solid #e0e0e0' : 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                        background: invFilter === f.k ? (f.k === 'missing' ? '#E24B4A' : '#0d1b2a') : '#fff',
                        color: invFilter === f.k ? '#fff' : '#888', whiteSpace: 'nowrap' }}>
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              {!compareMode && (
                <div style={{ display: 'flex', border: '1px solid #e0e0e0', borderRadius: 9, overflow: 'hidden' }}>
                  <button onClick={() => changeView('grid')} title="Grid" style={{ padding: '8px 11px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', background: view === 'grid' ? '#0d1b2a' : '#fff' }}>
                    <LayoutGrid size={15} color={view === 'grid' ? '#fff' : '#999'} />
                  </button>
                  <button onClick={() => changeView('list')} title="List" style={{ padding: '8px 11px', border: 'none', borderLeft: '1px solid #e0e0e0', cursor: 'pointer', display: 'flex', alignItems: 'center', background: view === 'list' ? '#0d1b2a' : '#fff' }}>
                    <List size={15} color={view === 'list' ? '#fff' : '#999'} />
                  </button>
                </div>
              )}
            </div>

            {compareMode ? (
              /* Price comparison view */
              <div>
                {comparedGroups.length === 0 ? (
                  <Card><p style={{ textAlign:'center', color:'#ccc', padding:'40px 0', fontSize:13 }}>No products shared across multiple suppliers{search && ` matching "${search}"`}</p></Card>
                ) : comparedGroups.map(group => {
                  const prices = group.map(i => Number(i.cost_price) || 0).filter(p => p > 0)
                  const minP = prices.length ? Math.min(...prices) : 0
                  return (
                    <Card key={group[0].product_name} style={{ marginBottom: 12 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, paddingBottom:10, borderBottom:'1px solid #f5f5f5' }}>
                        <Package size={15} color="#FFA500" />
                        <span style={{ fontSize:14, fontWeight:700, color:'#0d1b2a' }}>{group[0].product_name}</span>
                        <span style={{ fontSize:11, color:'#bbb', background:'#f5f5f5', padding:'2px 8px', borderRadius:99 }}>{group[0].category || 'No category'}</span>
                        <span style={{ marginLeft:'auto', fontSize:11, fontWeight:700, color:'#1D9E75' }}>Cheapest cost: MVR {minP.toFixed(2)}</span>
                      </div>
                      {group.sort((a,b) => ((Number(a.cost_price)||Infinity))-((Number(b.cost_price)||Infinity))).map((item, i) => {
                        const p = Number(item.cost_price) || 0
                        const isMin = p === minP && p > 0
                        const savings = i > 0 && p > 0 && minP > 0 ? ((p - minP) / minP * 100).toFixed(0) : null
                        return (
                          <div key={item.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 0', borderBottom:'1px solid #f8f8f8' }}>
                            <Avatar name={supplierNames(item).main||'?'} size={28} />
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:13, fontWeight:600, color:'#0d1b2a' }}>{supplierNames(item).main}</div>
                              {supplierNames(item).sub && <div style={{ fontSize:11, color:'#999', fontWeight:500 }}>{supplierNames(item).sub}</div>}
                              {item.sku && <div style={{ fontSize:11, color:'#bbb' }}>SKU: {item.sku}</div>}
                            </div>
                            {item.image_url && <img src={item.image_url} alt="" style={{ width:36, height:36, objectFit:'cover', borderRadius:6, flexShrink:0 }} onError={e=>e.target.style.display='none'} />}
                            <div style={{ textAlign:'right' }}>
                              <div style={{ fontSize:11, color:'#bbb', marginBottom:2 }}>Cost price</div>
                              <div style={{ fontSize:15, fontWeight:700, color: priceColor(p, prices) }}>
                                MVR {p.toFixed(2)}
                                {isMin && <span style={{ marginLeft:6, fontSize:10, background:'#E1F5EE', color:'#1D9E75', padding:'1px 6px', borderRadius:99, fontWeight:600 }}>Cheapest</span>}
                              </div>
                              {savings && Number(savings) > 0 && <div style={{ fontSize:10, color:'#E24B4A' }}>+{savings}% vs cheapest</div>}
                            </div>
                            <button className="icon-btn" onClick={() => showBarcode(item)} title="View barcode"><Barcode size={13} /></button>
                          </div>
                        )
                      })}
                    </Card>
                  )
                })}

                {singleItems.length > 0 && (
                  <Card>
                    <div style={{ fontSize:12, color:'#bbb', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:10 }}>Unique to one supplier</div>
                    {singleItems.map(item => (
                      <div key={item.id} className="sc-product-row">
                        <div>
                          <div style={{ fontSize:13, fontWeight:500, color:'#0d1b2a' }}>{item.product_name}</div>
                          <div style={{ fontSize:11, color:'#bbb' }}>{supplierNames(item).main}{supplierNames(item).sub ? ` · ${supplierNames(item).sub}` : ''}</div>
                        </div>
                        <div style={{ fontSize:13, fontWeight:700, color:'#0d1b2a' }}>MVR {(Number(item.cost_price) || 0).toFixed(2)}<span style={{ fontSize:10, color:'#bbb', fontWeight:500, marginLeft:4 }}>cost</span></div>
                        <button className="icon-btn" onClick={() => showBarcode(item)}><Barcode size={13}/></button>
                        <button className="icon-btn" onClick={() => openEdit(item)}><Edit2 size={13}/></button>
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            ) : visibleCatalog.length === 0 ? (
              <Card>
                <div style={{ textAlign:'center', padding:'48px 0', color:'#ccc' }}>
                  <Package size={32} color="#e0e0e0" style={{ marginBottom:12 }} />
                  <div style={{ fontSize:13 }}>
                    {activeSupplier ? `No products for ${activeSupplier.name} yet.` : 'No products in catalog yet.'}
                  </div>
                  {activeSupplier && <div style={{ marginTop:12 }}><Button onClick={openAdd}><Plus size={13}/> Add first product</Button></div>}
                </div>
              </Card>
            ) : (
              <div>
                {selectedIds.size > 0 && (
                  <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px', background:'#FFF8E1', border:'1px solid #FAEEDA', borderRadius:12, marginBottom:14 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:'#854F0B' }}>{selectedIds.size} selected</span>
                    <Button variant="ghost" onClick={deleteSelected} style={{ color:'#E24B4A', fontSize:12, padding:'4px 10px' }}>
                      <Trash2 size={13} /> Delete selected
                    </Button>
                    <Button onClick={openBatchPO} style={{ fontSize:12, padding:'4px 10px' }}>
                      <Truck size={13} /> Create batch PO
                    </Button>
                    <button onClick={() => setSelectedIds(new Set())} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'#aaa', fontSize:12 }}>Clear</button>
                  </div>
                )}

                {view === 'grid' ? (
                  <CatalogGrid items={visibleCatalog} activeSupplier={activeSupplier} suppliers={suppliers} selectMode={selectMode}
                    selectedIds={selectedIds} onToggleSelect={toggleSelect} inventoryNames={inventoryNames}
                    onView={setViewItem} onPO={openPO} onEdit={openEdit} onBarcode={showBarcode} onDelete={del} />
                ) : (
                  <Card>
                    <div style={{ display:'grid', gridTemplateColumns:`${selectMode?'32px ':''}1fr auto auto auto auto`, gap:12, padding:'8px 16px', borderBottom:'2px solid #f0f0f0', fontSize:10, color:'#bbb', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px' }}>
                      {selectMode && <div><input type="checkbox" checked={selectedIds.size === visibleCatalog.length && visibleCatalog.length > 0} onChange={toggleSelectAll} /></div>}
                      <div>Product</div>
                      <div style={{ textAlign:'right', width:130 }}>Cost / Sell Price</div>
                      <div style={{ width:60, textAlign:'center' }}>SKU</div>
                      <div style={{ width:30 }}></div>
                      <div style={{ width:30 }}></div>
                    </div>
                    {visibleCatalog.map(item => (
                      <div key={item.id} style={{ display:'grid', gridTemplateColumns:`${selectMode?'32px ':''}1fr auto auto auto auto`, gap:12, alignItems:'center', padding:'11px 16px', borderBottom:'1px solid #f5f5f5', transition:'background 0.1s', background: selectedIds.has(item.id) ? '#FFF8E1' : '' }}
                        onMouseEnter={e=>{ if(!selectedIds.has(item.id)) e.currentTarget.style.background='#fafafa' }}
                        onMouseLeave={e=>{ if(!selectedIds.has(item.id)) e.currentTarget.style.background='' }}>
                        {selectMode && <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} onClick={e=>e.stopPropagation()} />}
                        <div>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            {item.image_url
                              ? <img src={item.image_url} alt="" style={{ width:36, height:36, objectFit:'contain', borderRadius:7, flexShrink:0, background:'#f8f8f8' }} onError={e=>{e.target.style.display='none'}} />
                              : <Avatar name={item.supplier_name||item.product_name||'?'} size={36} />
                            }
                            <div>
                              <div style={{ fontSize:13, fontWeight:600, color:'#0d1b2a', display:'flex', alignItems:'center', gap:7 }}>
                                {item.product_name}
                                {!inInventory(item) && <span style={{ fontSize:9.5, fontWeight:700, color:'#E24B4A', background:'#fef2f2', padding:'1px 7px', borderRadius:99, textTransform:'uppercase', letterSpacing:'0.3px' }}>Not in inventory</span>}
                              </div>
                              <div style={{ fontSize:11, color:'#bbb' }}>
                                {!activeSupplier && <span>{supplierNames(item).main} · </span>}
                                {item.category && <span>{item.category} · </span>}
                                {item.unit}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign:'right', width:130 }}>
                          {item.cost_price && <div style={{ fontSize:11, color:'#bbb' }}>Cost: MVR {Number(item.cost_price).toFixed(2)}</div>}
                          <div style={{ fontSize:13, fontWeight:700, color:'#0d1b2a' }}>
                            {item.sell_price ? `Sell: MVR ${Number(item.sell_price).toFixed(2)}` : item.cost_price ? '' : <span style={{color:'#ddd'}}>—</span>}
                          </div>
                        </div>
                        <div style={{ width:60, textAlign:'center', fontSize:11, color:'#aaa' }}>{item.sku || '—'}</div>
                        <button className="icon-btn" onClick={() => showBarcode(item)} title="Barcode / QR"><Barcode size={13}/></button>
                        <div style={{ display:'flex', gap:4 }}>
                          <button className="icon-btn" onClick={() => openPO(item)} title="Create Purchase Order" style={{ color:'#378ADD' }}><Truck size={13}/></button>
                          <button className="icon-btn" onClick={() => openEdit(item)} title="Edit"><Edit2 size={13}/></button>
                          <button className="icon-btn danger" onClick={() => del(item)} title="Delete"><Trash2 size={13}/></button>
                        </div>
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add / Edit modal */}
      {addModal && (
        <Modal title={editItem ? 'Edit product' : `Add product — ${activeSupplier?.name}`}
          subtitle="Product details for this supplier's catalog"
          onClose={() => setAddModal(false)} width={620}>
          {/* Photo */}
          <div style={{ marginBottom:16, display:'flex', gap:16, alignItems:'flex-start' }}>
            <div style={{ position:'relative' }}>
              {form.image_url
                ? <img src={form.image_url} alt="product" style={{ width:90, height:90, borderRadius:12, objectFit:'cover', border:'1px solid #eee' }} onError={e=>e.target.style.display='none'} />
                : <div style={{ width:90, height:90, borderRadius:12, background:'#f0f0f0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4 }}><Package size={24} color="#ccc" /><span style={{ fontSize:10, color:'#aaa' }}>No photo</span></div>}
              {form.image_url && <button onClick={() => setForm(p=>({...p,image_url:''}))} style={{ position:'absolute', top:-6, right:-6, background:'#c62828', border:'none', borderRadius:'50%', width:20, height:20, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#fff' }}><X size={11} /></button>}
            </div>
            <div style={{ flex:1 }}>
              <label style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', background:'#f0f0f0', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500, color:'#555' }}>
                <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload photo'}
                <input type="file" accept="image/*" onChange={uploadPhoto} style={{ display:'none' }} disabled={uploading} />
              </label>
              <Input label="" value={form.image_url} onChange={e => setForm(p=>({...p,image_url:e.target.value}))} placeholder="…or paste image URL (https://…)" style={{ marginTop:8 }} />
            </div>
          </div>
          <FormRow>
            <Input label="Product name *" value={form.product_name} onChange={e => setForm(p=>({...p,product_name:e.target.value}))} placeholder="e.g. LEGO Classic Bricks" style={{ gridColumn:'span 2' }} />
          </FormRow>
          <FormRow>
            <Select label="Category" value={form.category} onChange={e => pickOrAdd('category', e.target.value, 'category')} options={[...withValue(dynCategories, form.category), { value: ADD_NEW, label: '➕ Add new category…' }]} />
            <Select label="Age range" value={form.age_range} onChange={e => pickOrAdd('age_range', e.target.value, 'age range')} options={[...withValue(dynAges, form.age_range), { value: ADD_NEW, label: '➕ Add new age range…' }]} />
          </FormRow>
          <FormRow>
            <Input label="Brand" value={form.brand} onChange={e => setForm(p=>({...p,brand:e.target.value}))} placeholder="e.g. LEGO, Mattel" />
            <Input label="SKU (auto if blank)" value={form.sku} onChange={e => setForm(p=>({...p,sku:e.target.value}))} placeholder="Auto-generate" />
          </FormRow>
          <FormRow>
            <Input label="Pieces (optional)" type="number" value={form.pieces} onChange={e => setForm(p=>({...p,pieces:e.target.value}))} placeholder="e.g. 259" />
            <Input label="Sizes" value={form.sizes} onChange={e => setForm(p=>({...p,sizes:e.target.value}))} placeholder="e.g. Small, Medium" />
          </FormRow>
          <FormRow>
            <Input label="Weight" value={form.weight} onChange={e => setForm(p=>({...p,weight:e.target.value}))} placeholder="e.g. 500g" />
            <Input label="Dimensions" value={form.dimensions} onChange={e => setForm(p=>({...p,dimensions:e.target.value}))} placeholder="e.g. 30×20×10cm" />
          </FormRow>
          <FormRow>
            <Input label="Cost price — what you paid (MVR)" type="number" min="0" step="0.01" value={form.cost_price} onChange={e => setForm(p=>({...p,cost_price:e.target.value}))} placeholder="0.00" />
            <Input label="Sell price — what you charge (MVR)" type="number" min="0" step="0.01" value={form.sell_price} onChange={e => setForm(p=>({...p,sell_price:e.target.value}))} placeholder="0.00" />
          </FormRow>
          <FormRow>
            <Select label="Unit" value={form.unit} onChange={e => pickOrAdd('unit', e.target.value, 'unit')} options={[...withValue(dynUnits, form.unit), { value: ADD_NEW, label: '➕ Add new unit…' }]} />
            {form.cost_price && form.sell_price && (
              <div style={{ display:'flex', alignItems:'flex-end', paddingBottom:2 }}>
                <div style={{ background:'#E1F5EE', borderRadius:9, padding:'9px 14px', fontSize:12, color:'#1D9E75', fontWeight:600 }}>
                  Margin: MVR {(parseFloat(form.sell_price||0)-parseFloat(form.cost_price||0)).toFixed(2)} ({form.cost_price>0?((parseFloat(form.sell_price||0)-parseFloat(form.cost_price||0))/parseFloat(form.cost_price)*100).toFixed(0):0}%)
                </div>
              </div>
            )}
          </FormRow>
          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:12, color:'#666', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:5 }}>Description</label>
            <textarea value={form.description} onChange={e => setForm(p=>({...p,description:e.target.value}))} placeholder="Product description, features, materials…"
              style={{ width:'100%', padding:'9px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:13, fontFamily:'inherit', resize:'vertical', minHeight:60, boxSizing:'border-box', outline:'none' }} />
          </div>
          <Input label="Tags (comma separated)" value={form.tags} onChange={e => setForm(p=>({...p,tags:e.target.value}))} placeholder="e.g. popular, new arrival, sale" style={{ marginBottom:12 }} />
          <Input label="Notes" value={form.notes} onChange={e => setForm(p=>({...p,notes:e.target.value}))} placeholder="Any notes about this product from this supplier" style={{ marginBottom:16 }} />

          {/* Custom fields */}
          <div style={{ marginBottom:20 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <label style={{ fontSize:12, color:'#666', fontWeight:500, textTransform:'uppercase', letterSpacing:'0.4px' }}>Custom fields ({(form.customFields||[]).length})</label>
              <Button variant="ghost" size="sm" onClick={() => setForm(p => ({ ...p, customFields:[...(p.customFields||[]), { key:'', value:'' }] }))}><Plus size={13} /> Add field</Button>
            </div>
            {(form.customFields||[]).map((cf, idx) => (
              <div key={idx} style={{ display:'flex', gap:8, marginBottom:8 }}>
                <input value={cf.key} onChange={e => setForm(p => ({ ...p, customFields: p.customFields.map((x,i)=> i===idx ? {...x, key:e.target.value} : x) }))}
                  placeholder="Field name (e.g. Material)"
                  style={{ flex:'0 0 38%', padding:'9px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:13, fontFamily:'inherit', boxSizing:'border-box', outline:'none' }} />
                <input value={cf.value} onChange={e => setForm(p => ({ ...p, customFields: p.customFields.map((x,i)=> i===idx ? {...x, value:e.target.value} : x) }))}
                  placeholder="Value"
                  style={{ flex:1, padding:'9px 12px', border:'1px solid #ddd', borderRadius:8, fontSize:13, fontFamily:'inherit', boxSizing:'border-box', outline:'none' }} />
                <button onClick={() => setForm(p => ({ ...p, customFields: p.customFields.filter((_,i)=> i!==idx) }))}
                  style={{ background:'none', border:'1px solid #f3d6d6', borderRadius:8, cursor:'pointer', color:'#E24B4A', padding:'0 11px', display:'flex', alignItems:'center' }}><X size={14} /></button>
              </div>
            ))}
            {(form.customFields||[]).length === 0 && (
              <div style={{ fontSize:12, color:'#bbb' }}>Add your own attributes (extra ages, material, colour…). They save per product and show on the product, and Excel columns that don't match a standard field import here automatically.</div>
            )}
          </div>

          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <Button variant="ghost" onClick={() => setAddModal(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editItem ? 'Save changes' : 'Add to catalog'}</Button>
          </div>
        </Modal>
      )}

      {/* Barcode preview modal */}
      {barcodePreview && (
        <Modal title={barcodePreview.item.product_name} subtitle={barcodePreview.item.supplier_name} onClose={() => setBarcodePreview(null)} width={380}>
          <div style={{ textAlign:'center' }}>
            <div style={{ background:'#f8f7f4', borderRadius:12, padding:'16px', marginBottom:16 }}>
              <img src={barcodePreview.svgUrl} alt="barcode" style={{ maxWidth:'100%', height:60 }} />
              <div style={{ fontSize:10, color:'#bbb', marginTop:6, fontFamily:'monospace' }}>{barcodePreview.code}</div>
            </div>
            <div style={{ display:'inline-block', background:'#fff', border:'1px solid #f0f0f0', borderRadius:10, padding:12, marginBottom:16 }}>
              <img src={barcodePreview.qrUrl} alt="qr" style={{ width:100, height:100 }} />
              <div style={{ fontSize:10, color:'#bbb', marginTop:4 }}>QR Code</div>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'center' }}>
              <Button variant="ghost" onClick={() => {
                const a = document.createElement('a'); a.href = barcodePreview.qrUrl; a.download = `qr-${barcodePreview.code}.png`; a.click()
              }}><Download size={13} /> Download QR</Button>
              <Button onClick={() => printLabel(barcodePreview)}><Barcode size={13} /> Print Label</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Import modal */}
      {importModal && (
        <Modal title="Import Products" subtitle={activeSupplier
          ? <span>{activeSupplier.contact_name || activeSupplier.name}{activeSupplier.contact_name && <span style={{ color:'#c4c4c4', fontWeight:400 }}> · {activeSupplier.name}</span>}</span>
          : 'Select a supplier first'} onClose={() => { setImportModal(false); setImportRows([]) }} width={740}>
          {!activeSupplier && (
            <div style={{ background:'#FFF8E1', border:'1px solid #FAEEDA', borderRadius:10, padding:'12px 16px', marginBottom:16, fontSize:13, color:'#854F0B' }}>
              Please select a supplier from the left panel before importing.
            </div>
          )}
          {importLoading ? <Spinner /> : importRows.length === 0 ? (
            <div style={{ textAlign:'center', padding:'32px 0', color:'#ccc' }}>No rows detected. Make sure the file has a column named "Product Name" or similar.</div>
          ) : importRows[0]?._image ? (
            <div style={{ textAlign:'center' }}>
              <img src={importRows[0]._file} alt="uploaded" style={{ maxWidth:'100%', maxHeight:300, borderRadius:10, marginBottom:16 }} />
              <div style={{ background:'#f8f7f4', borderRadius:10, padding:'14px 16px', fontSize:13, color:'#666' }}>
                Image import detected. Please use an Excel/CSV file for automatic import. You can type the product names manually after uploading a photo.
              </div>
            </div>
          ) : (
            <>
              {(() => {
                const nNew = importRows.filter(r => r._status === 'new').length
                const nUpd = importRows.filter(r => r._status === 'updated').length
                const nDup = importRows.filter(r => r._status === 'duplicate').length
                return (
                  <div style={{ fontSize:13, color:'#555', marginBottom:12, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                    <span>Found <strong>{importRows.length}</strong> rows.</span>
                    {nNew > 0 && <Badge color="green">{nNew} new</Badge>}
                    {nUpd > 0 && <Badge color="amber">{nUpd} changed</Badge>}
                    {nDup > 0 && <Badge color="gray">{nDup} duplicate{nDup !== 1 ? 's' : ''}</Badge>}
                    <span style={{ color:'#aaa' }}>
                      {nDup > 0 ? 'Duplicates are unchecked so they won’t be re-added. ' : ''}Changed rows will update the existing product.
                    </span>
                  </div>
                )
              })()}
              <div style={{ maxHeight:340, overflow:'auto', border:'1px solid #f0f0f0', borderRadius:10, marginBottom:16 }}>
                <table style={{ fontSize:12, borderCollapse:'collapse', minWidth:1100 }}>
                  <thead>
                    <tr style={{ background:'#fafafa', position:'sticky', top:0 }}>
                      <th style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#999', fontSize:11, textTransform:'uppercase', width:32 }}>
                        <input type="checkbox" checked={importRows.every(r=>r._selected)} onChange={e => setImportRows(rows => rows.map(r=>({...r,_selected:e.target.checked})))} />
                      </th>
                      <th style={{ padding:'8px 10px', width:44 }}></th>
                      <th style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#999', fontSize:11, textTransform:'uppercase', whiteSpace:'nowrap' }}>Status</th>
                      {['Product Name','Category','Brand','Age','Pieces','Cost','Sell','Unit','Sizes','Weight','Dimensions','Tags','Notes'].map(h=>(
                        <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontWeight:600, color:'#999', fontSize:11, textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, i) => {
                      const changed = new Set(row._changed || [])
                      const rowBg = !row._selected ? '#fafafa' : row._status === 'updated' ? '#fffaf0' : '#fff'
                      const statusBadge = row._status === 'new'
                        ? <Badge color="green">New</Badge>
                        : row._status === 'updated'
                          ? <Badge color="amber">Changed</Badge>
                          : <Badge color="gray">Duplicate</Badge>
                      return (
                      <tr key={i} style={{ borderBottom:'1px solid #f5f5f5', background: rowBg, opacity: row._selected ? 1 : 0.55 }}>
                        <td style={{ padding:'8px 10px' }}>
                          <input type="checkbox" checked={!!row._selected} onChange={e => setImportRows(rows => rows.map((r,j) => j===i ? {...r,_selected:e.target.checked} : r))} />
                        </td>
                        <td style={{ padding:'7px 10px', whiteSpace:'nowrap' }}>{statusBadge}</td>
                        <td style={{ padding:'6px 10px' }}>
                          {row.image_url
                            ? <img src={row.image_url} alt="" style={{ width:32, height:32, objectFit:'cover', borderRadius:6, display:'block' }} onError={e=>e.target.style.display='none'} />
                            : <div style={{ width:32, height:32, borderRadius:6, background:'#f0f0f0' }} />}
                        </td>
                        {['product_name','category','brand','age_range','pieces','cost_price','sell_price','unit','sizes','weight','dimensions','tags','notes'].map(k=>{
                          const isChanged = changed.has(k)
                          return (
                          <td key={k} style={{ padding:'7px 10px', background: isChanged ? '#fff3df' : 'transparent', borderRadius: isChanged ? 6 : 0 }} title={isChanged ? 'Changed in this import' : undefined}>
                            <input value={row[k]||''} onChange={e => setImportRows(rows => rows.map((r,j) => j===i ? {...r,[k]:e.target.value} : r))}
                              style={{ width: k==='product_name'?140:80, border:'none', background:'transparent', fontSize:12, fontFamily:'inherit', outline:'none', color:'#0d1b2a', fontWeight: isChanged ? 700 : 400 }} />
                          </td>
                          )
                        })}
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <Button variant="ghost" onClick={() => { setImportModal(false); setImportRows([]) }}>Cancel</Button>
                <Button onClick={confirmImport} disabled={saving || !activeSupplier || !importRows.some(r=>r._selected)}>
                  {saving ? 'Importing…' : `Import ${importRows.filter(r=>r._selected).length} selected`}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Create Purchase Order modal */}
      {poModal && (
        <Modal title="Create Purchase Order" subtitle={`${poModal.product_name} · ${poModal.supplier_name}`} onClose={() => setPoModal(null)} width={440}>
          <div style={{ display:'flex', alignItems:'center', gap:12, background:'#f8f7f4', borderRadius:10, padding:'12px 14px', marginBottom:20 }}>
            {poModal.image_url && <img src={poModal.image_url} alt="" style={{ width:48, height:48, objectFit:'contain', borderRadius:8, background:'#fff' }} onError={e=>e.target.style.display='none'} />}
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:'#0d1b2a' }}>{poModal.product_name}</div>
              <div style={{ fontSize:11, color:'#aaa' }}>Supplier: {poModal.supplier_name} · SKU: {poModal.sku || '—'}</div>
              {poModal.cost_price && <div style={{ fontSize:12, color:'#1D9E75', fontWeight:600, marginTop:2 }}>Catalog cost: MVR {Number(poModal.cost_price).toFixed(2)}</div>}
            </div>
          </div>
          <FormRow>
            <Input label="Quantity *" type="number" min="1" value={poForm.qty} onChange={e=>setPoForm(p=>({...p,qty:e.target.value}))} />
            <Input label="Unit cost (MVR) *" type="number" min="0" step="0.01" value={poForm.unit_cost} onChange={e=>setPoForm(p=>({...p,unit_cost:e.target.value}))} />
          </FormRow>
          <Input label="Expected delivery date" type="date" value={poForm.expected_date} onChange={e=>setPoForm(p=>({...p,expected_date:e.target.value}))} style={{ marginBottom:8 }} />
          {poForm.qty && poForm.unit_cost && (
            <div style={{ background:'#E1F5EE', borderRadius:9, padding:'10px 14px', fontSize:13, color:'#1D9E75', fontWeight:600, marginBottom:20 }}>
              Total: MVR {(parseFloat(poForm.qty)*parseFloat(poForm.unit_cost)).toFixed(2)}
            </div>
          )}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <Button variant="ghost" onClick={() => setPoModal(null)}>Cancel</Button>
            <Button onClick={createPO} disabled={saving}>{saving ? 'Creating…' : 'Create Purchase Order'}</Button>
          </div>
        </Modal>
      )}

      {batchPoModal && (
        <Modal title={`Batch Purchase Order — ${batchPoItems.length} items`} subtitle="One grouped order · single invoice · arrives together · shared extra costs" onClose={() => setBatchPoModal(false)} width={680}>
          <Input label="Expected delivery date" type="date" value={batchPoDate} onChange={e=>setBatchPoDate(e.target.value)} style={{marginBottom:16}} />
          <div style={{border:'1px solid #f0f0f0',borderRadius:10,overflow:'hidden',marginBottom:16,maxHeight:360,overflowY:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'#fafafa'}}>
                  <th style={{padding:'8px 12px',textAlign:'left',fontWeight:600,color:'#999',fontSize:11,textTransform:'uppercase'}}>Product</th>
                  <th style={{padding:'8px 12px',textAlign:'left',fontWeight:600,color:'#999',fontSize:11,textTransform:'uppercase'}}>Supplier</th>
                  <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'#999',fontSize:11,textTransform:'uppercase',width:80}}>Qty</th>
                  <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'#999',fontSize:11,textTransform:'uppercase',width:110}}>Unit cost (MVR)</th>
                  <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'#999',fontSize:11,textTransform:'uppercase',width:100}}>Total</th>
                </tr>
              </thead>
              <tbody>
                {batchPoItems.map((item,i) => (
                  <tr key={item.id} style={{borderTop:'1px solid #f5f5f5'}}>
                    <td style={{padding:'8px 12px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        {item.image_url && <img src={item.image_url} style={{width:28,height:28,objectFit:'contain',borderRadius:5}} onError={e=>e.target.style.display='none'} />}
                        <div>
                          <div style={{fontWeight:600,color:'#0d1b2a'}}>{item.product_name}</div>
                          {item.sku && <div style={{fontSize:10,color:'#aaa'}}>{item.sku}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'8px 12px',color:'#666'}}>{item.supplier_name}</td>
                    <td style={{padding:'8px 12px'}}>
                      <input type="number" min="1" value={item.qty}
                        onChange={e => setBatchPoItems(prev => prev.map((it,j) => j===i ? {...it,qty:e.target.value} : it))}
                        style={{width:'100%',padding:'4px 6px',border:'1px solid #ddd',borderRadius:5,fontSize:12,textAlign:'right',fontFamily:'inherit'}} />
                    </td>
                    <td style={{padding:'8px 12px'}}>
                      <input type="number" step="0.01" min="0" value={item.order_cost}
                        onChange={e => setBatchPoItems(prev => prev.map((it,j) => j===i ? {...it,order_cost:e.target.value} : it))}
                        style={{width:'100%',padding:'4px 6px',border:'1px solid #ddd',borderRadius:5,fontSize:12,textAlign:'right',fontFamily:'inherit'}} />
                    </td>
                    <td style={{padding:'8px 12px',textAlign:'right',fontWeight:700,color:'#0d1b2a'}}>
                      MVR {(parseFloat(item.qty||0)*parseFloat(item.order_cost||0)).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{background:'#fafafa',borderTop:'2px solid #eee'}}>
                  <td colSpan={4} style={{padding:'10px 12px',fontWeight:700,color:'#0d1b2a'}}>Total</td>
                  <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,color:'#FFA500'}}>
                    MVR {batchPoItems.reduce((s,i)=>s+(parseFloat(i.qty||0)*parseFloat(i.order_cost||0)),0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Additional costs — shared across the batch (one payment) */}
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Additional costs ({batchPoExtras.length})</span>
              <Button variant="ghost" onClick={() => setBatchPoExtras(prev => [...prev, { type: 'Shipping / Freight', label: '', amount: '' }])} style={{ fontSize: 12, padding: '4px 10px' }}><Plus size={13} /> Add cost</Button>
            </div>
            {batchPoExtras.length > 0 && (
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
                    {batchPoExtras.map((c, idx) => (
                      <tr key={idx} style={{ borderTop: '1px solid #f5f5f5' }}>
                        <td style={{ padding: 6 }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select value={c.type} onChange={e => setBatchPoExtras(prev => prev.map((x,j) => j===idx ? {...x, type: e.target.value} : x))}
                              style={{ flex: c.type === 'Other' ? '0 0 130px' : 1, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', background: '#fff' }}>
                              {['Alibaba transaction charge', 'China local delivery', 'Shipping / Freight', 'Customs / Duty', 'Other'].map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            {c.type === 'Other' && (
                              <input value={c.label} onChange={e => setBatchPoExtras(prev => prev.map((x,j) => j===idx ? {...x, label: e.target.value} : x))} placeholder="Specify cost..."
                                style={{ flex: 1, padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }} />
                            )}
                          </div>
                        </td>
                        <td style={{ padding: 6 }}>
                          <input type="number" step="0.01" min="0" value={c.amount} onChange={e => setBatchPoExtras(prev => prev.map((x,j) => j===idx ? {...x, amount: e.target.value} : x))} placeholder="0.00"
                            style={{ width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, textAlign: 'right', fontFamily: 'inherit' }} />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="icon-btn" onClick={() => setBatchPoExtras(prev => prev.filter((_,j) => j!==idx))}><Trash2 size={13} color="#E24B4A" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, fontSize: 14, fontWeight: 700, color: '#0d1b2a' }}>
              Grand total: <span style={{ color: '#FFA500', marginLeft: 8 }}>MVR {(batchPoItems.reduce((s,i)=>s+(parseFloat(i.qty||0)*parseFloat(i.order_cost||0)),0) + batchPoExtras.reduce((s,c)=>s+parseFloat(c.amount||0),0)).toFixed(2)}</span>
            </div>
          </div>

          <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:16}}>
            <Button variant="ghost" onClick={() => setBatchPoModal(false)}>Cancel</Button>
            <Button onClick={saveBatchPO} disabled={saving}>{saving?'Creating…':`Create batch order (${batchPoItems.length} item${batchPoItems.length>1?'s':''})`}</Button>
          </div>
        </Modal>
      )}

      {/* Catalog item detail modal */}
      {viewItem && (() => {
        const vm = viewItem
        const m = vm.cost_price > 0 && vm.sell_price > 0 ? Math.round((vm.sell_price - vm.cost_price) / vm.cost_price * 100) : 0
        const stats = [
          vm.cost_price ? { label: 'Cost price', value: `MVR ${Number(vm.cost_price).toFixed(2)}` } : null,
          vm.sell_price ? { label: 'Sell price', value: `MVR ${Number(vm.sell_price).toFixed(2)}` } : null,
          (vm.cost_price && vm.sell_price) ? { label: 'Margin', value: `${m}%`, color: '#1D9E75' } : null,
          { label: 'Unit', value: vm.unit || 'piece' },
          vm.pieces ? { label: 'Pieces', value: vm.pieces } : null,
          vm.sizes ? { label: 'Sizes', value: vm.sizes } : null,
          vm.weight ? { label: 'Weight', value: vm.weight } : null,
          vm.dimensions ? { label: 'Dimensions', value: vm.dimensions } : null,
        ].filter(Boolean)
        return (
        <Modal title="" onClose={() => setViewItem(null)} width={960}>
          <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 34, alignItems: 'start' }} className="cat-vm-grid">
            <style>{`@media (max-width: 820px){ .cat-vm-grid { grid-template-columns: 1fr !important; } }`}</style>
            <div style={{ position: 'relative', width: '100%', aspectRatio: '372 / 443', borderRadius: 24, overflow: 'hidden',
              background: '#fff', padding: 25, boxSizing: 'border-box',
              boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.95), inset 0 -4px 10px rgba(0,0,0,0.08), 0 10px 30px rgba(13,27,42,0.12)' }}>
              {vm.image_url
                ? <img src={vm.image_url} alt={vm.product_name} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff', borderRadius: 12 }} onError={e=>e.target.style.display='none'} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Package size={80} color="#cfcfd6" /></div>}
            </div>
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {vm.category && <Badge color="purple">{vm.category}</Badge>}
                {vm.age_range && <Badge color="blue">{vm.age_range}</Badge>}
                {vm.pieces ? <span style={{ background: '#FFF3D6', color: '#b8740a', padding: '3px 11px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>{vm.pieces} pieces</span> : null}
              </div>
              <h1 style={{ fontSize: 36, fontWeight: 800, margin: '0 0 6px', color: '#0d1b2a', letterSpacing: '-1px', lineHeight: 1.05 }}>{vm.product_name}</h1>
              <div style={{ fontSize: 14, color: '#888', marginBottom: 16 }}>
                {vm.brand && <span><strong style={{ color: '#555' }}>{vm.brand}</strong> · </span>}
                from <strong style={{ color: '#555' }}>{supplierNames(vm).main}</strong>{supplierNames(vm).sub ? ` (${supplierNames(vm).sub})` : ''}{vm.sku ? ` · SKU ${vm.sku}` : ''}
              </div>
              {vm.description && <p style={{ fontSize: 15.5, color: '#555', lineHeight: 1.6, margin: '0 0 20px' }}>{vm.description}</p>}
              <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                {stats.map((s, i) => (
                  <div key={i} style={{ background: '#f8f7f4', borderRadius: 14, padding: '13px 15px' }}>
                    <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>{s.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.color || '#0d1b2a' }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {vm.custom_fields && typeof vm.custom_fields === 'object' && Object.keys(vm.custom_fields).length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
                  {Object.entries(vm.custom_fields).map(([k, v]) => (
                    <div key={k} style={{ background: '#f8f7f4', borderRadius: 12, padding: '10px 14px' }}>
                      <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{k}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a' }}>{String(v)}</div>
                    </div>
                  ))}
                </div>
              )}
              {vm.tags && (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 22 }}>
                  {vm.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                    <span key={tag} style={{ background: '#EEEDFE', color: '#6a1b9a', padding: '4px 13px', borderRadius: 99, fontSize: 12.5, fontWeight: 600 }}>{tag}</span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Button onClick={() => { setViewItem(null); openPO(vm) }}><Truck size={14} /> Create purchase order</Button>
                <Button variant="ghost" onClick={() => { setViewItem(null); openEdit(vm) }}><Edit2 size={14} /> Edit</Button>
                <Button variant="ghost" onClick={() => showBarcode(vm)}><Barcode size={14} /> Barcode</Button>
              </div>
            </div>
          </div>
        </Modal>
        )
      })()}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}

// ── Apple-style catalog grid ───────────────────────────────
function CatalogGrid({ items, activeSupplier, suppliers, selectMode, selectedIds, onToggleSelect, inventoryNames, onView, onPO, onEdit, onBarcode, onDelete }) {
  const [openMenuId, setOpenMenuId] = useState(null)
  const inInventory = item => inventoryNames?.has((item.product_name || '').toLowerCase().trim())
  const supplierNames = item => {
    const s = suppliers?.find(x => x.id === item.supplier_id)
    const company = s?.name || item.supplier_name || ''
    const contact = s?.contact_name || ''
    return { main: contact || company, sub: contact ? company : '' }
  }
  return (
    <>
      <style>{`
        @keyframes catIn { from { opacity:0; transform: translateY(14px);} to { opacity:1; transform: translateY(0);} }
        .cat-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 372px), 1fr)); gap: 34px 28px; }
        .cat-card { animation: catIn 0.32s ease both; position:relative; display:flex; flex-direction:column; height:100%; }
        .cat-tile { position:relative; width:100%; aspect-ratio:372/443; border-radius:22px; overflow:hidden; cursor:pointer;
          background: #fff;
          box-shadow: inset 0 1.5px 0 rgba(255,255,255,0.95), inset 0 -3px 8px rgba(0,0,0,0.07), inset 0 0 0 1px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.05);
          transition: transform .28s cubic-bezier(.2,.7,.3,1), box-shadow .28s; }
        .cat-card:hover .cat-tile { transform: translateY(-6px) scale(1.012); box-shadow: inset 0 1.5px 0 rgba(255,255,255,0.95), 0 16px 34px rgba(13,27,42,0.16); }
        .cat-tile.sel { outline:3px solid #FFA500; outline-offset:2px; }
        .cat-tile img { width:100%; height:100%; object-fit:contain; background:#fff; display:block; padding:25px; box-sizing:border-box; }
        @media (max-width: 600px) { .cat-grid { gap: 16px; } .cat-tile img { padding: 16px; } .cat-tile { border-radius: 18px; } }
        .cat-meta { position:absolute; bottom:12px; left:12px; right:12px; display:flex; gap:8px; flex-wrap:wrap; }
        .cat-chip { display:inline-flex; align-items:center; gap:4px; font-size:11.5px; font-weight:700; color:#4a5568; background:rgba(255,255,255,0.9); backdrop-filter:blur(6px); padding:5px 10px; border-radius:999px; box-shadow:0 2px 6px rgba(0,0,0,0.08); }
        .cat-kebab { position:absolute; top:12px; right:12px; display:flex; align-items:center; gap:7px; opacity:0; transition:opacity .2s; }
        .cat-card:hover .cat-kebab, .cat-kebab.pinned { opacity:1; }
        .cat-tray { display:flex; align-items:center; gap:7px; max-width:0; opacity:0; overflow:hidden; transition: max-width .32s cubic-bezier(.2,.7,.3,1), opacity .22s; }
        .cat-tray.open { max-width:160px; opacity:1; }
        .cat-act { width:34px; height:34px; border-radius:11px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; background:rgba(255,255,255,0.92); backdrop-filter:blur(6px); box-shadow:0 2px 8px rgba(0,0,0,0.14); transition:transform .15s; }
        .cat-act:hover { transform:scale(1.1); }
        .cat-sel { position:absolute; top:14px; left:14px; z-index:2; width:26px; height:26px; border-radius:8px; border:2px solid rgba(255,255,255,0.9); background:rgba(255,255,255,0.85); cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(0,0,0,0.12); }
        .cat-sel.on { background:#FFA500; border-color:#FFA500; }
        .cat-po { display:inline-flex; align-items:center; gap:7px; background:linear-gradient(135deg,#4aa3ec,#2f7fd6); color:#fff; border:none; border-radius:999px; padding:9px 18px; font-size:13px; font-weight:700; cursor:pointer; font-family:inherit; box-shadow:0 4px 12px rgba(47,127,214,0.32); transition:transform .15s; }
        .cat-po:hover { transform:translateY(-2px); }
        @media (max-width: 768px) {
          .cat-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)) !important; gap: 14px !important; }
          .cat-tile { min-height: 0 !important; }
          .cat-tile img { padding: 14px !important; }
          .cat-chip { font-size: 10.5px !important; padding: 4px 8px !important; }
        }
      `}</style>
      <div className="cat-grid">
        {items.map(item => {
          const m = item.cost_price > 0 && item.sell_price > 0 ? Math.round((item.sell_price - item.cost_price) / item.cost_price * 100) : 0
          const sel = selectedIds?.has(item.id)
          const menuOpen = openMenuId === item.id
          return (
            <div key={item.id} className="cat-card" onMouseEnter={() => { if (openMenuId && openMenuId !== item.id) setOpenMenuId(null) }}>
              <div className={`cat-tile ${sel ? 'sel' : ''}`} onClick={() => selectMode ? onToggleSelect(item.id) : onView(item)}>
                {item.image_url
                  ? <img src={item.image_url} alt={item.product_name} onError={e=>{e.target.style.display='none'}} />
                  : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}><Package size={52} color="#cfcfd6" /></div>}

                {selectMode && (
                  <div className={`cat-sel ${sel ? 'on' : ''}`} onClick={e => { e.stopPropagation(); onToggleSelect(item.id) }}>
                    {sel && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L6 10.5L11.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                )}

                {!inInventory(item) && (
                  <span style={{ position:'absolute', top:12, left:12, zIndex:2, fontSize:10, fontWeight:700, color:'#fff', background:'#E24B4A', padding:'3px 9px', borderRadius:99, boxShadow:'0 2px 8px rgba(226,75,74,0.4)', textTransform:'uppercase', letterSpacing:'0.3px' }}>Not in inventory</span>
                )}

                <div className="cat-meta">
                  {item.pieces ? <span className="cat-chip"><BrickIcon size={16} color="#FFA500" /> {item.pieces}</span> : null}
                  {item.age_range ? <span className="cat-chip"><CakeIcon size={14} color="#378ADD" /> {item.age_range}</span> : null}
                  {m > 0 && <span className="cat-chip"><Percent size={12} color="#1D9E75" /><span style={{ color:'#1D9E75' }}>{m}%</span></span>}
                </div>

                {!selectMode && (
                  <div className={`cat-kebab ${menuOpen ? 'pinned' : ''}`} onClick={e => e.stopPropagation()}>
                    <div className={`cat-tray ${menuOpen ? 'open' : ''}`}>
                      <button className="cat-act" title="Barcode" onClick={() => onBarcode(item)}><Barcode size={15} color="#FFA500" /></button>
                      <button className="cat-act" title="Edit" onClick={() => onEdit(item)}><Edit2 size={15} color="#0d1b2a" /></button>
                      <button className="cat-act" title="Delete" onClick={() => onDelete(item)}><Trash2 size={15} color="#E24B4A" /></button>
                    </div>
                    <button className="cat-act" onClick={() => setOpenMenuId(menuOpen ? null : item.id)}>
                      {menuOpen ? <X size={15} color="#0d1b2a" /> : <MoreVertical size={15} color="#0d1b2a" />}
                    </button>
                  </div>
                )}
              </div>

              <div style={{ textAlign:'center', padding:'15px 8px 0', display:'flex', flexDirection:'column', flex:1 }}>
                <div className="cat-name" style={{ fontSize:18, fontWeight:700, color:'#0d1b2a', letterSpacing:'-0.3px', lineHeight:1.2, minHeight:'2.4em', display:'flex', alignItems:'center', justifyContent:'center' }}>{item.product_name}</div>
                <div style={{ fontSize:12, color:'#aaa', marginTop:4, fontWeight:600 }}>
                  {!activeSupplier && <span>{supplierNames(item).main} · </span>}{item.category || item.unit}
                </div>
                <div style={{ marginTop:8, minHeight:'2.9em', display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
                  {item.cost_price ? <div style={{ fontSize:12, color:'#999', fontWeight:600 }}>Cost MVR {Number(item.cost_price).toFixed(2)}</div> : null}
                  <div style={{ fontSize:20, fontWeight:800, color:'#0d1b2a', letterSpacing:'-0.4px' }}>
                    {item.sell_price ? `MVR ${Number(item.sell_price).toFixed(2)}` : (item.cost_price ? '—' : 'No price')}
                  </div>
                </div>
                {!selectMode && (
                  <div style={{ marginTop:'auto', paddingTop:13, paddingBottom:4 }}>
                    <button className="cat-po" onClick={() => onPO(item)}><Truck size={15} /> Order</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
