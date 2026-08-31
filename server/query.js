// Turns the query the browser describes into parameterised SQL.
//
// The front end still writes supabase-style chains —
//   supabase.from('orders').select('*').eq('status', 'created').order('created_at')
// — and the client shim posts that here as plain JSON. This file compiles it.
//
// Two rules run through everything:
//
//   Values are never concatenated. Every one becomes a $n placeholder, so no
//   value a customer types can change the shape of a query.
//
//   Identifiers are never trusted. A table or column name cannot be a
//   placeholder in SQL, so instead each one is checked against the real schema
//   read out of the database at boot. Anything that isn't a genuine column is
//   refused before a query is built — and refused with Postgres's own wording,
//   `column "x" does not exist`, because the app leans on that: several pages
//   retry a save with a column removed when the database turns out not to have
//   it yet.

const db = require('./db')

class QueryError extends Error {
  constructor(message, { code = '42703', status = 400, details = null, hint = null } = {}) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
    this.hint = hint
  }
}

const missingColumn = (table, col) =>
  new QueryError(`column "${col}" of relation "${table}" does not exist`, { code: '42703' })

// ── select list ─────────────────────────────────────────────────────────────
// Accepts "*", "id, name", or a supabase embed like "*, suppliers(name)".
// Returns the SQL fragment plus any joins the embed needs.
function buildSelectList(table, columns) {
  const raw = (columns == null || columns === '') ? '*' : String(columns)
  const base = db.quote(table)
  const parts = splitTopLevel(raw)
  const pieces = []
  const joins = []
  let aliasN = 0

  for (const part of parts) {
    const embed = part.match(/^([a-z_][a-z0-9_]*)\s*\((.*)\)$/i)
    if (embed) {
      const [, relation, inner] = embed
      if (!db.hasTable(relation)) {
        throw new QueryError(`Could not find a relationship between '${table}' and '${relation}'`, { code: 'PGRST200' })
      }
      const fk = db.foreignKey(table, relation)
      if (!fk) {
        throw new QueryError(`Could not find a relationship between '${table}' and '${relation}'`, { code: 'PGRST200' })
      }
      const alias = `emb${aliasN++}`
      const q = db.quote(alias)
      const innerCols = splitTopLevel(inner).filter(Boolean)
      const list = innerCols.length && innerCols[0] !== '*' ? innerCols : [...db.columnsOf(relation)]
      for (const c of list) if (!db.hasColumn(relation, c)) throw missingColumn(relation, c)

      joins.push(
        `left join ${db.quote(relation)} ${q} on ${q}.${db.quote(fk.parentCol)} = ${base}.${db.quote(fk.childCol)}`
      )
      // A missing parent must come back as null, not as an object full of
      // nulls — that is what the front end checks for.
      const obj = list.map(c => `'${c.replace(/'/g, "''")}', ${q}.${db.quote(c)}`).join(', ')
      pieces.push(
        `case when ${q}.${db.quote(fk.parentCol)} is null then null else json_build_object(${obj}) end as ${db.quote(relation)}`
      )
      continue
    }

    if (part === '*') { pieces.push(`${base}.*`); continue }

    const col = part.replace(/^"|"$/g, '')
    if (!db.hasColumn(table, col)) throw missingColumn(table, col)
    pieces.push(`${base}.${db.quote(col)}`)
  }

  if (!pieces.length) pieces.push(`${base}.*`)
  return { list: pieces.join(', '), joins }
}

