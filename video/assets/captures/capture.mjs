// Real product captures for the two films: the built Chrome package, unpacked into a fresh logged-out
// Chromium profile, on public github.com pages. Themes are chosen by clicking the popup page's own
// cards and controls, which commit through the extension's background like the toolbar popup. It
// never signs in, stars, follows or edits anything.
//   npm run build:stores
//   node video/assets/captures/capture.mjs [--extension dist/chrome] [--only P02-V,P04-V]
// Writes <id>.png and <id>.json (URL, theme, hashes, extension commit, viewport, scroll, date) here.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");

export const PRESETS = Object.freeze({
  V: { width: 390, height: 844, dpr: 3 },
  D: { width: 1440, height: 1000, dpr: 2 },
  POP: { width: 400, height: 600, dpr: 3 },
});

const OWNER = "https://github.com/whoisaldo";
const BROTHER = "https://github.com/Alitleis123";
const TORVALDS = "https://github.com/torvalds";
const REF = "1a67a0508e97121acea07b33eba7dc89147f9e6e";
const REPO = "https://github.com/sidebandstudio/GitHub-Reskin";
const CHOOM = "anime.cyberpunk-edgerunners";

// One record per still. scroll: T top, C contribution heading at y=96, F file header at y=96,
// DIF content.js diff header at y=96. tall: CSS px of page height for a pan source.
const page = (id, url, theme, preset, extra = {}) => ({ id: `${id}-${preset}`, kind: "page", url, theme, preset, appearance: "full", scroll: "T", ...extra });
// V is the 390 px vertical source, D the 1440 px landscape one; each film uses the shots below.
export const SHOTS = Object.freeze([
  ...["V", "D"].flatMap((p) => [
    page("P01", OWNER, null, p),
    page("P02", OWNER, CHOOM, p),
    page("P04", OWNER, "anime.evangelion", p),
    page("P06", OWNER, "anime.frieren", p),
    page("P07", BROTHER, CHOOM, p),
    page("P08", TORVALDS, "editing-suite", p),
    page("A-DS", OWNER, "anime.demon-slayer", p),
    page("A-CSM", OWNER, "anime.chainsaw-man", p),
    page("A-OP", OWNER, "anime.one-piece", p),
  ]),
  page("P05", OWNER, "anime.dandadan", "V"),
  page("A-SXF", OWNER, "anime.spy-family", "V"),
  page("P11", OWNER, CHOOM, "V", { scroll: "C" }),
  page("P06C", OWNER, "anime.frieren", "D", { scroll: "C" }),
  page("P10K", OWNER, CHOOM, "D", { appearance: "calm" }),
  page("R01", `${REPO}/tree/${REF}`, CHOOM, "D"),
  page("R02", `${REPO}/blob/${REF}/extension/content.js`, CHOOM, "D", { scroll: "F" }),
  page("R03", `${REPO}/commit/${REF}#diff-fdf8b5debf9c89396c9ca4a891fdae30f77d7ad42973678b396e799882537c56`, CHOOM, "D", { scroll: "DIF" }),
  // The popup page at its native 400x600 geometry: Reskin off with Choom Circuit chosen, then the
  // tap on the Reskin switch; the Classics group with Editing Suite; the appearance control before
  // and after Calm.
  { id: "POP-off", kind: "popup", preset: "POP", theme: CHOOM, off: true, group: "anime" },
  { id: "POP-on", kind: "popup", preset: "POP", theme: CHOOM, off: true, group: "anime", tapSwitch: true },
  { id: "POP-classics", kind: "popup", preset: "POP", theme: CHOOM, group: "classics", tap: "editing-suite" },
  { id: "POP-full", kind: "popup", preset: "POP", theme: CHOOM, group: "anime", prefs: true },
  { id: "POP-calm", kind: "popup", preset: "POP", theme: CHOOM, group: "anime", prefs: true, tapCalm: true },
]);

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function themeHash(id) {
  if (!id) return null;
  const catalog = JSON.parse(await readFile(join(ROOT, "themes/catalog.json"), "utf8"));
  const entry = catalog.find((e) => e.id === id);
  return entry ? { file: entry.file, sha256: sha256(await readFile(join(ROOT, entry.file))) } : null;
}

