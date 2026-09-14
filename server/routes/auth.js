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
const { safeReturnTo } = require('../lib/safeUrl')

const router = express.Router()

// Guessing a password should be slow and boring.
const tight = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { data: null, error: { message: 'Too many attempts — wait a few minutes and try again' } },
})

const ok = (res, body) => res.json({ data: body, error: null })
const no = (res, status, message) => res.status(status).json({ data: { user: null, session: null }, error: { message, status } })


// ── password sign-in ────────────────────────────────────────────────────────
router.post('/signin', tight, async (req, res) => {
  const { email, password } = req.body || {}
  const user = await auth.findUserByEmail(email)

  // Same answer either way: which of the two was wrong is not the caller's
  // business, and telling them turns a login form into an account-checker.
  if (!user || !(await auth.verifyPassword(user, password))) {
    return no(res, 400, 'Invalid login credentials')
  }

  // An account whose address was never confirmed is not an account anybody has
  // proved they own. Said plainly, with a code the shop uses to offer another
  // email — a person who has lost the first one is stuck otherwise.
  if (!auth.isConfirmed(user)) {
    return res.status(403).json({
      data: { user: null, session: null },
      error: { message: 'Check your email to finish creating your account', status: 403, code: 'email_not_confirmed' },
    })
  }

  const session = await auth.createSession(user, req.get('user-agent'))
  return ok(res, { user: session.user, session })
})

// ── shop sign-up ────────────────────────────────────────────────────────────
// Always creates a customer. Staff accounts are made on the server with
// `npm run create-staff`; there is no path to one through the API.
router.post('/signup', tight, async (req, res) => {
  const { email, password, data } = req.body || {}

  // Answer the same whether or not this address is already registered.
  //
  // It used to say "an account with that email already exists", which turns the
  // signup form into a way of asking whether somebody shops here — the very
  // thing /auth/recover below is careful not to answer. It could only say it
  // because it signed you straight in and had to decide on the spot. Now that
  // nobody is signed in until the link comes back, there is nothing to give
  // away: both answers are "we have sent you an email", and both are true.
  const existing = await auth.findUserByEmail(email)
  if (existing) {
    if (auth.isConfirmed(existing)) {
      // Tell the owner of the address, not the person at the form.
      sendEmail({
        to: existing.email,
        subject: "You already have a Brick's & Joy account",
        text: `Somebody just tried to create an account with this email address.

You already have one, so nothing has changed. If that was you, sign in as usual — and if you have forgotten your password, use "Forgot password" on the sign-in page.

If it wasn't you, you can ignore this. Nobody can get into your account from that form.`,
      }).catch(() => {})
    } else {
      // Never confirmed — so this may well be the owner, trying again.
      await sendVerification(existing, req)
    }
    return ok(res, { user: null, session: null })
  }

  let user
  try {
    user = await auth.createUser({
      email,
      password,
      fullName: data?.full_name || null,
      role: 'customer',
      metadata: data || {},
      confirmed: false,     // until the link in the email comes back
    })
  } catch (e) {
    return no(res, 400, e.message)
  }

  await sendVerification(user, req)
  // No session. The shop already knows to say "check your email" when none
  // comes back — it has said so since the move.
  return ok(res, { user: auth.publicUser(user), session: null })
})

// ── confirming the address ──────────────────────────────────────────────────
async function sendVerification(user, req) {
  const token = await auth.createVerificationToken(user.id)
  const base = safeReturnTo(req.body?.redirectTo)
  const link = `${base}${base.includes('?') ? '&' : '?'}verify_token=${encodeURIComponent(token)}`
  await sendEmail({
    to: user.email,
    subject: "Confirm your Brick's & Joy account",
    text: `Welcome to Brick's & Joy!

Open this link to finish creating your account:
${link}

The link works for ${auth.VERIFY_TTL_HOURS} hours. If you didn't sign up, you can ignore this email — the account cannot be used until somebody opens that link.`,
    html: `<p>Welcome to Brick's &amp; Joy!</p>
           <p><a href="${link}">Confirm your account</a></p>
           <p>The link works for ${auth.VERIFY_TTL_HOURS} hours. If you didn't sign up, you can ignore this email — the account cannot be used until somebody opens that link.</p>`,
  }).catch(e => console.error('[auth] could not send verification:', e.message))
}

