// The installed Chrome package's pages at 320px, WCAG's reflow width: no serious or critical axe
// violation and no page-wide sideways scrolling in each view. The extension surface checks the
// same pages at 390px and wider; release-firefox checks these views in Gecko.
import { expect, openPage, test } from "../extension/helpers.mjs";
import { axe, REFLOW, sideways, VIEWS } from "./helpers.mjs";

for (const [title, name, hash, show] of VIEWS) {
  test(`${title} reflows at 320px with no serious or critical axe violations @a11y`, async ({ extension }) => {
    const page = await openPage(extension, name, REFLOW);
    if (hash) await page.evaluate((hash) => (location.hash = hash), hash);
    if (hash) await expect(page.locator(hash)).toBeVisible();
    await show(page);
    expect(await axe(page)).toEqual([]);
    expect(await sideways(page)).toBe(0);
  });
}
