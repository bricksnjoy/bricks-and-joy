// Cloudflare R2 — where every picture the shop stores now lives.
//
// R2 speaks the S3 API, so this is the ordinary S3 client pointed at
// Cloudflare's endpoint. Two things are worth knowing about it:
//
//   There are no per-object ACLs. A file is public because the *bucket* is
//   published, either on r2.dev or on a custom domain you connect in the
//   Cloudflare dashboard. That address goes in R2_PUBLIC_BASE and is what gets
//   written into the database as image_url. If it isn't set, the API serves the
//   files itself from /api/storage/... — slower, but it works on day one before
//   the domain is connected.
//
//   Egress is free. That is the reason for moving here rather than to a disk on
//   the VPS: product photos are read far more often than they are written, and
//   Cloudflare does not bill for serving them.

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
        HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3')

const BUCKET = () => process.env.R2_BUCKET || 'uploads'

let client = null
function r2() {
  if (client) return client
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT } = process.env
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || (!R2_ACCOUNT_ID && !R2_ENDPOINT)) {
    throw new Error('R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY')
  }
  client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  })
  return client
}

const configured = () =>
  Boolean(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY &&
         (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT))

// The address a browser fetches this object from. Falls back to our own API
// when no public bucket domain has been connected yet.
function publicUrl(key) {
  const base = (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '')
  if (base) return `${base}/${encodeURIComponent(key)}`
  const api = (process.env.PUBLIC_API_URL || '').replace(/\/+$/, '')
  return `${api}/storage/${BUCKET()}/${encodeURIComponent(key)}`
}

async function put(key, body, contentType) {
  await r2().send(new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
    // A year: these objects are content-addressed by their timestamped name and
    // never change under the same key, except when the catalog re-compresses
    // one in place — which is rare and tolerable.
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return { key, url: publicUrl(key) }
}

async function get(key) {
  return r2().send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }))
}

async function exists(key) {
  try {
    await r2().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }))
    return true
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false
    throw e
  }
}

async function remove(key) {
  await r2().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }))
  return { key }
}

async function list(prefix = '', token) {
  const out = await r2().send(new ListObjectsV2Command({
    Bucket: BUCKET(), Prefix: prefix, ContinuationToken: token, MaxKeys: 1000,
  }))
  return {
    keys: (out.Contents || []).map(o => ({ key: o.Key, size: o.Size, modified: o.LastModified })),
    next: out.IsTruncated ? out.NextContinuationToken : null,
  }
}

// Object keys go straight into a URL and into the bucket, so they are kept to
// the boring characters. No slashes, so nothing can climb out of the bucket
// root or shadow a folder; no spaces, so no URL escaping surprises later.
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const isSafeKey = k => typeof k === 'string' && SAFE_KEY.test(k) && !k.includes('..')

module.exports = { r2, configured, publicUrl, put, get, exists, remove, list, isSafeKey, BUCKET }
