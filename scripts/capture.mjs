// npm run capture:release: DONE.md's store and promo images, made from the release candidate.
// It unpacks the Chrome package from artifacts/, checked against SHA256SUMS and build-info.json as
// qa:live checks it, installs it in a fresh logged-out Chromium profile and captures, at 1280x800:
//   1. whoisaldo in Choom Circuit, Full
//   2. whoisaldo in Frieren's Longroad Petals, Full
//   3. the popup, shown over Alitleis123
//   4. torvalds in Choom Circuit, Full beside Calm, at the same scroll
//   5. an AI-made theme answer in Make a theme's import dialog, with its Advanced CSS note
// plus a close-up of whoisaldo's contribution graph. The 1400x560 marquee and the 1200x630 site
// image are composed from those captures with the brand's icon and Manrope type, and the 440x280
// tile from the icon and the name; the icons are the brand masters in assets/brand. GitHub is
// visited logged out and only read.
// Writes artifacts/release/store/ with capture.json: each file's size, what it shows, its source
// address, theme and appearance, the store caption for each screenshot, and the candidate. Every
// file must have its exact size, or the command fails.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { catalogCards, readCatalogEntries } from "../packages/ui/bundle.mjs";
import { chromiumWithExtension, commit, provenance, unpack } from "./qa-live.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const OUT = "artifacts/release/store";
// The brand masters, and the AI answer screenshot 5 imports: a chatbot's reply to the product's own
// prompt, kept as it came.
const BRAND = "assets/brand";
export const AI_ANSWER = "assets/store/ai-answer.md";
const SIZE = { width: 1280, height: 800 };
const CHOOM = "anime.cyberpunk-edgerunners";
const FRIEREN = "anime.frieren";
const PROFILES = { whoisaldo: "https://github.com/whoisaldo", Alitleis123: "https://github.com/Alitleis123", torvalds: "https://github.com/torvalds" };
// Store copy for the five screenshots.
export const CAPTIONS = Object.freeze([
  "Cyberpunk: Edgerunners. Choom Circuit carries forward the original yellow and cyan Cyberpunk look.",
  "Frieren: Beyond Journey's End. Longroad Petals changes the background, panels, type, avatar frame and contribution graph.",
  "Themes inspired by 13 anime, plus 12 Classics. Show titles lead the picker.",
  "Cyberpunk: Edgerunners. Calm removes decoration and advanced CSS. Header, button, code and graph colors stay.",
  "Import an AI-made theme. Preview backgrounds, fonts and code colors locally. Review optional CSS before enabling it.",
]);
export const ICON_SIZES = Object.freeze([16, 32, 48, 64, 128, 512]);

/** A PNG's width and height from its IHDR chunk. */
export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Opens a public GitHub page in a fresh load and waits for it to settle. */
async function open(page, url) {
  const response = await page.goto(url, { waitUntil: "load", timeout: 60000 });
  if (!response || response.status() >= 400) throw new Error(`${url} answered ${response?.status() ?? "nothing"}`);
  await page.waitForTimeout(2500);
}

/** Selects a theme and appearance, and waits until the page shows that theme's canvas. */
async function choose(control, page, canvas, id, appearance = "full") {
  for (const action of [{ type: "setPreference", key: "appearance", value: appearance }, { type: "selectTheme", id }]) {
    const reply = await commit(control, action);
    if (!reply?.ok) throw new Error(`could not ${JSON.stringify(action)}`);
  }
  await page.waitForFunction((canvas) => getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim() === canvas, canvas, { timeout: 10000 });
  await page.waitForTimeout(800);
}

/** Renders `html` in a plain page of `size` and saves it as `path`. */
async function compose(browser, html, size, path) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path });
  } finally {
    await page.close();
  }
}

const dataUrl = (bytes, type) => `data:${type};base64,${bytes.toString("base64")}`;

