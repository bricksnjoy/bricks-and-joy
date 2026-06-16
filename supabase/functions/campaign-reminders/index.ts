// Supabase Edge Function: campaign-reminders
// Runs daily (via pg_cron / scheduled trigger). For every campaign whose prep
// window has opened (occasion_date - lead_days <= today) and that hasn't been
// emailed yet this year, it sends a reminder email via EmailJS and stamps
// last_notified_year so it won't fire again until next year.
//
// Deploy:
//   supabase functions deploy campaign-reminders --no-verify-jwt
//   supabase secrets set EMAILJS_SERVICE=service_pt7xkma EMAILJS_TEMPLATE=template_9zgrhkb EMAILJS_PUBLIC_KEY=kLZVT1yzwlXV3hua6
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
const EMAILJS_SERVICE = Deno.env.get('EMAILJS_SERVICE') ?? 'service_pt7xkma'
const EMAILJS_TEMPLATE = Deno.env.get('EMAILJS_TEMPLATE') ?? 'template_9zgrhkb'
const EMAILJS_PUBLIC_KEY = Deno.env.get('EMAILJS_PUBLIC_KEY') ?? 'kLZVT1yzwlXV3hua6'
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

async function sendEmail(to: string, subject: string, message: string) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE,
      template_id: EMAILJS_TEMPLATE,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: { to_email: to, subject, message, reply_to: BNJ_EMAIL, name: "Brick's & Joy", email: BNJ_EMAIL },
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
    const daysUntil = daysBetween(today, occ)
    const prepOpen = daysUntil <= (camp.lead_days ?? 90)
    if (prepOpen && camp.last_notified_year !== occ.getFullYear()) {
      try {
        await sendEmail(camp.notify_email, `⏰ Time to prep for ${camp.name}!`, body(camp, occ, daysUntil))
        await supabase.from('campaigns').update({ last_notified_year: occ.getFullYear() }).eq('id', camp.id)
        sent++
      } catch (_) { /* keep going */ }
    }
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'Content-Type': 'application/json' } })
})
