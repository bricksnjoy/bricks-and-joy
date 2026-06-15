import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Badge, StockBadge, Spinner, FormRow, useToast, Toasts } from '../components/UI'
import { Plus, Trash2, Edit2, Upload, X, Package, Eye, Barcode, Download, Printer, Camera, LayoutGrid, List } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import BarcodeScanner from '../components/BarcodeScanner'

const CATEGORIES = ['Building & Blocks','Action Figures','Dolls & Plush','Board Games','Outdoor & Sports','Educational','Vehicles & RC','Arts & Crafts','Puzzles','Other']
const AGE_RANGES = ['0–2','3–5','6–8','9–12','12+','All ages']
const EMPTY = { name:'', category:'Building & Blocks', age_range:'3–5', brand:'', sku:'', barcode:'', stock_qty:0, low_stock_threshold:10, cost_price:0, sell_price:0, description:'', sizes:'', weight:'', dimensions:'', tags:'', photo_url:'', discontinued:false }

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
    const [p, s] = await Promise.all([
      supabase.from('products').select('*, suppliers(name)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('id, name')
    ])
    setProducts(p.data || [])
    setSuppliers(s.data || [])
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
  function openEdit(p) { setForm({ ...EMPTY, ...p, sizes: p.sizes || '', tags: p.tags || '' }); setModal('edit') }
  function openView(p) { setViewModal(p) }
  function startScanner() { setScanModal(true); setScanResult(null) }
  function openBarcode(p) { 
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
    // Strip nested relation data that Supabase rejects on update
    const { suppliers: _s, supplier_name: _sn, ...cleanForm } = form
    const payload = { ...cleanForm, barcode, stock_qty: parseInt(form.stock_qty) || 0, cost_price: parseFloat(form.cost_price) || 0, sell_price: parseFloat(form.sell_price) || 0, low_stock_threshold: parseInt(form.low_stock_threshold) || 10 }
    const { error } = modal === 'add'
      ? await supabase.from('products').insert(payload)
      : await supabase.from('products').update(payload).eq('id', form.id)
    setSaving(false)
    if (error) { toast.error('Failed to save: ' + error.message); return }
    toast.success(modal === 'add' ? 'Product added!' : 'Updated!')
    setModal(null); load()
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
    const logoUrl = window.location.origin + '/logo.png'
    const w = window.open('', '_blank', 'width=400,height=300')
    const isQR = barcodeType === 'qr'
    let imgSrc = ''
    
    if (isQR && qrCanvasRef.current) {
      imgSrc = qrCanvasRef.current.toDataURL('image/png')
    } else if (barcodeRef.current) {
      const svgData = new XMLSerializer().serializeToString(barcodeRef.current)
      imgSrc = 'data:image/svg+xml;base64,' + btoa(svgData)
    }
    
    w.document.write(`
      <html><head><title>Label — ${barcodeModal.name}</title>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Poppins', Arial, sans-serif; background: #f0f0f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        .label { background: #fff; border-radius: 16px; overflow: hidden; width: 300px; box-shadow: 0 6px 24px rgba(0,0,0,0.12); }

        /* Top row: logo left, brand name right */
        .label-top { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px 8px; border-bottom: 1px solid #f5f5f5; }
        .logo-wrap { display: flex; align-items: center; gap: 9px; }
        .logo-wrap img { height: 48px; width: 48px; object-fit: contain; }
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
        <div class="label">
          <div class="label-top">
            <div class="logo-wrap">
              <img src="${logoUrl}" alt="" onerror="this.style.display='none'" />
              <div>
                <div class="brand-name">Brick's &amp; Joy</div>
                <div class="brand-sub">Toy Store</div>
              </div>
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
        </div>
        <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }</script>
      </body></html>`)
    w.document.close()
  }

  // Print all barcodes
  async function printAllBarcodes() {
    const logoUrl = window.location.origin + '/logo.png'
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
      .label-top-logo { height: 26px; width: 26px; object-fit: contain; }
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
      <img src="${logoUrl}" alt="" style="height:38px;width:38px;object-fit:contain;flex-shrink:0" onerror="this.style.display='none'" />
      <div>
        <div class="brand-title">Brick's &amp; Joy — Product Labels</div>
        <div class="brand-sub">Printed ${new Date().toLocaleDateString()} · ${allLabels.length} labels</div>
      </div>
    </div>
    <div class="grid">
      ${allLabels.map(l => `
        <div class="label">
          <div class="label-top">
            <img class="label-top-logo" src="${logoUrl}" alt="" onerror="this.style.display='none'" />
            <div class="label-top-text">Brick's &amp; Joy</div>
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

  const [showDiscontinued, setShowDiscontinued] = useState(false)
  const [view, setView] = useState(() => localStorage.getItem('bnj_inv_view') || 'grid')
  function changeView(v) { setView(v); localStorage.setItem('bnj_inv_view', v) }

  const filtered = products.filter(p => {
    const ms = p.name.toLowerCase().includes(search.toLowerCase()) || (p.brand || '').toLowerCase().includes(search.toLowerCase()) || (p.sku || '').toLowerCase().includes(search.toLowerCase()) || (p.barcode || '').includes(search)
    const mc = filterCat === 'all' || p.category === filterCat
    const md = showDiscontinued ? p.discontinued : !p.discontinued
    return ms && mc && md
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
      <PageHeader title="Inventory" subtitle={`${products.length} products`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={startScanner} title="Scan barcode">
              <Camera size={15} /> Scan
            </Button>
            <Button variant="ghost" onClick={printAllBarcodes} title="Print all barcodes">
              <Printer size={15} /> Print all
            </Button>
            <Button onClick={openAdd}><Plus size={15} /> Add product</Button>
          </div>
        } />

      <Card>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, barcode, SKU…"
            style={{ padding: '9px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', width: 240, outline: 'none' }} />
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            style={{ padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff', cursor: 'pointer' }}>
            <option value="all">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 0, border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setShowDiscontinued(false)}
              style={{ padding: '7px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s',
                background: !showDiscontinued ? '#1D9E75' : '#fff', color: !showDiscontinued ? '#fff' : '#999' }}>
              Active ({products.filter(p=>!p.discontinued).length})
            </button>
            <button onClick={() => setShowDiscontinued(true)}
              style={{ padding: '7px 14px', border: 'none', borderLeft: '1px solid #ddd', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s',
                background: showDiscontinued ? '#666' : '#fff', color: showDiscontinued ? '#fff' : '#999' }}>
              Discontinued ({products.filter(p=>p.discontinued).length})
            </button>
          </div>
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
        {loading ? <Spinner /> : view === 'list'
          ? <Table columns={columns} data={filtered} emptyMessage={showDiscontinued ? 'No discontinued products.' : 'No products yet.'} />
          : (filtered.length === 0
              ? <div style={{ textAlign: 'center', padding: '60px 20px', color: '#bbb' }}>{showDiscontinued ? 'No discontinued products.' : 'No products yet.'}</div>
              : <ProductGrid products={filtered} onView={openView} onEdit={openEdit} onBarcode={openBarcode} onDelete={del} onToggle={toggleDiscontinued} />
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

      {/* ── VIEW PRODUCT MODAL ── */}
      {viewModal && (
        <Modal title="Product details" onClose={() => setViewModal(null)} width={560}>
          <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
            {viewModal.photo_url
              ? <img src={viewModal.photo_url} alt={viewModal.name} style={{ width: 120, height: 120, borderRadius: 12, objectFit: 'cover', border: '1px solid #eee', flexShrink: 0 }} />
              : <div style={{ width: 120, height: 120, borderRadius: 12, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Package size={40} color="#ccc" /></div>
            }
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px', color: '#0d1b2a' }}>{viewModal.name}</h2>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                <Badge color="purple">{viewModal.category}</Badge>
                <Badge color="blue">{viewModal.age_range}</Badge>
                <StockBadge qty={viewModal.stock_qty} threshold={viewModal.low_stock_threshold} />
              </div>
              {viewModal.brand && <div style={{ fontSize: 13, color: '#888' }}>Brand: <strong>{viewModal.brand}</strong></div>}
              {viewModal.sku && <div style={{ fontSize: 13, color: '#888' }}>SKU: <strong>{viewModal.sku}</strong></div>}
              {viewModal.barcode && <div style={{ fontSize: 13, color: '#888', fontFamily: 'monospace' }}>Barcode: <strong>{viewModal.barcode}</strong></div>}
            </div>
          </div>
          {viewModal.description && <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: '#555' }}>{viewModal.description}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            {[
              { label: 'Cost price', value: `MVR ${Number(viewModal.cost_price).toFixed(2)}` },
              { label: 'Sell price', value: `MVR ${Number(viewModal.sell_price).toFixed(2)}` },
              { label: 'Margin', value: `${viewModal.sell_price > 0 ? Math.round((viewModal.sell_price - viewModal.cost_price) / viewModal.sell_price * 100) : 0}%` },
              { label: 'Stock qty', value: viewModal.stock_qty },
              { label: 'Low stock at', value: viewModal.low_stock_threshold },
              { label: 'Sizes', value: viewModal.sizes || '—' },
            ].map((item, i) => (
              <div key={i} style={{ background: '#f8f7f4', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{item.label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a' }}>{item.value}</div>
              </div>
            ))}
          </div>
          {viewModal.tags && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {viewModal.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                <span key={tag} style={{ background: '#EEEDFE', color: '#6a1b9a', padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 500 }}>{tag}</span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => openBarcode(viewModal)} style={{ color: '#FFA500' }}>▦ Barcode</Button>
            <Button variant="ghost" onClick={() => { openEdit(viewModal); setViewModal(null) }}><Edit2 size={13} /> Edit</Button>
            <Button variant="ghost" onClick={() => setViewModal(null)}>Close</Button>
          </div>
        </Modal>
      )}

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
            options={[{ value: '', label: '— None —' }, ...suppliers.map(s => ({ value: s.id, label: s.name }))]}
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

// ── Apple-style product grid ──────────────────────────────
function ProductGrid({ products, onView, onEdit, onBarcode, onDelete, onToggle }) {
  return (
    <>
      <style>{`
        @keyframes cardIn { from { opacity:0; transform: translateY(14px); } to { opacity:1; transform: translateY(0); } }
        .inv-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(216px, 1fr)); gap: 26px 22px; }
        .prod-card { animation: cardIn 0.35s ease both; }
        .prod-tile {
          position: relative; width: 100%; aspect-ratio: 372 / 443; border-radius: 22px; overflow: hidden;
          background: linear-gradient(160deg, #f6f6f8 0%, #e9e9ed 100%);
          box-shadow: inset 0 1.5px 0 rgba(255,255,255,0.95), inset 0 -3px 8px rgba(0,0,0,0.07),
                      inset 0 0 0 1px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.05);
          transition: transform 0.28s cubic-bezier(.2,.7,.3,1), box-shadow 0.28s;
        }
        .prod-card:hover .prod-tile {
          transform: translateY(-6px) scale(1.012);
          box-shadow: inset 0 1.5px 0 rgba(255,255,255,0.95), inset 0 -3px 8px rgba(0,0,0,0.07),
                      inset 0 0 0 1px rgba(0,0,0,0.04), 0 16px 34px rgba(13,27,42,0.16);
        }
        .prod-tile img { width:100%; height:100%; object-fit: cover; display:block; }
        .prod-actions { position:absolute; top:10px; right:10px; display:flex; gap:6px; opacity:0; transform: translateY(-4px); transition: all 0.2s; }
        .prod-card:hover .prod-actions { opacity:1; transform: translateY(0); }
        .prod-act {
          width:30px; height:30px; border-radius:9px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center;
          background: rgba(255,255,255,0.9); backdrop-filter: blur(6px); box-shadow: 0 2px 6px rgba(0,0,0,0.12); transition: background 0.15s, transform 0.15s;
        }
        .prod-act:hover { transform: scale(1.08); }
        .prod-buy { background: linear-gradient(135deg,#2f8fe6,#1f6fd0); color:#fff; border:none; border-radius:999px; padding:9px 22px; font-size:13.5px; font-weight:700; cursor:pointer; font-family:inherit; box-shadow:0 4px 12px rgba(47,143,230,0.32); transition: transform .15s, box-shadow .15s; }
        .prod-buy:hover { transform: translateY(-1px); box-shadow:0 7px 16px rgba(47,143,230,0.4); }
        .prod-link { background:none; border:none; color:#2f8fe6; font-size:13.5px; font-weight:600; cursor:pointer; font-family:inherit; padding:6px 4px; }
        .prod-link:hover { text-decoration: underline; }
      `}</style>
      <div className="inv-grid">
        {products.map(p => (
          <ProductCard key={p.id} p={p} onView={onView} onEdit={onEdit} onBarcode={onBarcode} onDelete={onDelete} onToggle={onToggle} />
        ))}
      </div>
    </>
  )
}

function ProductCard({ p, onView, onEdit, onBarcode, onDelete, onToggle }) {
  const margin = p.sell_price > 0 ? Math.round((p.sell_price - p.cost_price) / p.sell_price * 100) : 0
  const low = p.stock_qty <= (p.low_stock_threshold || 0)
  const isNew = (p.tags || '').toLowerCase().split(',').map(t => t.trim()).includes('new')
  return (
    <div className="prod-card">
      <div className="prod-tile" onClick={() => onView(p)} style={{ cursor: 'pointer' }}>
        {p.photo_url
          ? <img src={p.photo_url} alt={p.name} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Package size={56} color="#cfcfd6" /></div>}

        {/* stock pill */}
        <div style={{ position: 'absolute', left: 12, bottom: 12, background: low ? 'rgba(226,75,74,0.92)' : 'rgba(13,27,42,0.78)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, backdropFilter: 'blur(4px)' }}>
          {p.stock_qty} in stock
        </div>
        {p.discontinued && (
          <div style={{ position: 'absolute', left: 12, top: 12, background: 'rgba(102,102,102,0.92)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Discontinued</div>
        )}

        {/* hover actions */}
        <div className="prod-actions" onClick={e => e.stopPropagation()}>
          <button className="prod-act" title="Barcode" onClick={() => onBarcode(p)}><Barcode size={15} color="#FFA500" /></button>
          <button className="prod-act" title="Edit" onClick={() => onEdit(p)}><Edit2 size={15} color="#0d1b2a" /></button>
          <button className="prod-act" title="Delete" onClick={() => onDelete(p.id)}><Trash2 size={15} color="#E24B4A" /></button>
        </div>
      </div>

      {/* info */}
      <div style={{ textAlign: 'center', padding: '16px 8px 0' }}>
        {isNew && <div style={{ fontSize: 12, fontWeight: 700, color: '#FFA500', marginBottom: 2 }}>New</div>}
        <div style={{ fontSize: 18, fontWeight: 700, color: '#0d1b2a', letterSpacing: '-0.3px', lineHeight: 1.2 }}>{p.name}</div>
        <div style={{ fontSize: 11.5, color: '#aaa', marginTop: 4, fontWeight: 500 }}>{p.category} · {p.age_range}</div>
        {p.description && (
          <div style={{ fontSize: 13, color: '#666', marginTop: 8, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 38 }}>{p.description}</div>
        )}
        <div style={{ fontSize: 14.5, fontWeight: 700, color: '#0d1b2a', marginTop: 10 }}>
          From MVR {Number(p.sell_price).toFixed(2)}
          <span style={{ fontSize: 12, fontWeight: 600, color: margin >= 40 ? '#1D9E75' : margin >= 20 ? '#f57f17' : '#E24B4A', marginLeft: 8 }}>{margin}% margin</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 14 }}>
          <button className="prod-buy" onClick={() => onView(p)}>View</button>
          <button className="prod-link" onClick={() => onEdit(p)}>Edit ›</button>
        </div>
      </div>
    </div>
  )
}
