#!/usr/bin/env node
// Set the same password on every staff account at once.
//
//   node scripts/set-staff-password.js               # all staff
//   node scripts/set-staff-password.js a@b.com c@d.com   # just these
//
// create-staff.js is the one to use for a single person, or to make a new
// account. This exists for the moment after moving off Supabase, when nobody's
// password came across and four people need to get back in.
//
// Everyone sharing one password does mean the audit log can no longer tell you
// which of them did something — it records who was signed in, and now anyone
// can be anyone. Worth changing to one each when it stops being convenient.

require('dotenv').config()

const readline = require('readline')
const db = require('../db')
const auth = require('../auth')

// When stdin is not a terminal the password is being piped in, so take the next
// line as it comes. The echo-suppression below only makes sense against a real
// terminal, and trying it on a pipe silently loses the input.
let piped = null
function nextPipedLine() {
  if (piped === null) {
    let data = ''
    try { data = require('fs').readFileSync(0, 'utf8') } catch { /* nothing on stdin */ }
    piped = data.split('\n')
  }
  return piped.shift() ?? ''
}

function askHidden(question) {
  if (!process.stdin.isTTY) return Promise.resolve(nextPipedLine())

  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const onData = char => {
      if (['\n', '\r', ''].includes(char.toString())) return
      readline.clearLine(process.stdout, 0)
      readline.cursorTo(process.stdout, 0)
      process.stdout.write(question)
    }
    process.stdin.on('data', onData)
    rl.question(question, answer => {
      process.stdin.removeListener('data', onData)
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

async function main() {
  const wanted = process.argv.slice(2).map(s => s.trim().toLowerCase()).filter(Boolean)

  const { rows } = wanted.length
    ? await db.query('select id, email, role from app_users where lower(email) = any($1) order by email', [wanted])
    : await db.query("select id, email, role from app_users where role = 'staff' order by email")

  if (!rows.length) {
    console.error(wanted.length ? 'No account matched those addresses.' : 'No staff accounts found.')
    process.exit(1)
  }

  console.log(`\nThis will set one password for ${rows.length} account${rows.length === 1 ? '' : 's'}:\n`)
  rows.forEach(r => console.log(`  ${r.email}${r.role !== 'staff' ? `  (${r.role})` : ''}`))
  console.log()

  const password = await askHidden('New password: ')
  const again = await askHidden('Type it again: ')

  if (password !== again) {
    console.error('\nThose did not match. Nothing was changed.')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('\nUse at least 8 characters. Nothing was changed.')
    process.exit(1)
  }

  for (const r of rows) {
    await auth.setPassword(r.id, password)   // also ends that account's other sessions
    console.log(`  set  ${r.email}`)
  }

  console.log(`\nDone — ${rows.length} account${rows.length === 1 ? '' : 's'} updated.`)
  console.log('Anyone signed in on another device has been signed out.\n')

  await db.pool.end()
}

main().catch(e => {
  console.error('Failed:', e.message)
  process.exit(1)
})
