// Opening a document and printing it.
//
// Every receipt, label sheet and report used to carry its own instruction to
// print, written into the document as an inline <script>:
//
//     <script>window.onload = () => { window.print(); … }</script>
//
// which is the one thing the Content-Security-Policy cannot allow. `script-src
// 'self'` exists to stop a script that was injected into a page from running,
// and a browser cannot tell our inline script from an attacker's — that is the
// whole point of the rule. So while those lines were in there, the policy could
// only ever watch and report; it could not be switched on to actually block.
//
// The instruction moves out here instead. It is the same instruction, but it
// now lives in the app's own JavaScript, which is served from our site and
// therefore allowed, and the printed document goes back to being nothing but
// content. Staff see no difference at all.

// Print once, and only once the document is ready to be printed.
//
// Asking too early is the failure that matters here: the dialog opens before
// the logo, the barcodes or the web font have arrived, and what comes out of
// the printer has blank squares in it. That would not show up in testing — it
// would show up with a customer waiting at the counter.
//
// The obvious way to wait is the document's load event, or readyState. Neither
// can be trusted for a document built with document.write: measured in Chrome,
// readyState is already 'complete' a few milliseconds after close(), with a
// picture still seconds away from arriving. Asked that way, a receipt prints
// with empty squares in it.
//
// So the pictures are counted and waited for one by one — which is what the
// order sheet already did, and it was right — and then the web font, because
// text set in the fallback prints visibly differently. Then the timeout, over
// the top of all of it: a picture that never comes must not cost somebody their
// receipt. Product photos can point at a supplier's site, and those go down.
function printWhenReady(win, { closeAfter = false, timeout = 3000 } = {}) {
  let printed = false
  const go = () => {
    if (printed) return
    try {
      if (win.closed) return
    } catch { return }                 // window is gone entirely
    printed = true
    try {
      if (closeAfter) win.onafterprint = () => { try { win.close() } catch { /* already gone */ } }
      win.focus()
      win.print()
    } catch {
      // Closed by hand between writing and printing. Nothing to do.
    }
  }

  const afterFonts = () => {
    let fonts = null
    try { fonts = win.document.fonts && win.document.fonts.ready } catch { /* not supported */ }
    if (fonts && typeof fonts.then === 'function') fonts.then(go, go)
    else go()
  }

  const afterPictures = () => {
    let pending
    try { pending = Array.prototype.slice.call(win.document.images).filter(img => !img.complete) }
    catch { return go() }              // document not reachable; print and hope

    if (!pending.length) return afterFonts()
    let left = pending.length
    pending.forEach(img => {
      img.onload = img.onerror = () => { if (--left <= 0) afterFonts() }
    })
  }

  try {
    if (win.document.readyState === 'loading') win.addEventListener('DOMContentLoaded', afterPictures, { once: true })
    else afterPictures()
  } catch { go() }

  setTimeout(go, timeout)
  return go
}

/**
 * Open a window, write `html` into it, and print it.
 *
 * @param {string} html
 * @param {object} [opts]
 * @param {string}  [opts.features]    window.open features, e.g. 'width=480,height=640'
 * @param {boolean} [opts.closeAfter=true]  close once the dialog is done. Receipts
 *   do; label sheets and reports stay open on purpose, so a second copy does not
 *   mean building the whole thing again.
 * @param {number}  [opts.timeout=3000]  how long to wait for pictures before
 *   printing anyway.
 * @returns {Window|null}  null if the browser blocked the pop-up
 */
export function printHtml(html, { features = '', closeAfter = true, timeout = 3000 } = {}) {
  const w = window.open('', '_blank', features)
  if (!w) return null              // pop-up blocker; the caller decides what to say

  w.document.write(html)
  w.document.close()
  printWhenReady(w, { closeAfter, timeout })
  return w
}

/**
 * Print `html` through an off-screen frame, without opening a tab.
 *
 * Smoother on a desktop than a window: the dialog opens straight away and there
 * is nothing left to close afterwards. Kept at full page size and merely parked
 * out of sight, so it lays out exactly as it will print.
 *
 * @param {string} html
 * @param {object} [opts]
 * @param {number} [opts.timeout=3000]  how long to wait for pictures.
 */
export function printInFrame(html, { timeout = 3000 } = {}) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed; left:-10000px; top:0; width:210mm; height:297mm; border:0;'
  document.body.appendChild(frame)

  const drop = () => { if (frame.parentNode) frame.remove() }
  const win = frame.contentWindow
  win.onafterprint = () => setTimeout(drop, 500)
  setTimeout(drop, 120000)         // never leave it behind if printing is dismissed

  const doc = win.document
  doc.open(); doc.write(html); doc.close()
  printWhenReady(win, { closeAfter: false, timeout })
  return frame
}

/**
 * Make a button inside a printed document print it.
 *
 * The order sheet carries its own "Print / Save as PDF" button, for phones,
 * where a browser will not print a page the person is not looking at. It used
 * to be an onclick="" attribute, which the policy blocks for the same reason it
 * blocks an inline <script>. The click is wired up from here instead.
 */
export function wirePrintButton(win, selector = '.printbar button') {
  try {
    const btn = win.document.querySelector(selector)
    if (btn) btn.addEventListener('click', () => { try { win.focus(); win.print() } catch { /* gone */ } })
  } catch { /* document not reachable; the auto-print above still ran */ }
}
