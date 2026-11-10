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
import { encodeShare } from "../../../packages/format/viewer.js";
import { makeAiPrompt } from "../../../packages/format/index.js";
import { FONT_BY_ID } from "../../../packages/appearance/registry.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SITE = process.env.RESKIN_SITE_DIR || join(ROOT, "dist/site");
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const manifest = () => JSON.parse(readFileSync(join(ROOT, "site/.cache/previews/manifest.json"), "utf8"));
const CHOOM = JSON.parse(readFileSync(join(ROOT, "themes/anime/choom-circuit.reskin.json"), "utf8"));
const FULL = { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true };
const NORD = JSON.parse(readFileSync(join(ROOT, "themes/classics/nord.reskin.json"), "utf8"));

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
// Null when the page does not scroll sideways. Otherwise both widths and each box that starts the
// overflow: an element or text past the right edge whose parent is not, under no clipping ancestor
// below the body.
const sidewaysOverflow = (page) =>
  page.evaluate(() => {
    const { scrollWidth, clientWidth } = document.documentElement;
    if (scrollWidth <= clientWidth) return null;
    const past = (rect) => rect.width > 0 && rect.right > clientWidth + 0.5;
    const name = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + [...el.classList].map((c) => `.${c}`).join("");
    const where = (rect) => `at ${Math.round(rect.left)}-${Math.round(rect.right)}px, ${Math.round(rect.width)}px wide`;
    const words = (text) => JSON.stringify(text.replace(/\s+/g, " ").trim().slice(0, 40));
    const found = [];
    const visit = (el) => {
      // The body's overflow belongs to the viewport, so its overflow-x: clip does not stop this.
      const style = getComputedStyle(el);
      if (el !== document.body && (style.overflowX !== "visible" || style.clip !== "auto")) return;
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.data.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          if (past(rect)) found.push(`text ${words(node.data)} in ${name(el)} ${where(rect)}`);
        } else if (node.nodeType === Node.ELEMENT_NODE && getComputedStyle(node).position !== "fixed") {
          const rect = node.getBoundingClientRect();
          if (past(rect)) found.push(`${name(node)} ${words(node.textContent)} ${where(rect)} in ${name(el)}`);
          else visit(node);
        }
      }
    };
    visit(document.body);
    return `scrollWidth ${scrollWidth}px > clientWidth ${clientWidth}px; ${found.join("; ") || "no single box past the edge"}`;
  });
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
    expect(await sidewaysOverflow(page)).toBeNull();
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
    expect(await sidewaysOverflow(page), `/${path} at 320px`).toBeNull();
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
    // The site asks for the compact phone composition, which changes nothing in a wide layout.
    await other.evaluate(({ theme, preferences }) => window.reskinPreview.mount({ view: "profile", theme, preferences, cssAllowed: true, compact: true }), { theme: CHOOM, preferences: FULL });
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
  const slots = JSON.parse(readFileSync(join(ROOT, "themes/anime/occult-orbit.reskin.json"), "utf8")).flavor.slots;
  await expect(page.locator('[data-selected="lines"] dd').first()).toHaveText(slots["profile.tag"]);
  await page.locator('[data-card="choom-circuit"] [data-theme]').click();
  await expect(page.locator('[data-selected="lines"] dd')).toHaveText(["// choom", "Preem picks", "Gig log", "Street cred", "Crews", "// stay preem, choom"]);
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
  expect(await page.evaluate(() => window.__copied)).toBe(makeAiPrompt());
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
  // The sample's rule targets .AppHeader, a GitHub element on C3b's reviewed list: the extension
  // applies it behind admission, and the preview, which writes no admission markers, does not.
  await expect(page.locator("[data-css-note]")).toHaveText(/also styles parts of GitHub itself.*apply on the pages Reskin has reviewed.*This preview shows only/);

  // A rule for anything off the reviewed list fails the whole CSS closed everywhere.
  const unreviewed = JSON.stringify({ ...JSON.parse(readFileSync(join(ROOT, "tests/fixtures/schema/valid/ai-rich.reskin.json"), "utf8")), css: ".markdown-body p { color: red; }" });
  await page.getByLabel("Chatbot answer").fill(unreviewed);
  await page.getByRole("button", { name: "Preview theme" }).click();
  await expect(page.locator("[data-css-note]")).toHaveText(/has not reviewed, so Reskin rejects all of it/);
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

