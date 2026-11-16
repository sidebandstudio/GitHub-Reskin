// The content script's part of switching themes, now that it holds one theme at a time: in each
// engine, the built content script on a plain page over a stand-in for extension storage
// (helpers.mjs STAND_IN) switches to every other bundled theme once, each the first switch to that
// theme in the tab, so its record is new to the page. Each write is what the background's commit
// leaves (settings, boot snapshot and the theme's record), timed until the page's computed colors
// change, within the settings-to-style budget at p95.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUDGETS, DEFAULT_THEME_ID, STORAGE_KEYS } from "../../../packages/contracts/index.js";
import { createRepository } from "../../../packages/settings/index.js";
import { catalogData, readCatalogEntries } from "../../../packages/ui/bundle.mjs";
import { catalogFromData } from "../../../packages/ui/catalog.js";
import { backgroundRendering } from "../../../packages/ui/renderer.js";
import { build, ROOT } from "../../../scripts/build.mjs";
import { PROFILE_HTML, PROFILE_URL, serveContentPackage } from "../extension/helpers.mjs";
import { expect, test } from "../../helpers/e2e.mjs";
import { FIXTURE, record, STAND_IN, summary, timeWrite } from "./helpers.mjs";

const PAGE_KEYS = [STORAGE_KEYS.settings, STORAGE_KEYS.boot, STORAGE_KEYS.selected];

test("the content script styles a first switch to each bundled theme within the settings-to-style budget", async ({ browser, browserName }, info) => {
  test.setTimeout(120000);
  const out = await mkdtemp(join(tmpdir(), "reskin-e2e-release-first-switch-"));
  try {
    const built = await build({ target: browserName === "firefox" ? "firefox" : "chrome", outDir: out });
    const content = await readFile(join(built.dir, "content.js"), "utf8");
    const catalog = catalogFromData(catalogData(await readCatalogEntries(ROOT)));
    // The background's repository over in-memory storage, keeping what each commit wrote.
    const data = new Map();
    let written = null;
    const memory = {
      get: async (keys) => Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, structuredClone(data.get(key))])),
      set: async (records) => {
        written = { ...written, ...records };
        for (const [key, value] of Object.entries(records)) data.set(key, structuredClone(value));
      },
      remove: async (keys) => keys.forEach((key) => data.delete(key)),
      subscribe: () => () => {},
    };
    const repository = createRepository(memory, { catalog, ...backgroundRendering(), newId: () => crypto.randomUUID(), selectedRecord: (settings) => catalog.record(settings.selectedThemeId) });
    await repository.initialize();
    const pageRecords = () => Object.fromEntries(PAGE_KEYS.filter((key) => data.has(key)).map((key) => [key, data.get(key)]));
    const first = pageRecords();
    const writes = [];
    for (const id of catalog.ids.filter((id) => id !== DEFAULT_THEME_ID)) {
      written = null;
      const reply = await repository.commit({ type: "selectTheme", id }, data.get(STORAGE_KEYS.settings).revision, { document: "release-first-switch" });
      expect(reply.ok, JSON.stringify(reply.issues ?? null)).toBe(true);
      writes.push([id, Object.fromEntries(PAGE_KEYS.filter((key) => key in written).map((key) => [key, written[key]]))]);
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route("https://github.com/**", (route) => (route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: PROFILE_HTML }) : route.abort()));
    await serveContentPackage(context, built.dir);
    // Chromium runs an init script before the root element exists, which a content script at
    // document_start always has.
    const run = `const run = () => {\n${content}\n};\nif (document.documentElement) run();\nelse new MutationObserver((_, observer) => document.documentElement && (observer.disconnect(), run())).observe(document, { childList: true });`;
    await context.addInitScript({ content: `${STAND_IN.replace("__RECORDS__", () => JSON.stringify(first))}\n${run}` });
    const page = await context.newPage();
    await page.goto(PROFILE_URL);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-reskin-boot"))).toBe("ready");
    let canvas = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim());
    const times = {};
    for (const [id, records] of writes) {
      const result = await timeWrite(page, records, canvas);
      canvas = result.canvas;
      times[id] = Math.round(result.ms * 10) / 10;
      await page.waitForTimeout(100);
    }
    await context.close();
    const result = summary(Object.values(times));
    await record(info, "first-switch-content", { firstSwitch: result, perTheme: times, fixture: FIXTURE }, `${browserName} ${browser.version()}`);
    expect(Object.keys(times)).toHaveLength(catalog.ids.length - 1);
    expect(result.p95, `first switches to each theme: ${JSON.stringify(times)}`).toBeLessThanOrEqual(BUDGETS.settingsToStyleP95Ms);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
