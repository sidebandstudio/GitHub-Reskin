// Browser launch and cleanup for checks and Playwright tests. Each launcher fails with the install
// command when its browser is missing, and close() leaves nothing behind.
//   launchExtension(dir, profileDir)  an unpacked extension in Playwright's Chromium, persistent profile
//   launchTestExtension()             builds the Chrome package with the test-only local fixture match
//                                     into a temporary directory and launches it there
//   launchFirefox()                   Playwright's Firefox. It cannot install the extension; the real
//                                     Firefox install check uses web-ext in its own profile.
// Branded Chrome ignores --load-extension, so extension tests use the Chromium Playwright installs.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "@playwright/test";
import { build } from "../../scripts/build.mjs";

// The content-script match test builds add for the local fixture server.
export const LOCAL_FIXTURE_MATCHES = ["http://127.0.0.1/*"];

export function requireBrowser(name) {
  const type = { chromium, firefox }[name];
  if (!type || !existsSync(type.executablePath())) {
    throw new Error(`Playwright's ${name} is not installed. Run: npx --no-install playwright install ${name}`);
  }
  return type;
}

export async function launchExtension(extensionDir, profileDir, { headless = true } = {}) {
  requireBrowser("chromium");
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  return { context, version: context.browser()?.version() ?? chromium.name(), close: () => context.close() };
}

export async function launchTestExtension({ releaseConfig, headless } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "reskin-extension-"));
  try {
    const built = await build({ target: "chrome", outDir: join(dir, "dist"), releaseConfig, testFixture: { matches: LOCAL_FIXTURE_MATCHES } });
    const launched = await launchExtension(built.dir, join(dir, "profile"), { headless });
    return {
      ...launched,
      dir,
      close: async () => {
        try {
          await launched.close();
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function launchFirefox({ headless = true } = {}) {
  requireBrowser("firefox");
  const browser = await firefox.launch({ headless });
  return { browser, version: browser.version(), close: () => browser.close() };
}
