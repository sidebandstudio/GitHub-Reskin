import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ISSUE_CODES, LIMITS } from "../../packages/contracts/index.js";
import { crc32, rasterInfo, validateTheme } from "../../packages/format/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const MINIMAL = { schemaVersion: 1, name: "Probe", base: "dark", colors: { background: "#0a0a17", text: "#e4f3ff", accent: "#fcee0a" } };
const url = (mime, bytes) => `data:image/${mime};base64,${Buffer.from(bytes).toString("base64")}`;
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const le32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const chunk = (type, data = Buffer.alloc(0)) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  return Buffer.concat([u32(data.length), body, Buffer.from(crc32(body), "hex")]);
};
function png(width, height, extra = []) {
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IEND")]);
}
function gif(width, height, { frames = 1, comment = false } = {}) {
  const head = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([width & 255, width >> 8, height & 255, height >> 8, 0, 0, 0])]);
  const frame = Buffer.from([0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0, 2, 2, 0x4c, 0x01, 0]);
  const parts = [head, ...(comment ? [Buffer.from([0x21, 0xfe, 2, 0x68, 0x69, 0])] : []), ...Array(frames).fill(frame), Buffer.from([0x3b])];
  return Buffer.concat(parts);
}
function jpeg(width, height, { exif = false } = {}) {
  const segment = (marker, data) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([(data.length + 2) >> 8, (data.length + 2) & 255]), data]);
  const sof = Buffer.from([8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "binary")), ...(exif ? [segment(0xe1, Buffer.from("Exif\0\0"))] : []), segment(0xc0, sof), Buffer.from([0xff, 0xd9])]);
}
function webp(width, height, { animated = false } = {}) {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = animated ? 0x02 : 0;
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const vp8l = Buffer.concat([Buffer.from([0x2f]), le32(bits), Buffer.from([0, 0, 0])]);
  const chunks = Buffer.concat([Buffer.from("VP8X"), le32(10), vp8x, Buffer.from("VP8L"), le32(vp8l.length), vp8l]);
  return Buffer.concat([Buffer.from("RIFF"), le32(chunks.length + 4), Buffer.from("WEBP"), chunks]);
}
const page = (...layers) => ({ ...MINIMAL, backgrounds: { page: { layers } } });
const image = (data, width, height) => ({ image: { data, width, height } });
const codes = (theme) => {
  const result = validateTheme(theme);
  return result.ok ? [] : result.issues.map((i) => [i.code, i.path]);
};

test("static PNG, JPEG, GIF and WebP headers pass with their real dimensions", () => {
  for (const [mime, bytes] of [["png", png(3, 2)], ["jpeg", jpeg(3, 2)], ["gif", gif(3, 2)], ["webp", webp(3, 2)]]) {
    const info = rasterInfo(url(mime, bytes));
    assert.ok(info.ok, `${mime}: ${info.message}`);
    assert.deepEqual([info.mime, info.width, info.height, info.bytes.length], [`image/${mime}`, 3, 2, bytes.length]);
    assert.deepEqual(codes(page(image(url(mime, bytes), 3, 2))), [], mime);
  }
  const fixture = JSON.parse(readFileSync(`${ROOT}tests/fixtures/schema/valid/embedded-images.reskin.json`, "utf8"));
  assert.ok(validateTheme(fixture).ok);
});

test("the media type must match the magic bytes, and the declared size the header", () => {
  assert.deepEqual(codes(page(image(url("jpeg", png(1, 1)), 1, 1))), [[ISSUE_CODES.imageData, "/backgrounds/page/layers/0/image/data"]]);
  assert.match(rasterInfo(url("jpeg", png(1, 1))).message, /says jpeg but contains png/);
  assert.deepEqual(codes(page(image(url("png", png(1, 1)), 2, 1))), [[ISSUE_CODES.imageData, "/backgrounds/page/layers/0/image/width"]]);
  assert.deepEqual(codes(page(image(url("png", Buffer.from("not an image at all")), 1, 1))), [[ISSUE_CODES.imageData, "/backgrounds/page/layers/0/image/data"]]);
});

test("base64 must be canonical, and damaged headers are refused before any decode", () => {
  const good = url("png", png(1, 1));
  const tail = good.at(-3);
  const bent = good.slice(0, -3) + String.fromCharCode(tail.charCodeAt(0) + 1) + good.slice(-2);
  assert.equal(rasterInfo(bent).ok, false);
  const damaged = png(1, 1);
  damaged[29] ^= 1;
  assert.match(rasterInfo(url("png", damaged)).message, /damaged/);
  assert.match(rasterInfo(url("png", Buffer.concat([png(1, 1), Buffer.from([0])]))).message, /does not end cleanly/);
  assert.equal(rasterInfo(`${good}\n`).ok, false);
});

test("deferred conversion: animated or metadata-bearing images are rejected until local conversion lands", () => {
  const cases = [
    ["png", png(2, 2, [chunk("acTL", Buffer.alloc(8))])],
    ["png", png(2, 2, [chunk("tEXt", Buffer.from("Comment\0hello"))])],
    ["gif", gif(2, 2, { frames: 2 })],
    ["gif", gif(2, 2, { comment: true })],
    ["jpeg", jpeg(2, 2, { exif: true })],
    ["webp", webp(2, 2, { animated: true })],
  ];
  for (const [mime, bytes] of cases) {
    const info = rasterInfo(url(mime, bytes));
    assert.equal(info.ok, false, mime);
    assert.equal(info.code, ISSUE_CODES.deferred, `${mime}: ${info.message}`);
    assert.deepEqual(codes(page(image(url(mime, bytes), 2, 2))), [[ISSUE_CODES.deferred, "/backgrounds/page/layers/0/image/data"]], mime);
  }
});

test("each image is at most 128 KiB decoded and all images together 256 KiB, counting repeats", () => {
  const padded = (bytes) => png(1, 1, [chunk("zzPd", Buffer.alloc(bytes - png(1, 1).length - 12))]);
  assert.equal(padded(LIMITS.perImageDecodedBytes).length, LIMITS.perImageDecodedBytes);
  assert.ok(rasterInfo(url("png", padded(LIMITS.perImageDecodedBytes))).ok);
  assert.equal(rasterInfo(url("png", padded(LIMITS.perImageDecodedBytes + 1))).code, ISSUE_CODES.imageLimit);
  const half = url("png", padded(LIMITS.documentImageDecodedBytes / 2));
  assert.deepEqual(codes(page(image(half, 1, 1), image(half, 1, 1))), []);
  const third = url("png", padded(100000));
  assert.deepEqual(codes(page(image(third, 1, 1), image(third, 1, 1), image(third, 1, 1))), [[ISSUE_CODES.imageLimit, "/backgrounds"]]);
});

test("pixels: 2048 a side and 2,097,152 an image, 6,291,456 a document counting repeats", () => {
  assert.equal(rasterInfo(url("png", png(2048, 1025))).code, ISSUE_CODES.imageLimit);
  assert.equal(rasterInfo(url("png", png(2049, 1))).code, ISSUE_CODES.imageLimit);
  const max = image(url("png", png(2048, 1024)), 2048, 1024);
  assert.deepEqual(codes(page(max, max, max)), []);
  const theme = page(max, max, max);
  theme.backgrounds.header = { layers: [image(url("png", png(1, 1)), 1, 1)] };
  assert.deepEqual(codes(theme), [[ISSUE_CODES.imageLimit, "/backgrounds"]]);
});
