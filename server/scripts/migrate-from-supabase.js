#!/usr/bin/env node
// The one-way move: everything out of Supabase and into our own database and
// Cloudflare R2.
//
//   cd server
//   node scripts/migrate-from-supabase.js --dry-run     # look, change nothing
//   node scripts/migrate-from-supabase.js               # do it
//   node scripts/migrate-from-supabase.js --only=orders,customers
//   node scripts/migrate-from-supabase.js --skip-files  # rows only
//
// It is safe to run more than once. Every row is written with `on conflict (id)
// do nothing`, and files already in R2 are skipped, so a run that stops halfway
// can simply be started again.
//
// What it does, in order:
//   1. Reads every table out of Supabase through PostgREST, in pages.
//   2. Turns auth.users into app_users, keeping the same ids so every
//      created_by and customer_id still points at the right person.
//   3. Copies the `uploads` bucket into R2, keeping the object names.
//   4. Rewrites the stored URLs — image_url, photo_url, slips, images — from
//      the old Supabase addresses to the new ones.
//
// Passwords do NOT come across. Supabase never exposes the hashes, and even if
// it did they are salted for its own scheme. Everyone signs in once more with a
// new password: staff get one from `npm run create-staff`, shoppers use the
// "forgot password" link.

require('dotenv').config()

const db = require('../db')
const r2 = require('../lib/r2')

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const SKIP_FILES = args.includes('--skip-files')
const ONLY = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '')
  .split(',').map(s => s.trim()).filter(Boolean)

// Parents before children, so a foreign key always has something to point at.
const TABLE_ORDER = [
  'app_users', 'profiles',
  'suppliers', 'categories', 'customers', 'products',
  'orders', 'purchase_orders', 'supplier_payments', 'supplier_products',
  'expenses', 'email_contacts',
  'events', 'event_giveaways',
  'order_analyses', 'order_analysis_items',
  'loans', 'loan_payments',
  'campaigns', 'ad_campaigns', 'tasks',
  'audit_log', 'message_log',
  'reconciliations', 'settled_entries', 'app_settings', 'report_settings',
  'cash_movements', 'period_locks',
  'coupons', 'site_settings', 'product_reviews', 'customer_profiles',
]

// audit_log had two different id types depending on which setup file built the
// database first. Nothing points at an audit row, so its ids are simply left to
// be generated fresh rather than trying to reconcile the two.
//
// The cost of that is there is no key to conflict on, so a second run would
// insert every row again. These tables are therefore skipped once they hold
// anything — see insertRows.
const REGENERATE_ID = new Set(['audit_log'])

const log = (...a) => console.log(...a)
const warn = (...a) => console.warn('  !', ...a)

