import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEME_ID, STORAGE_KEYS } from "../../packages/contracts/index.js";
import {
  bootRecordProblems,
  createRepository,
  defaultSettings,
  effectivePreferences,
  NO_CSS_SANITIZER,
  APPROVAL_ISSUE,
  APPROVALS_KEY,
  RECOVERY_KEY,
  recordBytes,
  reduceAction,
  STORAGE_LIMITS,
  validateSettings,
} from "../../packages/settings/index.js";
import { catalog, CHOOM, CLASSICS, context, deferred, memoryStorage, standInCss } from "./helpers.mjs";

const nord = CLASSICS.find((t) => t.id === "nord").document;
const EDITOR = "editor-aaaaaaaaaaaaaaaa";
const OTHER_EDITOR = "editor-bbbbbbbbbbbbbbbb";
// The builder document the background names as an approval request's sender.
const BUILDER = { document: "document:builder-1" };
const CSS_A = ".AppHeader { box-shadow: 0 1px 0 var(--reskin-accent); }";
const CSS_B = ".AppHeader { box-shadow: none; }";

async function ready(initial = {}, hooks, extra) {
  const storage = memoryStorage(initial, hooks);
  const repository = createRepository(storage, context(extra));
  const init = await repository.initialize();
  return { storage, repository, init };
}
const stored = (storage) => storage.data.get(STORAGE_KEYS.settings);

test("a commit writes settings, boot and lastGood in one set and replies after it resolves", async () => {
  const gate = deferred();
  const { storage, repository } = await ready();
  let writes = 0;
  const realSet = storage.set;
  storage.set = async (record) => {
    writes++;
    assert.deepEqual(Object.keys(record).sort(), [STORAGE_KEYS.boot, STORAGE_KEYS.lastGood, STORAGE_KEYS.settings].sort());
    await gate.promise;
    return realSet(record);
  };
  let replied = false;
  const reply = repository.commit({ type: "selectTheme", id: "nord" }, 0).then((r) => ((replied = true), r));
  await new Promise((r) => setImmediate(r));
  assert.equal(replied, false, "no reply before the write resolves");
  gate.resolve();
  const result = await reply;
  assert.equal(writes, 1);
  assert.equal(result.ok, true);
  assert.equal(result.settings.revision, 1);
  assert.equal(stored(storage).selectedThemeId, "nord");
  const boot = storage.data.get(STORAGE_KEYS.boot);
  assert.deepEqual(bootRecordProblems(boot), []);
  assert.equal(boot.settingsRevision, 1);
  assert.deepEqual(storage.data.get(STORAGE_KEYS.lastGood), { themeId: DEFAULT_THEME_ID, sourceHash: catalog.sourceHash(DEFAULT_THEME_ID), revision: 0 });
});

