// Database functions the front end calls by name — supabase.rpc('…').
//
// Only the functions listed in policies.js can be reached, and only with the
// arguments named there. A shopper checking a coupon code is the whole reason
// this exists: it answers "is this code good for this basket" without the
// coupon table ever being readable.

const express = require('express')
const db = require('../db')
const { FUNCTIONS } = require('../policies')

const router = express.Router()

router.post('/:name', async (req, res) => {
  const spec = FUNCTIONS[req.params.name]
  if (!spec) {
    return res.status(404).json({ data: null, error: { message: `Function '${req.params.name}' is not available`, code: 'PGRST202' } })
  }
  if (!spec.roles.includes(req.auth.role)) {
    return res.status(req.auth.role === 'anon' ? 401 : 403)
      .json({ data: null, error: { message: 'Not allowed', code: '42501' } })
  }

  // The argument names come from the allow-list above, never from the request,
  // so the call is built from a fixed shape with the values parameterised.
  const args = req.body || {}
  const params = spec.args.map(a => args[a] ?? null)
  const placeholders = spec.args.map((a, i) => `${a} => $${i + 1}`).join(', ')

  try {
    const out = await db.query(`select * from ${db.quote(req.params.name)}(${placeholders})`, params)
    // A set-returning function gives rows; a scalar one gives a single value.
    // supabase-js hands back the array for the first and the value for the
    // second, and the shop reads data[0], so the array is what goes back.
    return res.json({ data: out.rows, error: null })
  } catch (e) {
    return res.status(400).json({ data: null, error: { message: e.message, code: e.code || 'P0000', details: e.detail || null } })
  }
})

module.exports = router
