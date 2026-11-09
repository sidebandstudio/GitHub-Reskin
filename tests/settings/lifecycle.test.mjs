import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_PAGE_CACHE_KEY, LIMITS, STORAGE_KEYS } from "../../packages/contracts/index.js";
import { createRepository } from "../../packages/settings/index.js";
import { authenticationRoute } from "../../extension/content/github/routes.js";
import { startContent } from "../../extension/content/lifecycle/index.js";
import { catalog, context, deferred, fakePage, memoryStorage, testRenderer } from "./helpers.mjs";

async function stored(initial = {}) {
  const storage = memoryStorage(initial);
  const repository = createRepository(storage, context());
  await repository.initialize();
  return { storage, repository };
}

function start(storage, pageOptions, rendererOptions) {
  const page = fakePage(pageOptions);
  const renderer = testRenderer({ clock: page.clock, ...rendererOptions });
  const events = [];
  const content = startContent({ storage, document: page.document, view: page.view, catalog, renderer, onEvent: (e) => events.push(e) });
  return { page, renderer, events, content };
}
const phase = (page) => page.root.getAttribute("data-reskin-boot");

test("a healthy boot paints from the snapshot and ends the gate in the same turn", async () => {
  const { storage } = await stored();
  const { page, renderer, events, content } = start(storage);
  assert.equal(phase(page), null, "the gate is pending until storage answers");
  // Observe the moment the gate ends: the stylesheet must already be in place.
  let styledWhenReleased = null;
  page.document.observers.add({ _offer: (r) => r.attributeName === "data-reskin-boot" && styledWhenReleased === null && (styledWhenReleased = Boolean(page.style()?.textContent)) });
  assert.equal(await content.ready, "ready");
  assert.equal(phase(page), "ready");
  assert.equal(styledWhenReleased, true);
  assert.match(page.style().textContent, /--reskin-canvas/);
  assert.equal(renderer.calls.resolve, 0, "the validated snapshot was reused");
  assert.deepEqual(events.filter((e) => e.type === "resolved"), [{ type: "resolved", from: "snapshot" }]);
  assert.ok(page.clock.now < LIMITS.startupGateMs);
  content.destroy();
});

test("a stalled read releases native GitHub at the 120 ms watchdog, then applies the theme later", async () => {
  const gate = deferred();
  const { storage } = await stored();
  const slow = { ...storage, get: async (keys) => (await gate.promise, storage.get(keys)) };
  const { page, content } = start(slow);
  await page.advance(LIMITS.startupGateMs - 1);
  assert.equal(phase(page), null);
  await page.advance(1);
  assert.equal(phase(page), "timeout", "degraded startup releases GitHub");
  assert.equal(page.style(), null, "no guessed theme is painted");
  gate.resolve();
  assert.equal(await content.ready, "ready");
  assert.equal(phase(page), "ready");
  assert.ok(page.style());
  content.destroy();
});

test("a failed read, missing settings or a disabled extension release native GitHub immediately", async () => {
  const failing = { ...memoryStorage(), get: async () => { throw new Error("denied"); } };
  for (const storage of [failing, memoryStorage(), (await stored({ enabled: false })).storage]) {
    const { page, content } = start(storage);
    assert.equal(await content.ready, "native");
    assert.equal(phase(page), "native");
    assert.equal(page.style(), null);
    assert.ok(page.clock.now < LIMITS.startupGateMs);
    assert.equal(page.timers.size <= 1, true, "only the one-shot legacy cleanup may remain");
    content.destroy();
  }
});

test("corrupt, newer or partial settings never paint", async () => {
  for (const settings of [{ settingsVersion: 3, revision: 1 }, { settingsVersion: 2, revision: 0, enabled: true }, "x"]) {
    const { page, content } = start(memoryStorage({ [STORAGE_KEYS.settings]: settings }));
    assert.equal(await content.ready, "native");
    assert.equal(page.style(), null);
    content.destroy();
  }
});

test("policy comes first: high contrast, unknown modes and forced colors ignore a themed snapshot", async () => {
  const { storage } = await stored();
  for (const options of [{ darkTheme: "dark_high_contrast" }, { colorMode: "light", lightTheme: "light_high_contrast" }, { media: { "(forced-colors: active)": true } }]) {
    const { page, renderer, content } = start(storage, options);
    assert.equal(await content.ready, "native", JSON.stringify(options));
    assert.equal(page.style(), null);
    assert.equal(renderer.calls.compile, 0);
    content.destroy();
  }
});

