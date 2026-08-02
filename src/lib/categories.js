// The one list of product categories.
//
// There used to be two that never met: a fixed list written into Inventory's
// dropdown, and the `categories` table the Categories page manages. A category
// created on that page never appeared when adding a product, and a category
// arriving through an import could not be picked or filtered by. So the page
// managed a list nothing else read.
//
// The list is now everything from all three places at once: what the Categories
// page manages, the built-in starters, and whatever products already use.

import { supabase } from './supabase'

// Sensible starters for a toy shop, so the dropdown is never empty on day one.
export const BUILT_IN = [
  'Building & Blocks', 'Action Figures', 'Dolls & Plush', 'Board Games',
  'Outdoor & Sports', 'Educational', 'Vehicles & RC', 'Arts & Crafts', 'Puzzles', 'Other',
]

const clean = s => String(s || '').trim()
// Case- and spacing-insensitive, so "Lego Replica" and "lego replica" are one
const key = s => clean(s).toLowerCase().replace(/\s+/g, ' ')

/**
 * Every category worth offering, in one list.
 * @param {Array} products rows carrying a `category`, so ones already in use show
 * @returns {Promise<string[]>}
 */
export async function loadCategories(products = []) {
  let managed = []
  const { data, error } = await supabase.from('categories').select('name')
  if (!error) managed = (data || []).map(c => clean(c.name)).filter(Boolean)

  const used = products.map(p => clean(p.category)).filter(Boolean)
  const seen = new Map()
  // Managed names win the spelling contest — that page is where they're decided
  ;[...managed, ...BUILT_IN, ...used].forEach(n => { if (!seen.has(key(n))) seen.set(key(n), n) })
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * Record a category the Categories page hasn't got yet, so choosing a new one
 * while adding a product doesn't put the two lists out of step again.
 * Quietly does nothing if it's already there, or if the table doesn't exist.
 */
export async function ensureCategory(name) {
  const n = clean(name)
  if (!n) return
  try {
    const { data, error } = await supabase.from('categories').select('id, name')
    if (error) return
    if ((data || []).some(c => key(c.name) === key(n))) return
    await supabase.from('categories').insert({ name: n, color: '#FFA500' })
  } catch { /* never let this get in the way of saving a product */ }
}
