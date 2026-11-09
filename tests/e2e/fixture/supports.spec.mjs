// Choom Circuit's bevelled tag and stamp, from the catalog theme's own CSS: inside
// @supports (corner-shape: bevel) they take 1.1.0's 6px and 14px bevels; an engine without
// corner-shape (Firefox here) keeps the square corners, never round ones.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PREFS, expect, inFrame, mount, test } from "./helpers.mjs";

const CHOOM = JSON.parse(readFileSync(fileURLToPath(new URL("../../../themes/anime/choom-circuit.reskin.json", import.meta.url)), "utf8"));

const corners = (doc, slot) => {
  const node = doc.querySelector(`[data-reskin-slot="${slot}"]`);
  if (!node) return null;
  const s = doc.defaultView.getComputedStyle(node);
  return { supports: CSS.supports("corner-shape", "bevel"), radius: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius], shape: s.cornerTopLeftShape ?? s.cornerShape ?? null };
};

for (const [view, slot, radius] of [["profile", "profile.tag", "6px"], ["404", "error.notFound.caption", "14px"]]) {
  test(`Choom's ${slot} is bevelled where corner-shape draws and square elsewhere`, async ({ page, fixtureApp, browserName }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mount(page, fixtureApp, { theme: CHOOM, view, cssAllowed: true, preferences: { ...PREFS, fonts: false } }, { slots: true });
    const got = await inFrame(page, corners, slot);
    expect(got, slot).not.toBeNull();
    if (got.supports) {
      expect(got.radius).toEqual([radius, "0px", radius, "0px"]);
      expect(got.shape).not.toMatch(/round/);
    } else {
      expect(browserName).toBe("firefox");
      expect(got.radius).toEqual(["0px", "0px", "0px", "0px"]);
    }
    // Without consent for the theme's CSS, neither the bevel nor its rule is there.
    await mount(page, fixtureApp, { theme: CHOOM, view, cssAllowed: false, preferences: { ...PREFS, fonts: false } }, { slots: true });
    const plain = await inFrame(page, corners, slot);
    if (plain) expect(plain.radius[0]).not.toBe(radius);
  });
}
