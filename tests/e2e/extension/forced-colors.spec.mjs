// Forced colors on the installed extension, in Chromium and in Firefox: the theme's own CSS scope
// marker, the stylesheet and the owned decoration are present only while forced colors are off,
// and follow the mode as it changes on an open page. Firefox installs the Firefox build as a
// temporary add-on through its remote debugging protocol (firefoxExtension), since Playwright
// cannot load a Firefox extension itself.
import { CHOOM_CANVAS, PROFILE_URL, expect, firefoxExtension, openFirefoxGitHub, openGitHub, test, waitFor } from "./helpers.mjs";

// What forced colors may leave: GitHub's own page with no theme CSS, marker or owned node.
const state = (page) =>
  page.evaluate(() => ({
    forced: matchMedia("(forced-colors: active)").matches,
    boot: document.documentElement.getAttribute("data-reskin-boot"),
    scope: document.documentElement.getAttribute("data-reskin-css"),
    styled: Boolean(document.getElementById("reskin-style")?.textContent),
    owned: document.querySelectorAll("[data-reskin-owned]:not(style)").length,
    canvas: getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim(),
  }));

async function expectForcedColorsGate(page, label) {
  // Full Choom: the theme's reviewed CSS is scoped on, with its decoration.
  const themed = { forced: false, boot: "ready", scope: "active", styled: true, canvas: CHOOM_CANVAS };
  // Decoration follows the stylesheet, so the first themed state is the one with both.
  const first = await waitFor(page, state, (now) => Object.entries(themed).every(([key, value]) => now[key] === value) && now.owned > 0);
  expect(first, `${label} themed`).toMatchObject(themed);
  expect(first.owned, label).toBeGreaterThan(0);

  await page.emulateMedia({ forcedColors: "active" });
  await expect.poll(() => state(page), { message: `${label} forced` }).toMatchObject({ forced: true, boot: "native", scope: null, styled: false, owned: 0 });

  await page.emulateMedia({ forcedColors: "none" });
  await expect.poll(() => state(page), { message: `${label} restored` }).toMatchObject({ forced: false, boot: "ready", scope: "active", styled: true, canvas: CHOOM_CANVAS });
  await expect.poll(async () => (await state(page)).owned, { message: `${label} restored decoration` }).toBeGreaterThan(0);
}

test("Chromium: forced colors take the theme CSS, its scope marker and decoration away, and turning them off restores all three", async ({ extension }) => {
  const github = await openGitHub(extension);
  await expectForcedColorsGate(github, "chromium");

  // A page that loads under forced colors never sets the marker.
  const page = await extension.context.newPage();
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(PROFILE_URL);
  await page.waitForFunction(() => document.documentElement.getAttribute("data-reskin-boot") === "native");
  await page.waitForTimeout(300);
  expect(await state(page)).toMatchObject({ scope: null, styled: false, owned: 0 });
});

test("Firefox: the installed add-on follows forced colors the same way", async () => {
  test.setTimeout(90000);
  const installed = await firefoxExtension();
  try {
    const page = await openFirefoxGitHub(installed.context, PROFILE_URL);
    await expectForcedColorsGate(page, "firefox");
  } finally {
    await installed.close();
  }
});
