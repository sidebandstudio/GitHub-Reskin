// The built site in a real browser: the 390x844 first screen with the anime-first chooser, a tap
// that counts before the page script runs, 320px reflow, selection that keeps focus and scroll,
// the live preview (C5 mountPreview) loaded on intent with the extension's hashes and the same
// document C5's own fixture app renders, views, Before/After and Full/Calm, stable gallery geometry,
// the phone handoff, clipboard fallbacks, the no-JS first paint, deep links, reduced motion, the
// importer with Advanced CSS consent and its error handling, shared links, the 404 page and requests.
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base } from "../../helpers/e2e.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SITE = process.env.RESKIN_SITE_DIR || join(ROOT, "dist/site");
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const manifest = () => JSON.parse(readFileSync(join(ROOT, "site/.cache/previews/manifest.json"), "utf8"));
const CHOOM = JSON.parse(readFileSync(join(ROOT, "themes/anime/choom-circuit.reskin.json"), "utf8"));
const FULL = { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true };

export const test = base.extend({
  site: [
    async ({ serveDir }, use) => {
      if (!existsSync(join(SITE, "index.html"))) throw new Error(`No built site at ${SITE}. Run npm run build:site or use npm run test:e2e -- --surface=site.`);
      await use((await serveDir(SITE, { base: "/GitHub-Reskin" })).url);
    },
    { scope: "worker" },
  ],
});

// The page scrolls smoothly; this waits until scrolling has stopped and returns the position.
async function restingScroll(page) {
  let last = -1;
  for (;;) {
    const now = await page.evaluate(() => new Promise((resolve) => setTimeout(() => resolve(window.scrollY), 120)));
    if (now === last) return now;
    last = now;
  }
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const host = (page, scope = "[data-window]") => page.locator(`${scope} [data-live] [data-reskin-preview]`);
// Starts the live preview the way a visitor does, and waits for its first frame.
async function goLive(page, touch = false) {
  await page.locator("[data-window]").first().dispatchEvent(touch ? "touchstart" : "pointerenter");
  await expect(page.locator('[data-window][data-preview="live"]')).toHaveCount(1, { timeout: 20000 });
}
// Waits until the live preview has completed every request made so far.
async function settled(page, scope) {
  await expect.poll(() => host(page, scope).evaluate((node) => node.dataset.completed === node.dataset.requested && !node.hasAttribute("data-error")), { timeout: 20000 }).toBe(true);
}
// Replaces the clipboard so both browsers can test success and refusal.
const stubClipboard = (page, accept) =>
  page.addInitScript((ok) => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text) => (ok ? ((window.__copied = text), Promise.resolve()) : Promise.reject(new Error("denied"))) } });
  }, accept);

