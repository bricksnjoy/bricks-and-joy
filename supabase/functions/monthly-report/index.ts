// Supabase Edge Function — Monthly business report by email.
// Computes a financial summary, restock alerts and sales highlights for a month
// and emails them to the recipients configured in the `report_settings` table.
//
// Deploy:   supabase functions deploy monthly-report
// Secrets:  supabase secrets set RESEND_API_KEY=...   (optional: REPORT_FROM="Brick's & Joy <reports@bricksandjoy.com>")
// Schedule: see the SQL in the project (pg_cron + net.http_post), or invoke manually.
//
// Invoke body (all optional):
//   { "month": "2026-05" }  -> report for that calendar month
//   { "test": true }        -> current month-to-date, for testing
//   default                 -> the previous full calendar month

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CURRENCY = 'MVR'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const money = (n: number) =>
  `${CURRENCY} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const DAY = 86400000
const ymd = (d: Date) => d.toISOString().split('T')[0]

function monthRange(monthStr?: string, test?: boolean) {
  const now = new Date()
  let y: number, m: number // m = 0-indexed
  if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
    y = +monthStr.slice(0, 4); m = +monthStr.slice(5, 7) - 1
  } else if (test) {
    y = now.getUTCFullYear(); m = now.getUTCMonth()
  } else {
    // previous full month
    y = now.getUTCFullYear(); m = now.getUTCMonth() - 1
    if (m < 0) { m = 11; y -= 1 }
  }
  const start = new Date(Date.UTC(y, m, 1))
  const end = test ? now : new Date(Date.UTC(y, m + 1, 0)) // last day of month
  const label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { start: ymd(start), end: ymd(end), label }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('REPORT_FROM') || "Brick's & Joy <onboarding@resend.dev>"
    const sb = createClient(supabaseUrl, serviceKey)

    let body: any = {}
    try { body = await req.json() } catch { /* no body */ }
    const { start, end, label } = monthRange(body.month, body.test)

    // ── Config ──
    const { data: cfg } = await sb.from('report_settings').select('*').eq('id', 1).maybeSingle()
    const recipients = String(cfg?.recipients || '')
      .split(/[,;\s]+/).map((s: string) => s.trim()).filter((s: string) => s.includes('@'))
    const incFin = cfg?.include_financial !== false
    const incRestock = cfg?.include_restock !== false
    const incSales = cfg?.include_sales !== false

    // ── Data ──
    const [{ data: orders }, { data: expenses }, { data: products }] = await Promise.all([
      sb.from('orders').select('id, order_date, status, qty, product_id, product_name, total_price, payment_status, customer_name'),
      sb.from('expenses').select('expense_date, category, amount'),
      sb.from('products').select('id, name, cost_price, stock_qty, discontinued, low_stock_threshold'),
    ])
    const O = orders || [], E = expenses || [], P = products || []
    const costById: Record<string, number> = {}
    P.forEach((p: any) => { costById[p.id] = Number(p.cost_price || 0) })

    const inMonth = (d: string) => d && d >= start && d <= end
    const deliveredMonth = O.filter((o: any) => o.status === 'delivered' && inMonth(o.order_date))

    // ── Financial summary ──
    const revenue = deliveredMonth.reduce((s, o: any) => s + Number(o.total_price || 0), 0)
    const cogs = deliveredMonth.reduce((s, o: any) => s + (costById[o.product_id] || 0) * Number(o.qty || 0), 0)
    const gross = revenue - cogs
    const expSum = E.filter((e: any) => inMonth(e.expense_date)).reduce((s, e: any) => s + Number(e.amount || 0), 0)
    const net = gross - expSum
    const ar = O.filter((o: any) => o.payment_status === 'unpaid' || o.payment_status === 'partial')
      .reduce((s, o: any) => s + Number(o.total_price || 0), 0)

    // ── Restock predictions (mirrors src/lib/insights.js) ──
    const since = ymd(new Date(Date.now() - 60 * DAY))
    const soldByProduct: Record<string, number> = {}
    O.filter((o: any) => o.status === 'delivered' && o.order_date >= since).forEach((o: any) => {
      if (o.product_id) soldByProduct[o.product_id] = (soldByProduct[o.product_id] || 0) + Number(o.qty || 0)
    })
    const restock = P.filter((p: any) => !p.discontinued).map((p: any) => {
      const sold = soldByProduct[p.id] || 0
      const perDay = sold / 60
      const stock = Number(p.stock_qty || 0)
      const daysLeft = perDay > 0 ? Math.round(stock / perDay) : Infinity
      const suggestedReorder = perDay > 0 ? Math.max(0, Math.ceil(perDay * 30 - stock)) : 0
      let urgency = 'ok'
      if (perDay > 0) { if (stock <= 0) urgency = 'out'; else if (daysLeft <= 7) urgency = 'critical'; else if (daysLeft <= 21) urgency = 'soon' }
      else if (stock <= 0) urgency = 'out'
      const unitCost = Number(p.cost_price || 0)
      return { name: p.name, stock, perMonth: perDay * 30, daysLeft, suggestedReorder, urgency, reorderCost: suggestedReorder * unitCost }
    }).filter((r: any) => ['out', 'critical', 'soon'].includes(r.urgency))
      .sort((a: any, b: any) => a.daysLeft - b.daysLeft)

    // ── Sales highlights ──
    const orderCount = O.filter((o: any) => inMonth(o.order_date)).length
    const byKey = (rows: any[], key: string) => {
      const m: Record<string, number> = {}
      rows.forEach(o => { const k = o[key] || '—'; m[k] = (m[k] || 0) + Number(o.total_price || 0) })
      return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5)
    }
    const topProducts = byKey(deliveredMonth, 'product_name')
    const topCustomers = byKey(deliveredMonth, 'customer_name')

    // ── Build HTML ──
    const C = { navy: '#0d1b2a', orange: '#FFA500', green: '#1D9E75', red: '#E24B4A', grey: '#888' }
    const card = (title: string, inner: string) =>
      `<div style="background:#fff;border:1px solid #eee;border-radius:14px;padding:18px 20px;margin-bottom:16px">
         <div style="font-size:13px;font-weight:700;color:${C.navy};text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">${title}</div>${inner}</div>`
    const stat = (l: string, v: string, color = C.navy) =>
      `<tr><td style="padding:5px 0;color:${C.grey};font-size:13px">${l}</td><td style="padding:5px 0;text-align:right;font-weight:700;color:${color};font-size:14px">${v}</td></tr>`

    let sections = ''
    if (incFin) sections += card('💰 Financial summary', `<table style="width:100%;border-collapse:collapse">
      ${stat('Revenue', money(revenue), C.green)}
      ${stat('Cost of goods sold', '−' + money(cogs))}
      ${stat('Gross profit', money(gross))}
      ${stat('Operating expenses', '−' + money(expSum), C.red)}
      <tr><td colspan="2" style="border-top:1px solid #eee"></td></tr>
      ${stat('Net profit', money(net), net >= 0 ? C.green : C.red)}
      ${stat('Outstanding (unpaid orders)', money(ar), C.orange)}
    </table>`)

    if (incSales) {
      const list = (rows: [string, number][]) => rows.length
        ? rows.map(([k, v]) => `<tr><td style="padding:4px 0;font-size:13px;color:${C.navy}">${k}</td><td style="padding:4px 0;text-align:right;font-size:13px;font-weight:600">${money(v)}</td></tr>`).join('')
        : `<tr><td style="color:${C.grey};font-size:13px">No sales this period</td></tr>`
      sections += card('📈 Sales highlights', `<table style="width:100%;border-collapse:collapse">
        ${stat('Orders placed', String(orderCount))}
      </table>
      <div style="font-size:12px;color:${C.grey};font-weight:600;margin:12px 0 4px">Top products</div>
      <table style="width:100%;border-collapse:collapse">${list(topProducts)}</table>
      <div style="font-size:12px;color:${C.grey};font-weight:600;margin:12px 0 4px">Top customers</div>
      <table style="width:100%;border-collapse:collapse">${list(topCustomers)}</table>`)
    }

    if (incRestock) {
      const rows = restock.length
        ? restock.map((r: any) => {
            const col = r.urgency === 'out' ? C.red : r.urgency === 'critical' ? C.red : C.orange
            const tag = r.urgency === 'out' ? 'OUT' : r.urgency === 'critical' ? 'CRITICAL' : 'SOON'
            return `<tr>
              <td style="padding:6px 0;font-size:13px;color:${C.navy}">${r.name}<br><span style="font-size:11px;color:${C.grey}">${r.stock} in stock · ~${r.perMonth.toFixed(0)}/mo · ${r.daysLeft === Infinity ? '—' : r.daysLeft + 'd left'}</span></td>
              <td style="padding:6px 0;text-align:right"><span style="font-size:10px;font-weight:700;color:#fff;background:${col};padding:2px 8px;border-radius:99px">${tag}</span><br><span style="font-size:13px;font-weight:700;color:${C.navy}">+${r.suggestedReorder}</span> <span style="font-size:11px;color:${C.grey}">${r.reorderCost > 0 ? money(r.reorderCost) : ''}</span></td>
            </tr>`
          }).join('') + (() => { const t = restock.reduce((s: number, r: any) => s + r.reorderCost, 0); return t > 0 ? `<tr><td style="padding-top:10px;border-top:1px solid #eee;font-weight:700;color:${C.navy};font-size:13px">Total to reorder</td><td style="padding-top:10px;border-top:1px solid #eee;text-align:right;font-weight:800;color:${C.navy};font-size:14px">${money(t)}</td></tr>` : '' })()
        : `<tr><td style="color:${C.green};font-size:13px">✅ Everything is well stocked.</td></tr>`
      sections += card('📦 Reorder list', `<table style="width:100%;border-collapse:collapse">${rows}</table>`)
    }

    const html = `<div style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f6f5f2;padding:24px;max-width:600px;margin:0 auto">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:22px;font-weight:800;color:${C.navy}">Brick's &amp; Joy</div>
        <div style="font-size:13px;color:${C.grey}">Monthly report · ${label}</div>
      </div>
      ${sections}
      <div style="text-align:center;font-size:11px;color:#bbb;margin-top:18px">Automated report · ${start} to ${end}</div>
    </div>`

    const subject = `Brick's & Joy — ${label} report`

    if (!recipients.length) return new Response(JSON.stringify({ ok: false, error: 'No recipients configured in report_settings' }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
    if (!resendKey) return new Response(JSON.stringify({ ok: false, error: 'RESEND_API_KEY not set' }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

    // ── Send via Resend ──
    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, html }),
    })
    const result = await send.json()
    if (!send.ok) return new Response(JSON.stringify({ ok: false, error: result }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

    return new Response(JSON.stringify({ ok: true, sent_to: recipients, month: label, id: result.id }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
