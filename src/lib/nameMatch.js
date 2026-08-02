// Deciding whether two product names refer to the same thing.
//
// Suppliers write the same toy a dozen ways — "Ferrari SF-24 F1", "ferrari sf24
// f1 car", "Ferrari SF 24". Comparing them by hand is hopeless, and a wrong
// match is worse than none, so this errs towards saying no and leaves the
// borderline cases for a person to agree with.

// Everything comparable reduced to the same shape: accents folded to plain
// letters, lowercase, letters and digits only, single spaces. So "Sián" and
// "sian" are one word, and "Ferrari SF-24 F1" matches "ferrari sf 24 f1".
export const norm = s => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // é → e, á → a
  .toLowerCase()
  // Apostrophes are dropped rather than split on, so "Collector's" reads as
  // one word and matches "Collectors" instead of leaving a stray "s" behind.
  .replace(/['\u2018\u2019]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ')

const tokens = s => norm(s).split(' ').filter(Boolean)

// How alike two names are, 0–1. One being fully contained in the other scores
// high; otherwise it is the share of words they have in common (Jaccard).
export function similarity(a, b) {
  const na = norm(a), nb = norm(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = new Set(tokens(a)), tb = new Set(tokens(b))
  // A short name that is exactly the start of a longer one, or vice versa, is
  // usually right — "bouquet of roses" vs "bouquet of roses large".
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) {
    // Only trust containment when the shorter side is more than one word, so a
    // single common word like "set" cannot carry a match on its own.
    if (Math.min(ta.size, tb.size) >= 2) return 0.9
  }
  let shared = 0
  ta.forEach(t => { if (tb.has(t)) shared += 1 })
  const union = new Set([...ta, ...tb]).size
  return union ? shared / union : 0
}
