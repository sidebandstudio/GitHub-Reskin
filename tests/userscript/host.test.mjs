// createGmHost: the picker's UiHost over the repository and GM storage. It reads settings with the
// one prior selection Undo offers and the gallery record, commits through the repository's
// revision check, keeps the UI record to its known fields, hears settings changes from any tab,
// and downloads files locally.
import assert from "node:assert/strict";
import test from "node:test";
import { STORAGE_KEYS } from "../../packages/contracts/index.js";
import { createRepository } from "../../packages/settings/index.js";
import { createGmHost } from "../../userscript/host.js";
import { createGmStorage } from "../../userscript/storage.js";
import { context } from "../settings/helpers.mjs";
import { fakeGm, records, STATE_KEY } from "./helpers.mjs";

const VIEW = { navigator: {}, matchMedia: () => ({ matches: false }) };
const state = (recordsByKey) => ({ [STATE_KEY]: { format: 1, stamp: "seed:1", lineage: [], records: recordsByKey } });

function setup(kind = "sync", initial = {}, view = VIEW, options = {}) {
  const gm = fakeGm(kind, initial, options);
  const { storage, capabilities } = createGmStorage(gm.scope, { confirmMs: 1 });
  const repository = createRepository(storage, context());
  const opened = [];
  const host = createGmHost({ storage, repository, capabilities, view, openPage: (page, query) => opened.push([page, query]) });
  return { gm, host, opened };
}

test("read initializes first, then returns settings, lastGood and the UI record", async () => {
  const { gm, host } = setup("sync", state({ [STORAGE_KEYS.ui]: { group: "classics", undoneAt: 3, extra: true } }));
  const read = await host.read();
  assert.equal(read.ok, true);
  assert.equal(read.settings.selectedThemeId, "anime.cyberpunk-edgerunners");
  assert.equal(read.lastGood, null);
  assert.deepEqual(read.ui, { group: "classics", undoneAt: 3 });
  assert.ok(records(gm.snapshot())[STORAGE_KEYS.settings]);
});

test("a commit goes through the revision check and leaves the prior selection for Undo", async () => {
  const { host } = setup("async");
  const { settings } = await host.read();
  const reply = await host.commit({ type: "selectTheme", id: "nord" }, settings.revision);
  assert.equal(reply.ok, true);
  assert.equal(reply.settings.selectedThemeId, "nord");
  const after = await host.read();
  assert.deepEqual([after.lastGood.themeId, after.lastGood.revision], ["anime.cyberpunk-edgerunners", settings.revision]);
  const stale = await host.commit({ type: "selectTheme", id: "dracula" }, settings.revision);
  assert.deepEqual([stale.ok, stale.code, stale.current.selectedThemeId], [false, "conflict", "nord"]);
});

test("writeUi merges known fields only, and subscribers hear the settings and lastGood changes another tab made", async () => {
  const { gm, host } = setup("sync");
  const { settings } = await host.read();
  await host.writeUi({ group: "mine" });
  await assert.rejects(() => host.writeUi({ selectedThemeId: "x" }), TypeError);
  assert.deepEqual(records(gm.snapshot())[STORAGE_KEYS.ui], { group: "mine" });
  let heard = 0;
  const unsubscribe = host.subscribe(() => heard++);
  await host.writeUi({ undoneAt: 1 });
  assert.equal(heard, 0);
  // This tab's own commit answers with its settings; a re-read it started could land late.
  await host.commit({ type: "setEnabled", enabled: false }, settings.revision);
  assert.equal(heard, 0);
  const stored = gm.snapshot()[STATE_KEY];
  gm.remoteWrite(STATE_KEY, { ...stored, stamp: "other:1", records: { ...stored.records, [STORAGE_KEYS.settings]: { ...stored.records[STORAGE_KEYS.settings], revision: 9 } } });
  assert.equal(heard, 1);
  unsubscribe();
});

test("a storage failure is a reply, not a throw", async () => {
  const failing = { get: async () => ({}), set: async () => Promise.reject(new Error("quota")), remove: async () => {}, subscribe: () => () => {} };
  const repository = createRepository(failing, context());
  const host = createGmHost({ storage: failing, repository, capabilities: {}, view: { navigator: {} } });
  const read = await host.read();
  const reply = await host.commit({ type: "selectTheme", id: "nord" }, read.settings?.revision ?? 0);
  assert.equal(reply.ok, false);
});

test("openPage stays in the panel, and files download through a local blob link", async () => {
  const clicks = [];
  const revoked = [];
  const document = {
    documentElement: { append: () => {} },
    createElement: () => ({ click() { clicks.push({ href: this.href, download: this.download }); }, remove() {} }),
  };
  const view = {
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    Blob: class { constructor(parts, { type }) { this.parts = parts; this.type = type; } },
    URL: { createObjectURL: () => "blob:reskin/1", revokeObjectURL: (url) => revoked.push(url) },
    setTimeout: (fn) => fn(),
  };
  const { host, opened } = setup("sync", {}, view);
  assert.deepEqual(await host.openPage("settings", { view: "import" }), { ok: true });
  assert.deepEqual(opened, [["settings", { view: "import" }]]);
  assert.equal(host.capabilities.clipboard, true);
  assert.deepEqual(await host.copyText("x"), { ok: true });
  assert.deepEqual(await host.downloadFile({ filename: "choom.reskin.json", mime: "application/json", bytes: new Uint8Array([123, 125]) }), { ok: true });
  assert.deepEqual(clicks, [{ href: "blob:reskin/1", download: "choom.reskin.json" }]);
  assert.deepEqual(revoked, ["blob:reskin/1"]);
});

