// Pictures in and out of Cloudflare R2.
//
// The front end still writes supabase.storage.from('uploads').upload(...); the
// shim posts here instead. Files arrive already shrunk by the browser (see
// src/lib/imageCompress.js), so these are tens of kilobytes, not megabytes.
//
// Who may upload, and under what name, is the interesting part:
//
//   staff     — may name the object. The supplier catalog re-compresses photos
//               in place and has to write back to the exact same key, or every
//               image_url in the database would need rewriting.
//   everyone  — a shopper paying by transfer uploads their slip at checkout,
//               and checkout happens before there is an account. So anonymous
//               uploads are allowed, but the server picks the name, refuses to
//               overwrite anything, and only takes images and PDFs.

const express = require('express')
const multer = require('multer')
const rateLimit = require('express-rate-limit')
const r2 = require('../lib/r2')

const router = express.Router()

const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 10 * 1024 * 1024)

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/pdf',
])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
})

// An open upload endpoint is an invitation to fill someone else's bucket, so
// anonymous callers get a modest allowance.
const anonLimit = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  skip: req => req.auth?.role === 'staff',
  message: { data: null, error: { message: 'Too many uploads — try again shortly' } },
})

const extFor = (mime, fallback) => ({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
}[mime] || fallback || 'bin')

const fail = (res, status, message) =>
  res.status(status).json({ data: null, error: { message } })

router.post('/:bucket/upload', anonLimit, upload.single('file'), async (req, res) => {
  if (!r2.configured()) return fail(res, 503, 'File storage is not configured on this server')
  if (req.params.bucket !== r2.BUCKET()) return fail(res, 404, `No bucket named '${req.params.bucket}'`)
  if (!req.file) return fail(res, 400, 'No file was sent')

  const type = req.file.mimetype || 'application/octet-stream'
  if (!ALLOWED.has(type)) return fail(res, 415, `${type} files are not accepted`)

  const isStaff = req.auth?.role === 'staff'
  const requested = String(req.body?.name || '')
  const upsert = String(req.body?.upsert) === 'true'

  let key
  if (isStaff && requested) {
    if (!r2.isSafeKey(requested)) return fail(res, 400, 'That file name has characters that are not allowed')
    key = requested
  } else {
    // Everyone else gets a name we choose. `web-` marks it as having come from
    // the public site, so it can never collide with, or overwrite, a product
    // photo or a staff-uploaded slip.
    const rand = Math.random().toString(36).slice(2, 8)
    key = `web-${Date.now()}-${rand}.${extFor(type, 'jpg')}`
  }

  if (!isStaff || !upsert) {
    try {
      if (await r2.exists(key)) return fail(res, 409, 'A file with that name already exists')
    } catch (e) {
      return fail(res, 502, `Storage did not answer: ${e.message}`)
    }
  }

  try {
    const out = await r2.put(key, req.file.buffer, type)
    return res.json({
      data: { path: out.key, publicUrl: out.url, size: req.file.size, contentType: type },
      error: null,
    })
  } catch (e) {
    console.error('[storage] upload failed:', e.message)
    return fail(res, 502, `Upload failed: ${e.message}`)
  }
})

// Serving the files ourselves. Only used until a public bucket domain is
// connected in Cloudflare — after that R2_PUBLIC_BASE is set and browsers go
// straight to Cloudflare, which is both faster and free.
router.get('/:bucket/:key', async (req, res) => {
  if (!r2.configured()) return res.status(503).end()
  if (req.params.bucket !== r2.BUCKET()) return res.status(404).end()

  const key = decodeURIComponent(req.params.key)
  if (!r2.isSafeKey(key)) return res.status(400).end()

  try {
    const obj = await r2.get(key)
    res.set('Content-Type', obj.ContentType || 'application/octet-stream')
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
    if (obj.ContentLength) res.set('Content-Length', String(obj.ContentLength))
    obj.Body.pipe(res)
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NoSuchKey') return res.status(404).end()
    console.error('[storage] read failed:', e.message)
    res.status(502).end()
  }
})

// Staff only — removing a picture that is still referenced somewhere leaves a
// broken image, so this is never called automatically.
router.delete('/:bucket/:key', async (req, res) => {
  if (req.auth?.role !== 'staff') return fail(res, 403, 'Staff only')
  if (req.params.bucket !== r2.BUCKET()) return fail(res, 404, 'No such bucket')

  const key = decodeURIComponent(req.params.key)
  if (!r2.isSafeKey(key)) return fail(res, 400, 'Bad file name')

  try {
    await r2.remove(key)
    return res.json({ data: { path: key }, error: null })
  } catch (e) {
    return fail(res, 502, e.message)
  }
})

router.get('/:bucket', async (req, res) => {
  if (req.auth?.role !== 'staff') return fail(res, 403, 'Staff only')
  if (req.params.bucket !== r2.BUCKET()) return fail(res, 404, 'No such bucket')
  try {
    const out = await r2.list(String(req.query.prefix || ''), req.query.cursor || undefined)
    return res.json({ data: out, error: null })
  } catch (e) {
    return fail(res, 502, e.message)
  }
})

// multer throws its own errors (file too large); turn them into our shape.
router.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return fail(res, 413, `That file is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB`)
  }
  console.error('[storage]', err?.message || err)
  return fail(res, 500, 'Upload failed')
})

module.exports = router