// ── reading from Supabase ───────────────────────────────────────────────────
async function fetchAll(table) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=${pageSize}&offset=${from}`
    const res = await fetch(url, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!res.ok) {
      const body = await res.text()
      if (res.status === 404 || /does not exist/i.test(body)) return null   // table never existed
      throw new Error(`${table}: ${res.status} ${body.slice(0, 200)}`)
    }
    const page = await res.json()
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

// auth.users lives outside PostgREST; it has its own admin endpoint.
async function fetchAuthUsers() {
  const users = []
  for (let page = 1; ; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!res.ok) throw new Error(`auth users: ${res.status} ${await res.text()}`)
    const body = await res.json()
    const batch = body.users || []
    users.push(...batch)
    if (batch.length < 200) break
  }
  return users
}

// ── writing into our database ───────────────────────────────────────────────
async function insertRows(table, rows) {
  if (!rows.length) return { inserted: 0, skipped: 0 }

  const columns = db.columnsOf(table)
  const generated = db.generatedOf(table)
  const regenerate = REGENERATE_ID.has(table)

  // Supabase may hold columns this schema dropped, and vice versa. Take the
  // intersection and say what was left behind, rather than failing the run.
  const usable = [...new Set(rows.flatMap(Object.keys))]
    .filter(c => columns.has(c) && !generated.has(c) && !(regenerate && c === 'id'))

  const dropped = [...new Set(rows.flatMap(Object.keys))].filter(c => !columns.has(c))
  if (dropped.length) warn(`${table}: ignoring columns not in the new schema: ${dropped.join(', ')}`)
  if (!usable.length) return { inserted: 0, skipped: rows.length }

  // Rows keep their original ids, so "insert what isn't already there" is just
  // an on-conflict clause. Tables whose ids are regenerated have no such key,
  // so a re-run would duplicate everything — skip them once they hold rows.
  if (regenerate) {
    const { rows: [{ n }] } = await db.query(`select count(*)::int as n from ${db.quote(table)}`)
    if (n > 0) {
      warn(`${table}: already holds ${n} rows and has no key to match on — skipped so a re-run cannot duplicate it`)
      return { inserted: 0, skipped: rows.length }
    }
  }

  const conflictTarget = db.primaryKeyOf(table)
  const onConflict = conflictTarget.length && !regenerate
    ? `on conflict (${conflictTarget.map(c => db.quote(c)).join(', ')}) do nothing`
    : ''

  let inserted = 0
  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const params = []
    const tuples = chunk.map(row =>
      '(' + usable.map(c => {
        // Schema-aware: a jsonb column needs its value encoded even when that
        // value is a plain string. app_settings.value holds both an array (the
        // sidebar order) and a bare date string (the reconciliation start), and
        // only the array survives being passed through as-is.
        params.push(db.encodeFor(table, c, row[c]))
        return `$${params.length}`
      }).join(', ') + ')'
    ).join(', ')

    const sql = `insert into ${db.quote(table)} (${usable.map(c => db.quote(c)).join(', ')}) values ${tuples} ${onConflict}`
    if (DRY) { inserted += chunk.length; continue }
    const out = await db.query(sql, params)
    inserted += out.rowCount
  }

  return { inserted, skipped: rows.length - inserted }
}

// ── accounts ────────────────────────────────────────────────────────────────
async function migrateUsers() {
  log('\n▸ accounts (auth.users -> app_users)')
  const users = await fetchAuthUsers()
  log(`  found ${users.length} in Supabase`)

  // Anyone who has ever placed an order through the back office, or whose id
  // appears on a staff-only record, was staff. Everyone else shopped.
  const staffIds = new Set()
  try {
    const marks = await fetchAll('profiles')
    for (const p of marks || []) if ((p.role || 'staff') === 'staff') staffIds.add(p.id)
  } catch { /* no profiles table */ }

  const rows = users.map(u => ({
    id: u.id,
    email: u.email,
    password_hash: null,                       // never leaves Supabase — see the note at the top
    role: staffIds.has(u.id) ? 'staff' : 'customer',
    full_name: u.user_metadata?.full_name || u.user_metadata?.name || null,
    provider: u.app_metadata?.provider || 'password',
    metadata: u.user_metadata || {},
    confirmed_at: u.confirmed_at || u.email_confirmed_at || null,
    last_sign_in: u.last_sign_in_at || null,
    created_at: u.created_at,
  }))

  const staff = rows.filter(r => r.role === 'staff').length
  const out = await insertRows('app_users', rows)
  log(`  ${out.inserted} written (${staff} staff, ${rows.length - staff} customers)`)
  if (out.skipped) log(`  ${out.skipped} already existed`)
  return rows
}

// ── files ───────────────────────────────────────────────────────────────────
async function listSupabaseFiles() {
  const files = []
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/uploads`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    })
    if (!res.ok) throw new Error(`storage list: ${res.status} ${await res.text()}`)
    const batch = await res.json()
    files.push(...batch.filter(f => f.id))     // folders come back without an id
    if (batch.length < 100) break
  }
  return files
}

