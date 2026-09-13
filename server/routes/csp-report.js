// Where the browser says what the security policy would have blocked.
//
// The Content-Security-Policy in deploy/Caddyfile is set in Report-Only mode:
// the browser works out what the policy would stop, lets it through anyway, and
// posts a note here. That is the whole point of the exercise — a policy written
// blind will always miss something the site genuinely needs, and finding that
// out from a customer whose checkout went blank is the wrong way round.
//
// What arrives is saved to the security_reports table and shown on the Security
// page in the back office, with a count in the header so somebody actually sees
// it. It is also written to the journal, which is the quicker way to watch
// while a change is going out:
//
//   journalctl -u bricksandjoy -f | grep csp
//
// An empty list after a few days of normal use is the signal that the policy
// can be switched from Report-Only to enforcing. Anything that shows up is
// either something to allow or something to fix first.

const express = require('express')
const rateLimit = require('express-rate-limit')
const db = require('../db')

const router = express.Router()

// Reports come from browsers, so this endpoint is open to the internet and will
// be found. Two things keep it harmless: a small body limit, and a ceiling on
// how often one address can post.
const limit = rateLimit({
  windowMs: 60 * 1000, max: 30,
  standardHeaders: false, legacyHeaders: false,
  message: {},
})

// A page that trips the policy trips it on every single load. Without this the
// journal would be one line repeated ten thousand times and nothing else, so
// each distinct violation is logged once and then counted quietly for an hour.
const HOUR = 60 * 60 * 1000
const seen = new Map()   // "directive blocked-uri" -> { count, first }

function shouldLog(key) {
  const now = Date.now()
  const hit = seen.get(key)
  if (!hit || now - hit.first > HOUR) {
    seen.set(key, { count: 1, first: now })
    return true
  }
  hit.count++
  // A round number now and then is enough to show it is still happening.
  return hit.count === 10 || hit.count === 100 || hit.count % 1000 === 0
}

// Browsers use two different formats and two different content types for this,
// depending on age: the older report-uri posts one application/csp-report, the
// newer Reporting API posts an array as application/reports+json.
const parse = express.json({
  type: ['application/csp-report', 'application/reports+json', 'application/json'],
  limit: '16kb',
})

const normalise = body => {
  if (Array.isArray(body)) return body.map(r => r?.body || r).filter(Boolean)
  if (body?.['csp-report']) return [body['csp-report']]
  return body ? [body] : []
}

// Keep only the origin of whatever was blocked — https://fonts.gstatic.com
// rather than the address of one particular font file. A single missing rule
// otherwise reports a different URL for every file it covers, and the table
// fills with a hundred rows that all mean one thing. Words like 'inline' and
// 'eval' are not URLs and are kept as they are.
const originOf = (u, cap = 200) => {
  const s = String(u || '').trim()
  if (!/^https?:/i.test(s)) return s.slice(0, cap)
  try { return new URL(s).origin } catch { return s.slice(0, cap) }
}

// The page it happened on, without the query string: /backoffice/orders is
// worth knowing, the order id in the address is not.
const pageOf = u => {
  const s = String(u || '').trim()
  try { const p = new URL(s); return p.origin + p.pathname } catch { return s.slice(0, 200) }
}

// One row per distinct problem. A repeat bumps the count and the time rather
// than adding a row — see the unique index in db/schema.sql. A violation that
// was already marked as dealt with comes back unacknowledged, because it
// happening again means it was not dealt with.
async function record(directive, blocked, doc) {
  await db.query(
    `insert into security_reports (directive, blocked_uri, document_uri)
          values ($1, $2, $3)
     on conflict (directive, blocked_uri) do update
            set hits = security_reports.hits + 1,
                last_seen = now(),
                document_uri = excluded.document_uri,
                acknowledged = false,
                acknowledged_by = null,
                acknowledged_at = null`,
    [directive, blocked, doc],
  )
}

router.post('/', limit, parse, async (req, res) => {
  // Answer first. A browser does not care what we say, and nothing below —
  // not a slow database, not a mistake in this file — should ever be able to
  // hold up somebody's page.
  res.status(204).end()

  for (const r of normalise(req.body)) {
    const rawDirective = r['effective-directive'] || r['violated-directive'] || r.effectiveDirective || ''
    const rawBlocked = r['blocked-uri'] || r.blockedURL || ''
    // Neither field means this was not a violation report — an empty body, or
    // somebody poking the endpoint. Recording it would only be noise.
    if (!rawDirective && !rawBlocked) continue

    // A violated-directive can arrive as the whole rule ("script-src 'self'").
    // The first word is the part that names it.
    const directive = String(rawDirective).split(/\s+/)[0].slice(0, 60) || 'unknown'
    const blocked = originOf(rawBlocked) || 'unknown'
    const doc = pageOf(r['document-uri'] || r.documentURL)

    try {
      await record(directive, blocked, doc)
    } catch (e) {
      console.error('[csp] could not save report:', e.message)
    }

    const key = `${directive} ${blocked}`
    if (!shouldLog(key)) continue
    const n = seen.get(key)?.count || 1
    console.log(`[csp] would block ${directive} <- ${blocked}  (on ${doc})${n > 1 ? ` ×${n}` : ''}`)
  }
})

// Anything but a POST here is somebody looking around.
router.use((_req, res) => res.status(405).end())

module.exports = router