// Split "a, b, rel(x, y)" on commas that are not inside brackets.
function splitTopLevel(s) {
  const out = []
  let depth = 0, cur = ''
  for (const ch of String(s)) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

// ── where clause ────────────────────────────────────────────────────────────
const FILTER_SQL = {
  eq:    (c, p) => `${c} = ${p}`,
  neq:   (c, p) => `${c} <> ${p}`,
  gt:    (c, p) => `${c} > ${p}`,
  gte:   (c, p) => `${c} >= ${p}`,
  lt:    (c, p) => `${c} < ${p}`,
  lte:   (c, p) => `${c} <= ${p}`,
  like:  (c, p) => `${c}::text like ${p}`,
  ilike: (c, p) => `${c}::text ilike ${p}`,
  in:    (c, p) => `${c} = any(${p})`,
  contains: (c, p) => `${c} @> ${p}`,
}

function buildWhere(table, filters, params) {
  const clauses = []
  const base = db.quote(table)

  for (const f of filters || []) {
    const [op, col, value] = Array.isArray(f) ? f : [f.op, f.column, f.value]
    if (!db.hasColumn(table, col)) throw missingColumn(table, col)
    const c = `${base}.${db.quote(col)}`

    // `is` takes only null / true / false, so it is written straight in — there
    // is no user-supplied text to place.
    if (op === 'is') {
      if (value === null || value === 'null') { clauses.push(`${c} is null`); continue }
      if (value === true || value === 'true') { clauses.push(`${c} is true`); continue }
      if (value === false || value === 'false') { clauses.push(`${c} is false`); continue }
      throw new QueryError(`Unsupported value for is(): ${String(value)}`, { code: 'PGRST100' })
    }

    const build = FILTER_SQL[op]
    if (!build) throw new QueryError(`Unsupported filter '${op}'`, { code: 'PGRST100' })

    if (op === 'in') {
      const arr = Array.isArray(value) ? value : [value]
      // An empty in() must match nothing rather than every row.
      if (!arr.length) { clauses.push('false'); continue }
      params.push(arr)
    } else if (op === 'contains') {
      params.push(JSON.stringify(value))
    } else {
      params.push(value)
    }
    clauses.push(build(c, `$${params.length}`))
  }

  return clauses.length ? ` where ${clauses.join(' and ')}` : ''
}

// ── order / limit ───────────────────────────────────────────────────────────
function buildOrder(table, order) {
  if (!order || !order.length) return ''
  const base = db.quote(table)
  const parts = order.map(o => {
    const { column, ascending = true, nullsFirst } = Array.isArray(o)
      ? { column: o[0], ascending: o[1] !== false, nullsFirst: o[2] }
      : o
    if (!db.hasColumn(table, column)) throw missingColumn(table, column)
    const dir = ascending ? 'asc' : 'desc'
    // Postgres puts nulls last on asc and first on desc; PostgREST does the
    // same, so only spell it out when the caller asked for something else.
    const nulls = nullsFirst === undefined ? '' : (nullsFirst ? ' nulls first' : ' nulls last')
    return `${base}.${db.quote(column)} ${dir}${nulls}`
  })
  return ` order by ${parts.join(', ')}`
}

function buildLimit(limit, offset, params) {
  let sql = ''
  if (limit != null && Number.isFinite(Number(limit))) {
    params.push(Math.max(0, Math.floor(Number(limit))))
    sql += ` limit $${params.length}`
  }
  if (offset != null && Number.isFinite(Number(offset))) {
    params.push(Math.max(0, Math.floor(Number(offset))))
    sql += ` offset $${params.length}`
  }
  return sql
}

// ── write payloads ──────────────────────────────────────────────────────────
// Checks every key, drops the columns the database computes for itself
// (total_price, total_cost), and applies any value the policy has locked —
// a shopper saving their profile cannot claim someone else's id.
function prepareRows(table, values, locked) {
  const rows = Array.isArray(values) ? values : [values]
  if (!rows.length) throw new QueryError('No rows to write', { code: 'PGRST102' })

  const generated = db.generatedOf(table)
  const cleaned = rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new QueryError('Each row must be an object', { code: 'PGRST102' })
    }
    const out = {}
    for (const [k, v] of Object.entries(row)) {
      if (generated.has(k)) continue           // the database owns this one
      if (!db.hasColumn(table, k)) throw missingColumn(table, k)
      out[k] = v
    }
    if (locked) out[locked.column] = locked.value
    return out
  })

  // PostgREST insists every object in a batch has the same keys. We are kinder:
  // the union is used, and a row missing a key gets the column's own default
  // rather than a null that would trample it.
  const keys = [...new Set(cleaned.flatMap(Object.keys))]
  if (!keys.length) throw new QueryError('No writable columns in payload', { code: 'PGRST102' })
  return { rows: cleaned, keys }
}

// Encoding a value for its column is schema-aware — see db.encodeFor. It has to
// be: the reconciliation page stores a plain date string in app_settings.value,
// which is jsonb, and a bare string is not a JSON document.
const jsonSafe = (table, col, v) => db.encodeFor(table, col, v)

// ── the compiler ────────────────────────────────────────────────────────────
/**
 * @param {object} q      the request body from the client shim
 * @param {object} [opts] { locked: {column, value} } from the policy layer
 * @returns {{text: string, params: any[]}}
 */
