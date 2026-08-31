// The endpoint every supabase-style call in the app lands on.
//
// The client shim collects a chain —
//   supabase.from('orders').select('*').eq('status', 'created').limit(10)
// — into one JSON description and posts it here. This route checks who is
// asking, hands the description to the compiler, runs the result, and answers
// in the { data, error } shape the front end has always read.

const express = require('express')
const db = require('../db')
const { compile, QueryError } = require('../query')
const { authorize } = require('../policies')

const router = express.Router()

// PostgREST's own codes, so error handling in the app keeps working unchanged.
const NOT_ONE_ROW = {
  code: 'PGRST116',
  message: 'JSON object requested, multiple (or no) rows returned',
  details: 'Results contain 0 rows',
  hint: null,
}

function fail(res, status, message, code = null, details = null, hint = null) {
  return res.status(status).json({ data: null, error: { message, code, details, hint } })
}

router.post('/query', async (req, res) => {
  const q = req.body || {}
  const { table, op } = q
  const { role, userId } = req.auth

  if (typeof table !== 'string' || !table) return fail(res, 400, 'A table is required', 'PGRST100')
  if (!['select', 'insert', 'update', 'upsert', 'delete'].includes(op)) {
    return fail(res, 400, `Unsupported operation '${op}'`, 'PGRST100')
  }

  // An upsert can create or modify, so it needs both permissions.
  const needed = op === 'upsert' ? ['insert', 'update'] : [op]
  let locked = null
  for (const need of needed) {
    const verdict = authorize(table, need, role, userId)
    if (!verdict.ok) {
      return fail(res, role === 'anon' ? 401 : 403, verdict.reason, '42501')
    }
    if (verdict.force) locked = verdict.force
  }

  let sql
  try {
    sql = compile(q, { locked })
  } catch (e) {
    if (e instanceof QueryError) return fail(res, e.status, e.message, e.code, e.details, e.hint)
    throw e
  }

  let result
  try {
    result = await db.query(sql.text, sql.params)
  } catch (e) {
    // Postgres said no. Pass its own code and wording through: several pages
    // read the message to work out which column a database is missing and
    // retry without it, and that behaviour has to survive the move.
    const status = e.code === '23505' ? 409 : 400
    return fail(res, status, e.message, e.code || 'P0000', e.detail || null, e.hint || null)
  }

  const rows = result.rows || []

  if (q.single === 'one') {
    if (rows.length !== 1) return res.status(406).json({ data: null, error: NOT_ONE_ROW })
    return res.json({ data: rows[0], error: null })
  }
  if (q.single === 'maybe') {
    if (rows.length > 1) return res.status(406).json({ data: null, error: NOT_ONE_ROW })
    return res.json({ data: rows[0] ?? null, error: null })
  }

  // A write without .select() chained on it returns nothing, same as before.
  if (op !== 'select' && q.returning === false) return res.json({ data: null, error: null })

  return res.json({ data: rows, error: null })
})

// Lets the front end confirm the database is reachable without running a query
// that a policy might refuse.
router.get('/health', async (_req, res) => {
  try {
    await db.query('select 1')
    res.json({ ok: true, tables: db.schema().tables.size })
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message })
  }
})

module.exports = router
