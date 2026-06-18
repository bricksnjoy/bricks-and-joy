import React, { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Search, LifeBuoy, ShoppingCart, BookOpen, Truck, Lightbulb
} from 'lucide-react'

// ── Guide content ─────────────────────────────────────────────────────────────
// Each guide is a "how-to" card with numbered steps. A step can carry an optional
// `tip` callout. Keep these in plain language — this is the manual for new staff.
const GUIDES = [
  {
    id: 'new-order',
    icon: ShoppingCart,
    color: '#FFA500',
    title: 'When a new order comes in',
    desc: 'The full flow from a fresh customer to a placed order.',
    steps: [
      { text: 'Open the Customers tab and press “Add customer”.' },
      { text: 'Fill in the customer’s details carefully — name, phone, address and any notes.', tip: 'Correct phone & address here means delivery notes and receipts come out right later.' },
      { text: 'Go to Orders and press “New order”, then pick the customer you just added.' },
      { text: 'Add the product — either tap the camera button to scan the barcode with your phone, or choose it from the dropdown.', tip: 'Scanning is fastest — point your phone camera at the product’s barcode.' },
      { text: 'Buying more than one item? Use the dropdown to add another product and fill in its details too.' },
      { text: 'Applying a discount? Choose Percentage (%) or MVR, then type how much you’re taking off.' },
      { text: 'Save the order. You’re done — it now shows in Orders and on the customer’s history.' },
    ],
  },
  {
    id: 'add-products',
    icon: BookOpen,
    color: '#7F77DD',
    title: 'Add new products to the catalog',
    desc: 'Set up a supplier, then bulk-import their products from Excel.',
    steps: [
      { text: 'Go to Vendors and add a new supplier.' },
      { text: 'Fill in the supplier’s information correctly (company, contact name, phone, etc.).' },
      { text: 'Open Supplier Catalog, download the import template and fill it in.', tip: 'If a column doesn’t apply to a product, just leave it blank — skip it.' },
      { text: 'No picture URL? Leave the image column empty. After importing, select each product individually and add its photo.' },
      { text: 'Select the newly created supplier, then import your filled-in Excel template.' },
      { text: 'The importer shows what’s New, Changed or a Duplicate. Press Import to add new ones and update the changed ones automatically.', tip: 'Re-importing the same sheet won’t create duplicates — unchanged rows are skipped.' },
    ],
  },
  {
    id: 'batch-order',
    icon: Truck,
    color: '#1D9E75',
    title: 'Place a new batch (purchase) order',
    desc: 'Order stock from a supplier and receive it into inventory.',
    steps: [
      { text: 'Go to Purchase Orders and select products from the supplier catalog to create a batch order.', tip: 'You can also tick products inside Supplier Catalog and create a batch from there — it’ll appear in Purchase Orders.' },
      { text: 'The batch now shows in Purchase Orders.' },
      { text: 'After you pay the supplier, upload the payment slip and mark the order as Paid.' },
      { text: 'When the goods arrive, press “All products received”.', tip: 'This automatically adds every item in the batch to your Inventory — no manual entry needed.' },
    ],
  },
]

