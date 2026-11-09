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