async function launch(dir, preset) {
  const profile = await mkdtemp(join(tmpdir(), "reskin-video-capture-"));
  const { width, height, dpr } = PRESETS[preset];
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width, height },
    deviceScaleFactor: dpr,
    locale: "en-US",
    colorScheme: "light",
    reducedMotion: "no-preference",
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  // The first-run tab opens itself after install; close it so it cannot steal a capture.
  const welcome = await context.waitForEvent("page", { predicate: (p) => p.url().includes("onboarding"), timeout: 8000 }).catch(() => null);
  await welcome?.close();
  return {
    context,
    id,
    popupUrl: `chrome-extension://${id}/pages/popup.html`,
    close: async () => {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

// Opens the popup page, waits for its picker, and returns it.
async function openPopup(browser) {
  const popup = await browser.context.newPage();
  await popup.setViewportSize({ width: PRESETS.POP.width, height: PRESETS.POP.height });
  await popup.goto(browser.popupUrl);
  await popup.waitForSelector("[data-rs=summary-show]:not(:empty)");
  await popup.waitForSelector(".rs-card");
  return popup;
}

const groupButton = (popup, group) => popup.getByRole("button", { name: new RegExp(`^${group === "anime" ? "Anime" : "Classics"}`) });

// Puts the extension in a state by using the popup's own controls: Reskin switch, theme card, Full
// or Calm, and the flavor text switch.
async function setState(browser, { theme, appearance = "full", text = true }) {
  const popup = await openPopup(browser);
  const enabled = popup.locator("[data-rs=enabled]");
  if (!theme) {
    if (await enabled.isChecked()) await enabled.uncheck();
  } else {
    if (!(await enabled.isChecked())) await enabled.check();
    await groupButton(popup, theme.startsWith("anime.") ? "anime" : "classics").click();
    const card = popup.locator(`.rs-card[data-theme="${theme}"]`);
    if ((await card.getAttribute("aria-pressed")) !== "true") await card.click();
    await popup.waitForSelector(`.rs-card[data-theme="${theme}"][aria-pressed=true]`);
    await popup.getByRole("radio", { name: appearance === "calm" ? "Calm" : "Full" }).check();
    const textSwitch = popup.locator("[data-rs=text]");
    if ((await textSwitch.count()) && (await textSwitch.isEnabled())) {
      if ((await textSwitch.isChecked()) !== text) await (text ? textSwitch.check() : textSwitch.uncheck());
    }
  }
  await popup.waitForTimeout(400);
  const settings = await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: "get", requestId: "video-get" })).settings);
  await popup.close();
  return settings;
}

async function visit(tab, url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await tab.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    if (response && response.status() < 500) {
      await tab.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
      return response.status();
    }
    await tab.waitForTimeout(10000);
  }
  throw new Error(`GitHub did not answer ${url}`);
}

const ANCHORS = {
  C: () => document.querySelector(".js-yearly-contributions h2"),
  F: () => document.querySelector("#repos-sticky-header, [data-testid=breadcrumbs-filename], .react-code-view-header, .Box-header"),
  DIF: () => [...document.querySelectorAll("[class*=diff-file-header], .file-header")].find((el) => /extension\/content\.js/.test(el.querySelector("h3, .file-info")?.textContent ?? "")),
};

