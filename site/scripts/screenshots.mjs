// Review screenshots of a served site: hero, gallery and builder at phone, tablet and desktop
// sizes, plus a full page per size. Usage:
//   node site/scripts/screenshots.mjs <site url> <output dir> [--slug choom-circuit]
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
  { name: "768x1024", width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1440x900", width: 1440, height: 900, deviceScaleFactor: 1 },
];
const SECTIONS = [
  ["hero", null],
  ["gallery", "#themes"],
  ["builder", "#make"],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const saved = [];
try {
  for (const { name, width, height, ...device } of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height }, ...device });
    const target = values.slug ? new URL(`themes/${values.slug}/`, url).href : url;
    await page.goto(target, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    for (const [section, selector] of SECTIONS) {
      if (selector) await page.locator(selector).evaluate((node) => node.scrollIntoView({ block: "start", behavior: "instant" }));
      else await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      const file = join(out, `${section}-${name}.png`);
      await page.screenshot({ path: file });
      saved.push(file);
    }
    const full = join(out, `full-${name}.png`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: full, fullPage: true });
    saved.push(full);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(saved.join("\n"));
