import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STORAGE_KEYS } from "../../packages/contracts/index.js";
import { createBackground, installBackground } from "../../extension/background/host.js";
import { APPROVALS_KEY } from "../../packages/settings/index.js";
import { builderSender, CLASSICS, contentSender, context, fakeApi, memoryStorage, pageSender, ROOT, standInCss } from "./helpers.mjs";

const nord = CLASSICS.find((t) => t.id === "nord").document;
const flush = () => new Promise((r) => setImmediate(r));

function setup(initial = {}, extra = {}) {
  const api = fakeApi();
  const storage = memoryStorage(initial);
  const background = createBackground({ api, storage, ...context(extra) });
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

// Advanced CSS approval tickets belong to the builder document the browser names as the sender.
const CSS_A = ".AppHeader { box-shadow: 0 1px 0 var(--reskin-accent); }";
const EDITOR = "editor-aaaaaaaaaaaaaaaa";
async function cssSetup() {
  const setupResult = setup({}, { css: standInCss() });
  const { api, background } = setupResult;
  let n = 0;
  const send = (action, sender, expectedRevision) => background.dispatch({ type: "commit", requestId: `c${++n}`, expectedRevision, action }, sender);
  const saved = await send({ type: "saveCustom", document: { ...nord, css: CSS_A }, select: true, editor: EDITOR }, builderSender(api), 0);
  assert.equal(saved.ok, true, JSON.stringify(saved.issues));
  return { ...setupResult, send, id: saved.settings.selectedThemeId };
}
const approve = (id) => ({ type: "approveCss", editor: EDITOR, target: id, css: CSS_A });
const redeem = (id, ticket) => ({ type: "setCssConsent", id, granted: true, editor: EDITOR, approval: ticket });

test("only the builder's settings page can ask for an approval ticket: never the popup, first run, a content script or an unnamed document", async () => {
  const { api, storage, send, id } = await cssSetup();
  const before = storage.snapshot();
  const senders = {
    popup: { id: api.runtime.id, url: api.runtime.getURL("pages/popup.html"), documentId: "popup-document" },
    firstRun: { ...pageSender(api, "pages/onboarding.html"), documentId: "onboarding-document", tab: { id: 9 }, frameId: 0 },
    content: contentSender(api),
    settingsWithoutDocument: builderSender(api, { documentId: null, tab: null }),
    settingsLookalikePath: { ...builderSender(api), url: api.runtime.getURL("pages/settings.html/../popup.html") },
  };
  for (const [name, sender] of Object.entries(senders)) {
    const reply = await send(approve(id), sender, 1);
    assert.equal(reply.ok, false, name);
    assert.equal(reply.approval, undefined, name);
  }
  assert.deepEqual(storage.snapshot(), before, "no refused request stores a ticket");
  // Chrome's documentId and Firefox's tab and frame both name a builder document.
  assert.equal((await send(approve(id), builderSender(api), 1)).ok, true);
  assert.equal((await send(approve(id), builderSender(api, { documentId: null, tab: 12 }), 1)).ok, true);
});

test("a ticket requested from the popup cannot be redeemed from settings, and a builder's ticket redeems only in its own document", async () => {
  const { api, storage, send, id } = await cssSetup();
  const popup = { id: api.runtime.id, url: api.runtime.getURL("pages/popup.html"), documentId: "popup-document" };
  // Review finding 3: the popup asks, the settings page redeems with the same strings.
  const fromPopup = await send(approve(id), popup, 1);
  assert.equal(fromPopup.ok, false);
  assert.equal((await send(redeem(id, fromPopup.approval?.ticket ?? "t".repeat(32)), builderSender(api), 1)).ok, false);
  // A real builder ticket, replayed with the same editor and ticket from any other sender.
  const ticket = (await send(approve(id), builderSender(api), 1)).approval.ticket;
  const others = [
    builderSender(api, { documentId: "builder-document-2" }),
    builderSender(api, { documentId: null, tab: 7 }),
    popup,
    contentSender(api),
    { ...pageSender(api, "pages/onboarding.html"), documentId: "builder-document-1" },
  ];
  for (const sender of others) {
    const reply = await send(redeem(id, ticket), sender, 1);
    assert.equal(reply.ok, false, sender.url);
    assert.equal(storage.data.get(STORAGE_KEYS.settings).cssConsent[id], undefined, sender.url);
  }
  // Firefox: another tab, or another frame of the same tab, is another document.
  const firefox = (await send(approve(id), builderSender(api, { documentId: null, tab: 12 }), 1)).approval.ticket;
  for (const sender of [builderSender(api, { documentId: null, tab: 13 }), builderSender(api, { documentId: null, tab: 12, frameId: 3 })]) assert.equal((await send(redeem(id, firefox), sender, 1)).ok, false);
  // The document that asked redeems it, whatever its URL fragment says now.
  const own = await send(redeem(id, ticket), builderSender(api, { hash: "#backup" }), 1);
  assert.equal(own.ok, true, JSON.stringify(own.issues));
  assert.ok(own.settings.cssConsent[id]);
  assert.ok((storage.data.get(APPROVALS_KEY) ?? []).length >= 1, "the Firefox document's ticket is still pending");
});

test("a ticket request with a stale expected revision is refused", async () => {
  const { api, storage, send, id } = await cssSetup();
  assert.equal((await send({ type: "selectTheme", id: "nord" }, builderSender(api), 1)).ok, true);
  const before = storage.snapshot();
  const stale = await send(approve(id), builderSender(api), 1);
  assert.equal(stale.code, "conflict");
  assert.equal(stale.approval, undefined);
  assert.deepEqual(storage.snapshot(), before);
  assert.equal((await send(approve(id), builderSender(api), 2)).ok, true);
});
