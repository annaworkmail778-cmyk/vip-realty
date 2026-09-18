// VIP Realty — image binary validation (source of truth: automation/media/validate-image.js).
//
// Runs inside n8n Code nodes (embedded verbatim) and in local tests (node --test automation/media).
// Pure JavaScript: no modules, no network, no image decoding library. It never trusts a declared MIME
// type or file name: the format is detected from the bytes, and the file's container structure is
// walked and checked end to end (JPEG segments + end-of-image marker, PNG chunk CRCs, WebP RIFF chunk
// bounds, AVIF box bounds). Truncated, padded-out, corrupt or disguised files are rejected.
// Limits (allowed formats, maximum bytes) come from the caller, which reads them from the database
// (storage.buckets 'property-images'); the database re-checks every reported fact.

const MEDIA_ALLOWED_DEFAULT = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

// ------------------------------------------------------------------ SHA-256 (FIPS 180-4)
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Hex(bytes) {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const tail = new Uint8Array(total - Math.floor(len / 64) * 64);
  const tailStart = Math.floor(len / 64) * 64;
  tail.set(bytes.subarray(tailStart));
  tail[len - tailStart] = 0x80;
  const bitsHi = Math.floor(len / 0x20000000);
  const bitsLo = (len * 8) >>> 0;
  const t = tail.length;
  tail[t - 8] = bitsHi >>> 24; tail[t - 7] = bitsHi >>> 16; tail[t - 6] = bitsHi >>> 8; tail[t - 5] = bitsHi;
  tail[t - 4] = bitsLo >>> 24; tail[t - 3] = bitsLo >>> 16; tail[t - 2] = bitsLo >>> 8; tail[t - 1] = bitsLo;

  const block = (src, off) => {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((src[j] << 24) | (src[j + 1] << 16) | (src[j + 2] << 8) | src[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  };

  for (let off = 0; off < tailStart; off += 64) block(bytes, off);
  for (let off = 0; off < tail.length; off += 64) block(tail, off);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += h[i].toString(16).padStart(8, '0');
  return hex;
}

/** Meta reports sha256 as hex or base64; compare either form with our hex digest. */
function sameSha256(hex, reported) {
  if (typeof reported !== 'string' || reported.trim() === '') return null;
  const r = reported.trim();
  if (/^[0-9a-fA-F]{64}$/.test(r)) return r.toLowerCase() === hex;
  if (/^[A-Za-z0-9+/]{43}=?$/.test(r)) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = '';
    for (const ch of r.replace(/=+$/, '')) bits += alphabet.indexOf(ch).toString(2).padStart(6, '0');
    let out = '';
    for (let i = 0; i + 8 <= bits.length && out.length < 64; i += 8) out += parseInt(bits.slice(i, i + 8), 2).toString(16).padStart(2, '0');
    return out === hex;
  }
  return null; // unknown representation: not comparable
}

// ------------------------------------------------------------------ CRC-32 (PNG)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------ readers
const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

class Corrupt extends Error {}
const need = (cond, why) => { if (!cond) throw new Corrupt(why); };

// ------------------------------------------------------------------ format detection (bytes only)
function detectFormat(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a
      && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const size = u32be(b, 0);
    if (size >= 16 && size <= b.length) {
      const brands = [ascii(b, 8, 4)];
      for (let o = 16; o + 4 <= size; o += 4) brands.push(ascii(b, o, 4));
      if (brands.includes('avif') || brands.includes('avis')) return 'image/avif';
    }
    return null; // other ISO-BMFF (HEIC, MP4, …): not an allowed image format
  }
  return null;
}

