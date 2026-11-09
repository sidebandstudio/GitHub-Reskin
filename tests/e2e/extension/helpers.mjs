// Fixtures for the installed-extension surface. Each test gets the real Chrome package, built once
// per worker, installed into a fresh persistent Chromium profile, so first run, settings and
// storage start clean. GitHub pages are C3's guarded profile fixture, or a page a test serves at a
// path, served as github.com through request routing; nothing reaches the network.
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "@playwright/test";
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
    const pages = new Map();
    await context.route("https://github.com/**", (route) => {
      requests.push(route.request().url());
      if (route.request().resourceType() === "document") return route.fulfill({ contentType: "text/html", body: pageAt(pages, route.request().url()) });
      return route.abort();
    });
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const url = (page) => `chrome-extension://${id}/pages/${page}.html`;
    await use({ context, worker, id, url, requests, profile, serve: (path, html) => pages.set(path, html) });
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },
});

// The page served at a github.com URL's path, or the profile fixture.
const pageAt = (pages, url) => pages.get(new URL(url).pathname) ?? PROFILE_HTML;

/**
 * The Firefox build installed as a temporary add-on through Firefox's remote debugging protocol
 * (web-ext's client), since Playwright cannot load a Firefox extension itself. The add-on gets a
 * fixed internal UUID, so its pages have a known address. `pages` maps github.com paths to HTML.
 */
export async function firefoxExtension(pages = new Map()) {
  requireBrowser("firefox");
  const { connectWithMaxRetries } = await import(new URL("../../../node_modules/web-ext/lib/firefox/remote.js", import.meta.url).href);
  const out = await mkdtemp(join(tmpdir(), "reskin-e2e-firefox-package-"));
  const profile = await mkdtemp(join(tmpdir(), "reskin-e2e-firefox-"));
  const port = 6000 + Math.floor(Math.random() * 1000);
  const uuid = "6c0ffee0-5e5e-4e5e-8e5e-c6c6c6c6c6c6";
  const built = await build({ target: "firefox", outDir: out });
  const context = await firefox.launchPersistentContext(profile, {
    headless: true,
    args: ["-start-debugger-server", String(port)],
    firefoxUserPrefs: {
      "devtools.debugger.remote-enabled": true,
      "devtools.chrome.enabled": true,
      "devtools.debugger.prompt-connection": false,
      "extensions.webextensions.uuids": JSON.stringify({ "github-reskin@sideband.studio": uuid }),
    },
  });
  const close = async () => {
    await context.close();
    await rm(profile, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  };
  try {
    await context.route("https://github.com/**", (route) =>
      route.request().resourceType() === "document" ? route.fulfill({ contentType: "text/html", body: pageAt(pages, route.request().url()) }) : route.abort(),
    );
    const remote = await connectWithMaxRetries({ port, maxRetries: 50, retryInterval: 200 });
    try {
      await remote.installTemporaryAddon(built.dir);
    } finally {
      remote.disconnect();
    }
    // The install opens the welcome tab; a page opened before it settles can land in a window
    // Playwright's Firefox cannot address.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (error) {
    await close();
    throw error;
  }
  return { context, url: (page) => `moz-extension://${uuid}/pages/${page}.html`, close };
}

/**
 * Opens a GitHub page in a Firefox add-on context once the lifecycle has painted it. The add-on's
 * first storage write may land after the first load; a reload reads it.
 */
export async function openFirefoxGitHub(context, url) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(async () => {
    await page.goto(url);
    await page.waitForTimeout(500);
    return page.evaluate(() => document.documentElement.getAttribute("data-reskin-boot"));
  }, { timeout: 20000 }).toBe("ready");
  return page;
}

/** Commits a settings action from an extension page, as the popup does, and returns the reply. */
export const commit = (page, action) =>
  page.evaluate(async (action) => {
    const api = globalThis.browser ?? globalThis.chrome;
    const got = await api.runtime.sendMessage({ type: "get", requestId: "e2e-get" });
    return api.runtime.sendMessage({ type: "commit", requestId: "e2e-commit", expectedRevision: got.settings.revision, action });
  }, action);

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

// The origin the Firefox page harness serves the built add-on's files from.
export const FIREFOX_PAGES_ORIGIN = "https://reskin-pages.test";
const MEDIA_TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".json": "application/json" };