test("authentication routes stay native before anything compiles, and a navigation into or out of one renders again before the new page paints", async () => {
  const { storage } = await stored();
  const nativeRoute = (document) => (authenticationRoute(document) ? "authentication" : null);
  const at = (pathname) => {
    const started = start(storage, {}, { nativeRoute });
    started.page.document.location = { hostname: "github.com", pathname };
    return started;
  };
  const auth = ["/login", "/login/oauth/authorize", "/login/device", "/logout", "/signup", "/join", "/session", "/sessions/two-factor", "/sessions/sudo", "/sessions/verified-device", "/password_reset", "/settings/two_factor_authentication/setup/intro"];
  for (const pathname of auth) {
    const { page, renderer, events, content } = at(pathname);
    assert.equal(await content.ready, "native", pathname);
    assert.equal(page.style(), null);
    assert.equal(renderer.calls.compile, 0);
    assert.ok(events.some((e) => e.type === "native" && e.reason === "authentication"));
    content.destroy();
  }
  for (const pathname of ["/octo-sample", "/loginx", "/octo/sessions", "/settings/profile"]) {
    const { content } = at(pathname);
    assert.equal(await content.ready, "ready", pathname);
    content.destroy();
  }
  const { page, content } = at("/octo-sample");
  await content.ready;
  page.document.readyState = "interactive";
  const visit = async (pathname, event) => {
    page.document.location = { hostname: "github.com", pathname };
    if (event === "popstate") page.fire("view", "popstate");
    else page.fire("document", event);
    await page.frame();
    return [phase(page), Boolean(page.style())];
  };
  assert.deepEqual(await visit("/login", "turbo:render"), ["native", false]);
  assert.deepEqual(await visit("/octo-sample", "turbo:load"), ["ready", true]);
  assert.deepEqual(await visit("/signup", "popstate"), ["native", false]);
  assert.deepEqual(await visit("/octo-sample", "pjax:end"), ["ready", true]);
  content.destroy();
});

test("a snapshot mismatch re-resolves the source against the current page", async () => {
  const { storage } = await stored();
  const { renderer, events, content } = start(storage, { media: { "(prefers-reduced-motion: reduce)": true } });
  await content.ready;
  assert.equal(renderer.calls.resolve, 1);
  assert.deepEqual(events.filter((e) => e.type === "resolved"), [{ type: "resolved", from: "source" }]);
  content.destroy();
});

