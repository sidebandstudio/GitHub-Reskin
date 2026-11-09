// Embedded images in real engines: the builder's local conversion with the browser's own decoder
// and encoder (first frame of animated GIF, APNG and WebP; metadata gone; output admitted), its
// serial queue and cancellation, and the wallpaper, banner and header image drawn in the preview
// and on the GitHub-like page alike in Full, none of them in Calm, and released when replaced.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32 } from "../../../packages/format/index.js";
import { PREFS, expect, inFrame, mount, test, update } from "./helpers.mjs";

const image = (name) => [...readFileSync(fileURLToPath(new URL(`../../fixtures/images/${name}`, import.meta.url)))];
const CALM = { ...PREFS, extras: false };

// The same JPEG with an EXIF segment after its start, and an APNG with a text chunk.
function withExif(bytes) {
  const exif = [...Buffer.from("Exif\0\0MM\0*\0\0\0\x08\0\0", "binary")];
  const length = exif.length + 2;
  return [bytes[0], bytes[1], 0xff, 0xe1, length >> 8, length & 255, ...exif, ...bytes.slice(2)];
}
function withText(bytes) {
  const body = Buffer.concat([Buffer.from("tEXt"), Buffer.from("Comment\0private note")]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length - 4);
  return [...bytes.slice(0, 33), ...length, ...body, ...Buffer.from(crc32(body), "hex"), ...bytes.slice(33)];
}

// In the page: convert, then decode the output and read its centre pixel.
async function convertAndSample([bytes, options]) {
  const { convertRaster, rasterInfo, rasterSourceInfo } = window.reskinRaster;
  const source = rasterSourceInfo(new Uint8Array(bytes));
  const result = await convertRaster(new Uint8Array(bytes), options);
  if (!result.ok) return { source, result };
  const admitted = rasterInfo(result.image.data);
  const blob = await (await fetch(result.image.data)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  const pixel = [...context.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data];
  bitmap.close();
  return { source: { animated: source.animated, metadata: source.metadata, mime: source.mime }, ok: true, admitted: admitted.ok, mime: result.after.mime, size: [result.image.width, result.image.height], pixel, note: result.note };
}

test("the browser conversion keeps the first frame, strips metadata, and its PNG or WebP output is admitted", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("preview.html"));
  await page.waitForFunction(() => window.reskinRaster);
  const cases = [
    ["anim.gif", image("anim.gif"), { animated: true }],
    ["anim-apng.png", image("anim-apng.png"), { animated: true }],
    ["anim.webp", image("anim.webp"), { animated: true }],
    ["exif.jpg", withExif(image("plain.jpg")), { metadata: true }],
    ["text.png", withText(image("anim-apng.png")), { animated: true, metadata: true }],
  ];
  for (const [name, bytes, expected] of cases) {
    for (const format of ["webp", "png"]) {
      const out = await page.evaluate(convertAndSample, [bytes, { format }]);
      expect(out.ok, `${name} ${format}: ${JSON.stringify(out.result)}`).toBe(true);
      expect(out.source, name).toMatchObject(expected);
      expect(out.admitted, name).toBe(true);
      expect(out.mime).toBe(`image/${format}`);
      if (expected.animated) {
        // The first frame is red (#ff2050), the second blue.
        expect(out.pixel[0], `${name} ${format} ${out.pixel}`).toBeGreaterThan(200);
        expect(out.pixel[2], `${name} ${format} ${out.pixel}`).toBeLessThan(140);
        expect(out.note).toMatch(/kept the first frame/);
      }
      if (expected.metadata) expect(out.note).toMatch(/removed metadata/);
    }
  }
  // Crop and Resize, measured from the decoded output.
  const cropped = await page.evaluate(convertAndSample, [image("plain.jpg"), { crop: { x: 10, y: 5, width: 20, height: 20 }, maxSide: 10 }]);
  expect(cropped.size).toEqual([10, 10]);
  // SVG is never a source.
  const svg = await page.evaluate((text) => window.reskinRaster.convertRaster(new TextEncoder().encode(text)), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  expect(svg).toMatchObject({ ok: false, code: "image-data" });
});

test("conversions run one at a time; a replaced job is cancelled, and art converts within the caps", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("preview.html"));
  await page.waitForFunction(() => window.reskinArt);
  const out = await page.evaluate(async () => {
    const { convertRaster, createRasterQueue } = window.reskinRaster;
    const art = await window.reskinArt.paintArt(2048, 1024);
    const queue = createRasterQueue();
    const first = queue.run("page/0", (signal) => convertRaster(art, { compress: true, signal }));
    // The person picks another file before the first decode finishes.
    await new Promise((r) => setTimeout(r, 0));
    const second = queue.run("page/0", (signal) => convertRaster(art, { compress: true, maxSide: 1024, signal }));
    const results = await Promise.all([first, second]);
    return results.map((r) => ({ ok: r.ok, code: r.code ?? null, size: r.ok ? [r.image.width, r.image.height] : null, bytes: r.after?.bytes ?? null }));
  });
  expect(out[0]).toMatchObject({ ok: false, code: "cancelled" });
  expect(out[1]).toMatchObject({ ok: true, size: [1024, 512] });
  expect(out[1].bytes).toBeLessThanOrEqual(131072);
  const max = await page.evaluate(() => window.reskinArt.artTheme({ max: true }).then((r) => r.bytes));
  expect(max.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(262144);
});