test("concurrent commits are serialized and a stale revision gets a conflict with current state", async () => {
  const { storage, repository } = await ready();
  const [a, b, c] = await Promise.all([
    repository.commit({ type: "selectTheme", id: "nord" }, 0),
    repository.commit({ type: "selectTheme", id: "dracula" }, 0),
    repository.commit({ type: "setPreference", key: "motion", value: false }, 1),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.equal(b.code, "conflict");
  assert.equal(b.current.selectedThemeId, "nord", "the conflict carries the newer selection");
  assert.equal(b.current.revision, 1);
  assert.equal(c.ok, true);
  assert.equal(stored(storage).selectedThemeId, "nord", "a stale selection never overwrites a newer one");
  assert.equal(stored(storage).preferences.motion, false);
  assert.equal(stored(storage).revision, 2);
});

test("a restarted worker rehydrates from storage; in-memory queues are not authority", async () => {
  const storage = memoryStorage();
  const first = createRepository(storage, context());
  await first.initialize();
  assert.equal((await first.commit({ type: "selectTheme", id: "gruvbox" }, 0)).ok, true);
  // The worker stops; a new one starts with an empty queue.
  const second = createRepository(storage, context());
  assert.equal((await second.initialize()).state, "current");
  const stale = await second.commit({ type: "setEnabled", enabled: false }, 0);
  assert.equal(stale.code, "conflict");
  const fresh = await second.commit({ type: "setEnabled", enabled: false }, 1);
  assert.equal(fresh.ok, true);
  assert.equal(stored(storage).selectedThemeId, "gruvbox");
  assert.equal(stored(storage).enabled, false);
  assert.equal(storage.data.get(STORAGE_KEYS.boot), null, "disabled settings carry no snapshot");
});

test("a failed write keeps the committed state and reports storage", async () => {
  let fail = false;
  const { storage, repository } = await ready({}, { set: async () => { if (fail) throw new Error("QUOTA_BYTES quota exceeded"); } });
  await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  const before = storage.snapshot();
  fail = true;
  const result = await repository.commit({ type: "selectTheme", id: "dracula" }, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, "storage");
  assert.equal(result.current.selectedThemeId, "nord");
  assert.deepEqual(storage.snapshot(), before);
  fail = false;
  assert.equal((await repository.commit({ type: "selectTheme", id: "dracula" }, 1)).ok, true, "Retry works on the same revision");
});

test("a read failure inside a commit reports storage without writing", async () => {
  let fail = false;
  const { storage, repository } = await ready({}, { get: async () => { if (fail) throw new Error("denied"); } });
  const before = storage.snapshot();
  fail = true;
  const result = await repository.commit({ type: "setEnabled", enabled: false }, 0);
  assert.equal(result.code, "storage");
  fail = false;
  assert.deepEqual(storage.snapshot(), before);
});

test("capacity is measured over every record before the write; the committed theme stays", async () => {
  const { storage, repository } = await ready();
  // Fill the other records to 100 bytes under the ceiling; the commit needs more than that.
  storage.data.set(STORAGE_KEYS.ui, { pad: "" });
  storage.data.set(STORAGE_KEYS.ui, { pad: "x".repeat(STORAGE_LIMITS.maxRecordsBytes - recordBytes(storage.snapshot()) - 100) });
  assert.equal(recordBytes(storage.snapshot()), STORAGE_LIMITS.maxRecordsBytes - 100);
  const before = storage.snapshot();
  const result = await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, "storage");
  assert.equal(result.issues[0].code, "capacity");
  assert.deepEqual(storage.snapshot(), before);
  assert.equal(result.current.selectedThemeId, DEFAULT_THEME_ID);
});

test("the custom theme collection is capped at 50 with a capacity reply", async () => {
  const { storage, repository } = await ready();
  for (let i = 0; i < STORAGE_LIMITS.maxCustomThemes; i++) {
    const reply = await repository.commit({ type: "saveCustom", document: { ...nord, name: `Nord ${i}` }, basedOn: "nord", select: false }, i);
    assert.equal(reply.ok, true, JSON.stringify(reply.issues));
  }
  const full = await repository.commit({ type: "saveCustom", document: nord, select: true }, 50);
  assert.equal(full.code, "storage");
  assert.equal(full.issues[0].code, "capacity");
  assert.equal(stored(storage).customThemes.length, 50);
  assert.equal(stored(storage).selectedThemeId, DEFAULT_THEME_ID);
});

test("saving, selecting and deleting a local theme keeps selection, lastGood and consent coherent", async () => {
  const { storage, repository } = await ready();
  const saved = await repository.commit({ type: "saveCustom", document: { ...nord, name: "Mine" }, basedOn: "nord", select: true }, 0);
  assert.equal(saved.ok, true);
  const id = saved.settings.selectedThemeId;
  assert.match(id, /^local:/);
  assert.equal(storage.data.get(STORAGE_KEYS.boot).selectedSourceHash, storage.data.get(STORAGE_KEYS.boot).validatedTokenSnapshot.sourceHash);
  // Select a built-in so lastGood points at the local theme, then delete it.
  await repository.commit({ type: "selectTheme", id: "dracula" }, 1);
  assert.equal(storage.data.get(STORAGE_KEYS.lastGood).themeId, id);
  const deleted = await repository.commit({ type: "deleteCustom", id }, 2);
  assert.equal(deleted.ok, true);
  assert.deepEqual(deleted.notices, ["undo-cleared"], "the recovery reference is cleared visibly");
  assert.equal(await repository.lastGood(), null);
});

test("deleting the selected local theme first switches to its built-in source", async () => {
  const { storage, repository } = await ready();
  const saved = await repository.commit({ type: "saveCustom", document: nord, basedOn: "nord", select: true }, 0);
  const result = await repository.commit({ type: "deleteCustom", id: saved.settings.selectedThemeId }, 1);
  assert.equal(result.settings.selectedThemeId, "nord");
  // Undo cannot point at the deleted theme: the reference is cleared, visibly, in the same write.
  assert.deepEqual(result.notices, ["undo-cleared"]);
  assert.equal(await repository.lastGood(), null);
  assert.equal(storage.data.get(STORAGE_KEYS.lastGood), null);
});

test("the primary switch and the extras alias move together; child switches never do", () => {
  let settings = { ...defaultSettings(catalog), preferences: { appearance: "full", extras: true, text: false, motion: true, fonts: false, effects: true } };
  settings = reduceAction(settings, { type: "setPreference", key: "appearance", value: "calm" }, { catalog });
  assert.deepEqual(settings.preferences, { appearance: "calm", extras: false, text: false, motion: true, fonts: false, effects: true });
  assert.equal(effectivePreferences(settings).extras, false);
  settings = reduceAction(settings, { type: "setPreference", key: "extras", value: true }, { catalog });
  assert.deepEqual(settings.preferences, { appearance: "full", extras: true, text: false, motion: true, fonts: false, effects: true });
  // Switching themes never re-enables a preference.
  settings = reduceAction(settings, { type: "selectTheme", id: "nord" }, { catalog });
  assert.equal(settings.preferences.text, false);
  assert.throws(() => reduceAction(settings, { type: "setPreference", key: "appearance", value: true }, { catalog }), /appearance must be full or calm/);
  assert.throws(() => reduceAction(settings, { type: "setPreference", key: "enabled", value: false }, { catalog }));
});

test("selecting a theme while off saves it and leaves Reskin off", async () => {
  const { repository } = await ready({ enabled: false });
  const reply = await repository.commit({ type: "selectTheme", id: "rose-pine" }, 0);
  assert.equal(reply.settings.enabled, false);
  assert.equal(reply.settings.selectedThemeId, "rose-pine");
});

test("actions are a closed union with exact payloads", async () => {
  const { repository, storage } = await ready();
  const before = storage.snapshot();
  for (const action of [
    { type: "replaceSettings", settings: {} },
    { type: "selectTheme", id: "nord", extra: 1 },
    { type: "selectTheme", id: "cyberpunk" },
    { type: "selectTheme", id: "local:00000000-0000-4000-8000-000000000009" },
    { type: "setEnabled", enabled: "false" },
    { type: "saveCustom", document: nord },
    { type: "saveCustom", document: { ...nord, base: "neon" }, select: true },
    { type: "deleteCustom", id: "nord" },
    null,
  ]) {
    const reply = await repository.commit(action, 0);
    assert.equal(reply.ok, false, JSON.stringify(action));
    assert.equal(reply.code, "invalid");
  }
  assert.deepEqual(storage.snapshot(), before);
});

test("the current build rejects advanced CSS, images and CSS consent safely", async () => {
  const { storage, repository } = await ready();
  const before = storage.snapshot();
  const withCss = { ...nord, css: ".Header { color: red }" };
  const withImage = { ...nord, description: "data:image/png;base64,iVBORw0KGgo=" };
  for (const document of [withCss, withImage]) {
    const reply = await repository.commit({ type: "saveCustom", document, select: true }, 0);
    assert.equal(reply.ok, false);
    assert.equal(reply.code, "invalid");
  }
  assert.deepEqual(storage.snapshot(), before);
  // Even past the schema, the admission interfaces refuse.
  assert.equal(NO_CSS_SANITIZER.inspect(withCss).css.ok, false);
  const saved = await repository.commit({ type: "saveCustom", document: nord, select: true }, 0);
  const id = saved.settings.selectedThemeId;
  const approval = await repository.commit({ type: "approveCss", editor: EDITOR, target: id, css: ".Header { color: red }" }, 1, BUILDER);
  assert.equal(approval.ok, false);
  assert.equal(approval.code, "invalid");
  const consent = await repository.commit({ type: "setCssConsent", id, granted: true, editor: EDITOR, approval: "a".repeat(32) }, 1, BUILDER);
  assert.equal(consent.ok, false);
  assert.equal(consent.code, "invalid");
  assert.deepEqual(stored(storage).cssConsent, {});
  // Revoking is always allowed and changes nothing here.
  assert.equal((await repository.commit({ type: "setCssConsent", id, granted: false }, 1)).ok, true);
});

test("consent is keyed by sanitized hash and version, and a CSS change needs a fresh choice", async () => {
  const css = standInCss();
  const { storage, repository } = await ready({}, undefined, { css });
  const saved = await repository.commit({ type: "saveCustom", document: { ...nord, css: CSS_A }, select: true, editor: EDITOR }, 0, BUILDER);
  const id = saved.settings.selectedThemeId;
  assert.deepEqual(stored(storage).cssConsent, {}, "saving alone approves nothing");
  // A ticket is issued for exactly the text approved, and redeems only for that CSS.
  const other = await repository.commit({ type: "approveCss", editor: EDITOR, target: id, css: CSS_B }, 1, BUILDER);
  assert.equal(other.settings.revision, 1, "an approval request leaves settings alone");
  const wrong = await repository.commit({ type: "setCssConsent", id, granted: true, editor: EDITOR, approval: other.approval.ticket }, 1, BUILDER);
  assert.equal(wrong.code, "invalid", "a ticket for other CSS is refused");
  assert.equal(wrong.issues[0].reason, APPROVAL_ISSUE);
  const ticket = (await repository.commit({ type: "approveCss", editor: EDITOR, target: id, css: CSS_A }, 1, BUILDER)).approval.ticket;
  assert.equal((await repository.commit({ type: "setCssConsent", id, granted: true, editor: OTHER_EDITOR, approval: ticket }, 1, BUILDER)).code, "invalid", "another editor cannot redeem it");
  assert.equal((await repository.commit({ type: "setCssConsent", id, granted: true, editor: EDITOR, approval: ticket }, 1, BUILDER)).ok, true);
  const hash = css.inspect({ css: CSS_A }).css.hash;
  assert.deepEqual(storage.data.get(STORAGE_KEYS.boot).cssConsent, { hash, sanitizerVersion: 1 });
  assert.deepEqual(storage.data.get(APPROVALS_KEY), [], "the ticket is used up");
  assert.equal(JSON.stringify(storage.snapshot()).includes(ticket), false, "storage never holds a redeemable ticket");
  // Renaming keeps the approval; changing the CSS drops it, and the old text needs a new choice.
  await repository.commit({ type: "saveCustom", id, document: { ...nord, name: "Renamed", css: CSS_A }, select: true, editor: EDITOR }, 2, BUILDER);
  assert.ok(stored(storage).cssConsent[id]);
  await repository.commit({ type: "saveCustom", id, document: { ...nord, css: CSS_B }, select: true, editor: EDITOR }, 3, BUILDER);
  assert.equal(stored(storage).cssConsent[id], undefined);
  await repository.commit({ type: "saveCustom", id, document: { ...nord, css: CSS_A }, select: true, editor: EDITOR }, 4, BUILDER);
  assert.equal(stored(storage).cssConsent[id], undefined);
  // A sanitizer update drops approvals made under the old one when the background starts.
  await repository.commit({ type: "saveCustom", id, document: { ...nord, css: CSS_A }, select: true, editor: EDITOR, approval: (await repository.commit({ type: "approveCss", editor: EDITOR, target: id, css: CSS_A }, 5, BUILDER)).approval.ticket }, 5, BUILDER);
  assert.ok(stored(storage).cssConsent[id]);
  const updated = createRepository(storage, context({ css: standInCss(2) }));
  await updated.initialize();
  assert.deepEqual(stored(storage).cssConsent, {});
});

test("reset all clears drafts, recovery and lastGood but does not repeat first run", async () => {
  const { storage, repository } = await ready({ theme: "vaporwave" });
  assert.ok(storage.data.has(RECOVERY_KEY));
  await repository.saveDraft({ document: nord, savedAt: 1 });
  await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  const reply = await repository.commit({ type: "resetAll" }, 1);
  assert.equal(reply.ok, true);
  assert.equal(reply.settings.selectedThemeId, DEFAULT_THEME_ID);
  assert.equal(reply.settings.onboardingCompleted, true);
  for (const key of [STORAGE_KEYS.draft, RECOVERY_KEY, STORAGE_KEYS.lastGood]) assert.equal(storage.data.get(key), null, key);
});

test("a reset or dismissal whose write fails reports failure and leaves every record in place", async () => {
  const { storage, repository } = await ready({ theme: "vaporwave" }, { remove: async () => { throw new Error("remove denied"); } });
  await repository.saveDraft({ document: nord, savedAt: 1 });
  await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  storage.log.length = 0;
  // Removal is never part of a commit: cleared records go in the one set, as null.
  const reset = await repository.commit({ type: "resetAll" }, 1);
  assert.equal(reset.ok, true);
  assert.deepEqual(storage.log.filter(([op]) => op === "remove"), []);
  for (const key of [STORAGE_KEYS.draft, RECOVERY_KEY, STORAGE_KEYS.lastGood]) assert.equal(storage.data.get(key), null, key);
  assert.equal(await repository.loadDraft(), null);
  assert.equal(await repository.loadRecovery(), null);
  assert.equal(await repository.lastGood(), null);

  let fail = false;
  const second = await ready({ theme: "vaporwave" }, { set: async () => { if (fail) throw new Error("denied"); } });
  const before = second.storage.snapshot();
  fail = true;
  const dismissed = await second.repository.commit({ type: "dismissMigration" }, 0);
  assert.equal(dismissed.ok, false);
  assert.equal(dismissed.code, "storage");
  assert.deepEqual(second.storage.snapshot(), before, "the recovery copy is still there and nothing claims otherwise");
});

test("dismissing migration clears notices and the recovery copy", async () => {
  const { storage, repository } = await ready({ theme: "cyberpunk", custom: { bg: "#000" } });
  assert.deepEqual(stored(storage).migration.notices, ["cyberpunk-alias", "control-swaps-removed", "custom-recovered"]);
  assert.deepEqual((await repository.loadRecovery()).custom, { bg: "#000" });
  await repository.commit({ type: "dismissMigration" }, 0);
  assert.deepEqual(stored(storage).migration.notices, []);
  assert.equal(await repository.loadRecovery(), null);
});

test("drafts are bounded and survive storage errors without touching settings", async () => {
  const { storage, repository } = await ready();
  await repository.saveDraft({ document: nord, source: "{}", savedAt: 5 });
  assert.equal((await repository.loadDraft()).savedAt, 5);
  await assert.rejects(repository.saveDraft({ document: nord, source: "x".repeat(STORAGE_LIMITS.maxDraftBytes), savedAt: 6 }), (error) => error.code === "storage" && error.issues[0].code === "capacity");
  assert.equal((await repository.loadDraft()).savedAt, 5);
  await repository.discardDraft();
  assert.equal(await repository.loadDraft(), null);
  assert.equal(stored(storage).revision, 0);
});

test("a corrupt v2 record is salvaged field by field with a bounded recovery copy", async () => {
  const good = { ...defaultSettings(catalog), revision: 4, enabled: false, selectedThemeId: "nord", onboardingCompleted: true };
  const corrupt = {
    ...good,
    preferences: { appearance: "full", extras: false, text: "yes", motion: true, fonts: true, effects: true },
    customThemes: [{ id: "local:00000000-0000-4000-8000-00000000000a", document: nord, basedOn: "nord" }, { id: "local:bad", document: { name: 1 } }],
    unknown: true,
  };
  const { storage, init } = await ready({ [STORAGE_KEYS.settings]: corrupt });
  assert.equal(init.state, "recovered");
  const settings = stored(storage);
  assert.ok(validateSettings(settings, catalog).ok);
  assert.equal(settings.enabled, false, "enabled=false survives");
  assert.equal(settings.selectedThemeId, "nord");
  assert.equal(settings.preferences.appearance, "calm", "either Calm signal wins");
  assert.equal(settings.preferences.text, true);
  assert.equal(settings.customThemes.length, 1);
  assert.equal(settings.revision, 5);
  assert.ok(settings.migration.notices.includes("settings-recovered"));
  const recovery = storage.data.get(RECOVERY_KEY);
  assert.deepEqual(recovery.customThemes, [{ id: "local:bad", document: { name: 1 } }]);
});

test("corruption after a repaired migration keeps the original colors in recovery", async () => {
  const custom = { bg: "#0a0a17", text: "#0a0a17", accent: "#0a0a17", graph: "#0a0a17" };
  const { storage, init } = await ready({ theme: "cyberpunk", enabled: true, custom });
  assert.equal(init.state, "migrated");
  assert.deepEqual(storage.data.get(RECOVERY_KEY).custom, custom);
  assert.equal(storage.data.has("custom"), false, "the legacy keys are gone, so recovery is the only copy");
  storage.data.set(STORAGE_KEYS.settings, { ...stored(storage), preferences: { ...stored(storage).preferences, text: "yes" } });

  const restarted = createRepository(storage, context());
  assert.equal((await restarted.initialize()).state, "recovered");
  const recovery = await restarted.loadRecovery();
  assert.equal(recovery.from, "1.1.0");
  assert.deepEqual(recovery.custom, custom, "the four original colors survive");
  assert.deepEqual(recovery.salvaged, [{ from: "2", preferences: { text: "yes" } }], "the replaced preference is recorded");

  // When the earlier copy leaves no room, it stays whole and the new copy is reported truncated.
  const full = { from: "1.1.0", custom: "x".repeat(STORAGE_LIMITS.maxRecoveryBytes - 28) };
  storage.data.set(RECOVERY_KEY, full);
  storage.data.set(STORAGE_KEYS.settings, { ...stored(storage), enabled: "no" });
  assert.equal((await createRepository(storage, context()).initialize()).state, "recovered");
  const kept = storage.data.get(RECOVERY_KEY);
  assert.equal(kept.custom, full.custom);
  assert.deepEqual(kept.salvaged, [{ from: "2", enabled: { truncated: true, bytes: 4 } }]);
  assert.ok(stored(storage).migration.notices.includes("recovery-truncated"));
});

test("a newer settings record is never overwritten and commits are refused", async () => {
  const newer = { settingsVersion: 3, revision: 9, future: { x: 1 } };
  const { storage, repository, init } = await ready({ [STORAGE_KEYS.settings]: newer });
  assert.equal(init.state, "newer");
  const reply = await repository.commit({ type: "setEnabled", enabled: false }, 9);
  assert.equal(reply.ok, false);
  assert.equal(reply.code, "invalid");
  assert.deepEqual(stored(storage), newer);
  const read = await repository.read();
  assert.equal(read.ok, false);
  assert.equal(read.fallback.selectedThemeId, DEFAULT_THEME_ID);
});

test("an update that invalidates the boot record rewrites it without changing settings", async () => {
  const { storage } = await ready({ theme: "dracula" });
  const boot = storage.data.get(STORAGE_KEYS.boot);
  const old = { ...boot };
  delete old.expansionVersion;
  delete old.sanitizerVersion;
  storage.data.set(STORAGE_KEYS.boot, old);
  const before = structuredClone(stored(storage));
  const repository = createRepository(storage, context());
  assert.equal((await repository.initialize()).state, "current");
  assert.deepEqual(bootRecordProblems(storage.data.get(STORAGE_KEYS.boot)), []);
  assert.deepEqual(stored(storage), before);
});

test("a snapshot callback failure writes no snapshot but still commits", async () => {
  const { storage, repository } = await ready({}, undefined, { snapshot: () => { throw new Error("renderer down"); } });
  const reply = await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  assert.equal(reply.ok, true);
  assert.equal(storage.data.get(STORAGE_KEYS.boot), null);
});

test("subscribers see only valid settings", async () => {
  const { storage, repository } = await ready();
  const seen = [];
  const unsubscribe = repository.subscribe((settings) => seen.push(settings.selectedThemeId));
  await repository.commit({ type: "selectTheme", id: "nord" }, 0);
  await storage.set({ [STORAGE_KEYS.settings]: { settingsVersion: 2, revision: "x" } });
  await new Promise((r) => setImmediate(r));
  unsubscribe();
  assert.deepEqual(seen, ["nord"]);
  assert.equal(storage.listenerCount(), 0);
});

test("the Choom stand-in resolves and its snapshot carries no resource or CSS text", async () => {
  const { storage } = await ready();
  const boot = storage.data.get(STORAGE_KEYS.boot);
  assert.equal(boot.validatedTokenSnapshot.flavor.slots["profile.tag"], CHOOM.flavor.slots["profile.tag"]);
  assert.equal(/data:|url\(|@import/.test(JSON.stringify(boot)), false);
});

test("saveCustom writes a theme and its CSS approval in one commit, or neither", async () => {
  const css = standInCss();
  let failNext = false;
  const { storage, repository } = await ready({}, { set: async () => { if (failNext) { failNext = false; throw new Error("QUOTA_BYTES quota exceeded"); } } }, { css });
  const ticket = (await repository.commit({ type: "approveCss", editor: EDITOR, target: "new", css: CSS_A }, 0, BUILDER)).approval.ticket;
  const save = { type: "saveCustom", document: { ...nord, css: CSS_A }, select: true, editor: EDITOR, approval: ticket };
  // A failed write leaves no theme behind and the ticket still good, so trying again saves exactly one.
  failNext = true;
  const failed = await repository.commit(save, 0, BUILDER);
  assert.equal(failed.ok, false);
  assert.equal(stored(storage).customThemes.length, 0);
  assert.deepEqual(stored(storage).cssConsent, {});
  const saved = await repository.commit(save, 0, BUILDER);
  assert.equal(saved.ok, true);
  const id = saved.settings.selectedThemeId;
  assert.equal(stored(storage).customThemes.length, 1);
  assert.deepEqual(stored(storage).cssConsent[id], { hash: css.inspect({ css: CSS_A }).css.hash, sanitizerVersion: 1 });
  // The same ticket never approves a second theme.
  const again = await repository.commit(save, 1, BUILDER);
  assert.equal(again.code, "invalid");
  assert.equal(stored(storage).customThemes.length, 1);
  // null revokes while saving.
  assert.equal((await repository.commit({ type: "saveCustom", id, document: { ...nord, name: "Kept", css: CSS_A }, select: true, editor: EDITOR, approval: null }, 1, BUILDER)).ok, true);
  assert.equal(stored(storage).cssConsent[id], undefined);
  assert.equal(stored(storage).customThemes[0].document.name, "Kept");
  assert.equal((await repository.commit({ type: "saveCustom", document: nord, select: true, approval: "x" }, 2)).code, "invalid", "a malformed approval is refused");
  assert.equal((await repository.commit({ type: "saveCustom", document: nord, select: true, approval: "a".repeat(32) }, 2)).code, "invalid", "a ticket needs its editor");
});

test("an approval ticket is issued and redeemed only for the builder document the background names, at the current revision", async () => {
  const css = standInCss();
  const { storage, repository } = await ready({}, undefined, { css });
  const id = (await repository.commit({ type: "saveCustom", document: { ...nord, css: CSS_A }, select: true, editor: EDITOR }, 0, BUILDER)).settings.selectedThemeId;
  const before = storage.snapshot();
  // No sender document: the popup, the first-run page, a content script or any other caller.
  for (const origin of [undefined, null, {}, { document: null }, { document: "" }]) {
    const refused = await repository.commit({ type: "approveCss", editor: EDITOR, target: id, css: CSS_A }, 1, origin);
    assert.equal(refused.ok, false, JSON.stringify(origin));
    assert.equal(refused.issues[0].reason, APPROVAL_ISSUE);
  }
  assert.deepEqual(storage.snapshot(), before, "a refused request stores no ticket");
  // A stale expected revision is refused before any ticket exists.
  const stale = await repository.commit({ type: "approveCss", editor: EDITOR, target: id, css: CSS_A }, 0, BUILDER);
  assert.equal(stale.code, "conflict");
  assert.equal(stale.approval, undefined);
  assert.deepEqual(storage.snapshot(), before);
  // The same editor and ticket strings from another document, or with no document, redeem nothing.
  const ticket = (await repository.commit({ type: "approveCss", editor: EDITOR, target: id, css: CSS_A }, 1, BUILDER)).approval.ticket;
  for (const origin of [{ document: "document:builder-2" }, null]) {
    const replay = await repository.commit({ type: "setCssConsent", id, granted: true, editor: EDITOR, approval: ticket }, 1, origin);
    assert.equal(replay.ok, false, JSON.stringify(origin));
    assert.equal(replay.issues[0].reason, APPROVAL_ISSUE);
  }
  // Another document's withdrawal leaves this document's ticket alone.
  await repository.commit({ type: "withdrawCss", editor: EDITOR }, 1, { document: "document:builder-2" });
  assert.deepEqual(stored(storage).cssConsent, {});
  assert.equal((await repository.commit({ type: "setCssConsent", id, granted: true, editor: EDITOR, approval: ticket }, 1, BUILDER)).ok, true);
  assert.ok(stored(storage).cssConsent[id]);
});

test("startup keeps a stored approval only for a saved theme's exact sanitized CSS under the current sanitizer", async () => {
  const css = standInCss();
  const { storage, repository } = await ready({}, undefined, { css });
  const save = async (name, document, revision) => (await repository.commit({ type: "saveCustom", document: { ...document, name }, select: true }, revision)).settings.selectedThemeId;
  const exact = await save("Exact", { ...nord, css: CSS_A }, 0);
  const other = await save("Other CSS", { ...nord, css: CSS_B }, 1);
  const plain = await save("No CSS", nord, 2);
  const old = await save("Other sanitizer", { ...nord, css: CSS_A }, 3);
  const hashA = css.inspect({ css: CSS_A }).css.hash;
  // Records written straight into the extension's storage, not through an approval.
  const settings = stored(storage);
  settings.cssConsent = {
    [exact]: { hash: hashA, sanitizerVersion: 1 },
    [other]: { hash: hashA, sanitizerVersion: 1 },
    [plain]: { hash: hashA, sanitizerVersion: 1 },
    [old]: { hash: hashA, sanitizerVersion: 2 },
  };
  settings.selectedThemeId = plain;
  storage.data.set(STORAGE_KEYS.settings, settings);
  const restarted = createRepository(storage, context({ css }));
  assert.equal((await restarted.initialize()).state, "current");
  assert.deepEqual(stored(storage).cssConsent, { [exact]: { hash: hashA, sanitizerVersion: 1 } }, "only the record matching its stored theme's CSS and this sanitizer stays");
  assert.equal(stored(storage).revision, settings.revision + 1, "dropping records is a written change");
  assert.equal(storage.data.get(STORAGE_KEYS.boot)?.cssConsent ?? null, null, "the selected theme without CSS boots without approval");
  // A record naming a bundled theme, or a theme that is not saved, is dropped with the salvage.
  const salvaged = stored(storage);
  salvaged.cssConsent = { ...salvaged.cssConsent, nord: { hash: hashA, sanitizerVersion: 1 }, "local:00000000-0000-4000-8000-0000000000ff": { hash: hashA, sanitizerVersion: 1 } };
  storage.data.set(STORAGE_KEYS.settings, salvaged);
  assert.equal((await createRepository(storage, context({ css })).initialize()).state, "recovered");
  assert.deepEqual(stored(storage).cssConsent, { [exact]: { hash: hashA, sanitizerVersion: 1 } });
  // A sanitizer change drops the remaining one.
  await createRepository(storage, context({ css: standInCss(2) })).initialize();
  assert.deepEqual(stored(storage).cssConsent, {});
});
