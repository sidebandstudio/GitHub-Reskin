// Firefox's storage-to-style time, for check:budgets: the built Firefox content script on a plain
// Gecko page over a stand-in for extension storage (helpers.mjs STAND_IN), as admission.spec does,
// timed from a settings write until the page's computed colors change. Playwright's Firefox cannot open the add-on's own
// pages, so the popup's commit and the storage hop between processes are not in this number; the
// Chromium run times that whole path.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORAGE_KEYS } from "../../../packages/contracts/index.js";
import { createRepository, defaultSettings } from "../../../packages/settings/index.js";
import { catalogData, readCatalogEntries } from "../../../packages/ui/bundle.mjs";
import { catalogFromData } from "../../../packages/ui/catalog.js";
import { CSS_ADMISSION } from "../../../packages/ui/renderer.js";
import { build, ROOT } from "../../../scripts/build.mjs";
import { CHOOM, PROFILE_HTML, PROFILE_URL, serveContentPackage } from "../extension/helpers.mjs";
import { expect, test } from "../../helpers/e2e.mjs";
import { FIXTURE, record, STAND_IN, summary, timeWrite } from "./helpers.mjs";

const SWITCHES = 40;
test("a settings write reaches the page's style in Firefox, timed for the release budget", async ({ browser }, info) => {
  test.setTimeout(120000);
  const out = await mkdtemp(join(tmpdir(), "reskin-e2e-release-firefox-"));
  try {
    const built = await build({ target: "firefox", outDir: out });
    const content = await readFile(join(built.dir, "content.js"), "utf8");
    const catalog = catalogFromData(catalogData(await readCatalogEntries(ROOT)));
    const first = { ...defaultSettings(catalog), onboardingCompleted: true };
    const records = (settings) => ({ [STORAGE_KEYS.settings]: settings, [STORAGE_KEYS.selected]: catalog.record(settings.selectedThemeId) });
    const data = new Map([[STORAGE_KEYS.settings, first]]);
    const memory = {
      get: async (keys) => Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))])),
      set: async (record) => Object.entries(record).forEach(([key, value]) => data.set(key, structuredClone(value))),
      remove: async (keys) => keys.forEach((key) => data.delete(key)),
      subscribe: () => () => {},
    };
    const repository = createRepository(memory, { catalog, css: CSS_ADMISSION, selectedRecord: (settings) => catalog.record(settings.selectedThemeId) });
    // The settings each switch writes, as the background's commits would leave them.
    const writes = [];
    for (let i = 0; i < SWITCHES + 2; i++) {
      const reply = await repository.commit({ type: "selectTheme", id: i % 2 ? CHOOM : "dracula" }, data.get(STORAGE_KEYS.settings).revision, { document: "release-firefox" });
      expect(reply.ok).toBe(true);
      writes.push(records(reply.settings));
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("https://github.com/**", (route) => (route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: PROFILE_HTML }) : route.abort()));
    await serveContentPackage(context, built.dir);
    await context.addInitScript({ content: `${STAND_IN.replace("__RECORDS__", () => JSON.stringify(records(first)))}\n${content}` });
    const page = await context.newPage();
    await page.goto(PROFILE_URL);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-reskin-boot"))).toBe("ready");
    let canvas = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim());
    const times = [];
    for (const [i, written] of writes.entries()) {
      const result = await timeWrite(page, written, canvas);
      canvas = result.canvas;
      // The first two switches warm the content script's caches.
      if (i >= 2) times.push(result.ms);
      await page.waitForTimeout(100);
    }
    expect(times).toHaveLength(SWITCHES);
    const result = summary(times);
    await record(info, "storage", { storageToStyleP95Ms: result.p95, storageToStyle: result, fixture: FIXTURE }, `firefox ${browser.version()}`);
    await context.close();
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
