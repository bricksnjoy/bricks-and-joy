// SMS through the Message Owl gateway. Ported from the send-sms Edge Function,
// keeping the API key server-side and keeping every field name configurable —
// the gateway's exact body shape is set by environment variables rather than
// hard-coded, so matching their docs never means editing this file.

const cfg = () => ({
  url:    process.env.MESSAGEOWL_URL,
  key:    process.env.MESSAGEOWL_API_KEY,
  sender: process.env.MESSAGEOWL_SENDER || '',
  auth:   (process.env.MESSAGEOWL_AUTH || 'bearer').toLowerCase(),
  fields: process.env.MESSAGEOWL_FIELDS || 'to=recipients,message=body,sender=sender_id',
})

function fieldMap(fields) {
  const m = { to: 'recipient', message: 'message', sender: 'sender' }
  fields.split(',').forEach(pair => {
    const [k, v] = pair.split('=').map(s => s.trim())
    if (k && v) m[k] = v
  })
  return m
}

// Maldivian numbers are seven digits; the gateway wants the country code.
function normalize(raw = '') {
  let d = String(raw).replace(/[^\d]/g, '')
  if (d.length === 7) d = '960' + d
  return d
}

async function sendSms({ to, message, sender } = {}) {
  const { url: base, key, sender: defaultSender, auth, fields } = cfg()
  if (!base || !key) {
    return { error: 'not_configured', detail: 'Set MESSAGEOWL_URL and MESSAGEOWL_API_KEY in server/.env' }
  }

  const recipient = normalize(to)
  if (!recipient || !message) return { error: 'bad_request', detail: 'to and message are required' }

  const m = fieldMap(fields)
  const body = {
    [m.to]: recipient,
    [m.message]: message,
    [m.sender]: sender || defaultSender,
  }

  const headers = { 'content-type': 'application/json' }
  let url = base
  if (auth === 'bearer') headers.Authorization = `Bearer ${key}`
  else if (auth === 'apikey') headers['X-API-Key'] = key
  else if (auth === 'query') url += (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(key)

  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) return { error: 'gateway_error', detail: text.slice(0, 300) }
    return { ok: true, response: text.slice(0, 300) }
  } catch (e) {
    return { error: 'failed', detail: String(e).slice(0, 300) }
  }
}

module.exports = { sendSms, normalize }
