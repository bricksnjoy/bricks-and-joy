import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  BANK, money, num, genInvoice, dropMissingCol, onSale, effPrice,
  useShop, ProductImage, ProductCard, Stars, VideoEmbed, QtyStepper, Field
} from './core'
import {
  ArrowLeft, CheckCircle2, Copy, Gift, Truck, ShieldCheck, BatteryCharging, Boxes,
  Tag, Sparkles, ShoppingCart, Trash2, LogOut, Star, Package, ChevronRight, Eye, EyeOff
} from 'lucide-react'

// Google "G" mark (inline so it works under the strict CSP)
function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

const ageEmoji = a => {
  const s = String(a || '')
  if (/all|any/i.test(s)) return '🎁'
  if (/baby|infant/i.test(s)) return '🍼'
  const n = parseInt((s.match(/\d+/) || [])[0])   // first number in the label
  if (isNaN(n)) return '🎁'
  if (n <= 2) return '🍼'
  if (n <= 5) return '🧸'
  if (n <= 8) return '🚀'
  if (n <= 12) return '🎮'
  return '🎯'
}
const TILE_COLORS = ['#FFE7C2', '#D9F2E4', '#DCE9FF', '#F3E2FF', '#FFE0E0', '#E9F5C9', '#FDE8CF']

function Loading() { return <div className="sh-wrap"><div className="sh-spin" /></div> }

// ── Home ───────────────────────────────────────────────────────────────────────
const PROMO_ICONS = [Truck, Gift, ShieldCheck, Sparkles]
export function Home() {
  const { products, loading, navigate, settings } = useShop()
  const ages = useMemo(() => Array.from(new Set(products.map(p => p.age_range).filter(Boolean))).slice(0, 6), [products])
  const cats = useMemo(() => Array.from(new Set(products.map(p => p.category).filter(Boolean))).slice(0, 8), [products])
  const featured = useMemo(() => products.filter(p => p.featured).slice(0, 8), [products])
  const newest = useMemo(() => products.slice(0, 10), [products])
  const promos = (settings.promos || []).filter(Boolean).slice(0, 3)
  if (loading) return <Loading />
  return (
    <div className="sh-wrap">
      <div className="sh-hero">
        <div className="blob" /><div className="blob2" />
        <h1>{settings.hero_title}</h1>
        <p>{settings.hero_subtitle}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="sh-btn sh-btn-w" onClick={() => navigate('/products')}>Shop all toys</button>
          <button className="sh-btn sh-btn-d" onClick={() => navigate('/shop-by-age')}>Shop by age</button>
        </div>
      </div>

      {promos.length > 0 && (
        <div className="sh-promos">
          {promos.map((text, i) => { const Ic = PROMO_ICONS[i] || Sparkles; return <div key={i} className="sh-promo"><Ic size={18} color="#FFA500" /> {text}</div> })}
        </div>
      )}

      {ages.length > 0 && (<>
        <div className="sh-sec-h"><h2>Shop by age</h2><button className="sh-see" onClick={() => navigate('/shop-by-age')}>See all</button></div>
        <div className="sh-tiles">
          {ages.map((a, i) => (
            <button key={a} className="sh-tile" style={{ background: TILE_COLORS[i % TILE_COLORS.length] }} onClick={() => navigate(`/products?age=${encodeURIComponent(a)}`)}>
              <span className="emoji">{ageEmoji(a)}</span>Ages {a}
            </button>
          ))}
        </div>
      </>)}

      {featured.length > 0 && (<>
        <div className="sh-sec-h"><h2>✨ Featured & seasonal</h2><button className="sh-see" onClick={() => navigate('/products')}>Shop all</button></div>
        <div className="sh-grid">{featured.map(p => <ProductCard key={p.id} p={p} />)}</div>
      </>)}

      {cats.length > 0 && (<>
        <div className="sh-sec-h"><h2>Browse categories</h2></div>
        <div className="sh-tiles">
          {cats.map((c, i) => (
            <button key={c} className="sh-tile" style={{ background: TILE_COLORS[(i + 3) % TILE_COLORS.length], fontSize: 14 }} onClick={() => navigate(`/products?cat=${encodeURIComponent(c)}`)}>
              <span className="emoji">🧩</span>{c}
            </button>
          ))}
        </div>
      </>)}

      <div className="sh-sec-h"><h2>New arrivals</h2><button className="sh-see" onClick={() => navigate('/products')}>See all</button></div>
      {newest.length ? <div className="sh-grid">{newest.map(p => <ProductCard key={p.id} p={p} />)}</div>
        : <div className="sh-empty"><Package size={40} color="#e5dcc9" /><div style={{ marginTop: 10, fontWeight: 600 }}>No products yet — check back soon!</div></div>}
    </div>
  )
}

