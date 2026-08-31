/**
 * Brick's & Joy — Supplier Catalog <-> Google Sheets two-way sync
 * One TAB PER SUPPLIER, named by the supplier's CONTACT NAME.
 *
 * This used to talk to Supabase's PostgREST directly with the anon key. It now
 * signs in to our own API the same way a person does, and gets an access token
 * that lasts an hour, which is refreshed here as needed.
 *
 * Script Properties (Extensions -> Apps Script -> Project Settings):
 *   API_URL      = https://bricksandjoy.com/api
 *   API_EMAIL    = a staff account's email
 *   API_PASSWORD = that account's password
 *
 * Make a separate staff account for this — sheets@bricksandjoy.com or similar —
 * rather than using your own. The password sits in Script Properties, and an
 * account you can revoke on its own is worth having.
 *
 *   cd server && node scripts/create-staff.js sheets@bricksandjoy.com "Sheets Sync"
 *
 * Run setup() once.
 */

const COLUMNS = ['id','supplier_id','supplier_name','product_name','sku','category','brand','age_range','pieces','sizes','weight','dimensions','cost_price','sell_price','unit','description','tags','notes','image_url']
const NUMERIC = ['pieces','cost_price','sell_price']

// ── talking to the API ───────────────────────────────────────────────────────
function cfg_() {
  const p = PropertiesService.getScriptProperties()
  return {
    url: String(p.getProperty('API_URL') || '').replace(/\/+$/, ''),
    email: p.getProperty('API_EMAIL'),
    password: p.getProperty('API_PASSWORD'),
  }
}

// Signs in and keeps the token until it is nearly expired. Apps Script runs
// this on every edit, so signing in each time would be both slow and rude.
function token_() {
  const p = PropertiesService.getScriptProperties()
  const cached = p.getProperty('API_TOKEN')
  const until = Number(p.getProperty('API_TOKEN_UNTIL') || 0)
  if (cached && until > Date.now() + 60000) return cached

  const c = cfg_()
  if (!c.url || !c.email || !c.password) {
    throw new Error('Set API_URL, API_EMAIL and API_PASSWORD in Project Settings -> Script Properties')
  }

  const res = UrlFetchApp.fetch(c.url + '/auth/signin', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ email: c.email, password: c.password }),
    muteHttpExceptions: true,
  })
  const body = JSON.parse(res.getContentText())
  if (!body.data || !body.data.session) {
    throw new Error('Could not sign in: ' + ((body.error && body.error.message) || res.getContentText().slice(0, 120)))
  }

  p.setProperty('API_TOKEN', body.data.session.access_token)
  p.setProperty('API_TOKEN_UNTIL', String(body.data.session.expires_at * 1000))
  return body.data.session.access_token
}

/**
 * One query. Same shape the app's own pages use.
 *   query_({ table: 'suppliers', op: 'select', columns: 'id, name, contact_name' })
 */
function query_(q) {
  const c = cfg_()
  const res = UrlFetchApp.fetch(c.url + '/db/query', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token_() },
    payload: JSON.stringify(q),
    muteHttpExceptions: true,
  })

  const body = JSON.parse(res.getContentText() || '{}')

  // The token expired between being cached and being used — drop it and retry
  // once with a fresh one.
  if (res.getResponseCode() === 401) {
    PropertiesService.getScriptProperties().deleteProperty('API_TOKEN')
    const again = UrlFetchApp.fetch(c.url + '/db/query', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token_() },
      payload: JSON.stringify(q),
      muteHttpExceptions: true,
    })
    const b2 = JSON.parse(again.getContentText() || '{}')
    if (b2.error) throw new Error(b2.error.message)
    return b2.data
  }

  if (body.error) throw new Error(body.error.message)
  return body.data
}

// ── suppliers ────────────────────────────────────────────────────────────────
// id -> record, contact-name(lower) -> record, company-name(lower) -> record
function loadSuppliers_() {
  var arr = []
  try { arr = query_({ table: 'suppliers', op: 'select', columns: 'id, name, contact_name' }) || [] } catch (x) {}
  const byId = {}, byContact = {}, byName = {}
  arr.forEach(function (s) {
    byId[s.id] = s
    const c = (s.contact_name || s.name || '').toLowerCase().trim()
    if (c && !byContact[c]) byContact[c] = s
    const n = (s.name || '').toLowerCase().trim()
    // Prefer the same-named vendor that HAS a contact (handles duplicate vendors)
    if (n && (!byName[n] || (s.contact_name && !byName[n].contact_name))) byName[n] = s
  })
  return { byId: byId, byContact: byContact, byName: byName }
}

// Contact name to show as the tab for a product. Resolve by id; if that vendor
// has no contact, borrow the contact from another vendor with the same company.
function contactFor_(rec, sup) {
  const own = sup.byId[rec.supplier_id]
  var contact = own && own.contact_name
  if (!contact) {
    const company = (own && own.name) || rec.supplier_name
    const named = company ? sup.byName[company.toLowerCase().trim()] : null
    contact = (named && named.contact_name) || company
  }
  return contact || rec.supplier_name || 'No supplier'
}

