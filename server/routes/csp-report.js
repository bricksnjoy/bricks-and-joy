// Where the browser says what the security policy blocked.
//
// The Content-Security-Policy in deploy/Caddyfile is in Report-Only mode, so
// what arrives here is a warning about what the policy *would* have stopped,
// not something that was actually blocked. It has already earned its keep
// twice: it found the back office loading thirty product photographs straight
// from lego.com — which no amount of reading the code would have shown, because
// the URLs were in the data rather than in the source — and it caught a stale
// browser tab still running a version of the site from before the inline print
// scripts were taken out.
//
// What arrives is saved to the security_reports table and shown on the Security
// page in the back office, with a count in the header so somebody actually sees
// it. It is also written to the journal, which is the quicker way to watch
// while a change is going out:
//
//   journalctl -u bricksandjoy -f | grep csp
//
// A report now means one of two things, and they need telling apart: either an
// attack was stopped, which is the policy working, or the shop has grown a
// legitimate need the policy does not know about yet — a new payment provider,
// an embedded map — and somebody is looking at a page with a piece missing. The
// second kind is a one-line change in the Caddyfile; it is not a reason to turn
// the policy off.

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

// Something short and printable, or nothing at all. An empty string in the
// table reads as "we know it was blank"; null reads as "the browser did not
// say", which is the truth.
const text = (v, cap = 200) => {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, cap) : null
}

const int = v => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}

// One row per distinct problem. A repeat bumps the count and the time rather
// than adding a row — see the unique index in db/schema.sql. A violation that
// was already marked as dealt with comes back unacknowledged, because it
// happening again means it was not dealt with.
//
// The sample and its source are overwritten by the most recent report, so a
// rule that keeps tripping shows what tripped it *last* rather than what tripped
// it first — which is the one somebody can still go and look at.
async function record(directive, blocked, doc, sample, sourceFile, line) {
  await db.query(
    `insert into security_reports (directive, blocked_uri, document_uri, sample, source_file, line_number)
          values ($1, $2, $3, $4, $5, $6)
     on conflict (directive, blocked_uri) do update
            set hits = security_reports.hits + 1,
                last_seen = now(),
                document_uri = excluded.document_uri,
                sample = coalesce(excluded.sample, security_reports.sample),
                source_file = coalesce(excluded.source_file, security_reports.source_file),
                line_number = coalesce(excluded.line_number, security_reports.line_number),
                acknowledged = false,
                acknowledged_by = null,
                acknowledged_at = null`,
    [directive, blocked, doc, sample, sourceFile, line],
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

    // What actually tried to run, and where it came from. "inline" on its own
    // says a rule was tripped and nothing about by what; these three say which
    // script, in which file, on which line. Browsers only fill them in for the
    // violations where they mean something — an inline script or a piece of
    // eval — and cap the sample at around forty characters on purpose, so a
    // page cannot leak its own secrets through its violation reports.
    // pageOf, not originOf: which *file* is the whole point here, where for a
    // blocked URL the origin was enough.
    const sample = text(r['script-sample'] || r.sample, 200)
    const sourceFile = text(pageOf(r['source-file'] || r.sourceFile), 300)
    const line = int(r['line-number'] ?? r.lineNumber)

    try {
      await record(directive, blocked, doc, sample, sourceFile, line)
    } catch (e) {
      console.error('[csp] could not save report:', e.message)
    }

    const key = `${directive} ${blocked}`
    if (!shouldLog(key)) continue
    const n = seen.get(key)?.count || 1
    const where = sourceFile ? `  from ${sourceFile}${line ? ':' + line : ''}` : ''
    const what = sample ? `  «${sample.slice(0, 60)}»` : ''
    console.log(`[csp] would block ${directive} <- ${blocked}  (on ${doc})${n > 1 ? ` ×${n}` : ''}${where}${what}`)
  }
})

// Anything but a POST here is somebody looking around.
router.use((_req, res) => res.status(405).end())

module.exports = router
