import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  ShoppingBag, ShoppingCart, Search, X, Plus, Minus, Trash2, ArrowLeft,
  Package, CheckCircle2, Copy, ChevronRight
} from 'lucide-react'

// ── Brand / bank ────────────────────────────────────────────────────────────
const BRAND = "Brick's & Joy"
const BANK = { name: 'BRICKS & JOY', account: '7730000819195' }
const WHATSAPP = '' // e.g. '9607xxxxxx' — leave blank to hide the WhatsApp button

const CART_KEY = 'bnj_shop_cart'
const readCart = () => { try { const v = JSON.parse(localStorage.getItem(CART_KEY)); return Array.isArray(v) ? v : [] } catch { return [] } }
const writeCart = c => { try { localStorage.setItem(CART_KEY, JSON.stringify(c)) } catch {} }

const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const money = n => `MVR ${num(n) % 1 === 0 ? num(n).toLocaleString('en-US') : num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const genInvoice = () => 'INV-' + Date.now().toString().slice(-6)

// Same "drop an unknown column and retry" trick the admin app uses, so a slightly
// different orders schema never blocks a checkout.
function dropMissingCol(error, payload) {
  const m = (error?.message || '').match(/'([a-z_]+)' column/i) || (error?.message || '').match(/column "?([a-z_]+)"?/i)
  const col = m && m[1]
  if (col && col in payload) { delete payload[col]; return true }
  return false
}

// Product image with a soft branded fallback
function ProductImage({ src, name, style }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#fff4e0,#ffe9c7)' }}>
        <Package size={34} color="#e9b048" />
      </div>
    )
  }
  return <img src={src} alt={name} onError={() => setFailed(true)} style={{ ...style, objectFit: 'cover' }} />
}

export default function Shop() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('All')
  const [cart, setCart] = useState(readCart)
  const [detail, setDetail] = useState(null)   // product being viewed
  const [cartOpen, setCartOpen] = useState(false)
  const [view, setView] = useState('catalog')  // catalog | checkout | success
  const [placing, setPlacing] = useState(false)
  const [order, setOrder] = useState(null)      // { invoice, total, items }
  const [copied, setCopied] = useState(false)
  const [ship, setShip] = useState({ name: '', phone: '', island: '', address: '', notes: '' })

  useEffect(() => { document.title = `${BRAND} — Shop`; load() }, [])
  useEffect(() => { writeCart(cart) }, [cart])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('shop_products').select('*').gt('stock_qty', 0).order('created_at', { ascending: false })
    if (error) {
      if (/relation|does not exist|schema cache|permission/i.test(error.message)) setNeedsSetup(true)
      setProducts([])
    } else {
      setNeedsSetup(false)
      setProducts(data || [])
    }
    setLoading(false)
  }

  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort()], [products])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return products.filter(p => {
      const catOk = cat === 'All' || p.category === cat
      const qOk = !needle || `${p.name} ${p.category} ${p.brand || ''} ${p.description || ''}`.toLowerCase().includes(needle)
      return catOk && qOk
    })
  }, [products, q, cat])

  // ── cart ops ────────────────────────────────────────────────────────────────
  const cartCount = cart.reduce((s, i) => s + i.qty, 0)
  const cartTotal = cart.reduce((s, i) => s + num(i.price) * i.qty, 0)
  function addToCart(p, qty = 1) {
    setCart(c => {
      const ex = c.find(i => i.id === p.id)
      const max = Number(p.stock_qty) || 99
      if (ex) return c.map(i => i.id === p.id ? { ...i, qty: Math.min(max, i.qty + qty) } : i)
      return [...c, { id: p.id, name: p.name, price: p.sell_price, photo_url: p.photo_url, stock_qty: p.stock_qty, qty: Math.min(max, qty) }]
    })
    setCartOpen(true)
  }
  function setQty(id, qty) {
    setCart(c => c.map(i => i.id === id ? { ...i, qty: Math.max(1, Math.min(Number(i.stock_qty) || 99, qty)) } : i))
  }
  function removeItem(id) { setCart(c => c.filter(i => i.id !== id)) }

  // ── place order ───────────────────────────────────────────────────────────────
  async function placeOrder() {
    if (!ship.name.trim() || !ship.phone.trim() || !ship.island.trim()) return
    if (!cart.length) return
    setPlacing(true)
    try {
      const invoice = genInvoice()
      const customerId = (crypto?.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random()).replace('.', '')
      const addr = [ship.address, ship.island].filter(Boolean).join(', ')

      // 1. create the customer (insert only — nothing is read back)
      const custPayload = {
        id: customerId, name: ship.name.trim(), phone: ship.phone.trim(),
        address: addr, notes: `Website order ${invoice}${ship.notes ? ' — ' + ship.notes : ''}`,
      }
      let { error: cErr } = await supabase.from('customers').insert(custPayload)
      while (cErr && dropMissingCol(cErr, custPayload)) { cErr = (await supabase.from('customers').insert(custPayload)).error }
      const linkedCustomer = cErr ? null : customerId // if customer insert failed, still place the order without a link

      // 2. one order row per cart item, all sharing the invoice number
      const orderDate = new Date().toISOString().slice(0, 10)
      for (let idx = 0; idx < cart.length; idx++) {
        const it = cart[idx]
        const payload = {
          customer_id: linkedCustomer, customer_name: ship.name.trim(),
          product_id: it.id, product_name: it.name,
          qty: it.qty, unit_price: num(it.price), total_price: +(num(it.price) * it.qty).toFixed(2),
          channel: 'Website', status: 'created', order_date: orderDate,
          invoice_number: invoice, payment_status: 'unpaid', payment_method: 'Bank Transfer',
          notes: idx === 0 ? `Website order · ${ship.island}${ship.notes ? ' · ' + ship.notes : ''}` : '',
        }
        let { error: oErr } = await supabase.from('orders').insert(payload)
        while (oErr && dropMissingCol(oErr, payload)) { oErr = (await supabase.from('orders').insert(payload)).error }
        if (oErr) throw oErr
      }

      setOrder({ invoice, total: cartTotal, items: cart })
      setCart([]); writeCart([])
      setView('success')
      window.scrollTo(0, 0)
    } catch (err) {
      alert('Sorry — we could not place your order. Please try again or message us.\n\n' + (err.message || ''))
    } finally {
      setPlacing(false)
    }
  }

  function copyAccount() {
    navigator.clipboard?.writeText(BANK.account).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }

  // ── styles ──────────────────────────────────────────────────────────────────
  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap');
    .sh * { box-sizing: border-box; }
    .sh { font-family:'Poppins',sans-serif; background:#faf7f2; min-height:100vh; color:#0d1b2a; }
    .sh-head { position:sticky; top:0; z-index:50; background:rgba(255,255,255,0.92); backdrop-filter:blur(10px); border-bottom:1px solid #f0ebe3; }
    .sh-head-in { max-width:1180px; margin:0 auto; padding:12px 18px; display:flex; align-items:center; gap:14px; }
    .sh-logo { display:flex; align-items:center; gap:9px; font-weight:800; font-size:18px; letter-spacing:-0.4px; cursor:pointer; }
    .sh-logo .dot { width:30px; height:30px; border-radius:9px; background:linear-gradient(135deg,#FFA500,#ff8c00); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 10px rgba(255,165,0,0.3); }
    .sh-search { flex:1; max-width:440px; display:flex; align-items:center; gap:8px; background:#f4f0e9; border:1px solid #efe9df; border-radius:99px; padding:9px 14px; }
    .sh-search input { border:none; background:none; outline:none; font-family:inherit; font-size:13.5px; width:100%; color:#0d1b2a; }
    .sh-cartbtn { position:relative; background:#0d1b2a; color:#fff; border:none; border-radius:99px; padding:10px 16px; font-family:inherit; font-weight:600; font-size:13.5px; cursor:pointer; display:flex; align-items:center; gap:8px; flex-shrink:0; transition:transform .12s; }
    .sh-cartbtn:hover { transform:translateY(-1px); }
    .sh-badge { position:absolute; top:-6px; right:-6px; background:#FFA500; color:#fff; font-size:11px; font-weight:800; min-width:20px; height:20px; border-radius:99px; display:flex; align-items:center; justify-content:center; padding:0 5px; border:2px solid #fff; }
    .sh-wrap { max-width:1180px; margin:0 auto; padding:22px 18px 60px; }
    .sh-hero { background:linear-gradient(135deg,#FFA500,#ff7a00); border-radius:22px; padding:34px 30px; color:#fff; margin-bottom:26px; position:relative; overflow:hidden; }
    .sh-hero h1 { margin:0 0 8px; font-size:30px; font-weight:900; letter-spacing:-0.8px; }
    .sh-hero p { margin:0; font-size:14.5px; opacity:0.95; max-width:520px; line-height:1.55; }
    .sh-hero .blob { position:absolute; right:-40px; top:-40px; width:200px; height:200px; background:rgba(255,255,255,0.14); border-radius:50%; }
    .sh-hero .blob2 { position:absolute; right:60px; bottom:-70px; width:150px; height:150px; background:rgba(255,255,255,0.10); border-radius:50%; }
    .sh-chips { display:flex; gap:8px; overflow-x:auto; padding-bottom:6px; margin-bottom:20px; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
    .sh-chips::-webkit-scrollbar { display:none; }
    .sh-chip { flex-shrink:0; padding:8px 16px; border-radius:99px; border:1px solid #ece6db; background:#fff; font-family:inherit; font-size:13px; font-weight:600; color:#77706a; cursor:pointer; transition:all .14s; }
    .sh-chip.on { background:#0d1b2a; border-color:#0d1b2a; color:#fff; }
    .sh-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(215px,1fr)); gap:18px; }
    @media (max-width:560px){ .sh-grid { grid-template-columns:1fr 1fr; gap:12px; } }
    .sh-card { background:#fff; border:1px solid #f0ebe3; border-radius:16px; overflow:hidden; cursor:pointer; display:flex; flex-direction:column; transition:transform .15s, box-shadow .15s; }
    .sh-card:hover { transform:translateY(-3px); box-shadow:0 14px 30px rgba(13,27,42,0.09); }
    .sh-card .ph { width:100%; aspect-ratio:1/1; background:#f6f2ec; }
    .sh-card .bd { padding:12px 13px 14px; display:flex; flex-direction:column; gap:5px; flex:1; }
    .sh-cat { font-size:10.5px; font-weight:700; color:#c7a15a; text-transform:uppercase; letter-spacing:0.5px; }
    .sh-name { font-size:13.5px; font-weight:600; color:#0d1b2a; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .sh-price { font-size:16px; font-weight:800; color:#0d1b2a; margin-top:auto; }
    .sh-add { margin-top:8px; border:none; background:#FFF1D6; color:#b8740a; font-family:inherit; font-weight:700; font-size:12.5px; padding:9px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:background .14s; }
    .sh-add:hover { background:#ffe6b8; }
    .sh-low { font-size:11px; color:#E24B4A; font-weight:600; }
    /* drawer */
    .sh-scrim { position:fixed; inset:0; background:rgba(13,27,42,0.45); backdrop-filter:blur(2px); z-index:80; animation:shFade .2s ease; }
    @keyframes shFade { from{opacity:0} to{opacity:1} }
    .sh-drawer { position:fixed; top:0; right:0; height:100%; width:400px; max-width:92vw; background:#fff; z-index:90; box-shadow:-12px 0 40px rgba(0,0,0,0.16); display:flex; flex-direction:column; animation:shSlide .26s cubic-bezier(0.4,0,0.2,1); }
    @keyframes shSlide { from{transform:translateX(100%)} to{transform:translateX(0)} }
    .sh-drawer-h { padding:18px 20px; border-bottom:1px solid #f0ebe3; display:flex; align-items:center; justify-content:space-between; }
    .sh-line { display:flex; gap:12px; padding:14px 0; border-bottom:1px solid #f5f1ea; }
    .sh-qty { display:flex; align-items:center; gap:0; border:1px solid #e6e0d6; border-radius:9px; overflow:hidden; }
    .sh-qty button { border:none; background:#faf7f2; width:30px; height:30px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:#0d1b2a; }
    .sh-qty span { min-width:32px; text-align:center; font-weight:700; font-size:13px; }
    .sh-x { background:none; border:none; cursor:pointer; color:#bbb; padding:6px; border-radius:8px; display:flex; }
    .sh-x:hover { background:#f5f5f5; color:#E24B4A; }
    .sh-cta { border:none; background:linear-gradient(135deg,#FFA500,#ff8c00); color:#fff; font-family:inherit; font-weight:700; font-size:15px; padding:15px; border-radius:13px; cursor:pointer; width:100%; box-shadow:0 6px 18px rgba(255,165,0,0.32); transition:transform .12s; display:flex; align-items:center; justify-content:center; gap:8px; }
    .sh-cta:hover { transform:translateY(-1px); }
    .sh-cta:disabled { opacity:0.5; cursor:default; transform:none; }
    .sh-field { display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
    .sh-field label { font-size:11px; font-weight:700; color:#8a8278; text-transform:uppercase; letter-spacing:0.4px; }
    .sh-field input, .sh-field textarea { border:1px solid #e6e0d6; border-radius:11px; padding:12px 14px; font-family:inherit; font-size:14px; outline:none; background:#fff; color:#0d1b2a; }
    .sh-field input:focus, .sh-field textarea:focus { border-color:#FFA500; }
    .sh-modal { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(13,27,42,0.55); backdrop-filter:blur(6px); animation:shFade .2s ease; }
    .sh-sheet { background:#fff; border-radius:22px; width:100%; max-width:560px; max-height:92vh; overflow-y:auto; box-shadow:0 30px 80px rgba(0,0,0,0.3); }
    .sh-foot { text-align:center; color:#bbb; font-size:12px; padding:30px 0 6px; }
  `

  // ── setup gate (owner only sees this until the SQL is run) ────────────────────
  if (needsSetup) {
    return (
      <div className="sh"><style>{styles}</style>
        <div className="sh-wrap" style={{ maxWidth: 640 }}>
          <div style={{ background: '#fff', border: '1px solid #f0ebe3', borderRadius: 18, padding: '28px 26px', marginTop: 40 }}>
            <ShoppingBag size={30} color="#FFA500" />
            <h2 style={{ margin: '14px 0 8px', fontSize: 20 }}>Shop setup needed</h2>
            <p style={{ color: '#667', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              The public storefront needs one SQL block run in Supabase (the <b>shop_products</b> view and the two public
              order policies). Run the “PUBLIC STOREFRONT” section from <code>supabase_schema.sql</code>, then refresh.
            </p>
            <button className="sh-cta" style={{ marginTop: 20, maxWidth: 200 }} onClick={load}>I've run it — refresh</button>
          </div>
        </div>
      </div>
    )
  }

  // ── success screen ────────────────────────────────────────────────────────────
  if (view === 'success' && order) {
    return (
      <div className="sh"><style>{styles}</style>
        <div className="sh-wrap" style={{ maxWidth: 620 }}>
          <div style={{ background: '#fff', border: '1px solid #f0ebe3', borderRadius: 22, padding: '34px 28px', textAlign: 'center', marginTop: 24 }}>
            <div style={{ width: 66, height: 66, borderRadius: '50%', background: '#e8f7ee', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <CheckCircle2 size={34} color="#1D9E75" />
            </div>
            <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 900 }}>Order placed! 🎉</h1>
            <p style={{ color: '#667', fontSize: 14, margin: '0 0 4px' }}>Thank you, {order.items.length ? '' : ''}{ship.name || 'friend'}. Your order <b>{order.invoice}</b> is in.</p>
            <p style={{ color: '#999', fontSize: 13, margin: '0 0 22px' }}>We'll confirm your order and delivery shortly. Please complete payment by bank transfer:</p>

            <div style={{ background: '#faf7f2', border: '1px dashed #e6d9bf', borderRadius: 16, padding: '18px 20px', textAlign: 'left', marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: '#8a8278', fontSize: 13 }}>Amount to transfer</span>
                <span style={{ fontWeight: 800, fontSize: 17, color: '#E24B4A' }}>{money(order.total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: '#8a8278', fontSize: 13 }}>Account name</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{BANK.name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#8a8278', fontSize: 13 }}>Account number</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <b style={{ fontSize: 15, letterSpacing: '0.5px' }}>{BANK.account}</b>
                  <button onClick={copyAccount} className="sh-x" title="Copy" style={{ color: copied ? '#1D9E75' : '#FFA500' }}>{copied ? <CheckCircle2 size={16} /> : <Copy size={15} />}</button>
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#a79a80', marginTop: 12, lineHeight: 1.5 }}>Use your order number <b>{order.invoice}</b> as the transfer reference, and send us the slip. Delivery charges (if any) will be confirmed with you.</div>
            </div>

            <button className="sh-cta" onClick={() => { setView('catalog'); setOrder(null) }}>Continue shopping</button>
          </div>
          <div className="sh-foot">{BRAND} · Maldives</div>
        </div>
      </div>
    )
  }

  // ── checkout screen ──────────────────────────────────────────────────────────
  if (view === 'checkout') {
    const canPlace = ship.name.trim() && ship.phone.trim() && ship.island.trim() && cart.length
    return (
      <div className="sh"><style>{styles}</style>
        <div className="sh-wrap" style={{ maxWidth: 620 }}>
          <button onClick={() => setView('catalog')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#77706a', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, marginBottom: 16 }}>
            <ArrowLeft size={16} /> Back to shop
          </button>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 18px' }}>Checkout</h1>

          <div style={{ background: '#fff', border: '1px solid #f0ebe3', borderRadius: 18, padding: '20px 22px', marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8a8278', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14 }}>Your details</div>
            <div className="sh-field"><label>Full name *</label><input value={ship.name} onChange={e => setShip(s => ({ ...s, name: e.target.value }))} placeholder="Your name" /></div>
            <div className="sh-field"><label>Phone / WhatsApp *</label><input value={ship.phone} onChange={e => setShip(s => ({ ...s, phone: e.target.value }))} placeholder="7xxxxxx" inputMode="tel" /></div>
            <div className="sh-field"><label>Island *</label><input value={ship.island} onChange={e => setShip(s => ({ ...s, island: e.target.value }))} placeholder="e.g. Malé, Hulhumalé" /></div>
            <div className="sh-field"><label>Delivery address</label><input value={ship.address} onChange={e => setShip(s => ({ ...s, address: e.target.value }))} placeholder="House / street / landmark" /></div>
            <div className="sh-field" style={{ marginBottom: 0 }}><label>Note (optional)</label><textarea rows={2} value={ship.notes} onChange={e => setShip(s => ({ ...s, notes: e.target.value }))} placeholder="Anything we should know?" /></div>
          </div>

          <div style={{ background: '#fff', border: '1px solid #f0ebe3', borderRadius: 18, padding: '20px 22px', marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8a8278', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14 }}>Order summary</div>
            {cart.map(it => (
              <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '7px 0', color: '#334' }}>
                <span>{it.name} <span style={{ color: '#aaa' }}>×{it.qty}</span></span>
                <span style={{ fontWeight: 600 }}>{money(num(it.price) * it.qty)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #f0ebe3', marginTop: 10, paddingTop: 12, fontSize: 16, fontWeight: 800 }}>
              <span>Total</span><span style={{ color: '#E24B4A' }}>{money(cartTotal)}</span>
            </div>
            <div style={{ fontSize: 12, color: '#a79a80', marginTop: 8 }}>Pay by bank transfer after ordering. Delivery charges confirmed with you.</div>
          </div>

          <button className="sh-cta" disabled={!canPlace || placing} onClick={placeOrder}>
            {placing ? 'Placing…' : <>Place order · {money(cartTotal)}</>}
          </button>
          <div className="sh-foot">{BRAND} · Maldives</div>
        </div>
      </div>
    )
  }

  // ── catalog ──────────────────────────────────────────────────────────────────
  return (
    <div className="sh"><style>{styles}</style>
      <header className="sh-head">
        <div className="sh-head-in">
          <div className="sh-logo" onClick={() => { setCat('All'); setQ('') }}>
            <span className="dot"><ShoppingBag size={17} color="#fff" /></span>
            <span>{BRAND}</span>
          </div>
          <div className="sh-search">
            <Search size={16} color="#b8ab97" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search toys, sets, gifts…" />
            {q && <button className="sh-x" onClick={() => setQ('')} style={{ padding: 2 }}><X size={14} /></button>}
          </div>
          <button className="sh-cartbtn" onClick={() => setCartOpen(true)}>
            <ShoppingCart size={16} /> <span style={{ }}>Cart</span>
            {cartCount > 0 && <span className="sh-badge">{cartCount}</span>}
          </button>
        </div>
      </header>

      <div className="sh-wrap">
        <div className="sh-hero">
          <div className="blob" /><div className="blob2" />
          <h1>Toys that spark joy ✨</h1>
          <p>Building sets, bouquets & gifts — delivered across the Maldives. Browse below, add to your cart, and pay easily by bank transfer.</p>
        </div>

        <div className="sh-chips">
          {categories.map(c => (
            <button key={c} className={`sh-chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '70px 0', color: '#c9bfae' }}>
            <div style={{ width: 34, height: 34, border: '3px solid #f0e6d2', borderTopColor: '#FFA500', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 14px' }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            Loading the shop…
          </div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '70px 0', color: '#bbb' }}>
            <Package size={40} color="#e5dcc9" style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 600, color: '#999' }}>{products.length === 0 ? 'No products available right now — check back soon!' : 'Nothing matches your search.'}</div>
          </div>
        ) : (
          <div className="sh-grid">
            {visible.map(p => {
              const low = Number(p.stock_qty) > 0 && Number(p.stock_qty) <= 3
              return (
                <div key={p.id} className="sh-card" onClick={() => setDetail(p)}>
                  <ProductImage src={p.photo_url} name={p.name} style={{ width: '100%', aspectRatio: '1/1' }} />
                  <div className="bd">
                    {p.category && <span className="sh-cat">{p.category}</span>}
                    <span className="sh-name">{p.name}</span>
                    {low && <span className="sh-low">Only {p.stock_qty} left</span>}
                    <span className="sh-price">{money(p.sell_price)}</span>
                    <button className="sh-add" onClick={e => { e.stopPropagation(); addToCart(p) }}><Plus size={14} /> Add to cart</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="sh-foot">{BRAND} · Maldives · Made with love</div>
      </div>

      {/* product detail */}
      {detail && (
        <div className="sh-modal" onClick={e => e.target === e.currentTarget && setDetail(null)}>
          <div className="sh-sheet">
            <div style={{ position: 'relative' }}>
              <ProductImage src={detail.photo_url} name={detail.name} style={{ width: '100%', aspectRatio: '16/11', borderRadius: '22px 22px 0 0' }} />
              <button className="sh-x" onClick={() => setDetail(null)} style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,255,255,0.9)', borderRadius: '50%', width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
            </div>
            <div style={{ padding: '20px 24px 26px' }}>
              {detail.category && <span className="sh-cat">{detail.category}</span>}
              <h2 style={{ margin: '6px 0 6px', fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px' }}>{detail.name}</h2>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#0d1b2a', marginBottom: 4 }}>{money(detail.sell_price)}</div>
              {Number(detail.stock_qty) <= 3 && <div className="sh-low" style={{ marginBottom: 8 }}>Only {detail.stock_qty} left in stock</div>}
              {detail.brand && <div style={{ fontSize: 13, color: '#889', marginBottom: 6 }}>Brand: {detail.brand}{detail.age_range ? ` · Ages ${detail.age_range}` : ''}</div>}
              {detail.description && <p style={{ fontSize: 14, color: '#556', lineHeight: 1.6, margin: '10px 0 0' }}>{detail.description}</p>}
              <button className="sh-cta" style={{ marginTop: 22 }} onClick={() => { addToCart(detail); setDetail(null) }}>
                <Plus size={17} /> Add to cart · {money(detail.sell_price)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* cart drawer */}
      {cartOpen && (
        <>
          <div className="sh-scrim" onClick={() => setCartOpen(false)} />
          <div className="sh-drawer">
            <div className="sh-drawer-h">
              <span style={{ fontWeight: 800, fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}><ShoppingCart size={18} color="#FFA500" /> Your cart</span>
              <button className="sh-x" onClick={() => setCartOpen(false)}><X size={20} /></button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px' }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '70px 0', color: '#bbb' }}>
                  <ShoppingCart size={38} color="#e5dcc9" style={{ marginBottom: 12 }} />
                  <div style={{ fontWeight: 600, color: '#999' }}>Your cart is empty</div>
                  <button className="sh-add" style={{ marginTop: 16, maxWidth: 160, marginInline: 'auto' }} onClick={() => setCartOpen(false)}>Start shopping</button>
                </div>
              ) : cart.map(it => (
                <div key={it.id} className="sh-line">
                  <ProductImage src={it.photo_url} name={it.name} style={{ width: 64, height: 64, borderRadius: 11, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{it.name}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0d1b2a', margin: '3px 0 8px' }}>{money(it.price)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div className="sh-qty">
                        <button onClick={() => setQty(it.id, it.qty - 1)}><Minus size={13} /></button>
                        <span>{it.qty}</span>
                        <button onClick={() => setQty(it.id, it.qty + 1)}><Plus size={13} /></button>
                      </div>
                      <button className="sh-x" onClick={() => removeItem(it.id)}><Trash2 size={15} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {cart.length > 0 && (
              <div style={{ padding: '16px 20px 20px', borderTop: '1px solid #f0ebe3' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, fontSize: 15 }}>
                  <span style={{ color: '#77706a', fontWeight: 600 }}>Subtotal</span>
                  <span style={{ fontWeight: 800, fontSize: 18 }}>{money(cartTotal)}</span>
                </div>
                <button className="sh-cta" onClick={() => { setCartOpen(false); setView('checkout'); window.scrollTo(0, 0) }}>
                  Checkout <ChevronRight size={17} />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
