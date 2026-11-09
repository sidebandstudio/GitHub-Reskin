// Recovery from a failed lazy load, shared by recovery.spec.mjs (the project's own browser) and
// recovery-webkit.chromium.spec.mjs (WebKit, which the site surface has no project for). Requests for
// a lazily loaded chunk fail until the failure is shown; then the connection is back, and the
// recovery control must fetch the chunk again and bring up the live preview or the importer. Not a
// spec itself, so Playwright does not run it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base } from "../../helpers/e2e.mjs";
import { encodeShare } from "../../../packages/format/viewer.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SITE = process.env.RESKIN_SITE_DIR || join(ROOT, "dist/site");
const NORD = JSON.parse(readFileSync(join(ROOT, "themes/classics/nord.reskin.json"), "utf8"));
export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

export const test = base.extend({
  site: [
    async ({ serveDir }, use) => {
      if (!existsSync(join(SITE, "index.html"))) throw new Error(`No built site at ${SITE}. Run npm run build:site or use npm run test:e2e -- --surface=site.`);
      await use((await serveDir(SITE, { base: "/GitHub-Reskin" })).url);
    },
    { scope: "worker" },
  ],
});
export { expect };

// Fails every request for a chunk (engine or authoring), as a dropped connection or as an HTTP 503
// that must not be cached, until restore(); counts the requests served after that.
async function flaky(page, chunk, status = 0) {
  const requests = { failing: true, served: 0, restore: () => (requests.failing = false) };
  await page.route(new RegExp(`/_assets/${chunk}\\.[^/]*\\.js(\\?.*)?$`), (route) => {
    if (requests.failing) return status ? route.fulfill({ status, headers: { "cache-control": "no-store" }, body: "" }) : route.abort();
    requests.served++;
    return route.continue();
  });
  return requests;
}
const live = (page) => expect(page.locator('[data-window][data-preview="live"]')).toHaveCount(1, { timeout: 20000 });

export const RECOVERIES = {
  "home: Try again after the live preview failed to load brings it back": async (page, site) => {
    const engine = await flaky(page, "engine");
    await page.goto(site);
    await page.locator(".seg label", { hasText: "Diff" }).click();
    const note = page.locator("[data-failed]");
    await expect(note).toContainText("The live preview didn't load.");
    engine.restore();
    await note.getByRole("button", { name: "Try again" }).click();
    await live(page);
    await expect(page.locator("[data-window] [data-live] [data-reskin-preview]")).toHaveAttribute("data-view", "diff");
    await expect(note).toBeHidden();
    expect(engine.served).toBe(1);
  },
  "home: the reload offered after Try again also failed brings the live preview back": async (page, site) => {
    const engine = await flaky(page, "engine", 503);
    await page.goto(`${site}themes/longroad-petals/`);
    await page.locator(".seg label", { hasText: "Diff" }).click();
    const retry = page.locator("[data-failed] button");
    await expect(retry).toHaveText("Try again");
    await retry.click();
    await expect(retry).toHaveText("Reload the page");
    engine.restore();
    await retry.click();
    await page.waitForURL(/themes\/longroad-petals\/$/);
    await page.locator(".seg label", { hasText: "Diff" }).click();
    await live(page);
    expect(engine.served).toBe(1);
  },
  "make: Use a sample answer after the previewer failed to load reads the theme": async (page, site) => {
    const engine = await flaky(page, "engine");
    await page.goto(`${site}make/`);
    const sample = page.getByRole("button", { name: "Use a sample answer" });
    await sample.click();
    await expect(page.locator("[data-import-status]")).toHaveText("The previewer didn't load, so nothing was read. Check your connection and try again.");
    engine.restore();
    await sample.click();
    await expect(page.locator("[data-import-status]")).toHaveText("Theme ready to preview.");
    await live(page);
    expect(engine.served).toBe(1);
  },
  "make: Use a sample answer after the CSS sanitizer failed to load reads the theme": async (page, site) => {
    const authoring = await flaky(page, "authoring");
    await page.goto(`${site}make/`);
    const sample = page.getByRole("button", { name: "Use a sample answer" });
    await sample.click();
    await expect(page.locator("[data-import-status]")).toHaveText("The previewer didn't load, so nothing was read. Check your connection and try again.");
    authoring.restore();
    await sample.click();
    await expect(page.locator("[data-import-status]")).toHaveText("Theme ready to preview.");
    await live(page);
    expect(authoring.served).toBe(1);
  },
  "share: Try again after the previewer failed to load opens the shared theme": async (page, site) => {
    const engine = await flaky(page, "engine");
    await page.goto(`${site}share/#${encodeShare(NORD)}`);
    await expect(page.locator("[data-share-name]")).toHaveText("The shared theme didn't load");
    engine.restore();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("[data-share-name]")).toHaveText("Nord");
    await live(page);
    expect(engine.served).toBe(1);
  },
};
