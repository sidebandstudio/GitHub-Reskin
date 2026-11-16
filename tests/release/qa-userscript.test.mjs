// scripts/qa-userscript.mjs without a browser: the managers it runs, each pinned. The run itself is
// npm run qa:userscript.
import assert from "node:assert/strict";
import test from "node:test";
import { MANAGERS } from "../../scripts/qa-userscript.mjs";

test("Violentmonkey runs in both engines and Tampermonkey in Firefox, each pinned to a SHA-256", () => {
  assert.deepEqual(MANAGERS.map((m) => `${m.name} ${m.engine}`).sort(), ["Tampermonkey firefox", "Violentmonkey chromium", "Violentmonkey firefox"]);
  for (const manager of MANAGERS) {
    assert.match(manager.sha256, /^[0-9a-f]{64}$/, manager.file);
    assert.match(manager.url, /^https:\/\//);
    assert.equal(typeof manager.disable, "function");
    if (manager.engine === "firefox") assert.ok(manager.background, `${manager.name} needs its background page to open the dashboard`);
  }
});
