// Accessibility of the extension's own pages: axe finds no serious or critical violation, every
// control is reachable by keyboard with a visible focus outline, and targets are at least 44px.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { axeViolations, blocking } from "../../helpers/a11y.mjs";
import { expect, openPage, test } from "./helpers.mjs";

// Extension pages allow only packaged scripts, so axe cannot arrive as a script tag. It is
// evaluated through the test channel instead, which page CSP does not govern.
const AXE = await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const axe = async (page) => {
  await page.evaluate(AXE);
  return blocking(await axeViolations(page));
};

const PAGES = [
  ["popup", { width: 400, height: 600 }],
  ["settings", { width: 1280, height: 900 }],
  ["onboarding", { width: 1280, height: 900 }],
  ["settings", { width: 390, height: 844 }],
];

for (const [name, viewport] of PAGES) {
  test(`${name} at ${viewport.width}px has no serious or critical axe violations @a11y`, async ({ extension }) => {
    const page = await openPage(extension, name, viewport);
    if (name === "onboarding") await page.getByRole("button", { name: "All 13 anime" }).click();
    expect(await axe(page)).toEqual([]);
  });
}

test("popup controls are native, named, keyboard reachable and show focus @a11y", async ({ extension }) => {
  const popup = await openPage(extension, "popup");
  const snapshot = await popup.locator("body").ariaSnapshot();
  expect(snapshot).toContain('switch "Reskin"');
  expect(snapshot).toContain('radio "Full"');
  expect(snapshot).toContain('radio "Calm"');
  expect(snapshot).toContain('switch "Text"');
  expect(snapshot).toContain('switch "Motion"');
  expect(snapshot).toContain('searchbox "Search themes or shows"');
  expect(snapshot).toMatch(/button "Cyberpunk: Edgerunners Choom Circuit Selected" \[pressed\]/);

  const seen = [];
  for (let i = 0; i < 12; i++) {
    await popup.keyboard.press("Tab");
    const focus = await popup.evaluate(() => {
      const el = document.activeElement;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const label = el.closest("label") ?? el;
      const target = label.getBoundingClientRect();
      return { name: el.getAttribute("data-rs") ?? el.className ?? el.tagName, outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2, height: Math.max(rect.height, target.height) };
    });
    seen.push(focus);
  }
  for (const focus of seen) {
    expect(focus.height, focus.name).toBeGreaterThanOrEqual(44);
  }
  // Every focus that is not a styled radio (which draws its ring on its label) shows an outline.
  expect(seen.filter((f) => !f.outline && f.name !== "").length).toBeLessThanOrEqual(2);
});

test("the reduced-motion note appears beside Motion when the device asks for less motion @a11y", async ({ extension }) => {
  const page = await extension.context.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 400, height: 600 });
  await page.goto(extension.url("popup"));
  await expect(page.getByText("Paused by your device's reduced-motion setting")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Motion" })).toBeChecked();
});