// ── Shop by Age ─────────────────────────────────────────────────────────────────
export function ByAge() {
  const { products, loading, navigate } = useShop()
  const ages = useMemo(() => {
    const map = {}
    products.forEach(p => { if (p.age_range) map[p.age_range] = (map[p.age_range] || 0) + 1 })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [products])
  if (loading) return <Loading />
  return (
    <div className="sh-wrap">
      <h1 className="sh-h2" style={{ fontSize: 26 }}>Shop by age 🎈</h1>
      <p style={{ color: '#77706a', margin: '0 0 22px', maxWidth: 560, lineHeight: 1.6 }}>Not sure what to get? Pick the child's age and we'll show toys that are just right.</p>
      {ages.length === 0 ? <div className="sh-empty">No products yet.</div> : (
        <div className="sh-tiles" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))' }}>
          {ages.map(([a, n], i) => (
            <button key={a} className="sh-tile" style={{ background: TILE_COLORS[i % TILE_COLORS.length], padding: '32px 16px' }} onClick={() => navigate(`/products?age=${encodeURIComponent(a)}`)}>
              <span className="emoji" style={{ fontSize: 38 }}>{ageEmoji(a)}</span>
              <span style={{ fontSize: 17 }}>Ages {a}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#8a7f6e' }}>{n} toy{n === 1 ? '' : 's'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Product listing with filters ────────────────────────────────────────────────
export function Listing() {
  const { products, loading, loc, navigate } = useShop()
  const params = new URLSearchParams(loc.search)
  const q = params.get('q') || ''
  const cat = params.get('cat') || ''
  const brand = params.get('brand') || ''
  const age = params.get('age') || ''
  const sort = params.get('sort') || 'new'
  const minP = params.get('min') || ''
  const maxP = params.get('max') || ''

  const setParam = (k, v) => {
    const p = new URLSearchParams(loc.search)
    if (v) p.set(k, v); else p.delete(k)
    navigate(`/products${p.toString() ? '?' + p.toString() : ''}`)
  }

  const brands = useMemo(() => Array.from(new Set(products.map(p => p.brand).filter(Boolean))).sort(), [products])
  const cats = useMemo(() => Array.from(new Set(products.map(p => p.category).filter(Boolean))).sort(), [products])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let r = products.filter(p => {
      if (cat && p.category !== cat) return false
      if (brand && p.brand !== brand) return false
      if (age && p.age_range !== age) return false
      if (minP && num(p.sell_price) < num(minP)) return false
      if (maxP && num(p.sell_price) > num(maxP)) return false
      if (needle && !`${p.name} ${p.category} ${p.brand || ''} ${p.description || ''}`.toLowerCase().includes(needle)) return false
      return true
    })
    if (sort === 'price-asc') r = [...r].sort((a, b) => num(a.sell_price) - num(b.sell_price))
    else if (sort === 'price-desc') r = [...r].sort((a, b) => num(b.sell_price) - num(a.sell_price))
    else if (sort === 'rating') r = [...r].sort((a, b) => num(b.avg_rating) - num(a.avg_rating) || num(b.review_count) - num(a.review_count))
    return r
  }, [products, q, cat, brand, age, sort, minP, maxP])

  const hasFilters = q || cat || brand || age || minP || maxP
  if (loading) return <Loading />
  return (
    <div className="sh-wrap">
      <h1 className="sh-h2" style={{ fontSize: 24 }}>
        {q ? `Results for “${q}”` : age ? `Toys for ages ${age}` : cat || 'All toys'}
      </h1>

      <div className="sh-toolbar">
        <select className="sh-sel" value={cat} onChange={e => setParam('cat', e.target.value)}>
          <option value="">All categories</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="sh-sel" value={brand} onChange={e => setParam('brand', e.target.value)}>
          <option value="">All brands</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <input className="sh-inp" style={{ width: 90 }} type="number" min="0" placeholder="Min" value={minP} onChange={e => setParam('min', e.target.value)} />
        <input className="sh-inp" style={{ width: 90 }} type="number" min="0" placeholder="Max" value={maxP} onChange={e => setParam('max', e.target.value)} />
        <select className="sh-sel" value={sort} onChange={e => setParam('sort', e.target.value)}>
          <option value="new">Newest</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="rating">Top rated</option>
        </select>
        {hasFilters && <button className="sh-chip" onClick={() => navigate('/products')}>Clear filters</button>}
        <span style={{ marginLeft: 'auto', color: '#9a9186', fontSize: 13 }}>{list.length} item{list.length === 1 ? '' : 's'}</span>
      </div>

      {list.length === 0 ? (
        <div className="sh-empty"><Package size={40} color="#e5dcc9" /><div style={{ marginTop: 10, fontWeight: 600 }}>Nothing matches these filters.</div></div>
      ) : <div className="sh-grid">{list.map(p => <ProductCard key={p.id} p={p} />)}</div>}
    </div>
  )
}

// ── Product detail ──────────────────────────────────────────────────────────────
export function ProductPage() {
  const { products, loc, navigate, addToCart, user, signIn } = useShop()
  const id = loc.path.split('/').pop()
  const [fetched, setFetched] = useState(null)
  const [qty, setQty] = useState(1)
  const [reviews, setReviews] = useState([])
  const [rForm, setRForm] = useState({ rating: 5, comment: '' })
  const [rSaving, setRSaving] = useState(false)
  const [imgIdx, setImgIdx] = useState(0)
  const p = products.find(x => String(x.id) === String(id)) || fetched

  useEffect(() => {
    window.scrollTo(0, 0)
    if (!products.find(x => String(x.id) === String(id))) {
      supabase.from('shop_products').select('*').eq('id', id).single().then(({ data }) => setFetched(data || null))
    }
    supabase.from('product_reviews').select('*').eq('product_id', id).eq('approved', true).order('created_at', { ascending: false }).then(({ data }) => setReviews(data || []))
  }, [id, products])

  async function submitReview() {
    if (!rForm.comment.trim()) return
    setRSaving(true)
    const payload = {
      product_id: id, author_id: user?.id || null,
      author_name: user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Customer',
      rating: rForm.rating, comment: rForm.comment.trim(),
    }
    const { error } = await supabase.from('product_reviews').insert(payload)
    setRSaving(false)
    if (!error) { setReviews(r => [{ ...payload, created_at: new Date().toISOString() }, ...r]); setRForm({ rating: 5, comment: '' }) }
    else alert('Could not post review: ' + error.message)
  }

  if (!p) return <div className="sh-wrap"><div className="sh-spin" /></div>
  const low = Number(p.stock_qty) > 0 && Number(p.stock_qty) <= 3
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : num(p.avg_rating)
  return (
    <div className="sh-wrap">
      <button className="sh-crumb" onClick={() => navigate('/products')}><ArrowLeft size={16} /> Back to toys</button>
      <div className="sh-pd">
        <div>
          {(() => {
            const gallery = (Array.isArray(p.images) && p.images.length ? p.images : (p.photo_url ? [p.photo_url] : []))
            const main = gallery[imgIdx] || gallery[0] || p.photo_url
            return (
              <>
                <ProductImage src={main} name={p.name} style={{ width: '100%', aspectRatio: '1/1', borderRadius: 20, border: '1px solid #f0ebe3' }} />
                {gallery.length > 1 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {gallery.map((src, i) => (
                      <img key={i} src={src} alt="" onClick={() => setImgIdx(i)}
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, cursor: 'pointer', border: i === imgIdx ? '2px solid #FFA500' : '1px solid #eee' }} />
                    ))}
                  </div>
                )}
              </>
            )
          })()}
          {p.video_url && <div style={{ marginTop: 14 }}><div style={{ fontSize: 12, fontWeight: 800, color: '#8a8278', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}><Sparkles size={14} color="#FFA500" /> Demo video</div><VideoEmbed url={p.video_url} /></div>}
        </div>

        <div className="sh-pd-info">
          {p.category && <span className="sh-cat">{p.category}</span>}
          <h1>{p.name}</h1>
          <Stars rating={avg} size={16} showValue count={reviews.length} />
          <div className="sh-pd-price">
            {money(effPrice(p))}
            {onSale(p) && <><span className="sh-was" style={{ fontSize: 17 }}>{money(p.sell_price)}</span>
              <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 800, color: '#fff', background: '#E24B4A', padding: '3px 9px', borderRadius: 99 }}>Save {Math.round((1 - num(p.sale_price) / num(p.sell_price)) * 100)}%</span></>}
          </div>
          {p.brand && <div style={{ fontSize: 13.5, color: '#77706a' }}>Brand: {p.brand}{p.age_range ? ` · Ages ${p.age_range}` : ''}</div>}
          {low && <div className="sh-low" style={{ marginTop: 6 }}>Only {p.stock_qty} left in stock</div>}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '20px 0 8px' }}>
            <QtyStepper qty={qty} onChange={setQty} max={Number(p.stock_qty) || 99} />
            <button className="sh-btn sh-btn-o" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { addToCart(p, qty); navigate('/cart') }}>
              Add to cart · {money(effPrice(p) * qty)}
            </button>
          </div>

          {p.description && <div className="sh-panel"><h3><Boxes size={14} color="#FFA500" /> About this toy</h3><p>{p.description}</p></div>}
          {p.safety_warnings && <div className="sh-panel sh-warn"><h3><ShieldCheck size={14} color="#c0800a" /> Safety warnings</h3><p>{p.safety_warnings}</p></div>}
          {p.battery && <div className="sh-panel"><h3><BatteryCharging size={14} color="#FFA500" /> Batteries</h3><p>{p.battery}</p></div>}
          {p.materials && <div className="sh-panel"><h3><Package size={14} color="#FFA500" /> Materials</h3><p>{p.materials}</p></div>}
        </div>
      </div>

      {/* Reviews */}
      <div style={{ marginTop: 40, maxWidth: 760 }}>
        <h2 className="sh-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Star size={18} color="#f5a623" fill="#f5a623" /> Reviews</h2>
        <div className="sh-card2">
          {user ? (
            <>
              <div className="hd">Write a review</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => setRForm(f => ({ ...f, rating: n }))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
                    <Star size={26} color="#f5a623" fill={n <= rForm.rating ? '#f5a623' : 'none'} />
                  </button>
                ))}
              </div>
              <Field label="Your review"><textarea rows={3} value={rForm.comment} onChange={e => setRForm(f => ({ ...f, comment: e.target.value }))} placeholder="What did you think?" /></Field>
              <button className="sh-btn sh-btn-o" disabled={rSaving || !rForm.comment.trim()} onClick={submitReview}>{rSaving ? 'Posting…' : 'Post review'}</button>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '6px 0' }}>
              <p style={{ color: '#77706a', margin: '0 0 12px', fontSize: 14 }}>Sign in with Google to leave a review.</p>
              <button className="sh-btn sh-btn-d" onClick={signIn}>Sign in with Google</button>
            </div>
          )}
        </div>

        {reviews.length === 0 ? <p style={{ color: '#9a9186' }}>No reviews yet — be the first!</p> : reviews.map((r, i) => (
          <div key={i} className="sh-review">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <b style={{ fontSize: 14 }}>{r.author_name || 'Customer'}</b>
              <span style={{ fontSize: 12, color: '#b8ab97' }}>{(r.created_at || '').slice(0, 10)}</span>
            </div>
            <Stars rating={r.rating} size={13} />
            {r.comment && <p style={{ fontSize: 14, color: '#4b453f', margin: '6px 0 0', lineHeight: 1.6 }}>{r.comment}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Cart ────────────────────────────────────────────────────────────────────────
export function CartPage() {
  const { cart, setQty, removeItem, cartSubtotal, giftWrap, setGiftWrap, shipIdx, setShipIdx, navigate, settings } = useShop()
  const SHIPPING = settings.shipping || []
  const GIFT_WRAP_FEE = num(settings.gift_wrap_fee)
  const freeOver = num(settings.free_delivery_over)
  const ship = SHIPPING[shipIdx] || SHIPPING[0] || { label: '—', fee: 0 }
  const freeShip = freeOver > 0 && cartSubtotal >= freeOver
  const shipFee = freeShip ? 0 : (ship?.fee || 0)
  const total = cartSubtotal + (giftWrap ? GIFT_WRAP_FEE : 0) + shipFee
  if (!cart.length) return (
    <div className="sh-wrap"><div className="sh-empty">
      <ShoppingCart size={44} color="#e5dcc9" />
      <div style={{ marginTop: 12, fontWeight: 700, color: '#8a8278' }}>Your cart is empty</div>
      <button className="sh-btn sh-btn-o" style={{ marginTop: 18 }} onClick={() => navigate('/products')}>Start shopping</button>
    </div></div>
  )
  return (
    <div className="sh-wrap">
      <h1 className="sh-h2">Your cart</h1>
      <div className="sh-cartgrid">
        <div>
          {cart.map(it => (
            <div key={it.id} className="sh-line">
              <ProductImage src={it.photo_url} name={it.name} style={{ width: 84, height: 84, borderRadius: 12, flexShrink: 0, cursor: 'pointer' }} className="" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }} onClick={() => navigate(`/product/${it.id}`)}>{it.name}</div>
                <div style={{ fontSize: 14, fontWeight: 800, margin: '4px 0 10px' }}>{money(it.price)}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <QtyStepper qty={it.qty} onChange={v => setQty(it.id, v)} max={Number(it.stock_qty) || 99} />
                  <button className="sh-x" onClick={() => removeItem(it.id)}><Trash2 size={16} /></button>
                </div>
              </div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{money(num(it.price) * it.qty)}</div>
            </div>
          ))}

          <div className={`sh-toggle ${giftWrap ? 'on' : ''}`} style={{ marginTop: 18 }} onClick={() => setGiftWrap(g => !g)}>
            <span className="sh-check">{giftWrap && <CheckCircle2 size={16} color="#fff" />}</span>
            <Gift size={18} color="#FFA500" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Add gift wrapping</div>
              <div style={{ fontSize: 12.5, color: '#8a8278' }}>We'll wrap it beautifully — {money(GIFT_WRAP_FEE)}</div>
            </div>
          </div>
        </div>

        <div className="sh-summary">
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14 }}>Order summary</div>
          <Field label="Delivery estimate to">
            <select value={shipIdx} onChange={e => setShipIdx(Number(e.target.value))}>
              {SHIPPING.map((s, i) => <option key={i} value={i}>{s.label} — {money(s.fee)}</option>)}
            </select>
          </Field>
          {freeOver > 0 && !freeShip && <div style={{ fontSize: 12, color: '#1D9E75', fontWeight: 600, marginBottom: 8 }}>Add {money(freeOver - cartSubtotal)} more for FREE delivery 🎉</div>}
          <div className="sh-srow"><span>Subtotal</span><span>{money(cartSubtotal)}</span></div>
          {giftWrap && <div className="sh-srow"><span>Gift wrapping</span><span>{money(GIFT_WRAP_FEE)}</span></div>}
          <div className="sh-srow"><span>Delivery (est.)</span><span>{freeShip ? <b style={{ color: '#1D9E75' }}>FREE</b> : money(shipFee)}</span></div>
          <div className="sh-stot"><span>Total</span><span style={{ color: '#E24B4A' }}>{money(total)}</span></div>
          <button className="sh-btn sh-btn-o" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} onClick={() => navigate('/checkout')}>
            Checkout <ChevronRight size={17} />
          </button>
          <div style={{ fontSize: 11.5, color: '#a79a80', marginTop: 10, textAlign: 'center' }}>Delivery is an estimate — final charge confirmed with you.</div>
        </div>
      </div>
    </div>
  )
}

