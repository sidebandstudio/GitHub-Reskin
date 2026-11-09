// Site accessibility: no serious or critical axe findings on each route at phone and desktop
// widths, in a non-default theme and with the keep sheet open, plus keyboard and name checks.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { axeViolations as axeNow, blocking } from "../../helpers/a11y.mjs";
import { expect, test as base } from "../../helpers/e2e.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SITE = process.env.RESKIN_SITE_DIR || join(ROOT, "dist/site");

const test = base.extend({
  site: [
    async ({ serveDir }, use) => {
      if (!existsSync(join(SITE, "index.html"))) throw new Error(`No built site at ${SITE}`);
      await use((await serveDir(SITE, { base: "/GitHub-Reskin" })).url);
    },
    { scope: "worker" },
  ],
});

// Contrast is judged at rest: after the shell's entrance and hover transitions have finished.
// Scroll-driven entrances never finish on their own clock, and only move content into view.
async function axeViolations(page, options) {
  await page.evaluate(() => {
    const timed = document.getAnimations().filter((a) => a.playState === "running" && !(typeof ScrollTimeline === "function" && a.timeline instanceof ScrollTimeline) && Number.isFinite(a.effect?.getComputedTiming().endTime));
    return Promise.race([Promise.all(timed.map((a) => a.finished.catch(() => {}))), new Promise((resolve) => setTimeout(resolve, 2000))]);
  });
  return axeNow(page, options);
}

const ROUTES = ["", "themes/longroad-petals/", "themes/solarized-dark/", "make/", "share/", "install/", "privacy/", "credits/", "changelog/", "404.html"];

for (const [label, viewport] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1440, height: 900 }]]) {
  test(`every route has no serious or critical axe findings on ${label} @a11y`, async ({ page, site }) => {
    await page.setViewportSize(viewport);
    const found = [];
    for (const path of ROUTES) {
      await page.goto(`${site}${path}`);
      for (const v of blocking(await axeViolations(page))) found.push(`${path || "/"} ${v.id}: ${v.help} (${v.targets.slice(0, 3).join(", ")})`);
    }
    expect(found).toEqual([]);
  });
}

test("every theme's controls and labels, each view and the Before state pass axe with the live preview @a11y", async ({ page, site }) => {
  // Twenty-five themes, each checked after its live frame is swapped in.
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(site);
  await page.locator("[data-window]").dispatchEvent("pointerenter");
  await expect(page.locator('[data-window][data-preview="live"]')).toHaveCount(1, { timeout: 20000 });
  const found = [];
  await page.locator(".picker-side .picker-classics > summary").click();
  const slugs = await page.locator(".picker-side [data-select]").evaluateAll((nodes) => nodes.map((n) => n.dataset.select));
  expect(slugs).toHaveLength(25);
  for (const slug of slugs) {
    await page.locator(`.picker-side [data-select="${slug}"]`).click();
    for (const v of blocking(await axeViolations(page, { include: "#preview" }))) found.push(`${slug} ${v.id}: ${v.targets.slice(0, 2).join(", ")}`);
  }
  for (const view of ["repo", "diff"]) {
    await page.locator(`input[name="view"][value="${view}"]`).check({ force: true });
    for (const v of blocking(await axeViolations(page, { include: "#preview" }))) found.push(`${view} ${v.id}: ${v.targets.slice(0, 3).join(", ")}`);
  }
  await page.locator('input[name="before"][value="before"]').check({ force: true });
  await page.locator('input[name="appearance"][value="calm"]').check({ force: true });
  for (const v of blocking(await axeViolations(page, { include: "#preview" }))) found.push(`before ${v.id}: ${v.targets.slice(0, 3).join(", ")}`);
  // The styled frame is inert and out of the tab order; its title names what it shows.
  const frame = page.locator("[data-live] iframe:not([aria-hidden])");
  await expect(frame).toHaveAttribute("tabindex", "-1");
  await expect(frame).toHaveAttribute("title", /Interactive preview: GitHub/);
  expect(found).toEqual([]);
});

test("the importer's error is tied to the field and its CSS choice is labeled @a11y", async ({ page, site }) => {
  await page.goto(`${site}make/`);
  await page.getByRole("button", { name: "Use a sample answer" }).click();
  await expect(page.getByLabel("Enable advanced CSS in this preview")).toBeVisible();
  await page.getByLabel("Chatbot answer").fill("{ nope");
  await page.getByRole("button", { name: "Preview theme" }).click();
  await expect(page.getByLabel("Chatbot answer")).toHaveAttribute("aria-invalid", "true");
  const described = await page.getByLabel("Chatbot answer").getAttribute("aria-describedby");
  expect(described.split(" ")).toContain("answer-error");
  expect(blocking(await axeViolations(page))).toEqual([]);
});

test("the keep sheet is an accessible modal dialog @a11y", async ({ browser, site }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(site);
  await page.locator(".hero-keep [data-open-keep]").click();
  const sheet = page.getByRole("dialog", { name: "Keep this theme for desktop" });
  await expect(sheet).toBeVisible();
  expect(blocking(await axeViolations(page, { include: "#keep-sheet" }))).toEqual([]);
  await expect(sheet.getByRole("button", { name: "Close" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await context.close();
});

test("keyboard users reach and operate every hero control with a visible focus ring @a11y", async ({ page, site }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(site);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  const option = page.locator('.picker-side [data-select="occult-orbit"]');
  await option.focus();
  const ring = await option.evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(ring).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(option).toHaveAttribute("aria-current", "true");
  const profile = page.locator('input[name="view"][value="profile"]');
  await profile.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('input[name="view"][value="repo"]')).toBeChecked();
  await expect(page.locator("[data-live] [data-reskin-preview]")).toHaveAttribute("data-view", "repo", { timeout: 20000 });
  for (const name of ["Profile", "Code", "Diff", "Before", "After", "Full", "Calm"]) await expect(page.getByRole("radio", { name, exact: true })).toBeAttached();
});

test("the phone chooser is a disclosure that Escape closes, returning focus @a11y", async ({ browser, site }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(site);
  const summary = page.locator("[data-picker] > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-picker]")).toHaveAttribute("open", "");
  expect(blocking(await axeViolations(page, { include: "[data-picker]" }))).toEqual([]);
  await page.locator('.drop-panel [data-select="dandadan"], .drop-panel [data-select="occult-orbit"]').first().focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-picker]")).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
  await context.close();
});

test("touch targets for theme choices and actions are at least 44px @a11y", async ({ browser, site }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(site);
  await page.locator("[data-picker] > summary").click();
  const small = await page.locator(".pick, [data-picker] > summary, .btn, .seg label, .card-actions a, .faq-list summary, .classics > summary").evaluateAll((nodes) =>
    nodes.filter((n) => n.offsetParent !== null).map((n) => [n.textContent.trim().slice(0, 30), n.getBoundingClientRect().height]).filter(([, h]) => h < 44),
  );
  expect(small).toEqual([]);
  await context.close();
});
