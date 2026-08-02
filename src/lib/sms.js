import { supabase } from './supabase'
import { logMessage } from './messageLog'

// Send an SMS via the Message Owl gateway (through the secure send-sms edge
// function so the API key never lives in the browser). Every attempt is
// recorded, succeeded or failed, so the Message Center can show what went out
// and how many parts were used.
export async function sendSMS(to, message, sender, meta = {}) {
  const record = (ok, error) => logMessage({
    channel: 'sms', recipient: to, body: message, ok, error,
    route: 'messageowl', context: meta.context, recipientName: meta.name,
  })
  let data, error
  try {
    ({ data, error } = await supabase.functions.invoke('send-sms', { body: { to, message, sender } }))
  } catch (e) {
    await record(false, e?.message || String(e))
    throw e
  }
  if (error) {
    let detail = error.message || 'send-sms not reachable'
    try { const b = await error.context?.text?.(); if (b) detail = b.slice(0, 200) } catch { /* noop */ }
    await record(false, detail)
    throw new Error(detail)
  }
  if (data?.error) {
    const detail = data.detail ? `${data.error}: ${data.detail}` : data.error
    await record(false, detail)
    throw new Error(detail)
  }
  await record(true)
  return data
}

// Normalise a Maldives number: strip spaces/symbols; add 960 to bare 7-digit numbers.
export function normalizePhone(raw = '') {
  let d = String(raw).replace(/[^\d]/g, '')
  if (d.length === 7) d = '960' + d
  return d
}
