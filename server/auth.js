// Accounts, tokens and "who is asking".
//
// Supabase's GoTrue did this before. The shapes below are kept deliberately
// close to what supabase-js handed the front end — a `user` with `id`, `email`
// and `user_metadata`, and a `session` with an `access_token` — so no page had
// to be rewritten to read them.
//
// One thing is deliberately different. Signing up on the shop used to hand you
// the role `authenticated`, and every back-office table was open to anyone with
// that role: in other words, any shopper who made an account could read the
// customer list and every order. Here a shop signup creates a `customer`, and
// there is no way to create a `staff` account through the API at all — staff
// are made on the server with `npm run create-staff`.

const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const db = require('./db')

const SECRET = process.env.JWT_SECRET
if (!SECRET || SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to at least 32 random characters (see server/.env.example)')
}

const ACCESS_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL || 3600)          // 1 hour
const REFRESH_TTL_DAYS   = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30)
const RESET_TTL_MINUTES  = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60)

const randomToken = () => crypto.randomBytes(32).toString('base64url')

// ── shapes the front end expects ────────────────────────────────────────────
function publicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
    last_sign_in_at: row.last_sign_in,
    app_metadata: { provider: row.provider || 'password', role: row.role },
    user_metadata: {
      ...(row.metadata || {}),
      full_name: row.full_name || (row.metadata && row.metadata.full_name) || null,
      role: row.role,
    },
  }
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    SECRET,
    { expiresIn: ACCESS_TTL_SECONDS, issuer: 'bricksandjoy' }
  )
}

async function createSession(user, userAgent) {
  const refresh = randomToken()
  const expires = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000)
  await db.query(
    'insert into auth_sessions (token, user_id, expires_at, user_agent) values ($1, $2, $3, $4)',
    [refresh, user.id, expires, (userAgent || '').slice(0, 300)]
  )
  await db.query('update app_users set last_sign_in = now() where id = $1', [user.id])

  return {
    access_token: signAccessToken(user),
    refresh_token: refresh,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_SECONDS,
    expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS,
    user: publicUser(user),
  }
}

async function refreshSession(refreshToken, userAgent) {
  const { rows } = await db.query(
    `select s.token, u.*
       from auth_sessions s join app_users u on u.id = s.user_id
      where s.token = $1 and s.expires_at > now()`,
    [refreshToken]
  )
  if (!rows.length) return null

  // Rotate: the old refresh token dies with the request that used it, so a
  // stolen one is good for a single use at most.
  await db.query('delete from auth_sessions where token = $1', [refreshToken])
  return createSession(rows[0], userAgent)
}

const endSession = token => db.query('delete from auth_sessions where token = $1', [token])
const endAllSessions = userId => db.query('delete from auth_sessions where user_id = $1', [userId])

// ── accounts ────────────────────────────────────────────────────────────────
const hashPassword = pw => bcrypt.hash(pw, 12)

async function findUserByEmail(email) {
  const { rows } = await db.query('select * from app_users where email = $1', [String(email || '').trim()])
  return rows[0] || null
}

async function findUserById(id) {
  const { rows } = await db.query('select * from app_users where id = $1', [id])
  return rows[0] || null
}

async function createUser({ email, password, fullName, role = 'customer', provider = 'password', metadata = {} }) {
  const clean = String(email || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('That email address does not look right')
  if (provider === 'password' && (!password || password.length < 8)) {
    throw new Error('Password must be at least 8 characters')
  }
  const hash = password ? await hashPassword(password) : null
  const { rows } = await db.query(
    `insert into app_users (email, password_hash, role, full_name, provider, metadata, confirmed_at)
     values ($1, $2, $3, $4, $5, $6, now()) returning *`,
    [clean, hash, role, fullName || null, provider, JSON.stringify(metadata || {})]
  )
  return rows[0]
}

async function verifyPassword(user, password) {
  if (!user || !user.password_hash) return false
  return bcrypt.compare(String(password || ''), user.password_hash)
}

async function setPassword(userId, password) {
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters')
  const hash = await hashPassword(password)
  await db.query('update app_users set password_hash = $1 where id = $2', [hash, userId])
  // Changing a password signs every other device out — the point of changing it.
  await endAllSessions(userId)
}

// ── password reset ──────────────────────────────────────────────────────────
async function createResetToken(userId) {
  const token = randomToken()
  await db.query(
    'insert into password_resets (token, user_id, expires_at) values ($1, $2, $3)',
    [token, userId, new Date(Date.now() + RESET_TTL_MINUTES * 60_000)]
  )
  return token
}

async function consumeResetToken(token) {
  const { rows } = await db.query(
    `update password_resets set used_at = now()
      where token = $1 and used_at is null and expires_at > now()
      returning user_id`,
    [token]
  )
  return rows.length ? rows[0].user_id : null
}

// ── "who is asking" ─────────────────────────────────────────────────────────
// Runs on every request. A missing or expired token is not an error: it just
// means the caller is anonymous, which is a perfectly ordinary thing to be on
// the shop. Policies decide what that is worth.
function identify(req, _res, next) {
  req.auth = { role: 'anon', userId: null, email: null }

  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!token) return next()

  try {
    const claims = jwt.verify(token, SECRET, { issuer: 'bricksandjoy' })
    req.auth = {
      role: claims.role === 'staff' ? 'staff' : 'customer',
      userId: claims.sub,
      email: claims.email || null,
    }
  } catch {
    // Expired or forged — treated as anonymous. The shim sees the 401 that
    // follows on a protected call and refreshes.
  }
  next()
}

const requireStaff = (req, res, next) =>
  req.auth?.role === 'staff' ? next() : res.status(403).json({ error: { message: 'Staff only' } })

const requireUser = (req, res, next) =>
  req.auth?.userId ? next() : res.status(401).json({ error: { message: 'Sign in to do that' } })

module.exports = {
  publicUser, signAccessToken, createSession, refreshSession, endSession, endAllSessions,
  findUserByEmail, findUserById, createUser, verifyPassword, setPassword,
  createResetToken, consumeResetToken,
  identify, requireStaff, requireUser,
  ACCESS_TTL_SECONDS, RESET_TTL_MINUTES,
}