test.describe("phone first screen", () => {
  test.use(PHONE);

  test("shows the product, the selected anime, a themed preview, its controls and the Keep action at 390x844", async ({ page, site }) => {
    await page.goto(site);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Your GitHub.\s*Your world./);
    const chooser = page.locator("[data-picker] > summary");
    await expect(chooser).toContainText("Cyberpunk: Edgerunners");
    await expect(chooser).toContainText("Choom Circuit");
    await expect(chooser).toBeInViewport();
    const shot = page.locator("[data-shot-img]");
    await expect.poll(() => shot.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect((await page.locator("[data-window]").boundingBox()).y).toBeLessThan(844 - 300);
    const before = await page.locator('input[name="before"][value="before"]').locator("..").boundingBox();
    expect(before.y + before.height).toBeLessThan(844);
    const keep = await page.locator(".hero-keep [data-open-keep]").boundingBox();
    expect(keep.y + keep.height).toBeLessThanOrEqual(844);
    await expect(page.locator(".hero-keep .hero-compat")).toContainText("Chrome and Firefox on desktop");
    expect(await noOverflow(page)).toBe(true);
    await expect(page.locator(".nav .for-touch")).toBeVisible();
    await expect(page.locator(".nav .for-touch")).toHaveText("Keep for desktop");
  });

  test("the chooser opens over the preview with all 13 anime and the Classics, and a choice applies in place", async ({ page, site }) => {
    await page.goto(site);
    const chooser = page.locator("[data-picker]");
    await chooser.locator("> summary").click();
    const options = chooser.locator(".drop-panel > .picker-list .pick");
    await expect(options).toHaveCount(13);
    await expect(options.first().locator(".pick-title")).toHaveText("Cyberpunk: Edgerunners");
    await expect(chooser.locator(".picker-classics > summary")).toHaveText("Plus 12 Classics");
    await chooser.getByRole("link", { name: /Frieren: Beyond Journey's End/ }).click();
    await expect(chooser).not.toHaveAttribute("open", "");
    await expect(chooser.locator("> summary")).toContainText("Frieren: Beyond Journey's End");
    await expect(chooser.locator("> summary")).toContainText("Longroad Petals");
    expect(new URL(page.url()).pathname).toBe("/GitHub-Reskin/themes/longroad-petals/");
    await expect(chooser.locator("> summary")).toBeInViewport();
    await expect(page.locator('.drop-panel [data-select="longroad-petals"]')).toHaveAttribute("aria-current", "true");
  });

  test("a tap made before the page script runs still lands on the chosen theme", async ({ page, site }) => {
    // Hold the page script back, as a slow connection would.
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await page.route(/_assets\/.*\.js$/, async (route) => {
      await held;
      await route.continue();
    });
    // Module scripts hold back DOMContentLoaded, so the page is used as soon as it has painted.
    await page.goto(site, { waitUntil: "commit" });
    await page.locator("[data-picker] > summary").click();
    await page.locator('.drop-panel [data-select="violet-synchrony"]').click();
    await page.waitForURL(/themes\/violet-synchrony\/#preview$/, { waitUntil: "commit" });
    release();
    await expect(page.locator("[data-picker] > summary")).toContainText("Neon Genesis Evangelion");
    await expect(page.locator("h1")).toHaveText("Neon Genesis Evangelion theme for GitHub");
  });

  test("Keep this theme for desktop gives the canonical link, copies only on success and restores focus", async ({ page, site }) => {
    await stubClipboard(page, false);
    await page.goto(`${site}themes/longroad-petals/`);
    const opener = page.locator(".hero-keep [data-open-keep]");
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "Keep this theme for desktop" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Theme link")).toHaveValue("https://sidebandstudio.github.io/GitHub-Reskin/themes/longroad-petals/");
    await expect(sheet).toContainText("Pick Longroad Petals in Reskin after installing");
    await sheet.getByRole("button", { name: "Copy link" }).click();
    await expect(sheet.getByRole("status")).toContainText("Copy is not available here");
    await expect(sheet.getByRole("status")).not.toContainText("copied");
    await expect(sheet.getByLabel("Theme link")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("Copy link reports success after the clipboard accepts it", async ({ page, site }) => {
    await stubClipboard(page, true);
    await page.goto(site);
    await page.locator(".hero-keep [data-open-keep]").click();
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.locator("[data-keep-status]")).toHaveText("Link copied");
    expect(await page.evaluate(() => window.__copied)).toBe("https://sidebandstudio.github.io/GitHub-Reskin/themes/choom-circuit/");
  });

  test("pages without a selected theme lead touch visitors back to the themes, and the install section puts the phone path first", async ({ page, site }) => {
    for (const path of ["make/", "privacy/", "install/"]) {
      await page.goto(`${site}${path}`);
      await expect(page.locator(".nav .for-touch")).toHaveText("Try the themes");
      await expect(page.locator(".nav .for-touch")).toHaveAttribute("href", "/GitHub-Reskin/#preview");
    }
    await page.goto(`${site}#install`);
    const phone = await page.locator("[data-phone-path]").boundingBox();
    const chrome = await page.locator('[data-browser="chrome"]').boundingBox();
    expect(phone.y).toBeLessThan(chrome.y);
  });
});

test("reflows at 320px without page-wide horizontal scrolling", async ({ page, site }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["", "themes/sunward-voyage/", "make/", "share/", "install/", "privacy/", "credits/", "404.html"]) {
    await page.goto(`${site}${path}`);
    expect(await noOverflow(page), path).toBe(true);
  }
});

test("the live preview loads only when a visitor reaches for it, in a scriptless opaque frame, with the extension's hashes", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(site, { waitUntil: "networkidle" });
  expect(requests.filter((path) => /\/(engine|authoring)\.[^/]*\.js$/.test(path))).toEqual([]);
  await goLive(page);
  expect(requests.some((path) => /\/engine\.[^/]*\.js$/.test(path))).toBe(true);
  expect(requests.some((path) => /\/authoring\.[^/]*\.js$/.test(path))).toBe(false);
  const frame = page.locator("[data-live] iframe:not([aria-hidden])");
  await expect(frame).toHaveAttribute("sandbox", "");
  expect(await frame.getAttribute("srcdoc")).toContain("default-src 'none'");
  const choom = manifest().themes["choom-circuit"];
  await expect(host(page)).toHaveAttribute("data-source-hash", choom.sourceHash);
  await expect(host(page)).toHaveAttribute("data-seed-hash", choom.seedHash);
  await expect(host(page)).toHaveAttribute("data-fingerprint", choom.fingerprint);
  await expect(page.locator(".window-shot")).toBeHidden();
});

test("the site's live preview is the same document C5's fixture app renders for Choom Circuit", async ({ page, browser, site, serveDir }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(site);
  await goLive(page);
  await settled(page);
  const width = Math.round((await page.locator(".window-live").boundingBox()).width);
  const siteDoc = await page.locator("[data-live] iframe:not([aria-hidden])").getAttribute("srcdoc");

  const tmp = await mkdtemp(join(tmpdir(), "reskin-site-parity-"));
  try {
    const { buildFixtureApp } = await import("../../fixture-app/product/build.mjs");
    const app = await serveDir(await buildFixtureApp({ root: ROOT, outDir: tmp }));
    const other = await browser.newPage({ viewport: { width, height: 900 } });
    await other.goto(`${app.url}preview.html`);
    await other.waitForFunction(() => window.reskinPreview);
    await other.evaluate(({ theme, preferences }) => window.reskinPreview.mount({ view: "profile", theme, preferences }), { theme: CHOOM, preferences: FULL });
    await expect.poll(() => other.evaluate(() => document.querySelector("#preview [data-reskin-preview]")?.dataset.completed), { timeout: 20000 }).toBe("1");
    const fixtureDoc = await other.evaluate(() => window.reskinPreview.srcdoc());
    expect(siteDoc.length).toBeGreaterThan(1000);
    expect(siteDoc === fixtureDoc).toBe(true);
    await other.close();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("a theme option updates the preview, title, URL and labels without moving focus or scroll", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(site);
  await goLive(page);
  const option = page.locator('.picker-side [data-select="longroad-petals"]');
  await option.focus();
  const scrollY = await restingScroll(page);
  await page.keyboard.press("Enter");
  await expect(option).toHaveAttribute("aria-current", "true");
  await expect(option).toBeFocused();
  expect(await restingScroll(page)).toBe(scrollY);
  await expect(page.locator('.viewer-head [data-selected="title"]')).toHaveText("Frieren: Beyond Journey's End");
  await expect(page.locator('.viewer-head [data-selected="themeFor"]')).toHaveText("Longroad Petals · Frieren: Beyond Journey's End theme for GitHub");
  expect(new URL(page.url()).pathname).toBe("/GitHub-Reskin/themes/longroad-petals/");
  await expect(page).toHaveTitle("Frieren: Beyond Journey's End theme for GitHub: Longroad Petals · GitHub Reskin");
  await expect(page.locator('.picker-side [data-select="choom-circuit"]')).not.toHaveAttribute("aria-current", "true");
  await expect(host(page)).toHaveAttribute("data-source-hash", manifest().themes["longroad-petals"].sourceHash);
  await settled(page);
});

test("Profile, Code and Diff, Before/After and Full/Calm drive the live preview", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(site);
  await goLive(page);
  await page.locator(".seg label", { hasText: "Code" }).click();
  await expect(host(page)).toHaveAttribute("data-view", "repo");
  await page.locator(".seg label", { hasText: "Diff" }).click();
  await expect(host(page)).toHaveAttribute("data-view", "diff");
  await page.locator(".seg label", { hasText: "Before" }).click();
  await expect(host(page)).toHaveAttribute("data-before", "true");
  await page.locator(".seg label", { hasText: "After" }).click();
  await expect(host(page)).toHaveAttribute("data-before", "false");
  await page.locator(".seg label", { hasText: "Profile" }).click();
  await settled(page);
  const full = await host(page).getAttribute("data-fingerprint");
  const owned = Number(await host(page).getAttribute("data-owned-nodes"));
  expect(owned).toBeGreaterThan(0);
  await page.locator(".seg label", { hasText: "Calm" }).click();
  await expect(host(page)).not.toHaveAttribute("data-fingerprint", full);
  await settled(page);
  expect(Number(await host(page).getAttribute("data-owned-nodes"))).toBeLessThan(owned);
});

test("a control chosen while the live preview loads is kept and applied", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route(/\/engine\.[^/]*\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(site);
  await page.locator(".seg label", { hasText: "Diff" }).click();
  await expect(page.locator("[data-pending]")).toBeVisible();
  release();
  await expect(host(page)).toHaveAttribute("data-view", "diff", { timeout: 20000 });
  await expect(page.locator("[data-pending]")).toBeHidden();
});

test("gallery Preview updates the hero and keeps focus; Classics open and work; nothing moves under the pointer", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(site);
  const button = page.locator('[data-card="sunward-voyage"] [data-theme]');
  await button.scrollIntoViewIfNeeded();
  const scrollY = await restingScroll(page);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toBeFocused();
  expect(await restingScroll(page)).toBe(scrollY);
  await expect(page.locator('.viewer-head [data-selected="title"]')).toHaveText("One Piece");
  await page.locator("#classics > summary").click();
  // The review's missed activation: Editing Suite, then Dracula, by mouse.
  const editing = page.locator('[data-card="editing-suite"] [data-theme]');
  const dracula = page.locator('[data-card="dracula"] [data-theme]');
  await editing.scrollIntoViewIfNeeded();
  await editing.click();
  const at = await dracula.boundingBox();
  await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
  await expect(dracula).toHaveAttribute("aria-pressed", "true");
  expect(await dracula.boundingBox()).toEqual(at);
  await expect(page.locator('.viewer-head [data-selected="title"]')).toHaveText("Dracula");
  await expect(page.locator('.viewer-head [data-selected="themeFor"]')).toHaveText("Dracula, a Classic theme for GitHub");
});

test("View in preview selects the theme and jumps to the preview", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(site);
  await page.locator('[data-jump="wallward-scout"]').click();
  await expect(page.locator('.viewer-head [data-selected="title"]')).toHaveText("Attack on Titan");
  await expect(page.locator("[data-window]")).toBeInViewport();
});

test("the Full and Calm comparison follows the selected theme", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(site);
  await page.locator('[data-card="occult-orbit"] [data-theme]').click();
  const entry = manifest().themes["occult-orbit"];
  await expect(page.locator('[data-compare="full"]')).toHaveAttribute("src", `/GitHub-Reskin/previews/${entry.phone.file}`);
  await expect(page.locator('[data-compare="calm"]')).toHaveAttribute("src", `/GitHub-Reskin/previews/${entry.calm.file}`);
});

test("Copy AI prompt says copied only after success and otherwise shows the prompt to select", async ({ page, site }) => {
  await stubClipboard(page, false);
  await page.goto(site);
  await page.getByRole("button", { name: "Copy AI prompt" }).click();
  await expect(page.locator("[data-copy-status]")).toContainText("Copy is not available here");
  await expect(page.getByLabel("Select prompt")).toBeVisible();
  await expect(page.getByLabel("Select prompt")).toBeFocused();
  expect(await page.getByLabel("Select prompt").inputValue()).toContain("schemaVersion");
});

test("Copy AI prompt reports Prompt copied after the clipboard accepts it, and the teaser names where to paste", async ({ page, site }) => {
  await stubClipboard(page, true);
  await page.goto(site);
  await page.getByRole("button", { name: "Copy AI prompt" }).click();
  await expect(page.locator("[data-copy-status]")).toContainText("Prompt copied");
  expect(await page.evaluate(() => window.__copied)).toContain("Create ONE rich GitHub Reskin theme");
  await expect(page.getByRole("link", { name: "Paste your chatbot answer" })).toHaveAttribute("href", "/GitHub-Reskin/make/#answer");
  await expect(page.getByRole("link", { name: "Try a sample answer" })).toHaveAttribute("href", "/GitHub-Reskin/make/#sample");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("each theme page shows the shared preview's capture of its theme and its anime first", async ({ page, site }) => {
    await page.goto(`${site}themes/peanut-dossier/`);
    const shot = page.locator("[data-shot-img]");
    await expect.poll(() => shot.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(shot).toHaveAttribute("data-source-hash", manifest().themes["peanut-dossier"].sourceHash);
    await expect(page.locator("h1")).toHaveText("Spy x Family theme for GitHub");
    await expect(page.getByText("Switching themes in place needs JavaScript")).toBeVisible();
    await expect(page.locator(".viewer-controls")).toBeHidden();
  });
});

test("deep links, the live preview, the importer and shared links load only from the base path", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const origin = new URL(site).origin;
  const requests = [];
  const failures = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => response.status() >= 400 && failures.push(`${response.status()} ${response.url()}`));
  for (const path of ["themes/choom-circuit/", "themes/solarized-light/", "share/#RS1.abc.00000000", "install/", "privacy/", "credits/", "changelog/", "404.html"]) {
    await page.goto(`${site}${path}`, { waitUntil: "networkidle" });
  }
  await page.goto(site);
  await goLive(page);
  await page.goto(`${site}make/`);
  await page.getByRole("button", { name: "Use a sample answer" }).click();
  await expect(page.locator('[data-window][data-preview="live"]')).toHaveCount(1, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  expect(failures).toEqual([]);
  expect(requests.filter((url) => !url.startsWith("data:") && new URL(url).origin !== origin)).toEqual([]);
  for (const url of requests.filter((u) => u.startsWith(origin))) expect(new URL(url).pathname.startsWith("/GitHub-Reskin/"), url).toBe(true);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("a newly selected theme plays no motion", async ({ page, site }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(site);
    await goLive(page);
    await page.locator('.picker-side [data-select="occult-orbit"]').click();
    await settled(page);
    await expect(host(page)).toHaveAttribute("data-playing", "0");
  });
});

test("the importer previews a sample with Advanced CSS off until chosen, and keeps the last valid preview on errors", async ({ page, site }) => {
  await page.goto(`${site}make/`);
  await page.getByRole("button", { name: "Use a sample answer" }).click();
  await expect(page.locator("[data-import-status]")).toHaveText("Theme ready to preview.");
  await expect(page.locator("[data-make-name]")).toHaveText("Original night-radio palette: Midnight signal");
  const review = page.locator("[data-css-review]");
  await expect(review).toBeVisible();
  await expect(review).toContainText("Advanced CSS changes GitHub's appearance and can break layout or reduce readability. Reskin blocks outside resources and unsupported rules, but cannot guarantee every GitHub page. Review the preview and CSS before enabling it. Calm turns it off.");
  const enable = page.getByLabel("Enable advanced CSS in this preview");
  await expect(enable).not.toBeChecked();
  await enable.check();
  await expect(page.locator("[data-import-status]")).toHaveText("Advanced CSS is enabled in this preview.");
  await expect(page.locator("[data-css-note]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download Midnight signal" })).toBeVisible();

  const answer = page.getByLabel("Chatbot answer");
  await answer.fill("{ nope");
  await page.getByRole("button", { name: "Preview theme" }).click();
  const error = page.locator("[data-import-error]");
  await expect(error).toBeVisible();
  await expect(answer).toHaveAttribute("aria-invalid", "true");
  const message = await error.textContent();
  await expect(page.locator("[data-import-issues] li", { hasText: message })).toHaveCount(0);
  await expect(page.locator("[data-make-name]")).toHaveText("Previous valid preview: Midnight signal");
  await expect(page.getByRole("button", { name: "Download Midnight signal" })).toBeVisible();
});

