// Fixture accessibility. The preview frame is sandboxed without scripts or same-origin access, so
// axe checks the same views painted straight into views.html by the same renderer, plus the
// preview host page and the adversarial adapter page. Serious and critical findings fail.
import { axeViolations, blocking } from "../../helpers/a11y.mjs";
import { PREFS, classic, decorated, expect, mount, previewFrame, test } from "./helpers.mjs";

const THEMES = {
  dracula: decorated("dracula", { rail: { shape: "slash" }, grid: {}, seal: { shape: "diamond" } }),
  "solarized-light": decorated("solarized-light", { paper: { texture: "grain" }, seal: { shape: "rosette" }, drift: { shape: "petal" } }, { font: "alegreya" }),
  "editing-suite": classic("editing-suite"),
};

for (const [id, theme] of Object.entries(THEMES)) {
  test(`every fixture view passes axe with ${id} @a11y`, async ({ page, fixtureApp }) => {
    await page.goto(fixtureApp.url("views.html?slots=all"));
    for (const view of ["profile", "repo", "diff", "empty", "404"]) {
      for (const before of [false, true]) {
        await page.evaluate(([state]) => window.reskinViews.render(state), [{ view, theme, preferences: PREFS, before }]);
        expect(blocking(await axeViolations(page)), `${view}${before ? " before" : ""}`).toEqual([]);
      }
    }
  });
}

test("the preview host page passes axe and the frame is out of the tab order @a11y", async ({ page, fixtureApp }) => {
  await mount(page, fixtureApp, { theme: THEMES.dracula });
  expect(blocking(await axeViolations(page))).toEqual([]);
  const frame = page.locator("#preview iframe:not([aria-hidden])");
  await expect(frame).toHaveAttribute("tabindex", "-1");
  await expect(frame).toHaveAttribute("title", "Interactive preview: GitHub profile");
  // The layout document is hidden from assistive technology and input.
  const layout = page.locator("#preview iframe[aria-hidden]");
  await expect(layout).toHaveAttribute("aria-hidden", "true");
  await expect(layout).toHaveAttribute("inert", "");
  await expect(layout).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("IFRAME");
  // Owned decoration stays hidden inside the styled frame too.
  const snapshot = await (await previewFrame(page)).locator("body").ariaSnapshot();
  expect(snapshot).toMatch(/Ali Younes/);
  expect(snapshot).not.toMatch(/sentinel copy|sentinel tag|Calendar sentinel/);
});

test("the adapter page with decoration passes axe and owned nodes stay hidden from assistive technology @a11y", async ({ page, fixtureApp }) => {
  await page.goto(fixtureApp.url("adversarial.html"));
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await page.evaluate(([t, p]) => window.reskinNative.apply(t, p), [THEMES.dracula, PREFS]);
  expect(blocking(await axeViolations(page))).toEqual([]);
  const snapshot = await page.locator("body").ariaSnapshot();
  expect(snapshot).not.toMatch(/sentinel copy|sentinel tag|Calendar sentinel/);
});
