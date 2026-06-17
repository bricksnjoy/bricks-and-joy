// Supabase Edge Function: send-sms
// Sends an SMS through the Message Owl gateway. Keeps the API key server-side.
//
// Configure (Edge Functions → Secrets):
//   MESSAGEOWL_URL    = the Message Owl "send SMS" endpoint (from their API docs)
//   MESSAGEOWL_API_KEY= your Message Owl API key / token
//   MESSAGEOWL_SENDER = your approved SMS header / sender id (default sender)
//   (optional) MESSAGEOWL_AUTH = "bearer" (default) | "apikey" | "query"
//   (optional) MESSAGEOWL_FIELDS = comma map for body field names, e.g.
//              "to=recipient,message=message,sender=sender"  (defaults shown)
//
// Deploy:  supabase functions deploy send-sms --no-verify-jwt
//
// NOTE: Message Owl's exact endpoint + body field names must be confirmed from
// their docs. The defaults below are configurable via the secrets above so you
// can match their API without editing this file.

const URL_ = Deno.env.get('MESSAGEOWL_URL')
const KEY = Deno.env.get('MESSAGEOWL_API_KEY')
const SENDER = Deno.env.get('MESSAGEOWL_SENDER') ?? ''
const AUTH = (Deno.env.get('MESSAGEOWL_AUTH') ?? 'bearer').toLowerCase()
const FIELDS = Deno.env.get('MESSAGEOWL_FIELDS') ?? 'to=recipient,message=message,sender=sender'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function fieldMap() {
  const m: Record<string, string> = { to: 'recipient', message: 'message', sender: 'sender' }
  FIELDS.split(',').forEach(pair => {
    const [k, v] = pair.split('=').map(s => s.trim())
    if (k && v) m[k] = v
  })
  return m
}

function normalize(raw = '') {
  let d = String(raw).replace(/[^\d]/g, '')
  if (d.length === 7) d = '960' + d
  return d
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!URL_ || !KEY) return json({ error: 'not_configured', detail: 'Set MESSAGEOWL_URL and MESSAGEOWL_API_KEY secrets' })

    const { to, message, sender } = await req.json()
    const recipient = normalize(to)
    if (!recipient || !message) return json({ error: 'bad_request', detail: 'to and message are required' })

    const m = fieldMap()
    const body: Record<string, string> = {
      [m.to]: recipient,
      [m.message]: message,
      [m.sender]: sender || SENDER,
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    let url = URL_
    if (AUTH === 'bearer') headers['Authorization'] = `Bearer ${KEY}`
    else if (AUTH === 'apikey') headers['X-API-Key'] = KEY
    else if (AUTH === 'query') url += (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(KEY)

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) return json({ error: 'gateway_error', detail: text.slice(0, 300) })
    return json({ ok: true, response: text.slice(0, 300) })
  } catch (e) {
    return json({ error: 'failed', detail: String(e).slice(0, 300) })
  }
})
