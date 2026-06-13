import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Badge, StockBadge, Spinner, FormRow, useToast, Toasts } from '../components/UI'
import { Plus, Trash2, Edit2, Upload, X, Package, Eye, Barcode, Download, Printer, Camera } from 'lucide-react'
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
      <html><head><title>Barcode — ${barcodeModal.name}</title>
      <style>
        body { font-family: 'Poppins', Arial, sans-serif; margin: 0; padding: 20px; text-align: center; }
        .label { border: 1px solid #eee; border-radius: 8px; padding: 16px; display: inline-block; min-width: 220px; }
        img { max-width: 220px; display: block; margin: 0 auto; }
        h3 { font-size: 14px; margin: 8px 0 4px; font-weight: 700; }
        p { font-size: 12px; color: #666; margin: 2px 0; }
        @media print { body { padding: 0; } .label { border: none; } }
      </style></head>
      <body>
        <div class="label">
          <img src="${imgSrc}" alt="barcode" />
          <h3>${barcodeModal.name}</h3>
          ${barcodeModal.brand ? `<p>${barcodeModal.brand}</p>` : ''}
          <p>MVR ${Number(barcodeModal.sell_price).toFixed(2)}</p>
          ${barcodeModal.sizes ? `<p>Sizes: ${barcodeModal.sizes}</p>` : ''}
          <p style="font-size:10px;color:#aaa;font-family:monospace">${barcodeModal.barcode}</p>
        </div>
        <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }</script>
      </body></html>`)
    w.document.close()
  }

  // Print all barcodes
  async function printAllBarcodes() {
    const w = window.open('', '_blank')
    const labels = await Promise.all(products.filter(p => p.barcode).map(async p => {
      const canvas = document.createElement('canvas')
      try {
        const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        document.body.appendChild(tempSvg)
        JsBarcode(tempSvg, p.barcode, { format: 'CODE128', width: 1.5, height: 50, displayValue: true, fontSize: 10, margin: 5 })
        const svgData = new XMLSerializer().serializeToString(tempSvg)
        document.body.removeChild(tempSvg)
        return { name: p.name, brand: p.brand, price: p.sell_price, barcode: p.barcode, svg: svgData }
      } catch { return null }
    }))
    
    w.document.write(`<html><head><title>All Barcodes — Brick's & Joy</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 10px; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
      .label { border: 1px solid #ddd; border-radius: 6px; padding: 10px; text-align: center; break-inside: avoid; }
      img { max-width: 100%; height: 50px; }
      h4 { font-size: 11px; margin: 4px 0 2px; font-weight: 700; }
      p { font-size: 10px; color: #666; margin: 1px 0; }
      @media print { .grid { grid-template-columns: repeat(3, 1fr); } }
    </style></head><body>
    <div class="grid">
      ${labels.filter(Boolean).map(l => `
        <div class="label">
          <img src="data:image/svg+xml;base64,${btoa(l.svg)}" alt="barcode" />
          <h4>${l.name}</h4>
          <p>MVR ${Number(l.price).toFixed(2)}</p>
          <p style="font-size:9px;font-family:monospace">${l.barcode}</p>
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
        <Button variant="ghost" size="sm" onClick={() => openBarcode(r)} title="Barcode" style={{ color: '#FFA500' }}>▦</Button>
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
              🖨️ Print all barcodes
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
              style={{ padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                background: !showDiscontinued ? '#1D9E75' : '#fff', color: !showDiscontinued ? '#fff' : '#888' }}>
              ✅ Active ({products.filter(p=>!p.discontinued).length})
            </button>
            <button onClick={() => setShowDiscontinued(true)}
              style={{ padding: '8px 16px', border: 'none', borderLeft: '1px solid #ddd', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                background: showDiscontinued ? '#888' : '#fff', color: showDiscontinued ? '#fff' : '#888' }}>
              ⛔ Discontinued ({products.filter(p=>p.discontinued).length})
            </button>
          </div>
        </div>
        {loading ? <Spinner /> : <Table columns={columns} data={filtered} emptyMessage={showDiscontinued ? 'No discontinued products.' : 'No products yet.'} />}
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
            <button onClick={downloadBarcode} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: '#FFA500', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
              ⬇️ Download PNG
            </button>
            <button onClick={printBarcode} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px', background: '#0d1b2a', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
              🖨️ Print label
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
