#!/usr/bin/env node
// Make a back-office account.
//
// This is the only way a staff account comes into existence. Signing up on the
// shop always creates a customer, so nobody can give themselves the back office
// by filling in a form — they need a shell on this server.
//
//   cd server && node scripts/create-staff.js you@example.com "Your Name"
//
// The password is asked for on the terminal and never appears in your shell
// history. Run it again with the same address to change that person's password.

require('dotenv').config()

const readline = require('readline')
const db = require('../db')
const auth = require('../auth')

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const onData = char => {
      // Redraw the prompt with nothing after it, so the password never shows.
      if (['\n', '\r', ''].includes(char.toString())) return
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
  const [email, fullName] = process.argv.slice(2)
  if (!email) {
    console.error('Usage: node scripts/create-staff.js <email> ["Full Name"]')
    process.exit(1)
  }

  const password = await askHidden(`Password for ${email}: `)
  const again = await askHidden('Type it again: ')
  if (password !== again) {
    console.error('Those did not match. Nothing was changed.')
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('Use at least 8 characters. Nothing was changed.')
    process.exit(1)
  }

  const existing = await auth.findUserByEmail(email)
  if (existing) {
    await auth.setPassword(existing.id, password)
    if (existing.role !== 'staff') {
      await db.query('update app_users set role = $1 where id = $2', ['staff', existing.id])
      await db.query('update profiles set role = $1 where id = $2', ['staff', existing.id])
    }
    console.log(`Updated ${email} — password changed, role is staff.`)
    console.log('Every other device signed in as this person has been signed out.')
  } else {
    const user = await auth.createUser({ email, password, fullName, role: 'staff' })
    console.log(`Created staff account ${user.email} (${user.id}).`)
  }

  await db.pool.end()
}

main().catch(e => {
  console.error('Failed:', e.message)
  process.exit(1)
})
