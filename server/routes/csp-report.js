// Where the browser says what the security policy would have blocked.
//
// The Content-Security-Policy in deploy/Caddyfile is set in Report-Only mode:
// the browser works out what the policy would stop, lets it through anyway, and
// posts a note here. That is the whole point of the exercise — a policy written
// blind will always miss something the site genuinely needs, and finding that
// out from a customer whose checkout went blank is the wrong way round.
//
// Read what has arrived with:
//
//   journalctl -u bricksandjoy -f | grep csp
//
// An empty log after a few days of normal use is the signal that the policy can
// be switched from Report-Only to enforcing. Anything that shows up is either
// something to allow or something to fix first.
//
// This whole file is temporary. Once the policy is enforced there is nothing
// left to collect, and it goes.

const express = require('express')
const rateLimit = require('express-rate-limit')

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

router.post('/', limit, parse, (req, res) => {
  // Answer first. A browser does not care what we say, and nothing here should
  // ever be able to hold up a page.
  res.status(204).end()

  for (const r of normalise(req.body)) {
    const directive = r['effective-directive'] || r['violated-directive'] || r.effectiveDirective || ''
    const blocked = r['blocked-uri'] || r.blockedURL || ''
    const doc = r['document-uri'] || r.documentURL || '?'
    // Neither field means this was not a violation report — an empty body, or
    // somebody poking the endpoint. Logging it would only be noise.
    if (!directive && !blocked) continue
    const key = `${directive || '?'} ${blocked || '?'}`
    if (!shouldLog(key)) continue
    const n = seen.get(key)?.count || 1
    console.log(`[csp] would block ${directive || '?'} <- ${blocked || '?'}  (on ${doc})${n > 1 ? ` ×${n}` : ''}`)
  }
})

// Anything but a POST here is somebody looking around.
router.use((_req, res) => res.status(405).end())

module.exports = router
