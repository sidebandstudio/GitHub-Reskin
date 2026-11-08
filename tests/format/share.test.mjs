import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deflateRawSync, deflateSync, gzipSync } from "node:zlib";
import { ISSUE_CODES, LIMITS } from "../../packages/contracts/index.js";
import { canonicalize, crc32, decodeShare, encodeShare, MAX_SHARE_CODE_LENGTH } from "../../packages/format/index.js";
import { base64url, fromBase64url } from "../../packages/format/share.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const { vectors } = JSON.parse(readFileSync(`${ROOT}tests/format/fixtures/share-vectors.json`, "utf8"));
const codeFor = (bytes, compressed) => `RS1.${base64url(compressed)}.${crc32(bytes)}`;
const enc = (text) => new TextEncoder().encode(text);

test("canonical JSON and RS1 codes match the golden vectors", () => {
  for (const vector of vectors) {
    assert.equal(canonicalize(vector.theme), vector.canonical, vector.name);
    assert.equal(encodeShare(vector.theme), vector.code, vector.name);
    assert.match(vector.code, /^RS1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  }
  assert.equal(vectors[0].code.length, 172);
});

test("codes from another zlib at any level decode to the same theme", () => {
  for (const vector of vectors) {
    for (const [level, code] of Object.entries(vector.python)) {
      const result = decodeShare(code);
      assert.ok(result.ok, `${vector.name} ${level}: ${JSON.stringify(result)}`);
      assert.equal(canonicalize(result.normalized), vector.canonical);
      assert.equal(encodeShare(result.normalized), vector.code);
    }
  }
});

test("CRC32 and base64url follow their standards", () => {
  assert.equal(crc32(enc("123456789")), "cbf43926");
  assert.equal(crc32(new Uint8Array()), "00000000");
  for (const length of [0, 1, 2, 3, 4, 5, 255]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37) & 255);
    const text = base64url(bytes);
    assert.equal(text, Buffer.from(bytes).toString("base64url"));
    assert.deepEqual(fromBase64url(text), bytes);
  }
  assert.equal(fromBase64url("abc="), null);
  assert.equal(fromBase64url("a"), null);
});

test("damaged codes fail with the incomplete-code message", () => {
  const { code } = vectors[1];
  const incomplete = /incomplete/;
  for (const damaged of [code.slice(0, -1), code.slice(0, 40) + code.slice(41), code.replace(/\.[0-9a-f]{8}$/, ".00000000"), `RS2${code.slice(3)}`, code.replace("RS1.", "RS1.!"), "RS1..00000000", "RS1"]) {
    const result = decodeShare(damaged);
    assert.equal(result.ok, false, damaged);
    assert.match(result.issues[0].message, incomplete, damaged);
  }
  assert.equal(decodeShare(code.replace(/\.[0-9a-f]{8}$/, ".00000000")).issues[0].code, ISSUE_CODES.shareChecksum);
});

test("only zlib framing is accepted, and the payload must be canonical strict JSON", () => {
  const bytes = enc(vectors[0].canonical);
  assert.ok(decodeShare(codeFor(bytes, deflateSync(bytes, { level: 0 }))).ok);
  assert.equal(decodeShare(codeFor(bytes, deflateRawSync(bytes))).ok, false);
  assert.equal(decodeShare(codeFor(bytes, gzipSync(bytes))).ok, false);
  const jsonc = enc(`${vectors[0].canonical.slice(0, -1)},}`);
  assert.equal(decodeShare(codeFor(jsonc, deflateSync(jsonc))).ok, false);
  const invalid = enc(vectors[0].canonical.replace('"base":"light"', '"base":"dim"'));
  assert.equal(decodeShare(codeFor(invalid, deflateSync(invalid))).issues[0].path, "/base");
});

test("the compressed and code-length limits apply before inflating", () => {
  assert.equal(decodeShare(`RS1.${"A".repeat(MAX_SHARE_CODE_LENGTH)}.00000000`).issues[0].code, ISSUE_CODES.inputTooLarge);
  const random = Uint8Array.from({ length: LIMITS.compressedBytes + 3 }, (_, i) => (i * 2654435761) >>> 24);
  const code = `RS1.${base64url(random)}.00000000`;
  assert.ok(code.length <= MAX_SHARE_CODE_LENGTH + 4);
  assert.equal(decodeShare(code).issues[0].code, ISSUE_CODES.inputTooLarge);
});

test("the expanded limit is enforced while inflating, not after", () => {
  // A bomb: a few kilobytes that inflate to 8 MiB.
  const huge = new Uint8Array(8 * 1024 * 1024).fill(0x20);
  const bomb = deflateSync(huge, { level: 9 });
  assert.ok(bomb.length < LIMITS.compressedBytes);
  assert.equal(decodeShare(codeFor(huge.subarray(0, 1), bomb)).issues[0].code, ISSUE_CODES.decompressLimit);
  // The same stream with its tail corrupted. Inflating everything first would hit the corrupt
  // data and report a damaged code; stopping at the cap never reads that far.
  const corrupt = Uint8Array.from(bomb);
  corrupt.fill(0xff, corrupt.length - 64);
  assert.equal(decodeShare(codeFor(huge.subarray(0, 1), corrupt)).issues[0].code, ISSUE_CODES.decompressLimit);
  // Exactly at the cap is fine as far as size goes; the content then fails as JSON.
  const atCap = new Uint8Array(LIMITS.expandedBytes).fill(0x20);
  assert.notEqual(decodeShare(codeFor(atCap, deflateSync(atCap))).issues[0].code, ISSUE_CODES.decompressLimit);
});

test("share decoding never resolves or repairs: unreadable colors survive untouched", () => {
  const theme = { schemaVersion: 1, name: "Invisible", base: "light", colors: { background: "#f6f2e8", text: "#f6f2e8", accent: "#446851" } };
  const result = decodeShare(encodeShare(theme));
  assert.deepEqual(result.normalized, theme);
  assert.deepEqual(Object.keys(result).sort(), ["normalized", "notes", "ok", "source"]);
});