// Computed background images of the page, header and banner.
function paints(doc) {
  const view = doc.defaultView;
  const bg = (selector) => {
    const node = doc.querySelector(selector);
    return node ? view.getComputedStyle(node).backgroundImage : null;
  };
  return { body: bg("body"), header: bg(".AppHeader"), banner: bg(".rs-banner"), panel: doc.querySelector(".markdown-body") ? view.getComputedStyle(doc.querySelector(".markdown-body")).backgroundColor : null };
}
const urls = (text) => (text ?? "").match(/url\("data:image\/webp;base64,/g)?.length ?? 0;

test("Full draws the wallpaper, banner and header image in the preview and on the page alike; Calm draws none", async ({ page, fixtureApp }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixtureApp.url("preview.html?slots=all"));
  await page.waitForFunction(() => window.reskinArt);
  const { theme } = await page.evaluate(() => window.reskinArt.artTheme());
  await mount(page, fixtureApp, { theme });
  const full = await inFrame(page, paints);
  expect(urls(full.body)).toBe(1);
  expect(urls(full.header)).toBe(1);
  expect(urls(full.banner)).toBe(1);
  // Text sits on the page and the header, so their images draw under a veil of the paint color;
  // the banner holds no text and draws its image as it is.
  expect(full.body).toMatch(/^linear-gradient\(rgba\(7, 6, 26, 0\.\d+\), rgba\(7, 6, 26, 0\.\d+\)\), url\(/);
  expect(full.header).toMatch(/^linear-gradient\(rgba\(7, 6, 26, 0\.\d+\)/);
  expect(full.banner).toMatch(/^url\(/);
  expect(full.panel).toBe("rgb(7, 6, 26)");
  // The banner reserves its own region and holds nothing.
  expect(await inFrame(page, (doc) => ({ text: doc.querySelector(".rs-banner").textContent, hidden: doc.querySelector(".rs-banner").getAttribute("aria-hidden"), height: doc.querySelector(".rs-banner").getBoundingClientRect().height }))).toEqual({ text: "", hidden: "true", height: 140 });

  await update(page, theme, CALM);
  const calm = await inFrame(page, paints);
  expect([urls(calm.body), urls(calm.header), calm.banner]).toEqual([0, 0, null]);
  expect(calm.body).toBe("none");
  expect(await page.evaluate(() => window.reskinPreview.srcdoc().includes('url("data:image'))).toBe(false);

  // The page the content adapter themes computes the same image lists.
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [theme, PREFS]);
  const live = await page.evaluate(`(${paints.toString()})(document)`);
  expect(live.body).toBe(full.body);
  expect(live.header).toBe(full.header);
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [theme, CALM]);
  expect(await page.evaluate(`(${paints.toString()})(document)`)).toMatchObject({ body: "none" });
});

test("replacing or removing an image theme leaves no image data, frame or style behind", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("preview.html"));
  await page.waitForFunction(() => window.reskinArt);
  const { theme } = await page.evaluate(() => window.reskinArt.artTheme());
  await mount(page, fixtureApp, { theme });
  // The fixture's own avatars travel as embedded <img> data too; the theme's images are CSS urls.
  expect(await page.evaluate(() => window.reskinPreview.srcdoc().match(/url\("data:image\/webp/g).length)).toBe(3);
  // The shown frame and the hidden layout frame.
  const frames = await page.evaluate(() => document.querySelectorAll("#preview iframe").length);
  const plain = { ...theme, name: "Plain", backgrounds: undefined };
  for (let i = 0; i < 5; i++) {
    await update(page, theme);
    await update(page, plain);
  }
  const after = await page.evaluate(() => ({ frames: document.querySelectorAll("#preview iframe").length, data: window.reskinPreview.srcdoc().includes('url("data:image') }));
  expect(after).toEqual({ frames, data: false });
  await page.evaluate(() => window.reskinPreview.destroy());
  expect(await page.evaluate(() => document.querySelectorAll("#preview iframe").length)).toBe(0);

  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  for (let i = 0; i < 5; i++) await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [theme, PREFS]);
  await page.evaluate(() => window.reskinNative.remove());
  expect(await page.evaluate(() => ({ styles: document.querySelectorAll("style[data-reskin-style]").length, data: [...document.querySelectorAll("style")].some((s) => s.textContent.includes("data:image/webp")), owned: document.querySelectorAll("[data-reskin-owned]").length }))).toEqual({ styles: 0, data: false, owned: 0 });
});

// In the page: header admission, then conversion with the browser's own primitives, counting decodes.
async function admitAndConvert([bytes, mime]) {
  const { browserRasterEnv, convertRaster, rasterInfo, rasterSourceInfo } = window.reskinRaster;
  const env = browserRasterEnv();
  let decodes = 0;
  const counted = { ...env, decode: (blob) => (decodes++, env.decode(blob)) };
  const binary = String.fromCharCode(...bytes);
  const admitted = rasterInfo(`data:image/${mime};base64,${btoa(binary)}`);
  const source = rasterSourceInfo(new Uint8Array(bytes));
  const result = await convertRaster(new Uint8Array(bytes), {}, counted);
  const converted = result.ok ? rasterInfo(result.image.data) : null;
  return { admitted: admitted.ok || admitted.code, source: source.ok || source.message, result: result.ok || result.message, note: result.note ?? null, converted: converted?.ok ?? null, decodes };
}

// plain.jpg without its comment, the same with a comment after its frame header, and cut off at
// the end of the frame header.
function jpegSegments(bytes) {
  const out = [];
  for (let i = 2; i < bytes.length; ) {
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    out.push({ at: i, marker: bytes[i + 1], end: i + 2 + length });
    if (bytes[i + 1] === 0xda) break;
    i += 2 + length;
  }
  return out;
}

test("rasters r1 findings 1 and 2: a GIF frame past its screen and a truncated JPEG never reach the decoder; a late JPEG comment is metadata", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("preview.html"));
  await page.waitForFunction(() => window.reskinRaster);
  // The review's GIF: a 1x1 logical screen whose frame is 2050x1, which both engines decode at 2050x1.
  const gif = await page.evaluate(admitAndConvert, [image("oversized-frame.gif"), "gif"]);
  expect(gif).toEqual({ admitted: "image-data", source: expect.stringMatching(/frame lies outside the image/), result: expect.stringMatching(/frame lies outside the image/), note: null, converted: null, decodes: 0 });

  const plain = image("plain.jpg");
  const segments = jpegSegments(plain);
  const comment = segments.find((s) => s.marker === 0xfe);
  const clean = [...plain.slice(0, comment.at), ...plain.slice(comment.end)];
  const sof = jpegSegments(clean).find((s) => s.marker === 0xc0);
  const text = [...Buffer.from("private-review-marker")];
  const late = [...clean.slice(0, sof.end), 0xff, 0xfe, 0, text.length + 2, ...text, ...clean.slice(sof.end)];
  const truncated = clean.slice(0, sof.end);

  // The clean JPEG passes as it is; the late comment is refused until conversion removes it, and
  // conversion says so; the truncated file is refused before any decode.
  expect(await page.evaluate(admitAndConvert, [clean, "jpeg"])).toMatchObject({ admitted: true, source: true, result: true, converted: true, decodes: 1 });
  const commented = await page.evaluate(admitAndConvert, [late, "jpeg"]);
  expect(commented).toMatchObject({ admitted: "image-conversion", source: true, result: true, converted: true, decodes: 1 });
  expect(commented.note).toMatch(/removed metadata/);
  expect(await page.evaluate(admitAndConvert, [truncated, "jpeg"])).toEqual({ admitted: "image-data", source: expect.stringMatching(/does not end cleanly/), result: expect.stringMatching(/does not end cleanly/), note: null, converted: null, decodes: 0 });
});

test("rasters r1 finding 3: the preview releases the admitted data of a replaced or destroyed theme's images", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("preview.html"));
  await page.waitForFunction(() => window.reskinArt);
  const { theme } = await page.evaluate(() => window.reskinArt.artTheme());
  const data = Object.values(theme.backgrounds).flatMap((target) => (target.layers ?? []).filter((layer) => layer.image).map((layer) => layer.image.data));
  expect(data.length).toBe(3);
  // In the page: hold what admission returns now, or say whether each image was admitted afresh.
  const hold = (images) => (window.held = images.map((d) => window.reskinRaster.rasterInfo(d))).every((info, i) => info.ok && window.reskinRaster.rasterInfo(images[i]) === info);
  const fresh = (images) => images.map((d, i) => window.reskinRaster.rasterInfo(d) !== window.held[i]);
  await mount(page, fixtureApp, { theme });
  expect(await page.evaluate(hold, data)).toBe(true);
  await update(page, { ...theme, name: "Recolored", colors: { ...theme.colors, accent: "#00f0ff" } });
  expect(await page.evaluate(fresh, data), "an edit that keeps the images keeps their admission").toEqual([false, false, false]);
  await update(page, { ...theme, name: "Plain", backgrounds: undefined });
  expect(await page.evaluate(fresh, data), "a replaced theme releases its images").toEqual([true, true, true]);
  await update(page, theme);
  expect(await page.evaluate(hold, data)).toBe(true);
  await page.evaluate(() => window.reskinPreview.destroy());
  expect(await page.evaluate(fresh, data), "destroy releases them").toEqual([true, true, true]);
});
