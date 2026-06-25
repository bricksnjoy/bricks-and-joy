import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Badge, StockBadge, Spinner, FormRow, useToast, Toasts, ImageTile } from '../components/UI'
import { Plus, Trash2, Edit2, Upload, X, Package, Eye, Barcode, Download, Printer, Camera, LayoutGrid, List, MoreVertical, ShoppingBag, Percent, Minus, RotateCcw } from 'lucide-react'

// Custom line-art icons matching the toy/store brand
const BrickIcon = ({ size = 14, color = '#FFA500' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    <path d="M4 9.5l8-4 8 4v6l-8 4-8-4z" />
    <path d="M4 9.5l8 4 8-4M12 13.5v6" />
    <ellipse cx="8.5" cy="6.6" rx="1.5" ry="0.9" /><ellipse cx="13" cy="4.7" rx="1.5" ry="0.9" />
  </svg>
)
const CakeIcon = ({ size = 14, color = '#378ADD' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
    <path d="M4 20h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z" />
    <path d="M4 15c1.3 1 2.7 1 4 0s2.7-1 4 0 2.7 1 4 0 2.7-1 4 0" />
    <path d="M8 8V5M12 8V4.5M16 8V5" />
  </svg>
)
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import BarcodeScanner from '../components/BarcodeScanner'
import { restockPredictions, costHistoryByProduct } from '../lib/insights'

const CATEGORIES = ['Building & Blocks','Action Figures','Dolls & Plush','Board Games','Outdoor & Sports','Educational','Vehicles & RC','Arts & Crafts','Puzzles','Other']
const AGE_RANGES = ['0–2','3–5','6–8','9–12','12+','All ages']
const EMPTY = { name:'', category:'Building & Blocks', age_range:'3–5', brand:'', sku:'', barcode:'', pieces:'', stock_qty:0, low_stock_threshold:10, cost_price:0, sell_price:0, description:'', sizes:'', weight:'', dimensions:'', tags:'', photo_url:'', discontinued:false }

// Generate a unique barcode number
function genBarcode(name, id) {
  const prefix = '299' // Custom prefix for Brick's & Joy
  const hash = (name + (id || Date.now())).split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
  const num = Math.abs(hash).toString().padStart(9, '0').slice(0, 9)
  return prefix + num
}

export default function Inventory() {
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [customers, setCustomers] = useState([])
  const [orders, setOrders] = useState([])
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [orderModal, setOrderModal] = useState(null)
  const [orderForm, setOrderForm] = useState({ qty: 1, unit_price: 0, customer_id: '', customer_name: '', payment_status: 'unpaid', channel: 'Retail store' })
  const [placingOrder, setPlacingOrder] = useState(false)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [viewModal, setViewModal] = useState(null)
  const [barcodeModal, setBarcodeModal] = useState(null)
  const [scanModal, setScanModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [barcodeType, setBarcodeType] = useState('barcode') // 'barcode' | 'qr'
  const [labelQty, setLabelQty] = useState(1)
  const [scanResult, setScanResult] = useState(null)
  const barcodeRef = useRef(null)
  const qrCanvasRef = useRef(null)
  const videoRef = useRef(null)
  const scannerRef = useRef(null)
  const toast = useToast()

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (barcodeModal && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, barcodeModal.barcode, {
          format: 'CODE128', width: 2, height: 80, displayValue: true,
          text: barcodeModal.barcode, fontOptions: '', font: 'Poppins, Arial',
          textAlign: 'center', textPosition: 'bottom', textMargin: 6,
          fontSize: 14, background: '#ffffff', lineColor: '#000000',
          margin: 10,
        })
      } catch(e) { console.log('Barcode error', e) }
    }
  }, [barcodeModal, barcodeType])

  useEffect(() => {
    if (barcodeModal && qrCanvasRef.current && barcodeType === 'qr') {
      const qrData = JSON.stringify({ id: barcodeModal.id, name: barcodeModal.name, price: barcodeModal.sell_price, barcode: barcodeModal.barcode })
      QRCode.toCanvas(qrCanvasRef.current, qrData, { width: 220, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
        .catch(e => console.log('QR error', e))
    }
  }, [barcodeModal, barcodeType])

  async function load() {
    setLoading(true)
    const [p, s, c, o, po] = await Promise.all([
      supabase.from('products').select('*, suppliers(name)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('id, name, contact_name'),
      supabase.from('customers').select('id, name').order('name'),
      supabase.from('orders').select('product_id, qty, status, order_date'),
      supabase.from('purchase_orders').select('product_id, unit_cost, total_cost, qty, order_date, created_at'),
    ])
    setProducts(p.data || [])
    setSuppliers(s.data || [])
    setCustomers(c.data || [])
    setOrders(o.data || [])
    setPurchaseOrders(po.data || [])
    setLoading(false)
  }

  async function toggleDiscontinued(product) {
    await supabase.from('products').update({ discontinued: !product.discontinued }).eq('id', product.id)
    toast.success(product.discontinued ? `${product.name} marked active` : `${product.name} marked discontinued`)
    load()
  }

  function openAdd() { 
    const bc = genBarcode('new', Date.now())
    setForm({ ...EMPTY, barcode: bc })
    setModal('add') 
  }
  function openEdit(p) { setForm({ ...EMPTY, ...p, sizes: p.sizes || '', tags: p.tags || '', _origStock: p.stock_qty }); setModal('edit') }
  function openView(p) { setViewModal(p) }
  function startScanner() { setScanModal(true); setScanResult(null) }
  function openBarcode(p) {
    setLabelQty(1)
    if (!p.barcode) {
      const bc = genBarcode(p.name, p.id)
      supabase.from('products').update({ barcode: bc }).eq('id', p.id).then(() => {
        setBarcodeModal({ ...p, barcode: bc })
        load()
      })
    } else {
      setBarcodeModal(p)
    }
  }

  async function uploadPhoto(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const fileName = `product-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('uploads').upload(fileName, file, { upsert: true })
    if (error) {
      const reader = new FileReader()
      reader.onload = ev => { setForm(p => ({ ...p, photo_url: ev.target.result })); setUploading(false) }
      reader.readAsDataURL(file)
      return
    }
    const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(fileName)
    setForm(p => ({ ...p, photo_url: publicUrl }))
    setUploading(false)
    toast.success('Photo uploaded!')
  }

  async function save() {
    if (!form.name) return
    setSaving(true)
    // Auto-generate barcode if empty
    const barcode = form.barcode || genBarcode(form.name, form.id || Date.now())
    // Strip nested relation data + edit-only helper that Supabase rejects on update
    const { suppliers: _s, supplier_name: _sn, _origStock, ...cleanForm } = form
    const payload = { ...cleanForm, barcode, pieces: form.pieces === '' || form.pieces == null ? null : parseInt(form.pieces) || null, stock_qty: parseInt(form.stock_qty) || 0, cost_price: parseFloat(form.cost_price) || 0, sell_price: parseFloat(form.sell_price) || 0, low_stock_threshold: (form.low_stock_threshold === '' || form.low_stock_threshold == null || isNaN(parseInt(form.low_stock_threshold))) ? 10 : parseInt(form.low_stock_threshold) }
    // On edit, don't overwrite stock if the user didn't change it — avoids clobbering
    // stock changes made by orders while the edit modal was open.
    if (modal === 'edit' && _origStock != null && (parseInt(form.stock_qty) || 0) === (Number(_origStock) || 0)) delete payload.stock_qty
    const doSave = pl => modal === 'add'
      ? supabase.from('products').insert(pl)
      : supabase.from('products').update(pl).eq('id', form.id)
    let { error } = await doSave(payload)
    // Gracefully handle DBs that don't yet have the optional `pieces` column
    if (error && /pieces/i.test(error.message || '')) {
      const { pieces: _drop, ...noPieces } = payload
      const retry = await doSave(noPieces)
      error = retry.error
      if (!error) toast.info('Saved. Add a "pieces" column in Supabase to store piece counts.')
    }
    setSaving(false)
    if (error) { toast.error('Failed to save: ' + error.message); return }
    toast.success(modal === 'add' ? 'Product added!' : 'Updated!')
    setModal(null); load()
  }

  function openOrder(p) {
    setOrderForm({ qty: 1, unit_price: Number(p.sell_price) || 0, customer_id: '', customer_name: '', payment_status: 'unpaid', channel: 'Retail store' })
    setOrderModal(p)
  }

  async function createOrder() {
    const p = orderModal
    const qty = parseInt(orderForm.qty) || 1
    const unit = parseFloat(orderForm.unit_price) || 0
    if (qty < 1) { toast.error('Quantity must be at least 1'); return }
    setPlacingOrder(true)
    const cust = customers.find(c => c.id === orderForm.customer_id)
    const payload = {
      customer_id: orderForm.customer_id || null,
      customer_name: cust?.name || orderForm.customer_name || '',
      channel: orderForm.channel,
      status: 'pending',
      order_date: new Date().toISOString().split('T')[0],
      payment_status: orderForm.payment_status,
      invoice_number: `INV-${Date.now().toString().slice(-6)}`,
      product_id: p.id,
      product_name: p.name,
      qty,
      unit_price: unit,
      total_price: unit * qty,
      discount: 0,
    }
    const { error } = await supabase.from('orders').insert(payload)
    if (error) { setPlacingOrder(false); toast.error('Failed to create order: ' + error.message); return }
    // decrement stock
    const newStock = (p.stock_qty || 0) - qty
    await supabase.from('products').update({ stock_qty: newStock }).eq('id', p.id)
    setPlacingOrder(false)
    setOrderModal(null)
    toast.success(`Order created for ${p.name} — view it in Orders`)
    load()
  }

  async function del(id) {
    if (!window.confirm('Delete this product?')) return
    await supabase.from('products').delete().eq('id', id)
    toast.success('Deleted'); load()
  }

  // Download barcode as PNG
  function downloadBarcode() {
    if (barcodeType === 'barcode' && barcodeRef.current) {
      const svgData = new XMLSerializer().serializeToString(barcodeRef.current)
      const canvas = document.createElement('canvas')
      const img = new Image()
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)
      img.onload = () => {
        canvas.width = img.width * 2
        canvas.height = img.height * 2
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const a = document.createElement('a')
        a.download = `barcode-${barcodeModal.name}-${barcodeModal.barcode}.png`
        a.href = canvas.toDataURL('image/png')
        a.click()
        URL.revokeObjectURL(url)
      }
      img.src = url
    } else if (barcodeType === 'qr' && qrCanvasRef.current) {
      const a = document.createElement('a')
      a.download = `qrcode-${barcodeModal.name}.png`
      a.href = qrCanvasRef.current.toDataURL('image/png')
      a.click()
    }
    toast.success('Downloaded to gallery!')
  }

  // Save to clipboard
  async function copyToClipboard() {
    try {
      const canvas = barcodeType === 'qr' ? qrCanvasRef.current : null
      if (canvas) {
        canvas.toBlob(async blob => {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          toast.success('Copied to clipboard!')
        })
      } else {
        toast.info('Download the barcode to share it')
      }
    } catch { toast.info('Use the Download button to save and share') }
  }

  // Print barcode label
  function printBarcode() {
    const logoUrl = window.location.origin + '/logo-full.png'
    const w = window.open('', '_blank', 'width=400,height=300')
    const isQR = barcodeType === 'qr'
    let imgSrc = ''
    
    if (isQR && qrCanvasRef.current) {
      imgSrc = qrCanvasRef.current.toDataURL('image/png')
    } else if (barcodeRef.current) {
      const svgData = new XMLSerializer().serializeToString(barcodeRef.current)
      imgSrc = 'data:image/svg+xml;base64,' + btoa(svgData)
    }
    
    const qty = Math.max(1, parseInt(labelQty) || 1)
    const oneLabel = `
        <div class="label">
          <div class="label-top">
            <div class="logo-wrap">
              <img class="brand-logo" src="${logoUrl}" alt="Brick's & Joy" onerror="this.style.display='none'" />
            </div>
            <div class="top-right">
              <div class="top-tag">Product Label</div>
            </div>
          </div>
          <div class="barcode-strip">
            <img src="${imgSrc}" alt="barcode" />
          </div>
          <div class="product-info">
            <div class="product-name">${barcodeModal.name}</div>
            ${barcodeModal.brand ? `<div class="product-brand">${barcodeModal.brand}</div>` : ''}
            <div class="product-footer">
              <div class="price-tag">MVR ${Number(barcodeModal.sell_price).toFixed(2)}</div>
              <div class="code-block">
                <div class="code-num">${barcodeModal.barcode}</div>
                ${barcodeModal.sizes ? `<div class="sizes-text">${barcodeModal.sizes}</div>` : ''}
              </div>
            </div>
          </div>
        </div>`
    w.document.write(`
      <html><head><title>Label — ${barcodeModal.name}</title>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Poppins', Arial, sans-serif; background: #f0f0f0; padding: 16px; ${qty === 1 ? 'display: flex; align-items: center; justify-content: center; min-height: 100vh;' : ''} }
        .sheet { display: grid; grid-template-columns: ${qty === 1 ? '1fr' : 'repeat(2, 1fr)'}; gap: 14px; ${qty === 1 ? 'width: 300px;' : 'max-width: 640px; margin: 0 auto;'} }
        .label { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,0.12); break-inside: avoid; }

        /* Top row: logo left, brand name right */
        .label-top { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px 8px; border-bottom: 1px solid #f5f5f5; }
        .logo-wrap { display: flex; align-items: center; gap: 9px; }
        .logo-wrap img { height: 40px; width: auto; max-width: 150px; object-fit: contain; }
        .brand-name { font-size: 12px; font-weight: 600; color: #0d1b2a; letter-spacing: -0.2px; }
        .brand-sub { font-size: 8px; color: #bbb; text-transform: uppercase; letter-spacing: 0.8px; margin-top: 1px; }
        .top-right { text-align: right; }
        .top-tag { font-size: 8px; color: #FFA500; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }

        /* Barcode strip */
        .barcode-strip { background: #fff; padding: 14px 16px 8px; text-align: center; }
        .barcode-strip img { max-width: 100%; display: block; margin: 0 auto; }

        /* Product info */
        .product-info { padding: 10px 16px 14px; }
        .product-name { font-size: 15px; font-weight: 600; color: #0d1b2a; letter-spacing: -0.3px; margin-bottom: 2px; }
        .product-brand { font-size: 11px; color: #aaa; margin-bottom: 8px; }
        .product-footer { display: flex; justify-content: space-between; align-items: center; }
        .price-tag { background: #0d1b2a; color: #FFA500; font-size: 15px; font-weight: 700; padding: 5px 14px; border-radius: 8px; letter-spacing: -0.3px; }
        .code-block { text-align: right; }
        .code-num { font-size: 9px; color: #ccc; font-family: monospace; letter-spacing: 0.5px; }
        .sizes-text { font-size: 10px; color: #aaa; margin-top: 6px; }

        @media print { body { background: none; min-height: auto; } .label { box-shadow: none; border: 1px solid #ddd; border-radius: 0; } }
      </style></head>
      <body>
        <div class="sheet">${Array.from({ length: qty }, () => oneLabel).join('')}</div>
        <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }</script>
      </body></html>`)
    w.document.close()
  }

  // Print all barcodes
  async function printAllBarcodes() {
    const logoUrl = window.location.origin + '/logo-full.png'
    const w = window.open('', '_blank')
    const labelGroups = await Promise.all(products.filter(p => p.barcode && !p.discontinued).map(async p => {
      try {
        const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        document.body.appendChild(tempSvg)
        JsBarcode(tempSvg, p.barcode, { format: 'CODE128', width: 1.5, height: 50, displayValue: true, fontSize: 10, margin: 5 })
        const svgData = new XMLSerializer().serializeToString(tempSvg)
        document.body.removeChild(tempSvg)
        const qty = Math.max(1, parseInt(p.stock_qty) || 1)
        return Array.from({ length: qty }, () => ({ name: p.name, price: p.sell_price, barcode: p.barcode, svg: svgData }))
      } catch { return [] }
    }))
    const allLabels = labelGroups.flat()
    w.document.write(`<html><head><title>All Labels — Brick's &amp; Joy</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: 'Poppins', Arial, sans-serif; background: #f8f7f4; padding: 16px; }
      .page-header { background: #0d1b2a; border-radius: 12px; padding: 14px 20px; display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
      .brand-dot { width: 32px; height: 32px; border-radius: 8px; background: #FFA500; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 900; color: #fff; flex-shrink: 0; }
      .brand-title { font-size: 16px; font-weight: 700; color: #fff; }
      .brand-sub { font-size: 10px; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 1px; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
      .label { background: #fff; border: 1px solid #eee; border-radius: 10px; overflow: hidden; break-inside: avoid; }
      .label-top { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; border-bottom: 1px solid #f0f0f0; }
      .label-top-logo { height: 16px; width: auto; max-width: 90px; object-fit: contain; }
      .label-top-text { font-size: 7px; color: #FFA500; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
      .label-body { padding: 6px 8px 8px; text-align: center; }
      .label-body img { max-width: 100%; height: 40px; display: block; margin: 0 auto; }
      .l-name { font-size: 9px; font-weight: 600; color: #0d1b2a; margin: 5px 0 4px; }
      .l-bottom { display: flex; justify-content: space-between; align-items: center; }
      .l-price { background: #0d1b2a; color: #FFA500; font-size: 9px; font-weight: 600; padding: 2px 7px; border-radius: 5px; }
      .l-code { font-size: 6px; color: #ccc; font-family: monospace; text-align: right; }
      @media print { body { background: none; padding: 8px; } .page-header { display: none; } .grid { grid-template-columns: repeat(3, 1fr); gap: 8px; } }
    </style></head><body>
    <div class="page-header">
      <img src="${logoUrl}" alt="" style="height:40px;width:auto;max-width:170px;object-fit:contain;flex-shrink:0;background:#fff;border-radius:6px;padding:3px" onerror="this.style.display='none'" />
      <div>
        <div class="brand-title">Product Labels</div>
        <div class="brand-sub">Printed ${new Date().toLocaleDateString()} · ${allLabels.length} labels</div>
      </div>
    </div>
    <div class="grid">
      ${allLabels.map(l => `
        <div class="label">
          <div class="label-top">
            <img class="label-top-logo" src="${logoUrl}" alt="Brick's & Joy" onerror="this.style.display='none'" />
            <div class="label-top-text">Product</div>
          </div>
          <div class="label-body">
            <img src="data:image/svg+xml;base64,${btoa(l.svg)}" alt="barcode" />
            <div class="l-name">${l.name}</div>
            <div class="l-bottom">
              <div class="l-price">MVR ${Number(l.price).toFixed(2)}</div>
              <div class="l-code">${l.barcode}</div>
            </div>
          </div>
        </div>`).join('')}
    </div>
    <script>window.onload = () => window.print()</script>
    </body></html>`)
    w.document.close()
  }

  function handleScanResult(code) {
    const found = products.find(p => p.barcode === code || p.sku === code)
    setScanResult({ code, product: found || null })
    setScanModal(false)
  }

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const margin = form.sell_price > 0 ? Math.round((form.sell_price - form.cost_price) / form.sell_price * 100) : 0

  const [stockFilter, setStockFilter] = useState('active') // 'active' | 'retired' | 'lowstock' | 'cleared'
  const [view, setView] = useState(() => localStorage.getItem('bnj_inv_view') || 'grid')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [openMenuId, setOpenMenuId] = useState(null)
  function changeView(v) { setView(v); localStorage.setItem('bnj_inv_view', v) }
  function toggleSelect(id) { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function selectAll() { setSelected(new Set(filtered.map(p => p.id))) }
  function clearSelect() { setSelected(new Set()) }

  async function bulkDelete() {
    if (!selected.size) return
    if (!window.confirm(`Delete ${selected.size} product(s)?`)) return
    for (const id of selected) { await supabase.from('products').delete().eq('id', id) }
    toast.success(`Deleted ${selected.size} product(s)`)
    setSelected(new Set()); setSelectMode(false); load()
  }

  async function bulkRetire() {
    if (!selected.size) return
    for (const id of selected) { await supabase.from('products').update({ discontinued: true }).eq('id', id) }
    toast.success(`Retired ${selected.size} product(s)`)
    setSelected(new Set()); setSelectMode(false); load()
  }

  async function bulkPrint() {
    const selProds = products.filter(p => selected.has(p.id) && p.barcode)
    if (!selProds.length) { toast.error('No selected products have barcodes'); return }
    const logoUrl = window.location.origin + '/logo-full.png'
    // One label per unit in stock (min 1 per product)
    const allLabels = selProds.flatMap(p => Array.from({ length: Math.max(1, parseInt(p.stock_qty) || 1) }, () => p))
    const labelSvgs = await Promise.all(allLabels.map(async p => {
      try {
        const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        document.body.appendChild(tempSvg)
        JsBarcode(tempSvg, p.barcode, { format: 'CODE128', width: 1.5, height: 50, displayValue: true, fontSize: 10, margin: 5 })
        const svgData = new XMLSerializer().serializeToString(tempSvg)
        document.body.removeChild(tempSvg)
        return { name: p.name, price: p.sell_price, barcode: p.barcode, svg: svgData }
      } catch { return null }
    }))
    const labels = labelSvgs.filter(Boolean)
    const w = window.open('', '_blank')
    w.document.write(`<html><head><title>Labels</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
    <style>* { margin:0; padding:0; box-sizing:border-box; } body { font-family:'Poppins',Arial,sans-serif; background:#f8f7f4; padding:12px; }
    .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
    .label { background:#fff; border:1px solid #eee; border-radius:10px; overflow:hidden; break-inside:avoid; }
    .lt { display:flex; justify-content:space-between; align-items:center; padding:5px 8px; border-bottom:1px solid #f0f0f0; }
    .lt img { height:15px; width:auto; max-width:85px; object-fit:contain; }
    .lt span { font-size:7px; color:#FFA500; text-transform:uppercase; letter-spacing:0.8px; font-weight:600; }
    .lb { padding:6px 8px 8px; text-align:center; }
    .lb img { max-width:100%; height:40px; display:block; margin:0 auto; }
    .ln { font-size:9px; font-weight:600; color:#0d1b2a; margin:4px 0; }
    .lf { display:flex; justify-content:space-between; align-items:center; }
    .lp { background:#0d1b2a; color:#FFA500; font-size:9px; font-weight:600; padding:2px 7px; border-radius:5px; }
    .lc { font-size:6px; color:#ccc; font-family:monospace; }
    @media print { body { background:none; } }
    </style></head><body><div class="grid">
    ${labels.map(l => `<div class="label">
      <div class="lt"><img src="${logoUrl}" alt="Brick's & Joy" onerror="this.style.display='none'" /><span>Product</span></div>
      <div class="lb"><img src="data:image/svg+xml;base64,${btoa(l.svg)}" /><div class="ln">${l.name}</div>
      <div class="lf"><div class="lp">MVR ${Number(l.price).toFixed(2)}</div><div class="lc">${l.barcode}</div></div></div></div>`).join('')}
    </div><script>window.onload=()=>window.print()</script></body></html>`)
    w.document.close()
  }

  const restock = restockPredictions(products, orders)
  const costHistory = costHistoryByProduct(purchaseOrders)
  const restockNeeded = restock.filter(r => r.urgency === 'out' || r.urgency === 'critical' || r.urgency === 'soon')

  // Total value of stock on hand — "how much you'd get if you sold everything"
  const invValue = products.reduce((acc, p) => {
    if (p.discontinued) return acc
    const q = parseInt(p.stock_qty) || 0
    acc.retail += q * (parseFloat(p.sell_price) || 0)
    acc.cost += q * (parseFloat(p.cost_price) || 0)
    acc.units += q
    return acc
  }, { retail: 0, cost: 0, units: 0 })
  const invProfit = invValue.retail - invValue.cost
  const money0 = n => `MVR ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  const filtered = products.filter(p => {
    const ms = p.name.toLowerCase().includes(search.toLowerCase()) || (p.brand || '').toLowerCase().includes(search.toLowerCase()) || (p.sku || '').toLowerCase().includes(search.toLowerCase()) || (p.barcode || '').includes(search)
    const mc = filterCat === 'all' || p.category === filterCat
    let ms2 = true
    if (stockFilter === 'active') ms2 = !p.discontinued
    else if (stockFilter === 'retired') ms2 = p.discontinued
    else if (stockFilter === 'lowstock') ms2 = !p.discontinued && p.stock_qty > 0 && p.stock_qty <= (p.low_stock_threshold ?? 10)
    else if (stockFilter === 'cleared') ms2 = !p.discontinued && p.stock_qty <= 0
    return ms && mc && ms2
  })

  const columns = [
    { key: 'photo', label: '', render: r => r.photo_url
        ? <img src={r.photo_url} alt={r.name} style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', border: '1px solid #eee' }} />
        : <div style={{ width: 36, height: 36, borderRadius: 8, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Package size={16} color="#ccc" /></div>
    },
    { key: 'name', label: 'Product', render: r => (
      <div>
        <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{r.name}</div>
        <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>{r.barcode || 'No barcode'}</div>
      </div>
    )},
    { key: 'category', label: 'Category', render: r => <Badge color="purple">{r.category}</Badge> },
    { key: 'age_range', label: 'Age', render: r => <Badge color="blue">{r.age_range}</Badge> },
    { key: 'sizes', label: 'Sizes', render: r => r.sizes ? <span style={{ fontSize: 11, color: '#888' }}>{r.sizes}</span> : <span style={{ color: '#ddd' }}>—</span> },
    { key: 'stock_qty', label: 'Stock', render: r => <strong>{r.stock_qty}</strong> },
    { key: 'sell_price', label: 'Price', render: r => `MVR ${Number(r.sell_price).toFixed(2)}` },
    { key: 'margin', label: 'Margin', render: r => { const m = r.sell_price > 0 ? Math.round((r.sell_price - r.cost_price) / r.sell_price * 100) : 0; return <span style={{ color: m >= 40 ? '#2e7d32' : m >= 20 ? '#f57f17' : '#c62828', fontWeight: 600 }}>{m}%</span> }},
    { key: 'status', label: 'Stock', render: r => <StockBadge qty={r.stock_qty} threshold={r.low_stock_threshold} /> },
    { key: 'discontinued', label: 'Active', render: r => (
      <div onClick={() => toggleDiscontinued(r)} title={r.discontinued ? 'Click to mark active' : 'Click to discontinue'}
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
        <div style={{
          width: 36, height: 20, borderRadius: 99, position: 'relative', transition: 'background 0.2s',
          background: r.discontinued ? '#ddd' : '#1D9E75',
        }}>
          <div style={{
            position: 'absolute', top: 2, left: r.discontinued ? 2 : 18, width: 16, height: 16,
            borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
          }} />
        </div>
      </div>
    )},
    { key: 'actions', label: '', render: r => (
      <div style={{ display: 'flex', gap: 4 }}>
        <Button variant="ghost" size="sm" onClick={() => openView(r)} title="View"><Eye size={13} /></Button>
        <Button variant="ghost" size="sm" onClick={() => openBarcode(r)} title="Barcode" style={{ color: '#FFA500' }}><Barcode size={13} /></Button>
        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Edit2 size={13} /></Button>
        <Button variant="danger" size="sm" onClick={() => del(r.id)}><Trash2 size={13} /></Button>
      </div>
    )},
  ]

  return (
    <div>
      <style>{`
        .prod-order { display:inline-flex; align-items:center; justify-content:center; gap:8px; background: linear-gradient(135deg,#FFB733,#FF8A00); color:#fff; border:none; border-radius:999px; padding:11px 26px; font-size:14px; font-weight:700; cursor:pointer; font-family:inherit; box-shadow:0 5px 14px rgba(255,138,0,0.34); transition: transform .15s, box-shadow .15s; }
        .prod-order:hover:not(:disabled) { transform: translateY(-2px); box-shadow:0 9px 20px rgba(255,138,0,0.44); }
        .prod-order:disabled { background:#d8d4cd; box-shadow:none; cursor:not-allowed; }
      `}</style>
      <PageHeader title="Inventory" subtitle={`${products.length} products`}
        action={
          <div className="x-wrap" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setSelectMode(m => { if (m) setSelected(new Set()); return !m })}
              style={{ padding: '8px 16px', border: '1px solid #ddd', borderRadius: 8, background: selectMode ? '#0d1b2a' : '#fff', color: selectMode ? '#fff' : '#555', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
              {selectMode ? 'Cancel' : 'Select'}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', maxWidth: selectMode ? 360 : 0, opacity: selectMode ? 1 : 0, overflow: 'hidden', transition: 'max-width 0.32s cubic-bezier(.2,.7,.3,1), opacity 0.25s' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: '#f8f7f4', borderRadius: 10, padding: '5px 10px', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0d1b2a' }}>{selected.size} selected</span>
                <button onClick={selectAll} style={{ fontSize: 11, padding: '4px 9px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>All</button>
                <button onClick={bulkRetire} disabled={!selected.size} style={{ fontSize: 11, padding: '4px 11px', border: 'none', borderRadius: 6, background: selected.size ? '#FFA500' : '#f0ddb8', color: '#fff', cursor: selected.size ? 'pointer' : 'default', fontFamily: 'inherit', fontWeight: 600 }}>Retire</button>
                <button onClick={bulkDelete} disabled={!selected.size} style={{ fontSize: 11, padding: '4px 11px', border: 'none', borderRadius: 6, background: selected.size ? '#E24B4A' : '#e8c5c4', color: '#fff', cursor: selected.size ? 'pointer' : 'default', fontFamily: 'inherit', fontWeight: 600 }}>Delete</button>
                <button onClick={bulkPrint} disabled={!selected.size} style={{ fontSize: 11, padding: '4px 11px', border: 'none', borderRadius: 6, background: selected.size ? '#0d1b2a' : '#cbd2da', color: '#fff', cursor: selected.size ? 'pointer' : 'default', fontFamily: 'inherit', fontWeight: 600 }}>Print</button>
              </div>
            </div>
            <Button variant="ghost" onClick={printAllBarcodes}><Printer size={15} /> Print all</Button>
            <Button onClick={openAdd}><Plus size={15} /> Add product</Button>
          </div>
        } />

      {/* Inventory value band — what you'd receive if you sold all current stock */}
      <div className="inv-value-band" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
        {[
          { label: "Sell-through value", hint: "if you sell everything", value: money0(invValue.retail), color: '#1D9E75', bg: '#E9F7F1', Icon: ShoppingBag },
          { label: 'Cost of stock', hint: 'what it cost you', value: money0(invValue.cost), color: '#2f6fc0', bg: '#EAF2FD', Icon: Package },
          { label: 'Potential profit', hint: 'sell-through − cost', value: money0(invProfit), color: invProfit >= 0 ? '#b8740a' : '#E24B4A', bg: '#FFF6E2', Icon: Percent },
          { label: 'Units in stock', hint: `${products.filter(p => !p.discontinued).length} active products`, value: invValue.units.toLocaleString(), color: '#0d1b2a', bg: '#f5f5f7', Icon: Package },
        ].map((c, i) => (
          <div key={i} style={{ background: c.bg, borderRadius: 14, padding: '15px 17px' }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: c.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 9 }}>
              <c.Icon size={17} color={c.color} />
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color, letterSpacing: '-0.5px' }}>{c.value}</div>
            <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginTop: 2 }}>{c.label}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{c.hint}</div>
          </div>
        ))}
      </div>

      <Card>
        {/* Filter tabs */}
        <div className="x-scroll" style={{ display: 'flex', background: '#f5f5f5', borderRadius: 10, padding: 3, gap: 2, marginBottom: 14, width: 'fit-content', maxWidth: '100%' }}>
          {[
            { key: 'active', label: 'Active', count: products.filter(p => !p.discontinued).length, color: '#1D9E75' },
            { key: 'retired', label: 'Retired', count: products.filter(p => p.discontinued).length, color: '#888' },
            { key: 'lowstock', label: 'Low Stock', count: products.filter(p => !p.discontinued && p.stock_qty > 0 && p.stock_qty <= (p.low_stock_threshold ?? 10)).length, color: '#FFA500' },
            { key: 'cleared', label: 'Cleared Out', count: products.filter(p => !p.discontinued && p.stock_qty <= 0).length, color: '#E24B4A' },
            { key: 'restock', label: '📦 Restock', count: restockNeeded.length, color: '#7F77DD' },
          ].map(tab => (
            <button key={tab.key} onClick={() => { setStockFilter(tab.key); setSelected(new Set()) }}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12.5, fontWeight: stockFilter === tab.key ? 700 : 500,
                background: stockFilter === tab.key ? (tab.key === 'active' ? '#1D9E75' : tab.key === 'retired' ? '#666' : tab.key === 'lowstock' ? '#FFA500' : tab.key === 'restock' ? '#7F77DD' : '#E24B4A') : 'transparent',
                color: stockFilter === tab.key ? '#fff' : '#888',
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6 }}>
              {tab.label}
              <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(0,0,0,0.15)', borderRadius: 99, padding: '1px 6px' }}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Search row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <button onClick={startScanner} title="Scan barcode to find product"
              style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 5, borderRadius: 7, display: 'flex', alignItems: 'center' }}>
              <Camera size={16} color="#FFA500" />
            </button>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search or scan barcode…"
              style={{ padding: '9px 14px 9px 36px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: 252, outline: 'none' }} />
          </div>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            style={{ padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
            <option value="all">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 0, border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', marginLeft: 'auto' }}>
            <button onClick={() => changeView('grid')} title="Grid view"
              style={{ padding: '7px 11px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', background: view === 'grid' ? '#0d1b2a' : '#fff' }}>
              <LayoutGrid size={15} color={view === 'grid' ? '#fff' : '#999'} />
            </button>
            <button onClick={() => changeView('list')} title="List view"
              style={{ padding: '7px 11px', border: 'none', borderLeft: '1px solid #ddd', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', background: view === 'list' ? '#0d1b2a' : '#fff' }}>
              <List size={15} color={view === 'list' ? '#fff' : '#999'} />
            </button>
          </div>
        </div>

        {loading ? <Spinner /> : stockFilter === 'restock'
          ? <RestockView rows={restock} onView={openView} onReorder={p => { setViewModal(null); openOrder(p) }} products={products} />
          : view === 'list'
          ? <Table columns={columns} data={filtered} emptyMessage="No products found." />
          : (filtered.length === 0
              ? <div style={{ textAlign: 'center', padding: '60px 20px', color: '#bbb' }}>No products found.</div>
              : <ProductGrid products={filtered} onView={openView} onEdit={openEdit} onBarcode={openBarcode} onDelete={del} onToggle={toggleDiscontinued} onOrder={openOrder}
                  selectMode={selectMode} selected={selected} onToggleSelect={toggleSelect}
                  openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} />
          )}
      </Card>

      {/* ── BARCODE MODAL ── */}
      {barcodeModal && (
        <Modal title={`Barcode — ${barcodeModal.name}`} onClose={() => setBarcodeModal(null)} width={420}>
          {/* Type toggle */}
          <div style={{ display: 'flex', background: '#f0f0f0', borderRadius: 10, padding: 4, marginBottom: 20, width: 'fit-content' }}>
            {[['barcode','📊 Barcode'],['qr','📱 QR Code']].map(([type, label]) => (
              <button key={type} onClick={() => setBarcodeType(type)}
                style={{ padding: '7px 18px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: barcodeType === type ? 700 : 500, background: barcodeType === type ? '#fff' : 'transparent', color: barcodeType === type ? '#0d1b2a' : '#888', boxShadow: barcodeType === type ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s' }}>
                {label}
              </button>
            ))}
          </div>

          {/* Barcode display */}
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '20px', textAlign: 'center', marginBottom: 16 }}>
            {barcodeType === 'barcode'
              ? <svg ref={barcodeRef} style={{ maxWidth: '100%' }} />
              : <canvas ref={qrCanvasRef} style={{ maxWidth: '100%', borderRadius: 8 }} />
            }
            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: '#0d1b2a' }}>{barcodeModal.name}</div>
            {barcodeModal.brand && <div style={{ fontSize: 12, color: '#888' }}>{barcodeModal.brand}</div>}
            <div style={{ fontSize: 13, color: '#FFA500', fontWeight: 700, marginTop: 4 }}>MVR {Number(barcodeModal.sell_price).toFixed(2)}</div>
            {barcodeModal.sizes && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Sizes: {barcodeModal.sizes}</div>}
          </div>

          {/* Print quantity */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, padding: '10px 14px', background: '#f8f7f4', borderRadius: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#555' }}>Labels to print</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setLabelQty(q => Math.max(1, (parseInt(q) || 1) - 1))} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Minus size={14} /></button>
              <input type="number" min="1" value={labelQty} onChange={e => setLabelQty(e.target.value)}
                style={{ width: 56, textAlign: 'center', padding: '6px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', outline: 'none' }} />
              <button onClick={() => setLabelQty(q => (parseInt(q) || 0) + 1)} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={14} /></button>
              {barcodeModal.stock_qty > 0 && (
                <button onClick={() => setLabelQty(barcodeModal.stock_qty)} title="One per unit in stock"
                  style={{ marginLeft: 4, padding: '6px 10px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', color: '#7F77DD' }}>
                  = stock ({barcodeModal.stock_qty})
                </button>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button onClick={downloadBarcode} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: '#FFA500', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background='#e6940a'; e.currentTarget.style.transform='translateY(-1px)' }}
              onMouseLeave={e => { e.currentTarget.style.background='#FFA500'; e.currentTarget.style.transform='translateY(0)' }}>
              <Download size={15} /> Download
            </button>
            <button onClick={printBarcode} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: '#0d1b2a', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background='#1a2f44'; e.currentTarget.style.transform='translateY(-1px)' }}
              onMouseLeave={e => { e.currentTarget.style.background='#0d1b2a'; e.currentTarget.style.transform='translateY(0)' }}>
              <Printer size={15} /> Print label
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#aaa', textAlign: 'center', marginTop: 10 }}>
            Download saves to your gallery · Print opens print dialog for label printing
          </div>
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#f8f7f4', borderRadius: 8, fontSize: 12, color: '#666', textAlign: 'center', fontFamily: 'monospace' }}>
            {barcodeModal.barcode}
          </div>
        </Modal>
      )}

      {/* ── SCANNER MODAL ── */}
      {scanModal && (
        <Modal title="📷 Scan barcode or QR code" onClose={() => { setScanModal(false); setScanResult(null) }} width={420}>
          {!scanResult ? (
            <BarcodeScanner
              onScan={handleScanResult}
              onClose={() => setScanModal(false)}
            />
          ) : (
            <div>
              <div style={{ padding: '16px', borderRadius: 12, background: scanResult.product ? '#E1F5EE' : '#FFF8E1', border: `1px solid ${scanResult.product ? '#cde' : '#FAEEDA'}`, marginBottom: 16 }}>
                {scanResult.product ? (
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1b2a', marginBottom: 8 }}>✅ Product found!</div>
                    {scanResult.product.photo_url && <img src={scanResult.product.photo_url} alt="" style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover', marginBottom: 8 }} />}
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{scanResult.product.name}</div>
                    <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>Price: MVR {Number(scanResult.product.sell_price).toFixed(2)}</div>
                    <div style={{ fontSize: 13, color: '#666' }}>Stock: {scanResult.product.stock_qty}</div>
                    <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 4 }}>{scanResult.code}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <Button onClick={() => { openView(scanResult.product); setScanModal(false); setScanResult(null) }}>View details</Button>
                      <Button variant="ghost" onClick={() => setScanResult(null)}>Scan again</Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#854F0B', marginBottom: 8 }}>⚠️ Not found</div>
                    <div style={{ fontSize: 13, color: '#666' }}>Code <span style={{ fontFamily: 'monospace' }}>{scanResult.code}</span> not in your inventory.</div>
                    <Button onClick={() => setScanResult(null)} style={{ marginTop: 10 }} variant="ghost">Scan again</Button>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => { setScanModal(false); setScanResult(null) }}>Close</Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── VIEW PRODUCT MODAL (big & cool) ── */}
      {viewModal && (() => {
        const vm = viewModal
        const vmMargin = vm.sell_price > 0 ? Math.round((vm.sell_price - vm.cost_price) / vm.sell_price * 100) : 0
        const vmOut = vm.stock_qty <= 0
        const stats = [
          { label: 'Sell price', value: `MVR ${Number(vm.sell_price).toFixed(2)}`, color: '#0d1b2a' },
          { label: 'Cost price', value: `MVR ${Number(vm.cost_price).toFixed(2)}`, color: '#0d1b2a' },
          { label: 'Margin', value: `${vmMargin}%`, color: vmMargin >= 40 ? '#1D9E75' : vmMargin >= 20 ? '#f57f17' : '#E24B4A' },
          { label: 'In stock', value: vm.stock_qty, color: vmOut ? '#E24B4A' : '#1D9E75' },
          { label: 'Low stock at', value: vm.low_stock_threshold },
          vm.pieces ? { label: 'Pieces', value: vm.pieces } : { label: 'Sizes', value: vm.sizes || '—' },
        ]
        return (
        <Modal title="" onClose={() => setViewModal(null)} width={1000}>
          <div style={{ display: 'grid', gridTemplateColumns: '440px 1fr', gap: 36, alignItems: 'start' }} className="vm-grid">
            <style>{`@media (max-width: 860px){ .vm-grid { grid-template-columns: 1fr !important; } }`}</style>
            {/* Hero image */}
            <div style={{ position: 'relative', width: '100%', aspectRatio: '372 / 443', borderRadius: 26, overflow: 'hidden',
              background: '#fff', padding: 25, boxSizing: 'border-box',
              boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.95), inset 0 -4px 10px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(0,0,0,0.04), 0 10px 30px rgba(13,27,42,0.12)' }}>
              {vm.photo_url
                ? <img src={vm.photo_url} alt={vm.name} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff', borderRadius: 12 }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Package size={80} color="#cfcfd6" /></div>}
              {vm.discontinued && <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(102,102,102,0.92)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Discontinued</div>}
            </div>

            {/* Details */}
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <Badge color="purple">{vm.category}</Badge>
                <Badge color="blue">{vm.age_range}</Badge>
                {vm.pieces ? <span style={{ background: '#FFF3D6', color: '#b8740a', padding: '3px 11px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>{vm.pieces} pieces</span> : null}
              </div>
              <h1 style={{ fontSize: 38, fontWeight: 800, margin: '0 0 6px', color: '#0d1b2a', letterSpacing: '-1px', lineHeight: 1.05 }}>{vm.name}</h1>
              {vm.brand && <div style={{ fontSize: 15, color: '#888', marginBottom: 14 }}>by <strong style={{ color: '#555' }}>{vm.brand}</strong></div>}

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, margin: '6px 0 18px' }}>
                <span style={{ fontSize: 34, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-1px' }}>MVR {Number(vm.sell_price).toFixed(2)}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: vmMargin >= 40 ? '#1D9E75' : vmMargin >= 20 ? '#f57f17' : '#E24B4A' }}>{vmMargin}% margin</span>
              </div>

              {vm.description && <p style={{ fontSize: 16, color: '#555', lineHeight: 1.6, margin: '0 0 20px' }}>{vm.description}</p>}

              <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                {stats.map((item, i) => (
                  <div key={i} style={{ background: '#f8f7f4', borderRadius: 14, padding: '14px 16px' }}>
                    <div style={{ fontSize: 11.5, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>{item.label}</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: item.color || '#0d1b2a', letterSpacing: '-0.3px' }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {(vm.sku || vm.barcode) && (
                <div style={{ display: 'flex', gap: 20, fontSize: 13, color: '#999', marginBottom: 18, flexWrap: 'wrap' }}>
                  {vm.sku && <span>SKU: <strong style={{ color: '#666', fontFamily: 'monospace' }}>{vm.sku}</strong></span>}
                  {vm.barcode && <span>Barcode: <strong style={{ color: '#666', fontFamily: 'monospace' }}>{vm.barcode}</strong></span>}
                </div>
              )}

              {vm.tags && (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 22 }}>
                  {vm.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                    <span key={tag} style={{ background: '#EEEDFE', color: '#6a1b9a', padding: '4px 13px', borderRadius: 99, fontSize: 12.5, fontWeight: 600 }}>{tag}</span>
                  ))}
                </div>
              )}

              {/* Supplier cost history */}
              {costHistory[vm.id] && costHistory[vm.id].points.length >= 2 && (() => {
                const ch = costHistory[vm.id]
                const up = ch.trend === 'up'
                const col = ch.trend === 'up' ? '#E24B4A' : ch.trend === 'down' ? '#1D9E75' : '#888'
                const max = Math.max(...ch.points.map(p => p.cost))
                return (
                  <div style={{ background: '#f8f7f4', borderRadius: 14, padding: '14px 16px', marginBottom: 22 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0d1b2a', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Supplier cost history</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: col, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {up ? '▲' : ch.trend === 'down' ? '▼' : '—'} {ch.changePct >= 0 ? '+' : ''}{ch.changePct.toFixed(0)}%
                        <span style={{ fontWeight: 500, color: '#999' }}>since first order</span>
                      </span>
                    </div>
                    {/* mini bars */}
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 44, marginBottom: 8 }}>
                      {ch.points.slice(-12).map((p, i) => (
                        <div key={i} title={`${p.date}: MVR ${p.cost.toFixed(2)}`}
                          style={{ flex: 1, height: `${Math.max(8, p.cost / max * 100)}%`, background: i === ch.points.slice(-12).length - 1 ? col : '#d8d4c8', borderRadius: '3px 3px 0 0', minWidth: 6 }} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#888' }}>
                      <span>First: <strong style={{ color: '#555' }}>MVR {ch.first.toFixed(2)}</strong></span>
                      <span>Latest: <strong style={{ color: col }}>MVR {ch.last.toFixed(2)}</strong></span>
                      <span>{ch.points.length} orders</span>
                    </div>
                    {up && ch.changePct >= 15 && (
                      <div style={{ fontSize: 11.5, color: '#c0392b', marginTop: 8, fontWeight: 600 }}>
                        ⚠️ Cost up {ch.changePct.toFixed(0)}% — consider renegotiating or finding an alternative supplier.
                      </div>
                    )}
                  </div>
                )
              })()}

              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="prod-order" disabled={vmOut} onClick={() => { setViewModal(null); openOrder(vm) }} style={{ padding: '13px 34px', fontSize: 15.5 }}>
                  <ShoppingBag size={18} /> {vmOut ? 'Out of stock' : 'Order'}
                </button>
                <Button variant="ghost" onClick={() => { openEdit(vm); setViewModal(null) }}><Edit2 size={14} /> Edit</Button>
                <Button variant="ghost" onClick={() => openBarcode(vm)} style={{ color: '#FFA500' }}><Barcode size={14} /> Barcode</Button>
              </div>
            </div>
          </div>
        </Modal>
        )
      })()}

      {/* ── CREATE ORDER MODAL ── */}
      {orderModal && (() => {
        const om = orderModal
        const qty = parseInt(orderForm.qty) || 0
        const unit = parseFloat(orderForm.unit_price) || 0
        const total = qty * unit
        const avail = om.stock_qty || 0
        const tooMany = qty > avail
        return (
        <Modal title="New order" subtitle="Confirm to add it to Orders" onClose={() => setOrderModal(null)} width={460}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18, padding: 12, background: '#f8f7f4', borderRadius: 14 }}>
            {om.photo_url
              ? <img src={om.photo_url} alt={om.name} style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover' }} />
              : <div style={{ width: 64, height: 64, borderRadius: 12, background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Package size={26} color="#ccc" /></div>}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0d1b2a' }}>{om.name}</div>
              <div style={{ fontSize: 12.5, color: '#999' }}>{avail} in stock · {om.category}</div>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>Quantity</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setOrderForm(p => ({ ...p, qty: Math.max(1, (parseInt(p.qty) || 1) - 1) }))} style={{ width: 40, height: 40, borderRadius: 11, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Minus size={16} /></button>
              <input type="number" min="1" value={orderForm.qty} onChange={e => setOrderForm(p => ({ ...p, qty: e.target.value }))}
                style={{ width: 80, textAlign: 'center', padding: '10px', border: `1px solid ${tooMany ? '#E24B4A' : '#ddd'}`, borderRadius: 11, fontSize: 16, fontWeight: 700, fontFamily: 'inherit', outline: 'none' }} />
              <button onClick={() => setOrderForm(p => ({ ...p, qty: (parseInt(p.qty) || 0) + 1 }))} style={{ width: 40, height: 40, borderRadius: 11, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={16} /></button>
            </div>
            {tooMany && <div style={{ fontSize: 11.5, color: '#E24B4A', marginTop: 5 }}>Only {avail} in stock</div>}
          </div>

          <FormRow>
            <Input label="Unit price (MVR)" type="number" step="0.01" value={orderForm.unit_price} onChange={e => setOrderForm(p => ({ ...p, unit_price: e.target.value }))} />
            <Select label="Payment" value={orderForm.payment_status} onChange={e => setOrderForm(p => ({ ...p, payment_status: e.target.value }))}
              options={[{ value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }, { value: 'partial', label: 'Partial' }]} />
          </FormRow>
          <Select label="Customer" value={orderForm.customer_id} onChange={e => setOrderForm(p => ({ ...p, customer_id: e.target.value }))}
            options={[{ value: '', label: '— Walk-in / No customer —' }, ...customers.map(c => ({ value: c.id, label: c.name }))]} style={{ marginBottom: 16 }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0d1b2a', borderRadius: 14, marginBottom: 18 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#FFA500', letterSpacing: '-0.5px' }}>MVR {total.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setOrderModal(null)}>Cancel</Button>
            <button className="prod-order" disabled={placingOrder || qty < 1} onClick={createOrder} style={{ padding: '12px 28px' }}>
              <ShoppingBag size={16} /> {placingOrder ? 'Creating…' : 'Confirm order'}
            </button>
          </div>
        </Modal>
        )
      })()}

      {/* ── ADD/EDIT MODAL ── */}
      {modal && (
        <Modal title={modal === 'add' ? 'Add product' : 'Edit product'} onClose={() => setModal(null)} width={620} noBackdropClose>
          <div style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ position: 'relative' }}>
              {form.photo_url
                ? <img src={form.photo_url} alt="product" style={{ width: 90, height: 90, borderRadius: 12, objectFit: 'cover', border: '1px solid #eee' }} />
                : <div style={{ width: 90, height: 90, borderRadius: 12, background: '#f0f0f0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}><Package size={24} color="#ccc" /><span style={{ fontSize: 10, color: '#aaa' }}>No photo</span></div>
              }
              {form.photo_url && <button onClick={() => setForm(p => ({ ...p, photo_url: '' }))} style={{ position: 'absolute', top: -6, right: -6, background: '#c62828', border: 'none', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}><X size={11} /></button>}
            </div>
            <div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#f0f0f0', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#555' }}>
                <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload photo'}
                <input type="file" accept="image/*" onChange={uploadPhoto} style={{ display: 'none' }} disabled={uploading} />
              </label>
              <p style={{ fontSize: 11, color: '#aaa', margin: '6px 0 0' }}>JPG, PNG up to 5MB</p>
            </div>
          </div>
          <FormRow>
            <Input label="Product name *" value={form.name} onChange={f('name')} placeholder="e.g. LEGO Classic Set" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Select label="Category" value={form.category} onChange={f('category')} options={CATEGORIES} />
            <Select label="Age range" value={form.age_range} onChange={f('age_range')} options={AGE_RANGES} />
          </FormRow>
          <FormRow>
            <Input label="Brand" value={form.brand} onChange={f('brand')} placeholder="e.g. LEGO, Mattel" />
            <Input label="SKU" value={form.sku} onChange={f('sku')} placeholder="Optional" />
          </FormRow>
          <FormRow>
            <Input label="Pieces (optional)" type="number" value={form.pieces} onChange={f('pieces')} placeholder="e.g. 259" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Input label="Barcode (auto-generated)" value={form.barcode} onChange={f('barcode')} placeholder="Auto" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Input label="Sizes" value={form.sizes} onChange={f('sizes')} placeholder="e.g. Small, Medium or 3-5yrs, 6-8yrs" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Input label="Weight" value={form.weight} onChange={f('weight')} placeholder="e.g. 500g" />
            <Input label="Dimensions" value={form.dimensions} onChange={f('dimensions')} placeholder="e.g. 30×20×10cm" />
          </FormRow>
          <FormRow>
            <Input label="Stock qty" type="number" value={form.stock_qty} onChange={f('stock_qty')} />
            <Input label="Low stock alert at" type="number" value={form.low_stock_threshold} onChange={f('low_stock_threshold')} />
          </FormRow>
          <FormRow>
            <Input label="Cost price (MVR)" type="number" step="0.01" value={form.cost_price} onChange={f('cost_price')} />
            <Input label="Sell price (MVR)" type="number" step="0.01" value={form.sell_price} onChange={f('sell_price')} />
          </FormRow>
          {form.sell_price > 0 && (
            <div style={{ background: '#f8f7f4', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 12, display: 'flex', gap: 20 }}>
              <span>Margin: <strong style={{ color: margin >= 40 ? '#2e7d32' : margin >= 20 ? '#f57f17' : '#c62828' }}>{margin}%</strong></span>
              <span>Profit per unit: <strong>MVR {(form.sell_price - form.cost_price).toFixed(2)}</strong></span>
            </div>
          )}
          <Select label="Supplier" value={form.supplier_id || ''} onChange={f('supplier_id')}
            options={[{ value: '', label: '— None —' }, ...suppliers.map(s => ({ value: s.id, label: s.contact_name || s.name }))]}
            style={{ marginBottom: 12 }} />
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Description</label>
            <textarea value={form.description} onChange={f('description')} placeholder="Product description, features, materials…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 70, boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <Input label="Tags (comma separated)" value={form.tags} onChange={f('tags')} placeholder="e.g. popular, new arrival, sale" style={{ marginBottom: 16 }} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : modal === 'add' ? 'Add product' : 'Save changes'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}

// ── Restock predictions view ──────────────────────────────
const URGENCY = {
  out:      { label: 'Out of stock', color: '#E24B4A', bg: '#FDECEA' },
  critical: { label: 'Critical',     color: '#E24B4A', bg: '#FDECEA' },
  soon:     { label: 'Reorder soon', color: '#FFA500', bg: '#FFF8E7' },
  ok:       { label: 'Healthy',      color: '#1D9E75', bg: '#E1F5EE' },
}
function RestockView({ rows, onView, onReorder, products }) {
  if (!rows.length) {
    return <div style={{ textAlign: 'center', padding: '50px 20px', color: '#bbb' }}>Not enough sales history yet to predict restocking. Keep recording orders.</div>
  }
  const fmtDays = d => d === Infinity ? '—' : d <= 0 ? 'now' : `${d}d`
  return (
    <div>
      <div style={{ background: '#F4F3FE', border: '1px solid #e3e0fb', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 12.5, color: '#5b4fb5', display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <Package size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Predictions use the last 60 days of delivered orders. <strong>Days left</strong> = stock ÷ daily sales pace. <strong>Suggested</strong> reorder covers ~30 days of demand.</span>
      </div>
      <div className="x-scroll-wrap">
        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              {['Product', 'Sells/mo', 'In stock', 'Days left', 'Status', 'Suggested reorder', ''].map(h => (
                <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: '1px solid #eee' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const u = URGENCY[r.urgency] || URGENCY.ok
              const prod = products.find(p => p.id === r.id)
              return (
                <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {r.photo_url
                        ? <img src={r.photo_url} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', border: '1px solid #eee', flexShrink: 0 }} />
                        : <div style={{ width: 34, height: 34, borderRadius: 8, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Package size={15} color="#ccc" /></div>}
                      <div style={{ fontWeight: 600, color: '#0d1b2a' }}>{r.name}</div>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#555' }}>{r.perMonth.toFixed(1)}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: r.stock <= 0 ? '#E24B4A' : '#0d1b2a' }}>{r.stock}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: u.color }}>{fmtDays(r.daysLeft)}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: u.color, background: u.bg, padding: '3px 10px', borderRadius: 99 }}>{u.label}</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {r.suggestedReorder > 0
                      ? <span style={{ fontWeight: 800, color: '#7F77DD' }}>+{r.suggestedReorder} units</span>
                      : <span style={{ color: '#bbb' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <Button variant="ghost" size="sm" onClick={() => onView(prod)} title="View product"><Eye size={13} /></Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Apple-style product grid ──────────────────────────────
function ProductGrid({ products, onView, onEdit, onBarcode, onDelete, onToggle, onOrder, selectMode, selected, onToggleSelect, openMenuId, setOpenMenuId }) {
  return (
    <>
      <style>{`
        @keyframes cardIn { from { opacity:0; transform: translateY(14px); } to { opacity:1; transform: translateY(0); } }
        .inv-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 372px), 1fr)); gap: 34px 28px; }
        .prod-card { animation: cardIn 0.35s ease both; position:relative; display:flex; flex-direction:column; height:100%; }
        .prod-tile {
          position: relative; width: 100%; aspect-ratio: 372 / 443; border-radius: 22px; overflow: hidden;
          background: #fff;
          box-shadow: inset 0 1.5px 0 rgba(255,255,255,0.95), inset 0 -3px 8px rgba(0,0,0,0.07),
                      inset 0 0 0 1px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.05);
          transition: transform 0.28s cubic-bezier(.2,.7,.3,1), box-shadow 0.28s; cursor: pointer;
        }
        .prod-card:hover .prod-tile {
          transform: translateY(-6px) scale(1.012);
          box-shadow: inset 0 1.5px 0 rgba(255,255,255,0.95), inset 0 -3px 8px rgba(0,0,0,0.07),
                      inset 0 0 0 1px rgba(0,0,0,0.04), 0 16px 34px rgba(13,27,42,0.16);
        }
        .prod-tile-sel { outline: 3px solid #FFA500 !important; outline-offset: 2px; }
        .prod-tile img { width:100%; height:100%; object-fit: contain; background:#fff; display:block; padding:25px; box-sizing:border-box; }
        /* slide-out kebab */
        .kebab-wrap { position:absolute; top:12px; right:12px; display:flex; align-items:center; gap:7px; opacity:0; transition: opacity 0.2s; }
        .prod-card:hover .kebab-wrap, .kebab-wrap.pinned { opacity:1; }
        .kebab-tray { display:flex; align-items:center; gap:7px; max-width:0; opacity:0; overflow:hidden; transition: max-width 0.32s cubic-bezier(.2,.7,.3,1), opacity 0.22s; }
        .kebab-tray.open { max-width:160px; opacity:1; }
        .prod-act {
          width:34px; height:34px; border-radius:11px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0;
          background: rgba(255,255,255,0.92); backdrop-filter: blur(6px); box-shadow: 0 2px 8px rgba(0,0,0,0.14); transition: transform 0.15s, background 0.15s;
        }
        .prod-act:hover { transform: scale(1.1); }
        /* meta row bottom */
        .meta-row { position:absolute; bottom:12px; left:12px; right:12px; display:flex; gap:8px; }
        .meta-chip { display:inline-flex; align-items:center; gap:4px; font-size:11.5px; font-weight:700; color:#4a5568; background:rgba(255,255,255,0.88); backdrop-filter:blur(6px); padding:5px 10px; border-radius:999px; box-shadow:0 2px 6px rgba(0,0,0,0.08); }
        /* select checkbox */
        .sel-chk { position:absolute; top:14px; left:14px; z-index:2; width:26px; height:26px; border-radius:8px; border:2px solid rgba(255,255,255,0.9); background:rgba(255,255,255,0.85); backdrop-filter:blur(4px); cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(0,0,0,0.12); }
        .sel-chk.checked { background:#FFA500; border-color:#FFA500; }
        @media (max-width: 600px) {
          .inv-grid { gap: 16px; }
          .prod-tile img { padding: 16px; }
          .prod-tile { border-radius: 18px; }
        }
      `}</style>
      <div className="inv-grid">
        {products.map(p => (
          <ProductCard key={p.id} p={p} onView={onView} onEdit={onEdit} onBarcode={onBarcode} onDelete={onDelete} onToggle={onToggle} onOrder={onOrder}
            selectMode={selectMode} isSelected={selected?.has(p.id)} onToggleSelect={onToggleSelect}
            menuOpen={openMenuId === p.id} onMenuToggle={() => setOpenMenuId(openMenuId === p.id ? null : p.id)} onHover={() => { if (openMenuId && openMenuId !== p.id) setOpenMenuId(null) }}
            onRestore={onToggle} />
        ))}
      </div>
    </>
  )
}

function ProductCard({ p, onView, onEdit, onBarcode, onDelete, onOrder, selectMode, isSelected, onToggleSelect, menuOpen, onMenuToggle, onHover, onRestore }) {
  const margin = p.sell_price > 0 ? Math.round((p.sell_price - p.cost_price) / p.sell_price * 100) : 0
  const low = p.stock_qty > 0 && p.stock_qty <= (p.low_stock_threshold ?? 10)
  const out = p.stock_qty <= 0
  const isNew = (p.tags || '').toLowerCase().split(',').map(t => t.trim()).includes('new')
  return (
    <div className="prod-card" onMouseEnter={onHover}>
      <ImageTile src={p.photo_url} className={`prod-tile ${isSelected ? 'prod-tile-sel' : ''}`}
        onClick={() => selectMode ? onToggleSelect(p.id) : onView(p)}>
        {p.photo_url
          ? <img src={p.photo_url} alt={p.name} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Package size={56} color="#cfcfd6" /></div>}

        {/* select checkbox */}
        {selectMode && (
          <div className={`sel-chk ${isSelected ? 'checked' : ''}`} onClick={e => { e.stopPropagation(); onToggleSelect(p.id) }}>
            {isSelected && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7L6 10.5L11.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </div>
        )}

        {/* meta chips bottom */}
        <div className="meta-row">
          {p.pieces ? <span className="meta-chip"><BrickIcon size={18} color="#FFA500" /> {p.pieces}</span> : null}
          <span className="meta-chip"><CakeIcon size={15} color="#378ADD" /> {p.age_range}</span>
          <span className="meta-chip"><Percent size={12} color={margin >= 40 ? '#1D9E75' : margin >= 20 ? '#f57f17' : '#E24B4A'} style={{ flexShrink:0 }} /><span style={{ color: margin >= 40 ? '#1D9E75' : margin >= 20 ? '#f57f17' : '#E24B4A' }}>{margin}%</span></span>
        </div>

        {p.discontinued && !selectMode && (
          <button onClick={e => { e.stopPropagation(); onRestore(p) }} title="Restore to active"
            style={{ position: 'absolute', top: 14, left: 14, background: 'rgba(102,102,102,0.92)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '5px 11px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.5px', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#1D9E75' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(102,102,102,0.92)' }}>
            <RotateCcw size={11} /> Restore
          </button>
        )}

        {/* slide-out kebab — stays open until toggled again or another card hovered */}
        {!selectMode && (
          <div className={`kebab-wrap ${menuOpen ? 'pinned' : ''}`} onClick={e => e.stopPropagation()}>
            <div className={`kebab-tray ${menuOpen ? 'open' : ''}`}>
              <button className="prod-act" title="Barcode" onClick={() => onBarcode(p)}><Barcode size={15} color="#FFA500" /></button>
              <button className="prod-act" title="Edit" onClick={() => onEdit(p)}><Edit2 size={15} color="#0d1b2a" /></button>
              <button className="prod-act" title="Delete" onClick={() => onDelete(p.id)}><Trash2 size={15} color="#E24B4A" /></button>
            </div>
            <button className="prod-act" onClick={onMenuToggle}>
              {menuOpen ? <X size={15} color="#0d1b2a" /> : <MoreVertical size={15} color="#0d1b2a" />}
            </button>
          </div>
        )}
      </ImageTile>

      {/* info under picture */}
      <div style={{ textAlign: 'center', padding: '16px 8px 0', display: 'flex', flexDirection: 'column', flex: 1 }}>
        {isNew && <div style={{ fontSize: 12, fontWeight: 700, color: '#FFA500', marginBottom: 2 }}>New</div>}
        <div style={{ fontSize: 19, fontWeight: 700, color: '#0d1b2a', letterSpacing: '-0.3px', lineHeight: 1.2, minHeight: '2.4em', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.name}</div>
        <div style={{ fontSize: 12, color: '#aaa', marginTop: 4, fontWeight: 600 }}>{p.category}</div>
        <div style={{ fontSize: 15, color: out ? '#E24B4A' : low ? '#f57f17' : '#1D9E75', marginTop: 9, fontWeight: 800 }}>
          {out ? 'Cleared out' : low ? `⚠ ${p.stock_qty} left` : `${p.stock_qty} in stock`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 11, marginTop: 'auto', paddingTop: 9, paddingBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0d1b2a', letterSpacing: '-0.3px' }}>
            MVR {Number(p.sell_price).toFixed(2)}
          </div>
          {p.discontinued
            ? <button onClick={() => onRestore(p)} disabled={selectMode}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 999, border: 'none', background: '#1D9E75', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                <RotateCcw size={14} /> Restore
              </button>
            : <button className="prod-order" disabled={out || selectMode} onClick={() => onOrder(p)}
                style={{ padding: '9px 12px', borderRadius: 999, fontSize: 16 }} title={out ? 'Out of stock' : 'Order'}>
                <ShoppingBag size={16} />
              </button>}
        </div>
      </div>
    </div>
  )
}
