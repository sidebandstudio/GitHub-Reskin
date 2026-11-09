// GM storage normalization: the sync GM_* and async GM.* APIs give one StorageAdapter, get takes
// a key list (only saved keys come back) or an object of defaults, writes reach this tab's
// subscribers at once and another tab's through the manager's change events or on visibility,
// and a manager with no storage gets session memory that is never page storage.
import assert from "node:assert/strict";
import test from "node:test";
import { createGmStorage, detectGmStorage, WATCHED_KEYS } from "../../userscript/storage.js";
import { fakeDocument, fakeGm } from "./helpers.mjs";

for (const kind of ["sync", "async"]) {
  test(`${kind}: get with a key list returns only saved keys, and with defaults fills the missing ones`, async () => {
    const gm = fakeGm(kind, { theme: "nord", enabled: false });
    const { storage, kind: detected, capabilities } = createGmStorage(gm.scope);
    assert.equal(detected, kind);
    assert.equal(capabilities.durableStorage, true);
    assert.deepEqual(await storage.get(["theme", "custom", "enabled"]), { theme: "nord", enabled: false });
    assert.deepEqual(await storage.get({ theme: "dracula", custom: null, enabled: true }), { theme: "nord", custom: null, enabled: false });
    assert.deepEqual(await storage.get("theme"), { theme: "nord" });
    await assert.rejects(() => storage.get(42), TypeError);
  });

  test(`${kind}: set and remove write through the manager and tell this tab's subscribers`, async () => {
    const gm = fakeGm(kind);
    const { storage } = createGmStorage(gm.scope);
    const heard = [];
    const unsubscribe = storage.subscribe((changes) => heard.push(changes));
    await storage.set({ "reskin.settings": { revision: 1 }, "reskin.draft": null, skipped: undefined });
    assert.deepEqual(gm.snapshot(), { "reskin.settings": { revision: 1 }, "reskin.draft": null });
    await storage.remove(["reskin.draft"]);
    assert.deepEqual(gm.snapshot(), { "reskin.settings": { revision: 1 } });
    assert.deepEqual(heard, [{ "reskin.settings": { newValue: { revision: 1 } }, "reskin.draft": { newValue: null } }, { "reskin.draft": { newValue: undefined } }]);
    unsubscribe();
    await storage.set({ "reskin.settings": { revision: 2 } });
    assert.equal(heard.length, 2);
  });
}

test("a manager without deleteValue clears a key with null, which readers treat as absent", async () => {
  const gm = fakeGm("async", { theme: "nord" }, { deleteValue: false });
  const { storage } = createGmStorage(gm.scope);
  await storage.remove(["theme"]);
  assert.deepEqual(gm.snapshot(), { theme: null });
});

test("another tab's write arrives through the manager's change listener, and this tab's own echo is ignored", async () => {
  const gm = fakeGm("sync");
  const { storage, capabilities } = createGmStorage(gm.scope, { document: fakeDocument() });
  assert.equal(capabilities.crossTabEvents, true);
  // Nothing is registered with the manager until someone listens.
  assert.equal(gm.listeners.size, 0);
  const heard = [];
  const unsubscribe = storage.subscribe((changes) => heard.push(changes));
  assert.equal(gm.listeners.size, WATCHED_KEYS.length);
  gm.remoteWrite("reskin.settings", { revision: 7 });
  gm.remoteWrite("unrelated", 1);
  await storage.set({ "reskin.lastGood": { revision: 6 } });
  assert.deepEqual(heard, [{ "reskin.settings": { oldValue: undefined, newValue: { revision: 7 } } }, { "reskin.lastGood": { newValue: { revision: 6 } } }]);
  unsubscribe();
  assert.equal(gm.listeners.size, 0);
});

test("without change events, a tab that is shown again re-reads every watched record", async () => {
  const gm = fakeGm("async");
  const document = fakeDocument();
  const { storage, capabilities } = createGmStorage(gm.scope, { document });
  assert.deepEqual([capabilities.crossTabUpdates, capabilities.crossTabEvents], [true, false]);
  const heard = [];
  const unsubscribe = storage.subscribe((changes) => heard.push(Object.keys(changes)));
  document.hide();
  assert.equal(heard.length, 0);
  document.show();
  assert.deepEqual(heard, [[...WATCHED_KEYS]]);
  unsubscribe();
  assert.equal(document.handlers.size, 0);
});

test("with no storage grant the values live in memory for this page, copied, and page storage is never touched", async () => {
  const trap = new Proxy({}, { get: () => assert.fail("page storage was used") });
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  for (const name of ["localStorage", "sessionStorage", "indexedDB"]) Object.defineProperty(globalThis, name, { configurable: true, get: () => trap });
  try {
    const { storage, kind, capabilities } = createGmStorage({ GM: {} }, { document: fakeDocument() });
    assert.equal(kind, "session");
    assert.deepEqual(capabilities, { durableStorage: false, crossTabUpdates: false, crossTabEvents: false, clipboard: false, fileDownload: true });
    const record = { revision: 1, nested: { a: 1 } };
    await storage.set({ "reskin.settings": record });
    record.nested.a = 2;
    const read = await storage.get(["reskin.settings"]);
    assert.deepEqual(read, { "reskin.settings": { revision: 1, nested: { a: 1 } } });
    read["reskin.settings"].revision = 9;
    assert.equal((await storage.get(["reskin.settings"]))["reskin.settings"].revision, 1);
    const heard = [];
    storage.subscribe((changes) => heard.push(changes));
    await storage.remove(["reskin.settings"]);
    assert.deepEqual(await storage.get(["reskin.settings"]), {});
    assert.equal(heard.length, 1);
  } finally {
    for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  }
});

test("detection prefers the synchronous API, then GM.*, and accepts GM.addValueChangeListener", () => {
  assert.equal(detectGmStorage({}).kind, "session");
  assert.equal(detectGmStorage({ GM_getValue() {} }).kind, "session");
  assert.equal(detectGmStorage({ GM: { getValue() {} } }).kind, "session");
  const both = detectGmStorage({ GM_getValue() {}, GM_setValue() {}, GM: { getValue() {}, setValue() {} } });
  assert.equal(both.kind, "sync");
  const added = [];
  const gm4 = detectGmStorage({ GM: { getValue() {}, setValue() {}, addValueChangeListener: (key) => added.push(key) } });
  assert.equal(gm4.kind, "async");
  gm4.listen("reskin.settings", () => {});
  assert.deepEqual(added, ["reskin.settings"]);
});
