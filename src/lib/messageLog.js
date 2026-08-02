// A record of every message the shop sends.
//
// Until now a send either showed a toast or it didn't, and once that faded
// there was no way to tell what actually went out — or why a customer never
// got theirs. Each attempt is written here as it happens, successful or not,
// so the Message Center can show the history and the running SMS count.
//
// Logging must never be the reason a message fails, so every write is wrapped:
// if the table doesn't exist yet, sending carries on regardless.

import { supabase } from './supabase'

// An SMS is billed by the part, not the message. Plain GSM-7 text fits 160
// characters in one part (153 each once it splits); a single character outside
// that set — a curly quote, an emoji, ×, — — forces the whole message to
// Unicode, where a part is only 70 characters (67 when split). Getting this
// right is the difference between one part and three.
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
const GSM_EXT = '^{}\\[~]|€'

export function smsParts(message) {
  const text = String(message || '')
  let unicode = false
  let len = 0
  for (const ch of text) {
    if (GSM_EXT.includes(ch)) len += 2          // escaped characters cost two
    else if (GSM.includes(ch)) len += 1
    else { unicode = true; break }
  }
  if (unicode) {
    // Unicode counts UTF-16 units, so an emoji outside the basic plane is two
    len = text.length
    const single = 70, multi = 67
    return { chars: len, unicode: true, segments: len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi) }
  }
  const single = 160, multi = 153
  return { chars: len, unicode: false, segments: len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi) }
}

let cachedUser
async function whoSent() {
  if (cachedUser !== undefined) return cachedUser
  try { cachedUser = (await supabase.auth.getUser())?.data?.user?.email || null } catch { cachedUser = null }
  return cachedUser
}

/**
 * Record one attempt. Never throws.
 * @param {object} o
 * @param {'email'|'sms'} o.channel
 * @param {string} o.recipient
 * @param {string} [o.recipientName]
 * @param {string} [o.subject]
 * @param {string} [o.body]
 * @param {boolean} o.ok
 * @param {string} [o.error]
 * @param {string} [o.route]     which service carried it
 * @param {string} [o.context]   what it was about
 */
export async function logMessage({ channel, recipient, recipientName, subject = '', body = '', ok, error, route, context }) {
  try {
    const parts = channel === 'sms' ? smsParts(body) : { chars: String(body || '').length, segments: 1, unicode: false }
    await supabase.from('message_log').insert({
      channel,
      recipient: String(recipient || '').slice(0, 200),
      recipient_name: recipientName ? String(recipientName).slice(0, 120) : null,
      subject: subject ? String(subject).slice(0, 300) : null,
      preview: String(body || '').slice(0, 300),
      chars: parts.chars,
      segments: parts.segments,
      unicode: parts.unicode,
      ok: !!ok,
      error: error ? String(error).slice(0, 500) : null,
      route: route || null,
      context: context || null,
      sent_by: await whoSent(),
    })
  } catch { /* the log is a convenience — never let it break a send */ }
}