// The round-1 review's reproductions: two tabs, each with its own repository and host, over one
// manager store, and a manager that refuses one record of a multi-record commit.
const snapshotOf = (values) => records(Object.fromEntries([...values].map(([key, value]) => [key, JSON.parse(value)])));
function tabs(kind) {
  const values = new Map();
  const make = () => {
    const { storage, capabilities } = createGmStorage(fakeGm(kind, {}, { values }).scope, { confirmMs: 5 });
    return createGmHost({ storage, repository: createRepository(storage, context()), capabilities, view: VIEW });
  };
  return { values, a: make(), b: make() };
}
// What the picker does with a reply: a preference is applied again on the current settings, a
// theme choice never replaces a newer one.
async function asPicker(host, action, revision) {
  let reply = await host.commit(action, revision);
  if (!reply.ok && reply.code === "conflict" && action.type !== "selectTheme" && reply.current) reply = await host.commit(action, reply.current.revision);
  return reply;
}

for (const kind of ["sync", "async"]) {
  test(`${kind}: two tabs saving at once never both succeed, and every acknowledged save is kept`, async () => {
    const { values, a, b } = tabs(kind);
    const { settings } = await a.read();
    await b.read();
    const replies = await Promise.all([a.commit({ type: "setEnabled", enabled: false }, settings.revision), b.commit({ type: "setPreference", key: "text", value: false }, settings.revision)]);
    assert.equal(replies.filter((reply) => reply.ok).length, 1, JSON.stringify(replies.map((reply) => [reply.ok, reply.code])));
    const told = replies.find((reply) => !reply.ok);
    assert.equal(told.code, "conflict");
    // The current settings it is told about are the acknowledged save, which is what is stored.
    const saved = snapshotOf(values)[STORAGE_KEYS.settings];
    assert.deepEqual(told.current, saved);
    const acknowledged = replies.find((reply) => reply.ok).settings;
    assert.deepEqual(saved, acknowledged);

    // The picker applies the preference again on top: both changes stand.
    const again = await asPicker(told === replies[0] ? a : b, told === replies[0] ? { type: "setEnabled", enabled: false } : { type: "setPreference", key: "text", value: false }, told.current.revision);
    assert.equal(again.ok, true);
    const final = snapshotOf(values)[STORAGE_KEYS.settings];
    assert.deepEqual([final.enabled, final.preferences.text, final.revision], [false, false, settings.revision + 2]);
  });

  test(`${kind}: of two theme choices made at once, one is applied and the other tab is told, never silently replaced`, async () => {
    const { values, a, b } = tabs(kind);
    const { settings } = await a.read();
    await b.read();
    const replies = await Promise.all([asPicker(a, { type: "selectTheme", id: "nord" }, settings.revision), asPicker(b, { type: "selectTheme", id: "dracula" }, settings.revision)]);
    assert.deepEqual(replies.map((reply) => reply.ok).sort(), [false, true]);
    const winner = replies.find((reply) => reply.ok).settings.selectedThemeId;
    assert.equal(replies.find((reply) => !reply.ok).code, "conflict");
    assert.equal(snapshotOf(values)[STORAGE_KEYS.settings].selectedThemeId, winner);
  });

  test(`${kind}: two first-run tabs initialize once between them`, async () => {
    const { values, a, b } = tabs(kind);
    const [first, second] = await Promise.all([a.read(), b.read()]);
    assert.equal(first.ok && second.ok, true);
    const saved = snapshotOf(values)[STORAGE_KEYS.settings];
    assert.equal(saved.revision, 0);
    // Both tabs commit on the one stored record.
    const reply = await b.commit({ type: "setEnabled", enabled: false }, saved.revision);
    assert.equal(reply.ok, true);
  });
}

for (const kind of ["sync", "async"]) {
  test(`${kind}: a manager that refuses any one record of a commit leaves every record as it was, says so, and tells no subscriber`, async () => {
    for (const [action, keys] of [
      [{ type: "setEnabled", enabled: false }, [STORAGE_KEYS.settings, STORAGE_KEYS.boot]],
      [{ type: "selectTheme", id: "nord" }, [STORAGE_KEYS.settings, STORAGE_KEYS.boot, STORAGE_KEYS.lastGood]],
      [{ type: "resetAll" }, [STORAGE_KEYS.settings, STORAGE_KEYS.boot, STORAGE_KEYS.draft]],
    ]) {
      for (const key of keys) {
        const { gm, host } = setup(kind);
        const { settings } = await host.read();
        if (action.type === "resetAll") await host.saveDraft({ draft: true });
        const before = records(gm.snapshot());
        let heard = 0;
        host.subscribe(() => heard++);
        // Refuse the write that would change this record, in whichever layout it is stored.
        gm.refuse = (name, value) => {
          const next = name === STATE_KEY ? value.records : { [name]: value };
          return key in next && JSON.stringify(next[key]) !== JSON.stringify(before[key]) ? "refuse" : null;
        };
        const reply = await host.commit(action, settings.revision);
        const label = `${action.type}, refusing ${key}`;
        assert.deepEqual([reply.ok, reply.code], [false, "storage"], label);
        assert.deepEqual(reply.current, settings, label);
        assert.deepEqual(records(gm.snapshot()), before, label);
        assert.equal(heard, 0, label);
        const read = await host.read();
        assert.deepEqual(read.settings, settings, label);
      }
    }
  });
}
