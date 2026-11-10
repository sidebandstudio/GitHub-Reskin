// Recovery from a failed lazy load in WebKit, the engine of the iPhones most visitors use; see
// recovery.mjs. The site surface has Chromium and Firefox projects only, so this launches WebKit
// itself and runs once, in the Chromium project.
import { webkit } from "@playwright/test";
import { PHONE, RECOVERIES, test } from "./recovery.mjs";

test.describe("in WebKit, a failed lazy load recovers", () => {
  let browser;
  test.beforeAll(async () => {
    browser = await webkit.launch();
  });
  test.afterAll(() => browser.close());
  for (const [name, run] of Object.entries(RECOVERIES)) {
    test(name, async ({ site }) => {
      const context = await browser.newContext(PHONE);
      try {
        await run(await context.newPage(), site);
      } finally {
        await context.close();
      }
    });
  }
});
