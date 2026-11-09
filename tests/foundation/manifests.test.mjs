import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ACCEPTED_FIREFOX_WARNINGS } from "../../scripts/check.mjs";
import { ROOT, extensionFiles, extensionManifest, loadEntry, loadReleaseConfig, manifestPaths, manifestProblems, noticeProblems } from "../../scripts/build.mjs";

const config = await loadReleaseConfig();
const entry = await loadEntry(config);
const legacy = JSON.parse(await readFile(join(ROOT, "extension/manifest.json"), "utf8"));

test("Chrome gets the common manifest without Gecko keys, and no new permissions", async () => {
  const chrome = await extensionManifest("chrome", config);
  assert.equal(chrome.browser_specific_settings, undefined);
  assert.doesNotMatch(JSON.stringify(chrome), /gecko/i);
  assert.deepEqual(chrome.permissions, ["storage"]);
  assert.deepEqual(chrome.content_scripts[0].matches, ["https://github.com/*", "https://gist.github.com/*"]);
  assert.equal(chrome.content_scripts[0].run_at, "document_start");
  assert.deepEqual(manifestProblems(chrome, "chrome", config), []);
});

test("Firefox keeps the studio Gecko ID, minimum 140, no data collection and no Android key", async () => {
  const firefox = await extensionManifest("firefox", config);
  assert.deepEqual(firefox.browser_specific_settings, {
    gecko: { id: "github-reskin@sideband.studio", strict_min_version: "140.0", data_collection_permissions: { required: ["none"] } },
  });
  assert.deepEqual(manifestProblems(firefox, "firefox", config), []);
});

// The 1.1.0 manifest stays installable from extension/ until C6 moves the entry, so the
// generated manifests must not drift from it.
test("the generated manifests match the 1.1.0 manifest users load unpacked", async () => {
  assert.deepEqual(await extensionManifest("firefox", config), legacy);
  const { browser_specific_settings, ...chromeLegacy } = legacy;
  assert.deepEqual(await extensionManifest("chrome", config), chromeLegacy);
  assert.equal(config.version, legacy.version);
});

