// One way in for every picture the app stores.
//
// Slips, receipts, product photos and event pictures were each uploaded by their
// own copy of the same code, all of it sending the file exactly as it came off
// the phone — 2–4 MB for a picture nobody ever views larger than a phone screen.
// A year of ordinary trading ran to gigabytes of it.
//
// They all land in Cloudflare R2 now, by way of our own API. Shrinking them
// first still matters: storage is cheap but the shop is in the Maldives and the
// people uploading are on phones, so a tenth of the bytes is a tenth of the wait.
//
// Everything goes through here and is re-drawn smaller first. Two presets,
// because they are not the same job:
//
//   SLIP  — a bank slip is read, not admired. What matters is that the reference
//           number and amount stay sharp. Tested down to the point where the
//           digits start to soften, then backed off: 1200px is comfortably
//           readable, and real photos of slips are noisier than a clean
//           screenshot so the margin is deliberate.
//   PHOTO — a product picture is only ever shown in a card or a listing, so it
//           can be smaller still while looking the same on screen.

import { supabase } from './supabase'
import { compressImage, humanBytes } from './imageCompress'

export const SLIP = { maxDim: 1200, quality: 0.7 }
export const PHOTO = { maxDim: 1000, quality: 0.82 }

const isImage = f => (f?.type || '').startsWith('image/')

/**
 * Shrink a picture and put it in storage.
 * Anything that isn't an image (a PDF slip) is stored untouched.
 * If storage refuses, it falls back to an inline data URL as before — but of the
 * *compressed* picture, so even that case is a tenth of what it used to be.
 *
 * @returns {Promise<{url: string|null, name: string, type: string, before: number, after: number}>}
 */
// 122 bits of randomness. crypto.randomUUID needs a secure context, which the
// live site is; the fallback covers a stale browser without quietly dropping
// back to something guessable.
function randomId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    const b = new Uint8Array(16)
    globalThis.crypto.getRandomValues(b)
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  } catch {
    // No crypto at all — say so rather than pretend, so a slip is never filed
    // under a name that can be guessed.
    throw new Error('This browser cannot generate a secure file name — please update it')
  }
}

export async function uploadImage(file, { prefix = 'file', preset = PHOTO } = {}) {
  const before = file.size
  let body = file
  let ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
  let contentType = file.type || undefined

  if (isImage(file)) {
    try {
      const { blob } = await compressImage(file, preset)
      // Keep whichever is smaller — a picture already tiny can come back bigger
      // once re-encoded, and there is no sense storing the worse one.
      if (blob && blob.size < before) { body = blob; ext = 'jpg'; contentType = 'image/jpeg' }
    } catch { /* unreadable image — store it as it came */ }
  }

  // The bucket is public, because product photos have to be. That makes the
  // file name the only thing standing between a stranger and somebody's bank
  // slip, so it has to be unguessable rather than merely unique.
  //
  // This used to be a millisecond and four characters of Math.random() — about
  // twenty bits, next to a timestamp anyone can narrow down to the day an order
  // was placed. A UUID is 122 bits from the browser's cryptographic generator,
  // which is the same thing a private share link relies on anywhere else.
  const name = `${prefix}-${randomId()}.${ext}`
  const { data, error } = await supabase.storage.from('uploads').upload(name, body, { upsert: true, contentType })
  if (!error) {
    // Use the name storage actually filed it under, not the one we asked for.
    // A shopper uploading a payment slip at checkout isn't signed in, and the
    // server renames those so they cannot land on top of a product photo.
    const key = data?.path || name
    const url = data?.publicUrl || supabase.storage.from('uploads').getPublicUrl(key).data.publicUrl
    return { url, name: file.name, type: contentType || file.type || '', before, after: body.size }
  }

  const url = await new Promise(res => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = () => res(null)
    r.readAsDataURL(body)
  })
  return { url, name: file.name, type: contentType || file.type || '', before, after: body.size }
}

// Upload several, keeping the order they were picked in.
export async function uploadImages(files, opts) {
  const out = []
  for (const f of Array.from(files || [])) out.push(await uploadImage(f, opts))
  return out
}

// "2.4 MB → 118 KB (95% smaller)", for the toast that follows an upload.
export function savingLabel(before, after) {
  if (!before || after >= before) return null
  return `${humanBytes(before)} → ${humanBytes(after)} (${Math.round((1 - after / before) * 100)}% smaller)`
}
