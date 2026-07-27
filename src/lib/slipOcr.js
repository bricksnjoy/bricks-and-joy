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

// 20:57, 20:57:14, 13-50-53, 8:57 PM — kept as 24-hour HH:MM. The separator may
// be a dash: one receipt writes the stamp as "19-07-2026 13-50-53".
function timeFrom(s) {
  const m = s.match(/\b(\d{1,2})[:.\-](\d{2})(?:[:.\-](\d{2}))?\s*(am|pm)?\b/i)
  if (!m) return null
  let h = +m[1]
  const min = +m[2]
  if (min > 59) return null
  const ap = (m[4] || '').toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23) return null
  return `${pad(h)}:${pad(min)}`
}

const DATE_ANYWHERE = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b|\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/

function findDateTime(text) {
  const lines = splitLines(text)
  // The line that says "date" is the most trustworthy place to look
  const dateCandidates = [...valueAfter(lines, /transaction\s*date|value\s*date|post\s*date|date(?:\s*&\s*time)?|paid\s*on/i), ...lines]
  let date = null
  for (const c of dateCandidates) {
    date = dateFrom(c)
    if (date) break
  }
  // Only trust a time that sits alongside a date — a bare one near the top of a
  // screenshot is the phone's status bar, not the transaction.
  let time = null
  for (const line of lines) {
    if (!DATE_ANYWHERE.test(line)) continue
    const t = timeFrom(line.replace(DATE_ANYWHERE, ' '))
    if (t) { time = t; break }
  }
  return { date, time }
}

// ── Amount ────────────────────────────────────────────────────────────────────
// A number, with no whitespace allowed inside it — letting \s in here once
// welded a status-bar clock onto the line below and read 2,500.00 as 512,500.
const NUM = '[0-9][0-9,]*(?:\\.[0-9]{1,2})?'

function findAmount(text) {
  const lines = splitLines(text)
  // A labelled amount beats a loose number every time
  for (const c of valueAfter(lines, /\bamount\b|\btotal\b|transferred/i, 1)) {
    const m = c.match(new RegExp(`(${NUM})`))
    const v = m && toAmount(m[1])
    if (v && v > 0) return v
  }
  // The headline on a BML slip: the figure on one line, MVR on the next
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(new RegExp(`^(${NUM})$`))
    if (m && /^(mvr|rf|mrf)\b/i.test(lines[i + 1] || '')) {
      const v = toAmount(m[1])
      if (v && v > 0) return v
    }
  }
  // Or the two together on one line, either way round
  const cur = [
    ...text.matchAll(new RegExp(`(?:mvr|rf|mrf)\\s*(${NUM})`, 'gi')),
    ...text.matchAll(new RegExp(`(${NUM})\\s*(?:mvr|rf|mrf)\\b`, 'gi')),
  ].map(m => toAmount(m[1])).filter(v => v && v > 0)
  if (cur.length) return Math.max(...cur)
  // Last resort: anything shaped like money
  const any = [...text.matchAll(/\b([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|[0-9]+\.[0-9]{2})\b/g)]
    .map(m => toAmount(m[1])).filter(v => v && v > 0)
  return any.length ? Math.max(...any) : null
}

// ── Reference / transaction number ────────────────────────────────────────────
// BML stamps every transfer with a BLAZ… code, and that is what turns up in the
// description column of the bank statement — so it beats anything sitting under
// a "Reference" label. On the transaction-detail screen it is buried in the
// description block rather than labelled at all.
function findReference(text) {
  const blaz = text.match(/\b(BLAZ\s?[0-9]{6,})\b/i)
  if (blaz) return blaz[1].replace(/\s/g, '').toUpperCase()
  // Any bank's equivalent: a few letters followed by a long digit run
  const mixed = text.match(/\b([A-Z]{3,6}[0-9]{9,})\b/i)
  if (mixed) return mixed[1].toUpperCase()

  const lines = splitLines(text)
  for (const c of valueAfter(lines, /reference|transaction\s*(?:no|id|ref)|txn|receipt\s*no|trace/i, 1)) {
    // Every token on the line, not just the first — the label itself often
    // matches the shape, so keep looking until one carries digits.
    for (const m of c.matchAll(/\b([A-Z0-9][A-Z0-9\\/-]{5,29})\b/gi)) {
      const tok = m[1].trim()
      if (!/\d/.test(tok)) continue                    // a word, not a reference
      if (/^\d{1,2}[-/.]\d/.test(tok)) continue        // that's a date
      return tok
    }
  }
  const long = [...text.matchAll(/\b(\d{10,20})\b/g)].map(m => m[1])
  return long.length ? long[0] : null
}

// "Transfer Credit" means money arriving, "Transfer Debit" money leaving
function findDirection(text) {
  if (/\b(?:transfer\s+)?credit\b|received|deposit/i.test(text)) return 'in'
  if (/\b(?:transfer\s+)?debit\b|withdraw|payment\s+sent/i.test(text)) return 'out'
  return null
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
  // The detail screen labels only one account, without saying which side it is
  const plain = valueAfter(lines, /account\s*(?:number|no\.?|#)/i, 1)
  // …and puts the other party's name in the description block, under the stamp
  const desc = valueAfter(lines, /description|narration|particulars/i, 3)
  const descName = desc.filter(l => !DATE_ANYWHERE.test(l) && !/^BLAZ/i.test(l.trim())).map(nameIn).find(Boolean)
  return {
    fromName: from.map(nameIn).find(Boolean) || descName || null,
    fromAccount: from.map(digitsIn).find(Boolean) || null,
    toName: to.map(nameIn).find(Boolean) || null,
    toAccount: to.map(digitsIn).find(Boolean) || null,
    plainAccount: plain.map(digitsIn).find(Boolean) || null,
  }
}

export function parseSlipText(text = '') {
  const { date, time } = findDateTime(text)
  const parties = findParties(text)
  const direction = findDirection(text)
  return {
    amount: findAmount(text),
    date,
    time,
    reference: findReference(text),
    direction,                     // 'in' = someone paid you, 'out' = you paid
    // The account to record: where it left on a payment you sent, otherwise
    // whichever single account the slip names
    account: parties.fromAccount || parties.plainAccount || null,
    // Who the money was with — matches the party column on a bank statement
    counterparty: (direction === 'in' ? parties.fromName : parties.toName) || parties.fromName || parties.toName || null,
    ...parties,
  }
}

// Reads one slip — a File just picked, or the URL of one already stored, so a
// slip attached earlier can be read without re-uploading it. Any field may come
// back null, and the caller should let the user check before trusting it.
export async function readSlip(file, onProgress) {
  if (!file) return null
  const isUrl = typeof file === 'string'
  if (isUrl && /\.pdf(\?|$)/i.test(file)) return null            // OCR reads images, not PDFs
  if (!isUrl && !(file.type || '').startsWith('image/')) return null
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
