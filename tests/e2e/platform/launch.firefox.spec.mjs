// Firefox launch helper: Playwright's Firefox starts, loads the platform app and closes cleanly.
import { launchFirefox } from "../../helpers/browsers.mjs";
import { expect, test } from "../../helpers/e2e.mjs";

test("the Firefox launch helper opens the platform app and closes", async ({ platformApp }) => {
  const firefox = await launchFirefox();
  try {
    expect(firefox.version).toMatch(/^\d+\./);
    const page = await firefox.browser.newPage();
    await page.goto(platformApp.url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Platform fixture");
    expect(await page.evaluate(() => navigator.userAgent)).toMatch(/Firefox\//);
  } finally {
    await firefox.close();
  }
  expect(firefox.browser.isConnected()).toBe(false);
});