// The site paths of every reviewed weight of a theme's heading and body families.
const fontFiles = (theme) => [...new Set([theme.fonts?.heading, theme.fonts?.body])].filter((id) => FONT_BY_ID[id]).flatMap((id) => FONT_BY_ID[id].files.map((file) => `/GitHub-Reskin/${file.path}`)).sort();
const fontRequests = (page) => {
  const seen = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(".woff2")) seen.push(url);
  });
  return seen;
};
const theme = (slug) => JSON.parse(readFileSync(join(ROOT, `themes/anime/${slug}.reskin.json`), "utf8"));

test("the live preview loads the shown theme's heading and body fonts from the site's own files, only once a visitor reaches for it", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fonts = fontRequests(page);
  const all = fontRequests(page);
  await page.goto(site, { waitUntil: "networkidle" });
  // First paint is a picture: the site's own face only.
  expect(fonts.map((url) => url.pathname)).toEqual([expect.stringMatching(/^\/GitHub-Reskin\/_assets\/manrope-latin\.[^/]+\.woff2$/)]);
  fonts.length = 0;
  await goLive(page);
  await settled(page);
  expect(fonts.map((url) => url.pathname).sort()).toEqual(fontFiles(CHOOM));
  // A switch loads only the new theme's families; Calm keeps the same fonts and loads nothing.
  fonts.length = 0;
  await page.locator('[data-card="sunward-voyage"] [data-theme]').click();
  await settled(page);
  expect(fonts.map((url) => url.pathname).sort()).toEqual(fontFiles(theme("sunward-voyage")));
  fonts.length = 0;
  await page.locator(".seg label", { hasText: "Calm" }).click();
  await settled(page);
  expect(fonts).toEqual([]);
  expect(fontFiles(theme("sunward-voyage")).some((path) => path.includes("/fraunces/"))).toBe(true);
  for (const url of all) expect(url.origin).toBe(new URL(site).origin);
});

