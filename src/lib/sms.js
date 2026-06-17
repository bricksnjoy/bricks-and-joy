import { supabase } from './supabase'

// Send an SMS via the Message Owl gateway (through the secure send-sms edge
// function so the API key never lives in the browser).
export async function sendSMS(to, message, sender) {
  const { data, error } = await supabase.functions.invoke('send-sms', { body: { to, message, sender } })
  if (error) {
    let detail = error.message || 'send-sms not reachable'
    try { const b = await error.context?.text?.(); if (b) detail = b.slice(0, 200) } catch { /* noop */ }
    throw new Error(detail)
  }
  if (data?.error) throw new Error(data.detail ? `${data.error}: ${data.detail}` : data.error)
  return data
}

// Normalise a Maldives number: strip spaces/symbols; add 960 to bare 7-digit numbers.
export function normalizePhone(raw = '') {
  let d = String(raw).replace(/[^\d]/g, '')
  if (d.length === 7) d = '960' + d
  return d
}
