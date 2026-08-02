// The emails a customer gets about their own order.
//
// Three moments, each tied to something already done in Orders: the order is
// written down, the payment is recorded, the parcel goes out. Nothing here
// fires on its own — each is a switch in Settings → Notifications, and all
// three start off, so no customer is emailed until the wording has been read
// and the switch turned on.
//
// A missing email address is not a failure. Most orders arrive through
// Instagram and never carry one; those simply skip.

import { sendEmail } from './emailer'
import { getSettings } from './settings'

export const ORDER_EMAILS = [
  { key: 'emailOrderConfirmation', label: 'Order confirmation', hint: 'When an order is first written down' },
  { key: 'emailPaymentReceived', label: 'Payment received', hint: 'When a payment is recorded against an order' },
  { key: 'emailDispatched', label: 'Dispatched', hint: 'When an order is marked dispatched' },
]

const LOGO = 'https://bricksandjoy.com/logo-full.png'
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const amount = (n, cur) => `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// What each kind says at the top. Kept warm but short — the detail is the table.
const COPY = {
  confirmation: {
    subject: o => `Order confirmed${o.invoice_number ? ' · ' + o.invoice_number : ''}`,
    heading: 'Thank you for your order',
    line: 'We have it written down and will let you know as soon as it is on its way.',
    tone: '#FFA500',
  },
  payment: {
    subject: o => `Payment received${o.invoice_number ? ' · ' + o.invoice_number : ''}`,
    heading: 'Payment received',
    line: 'Thank you — your payment has been recorded against this order.',
    tone: '#1D9E75',
  },
  dispatched: {
    subject: o => `On its way${o.invoice_number ? ' · ' + o.invoice_number : ''}`,
    heading: 'Your order is on its way',
    line: 'It has left us and is heading to you.',
    tone: '#378ADD',
  },
}

// One order's worth of lines, its totals, and whatever is known about delivery.
function buildHtml(kind, { order, items, shopName, currency }) {
  const c = COPY[kind]
  const rows = (items && items.length ? items : [order])
  const total = rows.reduce((s, r) => s + Number(r.total_price || 0), 0)
  const paid = (order.payment_status || 'unpaid').toLowerCase()
  const paidLabel = paid === 'paid' ? 'Paid' : paid === 'partial' ? 'Part-paid' : 'Not yet paid'

  const itemRows = rows.map(r => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f2f2f2;color:#0d1b2a;font-size:14px">
        ${esc(r.product_name)}${Number(r.qty) > 1 ? `<span style="color:#aaa"> × ${Number(r.qty)}</span>` : ''}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #f2f2f2;text-align:right;color:#0d1b2a;font-size:14px;white-space:nowrap">
        ${esc(amount(r.total_price, currency))}
      </td>
    </tr>`).join('')

  const detail = []
  if (order.order_date) detail.push(['Order date', order.order_date])
  if (order.invoice_number) detail.push(['Invoice', order.invoice_number])
  detail.push(['Payment', paidLabel])
  if (kind === 'dispatched') {
    if (order.fulfilment === 'pickup') detail.push(['Collection', 'Ready for pickup'])
    else if (order.delivery_person) detail.push(['Delivered by', order.delivery_person])
    if (order.delivery_date) detail.push(['Expected', order.delivery_date])
  }
  const detailRows = detail.map(([k, v]) => `
    <tr>
      <td style="padding:3px 0;color:#999;font-size:13px">${esc(k)}</td>
      <td style="padding:3px 0;text-align:right;color:#0d1b2a;font-size:13px;font-weight:600">${esc(v)}</td>
    </tr>`).join('')

  const firstName = String(order.customer_name || '').trim().split(/\s+/)[0]
  // The charset has to be declared: without it some clients fall back to
  // Latin-1 and the × and · come out as mojibake.
  return `<!doctype html><html><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:0;background:#f6f5f2">
  <div style="max-width:560px;margin:0 auto;padding:28px 18px;font-family:-apple-system,'Segoe UI',Arial,sans-serif">
    <div style="text-align:center;margin-bottom:22px">
      <img src="${LOGO}" alt="${esc(shopName)}" width="150" style="width:150px;max-width:60%;height:auto" />
    </div>
    <div style="background:#fff;border-radius:14px;padding:26px 24px;border:1px solid #ececec">
      <div style="height:4px;width:44px;background:${c.tone};border-radius:99px;margin-bottom:16px"></div>
      <h1 style="margin:0 0 10px;font-size:19px;color:#0d1b2a">${esc(c.heading)}</h1>
      ${firstName ? `<p style="margin:0 0 6px;font-size:14px;color:#0d1b2a">Hi ${esc(firstName)},</p>` : ''}
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#666">${esc(c.line)}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:6px">${itemRows}</table>
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
        <tr>
          <td style="padding:12px 0 0;font-size:15px;font-weight:800;color:#0d1b2a">Total</td>
          <td style="padding:12px 0 0;text-align:right;font-size:16px;font-weight:800;color:#0d1b2a;white-space:nowrap">${esc(amount(total, currency))}</td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;background:#faf9f6;border-radius:9px;padding:4px">
        ${detailRows}
      </table>
    </div>
    <p style="text-align:center;font-size:12px;color:#aaa;line-height:1.7;margin:20px 0 0">
      Questions? Just reply to this email.<br/>${esc(shopName)} · Maldives
    </p>
  </div></body></html>`
}

// Plain-text twin, for clients that refuse HTML.
function buildText(kind, { order, items, shopName, currency }) {
  const c = COPY[kind]
  const rows = (items && items.length ? items : [order])
  const total = rows.reduce((s, r) => s + Number(r.total_price || 0), 0)
  const firstName = String(order.customer_name || '').trim().split(/\s+/)[0]
  return [
    c.heading,
    '',
    firstName ? `Hi ${firstName},` : '',
    c.line,
    '',
    ...rows.map(r => `- ${r.product_name}${Number(r.qty) > 1 ? ` x${Number(r.qty)}` : ''}  ${amount(r.total_price, currency)}`),
    '',
    `Total: ${amount(total, currency)}`,
    order.invoice_number ? `Invoice: ${order.invoice_number}` : '',
    '',
    `Questions? Just reply to this email.`,
    shopName,
  ].filter(Boolean).join('\n')
}

/**
 * Send one order email, if it is switched on and there is somewhere to send it.
 * Never throws — a customer email failing must not lose the order that
 * triggered it.
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function sendOrderEmail(kind, { order, items = [], to } = {}) {
  try {
    const s = getSettings()
    const key = { confirmation: 'emailOrderConfirmation', payment: 'emailPaymentReceived', dispatched: 'emailDispatched' }[kind]
    if (!key || !s[key]) return { sent: false, reason: 'off' }

    const address = (to || order?.customer_email || '').trim()
    if (!address || !address.includes('@')) return { sent: false, reason: 'no-email' }

    const ctx = {
      order,
      items,
      shopName: s.businessName || "Brick's & Joy",
      currency: s.currency || 'MVR',
    }
    await sendEmail({
      to: address,
      subject: COPY[kind].subject(order),
      html: buildHtml(kind, ctx),
      text: buildText(kind, ctx),
    })
    return { sent: true }
  } catch (e) {
    return { sent: false, reason: e?.message || String(e) }
  }
}
