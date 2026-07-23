import React, { createContext, useContext, useState } from 'react'
import {
  ShoppingBag, ShoppingCart, Search, User, Menu, X, Star, Package, Plus, Minus, Trash2, Lock, Heart
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

// Delivery estimate zones (defaults) + gift wrapping fee — the back office can
// override all of these; these are only the fallback values.
export const SHIPPING = [
  { label: 'Malé / Hulhumalé', fee: 35 },
  { label: 'Greater Malé (Villingili, etc.)', fee: 50 },
  { label: 'Other islands (ferry / courier)', fee: 90 },
]
export const GIFT_WRAP_FEE = 30

// Everything the back office → Website tab can edit. Stored in the site_settings
// table and merged over these defaults at load time.
export const DEFAULT_SETTINGS = {
  live: SHOP_LIVE,
  hero_title: 'Toys that spark joy ✨',
  hero_subtitle: 'Building sets, bouquets & gifts — delivered across the Maldives. Find the perfect present in a few taps.',
  announcement: '',
  promos: ['Island-wide delivery', 'Gift wrapping available', 'Safe, quality toys'],
  gift_wrap_fee: GIFT_WRAP_FEE,
  shipping: SHIPPING,
  instagram: INSTAGRAM,
  whatsapp: WHATSAPP,
  free_delivery_over: 0,
}
export const mergeSettings = d => ({ ...DEFAULT_SETTINGS, ...(d || {}), shipping: (d?.shipping?.length ? d.shipping : DEFAULT_SETTINGS.shipping), promos: (d?.promos?.length ? d.promos : DEFAULT_SETTINGS.promos) })

// Sale-price helpers
export const onSale = p => p && num(p.sale_price) > 0 && num(p.sale_price) < num(p.sell_price)
export const effPrice = p => onSale(p) ? num(p.sale_price) : num(p.sell_price)

// ── helpers ───────────────────────────────────────────────────────────────────
export const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
export const money = n => `MVR ${num(n) % 1 === 0 ? num(n).toLocaleString('en-US') : num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const genInvoice = () => 'INV-' + Date.now().toString().slice(-6)

export const CART_KEY = 'bnj_shop_cart'
export const readCart = () => { try { const v = JSON.parse(localStorage.getItem(CART_KEY)); return Array.isArray(v) ? v : [] } catch { return [] } }
export const writeCart = c => { try { localStorage.setItem(CART_KEY, JSON.stringify(c)) } catch {} }

export const WISH_KEY = 'bnj_shop_wishlist'
export const readWish = () => { try { const v = JSON.parse(localStorage.getItem(WISH_KEY)); return Array.isArray(v) ? v : [] } catch { return [] } }
export const writeWish = w => { try { localStorage.setItem(WISH_KEY, JSON.stringify(w)) } catch {} }

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
  const { navigate, addToCart, wishlist, toggleWish } = useShop()
  const low = Number(p.stock_qty) > 0 && Number(p.stock_qty) <= 3
  const sale = onSale(p)
  const wished = wishlist?.includes(p.id)
  const tag = p.badge || (sale ? `Save ${Math.round((1 - num(p.sale_price) / num(p.sell_price)) * 100)}%` : null)
  return (
    <div className="sh-card" onClick={() => navigate(`/product/${p.id}`)}>
      <div style={{ position: 'relative' }}>
        <ProductImage src={p.photo_url} name={p.name} style={{ width: '100%', aspectRatio: '1/1' }} />
        {tag && <span className="sh-tag" style={sale && !p.badge ? { background: '#E24B4A' } : undefined}>{tag}</span>}
        <button className="sh-heart" title={wished ? 'Remove from wishlist' : 'Save to wishlist'} onClick={e => { e.stopPropagation(); toggleWish(p.id) }}>
          <Heart size={17} color={wished ? '#E24B4A' : '#9a9186'} fill={wished ? '#E24B4A' : 'none'} />
        </button>
      </div>
      <div className="bd">
        {p.category && <span className="sh-cat">{p.category}</span>}
        <span className="sh-name">{p.name}</span>
        {Number(p.review_count) > 0 && <Stars rating={p.avg_rating} size={12} />}
        {low && <span className="sh-low">Only {p.stock_qty} left</span>}
        <span className="sh-price">{money(effPrice(p))}{sale && <span className="sh-was">{money(p.sell_price)}</span>}</span>
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
  const { navigate, loc, cartCount, user, setCartOpen, wishlist } = useShop()
  const [term, setTerm] = useState('')
  const [menu, setMenu] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [logoOk, setLogoOk] = useState(true)
  const go = to => { setMenu(false); setSearchOpen(false); navigate(to) }
  const submit = () => { const t = term.trim(); go(t ? `/products?q=${encodeURIComponent(t)}` : '/products') }
  const links = [['/shop-by-age', 'Shop by Age'], ['/products', 'All Toys']]
  return (
    <header className="sh-head">
      <div className="sh-head-grid">
        {/* left: nav (desktop) / burger (mobile) */}
        <div className="sh-left">
          <button className="sh-burger" onClick={() => setMenu(m => !m)} aria-label="Menu">{menu ? <X size={20} /> : <Menu size={20} />}</button>
          <nav className="sh-nav">
            {links.map(([to, label]) => (
              <button key={to} className={`sh-navlink ${loc.path === to ? 'on' : ''}`} onClick={() => go(to)}>{label}</button>
            ))}
          </nav>
        </div>

        {/* center: logo → home */}
        <button className="sh-logo-btn" onClick={() => go('/')} title={BRAND}>
          {logoOk
            ? <img className="sh-logo-img" src="/logo-full.png" alt={BRAND} onError={() => setLogoOk(false)} />
            : <span className="sh-logo"><span className="dot"><ShoppingBag size={17} color="#fff" /></span><span>{BRAND}</span></span>}
        </button>

        {/* right: icons */}
        <div className="sh-right">
          <button className="sh-icon" title="Search" onClick={() => setSearchOpen(o => !o)}><Search size={19} /></button>
          <button className="sh-icon" title="Wishlist" onClick={() => go('/wishlist')}>
            <Heart size={19} />
            {wishlist?.length > 0 && <span className="sh-badge">{wishlist.length}</span>}
          </button>
          <button className="sh-icon" title={user ? 'My account' : 'Sign in / account'} onClick={() => go('/account')}>
            {user?.user_metadata?.avatar_url
              ? <img src={user.user_metadata.avatar_url} alt="" style={{ width: 24, height: 24, borderRadius: '50%' }} />
              : <User size={19} />}
          </button>
          <button className="sh-icon sh-carticon" title="Cart" onClick={() => { setMenu(false); setSearchOpen(false); setCartOpen(true) }}>
            <ShoppingCart size={19} />
            {cartCount > 0 && <span className="sh-badge">{cartCount}</span>}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="sh-searchrow">
          <div className="sh-search">
            <Search size={16} color="#b8ab97" />
            <input autoFocus value={term} onChange={e => setTerm(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Search toys, sets, gifts…" />
            <button className="sh-x" onClick={() => setSearchOpen(false)} style={{ padding: 2 }}><X size={16} /></button>
          </div>
        </div>
      )}
      {menu && (
        <div className="sh-mobilenav">
          {links.map(([to, label]) => <button key={to} onClick={() => go(to)}>{label}</button>)}
        </div>
      )}
    </header>
  )
}

export function Footer() {
  const { navigate, settings } = useShop()
  const instagram = settings?.instagram || INSTAGRAM
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
          {instagram && <a href={instagram} target="_blank" rel="noreferrer">Instagram</a>}
        </div>
      </div>
      <div className="sh-copy">© {new Date().getFullYear()} {BRAND} · Maldives</div>
    </footer>
  )
}

// ── slide-out cart / bag ────────────────────────────────────────────────────────
export function CartDrawer() {
  const { cartOpen, setCartOpen, cart, setQty, removeItem, cartSubtotal, giftWrap, setGiftWrap, shipIdx, settings, navigate, products } = useShop()
  if (!cartOpen) return null
  const freeOver = num(settings.free_delivery_over)
  const gwFee = num(settings.gift_wrap_fee)
  const zones = settings.shipping || []
  const ship = zones[shipIdx] || zones[0] || { fee: 0 }
  const freeShip = freeOver > 0 && cartSubtotal >= freeOver
  const shipFee = freeShip ? 0 : (ship.fee || 0)
  const wrap = giftWrap ? gwFee : 0
  const total = cartSubtotal + wrap + shipFee
  const points = Math.round(cartSubtotal)
  const remaining = Math.max(0, freeOver - cartSubtotal)
  const pct = freeOver > 0 ? Math.min(100, (cartSubtotal / freeOver) * 100) : 0
  const upsell = products.filter(p => !cart.find(c => c.id === p.id))
    .slice().sort((a, b) => num(a.sell_price) - num(b.sell_price)).slice(0, 4)
  const close = () => setCartOpen(false)
  const go = to => { close(); navigate(to) }
  return (
    <>
      <div className="sh-scrim" onClick={close} />
      <div className="sh-drawer">
        <div className="sh-drawer-h">
          <span style={{ fontWeight: 800, fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Your bag</span>
          <button className="sh-x" onClick={close}><X size={20} /></button>
        </div>

        {cart.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#9a9186', padding: 24 }}>
            <ShoppingCart size={40} color="#e5dcc9" />
            <div style={{ fontWeight: 700 }}>Your bag is empty</div>
            <button className="sh-btn sh-btn-o" onClick={() => go('/products')}>Start shopping</button>
          </div>
        ) : (
          <>
            <div className="sh-drawer-body">
              {freeOver > 0 && (
                <div className="sh-freebar-wrap">
                  <div className="sh-freemsg">{freeShip ? "You've unlocked FREE delivery! 🎉" : <>You're <b>{money(remaining)}</b> away from free delivery</>}</div>
                  <div className="sh-freebar"><span style={{ width: `${pct}%` }} /></div>
                </div>
              )}

              {cart.map(it => (
                <div key={it.id} className="sh-bagline">
                  <ProductImage src={it.photo_url} name={it.name} style={{ width: 70, height: 70, borderRadius: 10, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} onClick={() => go(`/product/${it.id}`)}>{it.name}</span>
                      <button className="sh-x" style={{ padding: 2 }} onClick={() => removeItem(it.id)}><Trash2 size={15} /></button>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 800, margin: '4px 0 8px' }}>{money(it.price)}</div>
                    <QtyStepper qty={it.qty} onChange={v => setQty(it.id, v)} max={Number(it.stock_qty) || 99} />
                  </div>
                </div>
              ))}

              <div className={`sh-toggle ${giftWrap ? 'on' : ''}`} style={{ marginTop: 14 }} onClick={() => setGiftWrap(g => !g)}>
                <span className="sh-check">{giftWrap && <Star size={13} color="#fff" fill="#fff" />}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Add gift wrapping</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{money(gwFee)}</span>
              </div>

              {upsell.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#8a8278' }}>Add a little extra</div>
                  <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, marginTop: 10 }}>
                    {upsell.map(p => (
                      <div key={p.id} className="sh-upsell">
                        <ProductImage src={p.photo_url} name={p.name} style={{ width: '100%', aspectRatio: '1/1', borderRadius: 8 }} />
                        <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.3, marginTop: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>
                        <div style={{ fontSize: 12.5, fontWeight: 800, margin: '3px 0 6px' }}>{money(effPrice(p))}</div>
                        <button className="sh-add" style={{ marginTop: 0, padding: '6px' }} onClick={() => go(`/product/${p.id}`)}>View</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="sh-drawer-foot">
              <div className="sh-srow"><span>Subtotal</span><span>{money(cartSubtotal)}</span></div>
              {giftWrap && <div className="sh-srow"><span>Gift wrapping</span><span>{money(gwFee)}</span></div>}
              <div className="sh-srow"><span>Estimated delivery</span><span>{freeShip ? <b style={{ color: '#1D9E75' }}>FREE</b> : money(shipFee)}</span></div>
              <div className="sh-srow" style={{ fontWeight: 800, fontSize: 16, color: '#0d1b2a' }}><span>Total</span><span>{money(total)}</span></div>
              <div className="sh-srow" style={{ color: '#b8740a', fontWeight: 700 }}><span>Loyalty points</span><span>+{points.toLocaleString()}</span></div>
              <button className="sh-authbtn" style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={() => go('/checkout')}>
                <Lock size={15} /> Checkout securely
              </button>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                {['VISA', 'Mastercard', 'Bank transfer'].map(t => (
                  <span key={t} style={{ fontSize: 10.5, fontWeight: 700, color: '#8a8278', border: '1px solid #eee3d3', borderRadius: 5, padding: '3px 7px' }}>{t}</span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
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
    .sh-head-grid{ max-width:min(2200px, 94%); margin:0 auto; padding:14px 22px; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:14px; }
    .sh-left{ display:flex; align-items:center; gap:6px; justify-self:start; }
    .sh-right{ display:flex; align-items:center; gap:2px; justify-self:end; }
    .sh-burger{ display:none; background:none; border:none; cursor:pointer; color:#0d1b2a; padding:2px; }
    .sh-logo-btn{ background:none; border:none; cursor:pointer; padding:0; justify-self:center; display:flex; align-items:center; }
    .sh-logo-img{ height:48px; width:auto; display:block; }
    .sh-searchrow{ border-top:1px solid #f0ebe3; background:#fff; padding:12px 22px; display:flex; justify-content:center; animation:shFade .15s ease; }
    .sh-searchrow .sh-search{ width:100%; max-width:640px; flex:none; }
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
    .sh-wrap{ max-width:min(2200px, 94%); margin:0 auto; padding:24px 18px 56px; width:100%; }
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
    .sh-was{ font-size:12.5px; font-weight:600; color:#b0a595; text-decoration:line-through; margin-left:7px; }
    .sh-announce{ background:#0d1b2a; color:#fff; text-align:center; font-size:13px; font-weight:600; padding:8px 14px; }
    .sh-low{ font-size:11px; color:#E24B4A; font-weight:600; }
    .sh-add{ margin-top:8px; border:none; background:#FFF1D6; color:#b8740a; font-weight:700; font-size:12.5px; padding:9px; border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; }
    .sh-add:hover{ background:#ffe6b8; }
    .sh-tag{ position:absolute; top:10px; left:10px; background:#0d1b2a; color:#fff; font-size:10.5px; font-weight:800; padding:4px 9px; border-radius:99px; text-transform:uppercase; letter-spacing:0.4px; }
    .sh-heart{ position:absolute; top:8px; right:8px; width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.9); border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(0,0,0,0.08); }
    .sh-heart:hover{ background:#fff; }

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
    .sh-footer-in{ max-width:min(2200px, 94%); margin:0 auto; padding:40px 18px 24px; display:grid; grid-template-columns:2fr 1fr 1fr; gap:24px; }
    @media(max-width:640px){ .sh-footer-in{ grid-template-columns:1fr 1fr; } }
    .sh-fh{ font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:0.6px; color:rgba(255,255,255,0.55); margin-bottom:12px; }
    .sh-footer button, .sh-footer a{ display:block; background:none; border:none; color:rgba(255,255,255,0.82); font-size:13.5px; padding:5px 0; cursor:pointer; text-decoration:none; text-align:left; }
    .sh-footer button:hover, .sh-footer a:hover{ color:#fff; }
    .sh-copy{ text-align:center; color:rgba(255,255,255,0.5); font-size:12px; padding:16px; border-top:1px solid rgba(255,255,255,0.1); }

    /* slide-out bag */
    .sh-scrim{ position:fixed; inset:0; background:rgba(13,27,42,0.45); backdrop-filter:blur(2px); z-index:80; animation:shFade .2s ease; }
    .sh-drawer{ position:fixed; top:0; right:0; height:100%; width:420px; max-width:94vw; background:#fff; z-index:90; box-shadow:-12px 0 40px rgba(0,0,0,0.16); display:flex; flex-direction:column; animation:shSlide .26s cubic-bezier(0.4,0,0.2,1); }
    .sh-drawer-h{ padding:18px 22px; border-bottom:1px solid #f0ebe3; display:flex; align-items:center; justify-content:space-between; }
    .sh-drawer-body{ flex:1; overflow-y:auto; padding:16px 22px; }
    .sh-drawer-foot{ border-top:1px solid #f0ebe3; padding:16px 22px 20px; background:#fff; }
    .sh-freebar-wrap{ margin-bottom:16px; }
    .sh-freemsg{ font-size:12.5px; color:#4b453f; margin-bottom:7px; }
    .sh-freebar{ height:7px; background:#f0ebe3; border-radius:99px; overflow:hidden; }
    .sh-freebar span{ display:block; height:100%; background:linear-gradient(90deg,#FFA500,#ff7a00); border-radius:99px; transition:width .3s ease; }
    .sh-bagline{ display:flex; gap:12px; padding:14px 0; border-bottom:1px solid #f5f1ea; }
    .sh-upsell{ flex:0 0 118px; width:118px; }

    /* account — full-page dashboard */
    .acctp{ width:100%; }
    .acctp-hero{ background:#f1ece4; padding:80px 0; }
    .acctp-hero-in{ max-width:min(2200px, 96%); margin:0 auto; padding:0 40px; display:grid; grid-template-columns:1fr 1.3fr 1fr; gap:40px; align-items:center; }
    @media(max-width:880px){ .acctp-hero{ padding:44px 0; } .acctp-hero-in{ grid-template-columns:1fr; gap:26px; text-align:center; padding:0 22px; } }
    .acctp-name{ font-size:34px; font-weight:900; letter-spacing:-0.7px; text-transform:uppercase; color:#0d1b2a; line-height:1.05; }
    .acctp-menu{ margin-top:22px; display:flex; flex-direction:column; gap:3px; max-width:320px; }
    @media(max-width:880px){ .acctp-menu{ margin-inline:auto; } }
    .acctp-menu button{ text-align:left; background:#e6ddcf; border:none; padding:15px 18px; font-weight:700; font-size:12px; letter-spacing:0.8px; text-transform:uppercase; cursor:pointer; color:#4b453f; font-family:inherit; }
    .acctp-menu button:hover{ background:#ddd2bf; }
    .acctp-pts{ text-align:center; }
    .acctp-pts .n{ font-size:70px; font-weight:900; color:#0d1b2a; letter-spacing:-3px; line-height:1; }
    .acctp-pts .n span{ font-size:18px; font-weight:800; color:#b8740a; vertical-align:super; margin-left:4px; }
    .acctp-bar{ height:5px; background:#fff; border-radius:99px; overflow:hidden; margin:22px 0 8px; }
    .acctp-bar span{ display:block; height:100%; background:linear-gradient(90deg,#FFA500,#ff7a00); border-radius:99px; }
    .acctp-barlbl{ display:flex; justify-content:space-between; font-size:11.5px; font-weight:700; letter-spacing:0.4px; color:#8a7a58; }
    .acctp-benefits .bh{ font-size:11px; letter-spacing:1.2px; color:#a2916f; margin-bottom:14px; font-weight:700; }
    @media(min-width:881px){ .acctp-benefits{ text-align:right; } .acctp-benefit{ justify-content:flex-end; } }
    .acctp-benefit{ background:#e6ddcf; padding:15px 18px; font-size:13px; color:#4b453f; display:flex; align-items:center; gap:8px; margin-bottom:9px; border-radius:4px; }
    .acctp-lower{ max-width:min(2200px, 96%); margin:0 auto; padding:36px 40px 70px; display:grid; grid-template-columns:1.4fr 1fr; gap:26px; align-items:start; }
    @media(max-width:880px){ .acctp-lower{ grid-template-columns:1fr; padding:30px 22px 60px; } }
    .acctp-panel{ background:#fff; border:1px solid #f0ebe3; border-radius:14px; padding:26px 28px; }
    .acctp-panel-h{ font-size:14px; font-weight:800; letter-spacing:0.5px; color:#0d1b2a; margin-bottom:6px; }
    .acctp-row{ width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:24px 28px; border:none; background:#fff; cursor:pointer; text-align:left; font-family:inherit; }
    .acctp-row:hover{ background:#faf9f6; }
    .acctp-row .t{ font-size:13.5px; font-weight:800; letter-spacing:0.5px; color:#0d1b2a; }
    .acctp-row .s{ font-size:12.5px; color:#8a8278; margin-top:2px; }

    /* account dashboard (legacy) */
    .acct-hero{ background:linear-gradient(135deg,#fff6e8,#ffeccb); border-radius:22px; padding:26px 30px; display:grid; grid-template-columns:1.1fr 1.3fr 1fr; gap:26px; align-items:center; margin-bottom:22px; }
    @media(max-width:860px){ .acct-hero{ grid-template-columns:1fr; gap:20px; text-align:center; } }
    .acct-id{ display:flex; align-items:center; gap:14px; }
    @media(max-width:860px){ .acct-id{ justify-content:center; } }
    .acct-id img{ width:56px; height:56px; border-radius:50%; }
    .acct-name{ font-size:24px; font-weight:900; letter-spacing:-0.6px; text-transform:uppercase; line-height:1.1; }
    .acct-email{ font-size:13px; color:#a2916f; }
    .acct-points .pts{ font-size:40px; font-weight:900; color:#0d1b2a; letter-spacing:-1.5px; }
    .acct-points .pts span{ font-size:15px; font-weight:700; color:#b8740a; }
    .acct-bar{ height:8px; background:#fff; border-radius:99px; overflow:hidden; margin:8px 0 6px; }
    .acct-bar span{ display:block; height:100%; background:linear-gradient(90deg,#FFA500,#ff7a00); border-radius:99px; }
    .acct-bar-lbl{ display:flex; justify-content:space-between; font-size:12px; font-weight:600; color:#8a7a58; }
    .acct-perks-h{ font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.7px; color:#b8740a; margin-bottom:9px; }
    .acct-perk{ display:flex; align-items:center; gap:8px; font-size:13px; color:#5c5344; padding:3px 0; }
    @media(max-width:860px){ .acct-perk{ justify-content:center; } }
    .acct-grid{ display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start; }
    @media(max-width:820px){ .acct-grid{ grid-template-columns:1fr; } }

    /* auth (sign up / log in) */
    .sh-authpage{ background:#fff; }
    .sh-auth{ max-width:420px; margin:44px auto; padding:0 22px 60px; text-align:center; }
    .sh-auth > img{ height:52px; width:auto; margin:0 auto 18px; display:block; }
    .sh-auth h1{ font-size:23px; font-weight:900; letter-spacing:-0.4px; margin:0 0 8px; }
    .sh-auth .sub{ color:#77706a; font-size:14px; line-height:1.5; margin:0 0 22px; }
    .sh-auth .sh-field{ text-align:left; }
    .sh-authbtn{ width:100%; border:none; background:#111; color:#fff; font-weight:800; font-size:14px; letter-spacing:0.5px; text-transform:uppercase; padding:16px; border-radius:99px; cursor:pointer; transition:opacity .15s; }
    .sh-authbtn:hover{ opacity:0.88; }
    .sh-authbtn:disabled{ opacity:0.5; cursor:default; }
    .sh-google{ width:100%; border:1px solid #ddd; background:#fff; color:#111; font-weight:700; font-size:14px; padding:13px; border-radius:99px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:10px; }
    .sh-google:hover{ background:#faf9f6; }
    .sh-or{ display:flex; align-items:center; gap:12px; color:#b0a595; font-size:12px; margin:18px 0; }
    .sh-or::before,.sh-or::after{ content:''; flex:1; height:1px; background:#ece6db; }
    .sh-toggle-link{ background:none; border:none; color:#111; font-weight:800; cursor:pointer; text-decoration:underline; font-family:inherit; font-size:13.5px; padding:0; }
    .sh-err{ color:#E24B4A; font-size:13px; margin:0 0 12px; font-weight:600; }
    .sh-info{ color:#1D9E75; font-size:13px; margin:0 0 12px; font-weight:600; }
    .sh-spin{ width:34px; height:34px; border:3px solid #f0e6d2; border-top-color:#FFA500; border-radius:50%; animation:shSpin .8s linear infinite; margin:60px auto; }
    .sh-empty{ text-align:center; padding:64px 0; color:#9a9186; }
  `}</style>
}