test("Calm drops a theme's backgrounds, paper texture and effects, and keeps its fonts", async ({ page, site }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${site}themes/longroad-petals/`);
  await goLive(page);
  await settled(page);
  // The newest styled frame: an update replaces it, so both can be present for a moment.
  const styled = () => page.locator("[data-live] iframe:not([aria-hidden])").last().getAttribute("srcdoc");
  const faces = (doc) => doc.match(/@font-face\{[^}]*\}/g) ?? [];
  const full = await styled();
  expect(full).toMatch(/gradient\(/);
  expect(faces(full).some((face) => face.includes('"Reskin Alegreya"'))).toBe(true);
  await page.locator(".seg label", { hasText: "Calm" }).click();
  await expect.poll(async () => (await styled()) !== full).toBe(true);
  await settled(page);
  const calm = await styled();
  expect(calm).not.toMatch(/gradient\(/);
  expect(faces(calm)).toEqual(faces(full));
});

test("a theme file with fonts, gradient and image layers and CSS imports and shares with its image and CSS disclosures", async ({ page, site }) => {
  await stubClipboard(page, true);
  const images = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/schema/valid/embedded-images.reskin.json"), "utf8"));
  const doc = {
    ...images,
    name: "Lantern harbor",
    inspiredBy: "An original harbor at dusk",
    fonts: { heading: "fraunces", body: "barlow" },
    backgrounds: {
      ...images.backgrounds,
      page: { layers: [{ gradient: { type: "linear", angle: 180, stops: [{ color: "#e9dfc8", position: 0 }, { color: "#f6f2e8", position: 100 }], opacity: 0.6 } }, ...images.backgrounds.page.layers] },
    },
    css: '[data-reskin-slot="profile.tag"] { letter-spacing: 0.02em; }',
  };
  const fonts = fontRequests(page);
  await page.goto(`${site}make/`);
  await page.locator("[data-file]").setInputFiles({ name: "lantern-harbor.reskin.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.locator("[data-import-status]")).toHaveText("Theme ready to preview.");
  await expect(page.locator("[data-make-name]")).toHaveText("An original harbor at dusk: Lantern harbor");
  await expect(page.locator("[data-images]")).toHaveText(/^This theme embeds 3 images, .* in all\. Its file and preview link include them, and anyone you share them with can save them\.$/);
  await expect(page.locator("[data-css-review]")).toBeVisible();
  await expect(page.getByLabel("Enable advanced CSS in this preview")).not.toBeChecked();
  await expect(page.locator('[data-window][data-preview="live"]')).toHaveCount(1, { timeout: 20000 });
  await settled(page);
  // Beside the site's own face, which the page itself uses.
  expect(fonts.map((url) => url.pathname).filter((path) => path.startsWith("/GitHub-Reskin/assets/fonts/")).sort()).toEqual(fontFiles(doc));
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Lantern harbor" }).click();
  const saved = JSON.parse(readFileSync(await (await download).path(), "utf8"));
  expect(saved.fonts).toEqual(doc.fonts);
  expect(saved.backgrounds.page.layers).toHaveLength(2);

  await page.getByRole("button", { name: "Copy preview link" }).click();
  await expect(page.locator("[data-export-status]")).toContainText("Preview link copied");
  const link = await page.evaluate(() => window.__copied);
  await page.goto(`${site}share/${new URL(link).hash}`);
  await expect(page.locator("[data-share-name]")).toHaveText("An original harbor at dusk: Lantern harbor");
  await expect(page.locator("[data-images]")).toHaveText("This theme embeds 3 images. Its file and share code include them.");
  await expect(page.locator("[data-css-review]")).toBeVisible();
  await expect(page.getByLabel("Enable advanced CSS in this preview")).not.toBeChecked();
  await expect(page.locator('[data-window][data-preview="live"]')).toHaveCount(1, { timeout: 20000 });
  await settled(page);
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

// The phone window holds the profile's name and tag, one pinned repository and the contribution
// graph through its legend: in the first paint and in the live preview, at both common widths.
for (const size of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test.describe(`phone preview at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size, isMobile: true, hasTouch: true });

    test("the window shows the name and tag, a pinned repository and the contribution graph, before and after the live preview loads", async ({ page, site }) => {
      await page.goto(site);
      const window = await page.locator("[data-window]").boundingBox();
      const keep = await page.locator(".hero-keep [data-open-keep]").boundingBox();
      expect(keep.y + keep.height).toBeLessThanOrEqual(size.height);
      // First paint: the capture is the window's own shape, so nothing of it is cropped, and the
      // build recorded that it holds the repository and the legend.
      const shot = page.locator("[data-shot-img]");
      await expect.poll(() => shot.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
      const ratio = await shot.evaluate((img) => img.naturalHeight / img.naturalWidth);
      expect(Math.abs(ratio - window.height / window.width)).toBeLessThan(0.01);
      expect(manifest().themes["choom-circuit"].phone.shows).toEqual({ pinned: true, legend: true });

      await goLive(page, true);
      await settled(page);
      const { window: live, parts } = await page.locator("[data-live] iframe[aria-hidden]").evaluate((frame) => {
        const at = (selector) => {
          const r = frame.contentDocument.querySelector(selector).getBoundingClientRect();
          const f = frame.getBoundingClientRect();
          return { top: f.top + r.top, bottom: f.top + r.bottom, height: r.height };
        };
        const w = document.querySelector("[data-window]").getBoundingClientRect();
        return {
          window: { top: w.top, bottom: w.bottom },
          parts: { name: at(".vcard-names"), tag: at('[data-reskin-slot="profile.tag"]'), repository: at(".pinned-item-list-item"), graph: at(".ContributionCalendar-grid"), legend: at(".ContributionCalendar-legend") },
        };
      });
      for (const [part, box] of Object.entries(parts)) {
        expect(box.height, part).toBeGreaterThan(0);
        expect(box.top, part).toBeGreaterThanOrEqual(live.top);
        expect(box.bottom, part).toBeLessThanOrEqual(live.bottom);
      }
      expect(await sidewaysOverflow(page)).toBeNull();

      // The whole page is the whole profile again.
      await page.locator("[data-expand]").click();
      await settled(page);
      const bio = await page.locator("[data-live] iframe[aria-hidden]").evaluate((frame) => frame.contentDocument.querySelector(".user-profile-bio").getBoundingClientRect().height);
      expect(bio).toBeGreaterThan(0);
      expect(await sidewaysOverflow(page)).toBeNull();
    });
  });
}

