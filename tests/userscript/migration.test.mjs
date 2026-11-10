// The 1.1.0 userscript kept `enabled`, `theme` and `custom` in its manager's storage, one key each.
// C4's repository migrates them once through the GM adapter: every row of the golden migration
// table, over the synchronous and the asynchronous API, then the old keys are gone. A missing key
// is simply absent (get with a key list), so a saved theme is never mistaken for a default.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "../../packages/contracts/index.js";
import { createRepository, RECOVERY_KEY, validateSettings } from "../../packages/settings/index.js";
import { createGmStorage } from "../../userscript/storage.js";
import { catalog, context } from "../settings/helpers.mjs";
import { fakeGm, records } from "./helpers.mjs";

const { cases } = JSON.parse(readFileSync(new URL("../fixtures/settings/migrations.json", import.meta.url), "utf8"));

for (const kind of ["sync", "async"]) {
  test(`${kind} GM storage: every 1.1.0 migration row lands as the extension's would`, async () => {
    assert.ok(cases.length >= 20);
    for (const { name, raw, expect } of cases) {
      const gm = fakeGm(kind, raw);
      const { storage } = createGmStorage(gm.scope);
      const init = await createRepository(storage, context()).initialize();
      assert.equal(init.state, expect.firstRun ? "fresh" : "migrated", `${name}: ${JSON.stringify(init.issues ?? null)}`);
      const stored = { ...gm.snapshot(), ...records(gm.snapshot()) };
      const result = validateSettings(stored[STORAGE_KEYS.settings], catalog);
      assert.ok(result.ok, name);
      const { settings } = result;
      const local = settings.customThemes[0];
      assert.equal(settings.enabled, expect.enabled, name);
      if (expect.selectedThemeId === "local") {
        assert.equal(settings.selectedThemeId, local?.id, name);
        assert.equal(local.basedOn, expect.basedOn, name);
        assert.deepEqual(local.document.colors, expect.colors, name);
      } else assert.equal(settings.selectedThemeId, expect.selectedThemeId, name);
      assert.deepEqual(settings.migration.notices, expect.notices, name);
      const recovery = stored[RECOVERY_KEY];
      assert.deepEqual(recovery ? Object.keys(recovery).filter((key) => key !== "from").sort() : [], expect.recovery, name);
      for (const key of LEGACY_STORAGE_KEYS) assert.equal(key in stored, false, `${name}: ${key} remains`);
      assert.equal(settings.enabled ? typeof stored[STORAGE_KEYS.boot] : stored[STORAGE_KEYS.boot], settings.enabled ? "object" : null, name);
    }
  });
}

test("a migrated record wins on the next start, and a second tab never migrates again", async () => {
  const gm = fakeGm("sync", { theme: "nord", enabled: false });
  const first = await createRepository(createGmStorage(gm.scope).storage, context()).initialize();
  assert.equal(first.state, "migrated");
  // An older tab's leftover legacy write after the migration does not replace the v2 record.
  gm.remoteWrite("theme", "dracula");
  const second = await createRepository(createGmStorage(gm.scope).storage, context()).initialize();
  assert.equal(second.state, "current");
  assert.equal(records(gm.snapshot())[STORAGE_KEYS.settings].selectedThemeId, "nord");
  assert.equal("theme" in gm.snapshot(), false);
});
