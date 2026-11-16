// The built Firefox add-on's pages in Gecko, at 320px and at 1280px: no serious or critical axe
// violation in each view, and no page-wide sideways scrolling at 320px. Playwright's Firefox cannot
// open moz-extension pages, so the extension surface's firefoxPages harness serves the package's
// files with a stand-in browser namespace; that proves the pages, not an installed add-on.
import { expect, firefoxPages } from "../extension/helpers.mjs";
import { test } from "../../helpers/e2e.mjs";
import { axe, REFLOW, sideways, VIEWS } from "./helpers.mjs";

let harness;
test.beforeAll(async () => {
  harness = await firefoxPages();
});
test.afterAll(async () => {
  await harness?.close();
});

for (const viewport of [REFLOW, { width: 1280, height: 900 }]) {
  for (const [title, name, hash, show] of VIEWS) {
    test(`${title} in Firefox at ${viewport.width}px has no serious or critical axe violations${viewport === REFLOW ? " and reflows" : ""} @a11y`, async () => {
      const page = await harness.context.newPage();
      try {
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize(viewport);
        await page.goto(`${harness.url(name)}${hash}`);
        await expect(page.locator("[data-rs=summary-show]")).not.toBeEmpty();
        if (hash) await expect(page.locator(hash)).toBeVisible();
        await show(page);
        expect(await axe(page)).toEqual([]);
        if (viewport === REFLOW) expect(await sideways(page)).toBe(0);
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    });
  }
}