async function migrateFiles() {
  log('\n▸ files (Supabase storage -> Cloudflare R2)')
  if (!r2.configured()) { warn('R2 is not configured — skipping. Set the R2_* variables and re-run.'); return }

  const files = await listSupabaseFiles()
  log(`  found ${files.length} in the uploads bucket`)

  let copied = 0, already = 0, failed = 0, bytes = 0
  for (const f of files) {
    const key = f.name
    try {
      if (await r2.exists(key)) { already++; continue }
      if (DRY) { copied++; continue }

      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/uploads/${encodeURIComponent(key)}`)
      if (!res.ok) { warn(`${key}: could not download (${res.status})`); failed++; continue }

      const buf = Buffer.from(await res.arrayBuffer())
      await r2.put(key, buf, res.headers.get('content-type') || 'application/octet-stream')
      copied++; bytes += buf.length
    } catch (e) {
      warn(`${key}: ${e.message}`); failed++
    }
    if ((copied + already + failed) % 50 === 0) {
      log(`  … ${copied + already + failed} / ${files.length}`)
    }
  }

  const mb = (bytes / 1024 / 1024).toFixed(1)
  log(`  ${copied} copied (${mb} MB), ${already} already there, ${failed} failed`)
}

// ── repointing the URLs ─────────────────────────────────────────────────────
// Every picture's address is stored in the database. Once the files are in R2
// those addresses are wrong, so each one is rewritten in place — the object
// name is kept, so only the part before it changes.
// Listing a column that holds no Supabase addresses costs nothing — the update
// is guarded by a LIKE on the old prefix, so it simply matches no rows. Being
// generous here is far cheaper than missing one and leaving a set of pictures
// pointing at a project that is about to be deleted.
const URL_COLUMNS = {
  products:          ['photo_url', 'images', 'video_url'],
  supplier_products: ['image_url'],
  purchase_orders:   ['image_url', 'slip_url'],
  supplier_payments: ['slips'],
  orders:            ['transfer_slip_url'],
  expenses:          ['slips'],
  loans:             ['slips', 'received_slips'],
  loan_payments:     ['slips'],
  events:            ['images'],
  order_analysis_items: ['image_url'],
  site_settings:     ['data'],
}

async function repointUrls() {
  log('\n▸ picture addresses')

  const newBase = (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '')
    || `${(process.env.PUBLIC_API_URL || '').replace(/\/+$/, '')}/storage/uploads`
  if (!newBase || newBase.startsWith('/storage')) {
    warn('Neither R2_PUBLIC_BASE nor PUBLIC_API_URL is set — skipping. Set one and re-run with --only=urls.')
    return
  }
  log(`  rewriting to ${newBase}/…`)

  const oldPattern = `${SUPABASE_URL}/storage/v1/object/public/uploads/`
  let touched = 0

  for (const [table, columns] of Object.entries(URL_COLUMNS)) {
    if (!db.hasTable(table)) continue
    for (const col of columns) {
      if (!db.hasColumn(table, col)) continue

      // jsonb columns hold arrays of slip objects, so the swap is done on the
      // text of the whole value and cast back — simpler and complete.
      const isJson = ['slips', 'received_slips', 'images', 'data'].includes(col)
      const sql = isJson
        ? `update ${db.quote(table)}
              set ${db.quote(col)} = replace(${db.quote(col)}::text, $1, $2)::jsonb
            where ${db.quote(col)}::text like '%' || $1 || '%'`
        : `update ${db.quote(table)}
              set ${db.quote(col)} = replace(${db.quote(col)}, $1, $2)
            where ${db.quote(col)} like '%' || $1 || '%'`

      if (DRY) { log(`  would rewrite ${table}.${col}`); continue }
      const out = await db.query(sql, [oldPattern, `${newBase}/`])
      if (out.rowCount) { log(`  ${table}.${col}: ${out.rowCount} rows`); touched += out.rowCount }
    }
  }

  log(`  ${touched} rows rewritten`)
}

// ── the run ─────────────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env first.')
    console.error('The service role key is in the Supabase dashboard under Project Settings -> API.')
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — run db/schema.sql against the new database first.')
    process.exit(1)
  }

  log(DRY ? '── DRY RUN — nothing will be written ──' : '── migrating from Supabase ──')
  await db.loadSchema()

  const wanted = t => !ONLY.length || ONLY.includes(t)

  if (wanted('app_users')) await migrateUsers()

  log('\n▸ tables')
  for (const table of TABLE_ORDER) {
    if (table === 'app_users' || !wanted(table)) continue
    if (!db.hasTable(table)) { warn(`${table}: not in the new schema, skipped`); continue }

    let rows
    try {
      rows = await fetchAll(table)
    } catch (e) {
      warn(`${table}: ${e.message}`); continue
    }
    if (rows === null) { log(`  ${table}: not in Supabase, skipped`); continue }

    const out = await insertRows(table, rows)
    log(`  ${table}: ${out.inserted} of ${rows.length}${out.skipped ? ` (${out.skipped} already there)` : ''}`)
  }

  if (!SKIP_FILES && (!ONLY.length || ONLY.includes('files'))) await migrateFiles()
  if (!ONLY.length || ONLY.includes('urls')) await repointUrls()

  log('\n── done ──')
  if (!DRY) {
    log('\nNext:')
    log('  1. node scripts/create-staff.js you@example.com "Your Name"')
    log('     (passwords do not come across from Supabase — see the note at the top of this file)')
    log('  2. Sign in and check Inventory, Orders and Supplier Catalog show their pictures.')
    log('  3. Once you are happy, remove SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from server/.env.')
  }

  await db.pool.end()
}

main().catch(async e => {
  console.error('\nMigration stopped:', e.message)
  try { await db.pool.end() } catch { /* already closed */ }
  process.exit(1)
})
