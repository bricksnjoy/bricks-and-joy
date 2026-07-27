// Read a payment slip and pull out the bits worth typing — amount, date, time,
// reference and who it was with.
//
// Runs entirely in the browser: the image never leaves the device and there is
// no API key or per-slip cost. The engine is ~2MB, so it is only fetched the
// first time a slip is actually read, never as part of the main bundle.
//
// Written against the BML transfer receipt, which lays out label and value in
// two columns:
//
//     Reference          BLAZ395788471431
//     Transaction date   26/07/2026 20:57
//     From               AMIRA ADAM
//     To                 BRICKS & JOY
//                        7730000819195
//     Amount             MVR 580.00
//
// OCR sometimes keeps a label and its value on one line and sometimes splits
// them, so every lookup checks the rest of the label's own line first and then
// the couple of lines below it.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}
const pad = n => String(n).padStart(2, '0')
const isoDate = (y, m, d) =>
  (y > 1990 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y}-${pad(m)}-${pad(d)}` : null

const toAmount = s => {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

const splitLines = text => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

// Everything to the right of a label on its own line, plus the next few lines —
// covers both the one-line and the split-column readings of the same receipt.
// The next field's label — a lookahead must stop before it, or "From" would
// swallow the "To" block sitting underneath it.
const NEXT_LABEL = /^(status|message|reference|transaction|from|to|amount|total|beneficiary|sender|receiver|date|bank of)\b/i

function valueAfter(lines, labelRe, lookahead = 2) {
  const out = []
  lines.forEach((line, i) => {
    const m = line.match(labelRe)
    if (!m) return
    const rest = line.slice(m.index + m[0].length).replace(/^[\s:–-]+/, '')
    if (rest) out.push(rest)
    for (let k = 1; k <= lookahead && i + k < lines.length; k++) {
      if (NEXT_LABEL.test(lines[i + k])) break
      out.push(lines[i + k])
    }
  })
  return out
}

// ── Date and time ─────────────────────────────────────────────────────────────
function dateFrom(s) {
  let m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/)                 // 2026-07-26
  if (m) { const d = isoDate(+m[1], +m[2], +m[3]); if (d) return d }
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/)                     // 26/07/2026
  if (m) { const d = isoDate(+m[3], +m[2], +m[1]); if (d) return d }
  m = s.match(/\b(\d{1,2})\s*[-\s]\s*([a-z]{3})[a-z]*\.?\s*[-\s]?\s*(\d{4})\b/i)   // 26 Jul 2026
  if (m && MONTHS[m[2].toLowerCase()]) { const d = isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]); if (d) return d }
  m = s.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i)            // Jul 26, 2026
  if (m && MONTHS[m[1].toLowerCase()]) { const d = isoDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]); if (d) return d }
  return null
}

// 20:57, 20:57:14, 8:57 PM — kept as 24-hour HH:MM
function timeFrom(s) {
  const m = s.match(/\b(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i)
  if (!m) return null
  let h = +m[1]
  const min = +m[2]
  if (min > 59) return null
  const ap = (m[4] || '').toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23) return null
  // A bare 4-digit year fragment can look like a time — a date has already been
  // stripped by the caller, so anything left here is safe enough
  return `${pad(h)}:${pad(min)}`
}

function findDateTime(text) {
  const lines = splitLines(text)
  // The line that says "date" is the most trustworthy place to look
  const candidates = [...valueAfter(lines, /transaction\s*date|value\s*date|date(?:\s*&\s*time)?|paid\s*on/i), ...lines]
  for (const c of candidates) {
    const date = dateFrom(c)
    if (!date) continue
    // Look for the time in whatever is left once the date is out of the way
    const rest = c.replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b|\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/, ' ')
    return { date, time: timeFrom(rest) }
  }
  return { date: null, time: null }
}

// ── Amount ────────────────────────────────────────────────────────────────────
function findAmount(text) {
  const lines = splitLines(text)
  // A labelled amount beats a loose number every time
  for (const c of valueAfter(lines, /\bamount\b|\btotal\b|transferred/i, 1)) {
    const m = c.match(/([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/)
    const v = m && toAmount(m[1])
    if (v && v > 0) return v
  }
  // The figure printed next to MVR — the headline on a BML receipt
  const cur = [
    ...text.matchAll(/(?:mvr|rf|mrf)\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)/gi),
    ...text.matchAll(/([0-9][0-9,\s]*\.[0-9]{2})\s*(?:mvr|rf|mrf)\b/gi),
  ].map(m => toAmount(m[1])).filter(v => v && v > 0)
  if (cur.length) return Math.max(...cur)
  // Last resort: anything shaped like money
  const any = [...text.matchAll(/\b([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|[0-9]+\.[0-9]{2})\b/g)]
    .map(m => toAmount(m[1])).filter(v => v && v > 0)
  return any.length ? Math.max(...any) : null
}

// ── Reference / transaction number ────────────────────────────────────────────
// BML prints something like BLAZ395788471431 — letters then a long digit run.
function findReference(text) {
  const lines = splitLines(text)
  for (const c of valueAfter(lines, /reference|transaction\s*(?:no|id|ref)|txn|receipt\s*no|trace/i, 1)) {
    // Every token on the line, not just the first — the label itself often
    // matches the shape, so keep looking until one carries digits.
    for (const m of c.matchAll(/\b([A-Z0-9][A-Z0-9-]{5,29})\b/gi)) {
      const tok = m[1].trim()
      if (!/\d/.test(tok)) continue                    // a word, not a reference
      if (/^\d{1,2}[-/.]\d/.test(tok)) continue        // that's a date
      return tok
    }
  }
  // Failing a label, a long alphanumeric run with letters and digits together
  const mixed = [...text.matchAll(/\b([A-Z]{2,6}\d{8,20})\b/gi)].map(m => m[1])
  if (mixed.length) return mixed[0]
  const long = [...text.matchAll(/\b(\d{10,20})\b/g)].map(m => m[1])
  return long.length ? long[0] : null
}

// ── Accounts and names ────────────────────────────────────────────────────────
const digitsIn = s => { const m = String(s).match(/\b(\d{7,20})\b/); return m ? m[1] : null }
const nameIn = s => {
  const t = String(s).replace(/\b\d[\d\s-]*\b/g, '').replace(/[|_]/g, '').trim()
  return /[A-Za-z]{3}/.test(t) && t.length <= 60 ? t : null
}

function findParties(text) {
  const lines = splitLines(text)
  const from = valueAfter(lines, /\bfrom\b|sender|debit\s*account/i, 2)
  const to = valueAfter(lines, /\bto\b|beneficiary|credit\s*account|receiver/i, 2)
  return {
    fromName: from.map(nameIn).find(Boolean) || null,
    fromAccount: from.map(digitsIn).find(Boolean) || null,
    toName: to.map(nameIn).find(Boolean) || null,
    toAccount: to.map(digitsIn).find(Boolean) || null,
  }
}

export function parseSlipText(text = '') {
  const { date, time } = findDateTime(text)
  const parties = findParties(text)
  return {
    amount: findAmount(text),
    date,
    time,
    reference: findReference(text),
    // The account the money left — what you'd record as "sent from"
    account: parties.fromAccount,
    ...parties,
  }
}

// Reads one image file. Any field may come back null, and the caller should let
// the user check before trusting it.
export async function readSlip(file, onProgress) {
  if (!file || !(file.type || '').startsWith('image/')) return null
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    logger: onProgress ? m => { if (m.status === 'recognizing text') onProgress(m.progress) } : undefined,
  })
  try {
    const { data: { text } } = await worker.recognize(file)
    return { ...parseSlipText(text), raw: text }
  } finally {
    await worker.terminate()
  }
}
