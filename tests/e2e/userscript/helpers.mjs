// The userscript surface: the real generated github-reskin.user.js (scripts/build.mjs, target
// userscript), injected at document start with a small userscript-manager shim, on github.com
// pages served from fixtures through request routing. Nothing reaches the network.
//
// The shim behaves like the managers it stands for:
//   sync     Tampermonkey/Violentmonkey: GM_getValue/GM_setValue/GM_deleteValue,
//            GM_addValueChangeListener (remote changes from other tabs), GM_registerMenuCommand
//   async    Greasemonkey 4 style: GM.getValue/GM.setValue/GM.deleteValue, GM.registerMenuCommand,
//            no change listener
//   safari   Userscripts for Safari style: GM.getValue/GM.setValue only, no menu
//   none     no storage grants at all
// Its values live in one JSON record under SHIM_KEY in the routed origin's localStorage, so they
// survive reloads and are shared by the context's tabs, and the browser's storage event delivers
// another tab's writes as remote changes. The userscript itself never sees that record.
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogCards, readCatalogEntries } from "../../../packages/ui/bundle.mjs";
import { build } from "../../../scripts/build.mjs";
import { expect, test as base } from "../../helpers/e2e.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const PROFILE_HTML = readFileSync(join(ROOT, "tests/primer/fixtures/profile.html"), "utf8");
export const PROFILE_URL = "https://github.com/octo-sample";
export const LOGIN_URL = "https://github.com/login";
export const CHOOM = "anime.cyberpunk-edgerunners";
export const CHOOM_CANVAS = "#0a0a17";
export const FRIEREN = "anime.frieren";
// A light theme's canvas on the fixture's light page: its card's, resolved on the standard seed.
export const FRIEREN_CANVAS = catalogCards(await readCatalogEntries(ROOT)).find((card) => card.id === FRIEREN).mini.canvas;
export const SHIM_KEY = "__reskin_test_gm__";
export const PANEL = "iframe[data-reskin-userscript-panel]";

// github.com/login, reduced: the sign-in form under the sessions route.
export const LOGIN_HTML = `<!doctype html><html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark"><head><title>Sign in to GitHub · GitHub</title>
<meta name="route-controller" content="sessions"><meta name="route-action" content="new"></head>
<body class="logged-out env-production page-responsive session-authentication"><main><div class="auth-form" id="login"><h1 id="heading">Sign in to GitHub</h1>
<form action="/session" method="post"><label for="login_field">Username or email address</label><input type="text" name="login" id="login_field"><input type="submit" value="Sign in"></form></div></main></body></html>`;

export function shim(kind, key) {
  if (window.top !== window) return; // @noframes
  const store = window.localStorage;
  const read = () => JSON.parse(store.getItem(key) || "{}");
  const listeners = new Map();
  let nextId = 1;
  const fire = (name, oldValue, newValue, remote) => {
    for (const [, entry] of listeners) if (entry.key === name) entry.listener(name, oldValue, newValue, remote);
  };
  const write = (name, value) => {
    const values = read();
    const old = values[name];
    if (value === undefined) delete values[name];
    else values[name] = JSON.parse(JSON.stringify(value));
    store.setItem(key, JSON.stringify(values));
    fire(name, old, value, false);
  };
  const log = (window.__gmLog = { menu: [], calls: 0 });
  window.addEventListener("storage", (event) => {
    if (event.key !== key) return;
    const before = JSON.parse(event.oldValue || "{}");
    const after = JSON.parse(event.newValue || "{}");
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[name]) !== JSON.stringify(after[name])) fire(name, before[name], after[name], true);
    }
  });
  const get = (name, fallback) => {
    log.calls++;
    const values = read();
    return Object.hasOwn(values, name) ? values[name] : fallback;
  };
  const menu = (name, fn) => log.menu.push({ name, fn });
  if (kind === "sync") {
    Object.assign(window, {
      GM_getValue: get,
      GM_setValue: write,
      GM_deleteValue: (name) => write(name, undefined),
      GM_addValueChangeListener: (name, listener) => {
        const id = nextId++;
        listeners.set(id, { key: name, listener });
        return id;
      },
      GM_removeValueChangeListener: (id) => listeners.delete(id),
      GM_registerMenuCommand: menu,
    });
  } else if (kind === "async" || kind === "safari") {
    const delay = () => new Promise((resolve) => setTimeout(resolve, 2));
    window.GM = {
      getValue: async (name, fallback) => (await delay(), get(name, fallback)),
      setValue: async (name, value) => (await delay(), write(name, value)),
      ...(kind === "async" && { deleteValue: async (name) => (await delay(), write(name, undefined)), registerMenuCommand: menu }),
    };
  }
  // ResizeObserver bookkeeping, so tests can see the panel disconnect its observer.
  const Observer = window.ResizeObserver;
  const live = (window.__resizeObservers = new Set());
  window.ResizeObserver = class extends Observer {
    observe(target, ...rest) {
      // Only observers of the panel's frame: the page's own decorations have theirs.
      if (target.ownerDocument !== document) live.add(this);
      return super.observe(target, ...rest);
    }
    disconnect() {
      live.delete(this);
      return super.disconnect();
    }
  };
}