// A stand-in extension namespace for an add-on page in plain Gecko. storage.local lives in the test
// process, so it survives closing the page; runtime.sendMessage reaches the built background.js,
// which the same init script runs in the page, with the page as its sender.
const PAGE_STAND_IN = `(() => {
  const listeners = new Set();
  let onMessage = null;
  const call = (op, arg) => globalThis.__reskinStorage(op, arg ?? null);
  const notify = (changes) => { if (Object.keys(changes).length) for (const listener of listeners) listener(changes, "local"); };
  globalThis.browser = {
    runtime: {
      id: "e2e",
      // Packaged fonts as root paths, which the resource adapters accept for a page origin; the
      // rest, including the background's own origin check, as full URLs.
      getURL: (path) => (path.endsWith(".woff2") ? "/" : ${JSON.stringify(FIREFOX_PAGES_ORIGIN)} + "/") + path,
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { onMessage = listener; } },
      sendMessage: (message) => new Promise((resolve) => onMessage(structuredClone(message), { id: "e2e", url: location.href }, (reply) => resolve(structuredClone(reply)))),
    },
    storage: {
      local: {
        get: (keys) => call("get", keys),
        set: async (record) => notify(await call("set", record)),
        remove: async (keys) => notify(await call("remove", keys)),
      },
      onChanged: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l) },
    },
    tabs: { create: async () => ({}) },
  };
})();`;

/**
 * The built Firefox add-on's own pages in plain Gecko. Playwright's Firefox cannot open
 * moz-extension pages, so the package's files are served at FIREFOX_PAGES_ORIGIN, and an init
 * script installs a stand-in browser namespace and runs the package's background.js in each page
 * before its pages.js. `records()` reads the stored records; `contentScript` is the built
 * content.js for a GitHub page over the same records.
 */
export async function firefoxPages() {
  requireBrowser("firefox");
  const out = await mkdtemp(join(tmpdir(), "reskin-e2e-firefox-pages-"));
  const built = await build({ target: "firefox", outDir: out });
  const browser = await firefox.launch({ headless: true });
  const store = {};
  const context = await browser.newContext({ acceptDownloads: true });
  await context.exposeBinding("__reskinStorage", (_source, op, arg) => {
    const keys = arg === null ? Object.keys(store) : Array.isArray(arg) ? arg : typeof arg === "string" ? [arg] : Object.keys(arg);
    if (op === "get") return structuredClone(Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])));
    const changes = {};
    for (const key of keys) {
      const newValue = op === "set" ? structuredClone(arg[key]) : undefined;
      changes[key] = { oldValue: store[key], newValue };
      if (op === "set") store[key] = newValue;
      else delete store[key];
    }
    return structuredClone(changes);
  });
  await context.route(`${FIREFOX_PAGES_ORIGIN}/**`, async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, "");
    try {
      const body = await readFile(join(built.dir, path));
      await route.fulfill({ body, contentType: MEDIA_TYPES[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream" });
    } catch {
      await route.abort();
    }
  });
  const background = await readFile(join(built.dir, "background.js"), "utf8");
  await context.addInitScript({ content: `if (window === window.top && location.origin === ${JSON.stringify(FIREFOX_PAGES_ORIGIN)}) {\n${PAGE_STAND_IN}\n${background}\n}` });
  return {
    browser,
    context,
    url: (page) => `${FIREFOX_PAGES_ORIGIN}/pages/${page}.html`,
    records: async () => structuredClone(store),
    contentScript: await readFile(join(built.dir, "content.js"), "utf8"),
    async close() {
      await browser.close();
      await rm(out, { recursive: true, force: true });
    },
  };
}

// A clipboard that records what was copied, or refuses while __clipboardRefuse is set, so a test
// knows what the page copied and when the page was told it failed.
export const CLIPBOARD_STAND_IN = `(() => {
  const copied = [];
  const clipboard = {
    writeText: async (text) => {
      if (globalThis.__clipboardRefuse) throw new DOMException("Write permission denied.", "NotAllowedError");
      copied.push(String(text));
    },
  };
  Object.defineProperty(Navigator.prototype, "clipboard", { get: () => clipboard, configurable: true });
  globalThis.__copied = copied;
})();`;
