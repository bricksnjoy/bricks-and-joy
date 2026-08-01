// The order sheet sent to a supplier, built as a real PDF file.
//
// This used to open the browser's print view, which meant the person had to
// notice the destination dropdown and change it to "Save as PDF" — on a machine
// with a printer set up it just tried to print. The document is drawn here
// instead, so pressing the button downloads a .pdf and nothing else.
//
// Everything is laid out in points (72 per inch) on A4, and because nothing
// reflows, the page breaks are exact: what is calculated to fit is what fits.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { compressImage } from './imageCompress'

const A4 = { w: 595.28, h: 841.89 }
const M = 40          // side margin
const TOP = 36        // top margin
const FOOT = 46       // reserved at the bottom for the footer

const BRAND = rgb(1, 0.647, 0)          // #FFA500
const INK = rgb(0.051, 0.106, 0.165)    // #0d1b2a
const BODY = rgb(0.27, 0.27, 0.27)
const MUTED = rgb(0.62, 0.62, 0.62)
const HAIR = rgb(0.92, 0.92, 0.92)
const PANEL = rgb(0.97, 0.96, 0.95)

const CONTENT_W = A4.w - M * 2
const COLS = 4
const GAP = 13
const CARD_W = (CONTENT_W - GAP * (COLS - 1)) / COLS
const IMG_H = 84
const NAME_SIZE = 7.5
const NAME_LH = 9.5
const CARD_H = 6 + IMG_H + 11 + NAME_LH * 2 + 5 + 11 + 8

const HEADER_FIRST = 78   // tall opening header (logo + order details + rule)
const HEADER_REST = 56    // compact header on later pages
const ROW_H = 19          // table row

// The standard PDF fonts are WinAnsi-encoded, so anything outside that (a CJK
// character in a product name, an emoji) would throw when drawn. Fold what has a
// sensible equivalent and drop the rest, rather than lose the whole document.
const FOLD = { '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '•': '-', '−': '-' }
// Printable ASCII, Latin-1 (é, ×, ®, ©…) plus the few marks WinAnsi also carries.
const KEEP = /[\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u20AC\u2122]/
export const safeText = s => String(s == null ? '' : s)
  .split('')
  .map(c => (FOLD[c] !== undefined ? FOLD[c] : (KEEP.test(c) ? c : '')))
  .join('')
  .replace(/\s+/g, ' ')
  .trim()

// Break text into lines that fit `width`, up to `maxLines`, adding an ellipsis
// when it has to be cut short.
function wrap(text, font, size, width, maxLines = Infinity) {
  const words = safeText(text).split(' ').filter(Boolean)
  const lines = []
  let line = ''
  const fits = t => font.widthOfTextAtSize(t, size) <= width
  for (const w of words) {
    const next = line ? line + ' ' + w : w
    if (fits(next)) { line = next; continue }
    if (line) lines.push(line)
    // A single word longer than the line — cut it rather than overflow
    if (!fits(w)) {
      let part = ''
      for (const ch of w) { if (!fits(part + ch)) break; part += ch }
      line = part
    } else line = w
    if (lines.length === maxLines) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === maxLines && words.length) {
    const joined = lines.join(' ')
    if (safeText(text).length > joined.length) {
      let last = lines[maxLines - 1]
      while (last && !fits(last + '...')) last = last.slice(0, -1)
      lines[maxLines - 1] = last + '...'
    }
  }
  return lines
}

// Letter-spaced small caps, drawn a character at a time since PDF text has no
// tracking of its own.
function drawTracked(page, text, { x, y, size, font, color, tracking = 1.6 }) {
  let cx = x
  for (const ch of safeText(text)) {
    page.drawText(ch, { x: cx, y, size, font, color })
    cx += font.widthOfTextAtSize(ch, size) + tracking
  }
  return cx - x
}
const trackedWidth = (text, font, size, tracking = 1.6) =>
  safeText(text).split('').reduce((w, c) => w + font.widthOfTextAtSize(c, size) + tracking, 0) - tracking

// Fetch a picture and hand back bytes pdf-lib can embed. Re-encoding through a
// canvas normalises webp and other formats it cannot read, sizes the picture to
// what the card actually shows, and lays it on white so a transparent PNG does
// not come out black. Returns null when the image can't be reached — an external
// link that refuses cross-origin requests — so the caller can draw a placeholder.
async function loadPicture(url) {
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    const { blob: jpg } = await compressImage(blob, { maxDim: 420, quality: 0.82 })
    return new Uint8Array(await jpg.arrayBuffer())
  } catch { return null }
}

