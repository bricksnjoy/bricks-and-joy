// The one connection to PostgreSQL, plus a cached picture of what the database
// actually looks like.
//
// That second part matters more than it sounds. Every table and column name the
// browser sends is checked against this picture before it is allowed anywhere
// near a query string. Values are always parameterised ($1, $2 …), but an
// identifier cannot be parameterised in SQL — so the only safe way to build
// `select id, name from orders` from user input is to refuse any identifier
// that is not a real column of a real table. That check lives here.

const { Pool } = require('pg')

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
  pks: new Map(),         // name -> [column]
  fks: new Map(),         // "child->parent" -> { childCol, parentCol }
  loadedAt: 0,
}

async function loadSchema() {
  const cols = await pool.query(`
    select table_name, column_name, is_generated, identity_generation
      from information_schema.columns
     where table_schema = 'public'
     order by table_name, ordinal_position`)

  const tables = new Map()
  const generated = new Map()
  for (const r of cols.rows) {
    if (!tables.has(r.table_name)) { tables.set(r.table_name, new Set()); generated.set(r.table_name, new Set()) }
    tables.get(r.table_name).add(r.column_name)
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

  schemaCache = { tables, generated, pks, fks, loadedAt: Date.now() }
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
const primaryKeyOf = name => schemaCache.pks.get(name) || []

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
  hasTable, hasColumn, columnsOf, generatedOf, primaryKeyOf, foreignKey, quote,
}
