// The local image conversion and its queue, with stand-in browser primitives that record every
// decode, draw, encode and release. Real decoding and encoding run in the fixture browser tests
// (tests/e2e/fixture/raster.spec.mjs).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LIMITS } from "../../packages/contracts/index.js";
import { COMPRESS_QUALITIES, convertRaster, createRasterQueue, fitSize, imageAssets, removeRasterLayer, setRasterLayer } from "../../packages/appearance/raster.js";
import { sha256 } from "../../packages/engine/sha256.js";
import { crc32, rasterInfo, rasterTotals, releaseRasters, validateTheme } from "../../packages/format/index.js";

const MINIMAL = { schemaVersion: 1, name: "Probe", base: "dark", colors: { background: "#0a0a17", text: "#e4f3ff", accent: "#fcee0a" } };
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
const png = (width, height, extra = []) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])), ...extra, chunk("IEND")]);
// A lossless WebP header of the given size, padded with an unknown chunk to `bytes` in total.
function webp(width, height, bytes = 0) {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const vp8l = Buffer.concat([Buffer.from([0x2f]), le32(bits), Buffer.from([0, 0, 0])]);
  let chunks = Buffer.concat([Buffer.from("VP8L"), le32(vp8l.length), vp8l]);
  const pad = Math.max(0, bytes - 12 - chunks.length - 8);
  if (bytes) chunks = Buffer.concat([chunks, Buffer.from("PADD"), le32(pad), Buffer.alloc(pad + (pad & 1))]);
  return Buffer.concat([Buffer.from("RIFF"), le32(chunks.length + 4), Buffer.from("WEBP"), chunks]);
}
const gifAnimated = (width, height) => {
  const head = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([width & 255, width >> 8, height & 255, height >> 8, 0, 0, 0])]);
  const frame = Buffer.from([0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0, 2, 2, 0x4c, 0x01, 0]);
  return Buffer.concat([head, frame, frame, Buffer.from([0x3b])]);
};
const dataUrl = (mime, bytes) => `data:image/${mime};base64,${Buffer.from(bytes).toString("base64")}`;

/** Stand-in primitives: the encoder writes a header of the canvas size, `sizeAt(quality)` bytes long. */
function fakeEnv({ sizeAt = () => 2000, writes = "webp", decoded = null, decodeDelay = 0 } = {}) {
  const log = { decodes: 0, closed: 0, canvases: 0, released: 0, draws: [], encodes: [] };
  const env = {
    Blob,
    async decode(blob) {
      log.decodes++;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (decodeDelay) await new Promise((r) => setTimeout(r, decodeDelay));
      const width = decoded?.width ?? (bytes[0] === 0x89 ? bytes.readUInt32BE?.(16) ?? Buffer.from(bytes).readUInt32BE(16) : Buffer.from(bytes).readUInt16LE(6));
      const height = decoded?.height ?? (bytes[0] === 0x89 ? Buffer.from(bytes).readUInt32BE(20) : Buffer.from(bytes).readUInt16LE(8));
      return { width, height, close: () => log.closed++ };
    },
    canvas(width, height) {
      log.canvases++;
      return {
        context: { drawImage: (...args) => log.draws.push(args.slice(1)) },
        async encode(type, quality) {
          log.encodes.push([type, quality]);
          const bytes = writes === "png" || type === "image/png" ? png(width, height) : webp(width, height, sizeAt(quality));
          return new Blob([bytes]);
        },
        release: () => log.released++,
      };
    },
  };
  return { env, log };
}

test("fitSize keeps the aspect ratio within the side and pixel caps", () => {
  assert.deepEqual(fitSize(1280, 800), { width: 1280, height: 800 });
  assert.deepEqual(fitSize(4096, 1024, 2048), { width: 2048, height: 512 });
  assert.deepEqual(fitSize(2048, 2048), { width: 1448, height: 1448 });
  assert.deepEqual(fitSize(1600, 900, 800), { width: 800, height: 450 });
  for (const [w, h] of [[2048, 2048], [2000, 1999], [1, 2048], [2048, 1]]) {
    const out = fitSize(w, h);
    assert.ok(out.width * out.height <= LIMITS.imageMaxPixels && out.width <= 2048 && out.height <= 2048, `${w}x${h}`);
  }
});

