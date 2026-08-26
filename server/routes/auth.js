// Sign in, sign up, sign out, refresh, forgot-password, and Google.
//
// The responses copy supabase-js closely — { data: { user, session }, error } —
// because the front end reads them directly.

const express = require('express')
const rateLimit = require('express-rate-limit')
const crypto = require('crypto')
const auth = require('../auth')
const db = require('../db')
const { sendEmail } = require('../lib/mail')

const router = express.Router()

// Guessing a password should be slow and boring.
const tight = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { data: null, error: { message: 'Too many attempts — wait a few minutes and try again' } },
})

const ok = (res, body) => res.json({ data: body, error: null })
const no = (res, status, message) => res.status(status).json({ data: { user: null, session: null }, error: { message, status } })

const siteUrl = () => (process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, '')

// ── password sign-in ────────────────────────────────────────────────────────
router.post('/signin', tight, async (req, res) => {
  const { email, password } = req.body || {}
  const user = await auth.findUserByEmail(email)

  // Same answer either way: which of the two was wrong is not the caller's
  // business, and telling them turns a login form into an account-checker.
  if (!user || !(await auth.verifyPassword(user, password))) {
    return no(res, 400, 'Invalid login credentials')
  }

  const session = await auth.createSession(user, req.get('user-agent'))
  return ok(res, { user: session.user, session })
})

// ── shop sign-up ────────────────────────────────────────────────────────────
// Always creates a customer. Staff accounts are made on the server with
// `npm run create-staff`; there is no path to one through the API.
router.post('/signup', tight, async (req, res) => {
  const { email, password, data } = req.body || {}

  const existing = await auth.findUserByEmail(email)
  if (existing) return no(res, 400, 'An account with that email already exists')

  let user
  try {
    user = await auth.createUser({
      email,
      password,
      fullName: data?.full_name || null,
      role: 'customer',
      metadata: data || {},
    })
  } catch (e) {
    return no(res, 400, e.message)
  }

  const session = await auth.createSession(user, req.get('user-agent'))
  return ok(res, { user: session.user, session })
})

// ── keeping a session alive ─────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const token = req.body?.refresh_token
  if (!token) return no(res, 400, 'No refresh token')
  const session = await auth.refreshSession(token, req.get('user-agent'))
  if (!session) return no(res, 401, 'Session expired')
  return ok(res, { user: session.user, session })
})

router.post('/signout', async (req, res) => {
  const token = req.body?.refresh_token
  if (token) await auth.endSession(token)
  return ok(res, {})
})

router.get('/user', async (req, res) => {
  if (!req.auth.userId) return res.json({ data: { user: null }, error: null })
  const row = await auth.findUserById(req.auth.userId)
  return res.json({ data: { user: auth.publicUser(row) }, error: null })
})

// ── forgot password ─────────────────────────────────────────────────────────
router.post('/recover', tight, async (req, res) => {
  const { email, redirectTo } = req.body || {}
  const user = await auth.findUserByEmail(email)

  // Always the same reply, whether or not that address has an account —
  // otherwise this becomes a way to find out who shops here.
  if (user) {
    const token = await auth.createResetToken(user.id)
    const base = String(redirectTo || `${siteUrl()}/account`).split('#')[0]
    const link = `${base}${base.includes('?') ? '&' : '?'}reset_token=${encodeURIComponent(token)}`
    await sendEmail({
      to: user.email,
      subject: "Reset your Brick's & Joy password",
      text: `Someone asked to reset the password for this account.\n\nOpen this link to choose a new one:\n${link}\n\nThe link works for ${auth.RESET_TTL_MINUTES} minutes. If this wasn't you, nothing has changed — you can ignore this email.`,
      html: `<p>Someone asked to reset the password for this account.</p>
             <p><a href="${link}">Choose a new password</a></p>
             <p>The link works for ${auth.RESET_TTL_MINUTES} minutes. If this wasn't you, nothing has changed — you can ignore this email.</p>`,
    })
  }
  return ok(res, {})
})

