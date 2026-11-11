// GM storage normalization: the sync GM_* and async GM.* APIs give one StorageAdapter, get takes
// a key list (only saved keys come back) or an object of defaults, the extension's records are one
// manager value written all at once, writes reach this tab's subscribers once confirmed and
// another tab's through the manager's change events or on visibility, and a manager with no
// storage gets session memory that is never page storage.
import assert from "node:assert/strict";
import test from "node:test";
import { createGmStorage, detectGmStorage, lockBridge, STATE_KEY, WATCHED_KEYS, WRITE_LOST } from "../../userscript/storage.js";
import { fakeDocument, fakeGm, records } from "./helpers.mjs";

const fast = { confirmMs: 1 };

for (const kind of ["sync", "async"]) {
  test(`${kind}: get with a key list returns only saved keys, and with defaults fills the missing ones`, async () => {
    const gm = fakeGm(kind, { theme: "nord", enabled: false, [STATE_KEY]: { format: 1, stamp: "a:1", lineage: [], records: { "reskin.ui": { group: "mine" } } } });
    const { storage, kind: detected, capabilities } = createGmStorage(gm.scope, fast);
    assert.equal(detected, kind);
    assert.equal(capabilities.durableStorage, true);
    assert.deepEqual(await storage.get(["theme", "custom", "enabled"]), { theme: "nord", enabled: false });
    assert.deepEqual(await storage.get({ theme: "dracula", custom: null, enabled: true }), { theme: "nord", custom: null, enabled: false });
    assert.deepEqual(await storage.get("theme"), { theme: "nord" });
    assert.deepEqual(await storage.get(["reskin.ui", "reskin.settings", "theme"]), { "reskin.ui": { group: "mine" }, theme: "nord" });
    await assert.rejects(() => storage.get(42), TypeError);
  });

  test(`${kind}: the extension's records are one manager value, written at once, and this tab's subscribers hear what changed`, async () => {
    const gm = fakeGm(kind);
    const { storage } = createGmStorage(gm.scope, fast);
    const heard = [];
    const unsubscribe = storage.subscribe((changes) => heard.push(changes));
    await storage.set({ "reskin.settings": { revision: 1 }, "reskin.draft": null, skipped: undefined });
    assert.deepEqual(Object.keys(gm.snapshot()), [STATE_KEY]);
    assert.deepEqual(records(gm.snapshot()), { "reskin.settings": { revision: 1 }, "reskin.draft": null });
    assert.equal(gm.calls.filter(([op]) => op === "set").length, 1);
    await storage.remove(["reskin.draft"]);
    assert.deepEqual(records(gm.snapshot()), { "reskin.settings": { revision: 1 } });
    // An unchanged record is not reported.
    await storage.set({ "reskin.settings": { revision: 1 } });
    assert.deepEqual(heard, [
      { "reskin.settings": { oldValue: undefined, newValue: { revision: 1 } }, "reskin.draft": { oldValue: undefined, newValue: null } },
      { "reskin.draft": { oldValue: null, newValue: undefined } },
    ]);
    unsubscribe();
    await storage.set({ "reskin.settings": { revision: 2 } });
    assert.equal(heard.length, 2);
  });

  test(`${kind}: a write the manager refuses changes no record and tells no one; one it stored before failing counts`, async () => {
    const gm = fakeGm(kind);
    const { storage } = createGmStorage(gm.scope, fast);
    await storage.set({ "reskin.settings": { revision: 0 }, "reskin.boot": { settingsRevision: 0 } });
    const heard = [];
    storage.subscribe((changes) => heard.push(Object.keys(changes)));
    gm.refuse = (key) => key === STATE_KEY && "refuse";
    await assert.rejects(() => storage.set({ "reskin.settings": { revision: 1 }, "reskin.boot": { settingsRevision: 1 } }), /refused/);
    assert.deepEqual(records(gm.snapshot()), { "reskin.settings": { revision: 0 }, "reskin.boot": { settingsRevision: 0 } });
    assert.deepEqual(heard, []);
    gm.refuse = (key) => key === STATE_KEY && "after";
    await storage.set({ "reskin.settings": { revision: 1 }, "reskin.boot": { settingsRevision: 1 } });
    assert.deepEqual(records(gm.snapshot()), { "reskin.settings": { revision: 1 }, "reskin.boot": { settingsRevision: 1 } });
    assert.deepEqual(heard, [["reskin.settings", "reskin.boot"]]);
  });
}

test("a manager without deleteValue clears a key with null, which readers treat as absent", async () => {
  const gm = fakeGm("async", { theme: "nord" }, { deleteValue: false });
  const { storage } = createGmStorage(gm.scope, fast);
  await storage.remove(["theme"]);
  assert.deepEqual(gm.snapshot(), { theme: null });
});

test("an unreadable record is refused rather than read as a first run", async () => {
  const gm = fakeGm("sync", { [STATE_KEY]: "garbage" });
  const { storage } = createGmStorage(gm.scope, fast);
  await assert.rejects(() => storage.get(["reskin.settings"]), /unreadable/);
  await assert.rejects(() => storage.set({ "reskin.ui": {} }), /unreadable/);
  assert.equal(gm.snapshot()[STATE_KEY], "garbage");
});