// ------------------------------------------------------------------ JPEG
function parseJpeg(b) {
  let o = 2;
  let frame = null;
  for (;;) {
    need(o < b.length, 'jpeg: truncated before start of scan');
    need(b[o] === 0xff, 'jpeg: marker expected');
    while (o < b.length && b[o] === 0xff) o++;
    need(o < b.length, 'jpeg: truncated marker');
    const m = b[o++];
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
    need(m !== 0xd9 && m !== 0xd8, 'jpeg: unexpected image boundary');
    need(o + 2 <= b.length, 'jpeg: truncated segment');
    const len = u16be(b, o);
    need(len >= 2 && o + len <= b.length, 'jpeg: segment out of bounds');
    const isSof = (m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (isSof) {
      need(len >= 8, 'jpeg: short frame header');
      const height = u16be(b, o + 3);
      const width = u16be(b, o + 5);
      const comps = b[o + 7];
      need(comps >= 1 && comps <= 4 && len === 8 + 3 * comps, 'jpeg: bad frame components');
      frame = { width, height };
    }
    if (m === 0xda) {
      need(frame !== null, 'jpeg: scan before frame header');
      const scanStart = o + len;
      let eoi = -1;
      for (let i = b.length - 2; i >= scanStart; i--) {
        if (b[i] === 0xff && b[i + 1] === 0xd9) { eoi = i; break; }
      }
      need(eoi > scanStart, 'jpeg: missing end-of-image marker (truncated)');
      return frame;
    }
    o += len;
  }
}

// ------------------------------------------------------------------ PNG
function parsePng(b) {
  let o = 8;
  let first = true;
  let dims = null;
  let idat = false;
  for (;;) {
    need(o + 12 <= b.length, 'png: truncated chunk');
    const len = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    need(/^[A-Za-z]{4}$/.test(type), 'png: invalid chunk type');
    need(len <= 0x7fffffff && o + 12 + len <= b.length, 'png: chunk out of bounds');
    const crc = u32be(b, o + 8 + len);
    need(crc32(b, o + 4, o + 8 + len) === crc, 'png: chunk CRC mismatch (' + type + ')');
    if (first) {
      need(type === 'IHDR' && len === 13, 'png: IHDR must come first');
      const depth = b[o + 16], color = b[o + 17];
      const ok = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      need(ok[color] !== undefined && ok[color].includes(depth), 'png: invalid bit depth / color type');
      dims = { width: u32be(b, o + 8), height: u32be(b, o + 12) };
      first = false;
    }
    if (type === 'IDAT') idat = true;
    o += 12 + len;
    if (type === 'IEND') {
      need(len === 0 && idat, 'png: IEND without image data');
      need(o === b.length, 'png: data after IEND');
      return dims;
    }
  }
}

// ------------------------------------------------------------------ WebP
function parseWebp(b) {
  const riff = u32le(b, 4);
  need(riff + 8 === b.length, 'webp: RIFF size does not match file size');
  let o = 12;
  let dims = null;
  let hasImage = false;
  let first = true;
  while (o < b.length) {
    need(o + 8 <= b.length, 'webp: truncated chunk header');
    const type = ascii(b, o, 4);
    const size = u32le(b, o + 4);
    const d = o + 8;
    need(d + size <= b.length, 'webp: chunk out of bounds');
    if (type === 'VP8 ') {
      need(size >= 10 && b[d + 3] === 0x9d && b[d + 4] === 0x01 && b[d + 5] === 0x2a, 'webp: bad VP8 frame');
      if (first) dims = { width: u16le(b, d + 6) & 0x3fff, height: u16le(b, d + 8) & 0x3fff };
      hasImage = true;
    } else if (type === 'VP8L') {
      need(size >= 5 && b[d] === 0x2f, 'webp: bad VP8L signature');
      if (first) {
        const b1 = b[d + 1], b2 = b[d + 2], b3 = b[d + 3], b4 = b[d + 4];
        dims = { width: 1 + (b1 | ((b2 & 0x3f) << 8)), height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) };
      }
      hasImage = true;
    } else if (type === 'VP8X') {
      need(first && size >= 10, 'webp: bad VP8X');
      dims = { width: 1 + u24le(b, d + 4), height: 1 + u24le(b, d + 7) };
    } else if (type === 'ANMF') {
      hasImage = true;
    } else {
      need(!first, 'webp: unknown first chunk');
    }
    first = false;
    o = d + size + (size & 1);
  }
  need(o === b.length, 'webp: trailing bytes');
  need(hasImage && dims !== null, 'webp: no image data');
  return dims;
}

