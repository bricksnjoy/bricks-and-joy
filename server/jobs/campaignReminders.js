// Seasonal campaign reminders.
//
// Ported from the campaign-reminders Edge Function. Runs once a day (see
// cron.js). For every campaign whose prep window has opened it emails a
// reminder and stamps the year, so it cannot fire twice for the same occasion.

const db = require('../db')
const { sendEmail } = require('../lib/mail')

const BNJ_EMAIL = process.env.EMAIL_REPLY_TO || 'bricknjoy@gmail.com'

function nextOccurrence(dateISO, today) {
  const base = new Date(String(dateISO).slice(0, 10) + 'T00:00:00')
  let d = new Date(today.getFullYear(), base.getMonth(), base.getDate())
  if (d < today) d = new Date(today.getFullYear() + 1, base.getMonth(), base.getDate())
  return d
}

const daysBetween = (a, b) =>
  Math.round((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / 86_400_000)

const fmt = d => d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

function reminderBody(camp, occ, daysUntil) {
  const plan = camp.plan || {}
  const items = (plan.stockUpExisting || []).slice(0, 8)
    .map(p => `• ${p.name}${p.inInventory ? '' : ' (not in inventory yet)'}`).join('\n')
  const ideas = (plan.stockUpNew || []).slice(0, 6).map(s => `• ${s}`).join('\n')
  const next = (plan.checklist || []).filter(c => !c.done).slice(0, 5).map(c => `☐ ${c.text}`).join('\n')
  return [
    `${plan.emoji || ''} ${camp.name} is coming up on ${fmt(occ)} — about ${daysUntil} days away.`,
    '', plan.summary || '',
    items ? `\nSTOCK UP ON:\n${items}` : '',
    ideas ? `\nNEW PRODUCTS TO CONSIDER:\n${ideas}` : '',
    next ? `\nNEXT STEPS:\n${next}` : '',
    '', `— Brick's & Joy Planning`,
  ].join('\n')
}

const asPlainText = message => ({
  text: message,
  html: `<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;color:#0d1b2a;white-space:pre-wrap">${esc(message)}</div>`,
})

async function runCampaignReminders() {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const { rows: campaigns } = await db.query('select * from campaigns')

  let sent = 0
  for (const camp of campaigns) {
    if (!camp.occasion_date || !camp.notify_email) continue

    const occ = nextOccurrence(camp.occasion_date, today)
    const year = occ.getFullYear()
    const daysUntil = daysBetween(today, occ)
    const changes = {}

    // First reminder: the prep window opens, usually 90 days out.
    if (daysUntil <= (camp.lead_days ?? 90) && camp.last_notified_year !== year) {
      const out = await sendEmail({
        to: camp.notify_email,
        subject: `⏰ Time to prep for ${camp.name}!`,
        replyTo: BNJ_EMAIL,
        ...asPlainText(reminderBody(camp, occ, daysUntil)),
      })
      if (out.ok) { changes.last_notified_year = year; sent++ }
    }

    // Second reminder: the final push, 30 days out.
    if (daysUntil <= 30 && camp.notified_30_year !== year) {
      const out = await sendEmail({
        to: camp.notify_email,
        subject: `🔔 ${camp.name} is ${daysUntil} days away — final push!`,
        replyTo: BNJ_EMAIL,
        ...asPlainText(reminderBody(camp, occ, daysUntil)),
      })
      if (out.ok) { changes.notified_30_year = year; sent++ }
    }

    const keys = Object.keys(changes)
    if (keys.length) {
      const sets = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
      await db.query(`update campaigns set ${sets} where id = $${keys.length + 1}`,
        [...keys.map(k => changes[k]), camp.id])
    }
  }

  return { ok: true, sent }
}

module.exports = { runCampaignReminders }