export default function HelpGuide({ onClose }) {
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return GUIDES
    return GUIDES
      .map(g => {
        const titleHit = g.title.toLowerCase().includes(q) || g.desc.toLowerCase().includes(q)
        const steps = g.steps.filter(s => s.text.toLowerCase().includes(q) || (s.tip || '').toLowerCase().includes(q))
        if (titleHit) return g
        if (steps.length) return { ...g, steps }
        return null
      })
      .filter(Boolean)
  }, [q])

  function jumpTo(id) {
    setQuery('')
    setTimeout(() => {
      const el = document.getElementById('help-' + id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 30)
  }

  return createPortal((
    <div className="help-overlay" style={{
      position: 'fixed', inset: 0, background: '#f8f7f4', zIndex: 3000,
      display: 'flex', flexDirection: 'column', fontFamily: "'Poppins', sans-serif",
      animation: 'helpIn 0.25s ease both',
    }}>
      <style>{`
        @keyframes helpIn { from { opacity: 0; transform: scale(0.99); } to { opacity: 1; transform: scale(1); } }
        @keyframes helpRise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .help-card { animation: helpRise 0.35s ease backwards; }
        .help-step:hover { background: #faf9f6; }
        .help-chip { transition: all 0.15s ease; }
        .help-chip:hover { border-color: #FFA500 !important; color: #FFA500 !important; transform: translateY(-1px); box-shadow: 0 3px 10px rgba(255,165,0,0.12); }
        .help-x:hover { background: #fee !important; color: #c0392b !important; }
        .help-scroll::-webkit-scrollbar { width: 8px; }
        .help-scroll::-webkit-scrollbar-thumb { background: #e0ddd6; border-radius: 99px; }
      `}</style>

      {/* Header */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #eee', padding: '16px 26px',
        display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
        boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{ background: 'linear-gradient(135deg,#FFA500,#ff8c00)', borderRadius: 12, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(255,165,0,0.3)' }}>
            <LifeBuoy size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-0.3px' }}>Help &amp; Guidelines</div>
            <div style={{ fontSize: 12, color: '#aaa' }}>How this works — new here or just need a reminder?</div>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', flex: 1, maxWidth: 460, margin: '0 auto' }}>
          <Search size={16} color="#bbb" style={{ position: 'absolute', left: 13, top: 12 }} />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search for a task… e.g. discount, supplier, receive stock"
            style={{ width: '100%', padding: '11px 14px 11px 38px', border: '1px solid #e6e3dd', borderRadius: 99, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', background: '#faf9f6', boxSizing: 'border-box' }}
          />
        </div>

        <button onClick={onClose} className="help-x" title="Close" style={{
          background: '#f5f4f1', border: 'none', cursor: 'pointer', color: '#666',
          width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center',
          justifyContent: 'center', transition: 'all 0.15s', flexShrink: 0,
        }}>
          <X size={20} />
        </button>
      </div>

      {/* Body */}
      <div className="help-scroll" style={{ flex: 1, overflowY: 'auto', padding: '26px 26px 60px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>

          {/* Quick jump chips */}
          {!q && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginBottom: 26 }}>
              {GUIDES.map(g => (
                <button key={g.id} onClick={() => jumpTo(g.id)} className="help-chip" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px',
                  borderRadius: 99, border: '1px solid #e6e3dd', background: '#fff',
                  cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#555', fontFamily: 'inherit',
                }}>
                  <g.icon size={14} color={g.color} /> {g.title}
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '70px 0', color: '#c4c4c4' }}>
              <Search size={34} color="#dcd8d0" />
              <div style={{ marginTop: 14, fontWeight: 600, color: '#999' }}>No guide matches “{query}”.</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Try a simpler word like “order”, “product” or “supplier”.</div>
            </div>
          )}

          {filtered.map((g, gi) => (
            <div key={g.id} id={'help-' + g.id} className="help-card" style={{
              background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: '22px 24px',
              marginBottom: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', animationDelay: `${gi * 60}ms`,
            }}>
              {/* Card header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 18 }}>
                <div style={{ background: `${g.color}18`, borderRadius: 12, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <g.icon size={22} color={g.color} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-0.3px' }}>{g.title}</h2>
                  <p style={{ margin: '3px 0 0', fontSize: 13, color: '#999' }}>{g.desc}</p>
                </div>
              </div>

              {/* Steps */}
              <div>
                {g.steps.map((s, i) => (
                  <div key={i} className="help-step" style={{ display: 'flex', gap: 13, padding: '11px 10px', borderRadius: 10, transition: 'background 0.15s' }}>
                    <div style={{
                      flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                      background: g.color, color: '#fff', fontSize: 13, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{i + 1}</div>
                    <div style={{ paddingTop: 2 }}>
                      <div style={{ fontSize: 14, color: '#2c3a47', lineHeight: 1.55 }}>{s.text}</div>
                      {s.tip && (
                        <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 8, background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 9, padding: '8px 11px' }}>
                          <Lightbulb size={14} color="#f0a500" style={{ flexShrink: 0, marginTop: 1 }} />
                          <span style={{ fontSize: 12.5, color: '#8a6d1b', lineHeight: 1.5 }}>{s.tip}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Footer note */}
          {!q && (
            <div style={{ textAlign: 'center', color: '#bbb', fontSize: 12.5, marginTop: 8 }}>
              More guides will be added here over time.
            </div>
          )}
        </div>
      </div>
    </div>
  ), document.body)
}
