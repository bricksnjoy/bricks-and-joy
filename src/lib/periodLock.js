// Closing the books.
//
// Once a month has been reconciled and signed off, editing anything dated inside
// it silently breaks that reconciliation — the totals it was agreed on no longer
// match the records behind them. A lock fixes everything on or before a date.
//
// The lock is advisory rather than enforced in the database: it stops the app's
// own edit paths, which is what actually causes the damage, without making the
// data unrecoverable if a genuine correction is needed.

import { supabase } from './supabase'

let cached = null          // { lockedThrough, note, at }
let inflight = null

// The lock is read once and kept, since it changes at most monthly.
export async function getLock({ force = false } = {}) {
  if (cached && !force) return cached
  if (inflight && !force) return inflight
  inflight = (async () => {
    const { data, error } = await supabase
      .from('period_locks').select('*').order('locked_through', { ascending: false }).limit(1)
    // No table yet, or nothing locked — nothing is closed
    const row = error ? null : (data || [])[0]
    cached = { lockedThrough: row?.locked_through || null, note: row?.note || '', at: row?.created_at || null }
    inflight = null
    return cached
  })()
  return inflight
}

export function clearLockCache() { cached = null; inflight = null }

// Is this date inside a closed period?
export function isLocked(date, lock) {
  const through = lock?.lockedThrough
  if (!through || !date) return false
  return String(date).slice(0, 10) <= through
}

// Ask before writing. Returns true when the caller should stop.
// Deliberately a confirm rather than a hard block: a correction to a closed month
// is sometimes right, but it should never happen by accident.
export async function blockedByLock(date, { action = 'change this', onWarn } = {}) {
  const lock = await getLock()
  if (!isLocked(date, lock)) return false
  const msg = `The books are closed up to ${lock.lockedThrough}.\n\n`
    + `This is dated ${String(date).slice(0, 10)}, inside that period. Editing it will not match the reconciliation that was already signed off.\n\n`
    + `Continue anyway and ${action}?`
  const proceed = window.confirm(msg)
  if (!proceed && onWarn) onWarn(lock)
  return !proceed
}

export async function setLock(lockedThrough, note) {
  const { error } = await supabase.from('period_locks').insert({
    locked_through: lockedThrough, note: note || null,
  })
  if (!error) clearLockCache()
  return error
}
