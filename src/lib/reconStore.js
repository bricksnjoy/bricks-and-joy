// Where the reconciliation's own records live.
//
// Two things used to sit only in the browser: the date the books start, and the
// list of entries settled by hand as "won't appear on the bank statement". On a
// new phone or a cleared cache they were simply gone. They now live in Supabase
// so they follow the shop, not the device — with a localStorage copy kept as a
// cache, so nothing breaks before the sync tables exist (run
// integrations/reconciliation-sync-setup.sql to create them).

import { supabase } from './supabase'

const BOOKS_START_KEY = 'bnj_books_start'
const SETTLED_KEY = 'bnj_settled_entries_v1'

// ── localStorage cache (also the fallback before the tables are created) ──────
export const readLocalStart = () => { try { return localStorage.getItem(BOOKS_START_KEY) || '' } catch { return '' } }
const writeLocalStart = v => { try { if (v) localStorage.setItem(BOOKS_START_KEY, v); else localStorage.removeItem(BOOKS_START_KEY) } catch {} }
export const readLocalSettled = () => { try { const v = JSON.parse(localStorage.getItem(SETTLED_KEY)); return v && typeof v === 'object' ? v : {} } catch { return {} } }
const writeLocalSettled = obj => { try { localStorage.setItem(SETTLED_KEY, JSON.stringify(obj)) } catch {} }

// ── Books start date ──────────────────────────────────────────────────────────
// Returns { value, synced }. `synced` is false when the table isn't there yet,
// so the caller can show the entry is only on this device.
export async function loadBooksStart() {
  const local = readLocalStart()
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'books_start').maybeSingle()
  if (error) return { value: local, synced: false }
  const cloud = data && data.value != null ? String(data.value) : ''
  // First run after the table is created: push whatever this device had up, so a
  // start date set before syncing existed isn't silently dropped.
  if (!cloud && local) { await supabase.from('app_settings').upsert({ key: 'books_start', value: local, updated_at: new Date().toISOString() }); return { value: local, synced: true } }
  writeLocalStart(cloud)
  return { value: cloud, synced: true }
}

export async function saveBooksStart(v) {
  writeLocalStart(v)   // cache immediately so the UI is instant
  const { error } = await supabase.from('app_settings').upsert({ key: 'books_start', value: v || '', updated_at: new Date().toISOString() })
  return { synced: !error }
}

// ── Settled ("won't appear") entries ─────────────────────────────────────────
// Returns { map, synced } where map is { bookId: { reason, at } }.
export async function loadSettled() {
  const local = readLocalSettled()
  const { data, error } = await supabase.from('settled_entries').select('*')
  if (error) return { map: local, synced: false }
  const map = {}
  ;(data || []).forEach(r => { map[r.book_id] = { reason: r.reason || '', at: r.created_at ? new Date(r.created_at).getTime() : Date.now() } })
  // Migrate device-only entries up the first time the table exists.
  const missing = Object.entries(local).filter(([id]) => !(id in map))
  if (missing.length) {
    await supabase.from('settled_entries').upsert(missing.map(([book_id, meta]) => ({ book_id, reason: (meta && meta.reason) || '' })))
    missing.forEach(([id, meta]) => { map[id] = meta })
  }
  writeLocalSettled(map)
  return { map, synced: true }
}

// Both writers update the local cache first, then Supabase. They return whether
// the cloud write landed so the caller can keep the map it already set.
export async function addSettled(bookId, reason, cache) {
  if (cache) writeLocalSettled(cache)
  const { error } = await supabase.from('settled_entries').upsert({ book_id: bookId, reason: reason || '' })
  return { synced: !error }
}

export async function removeSettled(bookId, cache) {
  if (cache) writeLocalSettled(cache)
  const { error } = await supabase.from('settled_entries').delete().eq('book_id', bookId)
  return { synced: !error }
}
