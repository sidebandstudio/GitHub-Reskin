// Byte and header admission for embedded rasters (THEME-EXPANSION.md, "Images and storage").
// Nothing here decodes pixels. Before any decoder sees an image: canonical base64 and padding,
// the decoded size, magic bytes against the declared media type, a bounded header walk for the
// real dimensions, and detection of animation and metadata. A static, clean image passes; an
// animated or metadata-bearing one needs the local first-frame conversion, which arrives with the
// codecs in increment 2, so it is rejected for now. C5 owns browser decoding.
import { ISSUE_CODES, LIMITS } from "../contracts/index.js";
import { crc32 } from "./share.js";

const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]*={0,2})$/;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VALUE = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) VALUE[B64.charCodeAt(i)] = i;

/** Decoded length of canonical base64 text, or null when it is not canonical. */
function decodedLength(text) {
  if (text.length % 4) return null;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return (text.length / 4) * 3 - pad;
}

// Strict decode: canonical padding and zero unused bits, so one image has one spelling.
function decodeBase64(text) {
  const length = decodedLength(text);
  if (length === null) return null;
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (text[i + k] === "=" ? 0 : VALUE[text.charCodeAt(i + k)]));
    if (c.some((v) => v < 0)) return null;
    const n = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
    const bytes = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (const byte of bytes) if (o < length) out[o++] = byte;
  }
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const last = VALUE[text.charCodeAt(text.length - 1 - pad)];
  if ((pad === 1 && last & 3) || (pad === 2 && last & 15)) return null;
  return out;
}

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_METADATA = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "iCCP"]);

function png(b) {
  if (b.length < 33 || !PNG_SIGNATURE.every((v, i) => b[i] === v)) return null;
  let i = 8;
  let width = 0;
  let height = 0;
  let animated = false;
  let metadata = false;
  let ended = false;
  for (let index = 0; i + 12 <= b.length; index++) {
    const length = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    if (i + 12 + length > b.length) return { error: "a PNG chunk runs past the end of the image" };
    if (crc32(b.subarray(i + 4, i + 8 + length)) !== u32be(b, i + 8 + length).toString(16).padStart(8, "0")) return { error: `the PNG ${type} chunk is damaged` };
    if (index === 0) {
      if (type !== "IHDR" || length !== 13) return { error: "a PNG must start with its header" };
      width = u32be(b, i + 8);
      height = u32be(b, i + 12);
    }
    if (type === "acTL" || type === "fcTL") animated = true;
    if (PNG_METADATA.has(type)) metadata = true;
    i += 12 + length;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || i !== b.length) return { error: "the PNG does not end cleanly" };
  return { width, height, animated, metadata };
}

function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  let metadata = false;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return { error: "the JPEG markers are damaged" };
    const marker = b[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (length < 2 || i + 2 + length > b.length) return { error: "a JPEG segment runs past the end of the image" };
    if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) metadata = true;
    const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (sof) {
      if (length < 7) return { error: "the JPEG frame header is damaged" };
      return { height: u16be(b, i + 5), width: u16be(b, i + 7), animated: false, metadata };
    }
    if (marker === 0xda) break;
    i += 2 + length;
  }
  return { error: "the JPEG has no frame header" };
}

function gif(b) {
  if (b.length < 13 || !["GIF87a", "GIF89a"].includes(ascii(b, 0, 6))) return null;
  const width = u16le(b, 6);
  const height = u16le(b, 8);
  let i = 13 + (b[10] & 0x80 ? 3 * 2 ** ((b[10] & 7) + 1) : 0);
  let frames = 0;
  let metadata = false;
  const skipBlocks = () => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    i++;
  };
  while (i < b.length) {
    const introducer = b[i];
    if (introducer === 0x3b) return i === b.length - 1 ? { width, height, animated: frames > 1, metadata } : { error: "the GIF has data after its end" };
    if (introducer === 0x21) {
      const label = b[i + 1];
      if (label === 0xfe || label === 0xff || label === 0x01) metadata = true;
      i += 2;
      skipBlocks();
    } else if (introducer === 0x2c) {
      if (i + 10 > b.length) break;
      frames++;
      const packed = b[i + 9];
      i += 10 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0) + 1;
      skipBlocks();
    } else return { error: "the GIF blocks are damaged" };
  }
  return { error: "the GIF does not end cleanly" };
}

function webp(b) {
  if (b.length < 20 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  if (u32be([b[7], b[6], b[5], b[4]], 0) + 8 !== b.length) return { error: "the WebP size does not match its data" };
  let i = 12;
  let width = 0;
  let height = 0;
  let animated = false;
  let metadata = false;
  let found = false;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const length = u32be([b[i + 7], b[i + 6], b[i + 5], b[i + 4]], 0);
    const start = i + 8;
    if (start + length > b.length) return { error: "a WebP chunk runs past the end of the image" };
    if (type === "VP8X" && length >= 10) {
      const flags = b[start];
      if (flags & 0x02) animated = true;
      if (flags & 0x2c) metadata = true;
      width = u24le(b, start + 4) + 1;
      height = u24le(b, start + 7) + 1;
      found = true;
    } else if (type === "VP8 " && length >= 10 && !found) {
      if (b[start + 3] !== 0x9d || b[start + 4] !== 0x01 || b[start + 5] !== 0x2a) return { error: "the WebP frame is damaged" };
      width = u16le(b, start + 6) & 0x3fff;
      height = u16le(b, start + 8) & 0x3fff;
      found = true;
    } else if (type === "VP8L" && length >= 5 && !found) {
      if (b[start] !== 0x2f) return { error: "the WebP frame is damaged" };
      const bits = b[start + 1] | (b[start + 2] << 8) | (b[start + 3] << 16) | (b[start + 4] << 24);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      found = true;
    } else if (type === "ANIM" || type === "ANMF") animated = true;
    else if (type === "EXIF" || type === "XMP " || type === "ICCP") metadata = true;
    i = start + length + (length & 1);
  }
  return found ? { width, height, animated, metadata } : { error: "the WebP has no image frame" };
}

