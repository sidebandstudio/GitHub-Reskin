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
import { fakeGm } from "./helpers.mjs";

function setup(kind = "sync", initial = {}, view = { navigator: {}, matchMedia: () => ({ matches: false }) }) {
  const gm = fakeGm(kind, initial);
  const { storage, capabilities } = createGmStorage(gm.scope);
  const repository = createRepository(storage, context());
  const opened = [];
  const host = createGmHost({ storage, repository, capabilities, view, openPage: (page, query) => opened.push([page, query]) });
  return { gm, host, opened };
}

test("read initializes first, then returns settings, lastGood and the UI record", async () => {
  const { gm, host } = setup("sync", { [STORAGE_KEYS.ui]: { group: "classics", undoneAt: 3, extra: true } });
  const read = await host.read();
  assert.equal(read.ok, true);
  assert.equal(read.settings.selectedThemeId, "anime.cyberpunk-edgerunners");
  assert.equal(read.lastGood, null);
  assert.deepEqual(read.ui, { group: "classics", undoneAt: 3 });
  assert.ok(gm.snapshot()[STORAGE_KEYS.settings]);
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

test("writeUi merges known fields only, and subscribers hear settings and lastGood changes", async () => {
  const { gm, host } = setup("sync");
  const { settings } = await host.read();
  await host.writeUi({ group: "mine" });
  await assert.rejects(() => host.writeUi({ selectedThemeId: "x" }), TypeError);
  assert.deepEqual(gm.snapshot()[STORAGE_KEYS.ui], { group: "mine" });
  let heard = 0;
  const unsubscribe = host.subscribe(() => heard++);
  await host.writeUi({ undoneAt: 1 });
  assert.equal(heard, 0);
  await host.commit({ type: "setEnabled", enabled: false }, settings.revision);
  assert.equal(heard, 1);
  gm.remoteWrite(STORAGE_KEYS.settings, gm.snapshot()[STORAGE_KEYS.settings]);
  assert.equal(heard, 2);
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
