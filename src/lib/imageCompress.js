// Shrinking photos to a size that suits a web shop.
//
// A photo straight off a phone is 1–3 MB and thousands of pixels wide — far more
// than a product card or listing ever shows. Re-drawn at a sensible width and
// re-encoded, the same picture is a fraction of the size with no visible loss on
// screen. This is used both to compress the photos already uploaded and, later,
// to shrink new ones as they arrive.

export const DEFAULTS = { maxDim: 1000, quality: 0.82 }

export const humanBytes = n => {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export const isDataUrl = u => /^data:image\//i.test(String(u || ''))
export const isHttpUrl = u => /^https?:\/\//i.test(String(u || ''))

// The path inside the `uploads` bucket, taken from a Supabase public URL, so the
// compressed version can be written back over exactly the same object — which
// keeps the URL, and therefore every product that already points at it, working.
// Returns null when the URL isn't a Supabase storage URL (an external link).
export function storagePathFromUrl(url) {
  const m = String(url || '').match(/\/object\/(?:public|sign)\/uploads\/([^?]+)/)
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return m[1] }
}

export const isStorageUrl = u => storagePathFromUrl(u) != null

// Draw a blob onto a canvas at the capped size and re-encode it. Honours the
// photo's own orientation so nothing ends up sideways, and lays it on white so a
// transparent PNG doesn't turn black when it becomes a JPEG.
//
// Returns { blob, width, height } — or throws if the image can't be decoded.
export async function compressImage(blob, { maxDim = DEFAULTS.maxDim, quality = DEFAULTS.quality } = {}) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    const { width: w, height: h } = bmp
    const scale = Math.min(1, maxDim / Math.max(w, h))
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw; canvas.height = ch
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cw, ch)
    ctx.drawImage(bmp, 0, 0, cw, ch)
    const out = await new Promise((res, rej) =>
      canvas.toBlob(b => b ? res(b) : rej(new Error('Could not encode image')), 'image/jpeg', quality))
    return { blob: out, width: cw, height: ch }
  } finally {
    bmp.close?.()
  }
}

// Worth compressing? Skip anything already small enough that re-encoding would
// only cost quality for a handful of saved bytes.
export function worthCompressing(bytes) {
  return typeof bytes === 'number' && bytes > 160 * 1024   // ~160 KB
}