test.describe("theme switching on a phone", () => {
  test.use(PHONE);

  test("a theme page's heading, lede and description follow every switch, and the home page keeps its own heading", async ({ page, site }) => {
    await page.goto(`${site}themes/choom-circuit/`);
    const heading = page.locator("h1");
    await expect(heading).toHaveText("Cyberpunk: Edgerunners theme for GitHub");
    const choose = async (slug) => {
      await page.locator("[data-picker] > summary").click();
      if (slug === "nord") await page.locator(".drop-panel .picker-classics > summary").click();
      await page.locator(`.drop-panel [data-select="${slug}"]`).click();
    };
    await choose("longroad-petals");
    await expect(heading).toHaveText("Frieren: Beyond Journey's End theme for GitHub");
    await expect(page.locator(".hero-lede")).toHaveText("Longroad Petals, one of 13 anime themes in GitHub Reskin, a free extension that re-themes GitHub in your own browser.");
    for (const region of [".hero-top", ".viewer", "#extras figure"]) await expect(page.locator(region)).not.toContainText(/Choom|Cyberpunk/);
    const canonical = "https://sidebandstudio.github.io/GitHub-Reskin/themes/longroad-petals/";
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Frieren: Beyond Journey's End theme for GitHub: Longroad Petals · GitHub Reskin");
    for (const meta of ['meta[name="description"]', 'meta[property="og:description"]']) await expect(page.locator(meta)).toHaveAttribute("content", /^Frieren: Beyond Journey's End theme for GitHub: Longroad Petals\. /);

    await choose("nord");
    await expect(heading).toHaveText("Nord, a Classic theme for GitHub");
    await expect(page.locator(".hero-lede")).toHaveText("Nord, one of 12 Classics in GitHub Reskin, a free extension that re-themes GitHub in your own browser.");
    await expect(page.locator(".hero-top")).not.toContainText(/Frieren|Longroad/);

    await page.goto(site);
    await choose("longroad-petals");
    await expect(page.locator("[data-picker] > summary")).toContainText("Longroad Petals");
    await expect(heading).toHaveText(/Your GitHub.\s*Your world./);
    await expect(page.locator(".hero-lede")).toHaveText("Anime themes for GitHub, in your own browser. Thirteen anime, twelve Classics, free.");
  });
});

test.describe("a failed load", () => {
  test.use(PHONE);

  test("of the live preview leaves the picture, named as one, with Try again, which brings the live preview back", async ({ page, site }) => {
    let fail = true;
    await page.route(/\/engine\.[^/]*\.js$/, (route) => (fail ? route.abort() : route.continue()));
    await page.goto(site);
    await page.locator(".seg label", { hasText: "Diff" }).click();
    const note = page.locator("[data-failed]");
    await expect(note).toBeVisible();
    await expect(note).toContainText("The live preview didn't load. This is a picture of the profile with the theme on.");
    await expect(page.locator("[data-pending]")).toBeHidden();
    await expect(page.locator("[data-shot-img]")).toBeVisible();
    fail = false;
    await note.getByRole("button", { name: "Try again" }).click();
    await expect(host(page)).toHaveAttribute("data-view", "diff", { timeout: 20000 });
    await expect(page.locator('[data-window][data-preview="live"]')).toHaveCount(1);
    await expect(note).toBeHidden();
    await expect(page.locator("[data-pending]")).toBeHidden();
  });

  test("that Try again cannot fix offers a reload, which keeps the selected theme", async ({ page, site }) => {
    let fail = true;
    await page.route(/\/engine\.[^/]*\.js$/, (route) => (fail ? route.abort() : route.continue()));
    await page.goto(`${site}themes/longroad-petals/`);
    await page.locator("[data-window]").dispatchEvent("touchstart");
    const retry = page.locator("[data-failed] button");
    await expect(retry).toHaveText("Try again");
    await retry.click();
    await expect(retry).toHaveText("Reload the page");
    fail = false;
    await retry.click();
    await page.waitForURL(/themes\/longroad-petals\/$/);
    await goLive(page, true);
    await expect(host(page)).toHaveAttribute("data-source-hash", manifest().themes["longroad-petals"].sourceHash);
  });

  test("of the importer or a shared link says so, and trying again reads the theme", async ({ page, site }) => {
    let fail = true;
    await page.route(/\/engine\.[^/]*\.js$/, (route) => (fail ? route.abort() : route.continue()));
    await page.goto(`${site}make/`);
    const sample = page.getByRole("button", { name: "Use a sample answer" });
    await sample.click();
    await expect(page.locator("[data-import-status]")).toHaveText("The previewer didn't load, so nothing was read. Check your connection and try again.");
    fail = false;
    await sample.click();
    await expect(page.locator("[data-import-status]")).toHaveText("Theme ready to preview.");

    fail = true;
    await page.goto(`${site}share/#${encodeShare(NORD)}`);
    await expect(page.locator("[data-share-name]")).toHaveText("The shared theme didn't load");
    await expect(page.locator("[data-share-state]")).toHaveText("Your browser couldn't load the previewer. Check your connection and try again.");
    await expect(page.locator("[data-exports]")).toBeHidden();
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("[data-share-name]")).toHaveText("Nord");
    await expect(page.locator('[data-window][data-preview="live"]')).toHaveCount(1, { timeout: 20000 });
  });
});

