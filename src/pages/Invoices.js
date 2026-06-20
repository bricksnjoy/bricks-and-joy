import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner, useToast, Toasts } from '../components/UI'
import { Printer, Search, ChevronDown, ChevronRight, Download, FileText } from 'lucide-react'
import { getSettings } from '../lib/settings'

const payColors = { paid: '#1D9E75', partial: '#f57f17', unpaid: '#c62828' }

function buildInvoices(orders) {
  const map = {}
  for (const o of orders) {
    const key = o.invoice_number || ('__id__' + o.id)
    if (!map[key]) {
      map[key] = {
        key,
        invoice_number: o.invoice_number || '',
        customer_id: o.customer_id,
        customer_name: o.customer_name || 'Walk-in',
        order_date: o.order_date,
        channel: o.channel,
        status: o.status,
        payment_status: o.payment_status || 'unpaid',
        payment_method: o.payment_method || '',
        transfer_reference: o.transfer_reference || '',
        notes: o.notes || '',
        created_at: o.created_at,
        items: [],
        total: 0,
      }
    }
    map[key].items.push(o)
    map[key].total += Number(o.total_price || 0)
  }
  return Object.values(map).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

export default function Invoices() {
  const [orders, setOrders] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [payFilter, setPayFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, c] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, name, phone, address').order('name'),
    ])
    setOrders(o.data || [])
    setCustomers(c.data || [])
    setLoading(false)
  }

  const invoices = useMemo(() => buildInvoices(orders), [orders])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return invoices.filter(inv => {
      if (payFilter !== 'all' && inv.payment_status !== payFilter) return false
      if (!q) return true
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        inv.customer_name.toLowerCase().includes(q) ||
        (inv.order_date || '').includes(q)
      )
    })
  }, [invoices, search, payFilter])

  const counts = useMemo(() => ({
    all: invoices.length,
    paid: invoices.filter(i => i.payment_status === 'paid').length,
    partial: invoices.filter(i => i.payment_status === 'partial').length,
    unpaid: invoices.filter(i => i.payment_status === 'unpaid').length,
  }), [invoices])

  const totalRevenue = useMemo(() =>
    invoices.filter(i => i.payment_status === 'paid').reduce((s, i) => s + i.total, 0), [invoices])

  const totalUnpaid = useMemo(() =>
    invoices.filter(i => i.payment_status === 'unpaid').reduce((s, i) => s + i.total, 0), [invoices])

  function printReceipt(inv) {
    const customer = customers.find(c => c.id === inv.customer_id) || { name: inv.customer_name }
    const items = inv.items
    const discountTotal = items.reduce((s, it) => s + Number(it.discount || 0), 0)
    const w = window.open('', '_blank', 'width=480,height=640')
    const payStatus = inv.payment_status
    const payColor = payColors[payStatus] || '#888'
    const logoUrl = window.location.origin + '/logo-full.png'
    w.document.write(`
      <html><head><title>Receipt — ${inv.invoice_number || 'Order'}</title>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Poppins',Arial,sans-serif; color:#0d1b2a; padding:36px; max-width:560px; margin:0 auto; }
        .doc-header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:20px; border-bottom:3px solid #FFA500; margin-bottom:24px; }
        .brand img { height:50px; width:auto; max-width:200px; object-fit:contain; }
        .brand-tag { font-size:10px; color:#aaa; text-transform:uppercase; letter-spacing:1.2px; margin-top:2px; }
        .doc-type { text-align:right; }
        .doc-type-label { font-size:11px; font-weight:700; color:#FFA500; text-transform:uppercase; letter-spacing:1.5px; }
        .doc-inv { font-size:20px; font-weight:900; color:#0d1b2a; letter-spacing:-0.5px; margin-top:4px; }
        .doc-date { font-size:12px; color:#aaa; margin-top:3px; }
        .info-row { display:flex; gap:32px; margin-bottom:22px; padding-bottom:18px; border-bottom:1px solid #f0f0f0; }
        .info-block .lbl { font-size:10px; color:#bbb; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; font-weight:600; }
        .info-block .val { font-size:14px; font-weight:700; color:#0d1b2a; }
        .info-block .sub { font-size:11px; color:#aaa; margin-top:2px; }
        .items-head { display:flex; justify-content:space-between; font-size:10px; color:#bbb; text-transform:uppercase; letter-spacing:0.6px; font-weight:700; padding:0 0 8px; border-bottom:1px solid #eee; margin-bottom:4px; }
        .item-row { display:flex; justify-content:space-between; align-items:center; padding:11px 0; border-bottom:1px solid #f5f5f5; }
        .item-name { font-size:14px; font-weight:600; color:#0d1b2a; }
        .item-qty { font-size:12px; color:#aaa; margin-top:2px; }
        .item-total { font-size:14px; font-weight:700; color:#0d1b2a; }
        .total-block { display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding:16px 20px; background:#0d1b2a; border-radius:10px; }
        .total-label { font-size:11px; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:1px; }
        .total-amount { font-size:24px; font-weight:900; color:#FFA500; letter-spacing:-0.8px; }
        .pay-section { margin-top:18px; display:flex; gap:20px; align-items:flex-start; flex-wrap:wrap; padding-top:14px; border-top:1px solid #f0f0f0; }
        .badge { display:inline-flex; padding:4px 14px; border-radius:99px; font-size:11px; font-weight:700; background:${payColor}15; color:${payColor}; border:1px solid ${payColor}40; }
        .pay-detail .lbl { font-size:10px; color:#bbb; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px; }
        .pay-detail .val { font-size:13px; font-weight:600; color:#333; }
        .notes { margin-top:14px; background:#fffbf0; border-left:3px solid #FFA500; padding:10px 14px; border-radius:0 8px 8px 0; }
        .notes .lbl { font-size:10px; color:#aaa; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; }
        .notes .val { font-size:12px; color:#555; line-height:1.6; }
        .doc-footer { margin-top:36px; padding-top:14px; border-top:1px solid #f0f0f0; display:flex; justify-content:space-between; align-items:center; }
        .footer-msg { font-size:11px; color:#ccc; font-style:italic; }
        .footer-brand { font-size:11px; font-weight:700; color:#0d1b2a; }
        @media print { body { padding:20px; } }
      </style></head>
      <body>
        <div class="doc-header">
          <div class="brand">
            <img src="${logoUrl}" alt="Brick's &amp; Joy" onerror="this.style.display='none';document.getElementById('bFb').style.display='block'" />
            <div id="bFb" style="display:none;font-size:18px;font-weight:800;color:#0d1b2a">Brick's &amp; Joy</div>
            <div class="brand-tag">Official Receipt</div>
          </div>
          <div class="doc-type">
            <div class="doc-type-label">Receipt</div>
            <div class="doc-inv">${inv.invoice_number || '—'}</div>
            <div class="doc-date">${inv.order_date || '—'}</div>
          </div>
        </div>
        <div class="info-row">
          <div class="info-block">
            <div class="lbl">Customer</div>
            <div class="val">${customer.name}</div>
            ${customer.phone ? `<div class="sub">${customer.phone}</div>` : ''}
          </div>
          ${inv.channel ? `<div class="info-block"><div class="lbl">Channel</div><div class="val">${inv.channel}</div></div>` : ''}
        </div>
        <div class="items-head"><span>Item</span><span>Amount</span></div>
        ${items.map(it => `
        <div class="item-row">
          <div>
            <div class="item-name">${it.product_name}</div>
            <div class="item-qty">${it.qty} unit${it.qty !== 1 ? 's' : ''} × MVR ${Number(it.unit_price || 0).toFixed(2)}</div>
          </div>
          <div class="item-total">MVR ${Number(it.total_price || 0).toFixed(2)}</div>
        </div>`).join('')}
        ${discountTotal > 0 ? `<div class="item-row" style="color:#1D9E75"><span style="font-size:12px">Discount</span><span style="font-weight:700">-MVR ${discountTotal.toFixed(2)}</span></div>` : ''}
        <div class="total-block">
          <div class="total-label">Total Amount</div>
          <div class="total-amount">MVR ${inv.total.toFixed(2)}</div>
        </div>
        <div class="pay-section">
          <span class="badge">${payStatus.toUpperCase()}</span>
          ${inv.payment_method ? `<div class="pay-detail"><div class="lbl">Method</div><div class="val">${inv.payment_method}</div></div>` : ''}
          ${inv.transfer_reference ? `<div class="pay-detail"><div class="lbl">Reference</div><div class="val" style="font-family:monospace">${inv.transfer_reference}</div></div>` : ''}
        </div>
        ${inv.notes ? `<div class="notes"><div class="lbl">Notes</div><div class="val">${inv.notes}</div></div>` : ''}
        <div class="doc-footer">
          <div class="footer-msg">This is a computer generated receipt.</div>
          <div class="footer-brand">Brick's &amp; Joy</div>
        </div>
        <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }</script>
      </body></html>`)
    w.document.close()
  }

  function downloadCSV() {
    const { currency } = getSettings()
    const rows = [
      ['Invoice #', 'Customer', 'Date', 'Items', 'Total', 'Payment Status', 'Method', 'Reference', 'Channel'],
      ...filtered.map(inv => [
        inv.invoice_number,
        inv.customer_name,
        inv.order_date,
        inv.items.map(it => `${it.product_name} ×${it.qty}`).join('; '),
        inv.total.toFixed(2),
        inv.payment_status,
        inv.payment_method,
        inv.transfer_reference,
        inv.channel,
      ]),
    ]
    const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoices-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV downloaded!')
  }

  const AVATAR_COLORS = ['#7F77DD','#1D9E75','#FFA500','#378ADD','#E24B4A','#0F6E56']

  return (
    <div>
      <style>{`
        .inv-row { border:1px solid #eee; border-radius:12px; background:#fff; overflow:hidden; transition:box-shadow 0.15s; animation:invFade 0.25s ease both; }
        .inv-row:hover { box-shadow:0 4px 14px rgba(0,0,0,0.06); }
        @keyframes invFade { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:none } }
        .inv-head { display:grid; grid-template-columns:120px 1fr 100px 120px 100px 80px; gap:12px; align-items:center; padding:14px 16px; cursor:pointer; }
        .inv-items { border-top:1px solid #f5f5f5; background:#fafaf8; padding:12px 16px; display:flex; flex-direction:column; gap:6px; }
        .inv-item-line { display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:6px 0; border-bottom:1px dotted #eee; }
        .inv-item-line:last-child { border-bottom:none; }
        .inv-pill { display:inline-flex; align-items:center; gap:4px; padding:4px 11px; border-radius:99px; font-size:11px; font-weight:700; }
        .inv-action { padding:6px 11px; border-radius:8px; border:1px solid #eee; background:#fafafa; cursor:pointer; font-size:12px; font-weight:600; font-family:inherit; display:inline-flex; align-items:center; gap:5px; color:#555; transition:all 0.14s; }
        .inv-action:hover { background:#0d1b2a; color:#fff; border-color:#0d1b2a; }
        .inv-action.print:hover { background:#FFA500; border-color:#FFA500; color:#fff; }
        @media (max-width: 700px) {
          .inv-col-date, .inv-col-items, .inv-col-channel { display:none; }
          .inv-head { grid-template-columns:1fr auto; gap:10px; }
        }
        @media (max-width: 600px) {
          .inv-col-hdr { display:none !important; }
          .inv-head { display:flex !important; align-items:center; gap:10px; padding:12px 14px; }
          .inv-invnum { font-size:10.5px !important; padding:2px 6px !important; }
          .inv-items { padding:10px 14px; }
          .inv-item-line { flex-wrap:wrap; gap:2px; }
          .inv-item-line > span:last-child { margin-left:auto; }
          .inv-exp-footer { flex-direction:column !important; align-items:flex-start !important; gap:10px !important; }
          .inv-exp-footer .inv-action { width:100%; justify-content:center; padding:10px 14px; font-size:13px; }
          .inv-filter-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
          .inv-filter-wrap::-webkit-scrollbar { display:none; }
          .inv-filter-wrap > div { flex-wrap:nowrap !important; }
        }
      `}</style>

      <PageHeader
        title="Invoices"
        subtitle={`${invoices.length} total · MVR ${totalRevenue.toFixed(2)} collected · MVR ${totalUnpaid.toFixed(2)} outstanding`}
        action={
          <button onClick={downloadCSV} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', border:'1px solid #ddd', borderRadius:9, background:'#fff', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', color:'#555', transition:'all 0.14s' }}
            onMouseEnter={e => { e.currentTarget.style.background='#0d1b2a'; e.currentTarget.style.color='#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background='#fff'; e.currentTarget.style.color='#555' }}>
            <Download size={14} /> Export CSV
          </button>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {/* Search */}
          <div style={{ position:'relative' }}>
            <Search size={14} color="#bbb" style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search invoice #, customer, date…"
              style={{ width:'100%', padding:'9px 12px 9px 34px', border:'1px solid #eee', borderRadius:9, fontSize:13, fontFamily:'inherit', outline:'none', background:'#fafaf8', boxSizing:'border-box' }}
            />
          </div>

          {/* Payment filter — scrollable on mobile */}
          <div className="inv-filter-wrap">
            <div style={{ display:'flex', background:'#f5f5f5', borderRadius:10, padding:3, gap:2 }}>
              {[
                { key:'all', label:'All', count: counts.all },
                { key:'paid', label:'Paid', count: counts.paid },
                { key:'partial', label:'Partial', count: counts.partial },
                { key:'unpaid', label:'Unpaid', count: counts.unpaid },
              ].map(f => (
                <button key={f.key} onClick={() => setPayFilter(f.key)} style={{
                  padding:'6px 12px', borderRadius:8, border:'none', cursor:'pointer', fontFamily:'inherit',
                  fontSize:12, fontWeight: payFilter === f.key ? 700 : 500,
                  background: payFilter === f.key ? '#fff' : 'transparent',
                  color: payFilter === f.key ? (payColors[f.key] || '#0d1b2a') : '#999',
                  boxShadow: payFilter === f.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  transition:'all 0.15s', display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap', flexShrink:0,
                }}>
                  {f.label}
                  <span style={{ fontSize:10, fontWeight:700, background: payFilter === f.key ? '#f0f0f0' : 'transparent', borderRadius:99, padding: payFilter === f.key ? '1px 5px' : '0', color: payFilter === f.key ? '#555' : '#bbb' }}>{f.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <Card>
          <div style={{ textAlign:'center', padding:'46px 0', color:'#c4c4c4' }}>
            <div style={{ width:58, height:58, borderRadius:16, background:'linear-gradient(135deg,#fff3df,#ffe9c7)', display:'inline-flex', alignItems:'center', justifyContent:'center', marginBottom:14 }}>
              <FileText size={26} color="#FFA500" />
            </div>
            <div style={{ fontWeight:600, color:'#999' }}>No invoices found.</div>
          </div>
        </Card>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {/* Column headers — hidden on mobile */}
          <div className="inv-head inv-col-hdr" style={{ padding:'0 16px 6px', cursor:'default', fontSize:10, color:'#bbb', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px' }}>
            <span>Invoice #</span>
            <span>Customer</span>
            <span className="inv-col-date">Date</span>
            <span className="inv-col-items">Items</span>
            <span>Total</span>
            <span>Status</span>
          </div>

          {filtered.map((inv, animIdx) => {
            const isOpen = expanded === inv.key
            const payColor = payColors[inv.payment_status] || '#888'
            const name = inv.customer_name
            const ci = name.charCodeAt(0) % AVATAR_COLORS.length
            const discountTotal = inv.items.reduce((s, it) => s + Number(it.discount || 0), 0)

            return (
              <div key={inv.key} className="inv-row" style={{ animationDelay: `${animIdx * 0.03}s` }}>
                {/* Row header — click to expand */}
                <div className="inv-head" onClick={() => setExpanded(isOpen ? null : inv.key)}>
                  {/* Invoice # */}
                  <span className="inv-invnum" style={{ fontFamily:'monospace', fontSize:12, color:'#888', background:'#f5f5f5', padding:'3px 8px', borderRadius:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {inv.invoice_number || <span style={{ color:'#ccc' }}>No #</span>}
                  </span>

                  {/* Customer */}
                  <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                    <div style={{ width:30, height:30, borderRadius:8, background:AVATAR_COLORS[ci]+'18', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:AVATAR_COLORS[ci], flexShrink:0 }}>
                      {name[0].toUpperCase()}
                    </div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontWeight:700, color:'#0d1b2a', fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{name}</div>
                      {inv.channel && <div style={{ fontSize:11, color:'#bbb' }}>{inv.channel}</div>}
                    </div>
                  </div>

                  {/* Date */}
                  <span className="inv-col-date" style={{ fontSize:12, color:'#888' }}>{inv.order_date || '—'}</span>

                  {/* Items count */}
                  <span className="inv-col-items" style={{ fontSize:12, color:'#888' }}>
                    {inv.items.length} item{inv.items.length !== 1 ? 's' : ''}
                  </span>

                  {/* Total */}
                  <div>
                    <div style={{ fontWeight:800, fontSize:14, color:'#0d1b2a' }}>MVR {inv.total.toFixed(2)}</div>
                    {discountTotal > 0 && <div style={{ fontSize:10, color:'#1D9E75', fontWeight:600 }}>-MVR {discountTotal.toFixed(2)}</div>}
                  </div>

                  {/* Status + expand icon */}
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span className="inv-pill" style={{ background:payColor+'15', color:payColor }}>
                      {inv.payment_status}
                    </span>
                    {isOpen ? <ChevronDown size={14} color="#bbb" /> : <ChevronRight size={14} color="#bbb" />}
                  </div>
                </div>

                {/* Expanded line items */}
                {isOpen && (
                  <div className="inv-items">
                    {inv.items.map((it, i) => (
                      <div key={i} className="inv-item-line">
                        <div>
                          <span style={{ fontWeight:600, color:'#0d1b2a' }}>{it.product_name}</span>
                          <span style={{ color:'#aaa', marginLeft:8 }}>× {it.qty} @ MVR {Number(it.unit_price||0).toFixed(2)}</span>
                          {it.discount > 0 && <span style={{ color:'#1D9E75', marginLeft:6, fontSize:11 }}>-MVR {Number(it.discount).toFixed(2)}</span>}
                        </div>
                        <span style={{ fontWeight:700, color:'#0d1b2a' }}>MVR {Number(it.total_price||0).toFixed(2)}</span>
                      </div>
                    ))}
                    {/* Footer: total + actions */}
                    <div className="inv-exp-footer" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingTop:10, marginTop:4, borderTop:'1px solid #eee' }}>
                      <div style={{ fontSize:12, color:'#888' }}>
                        {inv.payment_method && <span>Via {inv.payment_method}</span>}
                        {inv.transfer_reference && <span style={{ marginLeft:8, fontFamily:'monospace' }}>#{inv.transfer_reference}</span>}
                        {inv.notes && <span style={{ marginLeft:8, fontStyle:'italic' }}>{inv.notes.slice(0,60)}{inv.notes.length > 60 ? '…' : ''}</span>}
                      </div>
                      <div style={{ display:'flex', gap:8 }}>
                        <button className="inv-action print" onClick={() => printReceipt(inv)}>
                          <Printer size={12} /> Print receipt
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
