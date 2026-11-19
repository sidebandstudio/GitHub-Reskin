// Chromium launch helper: the test build of the current package loads unpacked, its content
// script runs on the platform app, and closing removes the temporary build and profile.
import { existsSync } from "node:fs";
import { launchTestExtension } from "../../helpers/browsers.mjs";
import { expect, test } from "../../helpers/e2e.mjs";
import { CHOOM_CANVAS, expectThemed, pickChoom } from "../../helpers/platform.mjs";

test("the unpacked test extension themes the platform app and cleans up after itself", async ({ platformApp }) => {
  const browser = await launchTestExtension();
  let closed = false;
  try {
    expect(existsSync(browser.dir)).toBe(true);
    await pickChoom(browser.context);
    const page = await browser.context.newPage();
    await page.goto(platformApp.url);
    expect(await expectThemed(page)).toBe(CHOOM_CANVAS);
    await browser.close();
    closed = true;
    expect(existsSync(browser.dir)).toBe(false);
  } finally {
    if (!closed) await browser.close();
  }
});
