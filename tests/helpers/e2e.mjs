// Playwright test fixtures shared by every surface under tests/e2e. Import `test` and `expect`
// from here instead of @playwright/test:
//   serveDir(root, options)   starts scripts/serve.mjs on a free port, bound to 0.0.0.0, and
//                             closes it after the test file's worker finishes. Returns { url, port }.
//   platformApp               the platform fixture app, tests/fixture-app/platform, already served.
// Specs named *.chromium.spec.mjs run only in Chromium projects, *.firefox.spec.mjs only in Firefox
// projects, so no test needs to skip itself.
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { serve } from "../../scripts/serve.mjs";

export const PLATFORM_APP = fileURLToPath(new URL("../fixture-app/platform/", import.meta.url));

export const test = base.extend({
  serveDir: [
    async ({}, use) => {
      const servers = [];
      await use(async (root, options = {}) => {
        const server = await serve({ root, ...options });
        servers.push(server);
        return server;
      });
      await Promise.all(servers.map((server) => server.close()));
    },
    { scope: "worker" },
  ],
  platformApp: [async ({ serveDir }, use) => use(await serveDir(PLATFORM_APP)), { scope: "worker" }],
});

export { expect };
