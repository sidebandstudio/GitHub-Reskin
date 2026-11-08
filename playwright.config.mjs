// Playwright projects for every browser test surface, generated from SURFACES in
// scripts/check-routes.mjs. Each surface owns one directory under tests/e2e, so projects never
// share tests. Run them through `npm run test:e2e -- --project=<name>` or `npm run check:a11y`,
// which fail on zero discovered tests and on skips; plain `npx playwright test` does neither.
// Specs are *.spec.mjs. *.chromium.spec.mjs runs only in Chromium projects, *.firefox.spec.mjs
// only in Firefox projects.
import { defineConfig } from "@playwright/test";
import { SURFACES, e2eDir } from "./scripts/check-routes.mjs";

const ONLY = { chromium: "**/*.firefox.spec.mjs", firefox: "**/*.chromium.spec.mjs" };

export default defineConfig({
  testMatch: "**/*.spec.mjs",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 30000,
  outputDir: "artifacts/e2e/results",
  reporter: "list",
  use: { headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: Object.entries(SURFACES).flatMap(([surface, { projects }]) =>
    projects.map(([name, browserName]) => ({ name, testDir: e2eDir(surface), testIgnore: ONLY[browserName], use: { browserName } })),
  ),
});
