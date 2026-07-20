import React, { useState } from 'react'
import { PageHeader, Card, Button } from '../components/UI'
import { Globe, ExternalLink, Copy, Check, Eye, ShoppingBag, Baby, Grid3x3, ShoppingCart } from 'lucide-react'

// Mirror of the shop's launch switch (see src/shop/core.js → SHOP_LIVE).
// While the site is hidden, staff preview it with the ?preview=on links below.
const SHOP_LIVE = false

export default function Storefront() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://bricksandjoy.com'
  const [copied, setCopied] = useState('')

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(''), 1600) }).catch(() => {})
  }

  const preview = p => `${origin}${p}${p.includes('?') ? '&' : '?'}preview=on`
  const pages = [
    { icon: ShoppingBag, label: 'Homepage', path: '/' },
    { icon: Baby, label: 'Shop by Age', path: '/shop-by-age' },
    { icon: Grid3x3, label: 'All Toys (listing + filters)', path: '/products' },
    { icon: ShoppingCart, label: 'Cart', path: '/cart' },
  ]

  const LinkRow = ({ label, url, hint, primary }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', border: '1px solid #eee', borderRadius: 12, background: primary ? '#FFF8EC' : '#fff', marginBottom: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0d1b2a' }}>{label}</div>
        <div style={{ fontSize: 12, color: '#8a8278', wordBreak: 'break-all' }}>{url}</div>
        {hint && <div style={{ fontSize: 11.5, color: '#b8ab97', marginTop: 2 }}>{hint}</div>}
      </div>
      <Button variant="ghost" size="sm" onClick={() => copy(url, url)}>{copied === url ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</Button>
      <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
        <Button size="sm"><ExternalLink size={13} /> Open</Button>
      </a>
    </div>
  )

  return (
    <div>
      <PageHeader title="Website" subtitle="Preview and manage your public shop while we build it" />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ background: SHOP_LIVE ? '#e8f5e9' : '#fff8e1', borderRadius: 12, padding: 12 }}>
            <Globe size={22} color={SHOP_LIVE ? '#2e7d32' : '#FFA500'} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#0d1b2a' }}>
              {SHOP_LIVE ? 'Your shop is LIVE 🎉' : 'Shop is hidden while we build'}
            </div>
            <div style={{ fontSize: 13, color: '#667', marginTop: 2 }}>
              {SHOP_LIVE
                ? 'Everyone visiting your site can shop right now.'
                : 'The public sees a “coming soon” page. Use the staff preview links below to check progress. Tell Claude when to go live.'}
            </div>
          </div>
        </div>
      </Card>

      {/* Staff preview */}
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Eye size={16} color="#FFA500" /> Staff preview (see the work-in-progress)
        </h3>
        <p style={{ fontSize: 12.5, color: '#8a8278', margin: '0 0 14px' }}>
          Open a preview link once on a device and it stays unlocked there — even the plain address will show you the real site afterwards.
        </p>
        <LinkRow primary label="Open the live preview" url={preview('/')} hint="Unlocks the full site on this device" />
        {pages.map(pg => <LinkRow key={pg.path} label={pg.label} url={preview(pg.path)} />)}
        <p style={{ fontSize: 12, color: '#b8ab97', margin: '6px 0 0' }}>
          Turn your own preview back off any time with <code>{origin}/?preview=off</code>
        </p>
      </Card>

      {/* Public links */}
      <Card>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Globe size={16} color="#FFA500" /> Public addresses
        </h3>
        <LinkRow label="Your shop (what customers will see)" url={origin + '/'} hint={SHOP_LIVE ? 'Live now' : 'Currently shows “coming soon”'} />
        <LinkRow label="Back office (this admin, staff login)" url={origin + '/backoffice'} />
      </Card>
    </div>
  )
}
