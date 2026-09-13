// Where we are willing to send somebody back to.
//
// Two places hand a browser a URL that arrived in the request: the link in a
// password-reset email, and the end of the Google sign-in round trip. Both
// carry something worth stealing — a reset token in one, a live session in the
// other — so a URL that is not ours has to be replaced with one that is.
//
// What was here compared text:
//
//     returnTo.startsWith(siteUrl())
//
// which is not a comparison of sites. "https://bricksandjoy.com.evil.example"
// starts with "https://bricksandjoy.com" and is a different site owned by
// somebody else. So does "https://bricksandjoy.com@evil.example", which a
// browser reads as the username "bricksandjoy.com" at the host evil.example.
// Both passed that check. The reset email would have carried a working token
// to either of them, and the Google callback a working session.
//
// The only reliable way to ask "is this us" is to parse the URL the way a
// browser does and compare the origin — scheme, host and port together.

// The origins that count as this site: whatever PUBLIC_SITE_URL says, plus its
// www/bare sibling, because Caddy treats those as one site and a visitor may
// have started on either.
function allowedOrigins() {
  const site = (process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '')
  const out = new Set()
  if (!site) return out
  try {
    const u = new URL(site)
    out.add(u.origin)
    const bare = u.hostname.replace(/^www\./, '')
    const sibling = new URL(u.toString())
    sibling.hostname = u.hostname.startsWith('www.') ? bare : `www.${bare}`
    out.add(sibling.origin)
  } catch {
    // PUBLIC_SITE_URL is not a URL. Nothing is allowed, and every caller falls
    // back to the path below — a broken local link is a far better failure
    // than a working one pointing at somebody else's server.
  }
  return out
}

/**
 * Return `candidate` if it points at this site, and our own page if it does not.
 *
 * Relative URLs ("/account") are resolved against the site and allowed. Any
 * fragment is dropped, because both callers append their own.
 */
function safeReturnTo(candidate, fallbackPath = '/account') {
  const site = (process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '')
  const fallback = `${site}${fallbackPath}`
  if (!candidate) return fallback

  let url
  try {
    url = new URL(String(candidate), site || undefined)
  } catch {
    return fallback           // not a URL at all, or relative with no site set
  }

  // javascript:, data: and friends never belong in a link we send someone.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback

  url.hash = ''
  return allowedOrigins().has(url.origin) ? url.toString() : fallback
}

module.exports = { safeReturnTo, allowedOrigins }
