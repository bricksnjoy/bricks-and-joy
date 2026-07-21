import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { ShoppingBag } from 'lucide-react'
import {
  BRAND, previewAllowed, num, effPrice, DEFAULT_SETTINGS, mergeSettings,
  ShopContext, Header, Footer, ShopStyles, CartDrawer, readCart, writeCart,
} from './core'
import { Home, ByAge, Listing, ProductPage, CartPage, CheckoutPage, OrderConfirmed, AccountPage } from './pages'

const parseLoc = () => ({ path: (window.location.pathname.replace(/\/+$/, '') || '/'), search: window.location.search })

export default function Shop() {
  const [loc, setLoc] = useState(parseLoc)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [user, setUser] = useState(null)
  const [cart, setCart] = useState(readCart)
  const [giftWrap, setGiftWrap] = useState(false)
  const [shipIdx, setShipIdx] = useState(0)
  const [cartOpen, setCartOpen] = useState(false)
  const [lastOrder, setLastOrder] = useState(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const preview = previewAllowed()
  const gated = !settings.live && !preview

  // routing
  const navigate = useCallback(to => { window.history.pushState({}, '', to); setLoc(parseLoc()); window.scrollTo(0, 0) }, [])
  useEffect(() => {
    const on = () => setLoc(parseLoc())
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])

  // load editable site settings first (decides live vs. coming-soon)
  useEffect(() => {
    document.title = `${BRAND} — Toys, sets & gifts`
    supabase.from('site_settings').select('data').eq('id', 1).single()
      .then(({ data }) => setSettings(mergeSettings(data?.data)))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true))
  }, [])

  // products + auth (only once we know the site is visible to this viewer)
  useEffect(() => {
    if (!settingsLoaded || gated) { if (settingsLoaded) setLoading(false); return }
    load()
    supabase.auth.getUser().then(({ data }) => { setUser(data?.user || null); setAuthReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setUser(s?.user || null); setAuthReady(true) })
    return () => sub?.subscription?.unsubscribe()
  }, [settingsLoaded, gated])

  useEffect(() => { writeCart(cart) }, [cart])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('shop_products').select('*').gt('stock_qty', 0).order('created_at', { ascending: false })
    if (error) {
      if (/relation|does not exist|schema cache|permission/i.test(error.message)) setNeedsSetup(true)
      setProducts([])
    } else { setNeedsSetup(false); setProducts(data || []) }
    setLoading(false)
  }

  // cart ops
  const addToCart = useCallback((p, qty = 1) => {
    setCart(c => {
      const ex = c.find(i => i.id === p.id)
      const max = Number(p.stock_qty) || 99
      if (ex) return c.map(i => i.id === p.id ? { ...i, qty: Math.min(max, i.qty + qty) } : i)
      return [...c, { id: p.id, name: p.name, price: effPrice(p), photo_url: p.photo_url, stock_qty: p.stock_qty, qty: Math.min(max, qty) }]
    })
    setCartOpen(true)   // pop the bag open on add, like a real store
  }, [])
  const setQty = useCallback((id, qty) => setCart(c => c.map(i => i.id === id ? { ...i, qty: Math.max(1, Math.min(Number(i.stock_qty) || 99, qty)) } : i)), [])
  const removeItem = useCallback(id => setCart(c => c.filter(i => i.id !== id)), [])
  const clearCart = useCallback(() => { setCart([]); writeCart([]); setGiftWrap(false) }, [])

  const signIn = useCallback(() => {
    supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/account' } })
  }, [])
  const signOut = useCallback(() => supabase.auth.signOut(), [])

  const cartCount = cart.reduce((s, i) => s + i.qty, 0)
  const cartSubtotal = cart.reduce((s, i) => s + num(i.price) * i.qty, 0)

  // hold the first paint until we know whether the site is live (avoids a flash
  // of the shop before the "coming soon" gate, or vice-versa)
  if (!settingsLoaded) {
    return <div style={{ minHeight: '100vh', background: '#faf7f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 34, height: 34, border: '3px solid #f0e6d2', borderTopColor: '#FFA500', borderRadius: '50%', animation: 'shSpin .8s linear infinite' }} />
      <style>{`@keyframes shSpin{to{transform:rotate(360deg)}}`}</style>
    </div>
  }

  // ── coming soon gate (public, while building) ─────────────────────────────────
  if (gated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', fontFamily: "'Poppins',sans-serif", background: 'linear-gradient(160deg,#FFA500,#ff7a00)' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;800;900&display=swap');@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}`}</style>
        <div style={{ color: '#fff', maxWidth: 460 }}>
          <div style={{ fontSize: 60, marginBottom: 10, animation: 'bob 2s ease-in-out infinite' }}>🧸</div>
          <h1 style={{ fontSize: 34, fontWeight: 900, margin: '0 0 12px', letterSpacing: '-0.8px' }}>{BRAND}</h1>
          <p style={{ fontSize: 17, fontWeight: 600, margin: '0 0 6px' }}>Our online shop is opening soon ✨</p>
          <p style={{ fontSize: 14.5, opacity: 0.92, lineHeight: 1.6, margin: 0 }}>
            We're putting the finishing touches on something joyful. In the meantime, find us on Instagram to shop our toys, sets & gifts.
          </p>
          {settings.instagram && <a href={settings.instagram} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 20, background: '#fff', color: '#d97800', fontWeight: 800, padding: '11px 22px', borderRadius: 12, textDecoration: 'none' }}>Visit our Instagram</a>}
        </div>
      </div>
    )
  }

  // ── setup gate (owner only, until SQL is run) ─────────────────────────────────
  if (needsSetup) {
    return (
      <div style={{ fontFamily: "'Poppins',sans-serif", background: '#faf7f2', minHeight: '100vh', padding: 24 }}>
        <ShopStyles />
        <div style={{ maxWidth: 640, margin: '40px auto', background: '#fff', border: '1px solid #f0ebe3', borderRadius: 18, padding: '28px 26px' }}>
          <ShoppingBag size={30} color="#FFA500" />
          <h2 style={{ margin: '14px 0 8px', fontSize: 20 }}>Website setup needed</h2>
          <p style={{ color: '#667', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
            Run the “PUBLIC WEBSITE / STOREFRONT” section from <code>supabase_schema.sql</code> in your Supabase SQL editor
            (it creates the <b>shop_products</b> view, reviews, coupons and the public order policies), then refresh.
          </p>
          <button onClick={load} style={{ marginTop: 20, background: 'linear-gradient(135deg,#FFA500,#ff8c00)', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 22px', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>I've run it — refresh</button>
        </div>
      </div>
    )
  }

  // ── route ─────────────────────────────────────────────────────────────────────
  let Page = Home
  if (loc.path === '/shop-by-age') Page = ByAge
  else if (loc.path === '/products') Page = Listing
  else if (loc.path.startsWith('/product/')) Page = ProductPage
  else if (loc.path === '/cart') Page = CartPage
  else if (loc.path === '/checkout') Page = CheckoutPage
  else if (loc.path === '/order-confirmed') Page = OrderConfirmed
  else if (loc.path === '/account') Page = AccountPage

  const ctx = {
    loc, navigate, products, loading, needsSetup, reload: load, settings,
    user, signIn, signOut,
    cart, cartCount, cartSubtotal, addToCart, setQty, removeItem, clearCart,
    giftWrap, setGiftWrap, shipIdx, setShipIdx, cartOpen, setCartOpen, lastOrder, setLastOrder,
  }

  // The account sign-up / log-in screen is a full-page takeover (no shop header
  // or footer) — like a dedicated auth page.
  if (loc.path === '/account' && !user) {
    return (
      <ShopContext.Provider value={ctx}>
        <div className="sh sh-authpage">
          <ShopStyles />
          {authReady ? <AccountPage /> : <div className="sh-spin" />}
        </div>
      </ShopContext.Provider>
    )
  }

  return (
    <ShopContext.Provider value={ctx}>
      <div className="sh">
        <ShopStyles />
        {settings.announcement && <div className="sh-announce">{settings.announcement}</div>}
        {!settings.live && preview && (
          <div style={{ background: '#b8740a', color: '#fff', textAlign: 'center', fontSize: 12.5, fontWeight: 600, padding: '6px 14px' }}>
            👀 Staff preview — the public still sees “coming soon”. Publish from the back office → Website tab.
          </div>
        )}
        <Header />
        <main className="sh-main"><Page /></main>
        <Footer />
        <CartDrawer />
      </div>
    </ShopContext.Provider>
  )
}
