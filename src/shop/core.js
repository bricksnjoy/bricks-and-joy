import React, { createContext, useContext, useState } from 'react'
import {
  ShoppingBag, ShoppingCart, Search, User, Menu, X, Star, Package, Plus, Minus
} from 'lucide-react'

// ── Brand / config ────────────────────────────────────────────────────────────
export const BRAND = "Brick's & Joy"
export const BANK = { name: 'BRICKS & JOY', account: '7730000819195' }
export const INSTAGRAM = 'https://instagram.com'   // update to your handle
export const WHATSAPP = ''                          // e.g. '9607xxxxxx' — blank hides the button

// While false, the public sees a "coming soon" page. Preview the real site by
// visiting the homepage with ?preview=on once (remembered on your device).
// The back office → Website tab has the ready-made preview link.
export const SHOP_LIVE = false
const PREVIEW_KEY = 'bnj_shop_preview'
export function previewAllowed() {
  try {
    const p = new URLSearchParams(window.location.search).get('preview')
    if (p === 'on' || p === '1') { localStorage.setItem(PREVIEW_KEY, '1'); return true }
    if (p === 'off') { localStorage.removeItem(PREVIEW_KEY); return false }
    return localStorage.getItem(PREVIEW_KEY) === '1'
  } catch { return false }
}

// Delivery estimate zones (editable) + gift wrapping fee
export const SHIPPING = [
  { label: 'Malé / Hulhumalé', fee: 35 },
  { label: 'Greater Malé (Villingili, etc.)', fee: 50 },
  { label: 'Other islands (ferry / courier)', fee: 90 },
]
export const GIFT_WRAP_FEE = 30

// ── helpers ───────────────────────────────────────────────────────────────────
export const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
export const money = n => `MVR ${num(n) % 1 === 0 ? num(n).toLocaleString('en-US') : num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const genInvoice = () => 'INV-' + Date.now().toString().slice(-6)

export const CART_KEY = 'bnj_shop_cart'
export const readCart = () => { try { const v = JSON.parse(localStorage.getItem(CART_KEY)); return Array.isArray(v) ? v : [] } catch { return [] } }
export const writeCart = c => { try { localStorage.setItem(CART_KEY, JSON.stringify(c)) } catch {} }

// Drop an unknown column and retry — keeps checkout working across schema drift.
export function dropMissingCol(error, payload) {
  const m = (error?.message || '').match(/'([a-z_]+)' column/i) || (error?.message || '').match(/column "?([a-z_]+)"?/i)
  const col = m && m[1]
  if (col && col in payload) { delete payload[col]; return true }
  return false
}

// ── context ───────────────────────────────────────────────────────────────────
export const ShopContext = createContext(null)
export const useShop = () => useContext(ShopContext)

// ── small components ───────────────────────────────────────────────────────────
export function ProductImage({ src, name, style, className }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className={className} style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#fff4e0,#ffe9c7)' }}>
        <Package size={34} color="#e9b048" />
      </div>
    )
  }
  return <img className={className} src={src} alt={name} onError={() => setFailed(true)} style={{ ...style, objectFit: 'cover' }} />
}

export function Stars({ rating = 0, size = 14, showValue = false, count }) {
  const r = Math.round(num(rating))
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={size} color="#f5a623" fill={i <= r ? '#f5a623' : 'none'} />
      ))}
      {showValue && count > 0 && <span style={{ fontSize: 12, color: '#8a8278', marginLeft: 4 }}>{num(rating).toFixed(1)} ({count})</span>}
      {showValue && !count && <span style={{ fontSize: 12, color: '#b8ab97', marginLeft: 4 }}>No reviews yet</span>}
    </span>
  )
}

export function VideoEmbed({ url }) {
  if (!url) return null
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/)
  if (yt) return (
    <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: 14, overflow: 'hidden', background: '#000' }}>
      <iframe title="Demo video" src={`https://www.youtube.com/embed/${yt[1]}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
    </div>
  )
  return <video src={url} controls style={{ width: '100%', borderRadius: 14, background: '#000' }} />
}

