// The one place the app sends email from.
//
// Ported straight from the send-email Edge Function. The reason it exists is
// unchanged: the Resend key stays on the server, so nobody can lift it out of
// the JavaScript bundle and send mail on our account. It also does the two
// things a browser cannot — attach an invoice, and send when nobody has the
// back office open.

const RESEND_KEY = () => process.env.RESEND_API_KEY
const FROM = () => process.env.EMAIL_FROM || process.env.REPORT_FROM || "Brick's & Joy <onboarding@resend.dev>"
const REPLY_TO = () => process.env.EMAIL_REPLY_TO || ''

// Comfortably inside Resend's own ceiling.
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

const list = v => (Array.isArray(v) ? v : [v])
  .map(x => String(x ?? '').trim())
  .filter(x => x.includes('@'))

/**
 * @returns {Promise<{ok: boolean, id?: string, to?: string[], error?: string, detail?: any}>}
 */
async function sendEmail(body = {}) {
  const key = RESEND_KEY()
  if (!key) return { ok: false, error: 'not_configured', detail: 'Set RESEND_API_KEY in server/.env' }

  const to = list(body.to)
  const subject = String(body.subject ?? '').trim()
  const html = body.html ? String(body.html) : ''
  const text = body.text ? String(body.text) : ''

  if (!to.length) return { ok: false, error: 'bad_request', detail: 'A valid "to" address is required' }
  if (!subject)   return { ok: false, error: 'bad_request', detail: '"subject" is required' }
  if (!html && !text) return { ok: false, error: 'bad_request', detail: 'Either "html" or "text" is required' }

  const attachments = Array.isArray(body.attachments) ? body.attachments : []
  let attachedBytes = 0
  for (const a of attachments) {
    if (!a?.filename || !a?.content) {
      return { ok: false, error: 'bad_request', detail: 'Each attachment needs a filename and base64 content' }
    }
    attachedBytes += Math.ceil(String(a.content).length * 3 / 4)   // base64 is ~4 chars per 3 bytes
  }
  if (attachedBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'too_large', detail: 'Attachments add up to more than 8 MB' }
  }

  const payload = { from: FROM(), to, subject }
  if (html) payload.html = html
  if (text) payload.text = text
  const cc = list(body.cc);   if (cc.length) payload.cc = cc
  const bcc = list(body.bcc); if (bcc.length) payload.bcc = bcc
  const replyTo = String(body.replyTo ?? REPLY_TO()).trim()
  if (replyTo) payload.reply_to = replyTo
  if (attachments.length) {
    payload.attachments = attachments.map(a => ({
      filename: String(a.filename),
      // Tolerate a whole data: URL being passed in by mistake
      content: String(a.content).replace(/^data:[^;]*;base64,/, ''),
    }))
  }

  let res, result
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    result = await res.json().catch(() => ({}))
  } catch (e) {
    return { ok: false, error: 'resend_unreachable', detail: String(e).slice(0, 300) }
  }

  if (!res.ok) return { ok: false, error: 'resend_failed', detail: result }
  return { ok: true, id: result.id, to }
}

module.exports = { sendEmail }
