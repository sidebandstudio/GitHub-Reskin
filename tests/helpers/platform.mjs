// Assertions about the installed extension on the platform fixture app, shared by lint:chrome and
// the platform Playwright tests.

// With nothing saved, the extension paints its default theme, Choom Circuit, whose canvas is this
// color (the 1.1.0 Cyberpunk canvas it ports).
export const DEFAULT_CANVAS = "#0a0a17";

export async function expectThemedByDefault(page) {
  await page.waitForFunction(() => document.getElementById("reskin-style")?.textContent.length > 0, null, { timeout: 10000 });
  const background = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim());
  if (background !== DEFAULT_CANVAS) throw new Error(`the content script painted --bgColor-default ${background}, expected ${DEFAULT_CANVAS}`);
  return background;
}