export const test = base.extend({
  userscript: [
    async ({}, use) => {
      const dir = await mkdtemp(join(tmpdir(), "reskin-e2e-userscript-"));
      const built = await build({ target: "userscript", outDir: dir });
      await use(await readFile(join(built.dir, "github-reskin.user.js"), "utf8"));
      await rm(dir, { recursive: true, force: true });
    },
    { scope: "worker" },
  ],
  // open({kind, seed, pages}) -> {context, page(url), requests, store(page)}
  manager: async ({ browser, userscript }, use) => {
    const contexts = [];
    await use(async ({ kind = "sync", seed = null, pages = {}, inject = true } = {}) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
      contexts.push(context);
      const requests = [];
      await context.route("https://github.com/**", (route) => {
        const request = route.request();
        if (request.resourceType() !== "document") {
          requests.push(request.url());
          return route.abort();
        }
        const path = new URL(request.url()).pathname;
        return route.fulfill({ contentType: "text/html", body: pages[path] ?? (path === "/login" ? LOGIN_HTML : PROFILE_HTML) });
      });
      if (seed) await context.addInitScript(({ key, seed }) => window.top === window && !localStorage.getItem(key) && localStorage.setItem(key, JSON.stringify(seed)), { key: SHIM_KEY, seed });
      if (inject) await context.addInitScript({ content: `(${shim})(${JSON.stringify(kind)}, ${JSON.stringify(SHIM_KEY)});\nif (window.top === window) {\n${userscript}\n}` });
      const open = async (url = PROFILE_URL) => {
        const page = await context.newPage();
        await page.goto(url);
        if (inject) await waitSettled(page);
        return page;
      };
      return { context, open, requests, store: (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), SHIM_KEY) };
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export const waitSettled = (page) => page.waitForFunction(() => ["ready", "native", "timeout"].includes(document.documentElement.getAttribute("data-reskin-boot")));

/** What the userscript has painted on the tab. */
export const painted = (page) =>
  page.evaluate(() => ({
    boot: document.documentElement.getAttribute("data-reskin-boot"),
    styled: Boolean(document.getElementById("reskin-style")?.isConnected && document.getElementById("reskin-style").textContent),
    canvas: getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim(),
  }));

/** Opens the panel from the manager's menu and returns its frame once the picker has rendered. */
export async function openPanel(page) {
  await page.evaluate(() => window.__gmLog.menu[0].fn());
  return panelFrame(page);
}

export async function panelFrame(page) {
  await expect(page.locator(PANEL)).toHaveCount(1);
  const frame = page.frameLocator(PANEL);
  await expect(frame.locator("[data-rs=summary-show]")).not.toBeEmpty();
  return frame;
}

/** The frame's Document as a Playwright Frame, for evaluate and axe. */
export const panelDocument = async (page) => (await page.locator(PANEL).elementHandle()).contentFrame();

export const settingsOf = async (manager, page) => (await manager.store(page))["reskin.settings"];

export { expect };