router.post('/verify', tight, async (req, res) => {
  const userId = await auth.consumeVerificationToken(req.body?.token)
  if (!userId) return no(res, 400, 'That confirmation link has expired — ask for a new one')
  const user = await auth.findUserById(userId)
  if (!user) return no(res, 400, 'That account no longer exists')
  // Confirmed, so sign them in — they have just proved the address is theirs.
  const session = await auth.createSession(user, req.get('user-agent'))
  return ok(res, { user: session.user, session })
})

// Another copy of the email, for the one that never arrived. Same answer
// whatever the address, for the same reason as signup.
router.post('/resend', tight, async (req, res) => {
  const user = await auth.findUserByEmail(req.body?.email)
  if (user && !auth.isConfirmed(user)) await sendVerification(user, req)
  return ok(res, {})
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
    // The address this link points at decides who ends up holding the token,
    // and it arrived in the request — so it is checked against our own origin
    // rather than used as given. Anything else and this endpoint would post a
    // genuine email from us, carrying a working reset token, to a page of the
    // sender's choosing: an attacker needed only the victim's address.
    const base = safeReturnTo(redirectTo)
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
  // Opening a link sent to an address proves the address, whichever link it was.
  // Somebody who signed up, lost the confirmation email and reset their password
  // instead has proved exactly what the confirmation was asking for, and should
  // not then be told to go and find that first email.
  await db.query('update app_users set confirmed_at = coalesce(confirmed_at, now()) where id = $1', [userId])
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

  // Only ever bounce back to our own site. The callback appends the access and
  // refresh tokens to this address, so anywhere it can be pointed is somewhere
  // a session can be read out of the address bar. It used to be checked with
  // startsWith, which let through any host merely beginning with ours —
  // bricksandjoy.com.somebodyelse.example, and the same again with an @.
  const safeReturn = safeReturnTo(req.query.redirect_to)

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
  // Checked again on the way back, not only on the way out. The state is
  // signed and cannot be forged, but one signed in the ten minutes before this
  // check existed would still carry whatever it was given — and this is the
  // request that attaches the tokens.
  const back = safeReturnTo(state?.returnTo)
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
    // Must be verified, not merely "not stated". The check here was
    // `=== false`, which let a missing field through — and a missing field is
    // exactly what we cannot afford, since the whole of the next step rests on
    // Google having actually confirmed this address belongs to them.
    if (info.email_verified !== true) return bounce('That Google account has an unverified email')

    let user = await auth.findUserByEmail(info.email)

    // An account already here with a password on it is not proof that the
    // person at Google owns it. Anyone can sign up with anyone's address —
    // nothing verifies it — so somebody could register a victim's email today,
    // and the day that victim first clicked "Sign in with Google" they would
    // be handed straight into the waiting account, which its owner can still
    // open with the password they chose. Known as pre-hijacking, and the fix
    // is to refuse the link rather than guess.
    //
    // Accounts made by Google have no password and are matched as before, so
    // the ordinary case is untouched. Someone who really does own both can
    // still get in with their password, or reset it by email.
    // A password account whose address was confirmed belongs to whoever opened
    // the link sent to it, and Google has just told us it belongs to the person
    // signing in. Same address, both proved — same person, so they are linked.
    //
    // An unconfirmed one has proved nothing. That is the account somebody could
    // have registered in a stranger's name and sat waiting on, which is what
    // this refusal is for.
    if (user && user.password_hash && !auth.isConfirmed(user)) {
      return bounce('That email has an account here that was never confirmed — finish that first, or reset its password')
    }

    if (!user) {
      user = await auth.createUser({
        email: info.email,
        password: null,
        fullName: info.name || null,
        role: 'customer',
        provider: 'google',
        metadata: { full_name: info.name, avatar_url: info.picture, provider: 'google' },
        confirmed: true,        // Google told us it verified this address
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
