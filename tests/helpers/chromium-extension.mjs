// Loads an unpacked extension in Playwright's Chromium with a fresh profile. Branded Chrome
// ignores --load-extension, so this uses the Chromium build Playwright installs.
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

export async function launchExtension(extensionDir, profileDir, { headless = true } = {}) {
  if (!existsSync(chromium.executablePath())) {
    throw new Error("Playwright's Chromium is not installed. Run: npx --no-install playwright install chromium");
  }
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  return { context, version: context.browser()?.version() ?? chromium.name(), close: () => context.close() };
}
