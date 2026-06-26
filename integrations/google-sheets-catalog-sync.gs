/**
 * Brick's & Joy — Supplier Catalog ↔ Google Sheet two-way sync
 * ------------------------------------------------------------------
 * Paste this into the Apps Script editor of your Google Sheet
 * (Extensions → Apps Script), set the two Script Properties below,
 * then run setup() once.
 *
 * Script Properties (Project Settings → Script Properties):
 *   SUPABASE_URL  =  https://YOUR_PROJECT_REF.supabase.co
 *   SUPABASE_KEY  =  <your Supabase anon public key>
 *
 * Sheet tab must be named exactly "Catalog" (or change SHEET_NAME).
 *
 * Sync behaviour:
 *   • Edit a row in the sheet  → pushed to supplier_products instantly.
 *   • Changes in the app       → pulled into the sheet every 10 minutes
 *                                (or via menu: Catalog Sync → Pull latest from app).
 *   • New sheet rows           → created in the app; their id is written back.
 *   • Deletions                → do them in the app (sheet deletes are not synced).
 */

const SHEET_NAME = 'Catalog'
const COLUMNS = ['id','supplier_id','supplier_name','product_name','sku','category','brand','age_range','pieces','sizes','weight','dimensions','cost_price','sell_price','unit','description','tags','notes','image_url']
const NUMERIC = ['pieces','cost_price','sell_price']

function cfg_() {
  const p = PropertiesService.getScriptProperties()
  return { url: p.getProperty('SUPABASE_URL'), key: p.getProperty('SUPABASE_KEY') }
}
function sheet_() { return SpreadsheetApp.getActive().getSheetByName(SHEET_NAME) }

function sb_(path, opts) {
  const { url, key } = cfg_()
  return UrlFetchApp.fetch(url + '/rest/v1/' + path, Object.assign({
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    muteHttpExceptions: true,
  }, opts))
}

function ensureHeader_() {
  const sh = sheet_()
  if (!sh) { SpreadsheetApp.getUi().alert('Create a tab named "' + SHEET_NAME + '" first.'); return }
  sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold')
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

// ── Sheet → App (installable onEdit trigger) ────────────────────────────────
function onEditInstallable(e) {
  const sh = e.range.getSheet()
  if (sh.getName() !== SHEET_NAME) return
  const row = e.range.getRow()
  if (row === 1) return
  const vals = sh.getRange(row, 1, 1, COLUMNS.length).getValues()[0]
  const obj = rowToObj_(vals)
  if (!obj.product_name) return
  // resolve supplier_id from supplier_name if missing
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

// ── App → Sheet (timer + menu) ──────────────────────────────────────────────
function syncFromSupabase() {
  const sh = sheet_(); if (!sh) return
  ensureHeader_()
  const res = sb_('supplier_products?select=' + COLUMNS.join(',') + '&order=product_name', { method: 'get' })
  const data = JSON.parse(res.getContentText())
  const last = sh.getLastRow()
  const existing = {}
  if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach((r, i) => { if (r[0]) existing[r[0]] = i + 2 })
  data.forEach(rec => {
    const rowVals = COLUMNS.map(c => rec[c] == null ? '' : rec[c])
    if (existing[rec.id]) sh.getRange(existing[rec.id], 1, 1, COLUMNS.length).setValues([rowVals])
    else sh.appendRow(rowVals)
  })
}

// ── One-time setup ──────────────────────────────────────────────────────────
function setup() {
  ensureHeader_()
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['onEditInstallable', 'syncFromSupabase'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t)
  })
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create()
  ScriptApp.newTrigger('syncFromSupabase').timeBased().everyMinutes(10).create()
  syncFromSupabase()
  SpreadsheetApp.getUi().alert('Catalog Sync is on. Edits push to the app instantly; app changes pull every 10 minutes.')
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Catalog Sync')
    .addItem('Pull latest from app', 'syncFromSupabase')
    .addItem('Run setup', 'setup')
    .addToUi()
}
