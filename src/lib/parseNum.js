// Reading a number out of a spreadsheet.
//
// A cell holding a cost can arrive as a real number, or as text — "1,250",
// "USD 80", "$80.50", "1 250.00" — depending on how the supplier formatted
// their sheet and whether the file came through as CSV. parseFloat gives up at
// the first character it does not recognise, so "1,250" reads as 1, and the
// catalog import was then multiplying that by the dollar rate and storing MVR
// 15.42 for something that cost nineteen thousand. Every margin and landed cost
// built on it was wrong by the same factor, silently.
//
// Reconciliation had worked this out already and stripped separators before
// parsing its bank statements. This is that, in one place, for both.

/**
 * A number from a cell, or NaN if it does not hold one.
 *
 * NaN rather than 0 on purpose: the caller needs to tell "the cell said zero"
 * from "the cell said something that is not a number", and only one of those
 * should be written down as a price.
 */
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  const raw = String(v == null ? '' : v).trim()
  if (!raw) return NaN

  // Accountants write a negative in brackets, and so do exported sheets.
  const negative = /^\(.*\)$/.test(raw)

  // Which mark is the decimal point. With both present it is simply whichever
  // comes last — "1,250.75" is English and "1.250,75" is not, and the two mean
  // the same amount. With only a comma, treat it as a thousands separator: that
  // is the convention here, and "1,250" is far more likely than 1 and a quarter.
  let body = raw.replace(/[()]/g, '')
  const lastDot = body.lastIndexOf('.')
  const lastComma = body.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    body = lastComma > lastDot
      ? body.replace(/\./g, '').replace(',', '.')   // European
      : body.replace(/,/g, '')                      // English
  } else {
    body = body.replace(/,/g, '')
  }

  // Now drop the currency symbols, the spaces and the stray words.
  const cleaned = body.replace(/[^0-9.\-]/g, '')
  if (!cleaned || !/\d/.test(cleaned)) return NaN

  // More than one decimal point left means this is not a number in any format
  // we recognise — a date that reached the wrong column, most likely. Refusing
  // leaves the original value for somebody to look at, which is far better than
  // confidently storing the first two digits of it.
  if ((cleaned.match(/\./g) || []).length > 1) return NaN

  const n = parseFloat(cleaned)
  if (!Number.isFinite(n)) return NaN
  return negative ? -Math.abs(n) : n
}

/** The same, with a fallback for the callers that just want arithmetic to work. */
export const parseNum = (v, fallback = 0) => {
  const n = toNumber(v)
  return Number.isFinite(n) ? n : fallback
}
