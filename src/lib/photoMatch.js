// Matching a folder of photos to catalog products by their filenames.
//
// Photos arrive named all sorts of ways — "Bouquet of Roses.jpg",
// "bouquet-of-roses.png", "IMG_2931 bouquet.jpeg", "ALI-BOUQ937.webp". The job
// is to find, for each file, the one product it clearly belongs to, and to say
// plainly when it can't rather than guess wrong. A wrong photo on a product is
// worse than a missing one, so anything short of a confident match is left for
// the person to decide.

// Strip the extension and the noise cameras and phones add, then reduce to
// lowercase words. "IMG_2931 Bouquet of Roses (2).jpg" → "bouquet of roses".
export function cleanFileName(name) {
  let s = String(name || '')
  s = s.replace(/\.[a-z0-9]+$/i, '')            // extension
  s = s.replace(/^(img|image|photo|dsc|pxl|screenshot)[-_ ]*\d*/i, '') // camera prefixes
  s = s.replace(/[-_ ]*(?:\(\d+\)|copy|final|edited)\s*$/i, '')        // "(2)", "copy"
  s = s.replace(/[-_ ]+\d{1,2}$/,'')            // a trailing counter: "-1", "_02"
  return s
}

// Everything comparable reduced to the same shape: accents folded to plain
// letters, lowercase, letters and digits only, single spaces. So "Sián" and
// "sian" are one word, and "Ferrari SF-24 F1" matches "ferrari sf 24 f1".
export const norm = s => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // é → e, á → a
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ')

const tokens = s => norm(s).split(' ').filter(Boolean)

// How alike two names are, 0–1. One being fully contained in the other scores
// high; otherwise it is the share of words they have in common (Jaccard).
function similarity(a, b) {
  const na = norm(a), nb = norm(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = new Set(tokens(a)), tb = new Set(tokens(b))
  // A short filename that is exactly the start of a longer product name, or vice
  // versa, is usually right — "bouquet of roses" vs "bouquet of roses large".
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) {
    const shorter = Math.min(ta.size, tb.size)
    // Only trust containment when the shorter side is more than one word, so a
    // single common word like "set" cannot carry a match on its own.
    if (shorter >= 2) return 0.9
  }
  let shared = 0
  ta.forEach(t => { if (tb.has(t)) shared += 1 })
  const union = new Set([...ta, ...tb]).size
  return union ? shared / union : 0
}

// Confidence bands the UI colours and the caller can threshold on.
//   exact  — sku or full name matched outright, safe to apply
//   strong — one clear best match well ahead of the rest
//   weak   — a plausible match, but close enough to another to want eyes on it
//   none   — nothing came near
const STRONG = 0.6
const WEAK = 0.34

// Match one filename against the catalog. `products` is [{ id, name, sku, image_url }].
// Returns { productId, confidence, score, why, runnerUp } — productId null when none.
export function matchOne(fileName, products) {
  const base = cleanFileName(fileName)
  const nb = norm(base)
  if (!nb) return { productId: null, confidence: 'none', score: 0, why: 'Empty name' }

  // A filename that is exactly an SKU is unambiguous — take it first.
  const bySku = products.find(p => p.sku && norm(p.sku) === nb)
  if (bySku) return { productId: bySku.id, confidence: 'exact', score: 1, why: `SKU ${bySku.sku}` }

  const scored = products
    .map(p => ({ p, s: similarity(base, p.name) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)

  if (!scored.length) return { productId: null, confidence: 'none', score: 0, why: 'No product with a similar name' }

  const best = scored[0]
  const second = scored[1]
  const runnerUp = second ? { name: second.p.name, score: second.s } : null

  if (best.s >= 0.999) return { productId: best.p.id, confidence: 'exact', score: 1, why: 'Name matches exactly', runnerUp }

  // Two products almost equally alike means the filename can't tell them apart.
  const ambiguous = second && best.s - second.s < 0.12 && second.s >= WEAK
  if (best.s >= STRONG && !ambiguous) {
    return { productId: best.p.id, confidence: 'strong', score: best.s, why: `Close match to "${best.p.name}"`, runnerUp }
  }
  if (best.s >= WEAK) {
    return {
      productId: best.p.id, confidence: 'weak', score: best.s, runnerUp,
      why: ambiguous ? `Could be "${best.p.name}" or "${second.p.name}"` : `Loose match to "${best.p.name}"`,
    }
  }
  return { productId: null, confidence: 'none', score: best.s, why: `Nothing close (best was "${best.p.name}")`, runnerUp }
}

// Match a whole file list. Returns one row per file, in the order given, with the
// file kept so the UI can preview and later upload it.
//
// When two files land on the same product, only the first keeps it — the rest
// are flagged, since a product takes one photo and two files matching it usually
// means one is a duplicate or a near-namesake that belongs elsewhere.
export function matchAll(files, products) {
  const taken = new Map()   // productId → the file index that claimed it
  return Array.from(files).map((file, i) => {
    const m = matchOne(file.name, products)
    const row = { file, name: file.name, ...m, index: i, duplicate: false }
    if (m.productId != null) {
      if (taken.has(m.productId)) { row.duplicate = true; row.duplicateOf = taken.get(m.productId) }
      else taken.set(m.productId, i)
    }
    return row
  })
}
