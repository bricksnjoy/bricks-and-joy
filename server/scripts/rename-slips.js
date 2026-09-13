#!/usr/bin/env node
// Give every existing payment slip an unguessable name.
//
//   node scripts/rename-slips.js            # show what would change
//   node scripts/rename-slips.js --apply    # do it
//
// The uploads bucket is public, because product photos have to be. That makes
// the file name the only thing between a stranger and a customer's bank slip.
// Slips uploaded before this was fixed are named after a millisecond and four
// or six characters of Math.random() — around twenty bits next to a timestamp
// anyone can narrow to the day an order was placed. New uploads use a UUID;
// this brings the old ones up to the same standard.
//
// For each slip it copies the object to a new random key, points the database
// at it, and only then deletes the old one. A slip is never unreachable: the
// database is updated after the copy succeeds, so an interrupted run leaves
// working URLs behind either way and can simply be run again.
//
// Product photos are deliberately left alone. They are meant to be public, the
// shop links to them openly, and renaming them would break every stored URL for
// no gain.

require('dotenv').config()

const crypto = require('crypto')
const db = require('../db')
const r2 = require('../lib/r2')

const APPLY = process.argv.includes('--apply')

// Where slips live. Plain text columns, and jsonb arrays of { url, name, type }.
const TEXT_COLUMNS = [
  { table: 'orders', column: 'transfer_slip_url' },
  { table: 'purchase_orders', column: 'slip_url' },
]
const JSON_COLUMNS = [
  { table: 'supplier_payments', column: 'slips' },
  { table: 'purchase_orders', column: 'slips' },
  { table: 'expenses', column: 'slips' },
  { table: 'loans', column: 'slips' },
  { table: 'loans', column: 'received_slips' },
  { table: 'loan_payments', column: 'slips' },
]

const log = (...a) => console.log(...a)

const decode = s => { try { return decodeURIComponent(s) } catch { return s } }

// The object key inside the bucket, from whatever URL shape was stored.
//
// Three shapes are in the database, because slips uploaded at different times
// were addressed differently and all of them are still in there:
//
//   .../object/public/uploads/NAME   the old Supabase URLs
//   .../api/storage/uploads/NAME     served by our own API
//   https://files.example.com/NAME   R2's public bucket domain
//
// Only the last part is the key. The first version of this treated the whole
// path as the key, so it asked R2 for "api/storage/uploads/slip-….jpeg" — an
// object that has never existed — and every single move would have failed.
// (Harmlessly: the database is only updated after a copy succeeds. But it
// would have done nothing at all, while looking like it had tried.)
function keyOf(url) {
  if (!url || typeof url !== 'string') return null
  if (url.startsWith('data:')) return null              // never uploaded

  let path
  try { path = new URL(url).pathname } catch { return null }

  const viaSupabase = path.match(/\/object\/(?:public|sign)\/[^/]+\/(.+)$/)
  if (viaSupabase) return decode(viaSupabase[1])

  const viaApi = path.match(/\/storage\/[^/]+\/(.+)$/)
  if (viaApi) return decode(viaApi[1])

  // A bucket's own public domain: the path is the key, give or take a bucket
  // name in front of it.
  const bare = path.replace(/^\/+/, '')
  const bucket = r2.BUCKET()
  return decode(bare.startsWith(bucket + '/') ? bare.slice(bucket.length + 1) : bare)
}

// Already unguessable? A UUID is 36 characters of hex and dashes.
const alreadySafe = key => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(key)

