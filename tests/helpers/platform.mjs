// Assertions about the transitional 1.1.0 extension on the platform fixture app, shared by
// lint:chrome and the platform Playwright tests.

// With nothing saved, 1.1.0 paints its default theme, Cyberpunk, whose canvas is this color.
export const LEGACY_DEFAULT_CANVAS = "#0a0a17";

export async function expectThemedByLegacyDefault(page) {
  await page.waitForFunction(() => document.getElementById("github-reskin")?.textContent.length > 0, null, { timeout: 10000 });
  const background = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim());
  if (background !== LEGACY_DEFAULT_CANVAS) throw new Error(`the content script painted --bgColor-default ${background}, expected ${LEGACY_DEFAULT_CANVAS}`);
  return background;
}
