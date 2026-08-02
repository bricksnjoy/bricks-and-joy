// One way in for every picture the app stores.
//
// Slips, receipts, product photos and event pictures were each uploaded by their
// own copy of the same code, all of it sending the file exactly as it came off
// the phone — 2–4 MB for a picture nobody ever views larger than a phone screen.
// That fills the free 1 GB of storage in about a year of ordinary trading.
//
// Everything now goes through here and is re-drawn smaller first. Two presets,
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

  const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`
  const { error } = await supabase.storage.from('uploads').upload(name, body, { upsert: true, contentType })
  if (!error) {
    const { data } = supabase.storage.from('uploads').getPublicUrl(name)
    return { url: data.publicUrl, name: file.name, type: contentType || file.type || '', before, after: body.size }
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