// Keep whatever the name was prefixed with — slip-, po-slip-, web- — so a
// renamed object still says what it is at a glance. Flattening po-slip- to
// slip- would lose which ones came from a batch order for no reason.
const newKeyFor = key => {
  const base = key.split('/').pop() || key
  const ext = (base.includes('.') ? base.split('.').pop() : '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const m = base.match(/^([a-z]+(?:-[a-z]+)*)-/i)
  const prefix = m ? m[1].toLowerCase() : 'slip'
  return `${prefix}-${crypto.randomUUID()}.${ext}`
}

async function moveObject(oldKey, newKey) {
  // r2.get hands back the S3 response as it came: the bytes are a stream on
  // Body, and the type is ContentType. Pulled into a buffer because put wants
  // something it can hand straight to the SDK, and a slip is a photograph
  // rather than something worth streaming.
  const obj = await r2.get(oldKey)
  const bytes = Buffer.from(await obj.Body.transformToByteArray())
  await r2.put(newKey, bytes, obj.ContentType)
  return r2.publicUrl(newKey)
}

async function main() {
  if (!r2.configured()) throw new Error('R2 is not configured — check server/.env')

  log(APPLY ? '\nRenaming slips.\n' : '\nDry run — nothing will change. Add --apply to do it.\n')

  let seen = 0, moved = 0, skipped = 0, failed = 0
  const done = new Map()   // old key -> new url, so a slip used twice moves once

  const rename = async (oldUrl) => {
    const key = keyOf(oldUrl)
    if (!key) return null
    if (done.has(key)) return done.get(key)
    seen++
    if (alreadySafe(key)) { skipped++; return null }
    const newKey = newKeyFor(key)
    if (!APPLY) {
      log(`  would move  ${key}\n           -> ${newKey}`)
      moved++
      done.set(key, null)
      return null
    }
    try {
      const url = await moveObject(key, newKey)
      done.set(key, url)
      moved++
      log(`  moved  ${key} -> ${newKey}`)
      return url
    } catch (e) {
      failed++
      log(`  FAILED ${key}: ${e.message}`)
      done.set(key, null)
      return null
    }
  }

  // ── plain text columns ─────────────────────────────────────────────────────
  for (const { table, column } of TEXT_COLUMNS) {
    let rows
    try {
      rows = (await db.query(`select id, ${column} as url from ${table} where ${column} is not null and ${column} <> ''`)).rows
    } catch (e) { log(`  (skipping ${table}.${column}: ${e.message})`); continue }
    for (const r of rows) {
      const url = await rename(r.url)
      if (url && APPLY) await db.query(`update ${table} set ${column} = $1 where id = $2`, [url, r.id])
    }
  }

  // ── jsonb arrays of { url, ... } ───────────────────────────────────────────
  for (const { table, column } of JSON_COLUMNS) {
    let rows
    try {
      rows = (await db.query(`select id, ${column} as list from ${table} where jsonb_array_length(coalesce(${column}, '[]'::jsonb)) > 0`)).rows
    } catch (e) { log(`  (skipping ${table}.${column}: ${e.message})`); continue }
    for (const r of rows) {
      const list = Array.isArray(r.list) ? r.list : []
      let changed = false
      const next = []
      for (const item of list) {
        const url = await rename(item?.url)
        if (url) { next.push({ ...item, url }); changed = true } else next.push(item)
      }
      if (changed && APPLY) {
        await db.query(`update ${table} set ${column} = $1 where id = $2`, [JSON.stringify(next), r.id])
      }
    }
  }

  // The old objects go only once every reference has been repointed — a slip
  // that failed to copy still has the database pointing at the original.
  if (APPLY) {
    for (const [oldKey, url] of done) {
      if (!url) continue
      try { await r2.remove(oldKey) } catch (e) { log(`  could not delete ${oldKey}: ${e.message}`) }
    }
  }

  log(`\n  ${seen} slip${seen === 1 ? '' : 's'} found`)
  log(`  ${moved} ${APPLY ? 'renamed' : 'would be renamed'}`)
  log(`  ${skipped} already had a safe name`)
  if (failed) log(`  ${failed} FAILED — their database rows still point at the originals`)
  log(APPLY ? '\nDone.\n' : '\nRun again with --apply to make the changes.\n')
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('\nrename-slips failed:', e.message, '\n'); process.exit(1) })
