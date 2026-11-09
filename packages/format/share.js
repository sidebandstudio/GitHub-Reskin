// RS1 share codes: `RS1.<base64url(zlib(canonical UTF-8 JSON))>.<crc32>`. Zlib is RFC 1950 at
// level 9 with no dictionary, base64url is unpadded, and the CRC32 (polynomial 0xEDB88320) covers
// the uncompressed bytes. The CRC detects damage; it does not authenticate anyone.
import { Unzlib, zlibSync } from "fflate";
import { ISSUE_CODES, LIMITS, SHARE_CODE_PREFIX } from "../contracts/index.js";
import { canonicalize, utf8 } from "./canonical.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const INCOMPLETE = "This share code is incomplete. Ask for the full code or the theme file.";
// Input fed to the inflater per step. Deflate expands at most about 1032 times, so the output cap
// is checked after at most ~16 KiB of growth past it.
const INFLATE_STEP = 16;

let crcTable;
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

export function base64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 4) / 3));
    for (let j = 0; j < chars; j++) out += ALPHABET[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

export function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of text) {
    value = (value << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

/** The share code for a theme's canonical source. */
export function encodeShare(theme) {
  const bytes = utf8(canonicalize(theme));
  return `${SHARE_CODE_PREFIX}${base64url(zlibSync(bytes, { level: 9 }))}.${crc32(bytes)}`;
}

// The longest code whose payload can stay within the compressed limit.
export const MAX_SHARE_CODE_LENGTH = SHARE_CODE_PREFIX.length + Math.ceil((LIMITS.compressedBytes * 4) / 3) + 9;

const failure = (code, message) => ({ ok: false, issue: { code, path: "", message, severity: "error" } });

/**
 * Unwraps a share code to its JSON text, enforcing the compressed and expanded limits while
 * inflating rather than afterwards.
 * @returns {{ok:true, text:string} | {ok:false, issue:import("../contracts/index.js").Issue}}
 */
export function unpackShare(code) {
  if (typeof code !== "string") return failure(ISSUE_CODES.shareFormat, INCOMPLETE);
  const trimmed = code.trim();
  if (trimmed.length > MAX_SHARE_CODE_LENGTH) return failure(ISSUE_CODES.inputTooLarge, "This share code is longer than any theme needs. Import the .reskin.json file instead.");
  const match = /^RS1\.([A-Za-z0-9_-]+)\.([0-9a-f]{8})$/.exec(trimmed);
  if (!match) return failure(ISSUE_CODES.shareFormat, INCOMPLETE);
  const compressed = fromBase64url(match[1]);
  if (!compressed) return failure(ISSUE_CODES.shareFormat, INCOMPLETE);
  if (compressed.length > LIMITS.compressedBytes) return failure(ISSUE_CODES.inputTooLarge, "This share code is longer than any theme needs. Import the .reskin.json file instead.");

  const chunks = [];
  let total = 0;
  let ended = false;
  const inflater = new Unzlib((chunk, final) => {
    total += chunk.length;
    if (total <= LIMITS.expandedBytes) chunks.push(chunk);
    if (final) ended = true;
  });
  try {
    for (let i = 0; i < compressed.length && total <= LIMITS.expandedBytes; i += INFLATE_STEP) {
      inflater.push(compressed.subarray(i, i + INFLATE_STEP), i + INFLATE_STEP >= compressed.length);
    }
  } catch {
    return failure(ISSUE_CODES.shareFormat, INCOMPLETE);
  }
  if (total > LIMITS.expandedBytes) return failure(ISSUE_CODES.decompressLimit, "This share code expands to more than a theme needs. Import the .reskin.json file instead.");
  if (!ended) return failure(ISSUE_CODES.shareFormat, INCOMPLETE);

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (crc32(bytes) !== match[2]) return failure(ISSUE_CODES.shareChecksum, INCOMPLETE);
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    return failure(ISSUE_CODES.invalidUtf8, "This share code doesn't contain readable text.");
  }
}
