// What a file actually is, as opposed to what it says it is.
//
// A browser tells us the type of an upload in a header, and multer hands that
// straight through as req.file.mimetype. It is a claim, not a fact: whoever is
// posting decides what it says. Anyone can send a script and label it
// image/jpeg, and every check we make on the label will pass.
//
// So we look at the file instead. Almost every format begins with a few fixed
// bytes — a "magic number" — that identify it: a JPEG always starts FF D8 FF, a
// PNG always starts with the eight bytes below. Those are part of the format
// itself, so a real JPEG cannot be missing them and a fake one cannot fake them
// without becoming a real JPEG.
//
// sniff() returns the type it recognises, or null for anything it does not.
// null is the answer that matters: it means the bytes are not one of the
// handful of formats a shop needs, whatever the upload claimed.

// Bytes 8-12 of an ISO base media file name the flavour. HEIC photos from an
// iPhone are one of these; so are AVIF images. Videos (isom, mp42) are the same
// container with a different brand, which is exactly why the brand is checked
// and not just the "ftyp" marker.
const HEIF_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis',
  'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1',
  'avif', 'avis',
])

const startsWith = (buf, bytes) =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b)

const asciiAt = (buf, start, len) =>
  buf.length >= start + len ? buf.toString('latin1', start, start + len) : ''

function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null

  // JPEG — FF D8 FF, then a marker byte that varies by encoder.
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg'

  // PNG — the eight-byte signature from the specification. The CR/LF and
  // Ctrl-Z in the middle are there to catch files mangled in transit.
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'

  // GIF — "GIF87a" or "GIF89a".
  const gif = asciiAt(buf, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'

  // WebP — a RIFF container whose form type is WEBP. Both parts are needed:
  // RIFF on its own is also a .wav.
  if (asciiAt(buf, 0, 4) === 'RIFF' && asciiAt(buf, 8, 4) === 'WEBP') return 'image/webp'

  // HEIC/HEIF/AVIF — "ftyp" then the brand.
  if (asciiAt(buf, 4, 4) === 'ftyp') {
    const brand = asciiAt(buf, 8, 4).toLowerCase()
    if (HEIF_BRANDS.has(brand)) return brand.startsWith('avi') ? 'image/avif' : 'image/heic'
  }

  // PDF — "%PDF-". The specification puts it first, but readers tolerate a
  // little leading junk and so do plenty of real-world generators, so look
  // through the opening kilobyte rather than only at byte zero.
  const head = buf.subarray(0, 1024).toString('latin1')
  if (head.includes('%PDF-')) return 'application/pdf'

  return null
}

module.exports = { sniff }
