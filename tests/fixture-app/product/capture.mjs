// Screenshots of the built preview fixture for visual review. Not a test; it writes PNGs only.
// Run after building the fixture app (npm run test:e2e -- --project=fixture-chromium builds it):
//   node tests/fixture-app/product/capture.mjs --out <dir> [--view profile] [--width 390,1440] <theme.reskin.json>...
// Each theme is captured After with effects on, After with Effects off (Text and Fonts on), and
// Before, at each width.
import { mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { serve } from "../../../scripts/serve.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ON = { enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true };
const OFF = { ...ON, effects: false };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, view: { type: "string", default: "profile" }, width: { type: "string", default: "390,1440" }, app: { type: "string", default: join(ROOT, "dist/fixture/product") } },
});
if (!values.out || !positionals.length) throw new Error("Usage: capture.mjs --out <dir> [--view v] [--width 390,1440] <theme.reskin.json>...");
await mkdir(values.out, { recursive: true });
const server = await serve({ root: values.app, host: "127.0.0.1" });
const browser = await chromium.launch();
try {
  for (const file of positionals) {
    const theme = JSON.parse(await readFile(resolve(file), "utf8"));
    const slug = basename(file).replace(/\.reskin\.json$|\.json$/, "");
    for (const width of values.width.split(",").map(Number)) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: width < 600 ? 2 : 1 });
      await page.goto(new URL("preview.html", server.url).href);
      for (const [label, preferences, before] of [["effects-on", ON, false], ["effects-off", OFF, false], ["before", ON, true]]) {
        await page.evaluate(({ theme, preferences, view, before }) => {
          window.reskinPreview.mount({ view, theme, preferences });
          if (before) window.reskinPreview.setBefore(true);
        }, { theme, preferences, view: values.view, before });
        await page.waitForFunction(() => {
          const host = document.querySelector("[data-reskin-preview][data-completed]");
          return host && host.dataset.completed === host.dataset.requested;
        });
        // The styled frame is scriptless; the driver waits for its embedded fonts and images.
        const frame = await (await page.locator("#preview iframe:not([aria-hidden])").elementHandle()).contentFrame();
        await frame.evaluate("Promise.all([document.fonts.ready, ...[...document.images].map((img) => img.decode().catch(() => null))]).then(() => null)");
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        const path = join(values.out, `${slug}-${values.view}-${label}-${width}.png`);
        await page.locator("[data-reskin-preview]").screenshot({ path });
        console.log(path);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
