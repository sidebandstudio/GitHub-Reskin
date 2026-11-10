import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ISSUE_CODES, LIMITS } from "../../packages/contracts/index.js";
import { crc32, dataUrlBytes, rasterInfo, rasterSourceInfo, rasterTotals, UPLOAD_SOURCE_BYTES, validateTheme } from "../../packages/format/index.js";

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
// `rects` places each frame as [left, top, width, height]; by default each fills the screen.
function gif(width, height, { frames = 1, comment = false, rects = Array(frames).fill([0, 0, width, height]) } = {}) {
  const head = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([width & 255, width >> 8, height & 255, height >> 8, 0, 0, 0])]);
  const le = (n) => [n & 255, n >> 8];
  const frame = ([left, top, w, h]) => Buffer.from([0x2c, ...le(left), ...le(top), ...le(w), ...le(h), 0, 2, 2, 0x4c, 0x01, 0]);
  const parts = [head, ...(comment ? [Buffer.from([0x21, 0xfe, 2, 0x68, 0x69, 0])] : []), ...rects.map(frame), Buffer.from([0x3b])];
  return Buffer.concat(parts);
}
const segment = (marker, data) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([(data.length + 2) >> 8, (data.length + 2) & 255]), data]);
const SCAN = Buffer.concat([segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56])]);
// A baseline JPEG: frame header, one scan whose entropy data holds a stuffed byte and a restart,
// and the end marker. `after` adds segments between the frame header and the scan.
function jpeg(width, height, { exif = false, after = [] } = {}) {
  const sof = Buffer.from([8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "binary")), ...(exif ? [segment(0xe1, Buffer.from("Exif\0\0"))] : []), segment(0xc0, sof), ...after, SCAN, Buffer.from([0xff, 0xd9])]);
}
// A VP8X canvas of width x height. A still image carries a lossless bitstream of `bitstream` size;
// an animated one carries one ANMF frame per [x, y, width, height] in `frames`.
function webp(width, height, { animated = false, bitstream = [width, height], frames = [] } = {}) {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = animated ? 0x02 : 0;
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const bits = ((bitstream[0] - 1) & 0x3fff) | (((bitstream[1] - 1) & 0x3fff) << 14);
  const vp8l = Buffer.concat([Buffer.from([0x2f]), le32(bits), Buffer.from([0, 0, 0])]);
  const anmf = ([x, y, w, h]) => {
    const head = Buffer.alloc(16);
    head.writeUIntLE(x / 2, 0, 3);
    head.writeUIntLE(y / 2, 3, 3);
    head.writeUIntLE(w - 1, 6, 3);
    head.writeUIntLE(h - 1, 9, 3);
    return Buffer.concat([Buffer.from("ANMF"), le32(16), head]);
  };
  const image = animated && frames.length ? frames.map(anmf) : [Buffer.from("VP8L"), le32(vp8l.length), vp8l];
  const chunks = Buffer.concat([Buffer.from("VP8X"), le32(10), vp8x, ...image]);
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

test("animated or metadata-bearing images are refused as needing the local conversion, which accepts them as sources", () => {
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
    assert.equal(info.code, ISSUE_CODES.imageConversion, `${mime}: ${info.message}`);
    assert.match(info.message, /Convert/);
    assert.deepEqual(codes(page(image(url(mime, bytes), 2, 2))), [[ISSUE_CODES.imageConversion, "/backgrounds/page/layers/0/image/data"]], mime);
    // The builder may convert it: its header passes as a source, with what conversion removes.
    const source = rasterSourceInfo(new Uint8Array(bytes));
    assert.ok(source.ok, mime);
    assert.ok(source.animated || source.metadata, mime);
  }
});

test("rasters r1 finding 1: every GIF, APNG and WebP frame lies inside the canvas whose size the limits checked", () => {
  const refused = (bytes, mime) => {
    for (const info of [rasterSourceInfo(new Uint8Array(bytes)), rasterInfo(url(mime, bytes))]) {
      assert.equal(info.ok, false, mime);
      assert.equal(info.code, ISSUE_CODES.imageData, `${mime}: ${info.message}`);
      assert.match(info.message, /frame (lies outside the image|does not match its canvas)/);
    }
  };
  // The review's complete GIF: a 1x1 logical screen whose one frame is 2050x1. Chromium and Firefox
  // decode it at 2050x1, past the 2048px side the screen passed.
  refused(readFileSync(`${ROOT}tests/fixtures/images/oversized-frame.gif`), "gif");
  refused(gif(2048, 1, { rects: [[0, 0, 2049, 1]] }), "gif");
  refused(gif(1, 1, { rects: [[0, 0, 1, 2050]] }), "gif");
  refused(gif(2048, 1024, { rects: [[1, 0, 2048, 1024]] }), "gif");
  refused(gif(4, 4, { rects: [[0, 0, 4, 4], [2, 2, 3, 3]] }), "gif");
  refused(gif(4, 4, { rects: [[0, 0, 0, 4]] }), "gif");
  // At the edges, a frame passes: the whole screen, or a smaller frame inside it.
  assert.deepEqual([rasterInfo(url("gif", gif(2048, 1024))).width, rasterInfo(url("gif", gif(2048, 1024))).height], [2048, 1024]);
  assert.ok(rasterInfo(url("gif", gif(4, 4, { rects: [[1, 1, 3, 3]] }))).ok);
  assert.ok(rasterSourceInfo(new Uint8Array(gif(4, 4, { rects: [[0, 0, 4, 4], [3, 3, 1, 1]] }))).ok);
  // An APNG frame control places each frame on the header's canvas.
  const fctl = (w, h, x, y) => chunk("fcTL", Buffer.concat([u32(0), u32(w), u32(h), u32(x), u32(y), Buffer.alloc(6)]));
  const actl = chunk("acTL", Buffer.concat([u32(1), u32(0)]));
  refused(png(1, 1, [actl, fctl(2050, 1, 0, 0)]), "png");
  refused(png(4, 4, [actl, fctl(4, 4, 1, 0)]), "png");
  assert.ok(rasterSourceInfo(new Uint8Array(png(4, 4, [actl, fctl(2, 2, 2, 2)]))).ok);
  // A still WebP's bitstream is its canvas, and an animation frame lies on it.
  refused(webp(1, 1, { bitstream: [2050, 1] }), "webp");
  refused(webp(4, 4, { bitstream: [4, 3] }), "webp");
  refused(webp(1, 1, { animated: true, frames: [[0, 0, 2050, 1]] }), "webp");
  refused(webp(4, 4, { animated: true, frames: [[2, 0, 4, 4]] }), "webp");
  assert.ok(rasterSourceInfo(new Uint8Array(webp(4, 4, { animated: true, frames: [[0, 0, 4, 4], [2, 2, 2, 2]] }))).ok);
});