// ── sheet plumbing ───────────────────────────────────────────────────────────
function isCatalogTab_(sh) {
  const first = sh.getRange(1, 1, 1, COLUMNS.length).getValues()[0]
  return first.join('|').toLowerCase() === COLUMNS.join('|').toLowerCase()
}
function tabName_(name) {
  var n = (name == null || name === '' ? 'No supplier' : String(name)).replace(/[:\\/?*\[\]]/g, ' ').trim().slice(0, 99)
  return n || 'No supplier'
}
function getOrCreateTab_(name) {
  const ss = SpreadsheetApp.getActive()
  var sh = ss.getSheetByName(name)
  if (!sh) sh = ss.insertSheet(name)
  if (!isCatalogTab_(sh)) sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold')
  return sh
}
function rowToObj_(vals) {
  const o = {}
  COLUMNS.forEach(function (c, i) {
    var v = vals[i]
    if (v === '' || v === null || v === undefined) { o[c] = null; return }
    o[c] = NUMERIC.indexOf(c) >= 0 ? Number(v) : v
  })
  return o
}

// ── Sheet -> App ─────────────────────────────────────────────────────────────
function onEditInstallable(e) {
  const sh = e.range.getSheet()
  if (!isCatalogTab_(sh)) return
  const row = e.range.getRow()
  if (row === 1) return

  const vals = sh.getRange(row, 1, 1, COLUMNS.length).getValues()[0]
  const obj = rowToObj_(vals)
  if (!obj.product_name) return

  // The tab is a contact name — resolve the supplier from it
  const sup = loadSuppliers_()
  const s = sup.byContact[sh.getName().toLowerCase().trim()]
  if (s) { obj.supplier_id = s.id; obj.supplier_name = s.name }
  else if (!obj.supplier_name) obj.supplier_name = sh.getName()

  const payload = {}
  COLUMNS.forEach(function (c) { if (c !== 'id') payload[c] = obj[c] })

  if (obj.id) {
    query_({
      table: 'supplier_products', op: 'update', values: payload,
      filters: [['eq', 'id', obj.id]], returning: false,
    })
  } else {
    const created = query_({
      table: 'supplier_products', op: 'insert', values: payload,
      returning: true, columns: 'id', single: 'one',
    })
    if (created && created.id) sh.getRange(row, 1).setValue(created.id)
  }
}

// ── App -> Sheet (one tab per supplier contact) ──────────────────────────────
function syncFromApp() {
  const sup = loadSuppliers_()
  const data = query_({
    table: 'supplier_products', op: 'select',
    columns: COLUMNS.join(', '),
    order: [['product_name', true]],
  }) || []

  const groups = {}, display = {}
  data.forEach(function (rec) {
    const disp = tabName_(contactFor_(rec, sup))
    const key = disp.toLowerCase()
    if (!display[key]) display[key] = disp
    ;(groups[key] = groups[key] || []).push(rec)
  })

  Object.keys(groups).forEach(function (key) {
    const sh = getOrCreateTab_(display[key])
    const last = sh.getLastRow()
    const existing = {}
    if (last > 1) {
      sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) { if (r[0]) existing[r[0]] = i + 2 })
    }
    groups[key].forEach(function (rec) {
      const rowVals = COLUMNS.map(function (c) { return rec[c] == null ? '' : rec[c] })
      if (existing[rec.id]) sh.getRange(existing[rec.id], 1, 1, COLUMNS.length).setValues([rowVals])
      else sh.appendRow(rowVals)
    })
  })
}

// Kept under its old name so any trigger created before the move still fires.
function syncFromSupabase() { syncFromApp() }

// Run this to see exactly what contact name each supplier resolves to.
// Check View -> Logs after running.
function debugSuppliers() {
  const sup = loadSuppliers_()
  const data = query_({
    table: 'supplier_products', op: 'select',
    columns: 'supplier_id, supplier_name, product_name', limit: 30,
  }) || []
  Logger.log('=== SUPPLIERS IN DATABASE ===')
  Object.keys(sup.byId).forEach(function (id) {
    const s = sup.byId[id]
    Logger.log(s.name + ' | contact: ' + (s.contact_name || '(none)'))
  })
  Logger.log('=== PRODUCT -> TAB MAPPING ===')
  data.forEach(function (rec) { Logger.log(rec.product_name + ' -> ' + contactFor_(rec, sup)) })
}

// Confirms the credentials work before anything else is tried.
function testConnection() {
  const rows = query_({ table: 'suppliers', op: 'select', columns: 'id', limit: 1 })
  SpreadsheetApp.getUi().alert('Connected. The API answered with ' + (rows ? rows.length : 0) + ' row(s).')
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction()
    if (['onEditInstallable', 'syncFromApp', 'syncFromSupabase'].indexOf(fn) >= 0) ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create()
  ScriptApp.newTrigger('syncFromApp').timeBased().everyMinutes(10).create()
  syncFromApp()
  SpreadsheetApp.getUi().alert('Catalog Sync is on — one tab per supplier contact.')
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Catalog Sync')
    .addItem('Pull latest from app', 'syncFromApp')
    .addItem('Test connection', 'testConnection')
    .addItem('Run setup', 'setup')
    .addToUi()
}
