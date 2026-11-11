// scripts/qa-userscript.mjs without a browser: the managers it runs, pinned where their source
// allows, and the Chrome Web Store package unwrapped to its ZIP. The run itself is
// npm run qa:userscript.
import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { MANAGERS, crxZip } from "../../scripts/qa-userscript.mjs";

test("Violentmonkey and Tampermonkey run in both engines, pinned to a SHA-256 except the Chrome Web Store's", () => {
  assert.deepEqual(MANAGERS.map((m) => `${m.name} ${m.engine}`).sort(), ["Tampermonkey chromium", "Tampermonkey firefox", "Violentmonkey chromium", "Violentmonkey firefox"]);
  for (const manager of MANAGERS) {
    if (manager.url.startsWith("https://clients2.google.com/")) assert.equal(manager.sha256, null, "the store serves only its current version");
    else assert.match(manager.sha256, /^[0-9a-f]{64}$/, manager.file);
    assert.match(manager.url, /^https:\/\//);
    assert.equal(typeof manager.disable, "function");
    if (manager.engine === "firefox") assert.ok(manager.background, `${manager.name} needs its background page to open the dashboard`);
  }
});

test("a CRX3 is unwrapped to the ZIP after its header, and a ZIP passes through", () => {
  const zip = Buffer.from(zipSync({ "manifest.json": new TextEncoder().encode("{}") }));
  const header = Buffer.from([1, 2, 3, 4, 5]);
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0);
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  assert.ok(crxZip(Buffer.concat([prefix, header, zip])).equals(zip));
  assert.ok(crxZip(zip).equals(zip));
});
