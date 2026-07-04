import { supabase } from './supabase'

// Fire-and-forget audit logging. Never blocks or breaks the calling flow —
// if the audit_log table doesn't exist yet the failure is swallowed.
//
// logAudit('create', 'order', 'INV-123 — Bouquet of Roses ×1', { total: 1400 })

let cachedEmail = null
async function userEmail() {
  if (cachedEmail) return cachedEmail
  try {
    const { data } = await supabase.auth.getUser()
    cachedEmail = data?.user?.email || ''
  } catch { cachedEmail = '' }
  return cachedEmail
}

export async function logAudit(action, entity, label, details = null) {
  try {
    const email = await userEmail()
    await supabase.from('audit_log').insert({
      user_email: email,
      action,               // create | update | delete | cancel | return | payment | stock
      entity,               // order | product | purchase_order | customer | vendor | catalog
      entity_label: String(label || '').slice(0, 200),
      details: details || null,
    })
  } catch { /* audit must never break the app */ }
}