// Waits for the themed paint, the contribution calendar, web fonts and images, then resolves the scroll rule.
async function settle(tab, shot) {
  if (shot.theme) await tab.waitForFunction(() => document.documentElement.getAttribute("data-reskin-boot") === "ready", null, { timeout: 20000 });
  if (/^P/.test(shot.id)) await tab.waitForSelector(".ContributionCalendar-grid, .js-calendar-graph", { timeout: 30000 }).catch(() => {});
  await tab.evaluate(() => document.fonts.ready);
  await tab.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 20000 }).catch(() => {});
  await tab.waitForTimeout(2500);
  let anchor = null;
  if (shot.scroll !== "T") {
    anchor = await tab.evaluate(`(() => { const el = (${ANCHORS[shot.scroll]})(); if (!el) return null; const top = el.getBoundingClientRect().top + scrollY; scrollTo(0, Math.max(0, Math.round(top - 96))); const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
    if (!anchor) throw new Error(`${shot.id}: no ${shot.scroll} anchor on ${shot.url}`);
  } else {
    await tab.evaluate(() => scrollTo(0, 0));
  }
  await tab.waitForTimeout(800);
  return { scrollY: await tab.evaluate(() => Math.round(scrollY)), anchor };
}

const painted = (tab) =>
  tab.evaluate(() => ({
    boot: document.documentElement.getAttribute("data-reskin-boot"),
    styled: Boolean(document.getElementById("reskin-style")?.textContent),
    cssScope: document.documentElement.getAttribute("data-reskin-css"),
    canvas: getComputedStyle(document.body).backgroundColor,
  }));

async function capturePage(browser, shot, common) {
  const settings = await setState(browser, shot);
  const tab = await browser.context.newPage();
  const status = await visit(tab, shot.url);
  const { scrollY, anchor } = await settle(tab, shot);
  const path = join(HERE, `${shot.id}.png`);
  const { width, height } = PRESETS[shot.preset];
  if (shot.tall) await tab.screenshot({ path, fullPage: true, clip: { x: 0, y: 0, width, height: shot.tall }, animations: "disabled" });
  else await tab.screenshot({ path, animations: "disabled" });
  const record = { ...common, id: shot.id, file: `${shot.id}.png`, url: shot.url, httpStatus: status, theme: shot.theme, themeSource: await themeHash(shot.theme), appearance: shot.theme ? shot.appearance : null, flavorText: shot.theme ? shot.text !== false : null, viewport: PRESETS[shot.preset], preset: shot.preset, scrollRule: shot.scroll, scrollY, anchor, pageHeight: shot.tall ?? null, state: await painted(tab), settings };
  await tab.close();
  return record;
}

async function capturePopup(browser, shot, common) {
  await setState(browser, { theme: shot.theme });
  if (shot.off) await setState(browser, { theme: null });
  const popup = await openPopup(browser);
  await groupButton(popup, shot.group).click();
  if (shot.prefs) await popup.locator(".rs-prefs").scrollIntoViewIfNeeded();
  if (shot.tap) {
    const card = popup.locator(`.rs-card[data-theme="${shot.tap}"]`);
    await card.click();
    await popup.waitForSelector(`.rs-card[data-theme="${shot.tap}"][aria-pressed=true]`);
  }
  if (shot.tapCalm) await popup.getByRole("radio", { name: "Calm" }).check();
  if (shot.tapSwitch) await popup.locator("[data-rs=enabled]").check();
  await popup.mouse.move(0, 0);
  await popup.waitForTimeout(700);
  const path = join(HERE, `${shot.id}.png`);
  await popup.screenshot({ path, animations: "disabled" });
  // Card and control boxes, so a composition can place a tap marker over the real control.
  const boxes = await popup.evaluate(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; };
    return {
      choom: box(document.querySelector('.rs-card[data-theme="anime.cyberpunk-edgerunners"]')),
      editingSuite: box(document.querySelector('.rs-card[data-theme="editing-suite"]')),
      classics: box([...document.querySelectorAll("[data-rs=groups] button")].find((b) => /^Classics/.test(b.textContent))),
      calm: box(document.querySelector('input[name=appearance][value=calm]')?.closest("label")),
      enabled: box(document.querySelector("[data-rs=enabled]")?.closest("label")),
    };
  });
  const settings = await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: "get", requestId: "video-get" })).settings);
  await popup.close();
  return { ...common, id: shot.id, file: `${shot.id}.png`, url: "chrome-extension://<id>/pages/popup.html", extensionId: browser.id, theme: settings.selectedThemeId, themeSource: await themeHash(settings.selectedThemeId), appearance: settings.preferences.appearance, viewport: PRESETS.POP, preset: "POP", group: shot.group, tapped: shot.tap ?? (shot.tapCalm ? "calm" : shot.tapSwitch ? "enabled" : null), enabled: settings.enabled, boxes, settings };
}

async function main() {
  const { values } = parseArgs({ options: { extension: { type: "string", default: join(ROOT, "dist/chrome") }, only: { type: "string" } } });
  const dir = resolve(values.extension);
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const only = values.only ? new Set(values.only.split(",")) : null;
  const shots = SHOTS.filter((s) => !only || only.has(s.id));
  const dirty = git("status", "--porcelain", "--", "extension", "packages", "themes").length > 0;
  for (const preset of Object.keys(PRESETS)) {
    const batch = shots.filter((s) => s.preset === preset);
    if (!batch.length) continue;
    const browser = await launch(dir, preset);
    try {
      const common = {
        captured: new Date().toISOString(),
        browser: `Chromium ${browser.context.browser()?.version() ?? ""}`.trim(),
        extension: { name: manifest.name, version: manifest.version, commit: git("rev-parse", "HEAD"), sourceDirty: dirty, package: "npm run build:stores, dist/chrome unpacked" },
        session: "fresh logged-out profile, en-US, light color scheme, 100% zoom",
      };
      for (const shot of batch) {
        const record = shot.kind === "popup" ? await capturePopup(browser, shot, common) : await capturePage(browser, shot, common);
        record.sha256 = sha256(await readFile(join(HERE, record.file)));
        await writeFile(join(HERE, `${shot.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
        console.log(`${shot.id}: ${record.url} ${record.theme ?? "native"} ${record.appearance ?? ""} scrollY=${record.scrollY ?? "-"}`);
      }
    } finally {
      await browser.close();
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