test("conversion keeps the first frame, drops metadata, crops and resizes, and passes admission", async () => {
  const { env, log } = fakeEnv();
  const result = await convertRaster(new Uint8Array(gifAnimated(400, 300)), { crop: { x: 10, y: 20, width: 300, height: 200 }, maxSide: 150 }, env);
  assert.ok(result.ok, result.message);
  assert.deepEqual([result.image.width, result.image.height], [150, 100]);
  assert.ok(rasterInfo(result.image.data).ok);
  assert.deepEqual(log.draws, [[10, 20, 300, 200, 0, 0, 150, 100]]);
  assert.deepEqual(result.before, { bytes: gifAnimated(400, 300).length, width: 400, height: 300, mime: "image/gif" });
  assert.equal(result.after.mime, "image/webp");
  assert.match(result.note, /kept the first frame of the animation, cropped to 300x200, resized to 150x100, saved as WebP at quality 90/);
  // One decode, and everything it held is released.
  assert.deepEqual([log.decodes, log.closed, log.canvases, log.released], [1, 1, 1, 1]);
  const theme = setRasterLayer(MINIMAL, "page", 0, result.image, { fit: "cover" });
  assert.ok(theme.ok && validateTheme(theme.theme).ok);
});

test("a source over a limit, or one that would pass the document's pixel allowance, is refused before any decode", async () => {
  const { env, log } = fakeEnv();
  assert.equal((await convertRaster(new Uint8Array(png(2049, 10)), {}, env)).code, "image-limit");
  assert.equal((await convertRaster(new TextEncoder().encode("<svg/>"), {}, env)).code, "image-data");
  const others = { bytes: 0, pixels: LIMITS.documentImageDecodedPixels - 100 };
  const refused = await convertRaster(new Uint8Array(png(20, 10)), { others }, env);
  assert.equal(refused.code, "image-limit");
  assert.match(refused.message, /6291456 pixels, counting repeats/);
  assert.equal(log.decodes, 0);
  // A decoder that disagrees with the header is not trusted.
  const liar = fakeEnv({ decoded: { width: 9, height: 9 } });
  assert.equal((await convertRaster(new Uint8Array(png(20, 10)), {}, liar.env)).code, "image-data");
  assert.deepEqual([liar.log.closed, liar.log.canvases], [1, 0]);
});

