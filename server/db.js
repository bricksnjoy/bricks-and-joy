// The one connection to PostgreSQL, plus a cached picture of what the database
// actually looks like.
//
// That second part matters more than it sounds. Every table and column name the
// browser sends is checked against this picture before it is allowed anywhere
// near a query string. Values are always parameterised ($1, $2 …), but an
// identifier cannot be parameterised in SQL — so the only safe way to build
// `select id, name from orders` from user input is to refuse any identifier
// that is not a real column of a real table. That check lives here.

const { Pool, types } = require('pg')

// ── speaking the same dialect PostgREST did ─────────────────────────────────
// The front end was written against Supabase, and every page reads dates as
// plain 'YYYY-MM-DD' strings: `o.order_date === todayStr`, `.startsWith('2026-08')`,
// and the date used directly as a key when grouping a chart.
//
// node-postgres does something more helpful and, here, wrong: it turns a DATE
// into a JavaScript Date at *local* midnight. Serialised to JSON on a server
// set to Indian/Maldives that becomes "2026-08-26T19:00:00.000Z" — the day
// before, wearing a timestamp. Exact-date matches then never match and charts
// group by a key nothing else uses, which is subtle enough to look like the
// data failed to migrate rather than like a type conversion.
//
// So DATE is handed back untouched, exactly as it comes off the wire.
types.setTypeParser(1082, v => v)          // date

// Same reasoning for the numeric types. PostgREST sends them as JSON numbers;
// node-postgres sends strings, to protect a precision this shop's money does
// not have. Everything downstream already assumes numbers.
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)))   // numeric
types.setTypeParser(20,   v => (v === null ? null : parseInt(v, 10))) // bigint

// Timestamps are left alone: pg parses them to Date, which serialises to the
// same ISO string PostgREST produced, and every caller passes them to new Date().

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on('error', err => console.error('[db] idle client error:', err.message))

// table/view name -> Set of column names, and the ordered column list.
let schemaCache = {
  tables: new Map(),      // name -> Set(column)
  generated: new Map(),   // name -> Set(column) the database computes itself
  jsonCols: new Map(),    // name -> Set(column) of type json/jsonb
  pks: new Map(),         // name -> [column]
  fks: new Map(),         // "child->parent" -> { childCol, parentCol }
  loadedAt: 0,
}

async function loadSchema() {
  const cols = await pool.query(`
    select table_name, column_name, is_generated, identity_generation, data_type
      from information_schema.columns
     where table_schema = 'public'
     order by table_name, ordinal_position`)

  const tables = new Map()
  const generated = new Map()
  const jsonCols = new Map()
  for (const r of cols.rows) {
    if (!tables.has(r.table_name)) {
      tables.set(r.table_name, new Set())
      generated.set(r.table_name, new Set())
      jsonCols.set(r.table_name, new Set())
    }
    tables.get(r.table_name).add(r.column_name)
    // A jsonb column will not take a bare string: 'hello' is not JSON, only
    // '"hello"' is. Objects and arrays get encoded on their way out by
    // accident of being objects, but a plain string or number stored in a
    // jsonb column has to be encoded deliberately — so we need to know which
    // columns those are.
    if (r.data_type === 'jsonb' || r.data_type === 'json') {
      jsonCols.get(r.table_name).add(r.column_name)
    }
    // total_price and total_cost are computed by the database. Postgres rejects
    // any attempt to write them, so they are stripped from write payloads.
    if (r.is_generated === 'ALWAYS' || r.identity_generation === 'ALWAYS') {
      generated.get(r.table_name).add(r.column_name)
    }
  }

  // Primary keys, so an upsert without an explicit onConflict lands on the same
  // column Supabase would have used.
  const pk = await pool.query(`
    select tc.table_name, kcu.column_name, kcu.ordinal_position
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
     where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
     order by tc.table_name, kcu.ordinal_position`)

  const pks = new Map()
  for (const r of pk.rows) {
    if (!pks.has(r.table_name)) pks.set(r.table_name, [])
    pks.get(r.table_name).push(r.column_name)
  }

  // Foreign keys, so an embedded select ("*, suppliers(name)") knows which
  // column joins the two tables without us hard-coding it.
  const fk = await pool.query(`
    select tc.table_name        as child,
           kcu.column_name      as child_col,
           ccu.table_name       as parent,
           ccu.column_name      as parent_col
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`)

  const fks = new Map()
  for (const r of fk.rows) {
    const key = `${r.child}->${r.parent}`
    if (!fks.has(key)) fks.set(key, { childCol: r.child_col, parentCol: r.parent_col })
  }

  schemaCache = { tables, generated, jsonCols, pks, fks, loadedAt: Date.now() }
  console.log(`[db] schema loaded: ${tables.size} tables/views`)
  return schemaCache
}

const schema = () => schemaCache

function hasTable(name) {
  return schemaCache.tables.has(name)
}

function columnsOf(name) {
  return schemaCache.tables.get(name) || new Set()
}

function hasColumn(table, col) {
  return columnsOf(table).has(col)
}

function foreignKey(child, parent) {
  return schemaCache.fks.get(`${child}->${parent}`) || null
}

const generatedOf = name => schemaCache.generated.get(name) || new Set()
const jsonColumnsOf = name => schemaCache.jsonCols.get(name) || new Set()
const primaryKeyOf = name => schemaCache.pks.get(name) || []

/**
 * Prepare one value for its column.
 *
 * Everything bound for a json/jsonb column is encoded, whatever its shape.
 * Without this, `{ value: ['a','b'] }` works (an array happens to encode) but
 * `{ value: '2026-01-01' }` fails with "invalid input syntax for type json",
 * because a bare string is not a JSON document. Both go to the same column.
 */
function encodeFor(table, column, v) {
  if (v === undefined || v === null) return null
  if (jsonColumnsOf(table).has(column)) return JSON.stringify(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}

// Quote an identifier we have already proved is real. Belt and braces: even a
// verified name goes through quoting, so a column called "order" cannot
// accidentally become a keyword.
const quote = id => `"${String(id).replace(/"/g, '""')}"`

const query = (text, params) => pool.query(text, params)

async function withTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) {
    try { await client.query('rollback') } catch { /* connection already gone */ }
    throw e
  } finally {
    client.release()
  }
}

module.exports = {
  pool, query, withTransaction, loadSchema, schema,
  hasTable, hasColumn, columnsOf, generatedOf, jsonColumnsOf, primaryKeyOf,
  foreignKey, quote, encodeFor,
}
