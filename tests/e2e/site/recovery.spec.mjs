// Recovery from a failed lazy load in this project's browser (Chromium or Firefox); see recovery.mjs.
import { PHONE, RECOVERIES, test } from "./recovery.mjs";

test.describe("a failed lazy load recovers", () => {
  test.use(PHONE);
  for (const [name, run] of Object.entries(RECOVERIES)) test(name, ({ page, site }) => run(page, site));
});
