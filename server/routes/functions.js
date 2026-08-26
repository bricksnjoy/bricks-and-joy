// What used to be Supabase Edge Functions.
//
// The front end still calls supabase.functions.invoke('send-sms', …); the shim
// posts here instead. The bodies and the replies are unchanged, so no calling
// page needed touching — including the habit of returning failures as HTTP 200
// with an `error` field, which the app reads to explain what went wrong.
//
// All four are staff-only. They spend real money — SMS credits, AI tokens,
// email quota — so an open one would be somebody else's bill.

const express = require('express')
const rateLimit = require('express-rate-limit')
const { requireStaff } = require('../auth')
const { sendSms } = require('../lib/sms')
const { sendEmail } = require('../lib/mail')
const { generateCampaignPlan } = require('../lib/campaignAi')
const { runMonthlyReport } = require('../jobs/monthlyReport')

const router = express.Router()

// Generous for a shop this size, but a runaway loop cannot empty the SMS
// account before anyone notices.
const spendLimit = rateLimit({
  windowMs: 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'rate_limited', detail: 'Too many requests in a minute — slow down' },
})

router.use(requireStaff, spendLimit)

router.post('/send-sms', async (req, res) => {
  res.json(await sendSms(req.body || {}))
})

router.post('/send-email', async (req, res) => {
  res.json(await sendEmail(req.body || {}))
})

router.post('/campaign-ai', async (req, res) => {
  res.json(await generateCampaignPlan(req.body || {}))
})

router.post('/monthly-report', async (req, res) => {
  try {
    res.json(await runMonthlyReport(req.body || {}))
  } catch (e) {
    res.json({ ok: false, error: String(e).slice(0, 300) })
  }
})

module.exports = router