test("make and share offer Download and Copy only once there is a theme, and say what to do until then", async ({ page, site }) => {
  await page.goto(`${site}make/`);
  const exportsRow = page.locator("[data-exports]");
  await expect(exportsRow).toBeHidden();
  await expect(page.locator("[data-download]")).toBeHidden();
  await expect(page.locator("[data-copy-share]")).toBeHidden();
  await expect(page.locator("[data-exports-empty]")).toHaveText("Preview a theme to download its file or copy a preview link.");
  await page.getByRole("button", { name: "Use a sample answer" }).click();
  await expect(page.getByRole("button", { name: "Download Midnight signal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy preview link" })).toBeVisible();
  await expect(page.locator("[data-exports-empty]")).toBeHidden();

  for (const hash of ["", "#RS1.abc.00000000"]) {
    await page.goto(`${site}share/${hash}`);
    await expect(page.locator("[data-share-state]")).toHaveText(hash ? /incomplete/ : /This link has no shared theme\. Ask for the full link or the theme's \.reskin\.json file\./);
    await expect(page.locator("[data-download]")).toBeHidden();
    await expect(page.locator("[data-copy-code]")).toBeHidden();
  }
});

test("an import the preview repairs says so, shows each change as before and after swatches, and the file keeps the saved adjustment", async ({ page, site }) => {
  await page.goto(`${site}make/`);
  const unreadable = { schemaVersion: 1, name: "Unreadable gray", base: "dark", colors: { background: "#111111", text: "#111111", accent: "#111111" } };
  await page.getByLabel("Chatbot answer").fill(JSON.stringify(unreadable));
  await page.getByRole("button", { name: "Preview theme" }).click();
  await expect(page.locator("[data-import-status]")).toHaveText("Theme ready to preview.");
  const note = page.locator("[data-repairs]");
  await expect(note.locator("[data-repair-summary]")).toHaveText("We adjusted 1 color so links and text are easier to read. Other colors were adjusted for this preview so they stay readable on your background. We spaced the graph colors so activity levels stay visible.");
  await note.locator("summary", { hasText: "See changes" }).click();
  const text = note.locator("[data-repair-list] li").filter({ has: page.locator("b", { hasText: /^Text$/ }) });
  await expect(text).toContainText("Saved color adjustment");
  await expect(text).toContainText("Raised to 4.5:1 contrast so it reads.");
  const swatches = await text.locator(".repair-swatch").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(swatches).toHaveLength(2);
  expect(swatches[0]).toBe("rgb(17, 17, 17)");
  expect(swatches[1]).not.toBe(swatches[0]);
  const repaired = (await text.locator(".repair-colors").nth(1).textContent()).trim();
  expect(repaired).toMatch(/^#[0-9a-f]{6}$/);
  await expect(note.locator("[data-repair-list] li", { hasText: "Adjusted for this preview" }).first()).toBeVisible();
  await expect(note.locator("[data-repair-list] li", { hasText: "Graph level 1" })).toHaveCount(1);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Unreadable gray" }).click()]);
  const saved = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(saved.colors.text).toBe(repaired);
  expect(saved.colors.background).toBe("#111111");
});

test("a shared link with a damaged escape gets the damaged-code message without an error, and a new code in the address still opens", async ({ page, site }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${site}share/#%E0%A4%A`);
  await expect(page.locator("[data-share-name]")).toHaveText("This share code can't be read");
  await expect(page.locator("[data-share-state]")).toHaveText("This share code is incomplete. Ask for the full code or the theme file.");
  await expect(page.locator("[data-download]")).toBeHidden();
  await page.evaluate((code) => (location.hash = code), encodeShare(NORD));
  await expect(page.locator("[data-share-name]")).toHaveText("Nord");
  expect(errors).toEqual([]);
});