const READERS = { png, jpeg, gif, webp };
const MAGIC_ORDER = ["png", "jpeg", "gif", "webp"];

/**
 * Header facts for one embedded raster data URL, or a reason it cannot be admitted. Checks length
 * and padding before decoding.
 * @returns {{ok:true, mime:string, bytes:Uint8Array, width:number, height:number} | {ok:false, code:string, message:string}}
 */
export function rasterInfo(data) {
  const fail = (code, message) => ({ ok: false, code, message });
  const match = typeof data === "string" ? DATA_URL.exec(data) : null;
  if (!match) return fail(ISSUE_CODES.imageData, "Images are PNG, JPEG, WebP or GIF data in canonical base64.");
  const length = decodedLength(match[2]);
  if (length === null) return fail(ISSUE_CODES.imageData, "This image's base64 data is not canonical.");
  if (length > LIMITS.perImageDecodedBytes) return fail(ISSUE_CODES.imageLimit, `Each image is at most ${LIMITS.perImageDecodedBytes / 1024} KiB.`);
  const bytes = decodeBase64(match[2]);
  if (!bytes) return fail(ISSUE_CODES.imageData, "This image's base64 data is not canonical.");
  const declared = match[1];
  const actual = MAGIC_ORDER.find((type) => READERS[type](bytes) !== null);
  if (actual !== declared) return fail(ISSUE_CODES.imageData, actual ? `This image says ${declared} but contains ${actual} data.` : "This is not image data Reskin can read.");
  const info = READERS[declared](bytes);
  if (info.error) return fail(ISSUE_CODES.imageData, `This image cannot be read: ${info.error}.`);
  if (info.width < 1 || info.height < 1) return fail(ISSUE_CODES.imageData, "This image has no size.");
  if (info.width > LIMITS.imageMaxDimension || info.height > LIMITS.imageMaxDimension || info.width * info.height > LIMITS.imageMaxPixels) {
    return fail(ISSUE_CODES.imageLimit, `Images are at most ${LIMITS.imageMaxDimension}px a side and ${LIMITS.imageMaxPixels} pixels.`);
  }
  if (info.animated) return fail(ISSUE_CODES.deferred, "Animated images need converting to one still frame, which this version of Reskin cannot do yet.");
  if (info.metadata) return fail(ISSUE_CODES.deferred, "This image carries metadata that must be removed first, which this version of Reskin cannot do yet.");
  return { ok: true, mime: `image/${declared}`, bytes, width: info.width, height: info.height };
}

/** Every raster layer in a theme, with its JSON pointer, in document order. */
export function rasterLayers(theme) {
  const out = [];
  for (const target of ["page", "profileBanner", "header"]) {
    const layers = theme?.backgrounds?.[target]?.layers;
    if (!Array.isArray(layers)) continue;
    layers.forEach((layer, index) => {
      if (layer && typeof layer === "object" && layer.image) out.push({ path: `/backgrounds/${target}/layers/${index}/image`, image: layer.image });
    });
  }
  return out;
}

/**
 * Issues for every raster in a schema-valid theme: header admission, declared size against the
 * header, and the document totals for decoded bytes and pixels, which count repeated
 * occurrences and are checked before any decode.
 */
export function rasterIssues(theme) {
  const issues = [];
  let bytes = 0;
  let pixels = 0;
  for (const { path, image } of rasterLayers(theme)) {
    const info = rasterInfo(image.data);
    if (!info.ok) {
      issues.push({ code: info.code, path: `${path}/data`, message: info.message, severity: "error" });
      continue;
    }
    if (info.width !== image.width || info.height !== image.height) {
      issues.push({ code: ISSUE_CODES.imageData, path: `${path}/width`, message: `This image is ${info.width}x${info.height}, not ${image.width}x${image.height}.`, severity: "error" });
    }
    bytes += info.bytes.length;
    pixels += info.width * info.height;
  }
  if (bytes > LIMITS.documentImageDecodedBytes) issues.push({ code: ISSUE_CODES.imageLimit, path: "/backgrounds", message: `All images in a theme come to at most ${LIMITS.documentImageDecodedBytes / 1024} KiB, counting repeats.`, severity: "error" });
  if (pixels > LIMITS.documentImageDecodedPixels) issues.push({ code: ISSUE_CODES.imageLimit, path: "/backgrounds", message: `All images in a theme come to at most ${LIMITS.documentImageDecodedPixels} pixels, counting repeats.`, severity: "error" });
  return issues;
}
