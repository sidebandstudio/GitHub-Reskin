import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_THEME_ID, LEGACY_CLASSIC_THEME_IDS, LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "../../packages/contracts/index.js";
import { bootRecordProblems, migrateLegacy, readSettings, RECOVERY_KEY, validateSettings } from "../../packages/settings/index.js";
import { createBackground } from "../../extension/background/host.js";
import { catalog, context, fakeApi, memoryStorage, ROOT } from "./helpers.mjs";

const { cases } = JSON.parse(readFileSync(`${ROOT}tests/fixtures/settings/migrations.json`, "utf8"));

for (const { name, raw, expect } of cases) {
  test(`migration: ${name}`, async () => {
    const storage = memoryStorage(raw);
    const api = fakeApi();
    const background = createBackground({ api, storage, ...context() });
    const installed = await background.handleInstalled({ reason: expect.firstRun ? "install" : "update" });
    const stored = storage.snapshot();
    const result = validateSettings(stored[STORAGE_KEYS.settings], catalog);
    assert.ok(result.ok, JSON.stringify(result.issues));
    const settings = result.settings;
    assert.equal(settings.enabled, expect.enabled);
    if (expect.selectedThemeId === "local") {
      assert.equal(settings.customThemes.length, 1);
      const [local] = settings.customThemes;
      assert.equal(settings.selectedThemeId, local.id);
      assert.equal(local.basedOn, expect.basedOn);
      assert.equal(local.document.base, expect.base);
      assert.deepEqual(local.document.colors, expect.colors);
    } else {
      assert.equal(settings.selectedThemeId, expect.selectedThemeId);
      assert.equal(settings.customThemes.length, 0);
    }
    assert.deepEqual(settings.migration.notices, expect.notices);
    assert.deepEqual(settings.preferences, { appearance: "full", extras: true, text: true, motion: true, fonts: true, effects: true });
    // Recovery copies exist exactly when something could not be used as-is.
    const recovery = stored[RECOVERY_KEY];
    assert.deepEqual(recovery ? Object.keys(recovery).filter((k) => k !== "from").sort() : [], expect.recovery);
    for (const key of expect.recovery) assert.deepEqual(recovery[key], raw[key]);
    // Old extension keys go once v2 reloads; boot is written in the same set and validates.
    for (const key of LEGACY_STORAGE_KEYS) assert.equal(key in stored, false, `${key} remains`);
    if (settings.enabled) assert.deepEqual(bootRecordProblems(stored[STORAGE_KEYS.boot]), []);
    else assert.equal(stored[STORAGE_KEYS.boot], null);
    // First run only for a genuine install with nothing stored.
    assert.equal(installed, expect.firstRun);
    assert.equal(api.tabs.opened.length, expect.firstRun ? 1 : 0);
    assert.equal(settings.onboardingCompleted, !expect.firstRun);
    if (!expect.firstRun) assert.equal(settings.migration.from, "1.1.0");
  });
}

test("every 1.x palette ID is preserved exactly, never replaced by a new default", () => {
  for (const id of LEGACY_CLASSIC_THEME_IDS) {
    const { settings, notices } = migrateLegacy({ theme: id }, context());
    assert.equal(settings.selectedThemeId, id);
    assert.deepEqual(notices, []);
  }
});

test("migration reads only the known 1.x keys", () => {
  const { settings } = migrateLegacy({ theme: "nord", "github-reskin-css": ":root{}", other: 1, slang: true }, context());
  assert.equal(settings.selectedThemeId, "nord");
  assert.equal(JSON.stringify(settings).includes(":root"), false);
});

test("reading never writes, even when it previews a migration", async () => {
  const storage = memoryStorage({ theme: "cyberpunk", enabled: false });
  const read = await readSettings(storage, context());
  assert.equal(read.ok, true);
  assert.equal(read.migrated, true);
  assert.equal(read.settings.selectedThemeId, DEFAULT_THEME_ID);
  assert.equal(read.settings.enabled, false);
  assert.equal(storage.log.some(([op]) => op !== "get"), false);
  assert.deepEqual(storage.snapshot(), { theme: "cyberpunk", enabled: false });
});

test("an existing v2 state written during migration wins over the older legacy read", async () => {
  const winner = { ...migrateLegacy({ theme: "gruvbox" }, context()).settings, revision: 7, migration: { notices: [] }, onboardingCompleted: true };
  let reads = 0;
  const storage = memoryStorage({ theme: "nord" }, {
    // The second read is the re-read immediately before saving; another writer got there first.
    get: async () => {
      if (++reads === 2) storage.data.set(STORAGE_KEYS.settings, winner);
    },
  });
  const background = createBackground({ api: fakeApi(), storage, ...context() });
  const init = await background.initialize();
  assert.equal(init.state, "current");
  const stored = storage.snapshot()[STORAGE_KEYS.settings];
  assert.equal(stored.selectedThemeId, "gruvbox");
  assert.equal(stored.revision, 7);
});

test("legacy keys stay until the v2 record reloads and validates", async () => {
  let failReload = true;
  const storage = memoryStorage({ theme: "dracula" }, {
    get: async (keys) => {
      if (failReload && keys.length === 1 && keys[0] === STORAGE_KEYS.settings && storage.data.has(STORAGE_KEYS.settings)) throw new Error("read denied");
    },
  });
  const first = createBackground({ api: fakeApi(), storage, ...context() });
  assert.equal((await first.initialize()).state, "migrated");
  assert.equal(storage.data.get("theme"), "dracula");
  // The next worker start finishes the removal.
  failReload = false;
  const second = createBackground({ api: fakeApi(), storage, ...context() });
  assert.equal((await second.initialize()).state, "current");
  assert.equal(storage.data.has("theme"), false);
  assert.equal(storage.data.get(STORAGE_KEYS.settings).selectedThemeId, "dracula");
});

test("a denied write during migration leaves 1.x data untouched and retries next start", async () => {
  let deny = true;
  const storage = memoryStorage({ theme: "nord", enabled: false }, { set: async () => { if (deny) throw new Error("QUOTA_BYTES quota exceeded"); } });
  const api = fakeApi();
  const background = createBackground({ api, storage, ...context() });
  const init = await background.initialize();
  assert.equal(init.state, "failed");
  assert.deepEqual(storage.snapshot(), { theme: "nord", enabled: false });
  deny = false;
  assert.equal((await background.initialize()).state, "migrated");
  assert.equal(storage.data.get(STORAGE_KEYS.settings).enabled, false);
  assert.equal(api.tabs.opened.length, 0);
});

test("a v2 record without appearance migrates extras false to Calm and true to Full", async () => {
  for (const [extras, appearance] of [[false, "calm"], [true, "full"]]) {
    const old = { ...migrateLegacy({}, context()).settings, revision: 3, migration: { notices: [] } };
    delete old.cssConsent;
    old.preferences = { extras, text: false, motion: true, fonts: true, effects: false };
    const storage = memoryStorage({ [STORAGE_KEYS.settings]: old });
    const init = await createBackground({ api: fakeApi(), storage, ...context() }).initialize();
    assert.equal(init.state, "current");
    const stored = storage.data.get(STORAGE_KEYS.settings);
    assert.deepEqual(stored.preferences, { extras, text: false, motion: true, fonts: true, effects: false, appearance });
    assert.deepEqual(stored.cssConsent, {});
    assert.equal(stored.revision, 3);
  }
});

test("a new install defaults to Full with every child switch on", () => {
  const { settings } = migrateLegacy({}, context());
  assert.equal(settings.preferences.appearance, "full");
  assert.equal(settings.preferences.extras, true);
});
