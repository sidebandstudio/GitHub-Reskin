// A theme's own advanced CSS in the userscript, in Chromium and Firefox: a bundled theme's reviewed
// CSS applies, and a saved theme's never does, even with an approval in its settings (one the
// extension wrote before the settings moved here as a file, say). Nothing in the userscript offers
// approval, so no control GitHub's page could reach can turn it on.
import { randomUUID } from "node:crypto";
import { DEFAULT_THEME_ID } from "../../../packages/contracts/index.js";
import { createRepository } from "../../../packages/settings/index.js";
import { catalogData, readCatalogEntries } from "../../../packages/ui/bundle.mjs";
import { catalogFromData } from "../../../packages/ui/catalog.js";
import { backgroundRendering, CSS_ADMISSION } from "../../../packages/ui/renderer.js";
import { ROOT } from "../../../scripts/build.mjs";
import { STATE_KEY, expect, painted, settingsOf, test } from "./helpers.mjs";

// Settings with a saved copy of Choom Circuit, its CSS approved, selected; made by the repository.
async function approvedCopy() {
  const catalog = catalogFromData(catalogData(await readCatalogEntries(ROOT)));
  const values = new Map();
  const storage = {
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => values.has(key)).map((key) => [key, structuredClone(values.get(key))])),
    set: async (record) => void Object.entries(record).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (keys) => void (Array.isArray(keys) ? keys : [keys]).forEach((key) => values.delete(key)),
  };
  const repository = createRepository(storage, { catalog, ...backgroundRendering(), newId: randomUUID });
  await repository.initialize();
  const document = { ...structuredClone(catalog.document(DEFAULT_THEME_ID)), name: "My Choom" };
  let settings = (await repository.commit({ type: "saveCustom", document, basedOn: DEFAULT_THEME_ID, select: true }, 0)).settings;
  const id = settings.selectedThemeId;
  const { hash, sanitizerVersion } = CSS_ADMISSION.inspect(document).css;
  settings = (await repository.commit({ type: "setCssConsent", id, granted: true, hash, sanitizerVersion }, settings.revision)).settings;
  return { seed: { [STATE_KEY]: { format: 1, stamp: "seed:1", lineage: [], records: { "reskin.settings": settings } } }, id };
}

// The scope marker under which a theme's own CSS applies: "active" only when it is allowed.
const scope = (page) => page.evaluate(() => document.documentElement.getAttribute("data-reskin-css"));

test("a saved theme's approved CSS stays off in the userscript, and a bundled theme's reviewed CSS applies", async ({ manager }) => {
  const { seed, id } = await approvedCopy();
  const gm = await manager({ kind: "sync", seed });
  const page = await gm.open();
  await expect.poll(() => painted(page)).toMatchObject({ boot: "ready", styled: true });
  const settings = await settingsOf(gm, page);
  expect([settings.selectedThemeId, Object.keys(settings.cssConsent)]).toEqual([id, [id]]);
  await page.waitForTimeout(500);
  expect(await scope(page)).not.toBe("active");

  // The same CSS as the bundled Choom Circuit's own applies.
  await page.evaluate(() => window.__gmLog.menu[0].fn());
  await page.frameLocator("[data-reskin-userscript-panel] iframe").locator(`[data-theme="${DEFAULT_THEME_ID}"]`).click();
  await expect.poll(() => scope(page)).toBe("active");
});