export function ProductCard({ p }) {
  const { navigate, addToCart } = useShop()
  const low = Number(p.stock_qty) > 0 && Number(p.stock_qty) <= 3
  return (
    <div className="sh-card" onClick={() => navigate(`/product/${p.id}`)}>
      <div style={{ position: 'relative' }}>
        <ProductImage src={p.photo_url} name={p.name} style={{ width: '100%', aspectRatio: '1/1' }} />
        {p.badge && <span className="sh-tag">{p.badge}</span>}
      </div>
      <div className="bd">
        {p.category && <span className="sh-cat">{p.category}</span>}
        <span className="sh-name">{p.name}</span>
        {Number(p.review_count) > 0 && <Stars rating={p.avg_rating} size={12} />}
        {low && <span className="sh-low">Only {p.stock_qty} left</span>}
        <span className="sh-price">{money(p.sell_price)}</span>
        <button className="sh-add" onClick={e => { e.stopPropagation(); addToCart(p) }}><Plus size={14} /> Add to cart</button>
      </div>
    </div>
  )
}

export function QtyStepper({ qty, onChange, min = 1, max = 99 }) {
  return (
    <div className="sh-qty">
      <button onClick={() => onChange(Math.max(min, qty - 1))}><Minus size={13} /></button>
      <span>{qty}</span>
      <button onClick={() => onChange(Math.min(max, qty + 1))}><Plus size={13} /></button>
    </div>
  )
}

export function Field({ label, children, required }) {
  return (
    <div className="sh-field">
      <label>{label}{required && ' *'}</label>
      {children}
    </div>
  )
}

// ── header / footer ────────────────────────────────────────────────────────────
export function Header() {
  const { navigate, loc, cartCount, user, signIn } = useShop()
  const [term, setTerm] = useState('')
  const [menu, setMenu] = useState(false)
  const [logoOk, setLogoOk] = useState(true)
  const go = to => { setMenu(false); navigate(to) }
  const submit = () => { const t = term.trim(); go(t ? `/products?q=${encodeURIComponent(t)}` : '/products') }
  const links = [['/shop-by-age', 'Shop by Age'], ['/products', 'All Toys']]
  return (
    <header className="sh-head">
      <div className="sh-head-in">
        <button className="sh-burger" onClick={() => setMenu(m => !m)} aria-label="Menu">{menu ? <X size={20} /> : <Menu size={20} />}</button>

        {/* logo → home */}
        <button className="sh-logo-btn" onClick={() => go('/')} title={BRAND}>
          {logoOk
            ? <img className="sh-logo-img" src="/logo-full.png" alt={BRAND} onError={() => setLogoOk(false)} />
            : <span className="sh-logo"><span className="dot"><ShoppingBag size={17} color="#fff" /></span><span>{BRAND}</span></span>}
        </button>

        {/* left cluster: profile / login + search */}
        <button className="sh-icon" title={user ? 'My account' : 'Sign in'} onClick={() => user ? go('/account') : signIn()}>
          {user?.user_metadata?.avatar_url
            ? <img src={user.user_metadata.avatar_url} alt="" style={{ width: 26, height: 26, borderRadius: '50%' }} />
            : <User size={19} />}
        </button>
        <div className="sh-search">
          <Search size={16} color="#b8ab97" />
          <input value={term} onChange={e => setTerm(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Search toys…" />
        </div>

        {/* right cluster: nav + cart */}
        <nav className="sh-nav">
          {links.map(([to, label]) => (
            <button key={to} className={`sh-navlink ${loc.path === to ? 'on' : ''}`} onClick={() => go(to)}>{label}</button>
          ))}
        </nav>
        <button className="sh-icon sh-carticon" title="Cart" onClick={() => go('/cart')}>
          <ShoppingCart size={19} />
          {cartCount > 0 && <span className="sh-badge">{cartCount}</span>}
        </button>
      </div>
      {menu && (
        <div className="sh-mobilenav">
          {links.map(([to, label]) => <button key={to} onClick={() => go(to)}>{label}</button>)}
        </div>
      )}
    </header>
  )
}

export function Footer() {
  const { navigate } = useShop()
  return (
    <footer className="sh-footer">
      <div className="sh-footer-in">
        <div>
          <div className="sh-logo" style={{ color: '#fff', marginBottom: 10 }}>
            <span className="dot"><ShoppingBag size={16} color="#fff" /></span><span>{BRAND}</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 1.6, margin: 0, maxWidth: 300 }}>
            Toys, building sets & gifts that spark joy — delivered across the Maldives.
          </p>
        </div>
        <div>
          <div className="sh-fh">Shop</div>
          <button onClick={() => navigate('/products')}>All toys</button>
          <button onClick={() => navigate('/shop-by-age')}>Shop by age</button>
        </div>
        <div>
          <div className="sh-fh">Help</div>
          <button onClick={() => navigate('/cart')}>Your cart</button>
          {INSTAGRAM && <a href={INSTAGRAM} target="_blank" rel="noreferrer">Instagram</a>}
        </div>
      </div>
      <div className="sh-copy">© {new Date().getFullYear()} {BRAND} · Maldives</div>
    </footer>
  )
}

