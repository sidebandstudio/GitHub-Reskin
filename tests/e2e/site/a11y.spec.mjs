// Site accessibility: no serious or critical axe findings on each route at phone and desktop
// widths, in a non-default theme and with the keep sheet open, plus keyboard and name checks.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { axeViolations, blocking } from "../../helpers/a11y.mjs";
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

const ROUTES = ["", "themes/longroad-petals/", "themes/solarized-dark/", "make/", "share/", "install/", "privacy/", "credits/", "changelog/"];

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

test("every theme preview, view and the Before state pass axe @a11y", async ({ page, site }) => {
  await page.goto(site);
  const found = [];
  const slugs = await page.locator(".chip[data-theme]").evaluateAll((nodes) => nodes.map((n) => n.dataset.theme));
  await page.locator("#classics summary").click();
  const classics = await page.locator("#classics [data-theme]").evaluateAll((nodes) => nodes.map((n) => n.dataset.theme));
  for (const slug of [...slugs, ...classics]) {
    await page.locator(`[data-theme="${slug}"]`).first().click();
    for (const view of ["profile", "repo", "diff"]) {
      await page.locator(`input[name="view"][value="${view}"]`).check({ force: true });
      for (const v of blocking(await axeViolations(page, { include: "#hero-preview" }))) found.push(`${slug} ${view} ${v.id}: ${v.targets.slice(0, 2).join(", ")}`);
    }
  }
  await page.locator('input[name="before"][value="before"]').check({ force: true });
  for (const v of blocking(await axeViolations(page, { include: "#hero-preview" }))) found.push(`before ${v.id}`);
  expect(found).toEqual([]);
});

test("the keep sheet is an accessible modal dialog @a11y", async ({ browser, site }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(site);
  await page.locator(".selected-actions [data-open-keep]").click();
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
  const chip = page.locator('.chip[data-theme="occult-orbit"]');
  await chip.focus();
  const ring = await chip.evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(ring).not.toBe("none");
  await page.keyboard.press("Space");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const code = page.locator('input[name="view"][value="profile"]');
  await code.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('input[name="view"][value="repo"]')).toBeChecked();
  await expect(page.locator('#hero-preview [data-pv-view="repo"]')).toBeVisible();
  for (const name of ["Profile", "Code", "Diff", "Before", "After"]) await expect(page.getByRole("radio", { name, exact: true })).toBeAttached();
  await expect(page.getByRole("switch", { name: "Flavor extras" })).toBeChecked();
});

test("touch targets for theme choices and actions are at least 44px @a11y", async ({ browser, site }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(site);
  const small = await page.locator(".chip, .btn, .seg label, .card-actions a, .faq-list summary").evaluateAll((nodes) =>
    nodes.filter((n) => n.offsetParent !== null).map((n) => [n.textContent.trim().slice(0, 30), n.getBoundingClientRect().height]).filter(([, h]) => h < 44),
  );
  expect(small).toEqual([]);
  await context.close();
});