// ── Checkout ────────────────────────────────────────────────────────────────────
export function CheckoutPage() {
  const { cart, cartSubtotal, giftWrap, shipIdx, user, navigate, clearCart, setLastOrder, settings } = useShop()
  const SHIPPING = settings.shipping || []
  const GIFT_WRAP_FEE = num(settings.gift_wrap_fee)
  const freeOver = num(settings.free_delivery_over)
  const ship = SHIPPING[shipIdx] || SHIPPING[0] || { label: '—', fee: 0 }
  const freeShip = freeOver > 0 && cartSubtotal >= freeOver
  const shipFee = freeShip ? 0 : (ship?.fee || 0)
  const [form, setForm] = useState({
    name: user?.user_metadata?.full_name || '', phone: '', island: '', address: '',
    notes: '', email: user?.email || '',
  })
  const [coupon, setCoupon] = useState('')
  const [applied, setApplied] = useState(null) // { type, value, code }
  const [couponMsg, setCouponMsg] = useState('')
  const [checking, setChecking] = useState(false)
  const [placing, setPlacing] = useState(false)

  const discount = applied ? (applied.type === 'percent' ? cartSubtotal * num(applied.value) / 100 : num(applied.value)) : 0
  const wrapFee = giftWrap ? GIFT_WRAP_FEE : 0
  const total = Math.max(0, cartSubtotal + wrapFee + shipFee - discount)

  useEffect(() => { if (!cart.length) navigate('/cart') }, []) // eslint-disable-line

  // prefill from the signed-in customer's saved profile (only empty fields)
  useEffect(() => {
    if (!user) return
    supabase.from('customer_profiles').select('*').eq('id', user.id).maybeSingle().then(({ data }) => {
      if (!data) return
      setForm(f => ({
        ...f,
        name: f.name || data.full_name || '',
        phone: f.phone || data.phone || '',
        island: f.island || data.island || '',
        address: f.address || data.address || '',
        notes: f.notes || data.notes || '',
      }))
    })
  }, [user]) // eslint-disable-line

  async function applyCoupon() {
    if (!coupon.trim()) return
    setChecking(true); setCouponMsg('')
    const { data, error } = await supabase.rpc('validate_coupon', { p_code: coupon.trim(), p_subtotal: cartSubtotal })
    setChecking(false)
    const row = Array.isArray(data) ? data[0] : data
    if (error || !row || !row.valid) { setApplied(null); setCouponMsg(row?.message || 'Invalid code'); return }
    setApplied({ type: row.discount_type, value: row.discount_value, code: coupon.trim().toUpperCase() })
    setCouponMsg('Applied')
  }

  async function placeOrder() {
    if (!form.name.trim() || !form.phone.trim() || !form.island.trim() || !cart.length) return
    setPlacing(true)
    try {
      const invoice = genInvoice()
      // Signed-in shoppers reuse their account id so orders link to one customer
      // record (with their Google email); guests get a fresh id each time.
      const customerId = user?.id || (crypto?.randomUUID && crypto.randomUUID()) || null
      const addr = [form.address, form.island].filter(Boolean).join(', ')
      const extras = [
        `Website order · ${form.island}`,
        giftWrap ? `Gift wrap +${money(GIFT_WRAP_FEE)}` : '',
        `Delivery est. ${freeShip ? 'FREE' : money(shipFee)} (${ship?.label})`,
        applied ? `Coupon ${applied.code} −${money(discount)}` : '',
        `Amount to pay ${money(total)}`,
        form.notes ? `Note: ${form.notes}` : '',
      ].filter(Boolean).join(' · ')

      if (customerId) {
        const cp = { id: customerId, name: form.name.trim(), phone: form.phone.trim(), email: user?.email || form.email || null, address: addr }
        if (!user) cp.notes = `Website order ${invoice}`   // keep existing notes for known accounts
        let { error } = await supabase.from('customers').upsert(cp, { onConflict: 'id' })
        while (error && dropMissingCol(error, cp)) { error = (await supabase.from('customers').upsert(cp, { onConflict: 'id' })).error }
        if (error) { /* place order even if the customer record fails */ }
      }
      const orderDate = new Date().toISOString().slice(0, 10)
      for (let i = 0; i < cart.length; i++) {
        const it = cart[i]
        const payload = {
          customer_id: customerId, customer_name: form.name.trim(),
          product_id: it.id, product_name: it.name, qty: it.qty,
          unit_price: num(it.price), total_price: +(num(it.price) * it.qty).toFixed(2),
          channel: 'Website', status: 'created', order_date: orderDate,
          invoice_number: invoice, payment_status: 'unpaid', payment_method: 'Bank Transfer',
          delivery_fee: i === 0 ? shipFee : 0,
          notes: i === 0 ? extras : '',
        }
        let { error } = await supabase.from('orders').insert(payload)
        while (error && dropMissingCol(error, payload)) { error = (await supabase.from('orders').insert(payload)).error }
        if (error) throw error
      }
      // remember the signed-in customer's details for next time (after ordering,
      // not while they type)
      if (user) {
        supabase.from('customer_profiles').upsert({
          id: user.id, email: user.email, full_name: form.name.trim(), phone: form.phone.trim(),
          island: form.island.trim(), address: form.address, notes: form.notes, updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
      }
      setLastOrder({ invoice, total, name: form.name.trim() })
      clearCart()
      navigate('/order-confirmed')
    } catch (err) {
      alert('Sorry — we could not place your order. Please try again.\n\n' + (err.message || ''))
    } finally {
      setPlacing(false)
    }
  }

  const canPlace = form.name.trim() && form.phone.trim() && form.island.trim() && cart.length
  return (
    <div className="sh-wrap" style={{ maxWidth: 900 }}>
      <button className="sh-crumb" onClick={() => navigate('/cart')}><ArrowLeft size={16} /> Back to cart</button>
      <h1 className="sh-h2">Checkout</h1>
      <div className="sh-cartgrid">
        <div>
          <div className="sh-card2">
            <div className="hd">Shipping details</div>
            <Field label="Full name" required><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name" /></Field>
            <Field label="Phone / WhatsApp" required><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} inputMode="tel" placeholder="7xxxxxx" /></Field>
            <Field label="Island" required><input value={form.island} onChange={e => setForm(f => ({ ...f, island: e.target.value }))} placeholder="e.g. Malé, Hulhumalé" /></Field>
            <Field label="Delivery address"><input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="House / street / landmark" /></Field>
            <Field label="Note (optional)"><textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Anything we should know?" /></Field>
          </div>

          <div className="sh-card2">
            <div className="hd">Payment</div>
            <div className="sh-toggle on" style={{ cursor: 'default' }}>
              <span className="sh-check"><CheckCircle2 size={16} color="#fff" /></span>
              <Truck size={18} color="#FFA500" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Bank transfer</div>
                <div style={{ fontSize: 12.5, color: '#8a8278' }}>Pay to our account after ordering — details shown next.</div>
              </div>
            </div>
            <div className="sh-toggle" style={{ marginTop: 10, opacity: 0.55, cursor: 'not-allowed' }}>
              <span className="sh-check" /><Tag size={18} color="#bbb" />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 14 }}>Card payment</div><div style={{ fontSize: 12.5, color: '#8a8278' }}>Coming soon</div></div>
            </div>
          </div>
        </div>

        <div className="sh-summary">
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14 }}>Your order</div>
          {cart.map(it => (
            <div key={it.id} className="sh-srow"><span style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name} ×{it.qty}</span><span>{money(num(it.price) * it.qty)}</span></div>
          ))}
          <div style={{ margin: '12px 0' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="sh-inp" style={{ flex: 1 }} value={coupon} onChange={e => setCoupon(e.target.value)} placeholder="Coupon code" />
              <button className="sh-btn sh-btn-d" style={{ padding: '10px 14px' }} disabled={checking || !coupon.trim()} onClick={applyCoupon}>{checking ? '…' : 'Apply'}</button>
            </div>
            {couponMsg && <div style={{ fontSize: 12, marginTop: 6, color: applied ? '#1D9E75' : '#E24B4A', fontWeight: 600 }}>{applied ? `✓ ${applied.code} applied` : couponMsg}</div>}
          </div>
          <div className="sh-srow"><span>Subtotal</span><span>{money(cartSubtotal)}</span></div>
          {giftWrap && <div className="sh-srow"><span>Gift wrapping</span><span>{money(GIFT_WRAP_FEE)}</span></div>}
          <div className="sh-srow"><span>Delivery (est.)</span><span>{freeShip ? <b style={{ color: '#1D9E75' }}>FREE</b> : money(shipFee)}</span></div>
          {discount > 0 && <div className="sh-srow" style={{ color: '#1D9E75' }}><span>Discount</span><span>−{money(discount)}</span></div>}
          <div className="sh-stot"><span>Total</span><span style={{ color: '#E24B4A' }}>{money(total)}</span></div>
          <button className="sh-btn sh-btn-o" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} disabled={!canPlace || placing} onClick={placeOrder}>
            {placing ? 'Placing…' : `Place order · ${money(total)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Order confirmed ─────────────────────────────────────────────────────────────
export function OrderConfirmed() {
  const { lastOrder, navigate } = useShop()
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!lastOrder) navigate('/') }, []) // eslint-disable-line
  if (!lastOrder) return null
  const copy = () => navigator.clipboard?.writeText(BANK.account).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  return (
    <div className="sh-wrap" style={{ maxWidth: 620 }}>
      <div className="sh-card2" style={{ textAlign: 'center', padding: '34px 26px' }}>
        <div style={{ width: 66, height: 66, borderRadius: '50%', background: '#e8f7ee', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}><CheckCircle2 size={34} color="#1D9E75" /></div>
        <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 900 }}>Order placed! 🎉</h1>
        <p style={{ color: '#667', fontSize: 14, margin: '0 0 4px' }}>Thank you, {lastOrder.name}. Your order <b>{lastOrder.invoice}</b> is in.</p>
        <p style={{ color: '#999', fontSize: 13, margin: '0 0 22px' }}>Please complete payment by bank transfer:</p>
        <div style={{ background: '#faf7f2', border: '1px dashed #e6d9bf', borderRadius: 16, padding: '18px 20px', textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><span style={{ color: '#8a8278', fontSize: 13 }}>Amount</span><b style={{ fontSize: 17, color: '#E24B4A' }}>{money(lastOrder.total)}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}><span style={{ color: '#8a8278', fontSize: 13 }}>Account name</span><b style={{ fontSize: 14 }}>{BANK.name}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#8a8278', fontSize: 13 }}>Account number</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><b style={{ fontSize: 15 }}>{BANK.account}</b>
              <button className="sh-x" onClick={copy} style={{ color: copied ? '#1D9E75' : '#FFA500' }}>{copied ? <CheckCircle2 size={16} /> : <Copy size={15} />}</button></span>
          </div>
          <div style={{ fontSize: 12, color: '#a79a80', marginTop: 12, lineHeight: 1.5 }}>Use <b>{lastOrder.invoice}</b> as the transfer reference and send us the slip. We'll confirm delivery with you.</div>
        </div>
        <button className="sh-btn sh-btn-o" style={{ marginTop: 20 }} onClick={() => navigate('/')}>Continue shopping</button>
      </div>
    </div>
  )
}

// ── Account ─────────────────────────────────────────────────────────────────────
export function AccountPage() {
  const { user, signIn, signOut, navigate } = useShop()
  const [profile, setProfile] = useState({ full_name: '', phone: '', island: '', address: '', notes: '' })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  // email/password auth
  const [mode, setMode] = useState('login')
  const [auth, setAuth] = useState({ first: '', last: '', dob: '', email: '', password: '', marketing: false })
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const setA = (k, v) => { setAuth(a => ({ ...a, [k]: v })); setErr(''); setInfo('') }

  useEffect(() => {
    if (!user) { setLoaded(true); return }
    supabase.from('customer_profiles').select('*').eq('id', user.id).maybeSingle().then(({ data }) => {
      setProfile({
        full_name: data?.full_name || user.user_metadata?.full_name || '',
        phone: data?.phone || '', island: data?.island || '',
        address: data?.address || '', notes: data?.notes || '',
      })
      setLoaded(true)
    })
  }, [user])

  const set = (k, v) => { setProfile(p => ({ ...p, [k]: v })); setSavedMsg('') }

  async function saveProfile() {
    setSaving(true)
    const { error } = await supabase.from('customer_profiles').upsert({
      id: user.id, email: user.email, ...profile, updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    // also mirror into the back-office Customers list so staff can see & message them
    const addr = [profile.address, profile.island].filter(Boolean).join(', ')
    const cust = { id: user.id, name: profile.full_name || user.user_metadata?.full_name || 'Customer', phone: profile.phone || null, email: user.email, address: addr || null }
    let { error: cErr } = await supabase.from('customers').upsert(cust, { onConflict: 'id' })
    while (cErr && dropMissingCol(cErr, cust)) { cErr = (await supabase.from('customers').upsert(cust, { onConflict: 'id' })).error }
    setSaving(false)
    setSavedMsg(error ? 'Could not save: ' + error.message : 'Saved ✓')
  }

  // ── auth actions ──
  async function doSignup() {
    if (!auth.email || !auth.password) { setErr('Email and password are required'); return }
    if (auth.password.length < 6) { setErr('Password must be at least 6 characters'); return }
    setBusy(true); setErr(''); setInfo('')
    const { data, error } = await supabase.auth.signUp({
      email: auth.email.trim(), password: auth.password,
      options: { data: { full_name: `${auth.first} ${auth.last}`.trim(), first_name: auth.first, last_name: auth.last, dob: auth.dob, marketing: auth.marketing } },
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    if (!data.session) setInfo(`Almost there! We sent a confirmation link to ${auth.email}. Click it to finish creating your account.`)
    // if a session came back, onAuthStateChange signs them in automatically
  }
  async function doLogin() {
    if (!auth.email || !auth.password) { setErr('Enter your email and password'); return }
    setBusy(true); setErr(''); setInfo('')
    const { error } = await supabase.auth.signInWithPassword({ email: auth.email.trim(), password: auth.password })
    setBusy(false)
    if (error) setErr(error.message)
  }
  async function forgot() {
    if (!auth.email) { setErr('Enter your email first, then tap Forgot password'); return }
    setBusy(true); setErr(''); setInfo('')
    const { error } = await supabase.auth.resetPasswordForEmail(auth.email.trim(), { redirectTo: window.location.origin + '/account' })
    setBusy(false)
    if (error) setErr(error.message); else setInfo(`Password reset link sent to ${auth.email}.`)
  }

  // ── not signed in: sign up / log in ──
  if (!user) {
    const signup = mode === 'signup'
    return (
      <div className="sh-auth">
        <img src="/logo-full.png" alt="Brick's & Joy" onError={e => { e.target.style.display = 'none' }} />
        <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="sub">{signup ? 'One account to check out faster, save your details, and leave reviews.' : 'Log in to check out faster, save your picks & track your orders.'}</p>

        <button className="sh-google" onClick={signIn}><GoogleG /> Continue with Google</button>
        <div className="sh-or">or</div>

        {signup && (
          <>
            <Field label="First name"><input value={auth.first} onChange={e => setA('first', e.target.value)} placeholder="First name" /></Field>
            <Field label="Last name"><input value={auth.last} onChange={e => setA('last', e.target.value)} placeholder="Last name" /></Field>
            <Field label="Date of birth (optional)"><input type="date" value={auth.dob} onChange={e => setA('dob', e.target.value)} /></Field>
          </>
        )}
        <Field label="Email address"><input type="email" value={auth.email} onChange={e => setA('email', e.target.value)} placeholder="you@example.com" autoComplete="email" /></Field>
        <div className="sh-field" style={{ textAlign: 'left' }}>
          <label>Password</label>
          <div style={{ position: 'relative' }}>
            <input type={showPw ? 'text' : 'password'} value={auth.password} onChange={e => setA('password', e.target.value)} placeholder="Password" autoComplete={signup ? 'new-password' : 'current-password'} style={{ width: '100%', paddingRight: 42 }} />
            <button type="button" onClick={() => setShowPw(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#999', display: 'flex' }}>{showPw ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
        </div>
        {!signup && <button className="sh-toggle-link" style={{ display: 'block', margin: '2px 0 14px' }} onClick={forgot}>Forgot password?</button>}
        {signup && (
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', textAlign: 'left', fontSize: 12.5, color: '#77706a', margin: '4px 0 16px', cursor: 'pointer' }}>
            <input type="checkbox" checked={auth.marketing} onChange={e => setA('marketing', e.target.checked)} style={{ marginTop: 2, accentColor: '#111' }} />
            <span>Email me about new toys, sales & exclusive offers.</span>
          </label>
        )}

        {err && <p className="sh-err">{err}</p>}
        {info && <p className="sh-info">{info}</p>}

        <button className="sh-authbtn" disabled={busy} onClick={signup ? doSignup : doLogin}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}</button>

        <p style={{ fontSize: 13.5, color: '#77706a', marginTop: 18 }}>
          {signup ? 'Already have an account? ' : "Don't have an account? "}
          <button className="sh-toggle-link" onClick={() => { setMode(signup ? 'login' : 'signup'); setErr(''); setInfo('') }}>{signup ? 'Log in' : 'Sign up'}</button>
        </p>
        <p style={{ marginTop: 14 }}>
          <button className="sh-toggle-link" style={{ color: '#b8740a' }} onClick={() => navigate('/products')}>Or keep shopping as a guest →</button>
        </p>
      </div>
    )
  }

  // ── signed in: profile ──
  return (
    <div className="sh-wrap" style={{ maxWidth: 560 }}>
      <h1 className="sh-h2">My account</h1>
      <div className="sh-card2" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {user.user_metadata?.avatar_url && <img src={user.user_metadata.avatar_url} alt="" style={{ width: 52, height: 52, borderRadius: '50%' }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{profile.full_name || user.user_metadata?.full_name || 'Welcome!'}</div>
          <div style={{ color: '#8a8278', fontSize: 13 }}>{user.email}</div>
        </div>
        <button className="sh-btn" style={{ background: 'none', color: '#E24B4A' }} onClick={signOut}><LogOut size={15} /> Sign out</button>
      </div>

      <div className="sh-card2">
        <div className="hd">Your details</div>
        <p style={{ fontSize: 12.5, color: '#8a8278', margin: '-6px 0 14px' }}>We'll use these to fill in checkout for you. Nothing saves until you press Save.</p>
        <Field label="Full name"><input value={profile.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Your name" /></Field>
        <Field label="Phone / WhatsApp"><input value={profile.phone} onChange={e => set('phone', e.target.value)} inputMode="tel" placeholder="7xxxxxx" /></Field>
        <Field label="Island"><input value={profile.island} onChange={e => set('island', e.target.value)} placeholder="e.g. Malé, Hulhumalé" /></Field>
        <Field label="Delivery address"><input value={profile.address} onChange={e => set('address', e.target.value)} placeholder="House / street / landmark" /></Field>
        <Field label="Notes (optional)"><textarea rows={2} value={profile.notes} onChange={e => set('notes', e.target.value)} placeholder="Anything we should know for deliveries?" /></Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
          <button className="sh-btn sh-btn-o" disabled={saving || !loaded} onClick={saveProfile}>{saving ? 'Saving…' : 'Save details'}</button>
          {savedMsg && <span style={{ fontSize: 13, fontWeight: 600, color: savedMsg.startsWith('Saved') ? '#1D9E75' : '#E24B4A' }}>{savedMsg}</span>}
          <button className="sh-btn sh-btn-d" style={{ marginLeft: 'auto' }} onClick={() => navigate('/products')}>Continue shopping</button>
        </div>
      </div>
    </div>
  )
}
