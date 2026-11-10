// A minimal WOFF2 reader for check:fonts: the table directory, then the OS/2 weight, cmap
// coverage and name records of the decompressed tables. Node only; never bundled.
import { brotliDecompressSync } from "node:zlib";

const KNOWN = ("cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill").match(/.{4}\s?/g).map((tag) => tag.slice(0, 4));

function base128(bytes, at) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[at.offset++];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error("Bad UIntBase128");
}

/** The tables of a WOFF2 font as { tag: Buffer }, transformed glyf/loca/hmtx left as stored. */
export function readWoff2(buffer) {
  if (buffer.toString("latin1", 0, 4) !== "wOF2") throw new Error("Not a WOFF2 file");
  if (buffer.readUInt32BE(8) !== buffer.length) throw new Error("WOFF2 length field does not match the file");
  const numTables = buffer.readUInt16BE(12);
  const compressed = buffer.readUInt32BE(20);
  const at = { offset: 48 };
  const directory = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buffer[at.offset++];
    let tag = KNOWN[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = buffer.toString("latin1", at.offset, at.offset + 4);
      at.offset += 4;
    }
    const version = flags >> 6;
    const length = base128(buffer, at);
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    directory.push({ tag, length: transformed ? base128(buffer, at) : length });
  }
  const data = brotliDecompressSync(buffer.subarray(at.offset, at.offset + compressed));
  const tables = {};
  let offset = 0;
  for (const { tag, length } of directory) {
    tables[tag.trim()] = data.subarray(offset, offset + length);
    offset += length;
  }
  return tables;
}

export const weightClass = (tables) => tables["OS/2"].readUInt16BE(4);

/** Every code point the font's Unicode cmap (format 4 or 12) maps to a glyph. */
export function codePoints(tables) {
  const cmap = tables.cmap;
  const points = new Set();
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const offset = cmap.readUInt32BE(8 + i * 8);
    const format = cmap.readUInt16BE(offset);
    if (platform === 3 && format === 4) {
      const segments = cmap.readUInt16BE(offset + 6) / 2;
      const ends = offset + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const ranges = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2);
        const range = cmap.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph = range ? cmap.readUInt16BE(ranges + s * 2 + range + (c - start) * 2) : (c + delta) & 0xffff;
          if (glyph) points.add(c);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(offset + 12);
      for (let g = 0; g < groups; g++) {
        const base = offset + 16 + g * 12;
        for (let c = cmap.readUInt32BE(base); c <= cmap.readUInt32BE(base + 4); c++) points.add(c);
      }
    }
  }
  return points;
}

/** Name records as [{ nameID, value }], decoding Windows Unicode and Mac Roman records. */
export function names(tables) {
  const name = tables.name;
  const count = name.readUInt16BE(2);
  const strings = name.readUInt16BE(4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 12;
    const platform = name.readUInt16BE(base);
    const nameID = name.readUInt16BE(base + 6);
    const length = name.readUInt16BE(base + 8);
    const bytes = name.subarray(strings + name.readUInt16BE(base + 10), strings + name.readUInt16BE(base + 10) + length);
    const value = platform === 3 || platform === 0 ? Buffer.from(bytes).swap16().toString("utf16le") : bytes.toString("latin1");
    out.push({ nameID, value });
  }
  return out;
}

/** The glyph index the font's Windows Unicode cmap (format 4) maps each BMP code point to. */
export function glyphIndices(tables) {
  const cmap = tables.cmap;
  const glyphs = new Map();
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const offset = cmap.readUInt32BE(8 + i * 8);
    if (cmap.readUInt16BE(4 + i * 8) !== 3 || cmap.readUInt16BE(offset) !== 4) continue;
    const segments = cmap.readUInt16BE(offset + 6) / 2;
    const ends = offset + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      const start = cmap.readUInt16BE(starts + s * 2);
      const delta = cmap.readInt16BE(deltas + s * 2);
      const range = cmap.readUInt16BE(ranges + s * 2);
      for (let c = start; c <= cmap.readUInt16BE(ends + s * 2) && c !== 0xffff; c++) {
        const raw = range ? cmap.readUInt16BE(ranges + s * 2 + range + (c - start) * 2) : c;
        const glyph = range && !raw ? 0 : (raw + delta) & 0xffff;
        if (glyph && !glyphs.has(c)) glyphs.set(c, glyph);
      }
    }
  }
  return glyphs;
}

// WOFF2's 255UInt16.
function uint255(bytes, at) {
  const code = bytes[at.offset++];
  if (code === 253) return (at.offset += 2), bytes.readUInt16BE(at.offset - 2);
  if (code === 255) return bytes[at.offset++] + 253;
  if (code === 254) return bytes[at.offset++] + 506;
  return code;
}

