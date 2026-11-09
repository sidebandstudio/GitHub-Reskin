// Fixtures for the installed-extension surface. Each test gets the real Chrome package, built once
// per worker, installed into a fresh persistent Chromium profile, so first run, settings and
// storage start clean. GitHub pages are C3's guarded profile fixture served as github.com through
// request routing; nothing reaches the network.
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "../../../scripts/build.mjs";
import { requireBrowser } from "../../helpers/browsers.mjs";
import { expect, test as base } from "../../helpers/e2e.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const PROFILE_HTML = readFileSync(join(ROOT, "tests/primer/fixtures/profile.html"), "utf8");
export const PROFILE_URL = "https://github.com/octo-sample";
export const CHOOM = "anime.cyberpunk-edgerunners";
export const CHOOM_CANVAS = "#0a0a17";

export const test = base.extend({
  packageDir: [
    async ({}, use) => {
      const dir = await mkdtemp(join(tmpdir(), "reskin-e2e-extension-"));
      const built = await build({ target: "chrome", outDir: dir });
      await use(built.dir);
      await rm(dir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  extension: async ({ packageDir }, use) => {
    requireBrowser("chromium");
    const profile = await mkdtemp(join(tmpdir(), "reskin-e2e-profile-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${packageDir}`, `--load-extension=${packageDir}`],
    });
    // GitHub is the routed fixture; any other request fails, so an extension network call would too.
    const requests = [];
    await context.route("https://github.com/**", (route) => {
      requests.push(route.request().url());
      if (route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html", body: PROFILE_HTML });
      return route.abort();
    });
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const url = (page) => `chrome-extension://${id}/pages/${page}.html`;
    await use({ context, worker, id, url, requests, profile });
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },
});

/** The settings record and lastGood, read from the service worker. */
export const storage = (worker) => worker.evaluate(() => chrome.storage.local.get(null));

/** Opens a page of the extension at a size, waiting for the picker's first render. */
export async function openPage(extension, name, viewport = { width: 400, height: 600 }) {
  const page = await extension.context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(extension.url(name));
  await expect(page.locator("[data-rs=summary-show]")).not.toBeEmpty();
  return page;
}

/** A GitHub profile tab with the content script, once the lifecycle has settled. */
export async function openGitHub(extension) {
  const page = await extension.context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(PROFILE_URL);
  await page.waitForFunction(() => ["ready", "native"].includes(document.documentElement.getAttribute("data-reskin-boot")));
  return page;
}

/** What the content script has painted on a GitHub tab. */
export const painted = (page) =>
  page.evaluate(() => ({
    boot: document.documentElement.getAttribute("data-reskin-boot"),
    styled: Boolean(document.getElementById("reskin-style")?.isConnected && document.getElementById("reskin-style").textContent),
    canvas: getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim(),
    // One entry per slot: C5 marks a slot's wrapper and the copy inside it with the same slot.
    owned: [...new Set([...document.querySelectorAll("[data-reskin-owned]:not(style)")].map((node) => node.getAttribute("data-reskin-owned")))].sort(),
    copy: [...document.querySelectorAll("[data-reskin-owned] .rs-copy")].map((node) => node.textContent),
  }));

/** Waits until the GitHub tab's painted state satisfies `check`. */
export async function waitPainted(page, check) {
  await expect.poll(async () => check(await painted(page)), { timeout: 5000 }).toBe(true);
  return painted(page);
}

export { expect };