// ── styles ─────────────────────────────────────────────────────────────────────
export function ShopStyles() {
  return <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap');
    .sh * { box-sizing:border-box; }
    .sh { font-family:'Poppins',sans-serif; background:#faf7f2; min-height:100vh; color:#0d1b2a; display:flex; flex-direction:column; }
    .sh button { font-family:inherit; }
    .sh a { color:inherit; }
    @keyframes shSpin{to{transform:rotate(360deg)}}
    @keyframes shFade{from{opacity:0}to{opacity:1}}
    @keyframes shSlide{from{transform:translateX(100%)}to{transform:translateX(0)}}
    @keyframes shBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}

    /* header */
    .sh-head{ position:sticky; top:0; z-index:50; background:rgba(255,255,255,0.94); backdrop-filter:blur(10px); border-bottom:1px solid #f0ebe3; }
    .sh-head-in{ max-width:1200px; margin:0 auto; padding:12px 18px; display:flex; align-items:center; gap:14px; }
    .sh-burger{ display:none; background:none; border:none; cursor:pointer; color:#0d1b2a; padding:2px; }
    .sh-logo-btn{ background:none; border:none; cursor:pointer; padding:0; flex-shrink:0; display:flex; align-items:center; }
    .sh-logo-img{ height:46px; width:auto; display:block; }
    @media(max-width:560px){ .sh-logo-img{ height:36px; } }
    .sh-logo{ display:flex; align-items:center; gap:9px; font-weight:800; font-size:18px; letter-spacing:-0.4px; cursor:pointer; flex-shrink:0; }
    .sh-logo .dot{ width:30px; height:30px; border-radius:9px; background:linear-gradient(135deg,#FFA500,#ff8c00); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 10px rgba(255,165,0,0.3); }
    .sh-nav{ display:flex; gap:4px; }
    .sh-navlink{ background:none; border:none; cursor:pointer; padding:8px 12px; border-radius:9px; font-size:13.5px; font-weight:600; color:#6b645d; }
    .sh-navlink:hover{ background:#f4f0e9; color:#0d1b2a; }
    .sh-navlink.on{ color:#b8740a; }
    .sh-search{ flex:1; max-width:420px; display:flex; align-items:center; gap:8px; background:#f4f0e9; border:1px solid #efe9df; border-radius:99px; padding:10px 16px; }
    .sh-search input{ border:none; background:none; outline:none; font-family:inherit; font-size:13.5px; width:100%; color:#0d1b2a; }
    .sh-icon{ position:relative; background:none; border:none; cursor:pointer; color:#0d1b2a; padding:7px; border-radius:10px; display:flex; }
    .sh-icon:hover{ background:#f4f0e9; }
    .sh-badge{ position:absolute; top:-3px; right:-3px; background:#FFA500; color:#fff; font-size:10.5px; font-weight:800; min-width:18px; height:18px; border-radius:99px; display:flex; align-items:center; justify-content:center; padding:0 4px; border:2px solid #fff; }
    .sh-mobilenav{ display:none; flex-direction:column; padding:6px 14px 12px; border-top:1px solid #f0ebe3; background:#fff; }
    .sh-mobilenav button{ text-align:left; background:none; border:none; padding:11px 6px; font-size:14.5px; font-weight:600; color:#0d1b2a; cursor:pointer; border-bottom:1px solid #f6f2ec; }
    @media(max-width:820px){ .sh-nav{ display:none; } .sh-burger{ display:flex; } .sh-mobilenav{ display:flex; } }
    @media(max-width:560px){ .sh-logo span:last-child{ display:none; } }

    /* layout */
    .sh-main{ flex:1; }
    .sh-wrap{ max-width:1200px; margin:0 auto; padding:24px 18px 56px; width:100%; }
    .sh-h2{ font-size:22px; font-weight:800; letter-spacing:-0.5px; margin:0 0 16px; }
    .sh-crumb{ background:none; border:none; cursor:pointer; color:#77706a; font-weight:600; font-size:13.5px; display:inline-flex; align-items:center; gap:6px; margin-bottom:14px; padding:0; }

    /* hero */
    .sh-hero{ background:linear-gradient(135deg,#FFA500,#ff7a00); border-radius:28px; padding:72px 52px; color:#fff; position:relative; overflow:hidden; margin-bottom:14px; min-height:340px; display:flex; flex-direction:column; justify-content:center; }
    .sh-hero h1{ margin:0 0 14px; font-size:48px; font-weight:900; letter-spacing:-1.4px; max-width:620px; line-height:1.05; }
    .sh-hero p{ margin:0 0 26px; font-size:17px; opacity:0.96; max-width:540px; line-height:1.55; }
    .sh-hero .blob{ position:absolute; right:-60px; top:-60px; width:300px; height:300px; background:rgba(255,255,255,0.14); border-radius:50%; }
    .sh-hero .blob2{ position:absolute; right:120px; bottom:-100px; width:220px; height:220px; background:rgba(255,255,255,0.10); border-radius:50%; }
    @media(max-width:600px){ .sh-hero{ padding:44px 26px; min-height:270px; border-radius:22px; } .sh-hero h1{ font-size:32px; } .sh-hero p{ font-size:15px; } }
    .sh-btn{ border:none; border-radius:12px; padding:13px 22px; font-weight:700; font-size:14.5px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; transition:transform .12s; }
    .sh-btn:hover{ transform:translateY(-1px); }
    .sh-btn-w{ background:#fff; color:#d97800; }
    .sh-btn-d{ background:#0d1b2a; color:#fff; }
    .sh-btn-o{ background:linear-gradient(135deg,#FFA500,#ff8c00); color:#fff; box-shadow:0 6px 18px rgba(255,165,0,0.32); }
    .sh-btn:disabled{ opacity:0.5; cursor:default; transform:none; }

    .sh-promos{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:18px 0 30px; }
    .sh-promo{ background:#fff; border:1px solid #f0ebe3; border-radius:14px; padding:14px 16px; display:flex; align-items:center; gap:11px; font-size:13px; font-weight:600; color:#4b453f; }
    @media(max-width:640px){ .sh-promos{ grid-template-columns:1fr; } }

    .sh-sec-h{ display:flex; align-items:center; justify-content:space-between; margin:34px 0 16px; }
    .sh-sec-h h2{ font-size:21px; font-weight:800; letter-spacing:-0.5px; margin:0; }
    .sh-see{ background:none; border:none; color:#b8740a; font-weight:700; font-size:13px; cursor:pointer; }

    /* grids & cards */
    .sh-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(215px,1fr)); gap:18px; }
    @media(max-width:560px){ .sh-grid{ grid-template-columns:1fr 1fr; gap:12px; } }
    .sh-card{ background:#fff; border:1px solid #f0ebe3; border-radius:16px; overflow:hidden; cursor:pointer; display:flex; flex-direction:column; transition:transform .15s, box-shadow .15s; }
    .sh-card:hover{ transform:translateY(-3px); box-shadow:0 14px 30px rgba(13,27,42,0.09); }
    .sh-card .bd{ padding:12px 13px 14px; display:flex; flex-direction:column; gap:5px; flex:1; }
    .sh-cat{ font-size:10.5px; font-weight:700; color:#c7a15a; text-transform:uppercase; letter-spacing:0.5px; }
    .sh-name{ font-size:13.5px; font-weight:600; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .sh-price{ font-size:16px; font-weight:800; margin-top:auto; }
    .sh-low{ font-size:11px; color:#E24B4A; font-weight:600; }
    .sh-add{ margin-top:8px; border:none; background:#FFF1D6; color:#b8740a; font-weight:700; font-size:12.5px; padding:9px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; }
    .sh-add:hover{ background:#ffe6b8; }
    .sh-tag{ position:absolute; top:10px; left:10px; background:#0d1b2a; color:#fff; font-size:10.5px; font-weight:800; padding:4px 9px; border-radius:99px; text-transform:uppercase; letter-spacing:0.4px; }

    /* tiles (age / category) */
    .sh-tiles{ display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:14px; }
    .sh-tile{ border:none; cursor:pointer; border-radius:18px; padding:26px 16px; text-align:center; font-weight:800; font-size:15px; color:#0d1b2a; display:flex; flex-direction:column; align-items:center; gap:8px; transition:transform .14s; }
    .sh-tile:hover{ transform:translateY(-3px); }
    .sh-tile .emoji{ font-size:32px; }

    /* filters */
    .sh-toolbar{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:18px; }
    .sh-sel, .sh-inp{ border:1px solid #e6e0d6; border-radius:10px; padding:9px 12px; font-family:inherit; font-size:13px; background:#fff; color:#0d1b2a; outline:none; }
    .sh-sel:focus, .sh-inp:focus{ border-color:#FFA500; }
    .sh-chips{ display:flex; gap:8px; overflow-x:auto; padding-bottom:6px; margin-bottom:14px; scrollbar-width:none; }
    .sh-chips::-webkit-scrollbar{ display:none; }
    .sh-chip{ flex-shrink:0; padding:8px 16px; border-radius:99px; border:1px solid #ece6db; background:#fff; font-size:13px; font-weight:600; color:#77706a; cursor:pointer; }
    .sh-chip.on{ background:#0d1b2a; border-color:#0d1b2a; color:#fff; }

    /* product page */
    .sh-pd{ display:grid; grid-template-columns:1fr 1fr; gap:34px; }
    @media(max-width:820px){ .sh-pd{ grid-template-columns:1fr; gap:22px; } }
    .sh-pd-info h1{ font-size:27px; font-weight:800; letter-spacing:-0.6px; margin:8px 0 8px; }
    .sh-pd-price{ font-size:26px; font-weight:900; margin:6px 0; }
    .sh-panel{ background:#fff; border:1px solid #f0ebe3; border-radius:14px; padding:16px 18px; margin-top:14px; }
    .sh-panel h3{ font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; color:#8a8278; margin:0 0 8px; display:flex; align-items:center; gap:7px; }
    .sh-panel p{ font-size:14px; color:#4b453f; line-height:1.65; margin:0; white-space:pre-wrap; }
    .sh-warn{ background:#fff7ed; border-color:#ffe0b8; }
    .sh-warn p{ color:#a15c00; }

    /* reviews */
    .sh-review{ border-top:1px solid #f0ebe3; padding:14px 0; }
    .sh-review:first-of-type{ border-top:none; }

    /* cart / drawer-free page */
    .sh-line{ display:flex; gap:14px; padding:16px 0; border-bottom:1px solid #f0ebe3; }
    .sh-qty{ display:flex; align-items:center; border:1px solid #e6e0d6; border-radius:9px; overflow:hidden; }
    .sh-qty button{ border:none; background:#faf7f2; width:32px; height:32px; cursor:pointer; display:flex; align-items:center; justify-content:center; color:#0d1b2a; }
    .sh-qty span{ min-width:34px; text-align:center; font-weight:700; font-size:13px; }
    .sh-x{ background:none; border:none; cursor:pointer; color:#bbb; padding:6px; border-radius:8px; display:flex; }
    .sh-x:hover{ background:#f5f5f5; color:#E24B4A; }
    .sh-summary{ background:#fff; border:1px solid #f0ebe3; border-radius:16px; padding:20px 22px; position:sticky; top:84px; }
    .sh-srow{ display:flex; justify-content:space-between; font-size:14px; padding:6px 0; color:#4b453f; }
    .sh-stot{ display:flex; justify-content:space-between; font-size:18px; font-weight:800; border-top:1px solid #f0ebe3; margin-top:10px; padding-top:12px; }
    .sh-cartgrid{ display:grid; grid-template-columns:1fr 340px; gap:26px; align-items:start; }
    @media(max-width:820px){ .sh-cartgrid{ grid-template-columns:1fr; } .sh-summary{ position:static; } }

    /* forms */
    .sh-field{ display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
    .sh-field label{ font-size:11px; font-weight:700; color:#8a8278; text-transform:uppercase; letter-spacing:0.4px; }
    .sh-field input, .sh-field textarea, .sh-field select{ border:1px solid #e6e0d6; border-radius:11px; padding:12px 14px; font-family:inherit; font-size:14px; outline:none; background:#fff; color:#0d1b2a; width:100%; }
    .sh-field input:focus, .sh-field textarea:focus, .sh-field select:focus{ border-color:#FFA500; }
    .sh-card2{ background:#fff; border:1px solid #f0ebe3; border-radius:16px; padding:20px 22px; margin-bottom:18px; }
    .sh-card2 .hd{ font-size:12px; font-weight:800; color:#8a8278; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:14px; }

    .sh-toggle{ display:flex; align-items:center; gap:12px; padding:14px; border:1px solid #eee3d3; border-radius:12px; cursor:pointer; background:#fffdf8; }
    .sh-toggle.on{ border-color:#FFA500; background:#FFF8EC; }
    .sh-check{ width:22px; height:22px; border-radius:6px; border:2px solid #d8cdbb; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
    .sh-toggle.on .sh-check{ background:#FFA500; border-color:#FFA500; }

    .sh-modal{ position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(13,27,42,0.55); backdrop-filter:blur(6px); animation:shFade .2s ease; }
    .sh-sheet{ background:#fff; border-radius:22px; width:100%; max-width:560px; max-height:92vh; overflow-y:auto; box-shadow:0 30px 80px rgba(0,0,0,0.3); }

    /* footer */
    .sh-footer{ background:#0d1b2a; color:#fff; margin-top:auto; }
    .sh-footer-in{ max-width:1200px; margin:0 auto; padding:40px 18px 24px; display:grid; grid-template-columns:2fr 1fr 1fr; gap:24px; }
    @media(max-width:640px){ .sh-footer-in{ grid-template-columns:1fr 1fr; } }
    .sh-fh{ font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.6px; color:rgba(255,255,255,0.55); margin-bottom:12px; }
    .sh-footer button, .sh-footer a{ display:block; background:none; border:none; color:rgba(255,255,255,0.82); font-size:13.5px; padding:5px 0; cursor:pointer; text-decoration:none; text-align:left; }
    .sh-footer button:hover, .sh-footer a:hover{ color:#fff; }
    .sh-copy{ text-align:center; color:rgba(255,255,255,0.5); font-size:12px; padding:16px; border-top:1px solid rgba(255,255,255,0.1); }

    .sh-spin{ width:34px; height:34px; border:3px solid #f0e6d2; border-top-color:#FFA500; border-radius:50%; animation:shSpin .8s linear infinite; margin:60px auto; }
    .sh-empty{ text-align:center; padding:64px 0; color:#9a9186; }
  `}</style>
}
