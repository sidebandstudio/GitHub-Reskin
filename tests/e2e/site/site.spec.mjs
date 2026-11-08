// The built site in a real browser: the 390x844 first screen, 320px reflow, theme switching that
// keeps focus and scroll, views, Before/After, flavor extras, the phone handoff, clipboard
// fallbacks, no-JS first paint, deep links, reduced motion, the sample importer and requests.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base } from "../../helpers/e2e.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SITE = process.env.RESKIN_SITE_DIR || join(ROOT, "dist/site");
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

export const test = base.extend({
  site: [
    async ({ serveDir }, use) => {
      if (!existsSync(join(SITE, "index.html"))) throw new Error(`No built site at ${SITE}. Run npm run build:site or use npm run test:e2e -- --surface=site.`);
      await use((await serveDir(SITE, { base: "/GitHub-Reskin" })).url);
    },
    { scope: "worker" },
  ],
});

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const canvasOf = (page, id = "#hero-preview") => page.locator(id).evaluate((node) => node.style.getPropertyValue("--pv-canvas"));
// Replaces the clipboard so both browsers can test success and refusal.
const stubClipboard = (page, accept) =>
  page.addInitScript((ok) => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text) => (ok ? ((window.__copied = text), Promise.resolve()) : Promise.reject(new Error("denied"))) } });
  }, accept);

test.describe("phone first screen", () => {
  test.use(PHONE);

  test("shows the product, a themed preview and theme controls at 390x844 without page overflow", async ({ page, site }) => {
    await page.goto(site);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Your GitHub.\s*Your world./);
    await expect(page.locator(".chip").first()).toBeInViewport();
    const preview = await page.locator("#hero-preview").boundingBox();
    expect(preview.y).toBeLessThan(844 - 240);
    await expect(page.locator('input[name="before"][value="before"]')).toBeAttached();
    const before = await page.locator(".seg").first().boundingBox();
    expect(before.y + before.height).toBeLessThan(844);
    expect(await noOverflow(page)).toBe(true);
    await expect(page.locator(".nav .nav-keep")).toBeVisible();
  });

  test("Keep this theme for desktop gives the canonical link, copies only on success and restores focus", async ({ page, site }) => {
    await stubClipboard(page, false);
    await page.goto(`${site}themes/longroad-petals/`);
    const opener = page.locator(".selected-actions [data-open-keep]");
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
    await page.locator(".selected-actions [data-open-keep]").click();
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.locator("[data-keep-status]")).toHaveText("Link copied");
    expect(await page.evaluate(() => window.__copied)).toBe("https://sidebandstudio.github.io/GitHub-Reskin/themes/choom-circuit/");
  });
});