/**
 * Build the order sheet.
 * @param {object} o
 * @param {string} o.shop           business name, for the footer
 * @param {string} o.orderName      the analysis / batch name
 * @param {string} o.dateLabel      date shown in the header
 * @param {Array}  o.vendors        [{ name, items: [{ name, qty, imageUrl }] }]
 * @param {string} o.logoUrl        absolute URL of the logo png
 * @param {Array}  o.steps          [{ title, body: [string] }]
 * @param {Array}  o.responsibility paragraphs for the closing clause
 * @returns {Promise<{bytes: Uint8Array, missingImages: number}>}
 */
export async function buildSupplierOrderPdf({ shop, orderName, dateLabel, vendors, logoUrl, steps = [], responsibility = [] }) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Logo — a plain PNG, embedded as-is so it keeps its transparency
  let logo = null
  try {
    const res = await fetch(logoUrl)
    if (res.ok) logo = await pdf.embedPng(new Uint8Array(await res.arrayBuffer()))
  } catch { /* fall back to the shop name in text */ }

  // Every picture up front, so a product appearing twice is only fetched once
  const allItems = vendors.flatMap(v => v.items)
  const urls = [...new Set(allItems.map(i => i.imageUrl).filter(Boolean))]
  const embedded = new Map()
  let missingImages = 0
  await Promise.all(urls.map(async u => {
    const bytes = await loadPicture(u)
    if (!bytes) return
    try { embedded.set(u, await pdf.embedJpg(bytes)) } catch { /* unreadable — placeholder */ }
  }))
  allItems.forEach(i => { if (i.imageUrl && !embedded.has(i.imageUrl)) missingImages += 1 })

  const totalUnits = allItems.reduce((s, i) => s + (Number(i.qty) || 0), 0)
  const multi = vendors.length > 1
  let first = true

  function startPage() {
    const page = pdf.addPage([A4.w, A4.h])
    const isFirst = first
    first = false
    const h = isFirst ? HEADER_FIRST : HEADER_REST
    const logoW = isFirst ? 96 : 62
    const logoH = logo ? logoW * (logo.height / logo.width) : 0
    const ruleY = A4.h - TOP - h + 16

    if (logo) page.drawImage(logo, { x: M, y: ruleY + 12, width: logoW, height: logoH })
    else page.drawText(safeText(shop), { x: M, y: ruleY + 16, size: isFirst ? 17 : 12, font: bold, color: INK })

    if (isFirst) {
      const label = 'ORDER REQUEST'
      const lw = trackedWidth(label, bold, 7.5)
      drawTracked(page, label, { x: A4.w - M - lw, y: ruleY + 48, size: 7.5, font: bold, color: BRAND })
      const nm = safeText(orderName)
      page.drawText(nm, { x: A4.w - M - bold.widthOfTextAtSize(nm, 16), y: ruleY + 30, size: 16, font: bold, color: INK })
      const sub = `${dateLabel} · ${allItems.length} product${allItems.length === 1 ? '' : 's'} · ${totalUnits} pcs`
      const st = safeText(sub)
      page.drawText(st, { x: A4.w - M - font.widthOfTextAtSize(st, 8.5), y: ruleY + 16, size: 8.5, font, color: MUTED })
    } else {
      const t = safeText(orderName)
      page.drawText(t, { x: A4.w - M - bold.widthOfTextAtSize(t, 8.5), y: ruleY + 14, size: 8.5, font: bold, color: MUTED })
    }
    page.drawLine({ start: { x: M, y: ruleY }, end: { x: A4.w - M, y: ruleY }, thickness: 2, color: BRAND })
    return { page, top: ruleY - 22 }   // y of the first content line
  }

  function drawCard(page, x, top, item) {
    page.drawRectangle({ x, y: top - CARD_H, width: CARD_W, height: CARD_H, color: rgb(1, 1, 1), borderColor: HAIR, borderWidth: 0.8 })
    const boxTop = top - 6
    const img = item.imageUrl ? embedded.get(item.imageUrl) : null
    if (img) {
      // Contain the picture in the box, centred, never upscaled past the box
      const s = Math.min((CARD_W - 18) / img.width, (IMG_H - 6) / img.height)
      const iw = img.width * s, ih = img.height * s
      page.drawImage(img, { x: x + (CARD_W - iw) / 2, y: boxTop - IMG_H / 2 - ih / 2, width: iw, height: ih })
    } else {
      page.drawRectangle({ x: x + 1, y: boxTop - IMG_H, width: CARD_W - 2, height: IMG_H, color: PANEL })
      const ch = safeText(item.name).slice(0, 1).toUpperCase() || '?'
      page.drawText(ch, { x: x + CARD_W / 2 - bold.widthOfTextAtSize(ch, 22) / 2, y: boxTop - IMG_H / 2 - 8, size: 22, font: bold, color: rgb(0.85, 0.83, 0.79) })
    }
    let y = boxTop - IMG_H - 13
    wrap(item.name, bold, NAME_SIZE, CARD_W - 16, 2).forEach(l => {
      page.drawText(l, { x: x + 8, y, size: NAME_SIZE, font: bold, color: INK })
      y -= NAME_LH
    })
    page.drawText(`×${Number(item.qty) || 0}`, { x: x + 8, y: top - CARD_H + 10, size: 11, font: bold, color: BRAND })
  }

  // ── Cards, packed four to a row and filling each page before the next ──────
  vendors.forEach(v => {
    let i = 0
    let vendorHeaded = false
    while (i < v.items.length) {
      const { page, top } = startPage()
      let y = top
      if (multi && !vendorHeaded) {
        const label = `${safeText(v.name)} — ${v.items.reduce((s, it) => s + (Number(it.qty) || 0), 0)} pcs`
        page.drawText(label, { x: M, y: y - 10, size: 10.5, font: bold, color: INK })
        y -= 24
        vendorHeaded = true
      }
      const avail = y - FOOT
      const rows = Math.max(1, Math.floor((avail + GAP) / (CARD_H + GAP)))
      for (let r = 0; r < rows && i < v.items.length; r++) {
        const rowTop = y - r * (CARD_H + GAP)
        for (let c = 0; c < COLS && i < v.items.length; c++, i++) {
          drawCard(page, M + c * (CARD_W + GAP), rowTop, v.items[i])
        }
      }
    }

    // ── The same products as a table, continuing across pages ───────────────
    const vendorTotal = v.items.reduce((s, it) => s + (Number(it.qty) || 0), 0)
    let t = 0
    while (t < v.items.length) {
      const { page, top } = startPage()
      let y = top
      page.drawText('#', { x: M, y, size: 7.5, font: bold, color: MUTED })
      page.drawText('PRODUCT', { x: M + 30, y, size: 7.5, font: bold, color: MUTED })
      page.drawText('QTY', { x: A4.w - M - bold.widthOfTextAtSize('QTY', 7.5), y, size: 7.5, font: bold, color: MUTED })
      y -= 6
      page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 1.2, color: rgb(0.9, 0.9, 0.9) })
      y -= ROW_H
      // Keep a row's worth of space so the total never lands on a page alone
      const capacity = Math.max(1, Math.floor((y - FOOT) / ROW_H))
      const take = Math.min(capacity - 1, v.items.length - t)
      for (let k = 0; k < take; k++, t++) {
        const it = v.items[t]
        page.drawText(String(t + 1), { x: M, y, size: 8, font, color: rgb(0.75, 0.75, 0.75) })
        wrap(it.name, font, 9.5, CONTENT_W - 90, 1).forEach(l =>
          page.drawText(l, { x: M + 30, y, size: 9.5, font, color: INK }))
        const q = String(Number(it.qty) || 0)
        page.drawText(q, { x: A4.w - M - bold.widthOfTextAtSize(q, 9.5), y, size: 9.5, font: bold, color: INK })
        page.drawLine({ start: { x: M, y: y - 6 }, end: { x: A4.w - M, y: y - 6 }, thickness: 0.6, color: rgb(0.96, 0.96, 0.96) })
        y -= ROW_H
      }
      if (t >= v.items.length) {
        page.drawLine({ start: { x: M, y: y + 12 }, end: { x: A4.w - M, y: y + 12 }, thickness: 1.2, color: rgb(0.87, 0.87, 0.87) })
        const label = multi ? `Total — ${safeText(v.name)}` : 'Total'
        page.drawText(label, { x: M + 30, y, size: 9.5, font: bold, color: INK })
        const q = `${vendorTotal} pcs`
        page.drawText(q, { x: A4.w - M - bold.widthOfTextAtSize(q, 9.5), y, size: 9.5, font: bold, color: INK })
      }
    }
  })

  // ── Steps and the responsibility clause ───────────────────────────────────
  if (steps.length || responsibility.length) {
    let ctx = startPage()
    let y = ctx.top
    const need = h => { if (y - h < FOOT) { ctx = startPage(); y = ctx.top } }

    ctx.page.drawText('Steps to follow during the order', { x: M, y: y - 6, size: 15, font: bold, color: INK })
    y -= 30
    wrap('Please follow these steps to avoid any mistakes or confusion later. Begin as soon as my payment reaches you.', font, 9.5, CONTENT_W, 3)
      .forEach(l => { ctx.page.drawText(l, { x: M, y, size: 9.5, font, color: BODY }); y -= 14 })
    y -= 12

    steps.forEach((s, i) => {
      const lines = s.body.flatMap(b => wrap(b, font, 9, CONTENT_W - 34))
      need(24 + lines.length * 13 + 14)
      ctx.page.drawCircle({ x: M + 9, y: y - 3, size: 9, color: BRAND })
      const n = String(i + 1)
      ctx.page.drawText(n, { x: M + 9 - bold.widthOfTextAtSize(n, 9) / 2, y: y - 6, size: 9, font: bold, color: rgb(1, 1, 1) })
      ctx.page.drawText(safeText(s.title), { x: M + 26, y: y - 6, size: 10.5, font: bold, color: INK })
      y -= 22
      lines.forEach(l => { ctx.page.drawText(l, { x: M + 26, y, size: 9, font, color: BODY }); y -= 13 })
      y -= 11
    })

    if (responsibility.length) {
      const wrapped = responsibility.map(p => wrap(p, font, 9, CONTENT_W - 24))
      const boxH = 26 + wrapped.reduce((s, w) => s + w.length * 13 + 6, 0)
      need(boxH + 10)
      ctx.page.drawRectangle({ x: M, y: y - boxH + 12, width: CONTENT_W, height: boxH, color: rgb(1, 0.98, 0.94), borderColor: rgb(0.95, 0.886, 0.765), borderWidth: 0.8 })
      let by = y - 6
      ctx.page.drawText('Responsibility', { x: M + 12, y: by, size: 10, font: bold, color: rgb(0.54, 0.42, 0.16) })
      by -= 17
      wrapped.forEach(lines => {
        lines.forEach(l => { ctx.page.drawText(l, { x: M + 12, y: by, size: 9, font, color: rgb(0.42, 0.33, 0.13) }); by -= 13 })
        by -= 6
      })
    }
  }

  // ── Footer on every page, once the total is known ─────────────────────────
  const pages = pdf.getPages()
  const year = new Date().getFullYear()
  pages.forEach((page, i) => {
    const y = FOOT - 14
    page.drawLine({ start: { x: M, y: y + 12 }, end: { x: A4.w - M, y: y + 12 }, thickness: 0.6, color: HAIR })
    page.drawText(safeText(`© ${year} ${shop}. All rights reserved.`), { x: M, y, size: 8, font, color: MUTED })
    const p = `Page ${i + 1} of ${pages.length}`
    page.drawText(p, { x: A4.w - M - font.widthOfTextAtSize(p, 8), y, size: 8, font, color: MUTED })
  })

  return { bytes: await pdf.save(), missingImages }
}
