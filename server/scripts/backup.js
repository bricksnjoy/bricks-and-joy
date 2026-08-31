#!/usr/bin/env node
// Back up the database.
//
//   node scripts/backup.js            # dump, verify, prune
//   node scripts/backup.js --list     # what backups exist
//
// Run nightly from cron. See the end of this file for the crontab line.
//
// Supabase was quietly keeping a copy of this shop's entire history. Nothing is
// doing that any more, which makes this the single most important script here —
// everything else can be rebuilt from the repository, and this cannot.
//
// Three things it does that a one-line pg_dump in a crontab does not:
//
//   Reads DATABASE_URL out of server/.env. Cron runs with almost no environment,
//   so "pg_dump $DATABASE_URL" in a crontab expands to "pg_dump" and quietly
//   writes an empty file every night until the day you need one.
//
//   Checks the dump finished. pg_dump writes a completion marker on its last
//   line; a dump cut short by a full disk or a dropped connection will not have
//   it. An unverified backup is a guess.
//
//   Says how big it is. A backup that suddenly shrinks is the first sign
//   something is wrong upstream.

require('dotenv').config()

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { promisify } = require('util')

const run = promisify(execFile)

const DIR = process.env.BACKUP_DIR || path.resolve(__dirname, '..', '..', 'backups')
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30)
const MARKER = 'PostgreSQL database dump complete'

const stamp = () => new Date().toISOString().replace('T', '-').replace(/:/g, '').slice(0, 15)
const mb = n => `${(n / 1024 / 1024).toFixed(2)} MB`
const log = (...a) => console.log(new Date().toISOString(), ...a)

async function listBackups() {
  if (!fs.existsSync(DIR)) return []
  return fs.readdirSync(DIR)
    .filter(f => /^db-.*\.sql\.gz$/.test(f))
    // Pick the fields rather than spreading the Stats object: size and mtime are
    // getters on its prototype, so {...stat} quietly produces neither.
    .map(f => {
      const st = fs.statSync(path.join(DIR, f))
      return { name: f, size: st.size, mtime: st.mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

async function main() {
  if (process.argv.includes('--list')) {
    const all = await listBackups()
    if (!all.length) { console.log('No backups yet.'); return }
    console.log(`\n${all.length} backup${all.length === 1 ? '' : 's'} in ${DIR}:\n`)
    all.forEach(b => console.log(`  ${b.name}   ${mb(b.size).padStart(10)}   ${b.mtime.toISOString().slice(0, 16).replace('T', ' ')}`))
    const total = all.reduce((s, b) => s + b.size, 0)
    console.log(`\n  ${mb(total)} in total, keeping ${KEEP_DAYS} days\n`)
    return
  }

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set — is server/.env readable by this user?')

  fs.mkdirSync(DIR, { recursive: true })
  const file = path.join(DIR, `db-${stamp()}.sql.gz`)
  const partial = `${file}.partial`

  // Written to .partial first and renamed only once verified, so a half-written
  // file can never be mistaken for a backup.
  log('dumping…')
  const dump = await run('pg_dump', ['--no-owner', '--no-privileges', url], {
    maxBuffer: 1024 * 1024 * 512,
    encoding: 'buffer',
  })

  const text = dump.stdout.toString('utf8')
  if (!text.includes(MARKER)) {
    throw new Error('pg_dump did not finish — the dump has no completion marker, so it is incomplete')
  }

  fs.writeFileSync(partial, zlib.gzipSync(dump.stdout, { level: 9 }))

  // Read it back the way a restore would, rather than trusting what we just wrote.
  const check = zlib.gunzipSync(fs.readFileSync(partial)).toString('utf8')
  if (!check.includes(MARKER)) throw new Error('the gzipped file does not read back correctly')

  fs.renameSync(partial, file)

  const size = fs.statSync(file).size
  const tables = (check.match(/^CREATE TABLE /gm) || []).length
  const copies = (check.match(/^COPY /gm) || []).length
  log(`saved ${path.basename(file)} — ${mb(size)}, ${tables} tables, ${copies} data sections`)

  // A backup that suddenly halves is worth knowing about before you need it.
  const previous = (await listBackups()).filter(b => b.name !== path.basename(file))[0]
  if (previous && size < previous.size * 0.5) {
    log(`WARNING: this backup is less than half the size of ${previous.name} (${mb(previous.size)}) — check the database`)
  }

  // ── prune ─────────────────────────────────────────────────────────────────
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000
  let removed = 0
  for (const b of await listBackups()) {
    if (b.mtime.getTime() < cutoff) { fs.unlinkSync(path.join(DIR, b.name)); removed++ }
  }
  if (removed) log(`removed ${removed} backup${removed === 1 ? '' : 's'} older than ${KEEP_DAYS} days`)

  // ── off-site copy, if a private bucket has been set up ────────────────────
  // Deliberately NOT the `uploads` bucket: that one is public, and putting the
  // whole database in it would publish every customer, order and price.
  const bucket = process.env.BACKUP_R2_BUCKET
  if (bucket) {
    if (bucket === (process.env.R2_BUCKET || 'uploads')) {
      throw new Error(`refusing to upload backups to '${bucket}' — that bucket is public. Use a separate private one.`)
    }
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
    const s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.BACKUP_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.BACKUP_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY,
      },
    })
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: path.basename(file),
      Body: fs.readFileSync(file),
      ContentType: 'application/gzip',
    }))
    log(`copied off-site to ${bucket}`)
  } else {
    log('no off-site copy (BACKUP_R2_BUCKET is not set) — this backup only survives what the server survives')
  }
}

main().catch(e => {
  console.error(new Date().toISOString(), 'BACKUP FAILED:', e.message)
  process.exit(1)
})

// ── Install ─────────────────────────────────────────────────────────────────
//
//   sudo -u bricksnjoy crontab -e
//
//   15 2 * * * cd /srv/bricksandjoy/server && /usr/bin/node scripts/backup.js >> /srv/bricksandjoy/backups/backup.log 2>&1
//
// ── Restore ─────────────────────────────────────────────────────────────────
//
//   systemctl stop bricksnjoy-api
//   gunzip -c backups/db-2026-08-28-0215.sql.gz \
//     | psql "$(grep '^DATABASE_URL=' server/.env | cut -d= -f2-)"
//   systemctl start bricksnjoy-api
//
// Restoring over a live database is how a bad night becomes a worse one — stop
// the API first so nothing writes underneath it.