test("the legacy entry lists exactly the runtime files in extension/, and the manifest's files are among them", async () => {
  const files = [];
  const walk = async (dir) => {
    for (const item of await readdir(join(ROOT, "extension", dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(path);
      else files.push(path);
    }
  };
  await walk("");
  const runtime = files.filter((path) => path !== "manifest.json" && !path.startsWith("manifests/") && !path.startsWith("content/") && !path.startsWith("background/")).sort();
  assert.equal(config.extension.entry, "legacy-1.1.0");
  assert.deepEqual(entry.files, runtime);
  for (const browser of ["chrome", "firefox"]) {
    for (const path of manifestPaths(await extensionManifest(browser, config))) assert.ok(entry.files.includes(path), path);
  }
});

test("manifest checks catch new permissions, hosts, Gecko keys in Chrome and the wrong Gecko ID", async () => {
  const chrome = await extensionManifest("chrome", config);
  const firefox = await extensionManifest("firefox", config);
  const problems = (manifest, browser) => manifestProblems(manifest, browser, config).join("\n");
  assert.match(problems({ ...chrome, permissions: ["storage", "tabs"] }, "chrome"), /permissions/);
  assert.match(problems({ ...chrome, host_permissions: ["<all_urls>"] }, "chrome"), /host_permissions/);
  assert.match(problems({ ...chrome, browser_specific_settings: firefox.browser_specific_settings }, "chrome"), /browser_specific_settings/);
  const gecko = (patch) => ({ ...firefox, browser_specific_settings: { gecko: { ...firefox.browser_specific_settings.gecko, ...patch } } });
  assert.match(problems(gecko({ id: "github-reskin@alitleis.dev" }), "firefox"), /Gecko ID/);
  assert.match(problems(gecko({ strict_min_version: "128.0" }), "firefox"), /minimum/);
  assert.match(problems({ ...firefox, browser_specific_settings: { ...firefox.browser_specific_settings, gecko_android: {} } }, "firefox"), /gecko_android/);
  assert.match(problems({ ...firefox, background: { service_worker: "worker.js" } }, "firefox"), /background scripts/);
  const local = { ...chrome, content_scripts: [{ ...chrome.content_scripts[0], matches: [...config.extension.hostMatches, "http://127.0.0.1/*"] }] };
  assert.match(problems(local, "chrome"), /matches/);
  assert.match(problems({ ...chrome, content_security_policy: { extension_pages: "script-src 'self' https://cdn.example" } }, "chrome"), /CSP/);
});

test("a test fixture build adds only local matches, and production never names localhost", async () => {
  const fixture = await extensionFiles("chrome", { config, entry, testFixture: { matches: ["http://127.0.0.1/*"] } });
  assert.deepEqual(fixture.manifest.content_scripts[0].matches, [...config.extension.hostMatches, "http://127.0.0.1/*"]);
  const production = await extensionFiles("chrome", { config, entry });
  assert.doesNotMatch(production.files["manifest.json"].toString(), /localhost|127\.0\.0\.1/);
  await assert.rejects(extensionFiles("chrome", { config, entry, testFixture: { matches: ["https://example.com/*"] } }), /must be http:\/\/127\.0\.0\.1/);
});

test("the frozen mode snapshot cannot change under the build", async () => {
  const changed = { ...entry, frozen: { "github-modes.js": "0".repeat(64) } };
  await assert.rejects(extensionFiles("firefox", { config, entry: changed }), /github-modes\.js is frozen/);
  await assert.rejects(extensionFiles("firefox", { config, entry: { ...entry, files: [...entry.files, "../package.json"] } }), /must stay inside/);
  const missing = { ...entry, files: entry.files.filter((path) => path !== "popup.html") };
  await assert.rejects(extensionFiles("chrome", { config, entry: missing }), /names files the entry lacks: popup\.html/);
});

test("the frozen Primer-derived snapshot ships with the upstream Primer notice", async () => {
  assert.deepEqual(noticeProblems(entry), []);
  assert.deepEqual(entry.notices.map((n) => [n.file, n.license, n.covers]), [["licenses/primer-primitives.txt", "MIT", ["github-modes.js"]]]);
  const notice = await readFile(join(ROOT, "licenses/primer-primitives.txt"), "utf8");
  assert.match(notice, /Copyright \(c\) 2018 GitHub Inc\./);
  assert.match(notice, /The above copyright notice and this permission notice shall be included/);
  const { files } = await extensionFiles("firefox", { config, entry });
  assert.equal(files["licenses/primer-primitives.txt"].toString(), notice);

  const uncovered = { ...entry, notices: [] };
  assert.match(noticeProblems(uncovered).join("\n"), /frozen extension\/github-modes\.js has no upstream license notice/);
  await assert.rejects(extensionFiles("chrome", { config, entry: uncovered }), /no upstream license notice/);
  const wrong = { ...entry, notices: [{ ...entry.notices[0], covers: ["gone.js"] }] };
  assert.match(noticeProblems(wrong).join("\n"), /covers gone\.js, which the entry lacks/);
});

test("lint:firefox accepts one reviewed warning, and only for this exact desktop-only manifest", async () => {
  assert.deepEqual(Object.keys(ACCEPTED_FIREFOX_WARNINGS), ["KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION"]);
  const { applies, reason } = ACCEPTED_FIREFOX_WARNINGS.KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION;
  assert.match(reason, /desktop-only/);
  const firefox = await extensionManifest("firefox", config);
  assert.equal(applies(firefox), true);
  const gecko = firefox.browser_specific_settings.gecko;
  for (const changed of [
    { gecko: { ...gecko, strict_min_version: "142.0" } },
    { gecko, gecko_android: { strict_min_version: "142.0" } },
    { gecko: { ...gecko, data_collection_permissions: { required: ["none"], optional: ["technicalAndInteraction"] } } },
  ]) {
    assert.equal(applies({ ...firefox, browser_specific_settings: changed }), false, JSON.stringify(changed));
  }
});