test("rasters r1 finding 2: a JPEG is walked through every segment to its end marker", () => {
  const sof = jpeg(2, 2);
  const end = sof.indexOf(Buffer.from([0xff, 0xda]));
  // Metadata after the frame header, or between the scans of a progressive image, is still metadata.
  const comment = segment(0xfe, Buffer.from("private-review-marker"));
  const progressive = Buffer.concat([sof.subarray(0, -2), segment(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0")), SCAN, Buffer.from([0xff, 0xd9])]);
  const trailing = Buffer.concat([sof, Buffer.from("appended preview")]);
  for (const bytes of [jpeg(2, 2, { after: [comment] }), progressive, trailing]) {
    const info = rasterInfo(url("jpeg", bytes));
    assert.equal(info.code, ISSUE_CODES.imageConversion, info.message);
    assert.ok(rasterSourceInfo(new Uint8Array(bytes)).metadata, "conversion removes it and says so");
  }
  // A file that stops early, or never scans, is not an image.
  for (const [bytes, reason] of [
    [sof.subarray(0, end), /does not end cleanly/],
    [sof.subarray(0, end + 14), /does not end cleanly/],
    [sof.subarray(0, -2), /does not end cleanly/],
    [Buffer.concat([sof.subarray(0, end), Buffer.from([0xff, 0xd9])]), /no image data/],
    [Buffer.concat([sof.subarray(0, 2), SCAN, Buffer.from([0xff, 0xd9])]), /scan comes before its frame header/],
  ]) {
    for (const info of [rasterInfo(url("jpeg", bytes)), rasterSourceInfo(new Uint8Array(bytes))]) {
      assert.equal(info.code, ISSUE_CODES.imageData);
      assert.match(info.message, reason);
    }
  }
  // Stuffed bytes, restarts and fill bytes inside a scan are not markers.
  const filled = Buffer.concat([sof.subarray(0, -2), Buffer.from([0xff, 0xff, 0xd9])]);
  assert.deepEqual(rasterSourceInfo(new Uint8Array(filled)), { ok: true, mime: "image/jpeg", width: 2, height: 2, animated: false, metadata: false });
});

test("a conversion source is at most 2 MiB with the stored image's dimension and pixel limits; SVG is never one", () => {
  const big = png(1, 1, [chunk("zzPd", Buffer.alloc(UPLOAD_SOURCE_BYTES))]);
  assert.equal(rasterSourceInfo(new Uint8Array(big)).code, ISSUE_CODES.imageLimit);
  assert.equal(rasterSourceInfo(new Uint8Array(png(2049, 2))).code, ISSUE_CODES.imageLimit);
  assert.equal(rasterSourceInfo(new Uint8Array(png(2048, 1025))).code, ISSUE_CODES.imageLimit);
  assert.deepEqual(rasterSourceInfo(new Uint8Array(png(2048, 1024))), { ok: true, mime: "image/png", width: 2048, height: 1024, animated: false, metadata: false });
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  assert.match(rasterSourceInfo(svg).message, /SVG and other formats are not accepted/);
  assert.equal(rasterInfo(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`).code, ISSUE_CODES.imageData);
});

test("document totals count repeats and can leave out the layer being replaced", () => {
  const one = url("png", png(10, 10));
  const theme = page(image(one, 10, 10), image(one, 10, 10));
  theme.backgrounds.header = { layers: [image(one, 10, 10)] };
  const bytes = png(10, 10).length;
  assert.deepEqual(rasterTotals(theme), { bytes: 3 * bytes, pixels: 300 });
  assert.deepEqual(rasterTotals(theme, "/backgrounds/header/layers/0/image"), { bytes: 2 * bytes, pixels: 200 });
  assert.deepEqual([...dataUrlBytes(one)], [...png(10, 10)]);
  assert.equal(dataUrlBytes("data:image/png;base64,abc"), null);
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
