// The scheduled work, which used to be pg_cron calling Edge Functions over
// HTTP. Now it is just this process, on a timer, calling the same code.
//
// Times are in the shop's own timezone (TZ in server/.env, default Indian/Maldives)
// so "8am" means eight in the morning in Malé, not in UTC.

const cron = require('node-cron')
const { runCampaignReminders } = require('./jobs/campaignReminders')
const { runMonthlyReport } = require('./jobs/monthlyReport')
const db = require('./db')

const TZ = process.env.TZ || 'Indian/Maldives'

async function safely(name, fn) {
  const started = Date.now()
  try {
    const out = await fn()
    console.log(`[cron] ${name} finished in ${Date.now() - started}ms:`, JSON.stringify(out))
  } catch (e) {
    console.error(`[cron] ${name} failed:`, e.message)
  }
}

function start() {
  if (process.env.CRON_ENABLED === 'false') {
    console.log('[cron] disabled by CRON_ENABLED=false')
    return
  }

  // Campaign reminders, every morning at 8.
  cron.schedule(process.env.CRON_CAMPAIGN_REMINDERS || '0 8 * * *',
    () => safely('campaign-reminders', runCampaignReminders), { timezone: TZ })

  // Monthly report, 7am on the 1st, covering the month that just ended.
  cron.schedule(process.env.CRON_MONTHLY_REPORT || '0 7 1 * *',
    () => safely('monthly-report', () => runMonthlyReport({})), { timezone: TZ })

  // Housekeeping: expired sessions and used reset tokens pile up forever
  // otherwise. 3am, when nobody is working.
  cron.schedule('0 3 * * *', () => safely('cleanup', async () => {
    const s = await db.query('delete from auth_sessions where expires_at < now()')
    const r = await db.query("delete from password_resets where expires_at < now() - interval '7 days'")
    return { sessions: s.rowCount, resets: r.rowCount }
  }), { timezone: TZ })

  console.log(`[cron] scheduled (timezone ${TZ})`)
}

module.exports = { start }