test("storage changes coalesce into one read per frame and the last read wins", async () => {
  const { storage, repository } = await stored();
  const { page, content } = start(storage);
  await content.ready;
  const reads = () => storage.log.filter(([op, keys]) => op === "get" && keys.join() === [STORAGE_KEYS.settings, STORAGE_KEYS.boot].join()).length;
  const before = reads();
  await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  await repository.commit({ type: "selectTheme", id: "catppuccin-latte" }, 1);
  await repository.commit({ type: "setPreference", key: "motion", value: false }, 2);
  await page.settle();
  assert.equal(reads(), before, "no work until the frame");
  await page.frame();
  assert.equal(reads(), before + 1);
  const latte = page.style().textContent;
  assert.match(latte, /--reskin-canvas:#eff1f5/);
  // Drafts and UI records do not start a read.
  await page.frame();
  assert.equal(page.frames.size, 0);
  await repository.saveDraft({ document: catalog.document("nord"), savedAt: 1 });
  await page.settle();
  assert.equal(page.frames.size, 0);
  content.destroy();
});

test("an older slow read never overwrites a newer one", async () => {
  const { storage, repository } = await stored();
  const holds = [];
  let hold = false;
  const racing = {
    ...storage,
    get: async (keys) => {
      const value = await storage.get(keys);
      if (hold) {
        const d = deferred();
        holds.push(d);
        await d.promise;
      }
      return value;
    },
  };
  const { page, events, content } = start(racing);
  await content.ready;
  hold = true;
  await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  await page.frame(); // read A sees nord and is held
  hold = false;
  await repository.commit({ type: "selectTheme", id: "solarized-light" }, 1);
  await page.frame(); // read B sees solarized-light and completes
  assert.match(page.style().textContent, /--reskin-canvas:#fdf6e3/);
  holds.forEach((d) => d.resolve());
  await page.settle();
  assert.match(page.style().textContent, /--reskin-canvas:#fdf6e3/, "the stale read is ignored");
  assert.ok(events.some((e) => e.type === "stale-read"));
  content.destroy();
});

test("disable and re-enable remove and restore the style without a reload", async () => {
  const { storage, repository } = await stored();
  const { page, content } = start(storage);
  await content.ready;
  await repository.commit({ type: "setEnabled", enabled: false }, 0);
  await page.frame();
  assert.equal(page.style(), null);
  assert.equal(phase(page), "native");
  await repository.commit({ type: "setEnabled", enabled: true }, 1);
  await page.frame();
  assert.ok(page.style());
  assert.equal(phase(page), "ready");
  content.destroy();
});

test("GitHub mode and media changes recompute without reading storage", async () => {
  const { storage } = await stored();
  const { page, content } = start(storage);
  await content.ready;
  const gets = storage.log.length;
  page.root.setAttribute("data-dark-theme", "dark_high_contrast");
  await page.settle();
  await page.frame();
  assert.equal(page.style(), null, "an accessibility mode stays native");
  page.root.setAttribute("data-dark-theme", "dark_dimmed");
  page.setMedia("(prefers-reduced-motion: reduce)", true);
  await page.settle();
  await page.frame();
  assert.ok(page.style());
  assert.equal(storage.log.length, gets);
  // Its own marker writes never trigger the mode observer.
  await page.frame();
  assert.equal(page.frames.size, 0);
  page.root.setAttribute("data-reskin-boot", "ready");
  await page.settle();
  assert.equal(page.frames.size, 0);
  content.destroy();
});

test("a removed style is put back once per burst, and the circuit opens at three a second", async () => {
  const { storage } = await stored();
  const { page, events, content } = start(storage);
  await content.ready;
  page.style().remove();
  await page.settle();
  assert.ok(page.style(), "reinserted");
  page.clock.now += 100;
  page.document.getElementById("reskin-style").remove();
  await page.settle();
  assert.ok(page.style());
  page.clock.now += 100;
  page.document.getElementById("reskin-style").remove();
  await page.settle();
  assert.equal(page.style(), null, "third removal within a second stops reinsertion");
  assert.ok(events.some((e) => e.type === "style-circuit-open"));
  content.destroy();
});

test("Turbo navigation drops owned nodes before caching and places them after render, within budget", async () => {
  const { storage } = await stored();
  const { page, renderer, events, content } = start(storage);
  await content.ready;
  page.document.readyState = "interactive";
  page.fire("document", "DOMContentLoaded");
  await page.frame();
  assert.equal(renderer.calls.decorate, 1);
  page.fire("document", "turbo:before-cache");
  assert.equal(renderer.calls.destroyed, 1, "no owned nodes in Turbo's cache");
  page.fire("document", "turbo:render");
  page.fire("document", "turbo:load");
  await page.frame();
  assert.equal(renderer.calls.decorate, 2, "two navigation events, one pass");
  page.fire("view", "popstate");
  await page.frame();
  assert.equal(renderer.calls.decorate, 3);
  assert.equal(events.some((e) => e.type === "budget"), false);
  content.destroy();
  assert.equal(renderer.calls.destroyed, 3);
});

test("optional decoration stops for the rest of a navigation once it exceeds 10 ms, keeping what it placed", async () => {
  const { storage } = await stored();
  const { page, renderer, events, content } = start(storage, {}, { decorateCost: LIMITS.maxNavigationMs + 5 });
  await content.ready;
  page.document.readyState = "interactive";
  page.fire("document", "DOMContentLoaded");
  await page.frame();
  assert.equal(renderer.calls.decorate, 1);
  assert.ok(events.some((e) => e.type === "budget"));
  // GitHub's own changes on the same document: the colors follow, the decoration stays as placed.
  page.setMedia("(prefers-reduced-motion: reduce)", true);
  await page.settle();
  await page.frame();
  await page.frame();
  page.fire("document", "turbo:load");
  await page.frame();
  assert.equal(renderer.calls.decorate, 1, "no more optional work this navigation");
  assert.equal(renderer.calls.destroyed, 0, "a spent budget never removes what is placed");
  assert.ok(page.style(), "colors still apply");
  page.fire("document", "turbo:visit");
  page.fire("document", "turbo:load");
  await page.frame();
  assert.equal(renderer.calls.decorate, 2, "a new navigation gets a new budget");
  content.destroy();
});

test("forced colors take a spent page native, and turning them off places the decoration again", async () => {
  const { storage } = await stored();
  const { page, renderer, content } = start(storage, {}, { decorateCost: LIMITS.maxNavigationMs + 5 });
  await content.ready;
  page.document.readyState = "interactive";
  page.fire("document", "DOMContentLoaded");
  await page.frame();
  assert.equal(renderer.calls.decorate, 1, "the first pass spends the budget");
  page.setMedia("(forced-colors: active)", true);
  await page.settle();
  await page.frame();
  assert.equal(phase(page), "native");
  assert.equal(page.style(), null, "no stylesheet under forced colors");
  assert.equal(renderer.calls.destroyed, 1, "the decoration leaves with it");
  page.setMedia("(forced-colors: active)", false);
  await page.settle();
  await page.frame();
  await page.frame();
  assert.equal(phase(page), "ready");
  assert.ok(page.style());
  assert.equal(renderer.calls.decorate, 2, "the themed page after native gets a pass of its own");
  assert.equal(content.status().decorated, true);
  content.destroy();
});

test("the decoration budget adds up every pass of a navigation, not just the latest one", async () => {
  const { storage } = await stored();
  const { page, renderer, events, content } = start(storage, {}, { decorateCost: 6 });
  await content.ready;
  page.document.readyState = "interactive";
  page.fire("document", "DOMContentLoaded");
  await page.frame();
  assert.equal(renderer.calls.decorate, 1);
  assert.equal(events.some((e) => e.type === "budget"), false, "6 ms is under the budget");
  // Media changes on the same document: each pass is under 10 ms, their total is not.
  for (const reduce of [true, false, true]) {
    page.setMedia("(prefers-reduced-motion: reduce)", reduce);
    await page.settle();
    await page.frame();
    await page.frame();
  }
  assert.equal(renderer.calls.decorate, 2, "the second pass reaches 12 ms and ends optional work");
  assert.deepEqual(events.filter((e) => e.type === "budget"), [{ type: "budget", spent: 12 }]);
  content.destroy();
});

test("a theme or preference change the user makes gets a fresh decoration pass with its own budget", async () => {
  const { storage, repository } = await stored();
  const { page, renderer, events, content } = start(storage, {}, { decorateCost: LIMITS.maxNavigationMs + 5 });
  await content.ready;
  page.document.readyState = "interactive";
  page.fire("document", "DOMContentLoaded");
  await page.frame();
  assert.equal(renderer.calls.decorate, 1);
  assert.equal(events.filter((e) => e.type === "budget").length, 1, "the page load spent its budget");
  // Calm, then Full, Text off and on, and a theme change: each one decorates within two frames,
  // without a reload or a navigation.
  const changes = [
    { type: "setPreference", key: "appearance", value: "calm" },
    { type: "setPreference", key: "appearance", value: "full" },
    { type: "setPreference", key: "text", value: false },
    { type: "setPreference", key: "text", value: true },
    { type: "selectTheme", id: "nord" },
  ];
  for (const [revision, action] of changes.entries()) {
    await repository.commit(action, revision);
    await page.frame();
    await page.frame();
    assert.equal(renderer.calls.decorate, revision + 2, JSON.stringify(action));
    assert.equal(renderer.calls.destroyed, revision + 1, "the previous decoration leaves first");
  }
  assert.equal(events.filter((e) => e.type === "budget").length, changes.length + 1, "each change spent only its own budget");
  // GitHub's own changes keep the budget the last change opened.
  page.setMedia("(prefers-reduced-motion: reduce)", true);
  await page.settle();
  await page.frame();
  await page.frame();
  assert.equal(renderer.calls.decorate, changes.length + 1);
  content.destroy();
});

test("completion events in separate frames do not reopen an exhausted navigation budget", async () => {
  const { storage } = await stored();
  const { page, renderer, content } = start(storage, {}, { decorateCost: LIMITS.maxNavigationMs });
  await content.ready;
  page.fire("document", "turbo:visit");
  page.document.readyState = "interactive";
  page.fire("document", "turbo:render");
  await page.frame();
  assert.equal(renderer.calls.decorate, 1);
  page.fire("document", "turbo:load");
  await page.frame();
  page.fire("document", "pjax:end");
  await page.frame();
  assert.equal(renderer.calls.decorate, 1, "turbo:load and a late completion belong to the same navigation");
  page.fire("view", "popstate");
  await page.frame();
  assert.equal(renderer.calls.decorate, 2, "history navigation starts a new budget");
  content.destroy();
});

test("bfcache: pagehide drops queued work and a restored page re-reads storage", async () => {
  const { storage, repository } = await stored();
  const { page, content } = start(storage);
  await content.ready;
  await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  await page.settle();
  assert.equal(page.frames.size, 1);
  page.fire("view", "pagehide", { persisted: true });
  assert.equal(page.frames.size, 0);
  const gets = storage.log.length;
  page.fire("view", "pageshow", { persisted: true });
  await page.frame();
  assert.equal(storage.log.length, gets + 1);
  assert.match(page.style().textContent, /--reskin-canvas:#2e3440/);
  content.destroy();
});

test("a hidden tab defers its work to the next frame after it is shown", async () => {
  const { storage, repository } = await stored();
  const { page, content } = start(storage);
  await content.ready;
  page.document.visibilityState = "hidden";
  await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  await page.settle();
  // Browsers run no frames for hidden tabs; the work stays queued as one frame.
  assert.equal(page.frames.size, 1);
  page.document.visibilityState = "visible";
  page.fire("document", "visibilitychange");
  assert.equal(page.frames.size, 1, "no duplicate frame");
  await page.frame();
  assert.match(page.style().textContent, /--reskin-canvas:#2e3440/);
  content.destroy();
});

test("page storage is only ever asked to remove the exact legacy key, off the first-paint path", async () => {
  const { storage } = await stored();
  const { page, content } = start(storage);
  await content.ready;
  assert.deepEqual(page.pageStorage, [], "nothing on the first-paint path");
  await page.advance(0);
  assert.deepEqual(page.pageStorage, [["removeItem", LEGACY_PAGE_CACHE_KEY]]);
  content.destroy();
  // Denied site data is ignored.
  const denied = fakePage();
  Object.defineProperty(denied.view, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
  const blocked = startContent({ storage, document: denied.document, view: denied.view, catalog, renderer: testRenderer() });
  assert.equal(await blocked.ready, "ready");
  await denied.advance(0);
  blocked.destroy();
});

test("a renderer error releases native GitHub", async () => {
  const { storage } = await stored();
  const page = fakePage();
  const renderer = { ...testRenderer(), compile() { throw new Error("compile failed"); } };
  const content = startContent({ storage, document: page.document, view: page.view, catalog, renderer });
  assert.equal(await content.ready, "native");
  assert.equal(page.style(), null);
  content.destroy();
});

test("destroy disconnects everything and leaves the gate closed for good", async () => {
  const { storage, repository } = await stored();
  const { page, renderer, content } = start(storage);
  await content.ready;
  page.document.readyState = "interactive";
  page.fire("document", "DOMContentLoaded");
  await page.frame();
  content.destroy();
  assert.equal(page.observerCount(), 0);
  assert.equal(storage.listenerCount(), 0);
  assert.equal(page.timers.size, 0);
  assert.equal(page.frames.size, 0);
  assert.equal(page.style(), null);
  assert.equal(phase(page), "off", "an unset attribute would restart the CSS gate");
  assert.equal(renderer.calls.destroyed, 1);
  // Nothing reacts afterwards.
  const calls = { ...renderer.calls };
  await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  page.fire("document", "turbo:load");
  page.fire("view", "pageshow", { persisted: true });
  page.setMedia("(prefers-color-scheme: dark)", true);
  await page.settle();
  assert.equal(page.frames.size, 0);
  assert.deepEqual(renderer.calls, calls);
});

test("startup does not wait for the background: it reads extension storage directly", async () => {
  const { storage } = await stored();
  const { content } = start(storage);
  await content.ready;
  assert.deepEqual(storage.log.at(-1), ["get", [STORAGE_KEYS.settings, STORAGE_KEYS.boot]]);
});