test("an output over its byte budget is never saved silently; Compress steps down WebP quality until it fits", async () => {
  const sizeAt = (q) => Math.round(400000 * q * q);
  const plain = await convertRaster(new Uint8Array(png(640, 400)), {}, fakeEnv({ sizeAt }).env);
  assert.equal(plain.ok, false, JSON.stringify(plain));
  assert.equal(plain.code, "image-limit");
  assert.ok(plain.before && plain.after.bytes > LIMITS.perImageDecodedBytes);
  const { env, log } = fakeEnv({ sizeAt });
  const compressed = await convertRaster(new Uint8Array(png(640, 400)), { compress: true }, env);
  assert.ok(compressed.ok, compressed.message);
  assert.ok(compressed.after.bytes <= LIMITS.perImageDecodedBytes);
  assert.deepEqual(log.encodes.map(([, q]) => q), COMPRESS_QUALITIES.filter((q) => sizeAt(COMPRESS_QUALITIES[COMPRESS_QUALITIES.indexOf(q) - 1] ?? 1) > LIMITS.perImageDecodedBytes));
  assert.match(compressed.note, /quality 50/);
  // Beside other images, the budget is what the document has left.
  const others = { bytes: LIMITS.documentImageDecodedBytes - 50000, pixels: 0 };
  const tight = await convertRaster(new Uint8Array(png(640, 400)), { compress: true, others }, fakeEnv({ sizeAt }).env);
  assert.equal(tight.code, "image-limit");
  assert.match(tight.message, /beside the theme's other images/);
  // A browser without a WebP encoder writes PNG, and the data says so.
  const fallback = await convertRaster(new Uint8Array(png(64, 32)), {}, fakeEnv({ writes: "png" }).env);
  assert.ok(fallback.ok);
  assert.match(fallback.image.data, /^data:image\/png;base64,/);
  assert.match(fallback.note, /saved as PNG/);
});

test("a cancelled conversion releases its bitmap and canvas and reports cancelled", async () => {
  const controller = new AbortController();
  const { env, log } = fakeEnv({ decodeDelay: 20 });
  const job = convertRaster(new Uint8Array(png(64, 64)), { signal: controller.signal }, env);
  controller.abort();
  assert.equal((await job).code, "cancelled");
  assert.deepEqual([log.decodes, log.closed, log.canvases, log.encodes.length], [1, 1, 0, 0]);
});

test("the queue runs one job at a time and cancels the job a newer one for the same layer replaces", async () => {
  const queue = createRasterQueue();
  const order = [];
  let running = 0;
  let most = 0;
  const job = (name, ms) => async (signal) => {
    running++;
    most = Math.max(most, running);
    order.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    order.push(`${signal.aborted ? "stopped" : "end"} ${name}`);
    return signal.aborted ? { ok: false, code: "cancelled" } : { ok: true, name };
  };
  const a = queue.run("page/0", job("a", 30));
  const b = queue.run("header/0", job("b", 5));
  await new Promise((r) => setTimeout(r, 5));
  const c = queue.run("page/0", job("c", 5));
  assert.equal(queue.pending, 3);
  const results = await Promise.all([a, b, c]);
  assert.deepEqual(results.map((r) => r.code ?? r.name), ["cancelled", "b", "c"]);
  assert.equal(most, 1);
  assert.deepEqual(order, ["start a", "stopped a", "start b", "end b", "start c", "end c"]);
  // A job replaced before it starts never runs.
  const d = queue.run("x", job("d", 5));
  const e = queue.run("x", job("e", 5));
  assert.equal((await d).code, "cancelled");
  assert.equal((await e).name, "e");
  queue.cancelAll();
  assert.equal((await queue.run("y", async (signal) => (signal.aborted ? { code: "cancelled" } : { ok: true }))).ok, true);
  assert.equal(queue.pending, 0);
});

test("builder edits: set and remove an image layer within the layer, byte and pixel caps", () => {
  const small = { data: dataUrl("png", png(100, 50)), width: 100, height: 50 };
  const set = setRasterLayer({ ...MINIMAL, backgrounds: { page: { color: "#0a0a17", layers: [{ pattern: { kind: "grid", color: "#00f0ff" } }] } } }, "page", 1, small, { fit: "tile", opacity: 0.5 });
  assert.ok(set.ok);
  assert.deepEqual(set.theme.backgrounds.page.layers[1], { image: { ...small, fit: "tile", opacity: 0.5 } });
  // Replacing keeps fit, position and opacity unless given.
  const replaced = setRasterLayer(set.theme, "page", 1, { data: dataUrl("png", png(10, 10)), width: 10, height: 10 });
  assert.deepEqual(replaced.theme.backgrounds.page.layers[1].image.opacity, 0.5);
  assert.equal(setRasterLayer(set.theme, "page", 1, { ...small, width: 99 }).code, "image-data");
  const full = { ...MINIMAL, backgrounds: { header: { layers: [1, 2, 3, 4].map(() => ({ pattern: { kind: "dots", color: "#ffffff" } })) } } };
  assert.equal(setRasterLayer(full, "header", 4, small).code, "image-limit");
  const max = { data: dataUrl("png", png(2048, 1024)), width: 2048, height: 1024 };
  let theme = MINIMAL;
  for (const target of ["page", "profileBanner", "header"]) theme = setRasterLayer(theme, target, 0, max).theme;
  assert.equal(rasterTotals(theme).pixels, LIMITS.documentImageDecodedPixels);
  assert.equal(setRasterLayer(theme, "header", 1, small).code, "image-limit");
  // Remove takes the layer, then any target left empty.
  const removed = removeRasterLayer(theme, "header", 0);
  assert.ok(removed.ok && !removed.theme.backgrounds.header && removed.theme.backgrounds.page);
  assert.equal(removeRasterLayer(MINIMAL, "page", 0).ok, false);
  assert.ok(validateTheme(removed.theme).ok);
});

test("imageAssets keys each admitted image by the hash of its bytes and leaves out the rest", () => {
  const good = dataUrl("png", png(4, 4));
  const animated = dataUrl("gif", gifAnimated(2, 2));
  const theme = { ...MINIMAL, backgrounds: { page: { layers: [{ image: { data: good, width: 4, height: 4 } }, { image: { data: animated, width: 2, height: 2 } }] }, header: { layers: [{ image: { data: good, width: 4, height: 4 } }] } } };
  const assets = imageAssets(theme);
  assert.deepEqual([...assets.entries()], [[sha256(png(4, 4)), good]]);
  assert.equal(imageAssets(null).size, 0);
});

test("rasters r1 finding 1: a GIF frame larger than its logical screen is refused before any decode", async () => {
  // The review's complete GIF: a 1x1 screen whose frame is 2050x1, decoded at 2050x1 by browsers.
  const bytes = new Uint8Array(readFileSync(new URL("../fixtures/images/oversized-frame.gif", import.meta.url)));
  const { env, log } = fakeEnv({ decoded: { width: 2050, height: 1 } });
  const result = await convertRaster(bytes, {}, env);
  assert.equal(result.ok, false);
  assert.match(result.message, /frame lies outside the image/);
  assert.deepEqual([log.decodes, log.canvases], [0, 0]);
});

test("rasters r1 finding 3: a removed or replaced image leaves no admitted data behind", () => {
  const [kept, replaced, removed] = [png(3, 3), png(5, 5), png(7, 7)].map((bytes) => dataUrl("png", bytes));
  // In its own process, so the collection is forced and nothing else in this file holds the data.
  const module = (path) => JSON.stringify(new URL(`../../packages/${path}`, import.meta.url).href);
  const script = `
    import { imageAssets, removeRasterLayer, setRasterLayer } from ${module("appearance/raster.js")};
    import { rasterInfo, validateTheme } from ${module("format/index.js")};
    import { setImmediate } from "node:timers/promises";
    const [kept, replaced, removed] = ${JSON.stringify([kept, replaced, removed])};
    const layer = (data, side) => ({ data, width: side, height: side });
    const weak = {};
    let theme = ${JSON.stringify(MINIMAL)};
    theme = setRasterLayer(theme, "page", 0, layer(replaced, 5)).theme;
    theme = setRasterLayer(theme, "header", 0, layer(removed, 7)).theme;
    // Validation, resolution and the paint admit and hash every image the theme carries.
    if (!validateTheme(theme).ok || imageAssets(theme).size !== 2) throw new Error("the images were not admitted");
    weak.replaced = new WeakRef(rasterInfo(replaced).bytes);
    weak.removed = new WeakRef(rasterInfo(removed).bytes);
    theme = setRasterLayer(theme, "page", 0, layer(kept, 3)).theme;
    theme = removeRasterLayer(theme, "header", 0).theme;
    weak.kept = new WeakRef(rasterInfo(kept).bytes);
    await setImmediate();
    for (let i = 0; i < 4; i++) globalThis.gc();
    await setImmediate();
    console.log(JSON.stringify(Object.fromEntries(Object.entries(weak).map(([name, ref]) => [name, ref.deref() !== undefined]))), theme.backgrounds.page.layers.length);
  `;
  const out = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], { encoding: "utf8" }).trim();
  // The image the theme still carries stays admitted; the replaced and removed ones are gone.
  assert.equal(out, `${JSON.stringify({ replaced: false, removed: false, kept: true })} 1`);
});

test("only admitted images are kept, and releasing a theme spares an image another document still carries", () => {
  const shared = dataUrl("png", png(6, 6));
  const own = dataUrl("png", png(8, 8));
  const theme = { ...MINIMAL, backgrounds: { page: { layers: [{ image: { data: shared, width: 6, height: 6 } }, { image: { data: own, width: 8, height: 8 } }] } } };
  const other = { ...MINIMAL, backgrounds: { header: { layers: [{ image: { data: shared, width: 6, height: 6 } }] } } };
  const [sharedInfo, ownInfo] = [rasterInfo(shared), rasterInfo(own)];
  assert.equal(rasterInfo(shared), sharedInfo, "an admitted image is kept by its data");
  releaseRasters(theme, other);
  assert.equal(rasterInfo(shared), sharedInfo, "the other document still carries it");
  assert.notEqual(rasterInfo(own), ownInfo, "the released image is admitted again");
  const refused = `data:image/png;base64,${Buffer.from("not an image").toString("base64")}`;
  assert.notEqual(rasterInfo(refused), rasterInfo(refused), "a refused string is never kept");
});
