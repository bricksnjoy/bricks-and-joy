/**
 * Brick's & Joy — Supplier Catalog ↔ Google Sheets two-way sync
 * One TAB PER SUPPLIER (tab name = supplier name).
 *
 * Script Properties (Project Settings → Script Properties):
 *   SUPABASE_URL = https://YOUR_PROJECT_REF.supabase.co
 *   SUPABASE_KEY = your Supabase anon/publishable key
 *
 * Run setup() once. Then:
 *   • Edit a row on a supplier tab  → pushed to the app instantly.
 *   • App changes                   → pulled into the right tab every 10 min
 *                                     (or menu: Catalog Sync → Pull latest from app).
 *   • New row on a supplier tab     → created in the app under that supplier.
 *   • Deletions                     → do them in the app.
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

// A tab is a catalog tab if row 1 matches our header
function isCatalogTab_(sh) {
  const first = sh.getRange(1, 1, 1, COLUMNS.length).getValues()[0]
  return first.join('|').toLowerCase() === COLUMNS.join('|').toLowerCase()
}
// Safe Google Sheets tab name from a supplier name
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
  // The tab IS the supplier — default supplier_name to the tab name
  if (!obj.supplier_name) obj.supplier_name = sh.getName()
  if (!obj.supplier_id && obj.supplier_name) {
    try {
      const r = sb_('suppliers?select=id&name=eq.' + encodeURIComponent(obj.supplier_name) + '&limit=1', { method: 'get' })
      const arr = JSON.parse(r.getContentText()); if (arr[0]) obj.supplier_id = arr[0].id
    } catch (x) {}
  }
  const payload = Object.assign({}, obj); delete payload.id
  if (obj.id) {
    sb_('supplier_products?id=eq.' + obj.id, { method: 'patch', payload: JSON.stringify(payload) })
  } else {
    const res = sb_('supplier_products', { method: 'post', payload: JSON.stringify(payload) })
    try { const arr = JSON.parse(res.getContentText()); if (arr[0] && arr[0].id) sh.getRange(row, 1).setValue(arr[0].id) } catch (x) {}
  }
}

// ── App → Sheet (one tab per supplier) ───────────────────────────────────────
function syncFromSupabase() {
  const res = sb_('supplier_products?select=' + COLUMNS.join(',') + '&order=product_name', { method: 'get' })
  const data = JSON.parse(res.getContentText())
  // Group by supplier (case-insensitive; first-seen casing becomes the tab name)
  const groups = {}, display = {}
  data.forEach(rec => {
    const disp = tabName_(rec.supplier_name)
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

// ── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['onEditInstallable', 'syncFromSupabase'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create()
  ScriptApp.newTrigger('syncFromSupabase').timeBased().everyMinutes(10).create()
  syncFromSupabase()
  SpreadsheetApp.getUi().alert('Catalog Sync is on — one tab per supplier. Edits push to the app instantly; app changes pull every 10 minutes.')
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Catalog Sync')
    .addItem('Pull latest from app', 'syncFromSupabase')
    .addItem('Run setup', 'setup')
    .addToUi()
}