function compile(q, opts = {}) {
  const { table, op } = q
  const locked = opts.locked || null

  if (!db.hasTable(table)) {
    throw new QueryError(`relation "public.${table}" does not exist`, { code: '42P01', status: 404 })
  }

  const params = []
  const base = db.quote(table)
  const wantsRows = op === 'select' || q.returning !== false

  // A select list is needed for `returning` too, but embeds cannot be joined
  // onto a returning clause, so writes only ever return their own columns.
  const selectList = op === 'select'
    ? buildSelectList(table, q.columns)
    : { list: writeReturningList(table, q.columns), joins: [] }

  if (op === 'select') {
    const where = buildWhere(table, mergedFilters(q.filters, locked), params)
    const joins = selectList.joins.length ? ' ' + selectList.joins.join(' ') : ''
    const text =
      `select ${selectList.list} from ${base}${joins}${where}` +
      buildOrder(table, q.order) + buildLimit(q.limit, q.offset, params)
    return { text, params }
  }

  if (op === 'insert' || op === 'upsert') {
    const { rows, keys } = prepareRows(table, q.values, locked)
    const cols = keys.map(k => db.quote(k)).join(', ')

    const tuples = rows.map(row =>
      '(' + keys.map(k => {
        if (!(k in row)) return 'default'
        params.push(jsonSafe(table, k, row[k]))
        return `$${params.length}`
      }).join(', ') + ')'
    ).join(', ')

    let text = `insert into ${base} (${cols}) values ${tuples}`

    if (op === 'upsert') {
      const conflict = resolveConflict(table, q.onConflict)
      const updatable = keys.filter(k => !conflict.includes(k))
      text += ` on conflict (${conflict.map(c => db.quote(c)).join(', ')}) `
      text += updatable.length
        ? `do update set ${updatable.map(k => `${db.quote(k)} = excluded.${db.quote(k)}`).join(', ')}`
        : 'do nothing'
    }

    if (wantsRows) text += ` returning ${selectList.list}`
    return { text, params }
  }

  if (op === 'update') {
    const { rows, keys } = prepareRows(table, q.values, locked)
    if (rows.length !== 1) throw new QueryError('update takes a single object', { code: 'PGRST102' })
    const row = rows[0]

    const sets = keys.map(k => {
      params.push(jsonSafe(table, k, row[k]))
      return `${db.quote(k)} = $${params.length}`
    }).join(', ')

    const where = buildWhere(table, mergedFilters(q.filters, locked), params)
    // An unfiltered update would rewrite the whole table. supabase-js allows it;
    // we do not, because it is never what the app means.
    if (!where) throw new QueryError('An update needs at least one filter', { code: 'PGRST103', status: 400 })

    let text = `update ${base} set ${sets}${where}`
    if (wantsRows) text += ` returning ${selectList.list}`
    return { text, params }
  }

  if (op === 'delete') {
    const where = buildWhere(table, mergedFilters(q.filters, locked), params)
    if (!where) throw new QueryError('A delete needs at least one filter', { code: 'PGRST103', status: 400 })
    let text = `delete from ${base}${where}`
    if (wantsRows) text += ` returning ${selectList.list}`
    return { text, params }
  }

  throw new QueryError(`Unsupported operation '${op}'`, { code: 'PGRST100' })
}

// `returning` cannot carry an embed, so strip those and keep the plain columns.
function writeReturningList(table, columns) {
  const raw = (columns == null || columns === '') ? '*' : String(columns)
  const parts = splitTopLevel(raw).filter(p => !/^[a-z_][a-z0-9_]*\s*\(/i.test(p))
  if (!parts.length || parts.includes('*')) return '*'
  for (const c of parts) if (!db.hasColumn(table, c)) throw missingColumn(table, c)
  return parts.map(c => db.quote(c)).join(', ')
}

function mergedFilters(filters, locked) {
  const list = Array.isArray(filters) ? [...filters] : []
  if (locked) list.push(['eq', locked.column, locked.value])
  return list
}

function resolveConflict(table, onConflict) {
  const given = onConflict
    ? String(onConflict).split(',').map(s => s.trim()).filter(Boolean)
    : db.primaryKeyOf(table)
  if (!given.length) {
    throw new QueryError(`No conflict target for upsert on '${table}'`, { code: 'PGRST100' })
  }
  for (const c of given) if (!db.hasColumn(table, c)) throw missingColumn(table, c)
  return given
}

module.exports = { compile, QueryError, buildSelectList, splitTopLevel }
