// Supabase Edge Function: campaign-reminders
// Runs daily (via pg_cron / scheduled trigger). For every campaign whose prep
// window has opened (occasion_date - lead_days <= today) and that hasn't been
// emailed yet this year, it sends a reminder email via EmailJS and stamps
// last_notified_year so it won't fire again until next year.
//
// Deploy:
//   supabase functions deploy campaign-reminders --no-verify-jwt
//   Uses RESEND_API_KEY and REPORT_FROM, already set for the other functions.
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically)
//
// Schedule it to run once a day (Supabase SQL editor):
//   select cron.schedule('campaign-reminders-daily', '0 8 * * *', $$
//     select net.http_post(
//       url := 'https://YOUR-PROJECT-ref.functions.supabase.co/campaign-reminders',
//       headers := '{"Content-Type":"application/json"}'::jsonb
//     );
//   $$);

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('EMAIL_FROM') || Deno.env.get('REPORT_FROM') || "Brick's & Joy <onboarding@resend.dev>"
const BNJ_EMAIL = 'bricknjoy@gmail.com'

function nextOccurrence(dateISO: string, today: Date) {
  const base = new Date(dateISO + 'T00:00:00')
  let d = new Date(today.getFullYear(), base.getMonth(), base.getDate())
  if (d < today) d = new Date(today.getFullYear() + 1, base.getMonth(), base.getDate())
  return d
}
const daysBetween = (a: Date, b: Date) =>
  Math.round((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / 86400000)
const fmt = (d: Date) => d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })

// Sent through Resend, from the verified domain, like everything else the shop
// sends. The reminder body is plain text, so it is wrapped to keep its layout.
async function sendEmail(to: string, subject: string, message: string) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY is not set')
  const esc = (s: string) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject,
      reply_to: BNJ_EMAIL,
      text: message,
      html: `<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;color:#0d1b2a;white-space:pre-wrap">${esc(message)}</div>`,
    }),
  })
  if (!res.ok) throw new Error(await res.text())
}

function body(camp: any, occ: Date, daysUntil: number) {
  const plan = camp.plan || {}
  const items = (plan.stockUpExisting || []).slice(0, 8).map((p: any) => `• ${p.name}${p.inInventory ? '' : ' (not in inventory yet)'}`).join('\n')
  const ideas = (plan.stockUpNew || []).slice(0, 6).map((s: string) => `• ${s}`).join('\n')
  const next = (plan.checklist || []).filter((c: any) => !c.done).slice(0, 5).map((c: any) => `☐ ${c.text}`).join('\n')
  return [
    `${plan.emoji || ''} ${camp.name} is coming up on ${fmt(occ)} — about ${daysUntil} days away.`,
    '', plan.summary || '',
    items ? `\nSTOCK UP ON:\n${items}` : '',
    ideas ? `\nNEW PRODUCTS TO CONSIDER:\n${ideas}` : '',
    next ? `\nNEXT STEPS:\n${next}` : '',
    '', `— Brick's & Joy Planning`,
  ].join('\n')
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const { data: campaigns, error } = await supabase.from('campaigns').select('*')
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  let sent = 0
  for (const camp of campaigns ?? []) {
    if (!camp.occasion_date || !camp.notify_email) continue
    const occ = nextOccurrence(camp.occasion_date, today)
    const year = occ.getFullYear()
    const daysUntil = daysBetween(today, occ)
    const changes: Record<string, number> = {}
    // 1st reminder: prep window opens (~lead days, e.g. 90 days out)
    if (daysUntil <= (camp.lead_days ?? 90) && camp.last_notified_year !== year) {
      try {
        await sendEmail(camp.notify_email, `⏰ Time to prep for ${camp.name}!`, body(camp, occ, daysUntil))
        changes.last_notified_year = year; sent++
      } catch (_) { /* keep going */ }
    }
    // 2nd reminder: final push at 30 days out
    if (daysUntil <= 30 && camp.notified_30_year !== year) {
      try {
        await sendEmail(camp.notify_email, `🔔 ${camp.name} is ${daysUntil} days away — final push!`, body(camp, occ, daysUntil))
        changes.notified_30_year = year; sent++
      } catch (_) { /* keep going */ }
    }
    if (Object.keys(changes).length) await supabase.from('campaigns').update(changes).eq('id', camp.id)
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'Content-Type': 'application/json' } })
})
