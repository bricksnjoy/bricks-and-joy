/**
 * Brick's & Joy — Supplier Catalog ↔ Google Sheets two-way sync
 * One TAB PER SUPPLIER, named by the supplier's CONTACT NAME.
 *
 * Script Properties:
 *   SUPABASE_URL = https://YOUR_PROJECT_REF.supabase.co
 *   SUPABASE_KEY = your Supabase anon/publishable key
 *
 * Run setup() once.
 */

const COLUMNS = ['id','supplier_id','supplier_name','product_name','sku','category','brand','age_range','pieces','sizes','weight','dimensions','cost_price','sell_price','unit','description','tags','notes','image_url']
const NUMERIC = ['pieces','cost_price','sell_price']

function cfg_() {
  const p = PropertiesService.getScriptProperties()
  return { url: p.getProperty('SUPABASE_URL'), key: p.getProperty('SUPABASE_KEY') }
}
function sb_(path, opts) {
  const { url, key } = cfg_()
  return UrlFetchApp.fetch(url + '/rest/v1/' + path, Object.assign({
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    muteHttpExceptions: true,
  }, opts))
}

// Suppliers: id -> record, contact-name(lower) -> record, company-name(lower) -> record
function loadSuppliers_() {
  let arr = []
  try { arr = JSON.parse(sb_('suppliers?select=id,name,contact_name', { method: 'get' }).getContentText()) } catch (x) {}
  const byId = {}, byContact = {}, byName = {}
  arr.forEach(s => {
    byId[s.id] = s
    const c = (s.contact_name || s.name || '').toLowerCase().trim()
    if (c && !byContact[c]) byContact[c] = s
    const n = (s.name || '').toLowerCase().trim()
    // Prefer the same-named vendor that HAS a contact (handles duplicate vendors)
    if (n && (!byName[n] || (s.contact_name && !byName[n].contact_name))) byName[n] = s
  })
  return { byId, byContact, byName }
}
// Contact name to show as the tab for a product. Resolve by id; if that vendor has
// no contact, borrow the contact from another vendor with the same company name.
function contactFor_(rec, sup) {
  const own = sup.byId[rec.supplier_id]
  let contact = own && own.contact_name
  if (!contact) {
    const company = (own && own.name) || rec.supplier_name
    const named = company ? sup.byName[company.toLowerCase().trim()] : null
    contact = (named && named.contact_name) || company
  }
  return contact || rec.supplier_name || 'No supplier'
}

function isCatalogTab_(sh) {
  const first = sh.getRange(1, 1, 1, COLUMNS.length).getValues()[0]
  return first.join('|').toLowerCase() === COLUMNS.join('|').toLowerCase()
}
function tabName_(name) {
  let n = (name == null || name === '' ? 'No supplier' : String(name)).replace(/[:\\/?*\[\]]/g, ' ').trim().slice(0, 99)
  return n || 'No supplier'
}
function getOrCreateTab_(name) {
  const ss = SpreadsheetApp.getActive()
  let sh = ss.getSheetByName(name)
  if (!sh) sh = ss.insertSheet(name)
  if (!isCatalogTab_(sh)) sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold')
  return sh
}
function rowToObj_(vals) {
  const o = {}
  COLUMNS.forEach((c, i) => {
    let v = vals[i]
    if (v === '' || v === null || v === undefined) { o[c] = null; return }
    o[c] = NUMERIC.indexOf(c) >= 0 ? Number(v) : v
  })
  return o
}

// ── Sheet → App ──────────────────────────────────────────────────────────────
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
  const payload = Object.assign({}, obj); delete payload.id
  if (obj.id) {
    sb_('supplier_products?id=eq.' + obj.id, { method: 'patch', payload: JSON.stringify(payload) })
  } else {
    const res = sb_('supplier_products', { method: 'post', payload: JSON.stringify(payload) })
    try { const arr = JSON.parse(res.getContentText()); if (arr[0] && arr[0].id) sh.getRange(row, 1).setValue(arr[0].id) } catch (x) {}
  }
}

// ── App → Sheet (one tab per supplier contact) ───────────────────────────────
function syncFromSupabase() {
  const sup = loadSuppliers_()
  const data = JSON.parse(sb_('supplier_products?select=' + COLUMNS.join(',') + '&order=product_name', { method: 'get' }).getContentText())
  const groups = {}, display = {}
  data.forEach(rec => {
    const disp = tabName_(contactFor_(rec, sup))
    const key = disp.toLowerCase()
    if (!display[key]) display[key] = disp
    ;(groups[key] = groups[key] || []).push(rec)
  })
  Object.keys(groups).forEach(key => {
    const sh = getOrCreateTab_(display[key])
    const last = sh.getLastRow()
    const existing = {}
    if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach((r, i) => { if (r[0]) existing[r[0]] = i + 2 })
    groups[key].forEach(rec => {
      const rowVals = COLUMNS.map(c => rec[c] == null ? '' : rec[c])
      if (existing[rec.id]) sh.getRange(existing[rec.id], 1, 1, COLUMNS.length).setValues([rowVals])
      else sh.appendRow(rowVals)
    })
  })
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['onEditInstallable', 'syncFromSupabase'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create()
  ScriptApp.newTrigger('syncFromSupabase').timeBased().everyMinutes(10).create()
  syncFromSupabase()
  SpreadsheetApp.getUi().alert('Catalog Sync is on — one tab per supplier contact.')
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Catalog Sync')
    .addItem('Pull latest from app', 'syncFromSupabase')
    .addItem('Run setup', 'setup')
    .addToUi()
}
