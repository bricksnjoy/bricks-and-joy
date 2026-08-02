// Supabase Edge Function: send-email
//
// The one place the app sends email from. Resend's API key stays here on the
// server, which is the whole point: the browser never sees it, so nobody can
// lift it out of the bundle and send mail on our account — the weakness of
// calling an email service straight from the page.
//
// It also unlocks the two things client-side sending cannot do: attachments
// (an invoice, the supplier order sheet), and being called by a schedule when
// nobody has the back office open.
//
// Configure (Edge Functions → Secrets):
//   RESEND_API_KEY = your Resend API key
//   EMAIL_FROM     = "Brick's & Joy <orders@bricksandjoy.com>"   (optional)
//   EMAIL_REPLY_TO = where replies should land                    (optional)
//
// Deploy:  supabase functions deploy send-email
//   Deploy WITHOUT --no-verify-jwt. Only signed-in staff may send: the caller's
//   token is checked below, so this can never become an open relay.
//
// Body:
//   {
//     to: "a@b.com" | ["a@b.com", ...],     // required
//     subject: "…",                          // required
//     html?: "<p>…</p>",                     // html or text required
//     text?: "…",
//     cc?, bcc?: string | string[],
//     replyTo?: "…",
//     attachments?: [{ filename, content }]  // content = base64, no data: prefix
//   }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
// Resend's shared sandbox sender works before a domain is verified, but only to
// your own address — set EMAIL_FROM once bricksandjoy.com is verified.
const FROM = Deno.env.get('EMAIL_FROM') || "Brick's & Joy <onboarding@resend.dev>"
const REPLY_TO = Deno.env.get('EMAIL_REPLY_TO') || ''

// Keep well inside both the function's request limit and Resend's own ceiling
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v])
    .map(x => String(x ?? '').trim())
    .filter(x => x.includes('@'))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!RESEND_KEY) return json({ ok: false, error: 'not_configured', detail: 'Set the RESEND_API_KEY secret' })

    // Only a signed-in member of staff may send. Supabase's own JWT check also
    // accepts the public anon key, which everyone has — so confirm there is a
    // real user behind this call rather than trusting the token's presence.
    const auth = req.headers.get('Authorization') || ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const sb = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return json({ ok: false, error: 'unauthorized', detail: 'Sign in to send email' }, 401)

    const body = await req.json().catch(() => ({}))
    const to = list(body.to)
    const subject = String(body.subject ?? '').trim()
    const html = body.html ? String(body.html) : ''
    const text = body.text ? String(body.text) : ''

    if (!to.length) return json({ ok: false, error: 'bad_request', detail: 'A valid "to" address is required' })
    if (!subject) return json({ ok: false, error: 'bad_request', detail: '"subject" is required' })
    if (!html && !text) return json({ ok: false, error: 'bad_request', detail: 'Either "html" or "text" is required' })

    const attachments = Array.isArray(body.attachments) ? body.attachments : []
    let attachedBytes = 0
    for (const a of attachments) {
      if (!a?.filename || !a?.content) return json({ ok: false, error: 'bad_request', detail: 'Each attachment needs a filename and base64 content' })
      // base64 is ~4 characters per 3 bytes
      attachedBytes += Math.ceil(String(a.content).length * 3 / 4)
    }
    if (attachedBytes > MAX_ATTACHMENT_BYTES) {
      return json({ ok: false, error: 'too_large', detail: 'Attachments add up to more than 8 MB' })
    }

    const payload: Record<string, unknown> = { from: FROM, to, subject }
    if (html) payload.html = html
    if (text) payload.text = text
    const cc = list(body.cc); if (cc.length) payload.cc = cc
    const bcc = list(body.bcc); if (bcc.length) payload.bcc = bcc
    const replyTo = String(body.replyTo ?? REPLY_TO).trim()
    if (replyTo) payload.reply_to = replyTo
    if (attachments.length) {
      payload.attachments = attachments.map((a: { filename: string; content: string }) => ({
        filename: String(a.filename),
        // Tolerate a full data: URL being passed in by mistake
        content: String(a.content).replace(/^data:[^;]*;base64,/, ''),
      }))
    }

    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const result = await send.json().catch(() => ({}))
    if (!send.ok) return json({ ok: false, error: 'resend_failed', detail: result })

    return json({ ok: true, id: result.id, to })
  } catch (e) {
    return json({ ok: false, error: 'unexpected', detail: String(e) })
  }
})
