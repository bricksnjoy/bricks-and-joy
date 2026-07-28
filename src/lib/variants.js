// The same toy in several sizes.
//
// Sizes are kept as separate products — each one has its own stock, cost, price
// and barcode, which is what makes them countable and sellable. What was missing
// is any idea that they belong together, so "Ferrari SF 24 1:18" and
// "Ferrari SF 24 1:24" sat wherever the alphabet put them.
//
// Rather than force every product to be re-entered, the family is worked out
// from the name: a size written at the end of a name is stripped off, and what
// remains is the family. Two explicit columns override that whenever the name
// doesn't follow the pattern — variant_group names the family, variant_label
// names this one's size.

// Written from most specific to least, since the first match wins and
// "1:18" must be tried before a bare number.
const SIZE_PATTERNS = [
  // Model scales — 1:18, 1/24
  { re: /[\s\-–—(]+(1\s*[:/]\s*\d{1,3})\s*\)?$/i, kind: 'scale' },
  // Named sizes, with or without a "size" word
  { re: /[\s\-–—(]+(?:size\s+)?(xxs|xs|s|m|l|xl|xxl|xxxl|small|medium|large|mini|midi|maxi|regular|standard|jumbo|giant)\s*\)?$/i, kind: 'name' },
  // Measurements — 30cm, 1.5 m, 500ml, 2kg, 12". Longest units first, so
  // "ml" is never read as a bare "m" with a stray letter after it.
  { re: /[\s\-–—(]+(\d+(?:\.\d+)?\s*(?:litre|liter|inch|pieces|pcs|ml|cm|mm|kg|oz|lb|in|"|m|l|g))\s*\)?$/i, kind: 'measure' },
  // Age bands — 3-5yrs, 6+ years
  { re: /[\s\-–—(]+(\d+\s*(?:[-–—+]\s*\d*)?\s*(?:yrs?|years?|months?|mos?))\s*\)?$/i, kind: 'age' },
  // A trailing pack count, written either way round — 6 pack, pack of 12
  { re: /[\s\-–—(]+(pack\s+of\s+\d+|\d+\s*(?:pack|pk))\s*\)?$/i, kind: 'pack' },
]

// Sizes only sort sensibly once the unit is taken into account — 1l is larger
// than 500ml even though 1 is the smaller number.
const UNIT_SCALE = {
  mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, '"': 25.4,
  ml: 1, l: 1000, litre: 1000, liter: 1000,
  g: 1, kg: 1000, oz: 28.35, lb: 453.6,
}

// Roughly smallest to largest, so a family reads in a sensible order.
const NAME_ORDER = [
  'xxs', 'xs', 'mini', 's', 'small', 'm', 'midi', 'medium', 'regular', 'standard',
  'l', 'large', 'xl', 'maxi', 'xxl', 'jumbo', 'xxxl', 'giant',
]

const clean = s => String(s || '').trim().replace(/\s+/g, ' ')

// Split a product name into the family and the size written on the end.
// Returns { base, size } with size null when the name carries no size.
export function splitName(name) {
  const n = clean(name)
  if (!n) return { base: '', size: null }
  for (const { re } of SIZE_PATTERNS) {
    const m = n.match(re)
    if (!m) continue
    const base = clean(n.slice(0, m.index))
    // A name that is nothing but a size is not a family — "Large" on its own
    // tells you nothing, so leave it whole.
    if (base.length < 2) return { base: n, size: null }
    return { base, size: clean(m[1]) }
  }
  return { base: n, size: null }
}

// What ties this product to its siblings. An explicit group always wins.
export function familyOf(p) {
  const explicit = clean(p?.variant_group)
  if (explicit) return explicit
  return splitName(p?.name || p?.product_name).base
}

// What this particular one is — "1:18", "Large". Null when it has no size.
export function sizeOf(p) {
  const explicit = clean(p?.variant_label)
  if (explicit) return explicit
  return splitName(p?.name || p?.product_name).size
}

// Case- and punctuation-insensitive, so "Ferrari SF-24" and "ferrari sf 24"
// land in the same family.
export const familyKey = p => familyOf(p).toLowerCase().replace(/[^a-z0-9]+/g, '')

// Sorts sizes within a family: named sizes by the order above, anything with
// numbers by the number, everything else alphabetically.
export function sizeRank(size) {
  const s = clean(size).toLowerCase()
  if (!s) return -1                       // the plain one comes first
  // Only a purely alphabetic size can be a named one — "1l" strips to "l",
  // which is not Large, it is one litre.
  if (!/\d/.test(s)) {
    const named = NAME_ORDER.indexOf(s.replace(/[^a-z]/g, ''))
    if (named >= 0) return named
  }
  // A scale is finer the larger its second number, so 1:24 is smaller than 1:18
  const scale = s.match(/1\s*[:/]\s*(\d+)/)
  if (scale) return 1000 - Number(scale[1])
  const num = s.match(/(\d+(?:\.\d+)?)\s*([a-z"]*)/)
  if (num) return 2000 + Number(num[1]) * (UNIT_SCALE[num[2]] || 1)
  return 1e9
}

const bySize = (a, b) => {
  const d = sizeRank(sizeOf(a)) - sizeRank(sizeOf(b))
  if (d) return d
  return String(sizeOf(a) || '').localeCompare(String(sizeOf(b) || ''))
}

// Order a flat list so every family's sizes sit together, keeping the incoming
// order of the families themselves — a list sorted by revenue stays sorted by
// revenue, it just gathers each product's sizes at its first appearance.
export function groupAdjacent(items) {
  const seen = new Map()
  const order = []
  items.forEach(it => {
    const k = familyKey(it)
    if (!seen.has(k)) { seen.set(k, []); order.push(k) }
    seen.get(k).push(it)
  })
  return order.flatMap(k => {
    const group = seen.get(k)
    return group.length > 1 ? [...group].sort(bySize) : group
  })
}

// The same thing, but as families rather than a flat list. Used where the
// family itself is the row — one shop card per product, sizes chosen inside it.
export function families(items) {
  const map = new Map()
  const order = []
  items.forEach(it => {
    const k = familyKey(it)
    if (!map.has(k)) { map.set(k, { key: k, name: familyOf(it), items: [] }); order.push(k) }
    map.get(k).items.push(it)
  })
  return order.map(k => {
    const f = map.get(k)
    // Only a genuine family gets grouped; a lone product keeps its full name
    if (f.items.length > 1) f.items.sort(bySize)
    else f.name = clean(f.items[0]?.name || f.items[0]?.product_name)
    return f
  })
}

// How many of a family share this position in a flat, already-grouped list —
// used to draw a family as one block.
export function familyRuns(sortedItems) {
  const runs = []
  sortedItems.forEach((it, i) => {
    const k = familyKey(it)
    const last = runs[runs.length - 1]
    if (last && last.key === k) { last.count += 1; last.items.push(it) }
    else runs.push({ key: k, name: familyOf(it), start: i, count: 1, items: [it] })
  })
  return runs
}