// One point of WOFF2's glyf triplet encoding, as [dx, dy, data bytes].
function triplet(flag, data, at) {
  const signed = (bit, value) => (bit & 1 ? value : -value);
  const b = (i) => data[at + i];
  if (flag < 10) return [0, signed(flag, ((flag & 14) << 7) + b(0)), 1];
  if (flag < 20) return [signed(flag, (((flag - 10) & 14) << 7) + b(0)), 0, 1];
  if (flag < 84) {
    const b0 = flag - 20;
    return [signed(flag, 1 + (b0 & 0x30) + (b(0) >> 4)), signed(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b(0) & 0x0f)), 1];
  }
  if (flag < 120) {
    const b0 = flag - 84;
    return [signed(flag, 1 + (Math.floor(b0 / 12) << 8) + b(0)), signed(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + b(1)), 2];
  }
  if (flag < 124) return [signed(flag, (b(0) << 4) + (b(1) >> 4)), signed(flag >> 1, ((b(1) & 0x0f) << 8) + b(2)), 3];
  return [signed(flag, (b(0) << 8) + b(1)), signed(flag >> 1, (b(2) << 8) + b(3)), 4];
}

/**
 * Each glyph's outline bounds as [xMin, yMin, xMax, yMax], or null for an empty glyph, from a
 * WOFF2 transformed glyf table (WOFF2 section 5.1): explicit bounds where the bbox bitmap has them,
 * otherwise the extremes of the decoded points.
 */
export function glyphBounds(tables) {
  const glyf = tables.glyf;
  const glyphs = glyf.readUInt16BE(4);
  let offset = 36;
  const streams = Array.from({ length: 7 }, (_, i) => {
    const stream = glyf.subarray(offset, offset + glyf.readUInt32BE(8 + i * 4));
    offset += stream.length;
    return stream;
  });
  const [contours, points, flags, data, composites, boxes] = streams;
  const at = { points: { offset: 0 }, flags: 0, data: { offset: 0 }, composites: 0, boxes: 4 * Math.floor((glyphs + 31) / 32) };
  const out = [];
  for (let g = 0; g < glyphs; g++) {
    const count = contours.readInt16BE(g * 2);
    let box = null;
    if (boxes[g >> 3] & (0x80 >> (g & 7))) {
      box = [0, 2, 4, 6].map((i) => boxes.readInt16BE(at.boxes + i));
      at.boxes += 8;
    }
    if (count > 0) {
      let total = 0;
      for (let c = 0; c < count; c++) total += uint255(points, at.points);
      let x = 0, y = 0;
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (let p = 0; p < total; p++) {
        const [dx, dy, size] = triplet(flags[at.flags++] & 0x7f, data, at.data.offset);
        at.data.offset += size;
        x += dx;
        y += dy;
        bounds[0] = Math.min(bounds[0], x);
        bounds[1] = Math.min(bounds[1], y);
        bounds[2] = Math.max(bounds[2], x);
        bounds[3] = Math.max(bounds[3], y);
      }
      uint255(data, at.data); // instruction length; the instructions are in their own stream
      box ??= bounds;
    } else if (count === -1) {
      // A composite always has explicit bounds; its records only say whether instructions follow.
      let more = true, instructions = false;
      while (more) {
        const f = composites.readUInt16BE(at.composites);
        at.composites += 4 + (f & 1 ? 4 : 2) + (f & 8 ? 2 : f & 0x40 ? 4 : f & 0x80 ? 8 : 0);
        more = Boolean(f & 0x20);
        instructions ||= Boolean(f & 0x100);
      }
      if (instructions) uint255(data, at.data);
    }
    out.push(box);
  }
  // Every stream read to its end, or the decoding went wrong somewhere.
  if (at.flags !== flags.length || at.data.offset !== data.length || at.composites !== composites.length || at.boxes !== boxes.length) throw new Error("WOFF2 glyf streams do not decode to their stated lengths");
  return out;
}

const ASCENDERS = "bdfhkl";
const XHEIGHT = "acemnorsuvwxz";
const DESCENDERS = "gpqy";

/**
 * Whether the font draws lowercase forms: its ascender letters rise above its x-height letters and
 * its descender letters fall below the baseline, each by at least 5% of the em. A font whose
 * lowercase letters are capitals or small capitals has neither.
 */
export function hasLowercaseForms(tables) {
  const em = tables.head.readUInt16BE(18);
  const glyphs = glyphIndices(tables);
  const bounds = glyphBounds(tables);
  const box = (c) => bounds[glyphs.get(c.codePointAt(0))];
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const top = (letters) => median([...letters].map((c) => box(c)[3]));
  const bottom = median([...DESCENDERS].map((c) => box(c)[1]));
  return top(ASCENDERS) - top(XHEIGHT) >= 0.05 * em && bottom <= -0.05 * em;
}