/** Runs DONE.md's capture and writes the store set. Resolves to {exitCode, testCount}. */
export async function captureRelease({ root = DEFAULT_ROOT } = {}) {
  const config = JSON.parse(await readFile(join(root, "release.config.json"), "utf8"));
  const out = join(root, OUT);
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "icons"), { recursive: true });
  const at = (name) => join(out, name);
  const records = [];
  const note = (file, entry) => records.push({ file: `${OUT}/${file}`, ...entry });
  let chrome = null;
  let themed = null;
  let plain = null;
  let error = null;
  try {
    chrome = await unpack(root, config.version, "chrome");
    const candidate = await provenance(root, { chrome }, config.version);
    const canvasOf = Object.fromEntries(catalogCards(await readCatalogEntries(root)).map((card) => [card.id, card.mini.canvas]));
    themed = await chromiumWithExtension(chrome.dir, SIZE);
    const { context, control, id } = themed;
    const page = await context.newPage();
    await page.setViewportSize(SIZE);

    // 1, 2 and the graph: whoisaldo in Choom Circuit and Longroad Petals.
    await open(page, PROFILES.whoisaldo);
    await choose(control, page, canvasOf[CHOOM], CHOOM);
    await page.screenshot({ path: at("screenshot-1.png") });
    note("screenshot-1.png", { shows: "whoisaldo in Choom Circuit, Full", url: PROFILES.whoisaldo, theme: CHOOM, appearance: "full", caption: CAPTIONS[0] });
    const graph = page.locator(".js-yearly-contributions").first();
    if (await graph.count()) {
      await graph.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await graph.screenshot({ path: at("graph-choom.png") });
      note("graph-choom.png", { shows: "whoisaldo's contribution graph in Choom Circuit", url: PROFILES.whoisaldo, theme: CHOOM, appearance: "full" });
      await page.evaluate(() => scrollTo(0, 0));
    }
    await choose(control, page, canvasOf[FRIEREN], FRIEREN);
    await page.screenshot({ path: at("screenshot-2.png") });
    note("screenshot-2.png", { shows: "whoisaldo in Longroad Petals, Full", url: PROFILES.whoisaldo, theme: FRIEREN, appearance: "full", caption: CAPTIONS[1] });
    await choose(control, page, canvasOf["anime.dandadan"], "anime.dandadan");
    const occult = await page.screenshot();

    // 3: the popup over Alitleis123, as the toolbar button opens it.
    await open(page, PROFILES.Alitleis123);
    await choose(control, page, canvasOf[CHOOM], CHOOM);
    const profile = await page.screenshot();
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(`chrome-extension://${id}/pages/popup.html`);
    await popup.waitForSelector(".rs-card");
    await popup.waitForTimeout(800);
    const picker = await popup.screenshot();
    await popup.close();

    // 4: torvalds in Choom Circuit, Full and Calm at the same scroll.
    await open(page, PROFILES.torvalds);
    await choose(control, page, canvasOf[CHOOM], CHOOM, "full");
    const full = await page.screenshot();
    await choose(control, page, canvasOf[CHOOM], CHOOM, "calm");
    await page.waitForTimeout(800);
    const calm = await page.screenshot();
    await choose(control, page, canvasOf[CHOOM], CHOOM, "full");

    // 5: an AI-made answer in Make a theme's import dialog.
    const answer = await readFile(join(root, AI_ANSWER), "utf8");
    const builder = await context.newPage();
    await builder.setViewportSize(SIZE);
    await builder.goto(`chrome-extension://${id}/pages/settings.html#make`);
    await builder.waitForSelector('[data-rb="builder"][data-rb-ready]');
    const fresh = builder.getByRole("button", { name: "Start with your saved theme" });
    if (await fresh.isVisible().catch(() => false)) await fresh.click();
    await builder.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = builder.getByRole("dialog", { name: "Import a theme" });
    await dialog.getByRole("textbox", { name: "Chatbot answer" }).fill(answer);
    await dialog.getByRole("button", { name: "Preview theme" }).click();
    await dialog.locator('[data-rb="import-css-warning"]').waitFor({ state: "visible", timeout: 15000 });
    await dialog.locator('[data-rb="import-frame"] iframe').first().waitFor({ state: "attached" });
    // The result at the top of the dialog: its title, notes, CSS review and the preview below.
    await dialog.locator('[data-rb="import-show"]').evaluate((element) => element.scrollIntoView({ block: "start" }));
    await builder.waitForTimeout(1500);
    const named = (await dialog.locator('[data-rb="import-show"], [data-rb="import-name"]').first().textContent()).trim();
    await builder.screenshot({ path: at("screenshot-5.png") });
    note("screenshot-5.png", { shows: `the import dialog with the AI-made answer "${named}"`, url: "pages/settings.html#make", answer: AI_ANSWER, caption: CAPTIONS[4] });
    await builder.close();

    // The composed images, in a browser without the extension.
    plain = await chromium.launch({ headless: true });
    const font = dataUrl(await readFile(join(root, BRAND, "fonts/Manrope-Variable.ttf")), "font/ttf");
    const icon = await readFile(join(root, BRAND, "icon.svg"), "utf8");
    const base = `<style>@font-face{font-family:Manrope;src:url(${font}) format("truetype");font-weight:200 800}*{box-sizing:border-box;margin:0}body{background:#0c0f14;font-family:Manrope,sans-serif;color:#f5f3ee;overflow:hidden}</style>`;

    await compose(
      plain,
      `${base}<style>body{width:1280px;height:800px;position:relative}.page{position:absolute;inset:0;width:1280px}.popup{position:absolute;top:12px;right:16px;width:400px;height:600px;border-radius:10px;box-shadow:0 18px 48px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08)}</style>
      <img class="page" src="${dataUrl(profile, "image/png")}"><img class="popup" src="${dataUrl(picker, "image/png")}">`,
      SIZE,
      at("screenshot-3.png"),
    );
    note("screenshot-3.png", { shows: "the popup over Alitleis123 in Choom Circuit", url: PROFILES.Alitleis123, theme: CHOOM, appearance: "full", caption: CAPTIONS[2] });

    await compose(
      plain,
      `${base}<style>body{width:1280px;height:800px;position:relative}.half{position:absolute;top:0;width:640px;height:800px;overflow:hidden}.half img{width:1280px;height:800px}.calm img{margin-left:-640px}.calm{left:640px;border-left:2px solid #ff806c}.tag{position:absolute;bottom:18px;padding:4px 12px;border-radius:999px;background:#151a22;border:1px solid #ff806c;font-weight:650;font-size:15px}</style>
      <div class="half"><img src="${dataUrl(full, "image/png")}"></div><div class="half calm"><img src="${dataUrl(calm, "image/png")}"></div>
      <span class="tag" style="left:16px">Full</span><span class="tag" style="left:658px">Calm</span>`,
      SIZE,
      at("screenshot-4.png"),
    );
    note("screenshot-4.png", { shows: "torvalds in Choom Circuit, Full and Calm at the same scroll", url: PROFILES.torvalds, theme: CHOOM, appearance: "full and calm", caption: CAPTIONS[3] });

    // The marquee and the site image: the name and line, and three real themes.
    const shots = [occult, await readFile(at("screenshot-2.png")), await readFile(at("screenshot-1.png"))].map((png) => dataUrl(png, "image/png"));
    const promo = (width, height, scale) => `${base}<style>
      body{width:${width}px;height:${height}px;position:relative}
      .text{position:absolute;left:${72 * scale}px;top:50%;transform:translateY(-50%);width:${width - (210 + 560 + 72 + 32) * scale}px}
      .icon{width:${84 * scale}px;height:${84 * scale}px;display:block;margin-bottom:${28 * scale}px}
      h1{font-weight:650;font-size:${58 * scale}px;letter-spacing:-0.03em;line-height:1.05}
      p{color:#b0b8c5;font-size:${22 * scale}px;line-height:1.35;margin-top:${18 * scale}px}
      .studio{font-size:${15 * scale}px;margin-top:${30 * scale}px}
      .shot{position:absolute;width:${560 * scale}px;border-radius:${10 * scale}px;box-shadow:0 ${16 * scale}px ${44 * scale}px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.07)}
    </style>
    <div class="text"><div class="icon">${icon.replace("<svg", '<svg width="100%" height="100%"')}</div><h1>Re-theme your GitHub.</h1><p>Themes inspired by 13 anime.<br>12 Classics. Full or Calm.</p><p class="studio">Sideband Studio</p></div>
    <img class="shot" src="${shots[0]}" style="right:${210 * scale}px;top:${height / 2 - 245 * scale}px">
    <img class="shot" src="${shots[1]}" style="right:${110 * scale}px;top:${height / 2 - 170 * scale}px">
    <img class="shot" src="${shots[2]}" style="right:${24 * scale}px;top:${height / 2 - 95 * scale}px">`;
    await compose(plain, promo(1400, 560, 1), { width: 1400, height: 560 }, at("marquee-1400x560.png"));
    note("marquee-1400x560.png", { shows: "the name, the line and Occult Orbit, Longroad Petals and Choom Circuit on whoisaldo" });
    await compose(plain, promo(1200, 630, 0.92), { width: 1200, height: 630 }, at("og-1200x630.png"));
    note("og-1200x630.png", { shows: "the site's sharing image: the name, the line and three themes" });

    // The small tile carries only the name, as the store copy asks. Then the brand's icon masters.
    await compose(plain, `${base}<style>
      body{width:440px;height:280px;display:flex;align-items:center;justify-content:center;gap:28px}
      .icon{width:112px;height:112px}
      h1{font-weight:650;font-size:44px;letter-spacing:-0.02em;line-height:1.08}
      h1 span{display:block;color:#ff806c}
    </style>
    <div class="icon">${icon.replace("<svg", '<svg width="100%" height="100%"')}</div><h1>GitHub<span>Reskin</span></h1>`, { width: 440, height: 280 }, at("tile-440x280.png"));
    note("tile-440x280.png", { shows: "the small promo tile: the icon and the name" });
    for (const size of ICON_SIZES) {
      await writeFile(at(`icons/icon-${size}.png`), await readFile(join(root, BRAND, `icon-${size}.png`)));
      note(`icons/icon-${size}.png`, { shows: `the icon at ${size}px`, source: `${BRAND}/icon.svg` });
    }

    await writeFile(at("capture.json"), `${JSON.stringify({ captured: new Date().toISOString(), candidate, browser: `chromium ${plain.version()}`, files: records }, null, 2)}\n`);
  } catch (thrown) {
    error = thrown;
    console.error(`capture:release stopped: ${thrown.message.split("\n")[0]}`);
  } finally {
    await themed?.close().catch(() => {});
    await plain?.close().catch(() => {});
    if (chrome) await rm(chrome.dir, { recursive: true, force: true });
  }

  // Each file at its exact size.
  const expected = { "screenshot-1.png": SIZE, "screenshot-2.png": SIZE, "screenshot-3.png": SIZE, "screenshot-4.png": SIZE, "screenshot-5.png": SIZE, "marquee-1400x560.png": { width: 1400, height: 560 }, "og-1200x630.png": { width: 1200, height: 630 }, "tile-440x280.png": { width: 440, height: 280 }, ...Object.fromEntries(ICON_SIZES.map((size) => [`icons/icon-${size}.png`, { width: size, height: size }])) };
  let failed = 0;
  for (const [file, size] of Object.entries(expected)) {
    const got = pngSize(await readFile(at(file)).catch(() => Buffer.alloc(0)));
    const pass = got?.width === size.width && got?.height === size.height;
    if (!pass) failed++;
    console.log(`${pass ? "ok  " : "FAIL"} ${OUT}/${file}: ${got ? `${got.width}x${got.height}` : "missing"}, needs ${size.width}x${size.height}`);
  }
  console.log(`capture:release: ${Object.keys(expected).length} files, ${failed} wrong. ${OUT}/capture.json lists what each shows.`);
  return { exitCode: failed || error ? 1 : 0, testCount: Object.keys(expected).length };
}
