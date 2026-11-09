// Live public GitHub captures through the real unpacked extension, for owner review and S3 product
// captures. Not a CI test: it needs the network and GitHub's current markup. A fresh logged-out
// profile; it never signs in, stars, follows or edits anything.
//   node tests/e2e/extension/live.mjs --extension <unpacked chrome dir> --out <dir> [--theme <id>]
// Writes <page>-<mode>-<width>.png for each page in Full and Calm at 1440x900 and 390x844, plus
// the popup and first-run page, and capture.json with the URL, viewport and settings of each.
//   node tests/e2e/extension/live.mjs --firefox <unpacked firefox dir> --out <dir>
// Installs the Firefox build as a temporary add-on through Firefox's remote debugging protocol
// (web-ext's client) in Playwright's Firefox and captures the pages with the defaults (Choom
// Circuit, Full). Playwright cannot open moz-extension pages, so the popup is Chromium-only.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, firefox } from "@playwright/test";

export const LIVE_PAGES = Object.freeze([
  { name: "profile", url: "https://github.com/whoisaldo" },
  { name: "repo", url: "https://github.com/sidebandstudio/GitHub-Reskin" },
  { name: "file", url: "https://github.com/sidebandstudio/GitHub-Reskin/blob/main/README.md" },
  { name: "diff", url: "https://github.com/sidebandstudio/GitHub-Reskin/pull/2/files" },
  { name: "404", url: "https://github.com/sidebandstudio/GitHub-Reskin/this-page-does-not-exist" },
]);
export const VIEWPORTS = Object.freeze([
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]);

/** Launches Chromium with the unpacked extension and returns {context, id, close}. */
export async function launchUnpacked(dir, { headless = true } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "reskin-live-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  return {
    context,
    id,
    worker,
    close: async () => {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

/** Commits through an extension page, as the popup would, and returns the reply. */
export async function commitFromPage(page, action) {
  return page.evaluate(async (action) => {
    const get = await chrome.runtime.sendMessage({ type: "get", requestId: "live1" });
    return chrome.runtime.sendMessage({ type: "commit", requestId: "live2", expectedRevision: get.settings.revision, action });
  }, action);
}

// GitHub sometimes answers with a bare 5xx page, which Reskin rightly leaves native. Retry, and
// report whether GitHub's own page arrived, so an outage page is never saved as a capture.
async function visit(page, url) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    if (response && response.status() < 500) {
      await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
      return true;
    }
    await page.waitForTimeout(15000);
  }
  return false;
}

const paintedState = (page) =>
  page.evaluate(() => ({ boot: document.documentElement.getAttribute("data-reskin-boot"), styled: Boolean(document.getElementById("reskin-style")?.textContent), owned: document.querySelectorAll("[data-reskin-owned]").length - 1 }));