test("another tab's write arrives through the manager's change listener as the records it changed, and this tab's own echo is ignored", async () => {
  const gm = fakeGm("sync");
  const { storage, capabilities } = createGmStorage(gm.scope, { ...fast, document: fakeDocument() });
  assert.equal(capabilities.crossTabEvents, true);
  // Nothing is registered with the manager until someone listens.
  assert.equal(gm.listeners.size, 0);
  const heard = [];
  const unsubscribe = storage.subscribe((changes) => heard.push(changes));
  assert.equal(gm.listeners.size, 1);
  gm.remoteWrite(STATE_KEY, { format: 1, stamp: "other:1", lineage: [], records: { "reskin.settings": { revision: 7 } } });
  gm.remoteWrite("unrelated", 1);
  await storage.set({ "reskin.lastGood": { revision: 6 } });
  assert.deepEqual(heard, [{ "reskin.settings": { oldValue: undefined, newValue: { revision: 7 } } }, { "reskin.lastGood": { oldValue: undefined, newValue: { revision: 6 } } }]);
  unsubscribe();
  assert.equal(gm.listeners.size, 0);
});

test("without change events, a tab that is shown again re-reads every watched record", async () => {
  const gm = fakeGm("async");
  const document = fakeDocument();
  const { storage, capabilities } = createGmStorage(gm.scope, { ...fast, document });
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

for (const kind of ["sync", "async"]) {
  test(`${kind}: of two tabs that write over the same record at once, the overwritten one is told; a UI record is written again`, async () => {
    const values = new Map();
    const a = createGmStorage(fakeGm(kind, {}, { values }).scope, fast).storage;
    const b = createGmStorage(fakeGm(kind, {}, { values }).scope, fast).storage;
    const settings = (revision, by) => ({ revision, by, cssConsent: {}, preferences: { appearance: "full" } });
    await a.set({ "reskin.settings": settings(0, "a") });
    // Both read revision 0 before either writes.
    const [first, second] = await Promise.allSettled([a.set({ "reskin.settings": settings(1, "a") }), b.set({ "reskin.settings": settings(1, "b") })]);
    const outcomes = [first.status, second.status].sort();
    assert.deepEqual(outcomes, ["fulfilled", "rejected"]);
    const rejected = [first, second].find((result) => result.status === "rejected");
    assert.equal(rejected.reason.message, WRITE_LOST);
    const kept = records(Object.fromEntries([...values].map(([key, value]) => [key, JSON.parse(value)])))["reskin.settings"].by;
    assert.equal(kept, first.status === "fulfilled" ? "a" : "b");

    // UI records do not depend on what was read: both are kept.
    await Promise.all([a.set({ "reskin.ui": { group: "mine" } }), b.set({ "reskin.draft": { name: "x" } })]);
    const after = records(Object.fromEntries([...values].map(([key, value]) => [key, JSON.parse(value)])));
    assert.deepEqual([after["reskin.ui"], after["reskin.draft"]], [{ group: "mine" }, { name: "x" }]);
  });
}

test("a settings write must follow the stored revision, and a boot record alone must match it", async () => {
  const gm = fakeGm("sync");
  const { storage } = createGmStorage(gm.scope, fast);
  await storage.set({ "reskin.settings": { revision: 0, cssConsent: {}, preferences: { appearance: "full" } } });
  await storage.set({ "reskin.settings": { revision: 1, cssConsent: {}, preferences: { appearance: "full" } } });
  // Another tab committed revision 1 since this one read revision 0.
  await assert.rejects(() => storage.set({ "reskin.settings": { revision: 1, cssConsent: {}, preferences: { appearance: "calm" } } }), new RegExp(WRITE_LOST));
  await assert.rejects(() => storage.set({ "reskin.boot": { settingsRevision: 0 } }), new RegExp(WRITE_LOST));
  await storage.set({ "reskin.boot": { settingsRevision: 1 } });
  // A Revision 3 record is upgraded in place, at the same revision.
  const old = fakeGm("sync", { [STATE_KEY]: { format: 1, stamp: "x:1", lineage: [], records: { "reskin.settings": { revision: 4, preferences: {} } } } });
  await createGmStorage(old.scope, fast).storage.set({ "reskin.settings": { revision: 4, cssConsent: {}, preferences: { appearance: "full" } } });
  assert.equal(records(old.snapshot())["reskin.settings"].revision, 4);
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

test("the Firefox lock bridge exports to the document's own window, not a manager's window proxy", () => {
  const page = { Promise: class PagePromise {} };
  // Violentmonkey's window: a proxy that exportFunction refuses, with the script's own Promise.
  const proxy = new Proxy(page, { get: (target, key) => (key === "Promise" ? Promise : Reflect.get(target, key)) });
  const targets = [];
  const scope = { exportFunction: (fn, target) => (targets.push(target), fn) };
  const bridge = lockBridge(scope, { document: { defaultView: page }, view: proxy, isolation: { method: "xray" } });
  bridge.exportFunction(() => {});
  assert.equal(targets[0], page);
  assert.equal(bridge.Promise, page.Promise);
  assert.equal(lockBridge(scope, { document: { defaultView: page }, view: proxy, isolation: { method: "report" } }), null, "only Firefox's content-script realm needs one");
  assert.equal(lockBridge({}, { document: { defaultView: page }, view: proxy, isolation: { method: "xray" } }), null);
});
