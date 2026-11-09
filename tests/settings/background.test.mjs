import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STORAGE_KEYS } from "../../packages/contracts/index.js";
import { createBackground, installBackground } from "../../extension/background/host.js";
import { CLASSICS, contentSender, context, fakeApi, memoryStorage, pageSender, ROOT } from "./helpers.mjs";

const nord = CLASSICS.find((t) => t.id === "nord").document;
const flush = () => new Promise((r) => setImmediate(r));

function setup(initial = {}) {
  const api = fakeApi();
  const storage = memoryStorage(initial);
  const background = createBackground({ api, storage, ...context() });
  return { api, storage, background };
}

test("installBackground registers only internal listeners, synchronously, and no external bridge", () => {
  const api = fakeApi();
  installBackground(api, { storage: memoryStorage(), ...context() });
  assert.deepEqual(Object.keys(api.registered).sort(), ["onInstalled", "onMessage"]);
  assert.equal(api.registered.onMessageExternal, undefined);
  assert.equal(api.registered.onConnectExternal, undefined);
  const source = readFileSync(`${ROOT}extension/background/host.js`, "utf8") + readFileSync(`${ROOT}extension/content/lifecycle/index.js`, "utf8");
  for (const forbidden of ["onMessageExternal.addListener", "onConnectExternal.addListener", "postMessage(", "externally_connectable", "fetch(", "XMLHttpRequest", "tabs.query", "scripting."]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("first run opens once, only on a genuine install with nothing stored", async () => {
  const { api, background, storage } = setup();
  assert.equal(await background.handleInstalled({ reason: "install" }), true);
  assert.deepEqual(api.tabs.opened, ["chrome-extension://reskin-test-id/pages/onboarding.html"]);
  // A duplicate event, a later update, a restart and re-enabling never open another tab.
  assert.equal(await background.handleInstalled({ reason: "install" }), false);
  assert.equal(await background.handleInstalled({ reason: "update", previousVersion: "1.1.0" }), false);
  const restarted = createBackground({ api, storage, ...context() });
  assert.equal(await restarted.handleInstalled({ reason: "install" }), false);
  assert.equal(api.tabs.opened.length, 1);
});

test("updates, migration and existing state never open first run", async () => {
  for (const [initial, reason] of [[{ enabled: false }, "install"], [{ theme: "nord" }, "update"], [{}, "update"], [{}, "chrome_update"], [{}, "browser_update"]]) {
    const { api, background } = setup(initial);
    await background.handleInstalled({ reason });
    assert.equal(api.tabs.opened.length, 0, `${JSON.stringify(initial)} ${reason}`);
  }
});

test("a failing tab open does not retry or throw", async () => {
  const { api, background } = setup();
  api.tabs.create = async () => {
    throw new Error("no window");
  };
  assert.equal(await background.handleInstalled({ reason: "install" }), false);
});

test("content scripts may read but cannot commit, draft, open pages or read recovery", async () => {
  const { api, background, storage } = setup({ theme: "nord" });
  const sender = contentSender(api);
  const read = await background.dispatch({ type: "get", requestId: "r1" }, sender);
  assert.equal(read.ok, true);
  assert.equal(read.settings.selectedThemeId, "nord");
  const before = storage.snapshot();
  for (const request of [
    { type: "commit", requestId: "r2", expectedRevision: 0, action: { type: "setEnabled", enabled: false } },
    { type: "draft", requestId: "r3", action: { type: "save", draft: { document: nord, savedAt: 1 } } },
    { type: "open-page", requestId: "r4", action: { page: "settings" } },
    { type: "recovery", requestId: "r5", action: { type: "load" } },
  ]) {
    const reply = await background.dispatch(request, sender);
    assert.equal(reply.ok, false, request.type);
    assert.equal(reply.issues[0].path, "/sender");
  }
  assert.deepEqual(storage.snapshot(), before);
  assert.equal(api.tabs.opened.length, 0);
});

test("requests from another extension or with no sender are refused", async () => {
  const { background } = setup();
  for (const sender of [undefined, {}, { id: "other-extension", url: "chrome-extension://other-extension/pages/settings.html" }]) {
    const reply = await background.dispatch({ type: "get", requestId: "r1" }, sender);
    assert.equal(reply.ok, false);
    assert.equal(reply.issues[0].path, "/sender");
  }
  // Same ID but a page origin is not an extension page.
  const { api, background: b2 } = setup();
  const spoof = await b2.dispatch({ type: "commit", requestId: "r", expectedRevision: 0, action: { type: "setEnabled", enabled: false } }, { id: api.runtime.id, url: "https://github.com/chrome-extension://reskin-test-id/" });
  assert.equal(spoof.ok, false);
});

test("extension pages commit with explicit conflict replies", async () => {
  const { api, background } = setup();
  const sender = pageSender(api);
  const first = await background.dispatch({ type: "commit", requestId: "a", expectedRevision: 0, action: { type: "selectTheme", id: "nord" } }, sender);
  assert.equal(first.ok, true);
  const stale = await background.dispatch({ type: "commit", requestId: "b", expectedRevision: 0, action: { type: "selectTheme", id: "dracula" } }, sender);
  assert.equal(stale.code, "conflict");
  assert.equal(stale.current.selectedThemeId, "nord");
});

test("malformed requests are refused before any work", async () => {
  const { api, background, storage } = setup();
  const sender = pageSender(api);
  for (const request of [
    null,
    "get",
    { type: "get" },
    { type: "get", requestId: "x".repeat(65) },
    { type: "get", requestId: "ok", extra: true },
    { type: "fetch", requestId: "ok", url: "https://example.com" },
    { type: "commit", requestId: "ok", action: { type: "setEnabled", enabled: true } },
    { type: "commit", requestId: "ok", expectedRevision: -1, action: { type: "setEnabled", enabled: true } },
    { type: "open-page", requestId: "ok", action: { page: "https://example.com" } },
    { type: "open-page", requestId: "ok", action: { page: "settings", query: { url: "javascript:alert(1)" } } },
    { type: "open-page", requestId: "ok", action: { page: "settings", query: { theme: "a b<script>" } } },
    { type: "draft", requestId: "ok", action: { type: "save" } },
    { type: "recovery", requestId: "ok", action: { type: "dismiss" } },
  ]) {
    const reply = await background.dispatch(request, sender);
    assert.equal(reply.ok, false, JSON.stringify(request));
    assert.equal(reply.code, "invalid");
  }
  assert.equal(api.tabs.opened.length, 0);
  assert.equal(storage.log.some(([op]) => op === "set" && !storage.data.has(STORAGE_KEYS.settings)), false);
});

test("internal pages open with an allowlisted query only", async () => {
  const { api, background } = setup();
  const reply = await background.dispatch({ type: "open-page", requestId: "p", action: { page: "settings", query: { view: "import", theme: "local:00000000-0000-4000-8000-000000000001" } } }, pageSender(api));
  assert.equal(reply.ok, true);
  assert.deepEqual(api.tabs.opened, ["chrome-extension://reskin-test-id/pages/settings.html?view=import&theme=local%3A00000000-0000-4000-8000-000000000001"]);
});

test("drafts and recovery round-trip through the message boundary", async () => {
  const { api, background } = setup({ theme: "vaporwave" });
  const sender = pageSender(api);
  assert.deepEqual(await background.dispatch({ type: "draft", requestId: "d1", action: { type: "load" } }, sender), { ok: true, draft: null });
  assert.deepEqual(await background.dispatch({ type: "draft", requestId: "d2", action: { type: "save", draft: { document: nord, savedAt: 3 } } }, sender), { ok: true });
  assert.equal((await background.dispatch({ type: "draft", requestId: "d3", action: { type: "load" } }, sender)).draft.savedAt, 3);
  const recovery = await background.dispatch({ type: "recovery", requestId: "r", action: { type: "load" } }, sender);
  assert.equal(recovery.recovery.theme, "vaporwave");
  const big = await background.dispatch({ type: "draft", requestId: "d4", action: { type: "save", draft: { document: nord, source: "x".repeat(2_000_000), savedAt: 4 } } }, sender);
  assert.equal(big.ok, false);
  assert.equal(big.code, "storage");
});

test("onMessage answers asynchronously through sendResponse", async () => {
  const api = fakeApi();
  installBackground(api, { storage: memoryStorage({ theme: "gruvbox" }), ...context() });
  const [listener] = api.registered.onMessage;
  let response;
  const keepOpen = listener({ type: "get", requestId: "m" }, contentSender(api), (value) => (response = value));
  assert.equal(keepOpen, true);
  for (let i = 0; i < 20 && !response; i++) await flush();
  assert.equal(response.settings.selectedThemeId, "gruvbox");
});

test("disabled Reskin reloads disabled: a restarted worker keeps enabled=false and opens nothing", async () => {
  const { api, background, storage } = setup();
  await background.handleInstalled({ reason: "install" });
  await background.dispatch({ type: "commit", requestId: "c", expectedRevision: 0, action: { type: "setEnabled", enabled: false } }, pageSender(api));
  const restarted = createBackground({ api, storage, ...context() });
  assert.equal((await restarted.initialize()).settings.enabled, false);
  assert.equal(await restarted.handleInstalled({ reason: "update" }), false);
  assert.equal(api.tabs.opened.length, 1);
  assert.equal(storage.data.get(STORAGE_KEYS.boot), null);
});
