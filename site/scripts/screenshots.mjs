// Review screenshots of a served site at phone, large phone, tablet and desktop sizes: the hero as
// first painted and with the live preview, the gallery, the builder teaser and the phone handoff
// (the keep sheet on touch sizes, the install section on desktop), plus a full page per size.
// Usage: node site/scripts/screenshots.mjs <site url> <output dir> [--slug choom-circuit]
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { slug: { type: "string", default: "" } } });
const [url, out] = positionals;
if (!url || !out) {
  console.error("Usage: node site/scripts/screenshots.mjs <site url> <output dir> [--slug <theme>]");
  process.exit(1);
}
const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "430x932", width: 430, height: 932, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "768x1024", width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440x900", width: 1440, height: 900, deviceScaleFactor: 1 },
];
const top = (page, selector) => page.locator(selector).evaluate((node) => window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - 64, behavior: "instant" }));

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const saved = [];
const shot = async (page, name) => {
  await page.waitForTimeout(200);
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file });
  saved.push(file);
};
try {
  for (const { name, width, height, ...device } of VIEWPORTS) {
    const touch = Boolean(device.hasTouch);
    const page = await browser.newPage({ viewport: { width, height }, ...device });
    const target = values.slug ? new URL(`themes/${values.slug}/`, url).href : url;
    await page.goto(target, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await shot(page, `hero-${name}`);
    // The live preview: a visitor reaching for the preview loads it.
    await page.locator("[data-window]").dispatchEvent(touch ? "touchstart" : "pointerenter");
    await page.locator('[data-window][data-preview="live"]').waitFor({ timeout: 20000 });
    await shot(page, `hero-live-${name}`);
    if (width < 1100) {
      await page.locator("[data-picker] > summary").click();
      await shot(page, `picker-${name}`);
      await page.locator("[data-picker] > summary").click();
    }
    await top(page, "#themes");
    await shot(page, `gallery-${name}`);
    await top(page, "#extras");
    await shot(page, `extras-${name}`);
    await top(page, "#make");
    await shot(page, `builder-${name}`);
    if (touch) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator(".hero-keep [data-open-keep]").click();
      await shot(page, `handoff-${name}`);
      await page.keyboard.press("Escape");
    } else {
      await top(page, "#install");
      await shot(page, `handoff-${name}`);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    const full = join(out, `full-${name}.png`);
    await page.screenshot({ path: full, fullPage: true });
    saved.push(full);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(saved.join("\n"));
