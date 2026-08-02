// Sending email from the app.
//
// Mail goes through the `send-email` Edge Function, which holds the Resend key
// server-side. That gets us attachments and a proper sender address, and keeps
// the key out of the browser bundle.
//
// If the function isn't deployed yet — or Resend has not been configured — it
// falls back to the old EmailJS path so the Message Center keeps working rather
// than failing in front of whoever pressed send. `lastRoute` records which one
// carried the message, so the UI can be honest about it.

import { supabase } from './supabase'
import { sendEmailJS, BNJ_EMAIL } from './email'
import { logMessage } from './messageLog'

export const ROUTE_RESEND = 'resend'
export const ROUTE_EMAILJS = 'emailjs'

let lastRoute = null
export const getLastRoute = () => lastRoute

// Remembered so a broadcast of fifty messages doesn't retry a missing function
// fifty times. Reset when the page reloads.
let edgeAvailable = null

const looksMissing = err => {
  const s = String(err?.message || err || '').toLowerCase()
  return s.includes('not found') || s.includes('404') || s.includes('failed to fetch') || s.includes('failed to send a request')
}

// Turn a Blob/File/Uint8Array into the base64 the function expects.
export async function toAttachment(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data])
  const b64 = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]*;base64,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
  return { filename, content: b64 }
}

// Plain text → simple HTML, so a message typed in the composer arrives with its
// line breaks intact instead of collapsing into one paragraph.
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
export const textToHtml = body =>
  `<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;color:#0d1b2a;white-space:pre-wrap">${esc(body)}</div>`

/**
 * Send one email.
 * @param {object} o
 * @param {string|string[]} o.to
 * @param {string} o.subject
 * @param {string} [o.text]         plain body (also used for the EmailJS fallback)
 * @param {string} [o.html]         defaults to `text` wrapped in simple markup
 * @param {Array}  [o.attachments]  from toAttachment(); Resend route only
 * @param {string} [o.replyTo]
 * @returns {Promise<{route: string, id?: string}>}
 */
export async function sendEmail({ to, subject, text = '', html, attachments = [], replyTo = BNJ_EMAIL, meta = {} }) {
  const body = html || textToHtml(text)
  const record = (ok, route, error) => logMessage({
    channel: 'email', recipient: Array.isArray(to) ? to.join(', ') : to,
    recipientName: meta.name, subject, body: text || subject, ok, error, route, context: meta.context,
  })

  if (edgeAvailable !== false) {
    try {
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: { to, subject, html: body, text: text || undefined, attachments, replyTo },
      })
      if (error) throw error
      if (data?.ok) {
        edgeAvailable = true; lastRoute = ROUTE_RESEND
        await record(true, ROUTE_RESEND)
        return { route: ROUTE_RESEND, id: data.id }
      }
      // The function answered but refused. A missing key or an unverified sender
      // is worth falling back on; a rejected address is not — that would fail the
      // same way twice.
      if (data?.error === 'not_configured') edgeAvailable = false
      else if (data?.error === 'bad_request' || data?.error === 'too_large' || data?.error === 'unauthorized') {
        await record(false, ROUTE_RESEND, data.detail || data.error)
        throw new Error(data.detail || data.error)
      }
    } catch (e) {
      if (looksMissing(e)) edgeAvailable = false
      else if (!attachments.length) { /* fall through and try the old route */ }
      else { await record(false, ROUTE_RESEND, e?.message || String(e)); throw e }  // attachments need Resend
    }
  }

  if (attachments.length) {
    const why = 'Attachments need the send-email function deployed'
    await record(false, ROUTE_RESEND, why)
    throw new Error(why)
  }
  try {
    await sendEmailJS(Array.isArray(to) ? to[0] : to, subject, text || body, replyTo)
  } catch (e) {
    await record(false, ROUTE_EMAILJS, e?.message || String(e))
    throw e
  }
  lastRoute = ROUTE_EMAILJS
  await record(true, ROUTE_EMAILJS)
  return { route: ROUTE_EMAILJS }
}