// ------------------------------------------------------------------ AVIF (ISO BMFF)
function boxes(b, start, end) {
  const out = [];
  let o = start;
  while (o < end) {
    need(o + 8 <= end, 'avif: truncated box header');
    let size = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    let header = 8;
    if (size === 1) {
      need(o + 16 <= end, 'avif: truncated large box');
      need(u32be(b, o + 8) === 0, 'avif: box too large');
      size = u32be(b, o + 12);
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    need(size >= header && o + size <= end, 'avif: box out of bounds (' + type + ')');
    out.push({ type, start: o + header, end: o + size });
    o += size;
  }
  need(o === end, 'avif: box sizes do not add up');
  return out;
}

function parseAvif(b) {
  const top = boxes(b, 0, b.length);
  need(top[0] && top[0].type === 'ftyp', 'avif: ftyp must come first');
  const meta = top.find((x) => x.type === 'meta');
  need(meta && top.some((x) => x.type === 'mdat'), 'avif: missing meta or mdat');
  const metaKids = boxes(b, meta.start + 4, meta.end); // meta is a full box (version + flags)
  const iprp = metaKids.find((x) => x.type === 'iprp');
  need(iprp, 'avif: missing item properties');
  const ipco = boxes(b, iprp.start, iprp.end).find((x) => x.type === 'ipco');
  need(ipco, 'avif: missing property container');
  const ispe = boxes(b, ipco.start, ipco.end).find((x) => x.type === 'ispe');
  need(ispe && ispe.end - ispe.start >= 12, 'avif: missing image size');
  return { width: u32be(b, ispe.start + 4), height: u32be(b, ispe.start + 8) };
}

// ------------------------------------------------------------------ entry point
/**
 * @param {Uint8Array} bytes
 * @param {{allowedMimeTypes?: string[], maxBytes: number, maxDimension?: number, maxPixels?: number}} opts
 * @returns {{valid: boolean, code: string|null, detail: string|null, detected_mime_type: string|null,
 *            width: number|null, height: number|null, file_size: number, sha256: string|null}}
 */
function validateImage(bytes, opts) {
  const allowed = (opts && Array.isArray(opts.allowedMimeTypes) && opts.allowedMimeTypes.length)
    ? opts.allowedMimeTypes : MEDIA_ALLOWED_DEFAULT;
  const maxBytes = opts && Number.isFinite(opts.maxBytes) ? opts.maxBytes : 0;
  const maxDim = (opts && opts.maxDimension) || 20000;
  const maxPixels = (opts && opts.maxPixels) || 100000000;
  const size = bytes ? bytes.length : 0;
  const result = (code, extra) => Object.assign({
    valid: code === null, code, detail: null, detected_mime_type: null, width: null, height: null,
    file_size: size, sha256: size > 0 ? sha256Hex(bytes) : null,
  }, extra || {});

  if (!bytes || size === 0) return result('empty_file');
  if (!(maxBytes > 0)) return result('limit_unknown');
  if (size > maxBytes) return result('oversized');
  const mime = detectFormat(bytes);
  if (!mime) return result('unsupported_format');
  let dims;
  try {
    dims = mime === 'image/jpeg' ? parseJpeg(bytes)
      : mime === 'image/png' ? parsePng(bytes)
      : mime === 'image/webp' ? parseWebp(bytes)
      : parseAvif(bytes);
  } catch (e) {
    if (e instanceof Corrupt) return result('corrupt_image', { detected_mime_type: mime, detail: e.message });
    return result('corrupt_image', { detected_mime_type: mime, detail: 'parser error' });
  }
  const extra = { detected_mime_type: mime, width: dims.width, height: dims.height };
  if (!(dims.width >= 1 && dims.height >= 1 && dims.width <= maxDim && dims.height <= maxDim
        && dims.width * dims.height <= maxPixels)) return result('dimensions_out_of_range', extra);
  if (!allowed.includes(mime)) return result('mime_not_allowed', extra);
  return result(null, extra);
}

try {
  if (typeof module === 'object' && module && module.exports) {
    module.exports = { validateImage, detectFormat, sha256Hex, sameSha256, crc32, MEDIA_ALLOWED_DEFAULT };
  }
} catch (e) {
  // not a CommonJS environment (n8n Code node): the functions above are used directly
}