async function captureFirefox(dir, out) {
  const { connectWithMaxRetries } = await import(new URL("../../../node_modules/web-ext/lib/firefox/remote.js", import.meta.url).href);
  const port = 6000 + Math.floor(Math.random() * 1000);
  const profile = await mkdtemp(join(tmpdir(), "reskin-live-firefox-"));
  const context = await firefox.launchPersistentContext(profile, {
    headless: true,
    args: ["-start-debugger-server", String(port)],
    firefoxUserPrefs: { "devtools.debugger.remote-enabled": true, "devtools.chrome.enabled": true, "devtools.debugger.prompt-connection": false },
  });
  const records = [];
  try {
    const remote = await connectWithMaxRetries({ port, maxRetries: 50, retryInterval: 200 });
    await remote.installTemporaryAddon(dir);
    await new Promise((done) => setTimeout(done, 2000));
    for (const viewport of VIEWPORTS) {
      const page = await context.newPage();
      await page.setViewportSize(viewport);
      for (const { name, url } of LIVE_PAGES) {
        if (!(await visit(page, url))) {
          console.log(`firefox ${name} ${viewport.width}: GitHub did not answer, not captured`);
          continue;
        }
        await page.waitForTimeout(name === "profile" || name === "404" ? 2000 : 4000);
        const path = join(out, `firefox-${name}-full-${viewport.width}.png`);
        await page.screenshot({ path });
        const state = await paintedState(page);
        records.push({ file: path, url, viewport, appearance: "full", browser: `firefox ${context.browser()?.version() ?? ""}`, ...state });
        console.log(`firefox ${name} ${viewport.width}: ${JSON.stringify(state)}`);
      }
      await page.close();
    }
    remote.disconnect();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
  await writeFile(join(out, "capture-firefox.json"), `${JSON.stringify({ captured: new Date().toISOString(), records }, null, 2)}\n`);
}

async function main() {
  const { values } = parseArgs({ options: { extension: { type: "string" }, firefox: { type: "string" }, out: { type: "string" }, theme: { type: "string", default: "anime.cyberpunk-edgerunners" } } });
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  if (values.firefox) return captureFirefox(resolve(values.firefox), out);
  const browser = await launchUnpacked(resolve(values.extension));
  const records = [];
  try {
    const { context, id } = browser;
    // The first-run tab opens on its own after a genuine install.
    const welcome = await context.waitForEvent("page", { predicate: (p) => p.url().includes("/pages/onboarding.html"), timeout: 10000 }).catch(() => null);
    const control = welcome ?? (await context.newPage());
    if (!welcome) await control.goto(`chrome-extension://${id}/pages/onboarding.html`);
    await control.waitForSelector("[data-rs=summary-show]:not(:empty)");
    if (values.theme) await commitFromPage(control, { type: "selectTheme", id: values.theme });

    for (const viewport of VIEWPORTS) {
      await control.setViewportSize(viewport);
      await control.reload();
      await control.waitForSelector("[data-reskin-preview] iframe:not([aria-hidden])", { timeout: 15000 }).catch(() => {});
      await control.waitForTimeout(800);
      const path = join(out, `first-run-${viewport.width}.png`);
      await control.screenshot({ path, fullPage: true });
      records.push({ file: path, url: control.url(), viewport });
    }
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(`chrome-extension://${id}/pages/popup.html`);
    await popup.waitForSelector(".rs-card");
    await popup.screenshot({ path: join(out, "popup-400.png") });
    records.push({ file: join(out, "popup-400.png"), url: popup.url(), viewport: { width: 400, height: 600 } });

    for (const appearance of ["full", "calm"]) {
      await commitFromPage(control, { type: "setPreference", key: "appearance", value: appearance });
      for (const viewport of VIEWPORTS) {
        const page = await context.newPage();
        await page.setViewportSize(viewport);
        for (const { name, url } of LIVE_PAGES) {
          if (!(await visit(page, url))) {
            console.log(`${name} ${appearance} ${viewport.width}: GitHub did not answer, not captured`);
            continue;
          }
          await page.waitForTimeout(name === "profile" || name === "404" ? 2000 : 4000);
          const path = join(out, `${name}-${appearance}-${viewport.width}.png`);
          await page.screenshot({ path });
          if (name === "profile") {
            // The contribution calendar, legend and activity overview, and the whole page.
            const graph = page.locator(".js-yearly-contributions").first();
            if (await graph.count()) {
              await graph.scrollIntoViewIfNeeded();
              await page.waitForTimeout(500);
              const graphPath = join(out, `profile-graph-${appearance}-${viewport.width}.png`);
              await graph.screenshot({ path: graphPath });
              records.push({ file: graphPath, url, viewport, appearance, theme: values.theme });
            }
            if (viewport.width > 1000) {
              const fullPath = join(out, `profile-page-${appearance}-${viewport.width}.png`);
              await page.screenshot({ path: fullPath, fullPage: true });
              records.push({ file: fullPath, url, viewport, appearance, theme: values.theme });
            }
          }
          const state = await paintedState(page);
          records.push({ file: path, url, viewport, appearance, theme: values.theme, ...state });
          console.log(`${name} ${appearance} ${viewport.width}: ${JSON.stringify(state)}`);
        }
        await page.close();
      }
    }
    await commitFromPage(control, { type: "setPreference", key: "appearance", value: "full" });
    await writeFile(join(out, "capture.json"), `${JSON.stringify({ captured: new Date().toISOString(), browser: browser.context.browser()?.version() ?? "chromium", records }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main();