test.describe("theme page on a phone", () => {
  test.use(PHONE);

  test("shows its selected chip in the theme strip without scrolling the page", async ({ page, site }) => {
    await page.goto(`${site}themes/longroad-petals/`);
    await expect(page.locator('.chip[data-theme="longroad-petals"]')).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test("reflows at 320px without page-wide horizontal scrolling", async ({ page, site }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["", "themes/sunward-voyage/", "make/", "install/", "privacy/", "credits/"]) {
    await page.goto(`${site}${path}`);
    expect(await noOverflow(page), path).toBe(true);
  }
});

test("a theme chip updates the preview, URL and name without moving focus or scroll", async ({ page, site }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(site);
  const chip = page.locator('.chip[data-theme="longroad-petals"]');
  await chip.focus();
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Enter");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(chip).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  expect(await canvasOf(page)).toBe("#f1f0fa");
  await expect(page.locator('[data-selected="name"]')).toHaveText("Longroad Petals");
  await expect(page.locator('[data-selected="credit"]')).toHaveText("Inspired by Frieren");
  expect(new URL(page.url()).pathname).toBe("/GitHub-Reskin/themes/longroad-petals/");
  await expect(page).toHaveTitle("Longroad Petals, inspired by Frieren · GitHub Reskin");
  await expect(page.locator('.chip[data-theme="choom-circuit"]')).toHaveAttribute("aria-pressed", "false");
});

test("gallery Preview updates the hero and keeps focus; Classics open and work", async ({ page, site }) => {
  await page.goto(site);
  const button = page.locator('[data-card="sunward-voyage"] button');
  await button.scrollIntoViewIfNeeded();
  const scrollY = await page.evaluate(() => window.scrollY);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  expect(await canvasOf(page)).toBe("#0c3153");
  await page.locator("#classics summary").click();
  await page.locator('[data-card="nord"] button').click();
  expect(await canvasOf(page)).toBe("#2e3440");
  await expect(page.locator('[data-selected="credit"]')).toHaveText("Classic palette");
});

test("View in preview selects the theme and jumps to the preview", async ({ page, site }) => {
  await page.goto(site);
  await page.locator('[data-jump="wallward-scout"]').click();
  await expect(page.locator('[data-selected="name"]')).toHaveText("Wallward Scout");
  await expect(page.locator("#hero-preview")).toBeInViewport();
});

test("Profile, Code and Diff views and Before/After switch the preview", async ({ page, site }) => {
  await page.goto(site);
  await page.locator(".seg label", { hasText: "Code" }).click();
  await expect(page.locator('#hero-preview [data-pv-view="repo"]')).toBeVisible();
  await expect(page.locator('#hero-preview [data-pv-view="profile"]')).toBeHidden();
  await page.locator(".seg label", { hasText: "Diff" }).click();
  await expect(page.locator('#hero-preview [data-pv-view="diff"]')).toBeVisible();
  await expect(page.getByRole("group", { name: /Diff of extension\/themes.js/ })).toBeVisible();
  await page.locator(".seg label", { hasText: "Before" }).click();
  await expect(page.locator("#hero-preview")).toHaveAttribute("data-state", "native");
  expect(await canvasOf(page)).toBe("#0d1117");
  await page.locator(".seg label", { hasText: "After" }).click();
  await expect(page.locator("#hero-preview")).toHaveAttribute("data-state", "themed");
});

test("Flavor extras switch removes and restores theme lines in both previews", async ({ page, site }) => {
  await page.goto(site);
  const tags = page.locator('[data-slot="profile.tag"]');
  await expect(tags.first()).toHaveText("// choom view");
  const toggle = page.getByRole("switch", { name: "Flavor extras" });
  await toggle.uncheck();
  for (const tag of await tags.all()) await expect(tag).toBeHidden();
  await expect(page.locator("#hero-preview")).toHaveAttribute("data-fx", "");
  expect(await canvasOf(page)).toBe("#091312");
  await toggle.check();
  await expect(page.locator("#extras-preview [data-slot='profile.tag']")).toBeVisible();
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

test("Copy AI prompt reports Prompt copied after the clipboard accepts it", async ({ page, site }) => {
  await stubClipboard(page, true);
  await page.goto(site);
  await page.getByRole("button", { name: "Copy AI prompt" }).click();
  await expect(page.locator("[data-copy-status]")).toContainText("Prompt copied");
  expect(await page.evaluate(() => window.__copied)).toContain("Create ONE GitHub Reskin theme");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("each theme page shows its static themed preview and says switching needs JavaScript", async ({ page, site }) => {
    await page.goto(`${site}themes/peanut-dossier/`);
    const bg = await page.locator("#hero-preview").evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(bg).toBe("rgb(234, 247, 239)");
    await expect(page.getByText("Switching themes needs JavaScript")).toBeVisible();
    await expect(page.locator('[data-selected="name"]')).toHaveText("Peanut Dossier");
    await expect(page.locator(".viewer-controls")).toBeHidden();
  });
});

test("deep links and every asset load from the base path with no third-party requests", async ({ page, site }) => {
  const origin = new URL(site).origin;
  const requests = [];
  const failures = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => response.status() >= 400 && failures.push(`${response.status()} ${response.url()}`));
  for (const path of ["themes/choom-circuit/", "themes/solarized-light/", "make/", "share/#RS1.abc.00000000", "install/", "privacy/", "credits/", "changelog/"]) {
    await page.goto(`${site}${path}`, { waitUntil: "networkidle" });
  }
  expect(failures).toEqual([]);
  expect(requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("turns preview motion off", async ({ page, site }) => {
    await page.goto(site);
    await expect(page.locator("#hero-preview")).toHaveAttribute("data-motion", "off");
  });
});

test("the sample importer previews a pasted answer and keeps the last preview on errors", async ({ page, site }) => {
  await page.goto(`${site}make/`);
  await page.getByRole("button", { name: "Use a sample answer" }).click();
  await expect(page.locator("[data-import-status]")).toContainText("Previewing Harbor Dawn");
  expect(await canvasOf(page, "#make-preview")).toBe("#f4f1ea");
  await expect(page.getByRole("button", { name: "Download .reskin.json" })).toBeVisible();
  await page.getByLabel("Chatbot answer").fill('{"name":"Broken","colors":{"background":"blue"}}');
  await page.getByRole("button", { name: "Preview theme" }).click();
  await expect(page.locator("[data-import-status]")).toContainText("Base must be");
  expect(await canvasOf(page, "#make-preview")).toBe("#f4f1ea");
});

test("install shows honest per-browser states with every browser reachable", async ({ page, site }) => {
  await page.goto(site);
  const install = page.locator("#install");
  await expect(install.getByText("Store listing coming soon")).toHaveCount(2);
  for (const name of ["Chrome", "Firefox", "Safari"]) await expect(install.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(install.locator('a[href*="chromewebstore"], a[href*="addons.mozilla.org"]')).toHaveCount(0);
  await expect(install.locator(".browser.is-likely")).toHaveCount(1);
});