router.post('/reset', tight, async (req, res) => {
  const { token, password } = req.body || {}
  const userId = await auth.consumeResetToken(token)
  if (!userId) return no(res, 400, 'That reset link has expired — ask for a new one')
  try {
    await auth.setPassword(userId, password)
  } catch (e) {
    return no(res, 400, e.message)
  }
  const user = await auth.findUserById(userId)
  const session = await auth.createSession(user, req.get('user-agent'))
  return ok(res, { user: session.user, session })
})

// Changing your own password while signed in.
router.post('/password', auth.requireUser, async (req, res) => {
  const { current_password, password } = req.body || {}
  const user = await auth.findUserById(req.auth.userId)
  if (user.password_hash && !(await auth.verifyPassword(user, current_password))) {
    return no(res, 400, 'Current password is wrong')
  }
  try {
    await auth.setPassword(user.id, password)
  } catch (e) {
    return no(res, 400, e.message)
  }
  const session = await auth.createSession(user, req.get('user-agent'))
  return ok(res, { user: session.user, session })
})

// ── Google ──────────────────────────────────────────────────────────────────
// The authorization-code flow, by hand — it is three requests and avoids
// another dependency. `state` is a signed, short-lived value so the callback
// can prove the round trip started here and can carry the page to return to.
const stateSecret = () => process.env.JWT_SECRET

function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, t: Date.now() })).toString('base64url')
  const mac = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${mac}`
}

function readState(state) {
  const [body, mac] = String(state || '').split('.')
  if (!body || !mac) return null
  const expect = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  const a = Buffer.from(mac), b = Buffer.from(expect)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (Date.now() - parsed.t > 10 * 60 * 1000) return null   // ten minutes is plenty
    return parsed
  } catch { return null }
}

const googleConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

const googleRedirectUri = () =>
  process.env.GOOGLE_REDIRECT_URI || `${(process.env.PUBLIC_API_URL || '').replace(/\/+$/, '')}/auth/google/callback`

router.get('/google', (req, res) => {
  if (!googleConfigured()) return res.status(503).send('Google sign-in is not configured on this server')

  const returnTo = String(req.query.redirect_to || `${siteUrl()}/account`)
  // Only ever bounce back to our own site.
  const safeReturn = returnTo.startsWith(siteUrl()) ? returnTo : `${siteUrl()}/account`

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID)
  url.searchParams.set('redirect_uri', googleRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', signState({ returnTo: safeReturn }))
  url.searchParams.set('prompt', 'select_account')
  res.redirect(url.toString())
})

router.get('/google/callback', async (req, res) => {
  const state = readState(req.query.state)
  const back = state?.returnTo || `${siteUrl()}/account`
  const bounce = msg => res.redirect(`${back}${back.includes('?') ? '&' : '?'}auth_error=${encodeURIComponent(msg)}`)

  if (!state) return bounce('That sign-in link expired — try again')
  if (!req.query.code) return bounce('Google did not send a code back')

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(),
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokenRes.ok) return bounce('Google refused the sign-in')

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const info = await infoRes.json()
    if (!info?.email) return bounce('Google did not share an email address')
    if (info.email_verified === false) return bounce('That Google account has an unverified email')

    let user = await auth.findUserByEmail(info.email)
    if (!user) {
      user = await auth.createUser({
        email: info.email,
        password: null,
        fullName: info.name || null,
        role: 'customer',
        provider: 'google',
        metadata: { full_name: info.name, avatar_url: info.picture, provider: 'google' },
      })
    }

    const session = await auth.createSession(user, req.get('user-agent'))
    // Handed over in the fragment, so the tokens never reach a server log or a
    // Referer header. The shop picks them up and clears the address bar.
    const frag = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: String(session.expires_at),
    })
    return res.redirect(`${back}#${frag.toString()}`)
  } catch (e) {
    console.error('[auth] google callback failed:', e.message)
    return bounce('Google sign-in failed')
  }
})

// Tells the shop whether to show the Google button at all.
router.get('/providers', (_req, res) => {
  res.json({ data: { password: true, google: googleConfigured() }, error: null })
})

module.exports = router
