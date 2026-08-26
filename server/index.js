// Brick's & Joy — the API.
//
// Everything the app used to get from Supabase now comes from this one Node
// process on our own server: the database queries, the accounts, the file
// uploads (which go on to Cloudflare R2), the four functions that were Edge
// Functions, the scheduled jobs, and the "who's online" channel.
//
// It also serves the built React app, so a single service answers on port 4000
// and Caddy in front of it only has to do TLS. That is deliberate: one process
// to start, one to watch, one to restart.

require('dotenv').config()

const path = require('path')
const fs = require('fs')
const http = require('http')
const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')

const db = require('./db')
const { identify } = require('./auth')
const realtime = require('./realtime')
const cronJobs = require('./cron')

const PORT = Number(process.env.PORT || 4000)

// Listen on the loopback address only. Caddy is on the same machine and
// reaches us there; the internet cannot. The firewall should say the same
// thing, but a firewall is a rule someone can change by accident and this is
// not — if this port is ever exposed, it will be because somebody meant it.
const HOST = process.env.HOST || '127.0.0.1'

const app = express()

// Caddy sits in front, so the real client address arrives in X-Forwarded-For.
// Without this the rate limiters would see one address — Caddy's — and treat
// the whole internet as a single visitor.
app.set('trust proxy', 1)
app.disable('x-powered-by')

// ── who may call the API from a browser ─────────────────────────────────────
// Same-origin in production, because the API and the site are served together.
// The list only matters for `npm start` on a laptop, where React runs on :3000.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean)

app.use('/api', cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true)                 // curl, health checks, same-origin
    if (allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`Origin ${origin} is not allowed`))
  },
  credentials: true,
}))

// Bodies are JSON except for uploads, which multer handles. 2 MB is roomy for a
// query or a batch insert and far too small to be worth using as an attack.
app.use('/api', express.json({ limit: process.env.JSON_LIMIT || '2mb' }))

// A blanket ceiling. The per-route limiters below are the ones that matter;
// this is only here so a single client cannot occupy the process.
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MINUTE || 600),
  standardHeaders: true, legacyHeaders: false,
  message: { data: null, error: { message: 'Too many requests — slow down a moment' } },
}))

// Works out who is asking. Anonymous is a valid answer: the shop is public.
app.use('/api', identify)

// ── routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'))
app.use('/api/db',        require('./routes/db'))
app.use('/api/rpc',       require('./routes/rpc'))
app.use('/api/storage',   require('./routes/storage'))
app.use('/api/functions', require('./routes/functions'))

app.get('/api/health', async (_req, res) => {
  try {
    await db.query('select 1')
    res.json({ ok: true, uptime: Math.round(process.uptime()), tables: db.schema().tables.size })
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message })
  }
})

app.use('/api', (_req, res) => res.status(404).json({ data: null, error: { message: 'No such endpoint' } }))

// Anything thrown past a route lands here. The message goes to the log, not to
// the browser — a stack trace is a map of the server.
// eslint-disable-next-line no-unused-vars
app.use('/api', (err, _req, res, _next) => {
  console.error('[api]', err?.stack || err?.message || err)
  const status = /not allowed/i.test(err?.message || '') ? 403 : 500
  res.status(status).json({ data: null, error: { message: status === 403 ? err.message : 'Something went wrong on the server' } })
})

// ── the site itself ─────────────────────────────────────────────────────────
const buildDir = path.resolve(__dirname, '..', 'build')
if (fs.existsSync(buildDir)) {
  // Hashed filenames under /static never change, so they can be cached hard.
  app.use('/static', express.static(path.join(buildDir, 'static'), {
    immutable: true, maxAge: '1y',
  }))
  app.use(express.static(buildDir, { maxAge: '1h', index: false }))

  // Every other path is the single-page app. /backoffice is a route inside it,
  // not a folder on disk — which is why index.html has to answer for it.
  app.get('*', (_req, res) => res.sendFile(path.join(buildDir, 'index.html')))
} else {
  console.warn(`[api] no build/ directory at ${buildDir} — serving the API only`)
  app.get('*', (_req, res) => res.status(503).send('The site has not been built yet: run npm run build'))
}

// ── start ───────────────────────────────────────────────────────────────────
const server = http.createServer(app)

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see server/.env.example)')

  await db.loadSchema()      // must succeed: every query is checked against it
  realtime.attach(server)
  cronJobs.start()

  server.listen(PORT, HOST, () => {
    console.log(`[api] listening on http://${HOST}:${PORT}`)
    console.log(`[api] serving ${fs.existsSync(buildDir) ? 'the built site + API' : 'the API only'}`)
  })
}

main().catch(e => {
  console.error('[api] failed to start:', e.message)
  process.exit(1)
})

// systemd restarts us; finish what is in flight first so nobody's save is lost.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[api] ${signal} — shutting down`)
    server.close(() => db.pool.end().then(() => process.exit(0)))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