test("the image and CSS limits are stated before import", async ({ page, site }) => {
  await page.goto(`${site}make/`);
  await page.locator(".limits > summary").click();
  await expect(page.locator(".limits")).toContainText("at most 128 KiB each, 256 KiB for all images in a theme");
  await expect(page.locator(".limits")).toContainText("6,291,456 pixels in all");
  await expect(page.locator(".limits")).toContainText("Advanced CSS is at most 32 KiB");
});

test("a copied preview link opens on the share page with Advanced CSS off", async ({ page, site }) => {
  await stubClipboard(page, true);
  await page.goto(`${site}make/`);
  await page.getByRole("button", { name: "Use a sample answer" }).click();
  await expect(page.locator("[data-import-status]")).toHaveText("Theme ready to preview.");
  await page.getByRole("button", { name: "Copy preview link" }).click();
  await expect(page.locator("[data-export-status]")).toContainText("Preview link copied");
  const link = await page.evaluate(() => window.__copied);
  expect(link).toMatch(/^https:\/\/sidebandstudio\.github\.io\/GitHub-Reskin\/share\/#RS1\./);
  await page.goto(`${site}share/${new URL(link).hash}`);
  await expect(page.locator("[data-share-name]")).toHaveText("Original night-radio palette: Midnight signal");
  await expect(page.getByLabel("Enable advanced CSS in this preview")).not.toBeChecked();
  await expect(page.locator('[data-window][data-preview="live"]')).toHaveCount(1, { timeout: 20000 });
  await expect(page.getByRole("button", { name: "Download Midnight signal" })).toBeVisible();
});

test("a damaged share code says so", async ({ page, site }) => {
  await page.goto(`${site}share/#RS1.abc.00000000`);
  await expect(page.locator("[data-share-name]")).toHaveText("This share code can't be read");
});

test("the 404 page offers the themes", async ({ page, site }) => {
  await page.goto(`${site}404.html`);
  await expect(page.locator("h1")).toHaveText("This theme link isn't here.");
  await page.getByRole("link", { name: "Try the themes" }).click();
  await expect(page).toHaveURL(/\/GitHub-Reskin\/#preview$/);
});

test("install shows honest per-browser states with every browser reachable", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(site);
  const install = page.locator("#install");
  await expect(install.getByText("Store listing coming soon")).toHaveCount(2);
  for (const name of ["Chrome", "Firefox", "Safari"]) await expect(install.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(install.locator('a[href*="chromewebstore"], a[href*="addons.mozilla.org"]')).toHaveCount(0);
  await expect(install.locator(".browser.is-likely")).toHaveCount(1);
});
